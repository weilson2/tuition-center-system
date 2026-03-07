require('dotenv').config();

console.log('🔍 Testing .env configuration...\n');

console.log('✅ Server Configuration:');
console.log('   PORT:', process.env.PORT);
console.log('   NODE_ENV:', process.env.NODE_ENV);

console.log('\n✅ Database:');
console.log('   DATABASE_URL:', process.env.DATABASE_URL ? '***configured***' : '❌ MISSING');

console.log('\n✅ JWT:');
console.log('   JWT_SECRET:', process.env.JWT_SECRET ? '***configured***' : '❌ MISSING');
console.log('   JWT_EXPIRES_IN:', process.env.JWT_EXPIRES_IN);

console.log('\n✅ Cloudflare R2:');
console.log('   R2_ACCOUNT_ID:', process.env.R2_ACCOUNT_ID || '❌ MISSING');
console.log('   R2_ACCESS_KEY_ID:', process.env.R2_ACCESS_KEY_ID ? '***configured***' : '❌ MISSING');
console.log('   R2_SECRET_ACCESS_KEY:', process.env.R2_SECRET_ACCESS_KEY ? '***configured***' : '❌ MISSING');
console.log('   R2_BUCKET_NAME:', process.env.R2_BUCKET_NAME || '❌ MISSING');
console.log('   R2_ENDPOINT:', process.env.R2_ENDPOINT || '❌ MISSING');

console.log('\n✅ CORS:');
console.log('   FRONTEND_URL:', process.env.FRONTEND_URL);