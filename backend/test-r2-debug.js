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

async function debugR2() {
  console.log('🔍 Debugging R2 Connection...\n');
  
  console.log('📋 Configuration:');
  console.log('   Endpoint:', process.env.R2_ENDPOINT);
  console.log('   Access Key ID:', process.env.R2_ACCESS_KEY_ID ? '***' + process.env.R2_ACCESS_KEY_ID.slice(-4) : 'MISSING');
  console.log('   Bucket Name:', process.env.R2_BUCKET_NAME);
  console.log('');

  try {
    console.log('🔄 Testing ListBuckets...');
    const command = new ListBucketsCommand({});
    const response = await r2Client.send(command);
    
    console.log('✅ Connection successful!');
    console.log('📦 Available buckets:');
    response.Buckets.forEach(bucket => {
      console.log(`   - ${bucket.Name}`);
    });
    
    console.log('');
    const targetBucket = process.env.R2_BUCKET_NAME;
    const bucketExists = response.Buckets.some(b => b.Name === targetBucket);
    
    if (bucketExists) {
      console.log(`✅ Target bucket "${targetBucket}" found!`);
    } else {
      console.log(`❌ Target bucket "${targetBucket}" NOT found!`);
      console.log('   Make sure R2_BUCKET_NAME in .env matches exactly.');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('');
    console.error('💡 Possible causes:');
    console.error('   1. Wrong Access Key ID or Secret Access Key');
    console.error('   2. Token permissions insufficient');
    console.error('   3. Token not applied to this bucket');
    console.error('   4. Incorrect endpoint URL');
  }
}

debugR2();
