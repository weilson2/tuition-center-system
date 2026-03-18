async function testJoinCapacity() {
  try {
    // We need a student token and a class code. 
    // I will use an existing user from the database and generate a token.
    const pg = require('pg');
    const pool = new pg.Pool({
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'tuition_center',
      password: process.env.DB_PASSWORD || 'password',
      port: process.env.DB_PORT || 5432,
    });
    
    // Find a class code with capacity
    const teacherStateResult = await pool.query(`SELECT teacher_user_id, state_json FROM teacher_classroom_states LIMIT 10`);
    let joinCode = null;
    let classroomId = null;
    for (const row of teacherStateResult.rows) {
      const state = row.state_json;
      if (state && Array.isArray(state.classrooms)) {
        for (const c of state.classrooms) {
          if (c.joinCode && c.selfEnrollmentEnabled) {
            joinCode = c.joinCode;
            classroomId = c.classroomId || c.id;
            console.log(`Found class: ${c.classroomName}, code: ${joinCode}, capacity: ${c.maximumCapacity}`);
            break;
          }
        }
      }
      if (joinCode) break;
    }
    
    if (!joinCode) {
      console.log("No self-enrollable class found");
      return;
    }
    
    // Find a student
    const studentResult = await pool.query(`SELECT user_id, email FROM users WHERE role = 'student' LIMIT 1`);
    if (studentResult.rows.length === 0) {
      console.log("No student found");
      return;
    }
    const student = studentResult.rows[0];
    
    // Generate token
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { userId: student.user_id, email: student.email, role: 'student' },
      process.env.JWT_SECRET || 'fallback_secret_for_development_only',
      { expiresIn: '1h' }
    );
    
    console.log(`Attempting to join class ${joinCode} as student ${student.email}`);
    
const response = await fetch('http://localhost:5000/api/student/classrooms/join', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ joinCode })
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }
    
    console.log('Join successful:', data);
    
  } catch (error) {
    console.error('Join failed:', error.message);
  }
}

testJoinCapacity();
