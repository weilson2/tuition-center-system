require('dotenv').config();
const pool = require('./config/database');

async function runTest() {
  console.log('--- STARTING SCHEDULE CONFLICT SMOKE TEST ---');
  let client;
  try {
    client = await pool.connect();
    
    // 1. Create a test student
    const studentRes = await client.query(`
      INSERT INTO users (email, full_name, role, account_status, is_active, password_hash, student_level, storage_quota)
      VALUES ('smoketest_student@test.com', 'Smoke Test Student', 'student', 'active', true, 'hashed', 'Standard 1', 536870912)
      RETURNING user_id
    `);
    const studentId = studentRes.rows[0].user_id;
    console.log(`✅ Created test student: ID ${studentId}`);

    // 2. Create a test teacher
    const teacherRes = await client.query(`
      INSERT INTO users (email, full_name, role, account_status, is_active, password_hash, storage_quota)
      VALUES ('smoketest_teacher@test.com', 'Smoke Test Teacher', 'teacher', 'active', true, 'hashed', 1073741824)
      RETURNING user_id
    `);
    const teacherId = teacherRes.rows[0].user_id;

    // 3. Create two conflicting classes in teacher_classroom_states
    const class1Id = Math.floor(Math.random() * 100000) + 10000;
    const class2Id = Math.floor(Math.random() * 100000) + 10000;

    const stateJson = {
      classrooms: [
        {
          id: class1Id,
          classroomId: class1Id,
          classroomName: 'Math (Mon 8-9)',
          classSchedule: 'Mon 08:00-09:00',
          maximumCapacity: 10,
          joinCode: `MATH${class1Id}`,
          selfEnrollmentEnabled: true,
          gradeLevel: 'Standard 1'
        },
        {
          id: class2Id,
          classroomId: class2Id,
          classroomName: 'Science (Mon 8:30-9:30)', // Conflicts with Math
          classSchedule: 'Mon, Tue 08:30-09:30',
          maximumCapacity: 10,
          joinCode: `SCI${class2Id}`,
          selfEnrollmentEnabled: true,
          gradeLevel: 'Standard 1'
        }
      ]
    };

    await client.query(`
      INSERT INTO teacher_classroom_states (teacher_user_id, state_json)
      VALUES ($1, $2)
    `, [teacherId, JSON.stringify(stateJson)]);
    console.log(`✅ Created 2 conflicting classes: Math (ID ${class1Id}) and Science (ID ${class2Id})`);

    // 4. Enroll student in class 1 initially
    await client.query(`
      INSERT INTO user_enrollments (user_id, target_type, target_id, enrollment_status)
      VALUES ($1, 'classroom', $2, 'active')
    `, [studentId, class1Id]);
    console.log(`✅ Pre-enrolled student in Math class`);

    // --- TEST 1: The utility function itself ---
    console.log(`\n--- TEST 1: The scheduleMatcher utility ---`);
    const { checkUserScheduleConflict } = require('./utils/scheduleMatcher');
    const utilityConflict = await checkUserScheduleConflict(studentId, class2Id, pool);
    if (utilityConflict.hasConflict) {
      console.log(`✅ Utility detects conflict with ${utilityConflict.conflictingClassroomName}`);
    } else {
      console.error(`❌ Utility failed to detect conflict!`);
    }

    // --- TEST 2: Controller endpoints logic via mocking req/res ---
    console.log(`\n--- TEST 2: Pre-check endpoint (/check-schedule-conflict) ---`);
    const { checkScheduleConflict } = require('./controllers/classroomController');
    
    let preCheckResStatus, preCheckResJson;
    const reqPreCheck = { body: { studentId: studentId, classroomId: class2Id } };
    const resPreCheck = {
      status: (code) => { preCheckResStatus = code; return resPreCheck; },
      json: (data) => { preCheckResJson = data; }
    };
    await checkScheduleConflict(reqPreCheck, resPreCheck);
    if (preCheckResJson?.hasConflict) {
      console.log(`✅ API Pre-check returned conflict: true, conflicting class: ${preCheckResJson.conflictingClassroomName}`);
    } else {
      console.error(`❌ API Pre-check failed to return conflict true!`);
    }

    // --- TEST 3: joinClassByCode endpoint ---
    console.log(`\n--- TEST 3: Join via Join Code ---`);
    const { joinClassByCode } = require('./controllers/classroomController');
    let joinResStatus, joinResJson;
    const reqJoin = { 
      user: { userId: studentId, role: 'student' }, 
      body: { joinCode: `SCI${class2Id}` } 
    };
    const resJoin = {
      status: (code) => { joinResStatus = code; return resJoin; },
      json: (data) => { joinResJson = data; }
    };
    await joinClassByCode(reqJoin, resJoin);
    if (joinResStatus === 409 && joinResJson?.error?.includes('You already have a class at this duration that conflicts with Math (Mon 8-9)')) {
       console.log(`✅ Join by code blocked! Message: "${joinResJson.error}"`);
    } else {
       console.error(`❌ Join by code allowed or returned unexpected error! Status: ${joinResStatus}, Error: ${joinResJson?.error}`);
    }

    // --- TEST 4: Admin Bulk Enroll endpoint ---
    console.log(`\n--- TEST 4: Admin Bulk Enroll endpoint ---`);
    const { enrollUsers } = require('./controllers/userManagementController');
    let enrollResStatus, enrollResJson;
    const reqEnroll = {
      user: { userId: 1, role: 'admin' }, // assume admin id 1
      ip: '127.0.0.1',
      headers: { 'user-agent': 'smoke test' },
      body: {
        userIds: [studentId],
        targetType: 'classroom',
        targetId: class2Id
      }
    };
    const resEnroll = {
      status: (code) => { enrollResStatus = code; return resEnroll; },
      json: (data) => { enrollResJson = data; }
    };
    
    // We expect it to succeed in completing the process, but the specific user enrollment to FAIL and be in the 'failed' list.
    await enrollUsers(reqEnroll, resEnroll);
    
    const failedStudent = enrollResJson?.failed?.find(f => f.userId === studentId);
    if (failedStudent && failedStudent.reason.includes('Schedule conflict')) {
      console.log(`✅ Admin bulk enroll properly skipped student! Reason: "${failedStudent.reason}"`);
    } else {
      console.error(`❌ Admin bulk enroll failed to stop conflict! Failed list: ${JSON.stringify(enrollResJson?.failed)}`);
    }


    // 5. Cleanup
    console.log(`\n--- CLEANUP ---`);
    await client.query(`DELETE FROM user_enrollments WHERE user_id = $1`, [studentId]);
    await client.query(`DELETE FROM teacher_classroom_states WHERE teacher_user_id = $1`, [teacherId]);
    await client.query(`DELETE FROM users WHERE email IN ('smoketest_student@test.com', 'smoketest_teacher@test.com')`);
    console.log(`✅ Deleted test records.`);
    
    console.log('\n--- SMOKE TEST COMPLETE ---');

  } catch (err) {
    console.error('Smoke test error:', err);
  } finally {
    if (client) client.release();
    pool.end();
  }
}

runTest();
