const bcrypt = require('bcrypt');

async function generateHashes() {
  console.log('Generating password hashes...\n');
  console.log('='.repeat(80));
  console.log('\n');

  const users = {
    teacher: {
      email: 'teacher@test.com',
      password: 'Teacher123!'
    },
    student: {
      email: 'student@test.com',
      password: 'Student123!'
    },
    admin: {
      email: 'admin@test.com',
      password: 'Admin123!'
    },
    ivan: {
      email: 'ivanyzj-wp22@student.tarc.edu.my',
      password: 'TestTest123!'
    }
  };

  for (const [role, user] of Object.entries(users)) {
    const hash = await bcrypt.hash(user.password, 10);
    
    console.log(`${role.toUpperCase()}:`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Password: ${user.password}`);
    console.log(`  Hash: ${hash}`);
    console.log('');
    console.log(`  SQL INSERT:`);
    console.log(`  INSERT INTO users (full_name, email, password_hash, role, storage_quota, storage_used, is_active, account_status, created_at, failed_login_attempts)`);
    console.log(`  VALUES ('${role.charAt(0).toUpperCase() + role.slice(1)} User', '${user.email}', '${hash}', '${role === 'ivan' ? 'student' : role}', 1073741824, 0, true, 'active', CURRENT_TIMESTAMP, 0);`);
    console.log('');
    console.log('-'.repeat(80));
    console.log('');
  }

  console.log('\n✅ All hashes generated successfully!\n');
}

generateHashes();