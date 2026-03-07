const pool = require('./config/database');

(async () => {
  try {
    const users = await pool.query(
      "SELECT user_id, full_name, email, role FROM users ORDER BY user_id"
    );
    console.log('USERS');
    console.log(users.rows);

    const states = await pool.query(
      `SELECT t.teacher_user_id, u.full_name, u.email, t.updated_at, t.state_json
       FROM teacher_classroom_states t
       JOIN users u ON u.user_id = t.teacher_user_id
       ORDER BY t.updated_at DESC`
    );

    console.log('\nTEACHER STATES SUMMARY');
    const summary = states.rows.map((row) => {
      const classrooms = Array.isArray(row.state_json?.classrooms) ? row.state_json.classrooms : [];
      return {
        teacher_user_id: row.teacher_user_id,
        full_name: row.full_name,
        email: row.email,
        updated_at: row.updated_at,
        classroom_count: classrooms.length,
        classroom_keys: classrooms[0] ? Object.keys(classrooms[0]) : []
      };
    });
    console.log(summary);

    if (states.rows.length > 0) {
      const first = states.rows[0];
      console.log('\nLATEST STATE CLASSROOMS');
      console.log(first.state_json?.classrooms || []);
    }
  } catch (error) {
    console.error(error);
  } finally {
    await pool.end();
  }
})();
