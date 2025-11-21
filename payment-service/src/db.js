const { Pool } = require('pg');
const url = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/payment_db';

const pool = new Pool({ connectionString: url });

async function initDb() {
  const client = await pool.connect();
  try {
    // Create user_accounts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL,
        username TEXT NOT NULL,
        balance DECIMAL(12, 2) DEFAULT 1000.00,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    console.log('User accounts table initialized - will be populated from Login events');
  } finally {
    client.release();
  }
}

// Function to get user balance
async function getUserBalance(userId) {
  const result = await pool.query(
    'SELECT balance FROM user_accounts WHERE user_id = $1',
    [userId]
  );
  return result.rows[0]?.balance || null;
}

// Function to create user account from login event
async function createUserAccount(userId, username, email) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Check if user already exists
    const existingUser = await client.query(
      'SELECT user_id FROM user_accounts WHERE user_id = $1',
      [userId]
    );
    
    if (existingUser.rows.length > 0) {
      console.log(`User account already exists for user_id: ${userId}`);
      await client.query('ROLLBACK');
      return { exists: true };
    }
    
    // Create new user account with default balance of 1000
    await client.query(
      'INSERT INTO user_accounts (user_id, username, balance) VALUES ($1, $2, 1000.00)',
      [userId, username]
    );
    
    await client.query('COMMIT');
    console.log(`✅ Created user account: ${username} (ID: ${userId}) with balance $1000.00`);
    return { exists: false, created: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Function to deduct balance
async function deductBalance(userId, amount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Lock the row for update
    const result = await client.query(
      'SELECT balance FROM user_accounts WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    
    if (result.rows.length === 0) {
      throw new Error('User account not found');
    }
    
    const currentBalance = parseFloat(result.rows[0].balance);
    
    if (currentBalance < amount) {
      throw new Error('Insufficient balance');
    }
    
    // Deduct the amount
    await client.query(
      'UPDATE user_accounts SET balance = balance - $1, updated_at = now() WHERE user_id = $2',
      [amount, userId]
    );
    
    await client.query('COMMIT');
    
    const newBalance = currentBalance - amount;
    return { success: true, newBalance };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb, getUserBalance, deductBalance, createUserAccount };
