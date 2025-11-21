const { Pool } = require('pg');
const url = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/loginapp';

const pool = new Pool({ connectionString: url });

async function initDb() {
  const client = await pool.connect();
  try {
    // Create products table
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        stock INTEGER DEFAULT 0,
        category TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // Check if we need to seed data
    const countResult = await client.query('SELECT COUNT(*) FROM products');
    const count = parseInt(countResult.rows[0].count);

    if (count === 0) {
      console.log('Seeding products table with dummy data...');
      
      // Insert dummy products
      await client.query(`
        INSERT INTO products (name, description, price, stock, category) VALUES
        ('Laptop Pro 15', 'High-performance laptop with 16GB RAM and 512GB SSD', 1299.99, 25, 'Electronics'),
        ('Wireless Mouse', 'Ergonomic wireless mouse with USB receiver', 29.99, 150, 'Accessories'),
        ('Mechanical Keyboard', 'RGB backlit mechanical keyboard with blue switches', 89.99, 75, 'Accessories'),
        ('USB-C Hub', '7-in-1 USB-C hub with HDMI, USB 3.0, and SD card reader', 45.99, 100, 'Accessories'),
        ('Noise Cancelling Headphones', 'Premium over-ear headphones with active noise cancellation', 249.99, 50, 'Audio'),
        ('Smartphone X', 'Latest flagship smartphone with 128GB storage', 899.99, 40, 'Electronics'),
        ('Portable SSD 1TB', 'Fast external SSD with USB 3.1 interface', 119.99, 80, 'Storage'),
        ('Webcam HD', '1080p HD webcam with built-in microphone', 69.99, 120, 'Electronics'),
        ('Desk Lamp LED', 'Adjustable LED desk lamp with touch controls', 39.99, 200, 'Office'),
        ('Monitor 27"', '27-inch 4K monitor with IPS panel', 399.99, 35, 'Electronics'),
        ('Gaming Chair', 'Ergonomic gaming chair with lumbar support', 299.99, 20, 'Furniture'),
        ('Bluetooth Speaker', 'Portable waterproof Bluetooth speaker', 59.99, 90, 'Audio'),
        ('Graphics Tablet', 'Digital drawing tablet with pressure sensitivity', 179.99, 45, 'Creative'),
        ('External Battery 20000mAh', 'High-capacity portable charger with fast charging', 49.99, 110, 'Accessories'),
        ('Smart Watch', 'Fitness tracking smartwatch with heart rate monitor', 199.99, 65, 'Wearables')
      `);

      console.log('Products table seeded with 15 dummy products');
    } else {
      console.log(`Products table already has ${count} products`);
    }
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };
