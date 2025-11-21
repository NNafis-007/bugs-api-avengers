require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('redis');
const { pool, initDb } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_TTL = 600; // 5 minutes

// Initialize Redis client
const redisClient = createClient({ url: REDIS_URL });

redisClient.on('error', (err) => console.error('Redis Client Error:', err));
redisClient.on('connect', () => console.log('Redis Client Connected'));

// Connect Redis
(async function connectRedis() {
  try {
    await redisClient.connect();
    console.log('Redis connection established');
  } catch (err) {
    console.error('Redis connection failed:', err);
  }
})();

// Initialize DB with retry
(async function ensureDb() {
  const maxAttempts = 30;
  const delay = ms => new Promise(r => setTimeout(r, ms));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await initDb();
      console.log('Campaigns DB initialized and seeded');
      break;
    } catch (err) {
      console.error(`Campaigns DB init failed (attempt ${attempt}/${maxAttempts}):`, err.message || err);
      if (attempt === maxAttempts) {
        console.error('Max attempts reached; continuing without guaranteed DB init.');
      } else {
        await delay(2000);
      }
    }
  }
})();

// Get all campaigns with caching
app.get('/api/campaigns', async (req, res) => {
  try {
    const cacheKey = 'campaigns:all';
    
    // Try to get from cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      console.log('Cache hit for all campaigns');
      return res.json(JSON.parse(cached));
    }
    
    // Cache miss - fetch from database
    console.log('Cache miss for all campaigns - fetching from DB');
    const result = await pool.query(
      'SELECT id, name, total_amount_raised, created_at, updated_at FROM campaigns ORDER BY created_at DESC'
    );
    
    const response = { campaigns: result.rows };
    
    // Store in cache
    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(response));
    
    res.json(response);
  } catch (err) {
    console.error('Error fetching campaigns:', err);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// Get single campaign by ID with caching
app.get('/api/campaigns/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `campaigns:${id}`;
    
    // Try to get from cache
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      console.log(`Cache hit for campaign ${id}`);
      return res.json(JSON.parse(cached));
    }
    
    // Cache miss - fetch from database
    console.log(`Cache miss for campaign ${id} - fetching from DB`);
    const result = await pool.query(
      'SELECT id, name, total_amount_raised, created_at, updated_at FROM campaigns WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    const response = { campaign: result.rows[0] };
    
    // Store in cache
    await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(response));
    
    res.json(response);
  } catch (err) {
    console.error('Error fetching campaign:', err);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'campaign-service' });
});

app.listen(PORT, () => console.log(`Campaign service listening on ${PORT}`));
