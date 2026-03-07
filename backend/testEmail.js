require('dotenv').config();
const { testEmailConnection, sendPasswordResetEmail } = require('./services/emailService');

async function runTest() {
  console.log('\n🧪 Testing Email Configuration...\n');
  console.log('Email User:', process.env.EMAIL_USER);
  console.log('Email Password:', process.env.EMAIL_PASSWORD ? '✓ Set' : '✗ Not Set');
  console.log('');

  // Test connection
  console.log('Testing connection to email server...');
  const isConnected = await testEmailConnection();
  
  if (!isConnected) {
    console.log('\n❌ Email configuration failed!');
    console.log('\nPlease check:');
    console.log('1. EMAIL_USER is set in .env');
    console.log('2. EMAIL_PASSWORD is your Gmail App Password (16 characters)');
    console.log('3. 2-Step Verification is enabled on your Google account');
    console.log('4. You created an App Password at: https://myaccount.google.com/apppasswords');
    return;
  }

  console.log('\n✅ Email connection successful!\n');
  
  // Ask if user wants to send a test email
  const testEmail = process.argv[2];
  
  if (testEmail) {
    console.log(`Sending test password reset email to: ${testEmail}\n`);
    
    try {
      await sendPasswordResetEmail(
        testEmail, 
        'test-token-123456789', 
        'Test User'
      );
      console.log('\n✅ Test email sent successfully!');
      console.log(`📧 Check ${testEmail} for the password reset email.\n`);
    } catch (error) {
      console.log('\n❌ Failed to send test email:', error.message);
    }
  } else {
    console.log('To send a test email, run:');
    console.log('node testEmail.js your-email@example.com\n');
  }
}

runTest();