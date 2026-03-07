const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

async function testR2Connection() {
  try {
    const command = new ListBucketsCommand({});
    const response = await r2Client.send(command);
    console.log('✅ R2 connected successfully!');
    console.log('📦 Available buckets:', response.Buckets.map(b => b.Name));
  } catch (error) {
    console.error('❌ R2 connection failed:', error.message);
  }
}

testR2Connection();