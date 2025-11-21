require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool, initDb } = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

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

app.get('/', (req, res) => {
  res.json({ 
    service: 'User Service', 
    status: 'running',
    endpoints: ['/api/register', '/api/login']
  });
});

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

app.listen(PORT, () => console.log(`User Service listening on ${PORT}`));
