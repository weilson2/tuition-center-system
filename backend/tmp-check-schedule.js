require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool();

async function run() {
  try {
    const result = await pool.query('SELECT state_json FROM teacher_classroom_states');
    const schedules = [];
    result.rows.forEach(r => {
      const classes = Array.isArray(r.state_json.classrooms) ? r.state_json.classrooms : [];
      classes.forEach(c => {
        if (c.classSchedule) schedules.push(c.classSchedule);
      });
    });
    console.log("Unique Schedules:", [...new Set(schedules)]);
  } catch (error) {
    console.error(error);
  } finally {
    pool.end();
  }
}
run();
