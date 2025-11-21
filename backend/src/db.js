const { Pool } = require('pg');
const url = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/loginapp';

const pool = new Pool({ connectionString: url });

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };
