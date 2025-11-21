require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool, initDb } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Initialize DB with retry
(async function ensureDb() {
  const maxAttempts = 30;
  const delay = ms => new Promise(r => setTimeout(r, ms));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await initDb();
      console.log('Products DB initialized and seeded');
      break;
    } catch (err) {
      console.error(`Products DB init failed (attempt ${attempt}/${maxAttempts}):`, err.message || err);
      if (attempt === maxAttempts) {
        console.error('Max attempts reached; continuing without guaranteed DB init.');
      } else {
        await delay(2000);
      }
    }
  }
})();

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description, price, stock, category, created_at FROM products ORDER BY created_at DESC'
    );
    res.json({ products: result.rows });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Get single product by ID
app.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id, name, description, price, stock, category, created_at FROM products WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'product-backend' });
});

app.listen(PORT, () => console.log(`Product backend listening on ${PORT}`));
