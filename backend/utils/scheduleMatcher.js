/**
 * scheduleMatcher.js
 * Utility to parse class schedules and detect overlapping times
 */

/**
 * Normalizes day names into standard short forms, or maps them to integers 0-6.
 */
const DAY_MAP = {
  'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6, 'sun': 0,
  'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6, 'sunday': 0
};

/**
 * Parses a time string 'HH:mm' into minutes from midnight.
 * e.g. "08:15" -> 8 * 60 + 15 = 495
 * @param {string} timeStr
 * @returns {number|null}
 */
function parseTimePart(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.trim().split(':');
  if (parts.length !== 2) return null;
  
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}

/**
 * Parses a schedule string into a structured format for overlap logic.
 * Example input: "Mon, Tue 08:15-09:30"
 * @param {string} scheduleStr 
 * @returns {Array<{ day: number, startMin: number, endMin: number }>}
 */
function parseSchedule(scheduleStr) {
  const result = [];
  if (!scheduleStr || typeof scheduleStr !== 'string') return result;

  // Split multiple schedules if separated by semicolons or something else
  // For now, looking at the UI, the standard format is "Mon, Tue 08:15-09:30"
  
  // 1) Extract time range from end of string
  const timeMatch = scheduleStr.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
  if (!timeMatch) return result;

  const startMin = parseTimePart(timeMatch[1]);
  const endMin = parseTimePart(timeMatch[2]);
  
  if (startMin === null || endMin === null) return result;

  // 2) Extract days (everything before the time part)
  const daysText = scheduleStr.replace(timeMatch[0], '').trim();
  const daysTokens = daysText.split(/[,\s]+/).filter(Boolean);

  for (const token of daysTokens) {
    const lowerToken = token.toLowerCase();
    if (DAY_MAP[lowerToken] !== undefined) {
      result.push({
        day: DAY_MAP[lowerToken],
        startMin,
        endMin
      });
    }
  }

  return result;
}

/**
 * Returns true if schedule A overlaps with schedule B.
 * @param {string} scheduleA "Mon 08:00-09:00"
 * @param {string} scheduleB "Mon, Tue 08:30-09:30"
 * @returns {boolean}
 */
function hasOverlap(scheduleA, scheduleB) {
  if (!scheduleA || !scheduleB) return false;

  const parsedA = parseSchedule(scheduleA);
  const parsedB = parseSchedule(scheduleB);

  for (const blockA of parsedA) {
    for (const blockB of parsedB) {
      if (blockA.day === blockB.day) {
        // Overlap if (StartA < EndB) and (StartB < EndA)
        if (blockA.startMin < blockB.endMin && blockB.startMin < blockA.endMin) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Checks if a proposed classroom schedule conflicts with any of the user's existing active enrollments.
 * @param {number} userId 
 * @param {number} targetClassroomId 
 * @param {Pool} pool Database pool to use for queries
 * @returns {Promise<{ hasConflict: boolean, conflictingClassroomName?: string }>}
 */
async function checkUserScheduleConflict(userId, targetClassroomId, pool) {
  try {
    // 1) Get the schedule of the classroom they are trying to join
    const teacherStateResult = await pool.query('SELECT state_json FROM teacher_classroom_states');
    
    let targetClassroom = null;
    const allExistingClassroomsMap = new Map(); // Keep track of all classrooms

    // Parse all states to find the target and collect classrooms
    for (const row of teacherStateResult.rows || []) {
      const clsList = Array.isArray(row?.state_json?.classrooms) ? row.state_json.classrooms : [];
      for (const cls of clsList) {
        const id = Number(cls.classroomId || cls.id);
        if (Number.isInteger(id)) {
          allExistingClassroomsMap.set(id, cls);
          if (id === Number(targetClassroomId)) {
            targetClassroom = cls;
          }
        }
      }
    }

    if (!targetClassroom || !targetClassroom.classSchedule) {
      // If the target class doesn't exist or doesn't have a schedule, no conflict is possible
      return { hasConflict: false };
    }

    // 2) Get the user's currently enrolled active classes
    const enrollmentResult = await pool.query(
      `SELECT target_id 
       FROM user_enrollments 
       WHERE user_id = $1 
         AND target_type = 'classroom' 
         AND enrollment_status = 'active'`,
      [userId]
    );

    const enrolledIds = enrollmentResult.rows.map(r => Number(r.target_id));

    // 3) Check for overlaps against all enrolled classes
    for (const enrolledId of enrolledIds) {
      if (enrolledId === Number(targetClassroomId)) continue; // Joining the same class again (handled elsewhere)
      
      const enrolledClass = allExistingClassroomsMap.get(enrolledId);
      if (enrolledClass && enrolledClass.classSchedule) {
        if (hasOverlap(targetClassroom.classSchedule, enrolledClass.classSchedule)) {
          return {
            hasConflict: true,
            conflictingClassroomName: enrolledClass.classroomName || 'Another Class'
          };
        }
      }
    }

    return { hasConflict: false };
  } catch (error) {
    console.error('Error in checkUserScheduleConflict:', error);
    // On error, default to allowing it to avoid completely locking users out of system
    return { hasConflict: false };
  }
}

module.exports = {
  parseSchedule,
  hasOverlap,
  checkUserScheduleConflict
};
