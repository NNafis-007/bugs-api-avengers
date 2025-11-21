const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'donation-service',
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
    
    if (!existingTopics.includes('donation')) {
      console.log('📝 Creating donation topic...');
      await admin.createTopics({
        topics: [{ topic: 'donation', numPartitions: 3, replicationFactor: 1 }],
        waitForLeaders: true
      });
      console.log('✅ Donation topic created');
    }
    
    await admin.disconnect();
    topicEnsured = true;
  } catch (error) {
    console.error('❌ Error ensuring donation topic exists:', error.message);
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

async function publishDonation(donationData) {
  try {
    await connectProducer();
    
    await producer.send({
      topic: 'donation',
      messages: [
        {
          key: donationData.donationId,
          value: JSON.stringify(donationData),
          headers: {
            'event-type': 'donation.created',
            'source': 'donation-service'
          }
        },
      ],
    });

    console.log('✅ Donation event published to Kafka:', {
      donationId: donationData.donationId,
      campaignId: donationData.campaignId,
      amount: donationData.amount,
      userEmail: donationData.userEmail
    });
  } catch (error) {
    console.error('❌ Failed to publish donation to Kafka:', error);
    throw error; // Re-throw to handle in the main service
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

module.exports = { publishDonation };
