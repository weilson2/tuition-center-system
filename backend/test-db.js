const pg = require('pg');

const pool = new pg.Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || '127.0.0.1',
  database: process.env.DB_NAME || 'tuition_center',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
});

async function run() {
  const result = await pool.query('SELECT state_json FROM teacher_classroom_states LIMIT 5');
  for (const row of result.rows) {
    if (row.state_json && Array.isArray(row.state_json.classrooms)) {
      for (const classroom of row.state_json.classrooms) {
        const rosterKey = String(classroom.classroomId || classroom.id);
        const roster = row.state_json.studentsByClassroom?.[rosterKey] || row.state_json.studentsByClassroom?.[classroom.classroomId] || [];
        
        console.log('Classroom config:', {
          name: classroom.classroomName,
          capacity: classroom.maximumCapacity,
          rosterLength: roster.length,
          rosterObj: roster
        });
      }
    }
  }
  pool.end();
}

run();
