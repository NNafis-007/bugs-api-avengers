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
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

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

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing authorization' });
  const [type, token] = auth.split(' ');
  if (type !== 'Bearer' || !token) return res.status(401).json({ error: 'Invalid authorization format' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) {
      console.log(`User already exists: ${email}`);
      return res.status(400).json({ error: 'User already exists' });
    }
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query('INSERT INTO users(email, password_hash) VALUES($1, $2) RETURNING id, email, created_at', [email, hash]);
    
    // Publish user registration event to Kafka
    await publishUserRegistration({ email });
    
    return res.status(201).json({ user: r.rows[0] });
  } catch (err) {
    console.error(err);
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
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
    return res.json({ token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal' });
  }
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
