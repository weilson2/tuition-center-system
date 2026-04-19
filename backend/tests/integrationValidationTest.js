require('dotenv').config({ path: './backend/.env' });
const pool = require('../config/database');
const { getTeacherState, saveTeacherState } = require('../controllers/classroomController');

async function testIntegration() {
  console.log('Starting Integration Tests for Schedule Validation...');

  const teacherId = 9;
  const teacherId2 = 32;
  const studentId = 28;

  // Cleanup
  console.log('Cleaning up existing test data...');
  await pool.query('DELETE FROM teacher_classroom_states WHERE teacher_user_id IN ($1, $2)', [teacherId, teacherId2]);
  await pool.query('DELETE FROM user_enrollments WHERE user_id = $1', [studentId]);
  await pool.query("DELETE FROM classroom_activity_logs WHERE actor_user_id IN ($1, $2) OR details->>'studentUserId' = $3", [teacherId, teacherId2, String(studentId)]);

  // Mock Request and Response for Case 1: Create first class correctly
  const res1 = {
    status: (code) => {
      console.log(`Response status: ${code}`);
      return res1;
    },
    json: (data) => {
      console.log('Response JSON:', JSON.stringify(data, null, 2));
      return res1;
    }
  };

  const req1 = {
    user: { userId: teacherId, role: 'teacher', fullName: 'Test Teacher' },
    body: {
      operationType: 'general_save',
      state: {
        classrooms: [
          { classroomId: 100, classroomName: 'Class A', classSchedule: 'Mon 10:00-12:00', status: 'Active' }
        ]
      }
    }
  };

  console.log('\n--- Case 1: Creating first class (Mon 10:00-12:00) ---');
  await saveTeacherState(req1, res1);

  // Case 2: Create second class with conflict
  const req2 = {
    user: { userId: teacherId, role: 'teacher', fullName: 'Test Teacher' },
    body: {
      operationType: 'general_save',
      state: {
        classrooms: [
          { classroomId: 100, classroomName: 'Class A', classSchedule: 'Mon 10:00-12:00', status: 'Active' },
          { classroomId: 101, classroomName: 'Class B', classSchedule: 'Mon 11:00-13:00', status: 'Active' }
        ]
      }
    }
  };

  console.log('\n--- Case 2: Creating second class with Internal Conflict (Mon 11:00-13:00 overlaps A) ---');
  await saveTeacherState(req2, res1);

  // Case 3: Create second class with NO conflict (different day)
  const req3 = {
    user: { userId: teacherId, role: 'teacher', fullName: 'Test Teacher' },
    body: {
      operationType: 'general_save',
      state: {
        classrooms: [
          { classroomId: 100, classroomName: 'Class A', classSchedule: 'Mon 10:00-12:00', status: 'Active' },
          { classroomId: 102, classroomName: 'Class C', classSchedule: 'Tue 10:00-12:00', status: 'Active' }
        ]
      }
    }
  };

  console.log('\n--- Case 3: Creating second class with No Conflict (Tue 10:00-12:00) ---');
  await saveTeacherState(req3, res1);

  // Case 4: Student enrollment conflict
  // First, ensure student is enrolled in Class A
  console.log('\n--- Case 4a: Adding student 28 to Class A ---');
  const req4a = {
    user: { userId: teacherId, role: 'teacher', fullName: 'Test Teacher' },
    body: {
      operationType: 'student_list_managed',
      state: {
        classrooms: [
          { classroomId: 100, classroomName: 'Class A', classSchedule: 'Mon 10:00-12:00', status: 'Active' }
        ],
        studentsByClassroom: {
          '100': [{ studentId: studentId, name: 'Test Student' }]
        }
      }
    }
  };
  await saveTeacherState(req4a, res1);

  // Then, Teacher 32 tries to add the same student to a conflicting class D (Mon 11:00-13:00)
  console.log('\n--- Case 4b: Teacher 32 saves Class D first (Mon 11:00-13:00) ---');
  const req4b_1 = {
    user: { userId: 32, role: 'teacher', fullName: 'Another Teacher' },
    body: {
      operationType: 'general_save',
      state: {
        classrooms: [
          { classroomId: 103, classroomName: 'Class D', classSchedule: 'Mon 11:00-13:00', status: 'Active' }
        ]
      }
    }
  };
  await saveTeacherState(req4b_1, res1);

  console.log('\n--- Case 4b: Teacher 32 adds student 28 to Class D (SHOULD FAIL) ---');
  const req4b_2 = {
    user: { userId: 32, role: 'teacher', fullName: 'Another Teacher' },
    body: {
      operationType: 'student_list_managed',
      state: {
        classrooms: [
          { classroomId: 103, classroomName: 'Class D', classSchedule: 'Mon 11:00-13:00', status: 'Active' }
        ],
        studentsByClassroom: {
          '103': [{ studentId: studentId, name: 'Test Student' }]
        }
      }
    }
  };
  await saveTeacherState(req4b_2, res1);

  // Case 5: Student self-enrollment conflict via Join Code
  console.log('\n--- Case 5: Student 28 tries to JOIN Class D via code (SHOULD FAIL) ---');
  const { joinClassByCode } = require('../controllers/classroomController');
  
  // First, we need to ensure Class D has a join code and self-enrollment enabled
  const req5_setup = {
    user: { userId: 32, role: 'teacher', fullName: 'Another Teacher' },
    body: {
      operationType: 'general_save',
      state: {
        classrooms: [
          { classroomId: 103, classroomName: 'Class D', classSchedule: 'Mon 11:00-13:00', status: 'Active', joinCode: 'TEST103', selfEnrollmentEnabled: true }
        ]
      }
    }
  };
  await saveTeacherState(req5_setup, res1);

  const req5 = {
    user: { userId: studentId, role: 'student', fullName: 'Test Student' },
    body: { joinCode: 'TEST103' }
  };
  await joinClassByCode(req5, res1);

  console.log('\nIntegration tests completed. Check output above for success/failure.');
  process.exit(0);
}

testIntegration().catch(err => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
