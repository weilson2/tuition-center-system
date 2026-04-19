const pool = require('../config/database');
const { 
  checkUserScheduleConflict, 
  checkTeacherScheduleConflict, 
  checkVenueScheduleConflict 
} = require('../utils/scheduleMatcher');

async function runTests() {
  console.log('🚀 Starting Conflict Validation Tests...\n');

  try {
    // 1. Data Setup (Finding existing data)
    const teachers = await pool.query("SELECT user_id, full_name FROM users WHERE role = 'teacher' LIMIT 2");
    const students = await pool.query("SELECT user_id, full_name FROM users WHERE role = 'student' LIMIT 2");
    const venues = await pool.query("SELECT venue_id, name FROM venues LIMIT 2");

    if (teachers.rows.length < 1 || students.rows.length < 1 || venues.rows.length < 1) {
      console.error('❌ Insufficient data to run tests. Need at least 1 teacher, 1 student, and 1 venue.');
      process.exit(1);
    }

    const teacherA = teachers.rows[0];
    const studentA = students.rows[0];
    const venueA = venues.rows[0];

    console.log(`Using Teacher: ${teacherA.full_name} (${teacherA.user_id})`);
    console.log(`Using Student: ${studentA.full_name} (${studentA.user_id})`);
    console.log(`Using Venue: ${venueA.name} (${venueA.venue_id})\n`);

    const states = await pool.query('SELECT teacher_user_id, state_json FROM teacher_classroom_states');

    // Scenario 1: Venue Conflict
    console.log('--- Test Case 1: Venue Conflict ---');
    let targetVenueClass = null;
    for (const row of states.rows) {
      const cls = row.state_json.classrooms?.find(c => c.venueId && c.classSchedule);
      if (cls) {
        targetVenueClass = cls;
        break;
      }
    }

    if (targetVenueClass) {
      console.log(`Found existing class "${targetVenueClass.classroomName}" at Venue ${targetVenueClass.venueId} with schedule ${targetVenueClass.classSchedule}`);
      const conflictResult = await checkVenueScheduleConflict(targetVenueClass.venueId, targetVenueClass.classSchedule, null, pool);
      if (conflictResult.hasConflict) {
        console.log('✅ PASS: Detected conflict for occupied venue.');
      } else {
        console.log('❌ FAIL: Failed to detect conflict for occupied venue.');
      }
    }

    // Scenario 2: Teacher/Assistant Conflict
    console.log('\n--- Test Case 2: Teacher Conflict ---');
    let busyTeacherClass = null;
    for (const row of states.rows) {
      const cls = row.state_json.classrooms?.find(c => c.classSchedule);
      if (cls) {
        busyTeacherClass = { teacherId: row.teacher_user_id, class: cls };
        break;
      }
    }

    if (busyTeacherClass) {
      console.log(`Teacher ${busyTeacherClass.teacherId} is busy at ${busyTeacherClass.class.classSchedule}`);
      const teacherConflict = await checkTeacherScheduleConflict(busyTeacherClass.teacherId, busyTeacherClass.class.classSchedule, null, pool);
      if (teacherConflict.hasConflict) {
        console.log('✅ PASS: Detected teacher schedule conflict.');
      } else {
        console.log('❌ FAIL: Failed to detect teacher schedule conflict.');
      }
    }

    // Scenario 3: Student Conflict (Self-Enrollment Case)
    console.log('\n--- Test Case 3: Self-Enrollment Conflict ---');
    const enrollmentsResult = await pool.query(`
      SELECT e.user_id, e.target_id 
      FROM user_enrollments e 
      WHERE e.target_type = 'classroom' AND e.enrollment_status = 'active'
      LIMIT 1
    `);

    if (enrollmentsResult.rows.length > 0) {
      const enrollment = enrollmentsResult.rows[0];
      const studentId = enrollment.user_id;
      const targetClassroomToJoinId = 99999; 
      const overlappingSchedule = 'Mon 00:00-23:59'; 
      
      console.log(`Simulating student ${studentId} attempting to self-enroll in a class with schedule ${overlappingSchedule}`);
      
      const selfEnrollConflict = await checkUserScheduleConflict(studentId, targetClassroomToJoinId, pool, overlappingSchedule);
      if (selfEnrollConflict.hasConflict) {
        console.log(`✅ PASS: Self-enrollment blocked due to conflict with "${selfEnrollConflict.conflictingClassroomName}"`);
      } else {
        console.log('❌ FAIL: Self-enrollment failed to detect conflict.');
      }
    }

    console.log('\n✨ Validation tests completed.');

  } catch (err) {
    console.error('\n❌ Test execution failed:', err);
  } finally {
    await pool.end();
  }
}

runTests();
