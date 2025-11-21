const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'payment-service-admin',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const admin = kafka.admin();

async function ensureTopicsExist() {
  try {
    await admin.connect();
    console.log('Kafka admin connected');

    const existingTopics = await admin.listTopics();
    console.log('Existing topics:', existingTopics);

    const requiredTopics = [
      { topic: 'donation', numPartitions: 3, replicationFactor: 1 },
      { topic: 'payment', numPartitions: 3, replicationFactor: 1 },
      { topic: 'Login', numPartitions: 3, replicationFactor: 1 }
    ];

    const topicsToCreate = requiredTopics.filter(
      t => !existingTopics.includes(t.topic)
    );

    if (topicsToCreate.length > 0) {
      console.log('Creating topics:', topicsToCreate.map(t => t.topic));
      await admin.createTopics({
        topics: topicsToCreate,
        waitForLeaders: true
      });
      console.log('✅ Topics created successfully');
    } else {
      console.log('✅ All required topics already exist');
    }

    await admin.disconnect();
  } catch (error) {
    console.error('❌ Error ensuring topics exist:', error);
    await admin.disconnect().catch(() => {});
    throw error;
  }
}

module.exports = { ensureTopicsExist };
