const { Kafka } = require('kafkajs');

// Environment variables are provided via docker-compose

const kafka = new Kafka({
  clientId: 'login-consumer',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const consumer = kafka.consumer({ groupId: 'login-consumer-group' });

async function startConsumer() {
  const maxRetries = 30;
  const retryDelay = 2000;
  
  try {
    // Connect consumer
    await consumer.connect();
    console.log('Kafka consumer connected');

    // Retry subscription until topic is available
    let subscribed = false;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await consumer.subscribe({ topic: 'Login', fromBeginning: true });
        console.log('Subscribed to Login topic');
        subscribed = true;
        break;
      } catch (error) {
        console.log(`Waiting for Login topic to be created... (attempt ${attempt}/${maxRetries})`);
        if (attempt === maxRetries) {
          throw new Error('Topic not available after maximum retries');
        }
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    if (!subscribed) {
      throw new Error('Failed to subscribe to Login topic');
    }

    // Start consuming messages
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const userData = JSON.parse(message.value.toString());
          
          // Log the registration event
          console.log('========================================');
          console.log('🎉 New User Registration Event Received!');
          console.log('========================================');
          console.log('Username:', userData.username);
          console.log('Email:', userData.email);
          console.log('Timestamp:', userData.timestamp);
          console.log('Topic:', topic);
          console.log('Partition:', partition);
          console.log('========================================\n');
          
        } catch (error) {
          console.error('Error processing message:', error);
        }
      },
    });

  } catch (error) {
    console.error('Error starting consumer:', error);
    process.exit(1);
  }
}

// Graceful shutdown
const errorTypes = ['unhandledRejection', 'uncaughtException'];
const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

errorTypes.forEach(type => {
  process.on(type, async (error) => {
    try {
      console.log(`Process ${type}: ${error}`);
      await consumer.disconnect();
      process.exit(0);
    } catch (_) {
      process.exit(1);
    }
  });
});

signalTraps.forEach(type => {
  process.once(type, async () => {
    try {
      console.log(`\nReceived ${type}, disconnecting consumer...`);
      await consumer.disconnect();
    } finally {
      process.exit(0);
    }
  });
});

// Start the consumer
startConsumer().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
