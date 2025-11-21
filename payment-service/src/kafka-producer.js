const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'payment-service-producer',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const producer = kafka.producer();
const admin = kafka.admin();

let isConnected = false;
let topicEnsured = false;

async function ensureTopicExists() {
  if (topicEnsured) return;
  
  try {
    await admin.connect();
    const existingTopics = await admin.listTopics();
    
    if (!existingTopics.includes('payment')) {
      console.log('📝 Creating payment topic...');
      await admin.createTopics({
        topics: [{ topic: 'payment', numPartitions: 3, replicationFactor: 1 }],
        waitForLeaders: true
      });
      console.log('✅ Payment topic created');
    }
    
    await admin.disconnect();
    topicEnsured = true;
  } catch (error) {
    console.error('❌ Error ensuring payment topic exists:', error.message);
    await admin.disconnect().catch(() => {});
    // Don't throw - let the producer retry
  }
}

async function connectProducer() {
  if (!isConnected) {
    await ensureTopicExists();
    await producer.connect();
    isConnected = true;
    console.log('Kafka producer connected');
  }
}

async function publishPaymentEvent(paymentData) {
  try {
    await connectProducer();
    
    await producer.send({
      topic: 'payment',
      messages: [
        {
          key: paymentData.donationId,
          value: JSON.stringify(paymentData),
          headers: {
            'event-type': paymentData.status === 'success' ? 'payment.success' : 'payment.failed',
            'source': 'payment-service'
          }
        },
      ],
    });

    console.log(`✅ Payment event published to Kafka: ${paymentData.status.toUpperCase()}`);
    console.log(`   Donation ID: ${paymentData.donationId}, Amount: $${paymentData.amount}`);
  } catch (error) {
    console.error('❌ Failed to publish payment event to Kafka:', error);
    throw error;
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  if (isConnected) {
    await producer.disconnect();
    console.log('Kafka producer disconnected');
  }
  process.exit(0);
});

module.exports = { publishPaymentEvent };
