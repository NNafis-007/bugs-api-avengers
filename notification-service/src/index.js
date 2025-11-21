const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'notification-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const consumer = kafka.consumer({ groupId: 'notification-service-group' });

async function startConsumer() {
  const maxRetries = 30;
  const retryDelay = 2000;
  
  try {
    // Connect consumer
    await consumer.connect();
    console.log('🔔 Notification Service: Kafka consumer connected');

    // Retry subscription until topic is available
    let subscribed = false;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await consumer.subscribe({ topic: 'donation', fromBeginning: true });
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

    console.log('👂 Notification Service is now listening for donation events...\n');

    // Start consuming messages
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const donationData = JSON.parse(message.value.toString());
          const headers = message.headers;
          
          // Log the donation event
          console.log('╔════════════════════════════════════════════════════════╗');
          console.log('║         💰 NEW DONATION RECEIVED!                     ║');
          console.log('╚════════════════════════════════════════════════════════╝');
          console.log('');
          console.log('📋 Donation Details:');
          console.log('  • Donation ID:', donationData.donationId);
          console.log('  • Campaign ID:', donationData.campaignId);
          console.log('  • Amount:', `$${donationData.amount.toFixed(2)} ${donationData.currency}`);
          console.log('  • Donor Email:', donationData.userEmail);
          console.log('  • User ID:', donationData.userId);
          console.log('  • Status:', donationData.status);
          console.log('  • Timestamp:', donationData.timestamp);
          console.log('');
          console.log('📊 Message Metadata:');
          console.log('  • Topic:', topic);
          console.log('  • Partition:', partition);
          console.log('  • Offset:', message.offset);
          if (headers && headers['event-type']) {
            console.log('  • Event Type:', headers['event-type'].toString());
          }
          if (headers && headers['source']) {
            console.log('  • Source:', headers['source'].toString());
          }
          console.log('');
          console.log('✉️  [Notification System]');
          console.log('  → Email notification would be sent to:', donationData.userEmail);
          console.log('  → Thank you message for donation of $' + donationData.amount.toFixed(2));
          console.log('  → Campaign confirmation for Campaign #' + donationData.campaignId);
          console.log('');
          console.log('════════════════════════════════════════════════════════\n');
          
        } catch (error) {
          console.error('❌ Error processing donation message:', error);
          console.error('   Message value:', message.value.toString());
        }
      },
    });

  } catch (error) {
    console.error('❌ Error starting notification consumer:', error);
    process.exit(1);
  }
}

// Graceful shutdown
const errorTypes = ['unhandledRejection', 'uncaughtException'];
const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

errorTypes.forEach(type => {
  process.on(type, async (error) => {
    try {
      console.log(`\n⚠️  Process ${type}: ${error}`);
      await consumer.disconnect();
      console.log('👋 Consumer disconnected');
      process.exit(0);
    } catch (_) {
      process.exit(1);
    }
  });
});

signalTraps.forEach(type => {
  process.once(type, async () => {
    try {
      console.log(`\n📴 Received ${type}, disconnecting consumer...`);
      await consumer.disconnect();
      console.log('👋 Consumer disconnected gracefully');
    } finally {
      process.exit(0);
    }
  });
});

// Start the notification service
console.log('🚀 Starting Notification Service...');
startConsumer().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
