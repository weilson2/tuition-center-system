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
 * Returns the schedule string from a classroom object, checking multiple field names.
 * @param {object} cls 
 * @returns {string}
 */
function getClassroomSchedule(cls) {
  if (!cls) return '';
  return String(cls.classSchedule || cls.schedule || '').trim();
}

/**
 * Parses a schedule string into a structured format for overlap logic.
 * Example input: "Mon, Tue 08:15-09:30"
 * @param {string} scheduleStr 
 * @returns {Array<{ day: number, startMin: number, endMin: number }>}
 */
function parseSchedule(scheduleStr) {
  const result = [];
  const normalized = String(scheduleStr || '').trim();
  if (!normalized || normalized === '-') return result;

  // Supports: "Mon 08:00-09:00", "Mon, Tue 08:00-09:30", "Mon 10:00-11:00; Wed 10:00-11:00"
  const segments = normalized.split(/;|\n/).filter(Boolean);

  for (const segment of segments) {
    const timeMatch = segment.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
    if (!timeMatch) continue;

    const startMin = parseTimePart(timeMatch[1]);
    const endMin = parseTimePart(timeMatch[2]);
    
    if (startMin === null || endMin === null) continue;

    const daysText = segment.replace(timeMatch[0], '').trim();
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
  }

  return result;
}

/**
 * Returns true if schedule A overlaps with schedule B.
 * @param {string} scheduleA
 * @param {string} scheduleB
 * @returns {boolean}
 */
function hasOverlap(scheduleA, scheduleB) {
  const normalizedA = String(scheduleA || '').trim();
  const normalizedB = String(scheduleB || '').trim();
  if (!normalizedA || normalizedA === '-' || !normalizedB || normalizedB === '-') return false;

  const parsedA = parseSchedule(normalizedA);
  const parsedB = parseSchedule(normalizedB);

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
 * @param {string} [targetSchedule] Optional: Use this schedule instead of fetching from DB (useful for pending updates)
 * @returns {Promise<{ hasConflict: boolean, conflictingClassroomName?: string }>}
 */
async function checkUserScheduleConflict(userId, targetClassroomId, pool, targetSchedule = null) {
  try {
    const teacherStateResult = await pool.query('SELECT state_json FROM teacher_classroom_states');
    
    let targetClassroom = null;
    const allExistingClassroomsMap = new Map();

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

    const effectiveTargetSchedule = targetSchedule || getClassroomSchedule(targetClassroom);
    if (!effectiveTargetSchedule) {
      return { hasConflict: false };
    }

    const enrollmentResult = await pool.query(
      `SELECT target_id 
       FROM user_enrollments 
       WHERE user_id = $1 
         AND target_type = 'classroom' 
         AND enrollment_status = 'active'`,
      [userId]
    );

    const enrolledIds = enrollmentResult.rows.map(r => Number(r.target_id));

    for (const enrolledId of enrolledIds) {
      if (enrolledId === Number(targetClassroomId)) continue;
      
      const enrolledClass = allExistingClassroomsMap.get(enrolledId);
      const enrolledSched = getClassroomSchedule(enrolledClass);
      if (enrolledSched) {
        if (hasOverlap(effectiveTargetSchedule, enrolledSched)) {
          return {
            hasConflict: true,
            conflictingClassroomName: enrolledClass.classroomName || enrolledClass.title || 'Another Class'
          };
        }
      }
    }

    return { hasConflict: false };
  } catch (error) {
    console.error('Error in checkUserScheduleConflict:', error);
    return { hasConflict: false };
  }
}

/**
 * Checks if a proposed classroom schedule conflicts with any of the teacher's existing classes (owner or co-teacher).
 * @param {number} teacherUserId 
 * @param {string} proposedSchedule The schedule they are trying to set ("Mon 08:15-10:00")
 * @param {number} currentClassroomId Optional: ID of class being updated (to ignore current class)
 * @param {Pool} pool Database pool to use for queries
 * @returns {Promise<{ hasConflict: boolean, conflictingClassroomName?: string }>}
 */
async function checkTeacherScheduleConflict(teacherUserId, proposedSchedule, currentClassroomId, pool) {
  try {
    if (!proposedSchedule || proposedSchedule === '-') return { hasConflict: false };

    const teacherStateResult = await pool.query('SELECT state_json, teacher_user_id FROM teacher_classroom_states');
    
    for (const row of teacherStateResult.rows || []) {
      const ownerTeacherId = Number(row.teacher_user_id);
      const clsList = Array.isArray(row?.state_json?.classrooms) ? row.state_json.classrooms : [];
      
      for (const cls of clsList) {
        const id = Number(cls.classroomId || cls.id);
        if (currentClassroomId && id === Number(currentClassroomId)) continue;
        
        const isOwner = ownerTeacherId === Number(teacherUserId);
        const coTeachers = Array.isArray(cls.coTeachers) ? cls.coTeachers : [];
        const isCoTeacher = coTeachers.some(t => Number(t.teacherUserId || t.userId || t.id) === Number(teacherUserId));

        if (isOwner || isCoTeacher) {
          const classSched = getClassroomSchedule(cls);
          if (classSched && hasOverlap(proposedSchedule, classSched)) {
            return {
              hasConflict: true,
              conflictingClassroomName: cls.classroomName || cls.title || 'Another Class'
            };
          }
        }
      }
    }

    return { hasConflict: false };
  } catch (error) {
    console.error('Error in checkTeacherScheduleConflict:', error);
    return { hasConflict: false };
  }
}

/**
 * Checks if a proposed classroom schedule conflicts with any other class assigned to the same venue.
 * @param {number} venueId 
 * @param {string} proposedSchedule 
 * @param {number} currentClassroomId Optional: ID of class being updated
 * @param {Pool} pool 
 * @returns {Promise<{ hasConflict: boolean, conflictingClassroomName?: string }>}
 */
async function checkVenueScheduleConflict(venueId, proposedSchedule, currentClassroomId, pool) {
  try {
    if (!venueId || !proposedSchedule || proposedSchedule === '-') return { hasConflict: false };

    const teacherStateResult = await pool.query('SELECT state_json FROM teacher_classroom_states');
    
    for (const row of teacherStateResult.rows || []) {
      const clsList = Array.isArray(row?.state_json?.classrooms) ? row.state_json.classrooms : [];
      
      for (const cls of clsList) {
        const id = Number(cls.classroomId || cls.id);
        if (currentClassroomId && id === Number(currentClassroomId)) continue;
        
        // Check if this class is assigned to the target venue
        if (Number(cls.venueId) === Number(venueId)) {
          const classSched = getClassroomSchedule(cls);
          if (classSched && hasOverlap(proposedSchedule, classSched)) {
            return {
              hasConflict: true,
              conflictingClassroomName: cls.classroomName || cls.title || 'Another Class'
            };
          }
        }
      }
    }

    return { hasConflict: false };
  } catch (error) {
    console.error('Error in checkVenueScheduleConflict:', error);
    return { hasConflict: false };
  }
}

module.exports = {
  parseSchedule,
  hasOverlap,
  checkUserScheduleConflict,
  checkTeacherScheduleConflict,
  checkVenueScheduleConflict,
  getClassroomSchedule
};

