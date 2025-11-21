require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const client = require('prom-client');
const { pool, initDb } = require('./db');
const { publishUserRegistration } = require('./kafka-producer');

const app = express();

// Prometheus metrics setup (must be FIRST, before any middleware)
const register = new client.Registry();
client.collectDefaultMetrics({ register }); // CPU, memory, event loop metrics

// Custom metric: HTTP request duration
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5],
  registers: [register]
});

// Custom metric: request counter
const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

// Metrics endpoint FIRST (before any middleware including cors/json)
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Now add middleware
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// JWT Configuration - CRITICAL: Use strong secrets in production
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'devrefreshsecret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m'; // Short-lived access token
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d'; // Long-lived refresh token

// In-memory token blacklist (in production, use Redis or database)
const tokenBlacklist = new Set();

// Validate JWT secrets on startup
if (JWT_SECRET === 'devsecret' || JWT_SECRET.length < 32) {
  console.warn('⚠️  WARNING: Using weak JWT_SECRET. Generate a strong secret for production!');
  console.warn('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
}

if (JWT_REFRESH_SECRET === 'devrefreshsecret' || JWT_REFRESH_SECRET.length < 32) {
  console.warn('⚠️  WARNING: Using weak JWT_REFRESH_SECRET. Generate a strong secret for production!');
}

// Middleware to track metrics (after /metrics route)
app.use((req, res, next) => {
  if (req.path === '/metrics') return next(); // Don't track metrics endpoint itself
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route ? req.route.path : req.path;
    httpRequestDuration.observe({ method: req.method, route, status_code: res.statusCode }, duration);
    httpRequestCounter.inc({ method: req.method, route, status_code: res.statusCode });
  });
  next();
});

// Initialize DB with retry so container doesn't exit before Postgres is ready
(async function ensureDb() {
  const maxAttempts = 30;
  const delay = ms => new Promise(r => setTimeout(r, ms));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await initDb();
      console.log('DB initialized');
      break;
    } catch (err) {
      console.error(`DB init failed (attempt ${attempt}/${maxAttempts}):`, err.message || err);
      if (attempt === maxAttempts) {
        console.error('Max attempts reached; continuing without guaranteed DB init.');
      } else {
        await delay(2000);
      }
    }
  }
})();

// Enhanced JWT authentication middleware with blacklist support
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) {
    return res.status(401).json({ 
      error: 'Missing authorization header',
      message: 'Please provide a Bearer token in the Authorization header'
    });
  }
  
  const [type, token] = auth.split(' ');
  if (type !== 'Bearer' || !token) {
    return res.status(401).json({ 
      error: 'Invalid authorization format',
      message: 'Use format: Authorization: Bearer <token>'
    });
  }
  
  // Check if token is blacklisted (logged out)
  if (tokenBlacklist.has(token)) {
    return res.status(401).json({ 
      error: 'Token revoked',
      message: 'This token has been invalidated. Please login again.'
    });
  }
  
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    req.token = token; // Store token for potential blacklisting
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired',
        message: 'Your session has expired. Please login again or refresh your token.',
        expiredAt: err.expiredAt
      });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'The provided token is malformed or invalid'
      });
    }
    return res.status(401).json({ 
      error: 'Authentication failed',
      message: err.message
    });
  }
}

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  // Validate password strength
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }
  
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) {
      console.log(`User already exists: ${email}`);
      return res.status(400).json({ error: 'User already exists' });
    }
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query('INSERT INTO users(email, password_hash) VALUES($1, $2) RETURNING id, email, created_at', [email, hash]);
    
    const newUser = r.rows[0];
    
    // Publish user registration event to Kafka
    await publishUserRegistration({ 
      id: newUser.id, 
      email: newUser.email,
      username: newUser.email.split('@')[0]
    });
    
    // Auto-login: Generate tokens for the new user
    const accessToken = jwt.sign(
      { 
        userId: newUser.id, 
        email: newUser.email,
        type: 'access',
        iat: Math.floor(Date.now() / 1000)
      }, 
      JWT_SECRET, 
      { 
        expiresIn: JWT_EXPIRES_IN,
        issuer: 'bugs-api-avengers',
        audience: 'bugs-api-client'
      }
    );
    
    const refreshToken = jwt.sign(
      { 
        userId: newUser.id, 
        email: newUser.email,
        type: 'refresh',
        iat: Math.floor(Date.now() / 1000)
      }, 
      JWT_REFRESH_SECRET, 
      { 
        expiresIn: JWT_REFRESH_EXPIRES_IN,
        issuer: 'bugs-api-avengers',
        audience: 'bugs-api-client'
      }
    );
    
    console.log(`✓ New user registered: ${email}`);
    
    return res.status(201).json({ 
      user: newUser,
      accessToken,
      refreshToken,
      expiresIn: JWT_EXPIRES_IN,
      tokenType: 'Bearer',
      message: 'Registration successful. You are now logged in.'
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const r = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
    const user = r.rows[0];
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
    
    // Generate access token with short expiry
    const accessToken = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        type: 'access',
        iat: Math.floor(Date.now() / 1000) // issued at
      }, 
      JWT_SECRET, 
      { 
        expiresIn: JWT_EXPIRES_IN,
        issuer: 'bugs-api-avengers',
        audience: 'bugs-api-client'
      }
    );
    
    // Generate refresh token with long expiry
    const refreshToken = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        type: 'refresh',
        iat: Math.floor(Date.now() / 1000)
      }, 
      JWT_REFRESH_SECRET, 
      { 
        expiresIn: JWT_REFRESH_EXPIRES_IN,
        issuer: 'bugs-api-avengers',
        audience: 'bugs-api-client'
      }
    );
    
    console.log(`✓ User logged in: ${email}`);
    
    return res.json({ 
      accessToken,
      refreshToken,
      expiresIn: JWT_EXPIRES_IN,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        email: user.email
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// Token refresh endpoint - exchange refresh token for new access token
app.post('/api/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(400).json({ 
      error: 'Refresh token required',
      message: 'Please provide a refresh token in the request body'
    });
  }
  
  // Check if refresh token is blacklisted
  if (tokenBlacklist.has(refreshToken)) {
    return res.status(401).json({ 
      error: 'Refresh token revoked',
      message: 'This refresh token has been invalidated. Please login again.'
    });
  }
  
  try {
    // Verify refresh token
    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    
    if (payload.type !== 'refresh') {
      return res.status(401).json({ 
        error: 'Invalid token type',
        message: 'Expected a refresh token'
      });
    }
    
    // Generate new access token
    const newAccessToken = jwt.sign(
      { 
        userId: payload.userId, 
        email: payload.email,
        type: 'access',
        iat: Math.floor(Date.now() / 1000)
      }, 
      JWT_SECRET, 
      { 
        expiresIn: JWT_EXPIRES_IN,
        issuer: 'bugs-api-avengers',
        audience: 'bugs-api-client'
      }
    );
    
    console.log(`✓ Token refreshed for user: ${payload.email}`);
    
    return res.json({ 
      accessToken: newAccessToken,
      expiresIn: JWT_EXPIRES_IN,
      tokenType: 'Bearer'
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Refresh token expired',
        message: 'Your refresh token has expired. Please login again.',
        expiredAt: err.expiredAt
      });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid refresh token',
        message: 'The provided refresh token is malformed or invalid'
      });
    }
    console.error('Token refresh error:', err);
    return res.status(401).json({ 
      error: 'Token refresh failed',
      message: err.message
    });
  }
});

// Logout endpoint - blacklist the current token
app.post('/api/logout', authMiddleware, (req, res) => {
  const token = req.token;
  const { refreshToken } = req.body;
  
  // Add access token to blacklist
  tokenBlacklist.add(token);
  
  // Add refresh token to blacklist if provided
  if (refreshToken) {
    tokenBlacklist.add(refreshToken);
  }
  
  console.log(`✓ User logged out: ${req.user.email}`);
  
  // Clean up old tokens periodically (optional optimization)
  if (tokenBlacklist.size > 10000) {
    console.warn('⚠️  Token blacklist growing large. Consider implementing Redis for production.');
  }
  
  return res.json({ 
    message: 'Logged out successfully',
    note: 'Your tokens have been invalidated'
  });
});

app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, email, created_at FROM users WHERE id = $1', [req.user.userId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ user: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal' });
  }
});

app.listen(PORT, () => console.log(`Backend listening on ${PORT}`));
