const pool = require('../config/database');
const { 
  hasOverlap,
  checkUserScheduleConflict, 
  checkTeacherScheduleConflict, 
  checkVenueScheduleConflict 
} = require('../utils/scheduleMatcher');

async function runDeepTests() {
  console.log('🧪 Starting Deep Validation Tests...\n');

  try {
    // Helper to print result
    const logResult = (name, passed, detail = '') => {
      console.log(`${passed ? '✅' : '❌'} ${name} ${detail ? `- ${detail}` : ''}`);
    };

    // --- Scenario 1: Edge Cases (Time Arithmetic) ---
    console.log('--- 1. Time Arithmetic Edge Cases ---');
    
    // Back-to-Back (Exactly at the boundary)
    const b2b = hasOverlap('Mon 09:00-10:00', 'Mon 10:00-11:00');
    logResult('Back-to-Back (09:00-10:00 vs 10:00-11:00)', !b2b, '(Expected: No Overlap)');

    // 1-Minute Overlap
    const minOverlap = hasOverlap('Mon 09:00-10:00', 'Mon 09:59-11:00');
    logResult('1-Minute Overlap (09:00-10:00 vs 09:59-11:00)', minOverlap, '(Expected: Overlap)');

    // Fully Contained
    const contained = hasOverlap('Mon 08:00-12:00', 'Mon 09:00-10:00');
    logResult('Inside (08:00-12:00 vs 09:00-10:00)', contained, '(Expected: Overlap)');

    // --- Scenario 2: Multi-Day Logic ---
    console.log('\n--- 2. Multi-Day Schedule Logic ---');
    
    // Day Mismatch
    const dayMismatch = hasOverlap('Mon 10:00-11:00', 'Tue 10:00-11:00');
    logResult('Day Mismatch (Mon vs Tue)', !dayMismatch, '(Expected: No Overlap)');

    // Multi-day overlap
    const multiDayOverlap = hasOverlap('Mon, Wed, Fri 10:00-11:00', 'Wed 10:30-11:30');
    logResult('Multi-Day Intersection (Mon/Wed/Fri vs Wed)', multiDayOverlap, '(Expected: Overlap)');

    // --- Scenario 3: Complex Assistant/Owner Conflicts ---
    console.log('\n--- 3. Complex Cross-Teacher Validation ---');
    
    // Find an existing class and its owner/assistant
    const statesResult = await pool.query('SELECT teacher_user_id, state_json FROM teacher_classroom_states LIMIT 10');
    let complexScenarioFound = false;

    for (const row of statesResult.rows) {
      const ownerId = Number(row.teacher_user_id);
      const classroom = row.state_json.classrooms?.find(c => c.classSchedule && c.classSchedule !== '-');
      
      if (classroom) {
        const schedule = classroom.classSchedule;
        const className = classroom.classroomName || 'Class';
        
        console.log(`Analyzing: "${className}" at ${schedule} (Owner ID: ${ownerId})`);
        
        // Test 3.1: Owner Conflict Detection
        const ownerConflict = await checkTeacherScheduleConflict(ownerId, schedule, 99999, pool);
        logResult(`Owner Check for ${ownerId}`, ownerConflict.hasConflict, `Detected: ${ownerConflict.conflictingClassroomName}`);

        // Test 3.2: Assistant Check (simulation)
        // If we add Teacher X as an assistant to this class, they should be blocked from creating another class at this time
        const coTeachers = Array.isArray(classroom.coTeachers) ? classroom.coTeachers : [];
        if (coTeachers.length > 0) {
          const assistantId = Number(coTeachers[0].teacherUserId || coTeachers[0].userId || coTeachers[0].id);
          console.log(`Analyzing Assistant: ID ${assistantId}`);
          const assistantConflict = await checkTeacherScheduleConflict(assistantId, schedule, 99999, pool);
          logResult(`Assistant Check for ${assistantId}`, assistantConflict.hasConflict, `Detected: ${assistantConflict.conflictingClassroomName}`);
          complexScenarioFound = true;
        } else {
          console.log('Skipping Assistant test (none assigned to this sample class)');
        }
      }
    }

    // --- Scenario 4: Venue Density ---
    console.log('\n--- 4. Venue Conflict Deep Trace ---');
    const venuesResult = await pool.query('SELECT venue_id, name FROM venues LIMIT 1');
    if (venuesResult.rows.length > 0) {
      const venue = venuesResult.rows[0];
      // Check if this venue is occupied
      let occupiedClass = null;
      for (const row of statesResult.rows) {
        const cls = row.state_json.classrooms?.find(c => Number(c.venueId) === Number(venue.venue_id));
        if (cls) {
          occupiedClass = cls;
          break;
        }
      }

      if (occupiedClass) {
        console.log(`Venue "${venue.name}" is occupied by "${occupiedClass.classroomName}" at ${occupiedClass.classSchedule}`);
        const venueConflict = await checkVenueScheduleConflict(venue.venue_id, occupiedClass.classSchedule, 99999, pool);
        logResult(`Venue Conflict Detection`, venueConflict.hasConflict, `Detected: ${venueConflict.conflictingClassroomName}`);
      } else {
        console.log(`Venue "${venue.name}" is currently empty in the database. Creating dummy occupation test...`);
        // We rely on actual data as requested, so we'll just skip or find another if possible.
      }
    }

    console.log('\n✨ Deep validation completed.');

  } catch (err) {
    console.error('\n❌ Deep test execution failed:', err);
  } finally {
    await pool.end();
  }
}

runDeepTests();
