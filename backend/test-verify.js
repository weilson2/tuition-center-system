const pg = require('pg');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function run() {
  const result = await pool.query(`
    SELECT target_id as classroom_id, COUNT(*) as enrollments 
    FROM user_enrollments 
    WHERE target_type = 'classroom' AND enrollment_status = 'active'
    GROUP BY target_id
  `);
  console.log("Enrollment counts by classroom_id in user_enrollments:");
  console.log(result.rows);
  
  const teacherStates = await pool.query(`SELECT teacher_user_id, state_json FROM teacher_classroom_states`);
  teacherStates.rows.forEach(r => {
    console.log("Teacher:", r.teacher_user_id);
    const classes = Array.isArray(r.state_json.classrooms) ? r.state_json.classrooms : [];
    classes.forEach(c => {
       console.log(" Class ID:", c.classroomId, "Name:", c.classroomName, "Capacity:", c.maximumCapacity, "Type:", typeof c.maximumCapacity);
       const roster = r.state_json.studentsByClassroom?.[c.classroomId] || r.state_json.studentsByClassroom?.[String(c.classroomId)] || [];
       console.log("  Roster length:", roster.length);
    });
  });

  pool.end();
}

run();
