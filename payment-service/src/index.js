require('dotenv').config();
const { Kafka } = require('kafkajs');
const { initDb, getUserBalance, deductBalance, createUserAccount } = require('./db');
const { publishPaymentEvent } = require('./kafka-producer');
const { ensureTopicsExist } = require('./kafka-admin');

const kafka = new Kafka({
  clientId: 'payment-service-consumer',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const donationConsumer = kafka.consumer({ groupId: 'payment-service-group' });
const loginConsumer = kafka.consumer({ groupId: 'payment-service-login-group' });

// Process login event to create user account
async function processLoginEvent(loginData) {
  console.log('\n┌────────────────────────────────────────────────────────┐');
  console.log('│         👤 NEW USER REGISTRATION                    │');
  console.log('└────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('📋 User Details:');
  console.log('  • User ID:', loginData.id);
  console.log('  • Email:', loginData.email);
  console.log('  • Username:', loginData.username);
  console.log('');
  
  try {
    await createUserAccount(loginData.id, loginData.username, loginData.email);
  } catch (error) {
    console.error('❌ Error creating user account:', error.message);
  }
  
  console.log('════════════════════════════════════════════════════════\n');
}

// Initialize DB with retry
(async function ensureDb() {
  const maxAttempts = 30;
  const delay = ms => new Promise(r => setTimeout(r, ms));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await initDb();
      console.log('Payment DB initialized and seeded');
      break;
    } catch (err) {
      console.error(`Payment DB init failed (attempt ${attempt}/${maxAttempts}):`, err.message || err);
      if (attempt === maxAttempts) {
        console.error('Max attempts reached; continuing without guaranteed DB init.');
      } else {
        await delay(2000);
      }
    }
  }
})();

async function processLoginEvent(loginData) {
  console.log('\n┌────────────────────────────────────────────────────────┐');
  console.log('│         👤 NEW USER REGISTRATION                    │');
  console.log('└────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('📋 User Details:');
  console.log('  • User ID:', loginData.id);
  console.log('  • Email:', loginData.email);
  console.log('  • Username:', loginData.username);
  console.log('');
  
  try {
    await createUserAccount(loginData.id, loginData.username, loginData.email);
  } catch (error) {
    console.error('❌ Error creating user account:', error.message);
  }
  
  console.log('════════════════════════════════════════════════════════\n');
}

async function processDonation(donationData) {
  const { donationId, userId, userEmail, campaignId, amount, timestamp, idempotencyKey } = donationData;
  
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║         💳 PROCESSING PAYMENT                         ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('📋 Donation Details:');
  console.log('  • Donation ID:', donationId);
  console.log('  • User ID:', userId);
  console.log('  • User Email:', userEmail);
  console.log('  • Campaign ID:', campaignId);
  console.log('  • Amount:', `$${amount.toFixed(2)}`);
  console.log('  • Timestamp:', timestamp);
  console.log('');
  
  try {
    // Check user balance
    const balance = await getUserBalance(userId);
    
    if (balance === null) {
      console.log('❌ Payment Result: FAILED');
      console.log('   Reason: User account not found');
      console.log('   User ID:', userId);
      
      // Publish failure event
      await publishPaymentEvent({
        donationId,
        userId,
        userEmail,
        campaignId,
        amount,
        timestamp: new Date().toISOString(),
        status: 'failed',
        reason: 'User account not found',
        idempotencyKey
      });
      
      console.log('════════════════════════════════════════════════════════\n');
      return;
    }
    
    console.log('💰 Current Balance: $' + parseFloat(balance).toFixed(2));
    
    if (parseFloat(balance) < amount) {
      console.log('❌ Payment Result: FAILED');
      console.log('   Reason: Insufficient balance');
      console.log('   Required: $' + amount.toFixed(2));
      console.log('   Available: $' + parseFloat(balance).toFixed(2));
      console.log('   Shortfall: $' + (amount - parseFloat(balance)).toFixed(2));
      
      // Publish failure event
      await publishPaymentEvent({
        donationId,
        userId,
        userEmail,
        campaignId,
        amount,
        timestamp: new Date().toISOString(),
        status: 'failed',
        reason: 'Insufficient balance',
        currentBalance: parseFloat(balance),
        idempotencyKey
      });
      
      console.log('════════════════════════════════════════════════════════\n');
      return;
    }
    
    // Deduct balance
    console.log('⏳ Processing payment...');
    const result = await deductBalance(userId, amount);
    
    console.log('✅ Payment Result: SUCCESS');
    console.log('   Amount Deducted: $' + amount.toFixed(2));
    console.log('   New Balance: $' + result.newBalance.toFixed(2));
    
    // Publish success event
    await publishPaymentEvent({
      donationId,
      userId,
      userEmail,
      campaignId,
      amount,
      timestamp: new Date().toISOString(),
      status: 'success',
      previousBalance: parseFloat(balance),
      newBalance: result.newBalance,
      idempotencyKey
    });
    
    console.log('📤 Payment success event published to Kafka');
    console.log('   Campaign service will update total_amount_raised');
    
  } catch (error) {
    console.error('❌ Payment Result: ERROR');
    console.error('   Error:', error.message);
    
    // Publish failure event
    await publishPaymentEvent({
      donationId,
      userId,
      userEmail,
      campaignId,
      amount,
      timestamp: new Date().toISOString(),
      status: 'failed',
      reason: error.message,
      idempotencyKey
    });
  }
  
  console.log('════════════════════════════════════════════════════════\n');
}

async function startConsumer() {
  const maxRetries = 30;
  const retryDelay = 2000;
  
  try {
    // Connect consumer
    await donationConsumer.connect();
    console.log('💳 Payment Service: Kafka consumer connected');

    // Retry subscription until topic is available
    let subscribed = false;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await donationConsumer.subscribe({ topic: 'donation', fromBeginning: false });
        console.log('✅ Subscribed to donation topic');
        subscribed = true;
        break;
      } catch (error) {
        console.log(`⏳ Waiting for donation topic to be created... (attempt ${attempt}/${maxRetries})`);
        if (attempt === maxRetries) {
          throw new Error('Topic not available after maximum retries');
        }
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    if (!subscribed) {
      throw new Error('Failed to subscribe to donation topic');
    }

    console.log('👂 Payment Service is now listening for donation events...\n');

    // Start consuming messages
    await donationConsumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const donationData = JSON.parse(message.value.toString());
          await processDonation(donationData);
        } catch (error) {
          console.error('❌ Error processing donation message:', error);
          console.error('   Message value:', message.value.toString());
        }
      },
    });

  } catch (error) {
    console.error('❌ Error starting donation consumer:', error);
    process.exit(1);
  }
}

async function startLoginConsumer() {
  const maxRetries = 30;
  const retryDelay = 2000;
  
  try {
    // Connect login consumer
    await loginConsumer.connect();
    console.log('👤 Payment Service: Login consumer connected');

    // Retry subscription until topic is available
    let subscribed = false;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await loginConsumer.subscribe({ topic: 'Login', fromBeginning: false });
        console.log('✅ Subscribed to Login topic');
        subscribed = true;
        break;
      } catch (error) {
        console.log(`⌛ Waiting for Login topic to be created... (attempt ${attempt}/${maxRetries})`);
        if (attempt === maxRetries) {
          throw new Error('Login topic not available after maximum retries');
        }
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    if (!subscribed) {
      throw new Error('Failed to subscribe to Login topic');
    }

    console.log('👂 Payment Service is now listening for login events...\n');

    // Start consuming messages
    await loginConsumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const loginData = JSON.parse(message.value.toString());
          await processLoginEvent(loginData);
        } catch (error) {
          console.error('❌ Error processing login message:', error);
          console.error('   Message value:', message.value.toString());
        }
      },
    });

  } catch (error) {
    console.error('❌ Error starting login consumer:', error);
    // Don't exit - login consumer is not critical for payment processing
  }
}

// Graceful shutdown
const errorTypes = ['unhandledRejection', 'uncaughtException'];
const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

errorTypes.forEach(type => {
  process.on(type, async (error) => {
    try {
      console.log(`\n⚠️  Process ${type}: ${error}`);
      await Promise.all([
        donationConsumer.disconnect(),
        loginConsumer.disconnect()
      ]);
      console.log('👋 Consumers disconnected');
      process.exit(0);
    } catch (_) {
      process.exit(1);
    }
  });
});

signalTraps.forEach(type => {
  process.once(type, async () => {
    try {
      console.log(`\n📴 Received ${type}, disconnecting consumers...`);
      await Promise.all([
        donationConsumer.disconnect(),
        loginConsumer.disconnect()
      ]);
      console.log('👋 Consumers disconnected gracefully');
    } finally {
      process.exit(0);
    }
  });
});

// Start the payment service
console.log('🚀 Starting Payment Service...');

(async function startService() {
  try {
    // Ensure Kafka topics exist before subscribing
    await ensureTopicsExist();
    
    // Start both consumers
    await Promise.all([
      startConsumer(),
      startLoginConsumer()
    ]);
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
})();
