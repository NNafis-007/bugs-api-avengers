const { Pool } = require('pg');
const url = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/loginapp';

const pool = new Pool({ connectionString: url });

async function initDb() {
  const client = await pool.connect();
  try {
    // Create campaigns table
    await client.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        total_amount_raised DECIMAL(12, 2) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // Check if we need to seed data
    const countResult = await client.query('SELECT COUNT(*) FROM campaigns');
    const count = parseInt(countResult.rows[0].count);

    if (count === 0) {
      console.log('Seeding campaigns table with dummy data...');
      
      // Insert dummy campaigns
      await client.query(`
        INSERT INTO campaigns (name, total_amount_raised) VALUES
        ('Clean Water Initiative', 125000.00),
        ('Education for All', 87500.50),
        ('Wildlife Conservation Fund', 203450.75),
        ('Community Health Center', 156789.25),
        ('Tech Skills Training Program', 98765.00)
      `);

      console.log('Campaigns table seeded with 5 dummy campaigns');
    } else {
      console.log(`Campaigns table already has ${count} campaigns`);
    }
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };
