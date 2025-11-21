require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('redis');
const { pool, initDb } = require('./db');
const { Kafka } = require('kafkajs');

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

// Initialize Kafka consumer for payment events
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';
const kafka = new Kafka({
  clientId: 'campaign-service',
  brokers: [KAFKA_BROKER],
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const consumer = kafka.consumer({ groupId: 'campaign-service-group' });
const admin = kafka.admin();

async function ensurePaymentTopicExists() {
  const maxRetries = 30;
  const retryDelay = 2000;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await admin.connect();
      const existingTopics = await admin.listTopics();
      
      if (!existingTopics.includes('payment')) {
        console.log(`⌛ Creating 'payment' topic (attempt ${attempt}/${maxRetries})...`);
        await admin.createTopics({
          topics: [{ topic: 'payment', numPartitions: 3, replicationFactor: 1 }],
          waitForLeaders: true
        });
        console.log('✅ Payment topic created');
      } else {
        console.log('✅ Payment topic already exists');
      }
      
      await admin.disconnect();
      return true;
    } catch (error) {
      console.log(`⌛ Waiting for Kafka to be ready (attempt ${attempt}/${maxRetries})...`);
      await admin.disconnect().catch(() => {});
      
      if (attempt === maxRetries) {
        console.error('❌ Failed to ensure payment topic exists:', error.message);
        return false;
      }
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

async function startPaymentConsumer() {
  const maxRetries = 30;
  const retryDelay = 2000;
  
  try {
    // Ensure topic exists first
    await ensurePaymentTopicExists();
    
    await consumer.connect();
    console.log('Campaign service connected to Kafka');
    
    // Retry subscription with exponential backoff
    let subscribed = false;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await consumer.subscribe({ topic: 'payment', fromBeginning: false });
        console.log('✅ Campaign service subscribed to payment topic');
        subscribed = true;
        break;
      } catch (error) {
        console.log(`⌛ Retrying payment topic subscription (attempt ${attempt}/${maxRetries})...`);
        if (attempt === maxRetries) {
          throw new Error('Failed to subscribe to payment topic after maximum retries');
        }
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    
    if (!subscribed) {
      throw new Error('Failed to subscribe to payment topic');
    }
    
    console.log('👂 Campaign service listening for payment events...\n');
    
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const paymentEvent = JSON.parse(message.value.toString());
          console.log('Received payment event:', paymentEvent);
          
          // Only process successful payments
          if (paymentEvent.status === 'success') {
            await updateCampaignTotal(paymentEvent);
          } else {
            console.log(`Payment failed for donation ${paymentEvent.donationId}: ${paymentEvent.reason}`);
          }
        } catch (err) {
          console.error('Error processing payment event:', err);
        }
      }
    });
  } catch (err) {
    console.error('Error starting payment consumer:', err);
  }
}

async function updateCampaignTotal(paymentEvent) {
  const { campaignId, amount, donationId } = paymentEvent;
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Update campaign total
    const updateResult = await client.query(
      'UPDATE campaigns SET total_amount_raised = total_amount_raised + $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, total_amount_raised',
      [amount, campaignId]
    );
    
    if (updateResult.rows.length === 0) {
      console.error(`Campaign ${campaignId} not found for donation ${donationId}`);
      await client.query('ROLLBACK');
      return;
    }
    
    await client.query('COMMIT');
    
    const updatedCampaign = updateResult.rows[0];
    console.log(`✅ Campaign updated: ${updatedCampaign.name} - New total: $${updatedCampaign.total_amount_raised}`);
    
    // Invalidate cache for this campaign
    await invalidateCache(campaignId);
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating campaign total:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function invalidateCache(campaignId) {
  try {
    // Delete specific campaign cache
    await redisClient.del(`campaigns:${campaignId}`);
    // Delete all campaigns list cache
    await redisClient.del('campaigns:all');
    console.log(`Cache invalidated for campaign ${campaignId}`);
  } catch (err) {
    console.error('Error invalidating cache:', err);
  }
}

app.listen(PORT, () => console.log(`Campaign service listening on ${PORT}`));

// Start Kafka consumer
startPaymentConsumer();
