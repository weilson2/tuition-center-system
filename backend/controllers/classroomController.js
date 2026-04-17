const pool = require('../config/database');
const { checkUserScheduleConflict, checkTeacherScheduleConflict, checkVenueScheduleConflict, hasOverlap, getClassroomSchedule } = require('../utils/scheduleMatcher');

let ensuredTables = false;

async function ensureClassroomTables() {
  if (ensuredTables) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS teacher_classroom_states (
      teacher_user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
      state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS classroom_assignment_submissions (
      submission_id SERIAL PRIMARY KEY,
      student_user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      classroom_id INTEGER NOT NULL,
      assignment_id INTEGER NOT NULL,
      file_id INTEGER REFERENCES files(file_id) ON DELETE SET NULL,
      file_name TEXT NOT NULL,
      file_size VARCHAR(50),
      comment TEXT,
      submission_status VARCHAR(30) NOT NULL DEFAULT 'submitted',
      grade NUMERIC(6,2),
      feedback TEXT,
      submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_user_id, classroom_id, assignment_id)
    )
  `);

  await pool.query(`
    ALTER TABLE classroom_assignment_submissions
    ADD COLUMN IF NOT EXISTS file_id INTEGER REFERENCES files(file_id) ON DELETE SET NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS classroom_activity_logs (
      log_id SERIAL PRIMARY KEY,
      actor_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      actor_role VARCHAR(30),
      operation_type VARCHAR(100) NOT NULL,
      operation_label VARCHAR(120) NOT NULL,
      target TEXT,
      target_type VARCHAR(50),
      status VARCHAR(20) NOT NULL DEFAULT 'success',
      details JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS classroom_announcements (
      announcement_id SERIAL PRIMARY KEY,
      classroom_id INTEGER NOT NULL,
      classroom_name TEXT,
      message TEXT NOT NULL,
      author_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      author_name TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS teacher_title VARCHAR(5)
  `);

  ensuredTables = true;
}

async function ensureEnrollmentTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_enrollments (
      enrollment_id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      target_type VARCHAR(20) NOT NULL,
      target_id INTEGER NOT NULL,
      enrollment_status VARCHAR(20) NOT NULL DEFAULT 'active',
      enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      enrolled_by INTEGER REFERENCES users(user_id),
      UNIQUE(user_id, target_type, target_id)
    )
  `);
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeClassroomStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'archived') {
    return 'Archived';
  }
  if (normalized === 'draft') {
    return 'Draft';
  }
  return 'Active';
}

function shouldAutoArchiveClassroom(classroom, todayKey) {
  const status = normalizeClassroomStatus(classroom?.status);
  if (status === 'Archived') {
    return false;
  }

  const endDateKey = toIsoDate(classroom?.endDate);
  if (!endDateKey) {
    return false;
  }

  return endDateKey < todayKey;
}

function normalizeLevel(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isAllLevelClassroom(level) {
  const normalized = normalizeLevel(level);
  return normalized === 'all level' || normalized === 'all levels';
}

function isStudentLevelAllowedForClassroom(studentLevel, classroomLevel) {
  if (!normalizeLevel(classroomLevel)) {
    return true;
  }
  if (isAllLevelClassroom(classroomLevel)) {
    return true;
  }
  return normalizeLevel(studentLevel) === normalizeLevel(classroomLevel);
}

function toPositiveIntegerFromCandidates(...candidates) {
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function normalizeTeacherState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    classrooms: Array.isArray(source.classrooms) ? source.classrooms : [],
    materialsByClassroom: source.materialsByClassroom && typeof source.materialsByClassroom === 'object' ? source.materialsByClassroom : {},
    assignmentsByClassroom: source.assignmentsByClassroom && typeof source.assignmentsByClassroom === 'object' ? source.assignmentsByClassroom : {},
    studentsByClassroom: source.studentsByClassroom && typeof source.studentsByClassroom === 'object' ? source.studentsByClassroom : {},
    gradingSubmissionsByAssignment: source.gradingSubmissionsByAssignment && typeof source.gradingSubmissionsByAssignment === 'object' ? source.gradingSubmissionsByAssignment : {},
    attendanceRecordsByClassroom: source.attendanceRecordsByClassroom && typeof source.attendanceRecordsByClassroom === 'object' ? source.attendanceRecordsByClassroom : {},
    attendanceStudentStatsByClassroom: source.attendanceStudentStatsByClassroom && typeof source.attendanceStudentStatsByClassroom === 'object' ? source.attendanceStudentStatsByClassroom : {},
    attendanceDetailByClassroom: source.attendanceDetailByClassroom && typeof source.attendanceDetailByClassroom === 'object' ? source.attendanceDetailByClassroom : {},
    archivedClassrooms: Array.isArray(source.archivedClassrooms) ? source.archivedClassrooms : []
  };
}

function getUniqueStudentCountFromRoster(roster) {
  if (!Array.isArray(roster)) {
    return 0;
  }

  const studentIds = new Set();
  roster.forEach((entry) => {
    const studentId = Number(entry?.studentId || entry?.userId || entry?.id);
    if (Number.isInteger(studentId) && studentId > 0) {
      studentIds.add(studentId);
    }
  });

  return studentIds.size;
}

const ARCHIVED_CLASS_RETENTION_DAYS = 90;
const ARCHIVED_CLASS_RETENTION_MS = ARCHIVED_CLASS_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function toTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function normalizeArchivedEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const classroomId = Number(entry.classroomId || entry.classroom?.classroomId || entry.classroom?.id);
  const ownerTeacherId = Number(entry.ownerTeacherId || entry.classroom?.ownerTeacherId);
  if (!Number.isInteger(classroomId) || classroomId <= 0 || !Number.isInteger(ownerTeacherId) || ownerTeacherId <= 0) {
    return null;
  }

  const archivedAt = entry.archivedAt || new Date().toISOString();
  const lastActionAt = entry.lastActionAt || archivedAt;
  const expiresAt = entry.expiresAt || new Date(toTimestamp(lastActionAt) + ARCHIVED_CLASS_RETENTION_MS).toISOString();

  return {
    archiveId: String(entry.archiveId || `${ownerTeacherId}:${classroomId}`),
    classroomId,
    ownerTeacherId,
    ownerTeacherName: String(entry.ownerTeacherName || entry.classroom?.ownerTeacherName || `Teacher ${ownerTeacherId}`),
    classroom: entry.classroom && typeof entry.classroom === 'object' ? entry.classroom : {},
    snapshot: entry.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot : {},
    archivedAt,
    lastActionAt,
    expiresAt
  };
}

function collectClassroomSnapshot(state, classroomId) {
  const key = String(classroomId);
  const assignments = state.assignmentsByClassroom?.[key] || state.assignmentsByClassroom?.[classroomId] || [];
  const assignmentIds = new Set(
    (Array.isArray(assignments) ? assignments : [])
      .map((assignment, index) => toPositiveIntegerFromCandidates(assignment?.id, assignment?.assignmentId, index + 1))
      .filter((value) => Number.isInteger(value) && value > 0)
      .map((value) => String(value))
  );

  const gradingSubmissionsByAssignment = {};
  Object.entries(state.gradingSubmissionsByAssignment || {}).forEach(([assignmentKey, rows]) => {
    if (!assignmentIds.has(String(assignmentKey)) || !Array.isArray(rows)) {
      return;
    }

    const classRows = rows.filter((row) => Number(row?.classroomId) === Number(classroomId));
    if (classRows.length > 0) {
      gradingSubmissionsByAssignment[String(assignmentKey)] = classRows;
    }
  });

  return {
    materialsByClassroom: state.materialsByClassroom?.[key] || state.materialsByClassroom?.[classroomId] || [],
    assignmentsByClassroom: assignments,
    studentsByClassroom: state.studentsByClassroom?.[key] || state.studentsByClassroom?.[classroomId] || [],
    attendanceRecordsByClassroom: state.attendanceRecordsByClassroom?.[key] || state.attendanceRecordsByClassroom?.[classroomId] || {},
    attendanceStudentStatsByClassroom: state.attendanceStudentStatsByClassroom?.[key] || state.attendanceStudentStatsByClassroom?.[classroomId] || {},
    attendanceDetailByClassroom: state.attendanceDetailByClassroom?.[key] || state.attendanceDetailByClassroom?.[classroomId] || {},
    gradingSubmissionsByAssignment
  };
}

function removeClassroomDataFromState(state, classroomId) {
  const key = String(classroomId);
  if (state.materialsByClassroom && typeof state.materialsByClassroom === 'object') {
    delete state.materialsByClassroom[key];
    delete state.materialsByClassroom[classroomId];
  }
  if (state.assignmentsByClassroom && typeof state.assignmentsByClassroom === 'object') {
    delete state.assignmentsByClassroom[key];
    delete state.assignmentsByClassroom[classroomId];
  }
  if (state.studentsByClassroom && typeof state.studentsByClassroom === 'object') {
    delete state.studentsByClassroom[key];
    delete state.studentsByClassroom[classroomId];
  }
  if (state.attendanceRecordsByClassroom && typeof state.attendanceRecordsByClassroom === 'object') {
    delete state.attendanceRecordsByClassroom[key];
    delete state.attendanceRecordsByClassroom[classroomId];
  }
  if (state.attendanceStudentStatsByClassroom && typeof state.attendanceStudentStatsByClassroom === 'object') {
    delete state.attendanceStudentStatsByClassroom[key];
    delete state.attendanceStudentStatsByClassroom[classroomId];
  }
  if (state.attendanceDetailByClassroom && typeof state.attendanceDetailByClassroom === 'object') {
    delete state.attendanceDetailByClassroom[key];
    delete state.attendanceDetailByClassroom[classroomId];
  }

  Object.keys(state.gradingSubmissionsByAssignment || {}).forEach((assignmentKey) => {
    const rows = state.gradingSubmissionsByAssignment?.[assignmentKey];
    if (!Array.isArray(rows)) {
      return;
    }

    const remainingRows = rows.filter((row) => Number(row?.classroomId) !== Number(classroomId));
    if (remainingRows.length > 0) {
      state.gradingSubmissionsByAssignment[assignmentKey] = remainingRows;
      return;
    }

    delete state.gradingSubmissionsByAssignment[assignmentKey];
  });
}

function syncArchivedClassroomFolder(state, ownerTeacherId, ownerTeacherName, nowIso) {
  const nowMs = Date.now();
  const archivedMap = new Map();

  (Array.isArray(state.archivedClassrooms) ? state.archivedClassrooms : []).forEach((entry) => {
    const normalizedEntry = normalizeArchivedEntry(entry);
    if (!normalizedEntry) {
      return;
    }

    const entryKey = `${normalizedEntry.ownerTeacherId}:${normalizedEntry.classroomId}`;
    archivedMap.set(entryKey, normalizedEntry);
  });

  const activeClassroomIds = new Set();
  (Array.isArray(state.classrooms) ? state.classrooms : []).forEach((classroom) => {
    const classroomId = Number(classroom?.classroomId || classroom?.id);
    const classroomOwnerTeacherId = Number(classroom?.ownerTeacherId || ownerTeacherId);
    if (!Number.isInteger(classroomId) || classroomId <= 0 || classroomOwnerTeacherId !== Number(ownerTeacherId)) {
      return;
    }

    const status = normalizeClassroomStatus(classroom?.status);
    const entryKey = `${classroomOwnerTeacherId}:${classroomId}`;
    if (status === 'Archived') {
      const existingEntry = archivedMap.get(entryKey);
      const archivedAt = existingEntry?.archivedAt || nowIso;
      const lastActionAt = existingEntry?.lastActionAt || archivedAt;
      const expiresAt = new Date((toTimestamp(lastActionAt) || nowMs) + ARCHIVED_CLASS_RETENTION_MS).toISOString();

      archivedMap.set(entryKey, {
        archiveId: existingEntry?.archiveId || entryKey,
        classroomId,
        ownerTeacherId: classroomOwnerTeacherId,
        ownerTeacherName: String(classroom?.ownerTeacherName || ownerTeacherName || `Teacher ${classroomOwnerTeacherId}`),
        classroom: {
          ...classroom,
          status: 'Archived'
        },
        snapshot: collectClassroomSnapshot(state, classroomId),
        archivedAt,
        lastActionAt,
        expiresAt
      });
      return;
    }

    activeClassroomIds.add(classroomId);
    archivedMap.delete(entryKey);
  });

  const nextArchivedEntries = [];
  archivedMap.forEach((entry) => {
    const entryTs = toTimestamp(entry.lastActionAt) || toTimestamp(entry.archivedAt) || nowMs;
    const expired = (nowMs - entryTs) >= ARCHIVED_CLASS_RETENTION_MS;
    if (expired) {
      state.classrooms = (Array.isArray(state.classrooms) ? state.classrooms : []).filter((classroom) => {
        const classroomId = Number(classroom?.classroomId || classroom?.id);
        const classroomOwnerTeacherId = Number(classroom?.ownerTeacherId || ownerTeacherId);
        return !(classroomId === entry.classroomId && classroomOwnerTeacherId === entry.ownerTeacherId);
      });
      removeClassroomDataFromState(state, entry.classroomId);
      return;
    }

    if (!activeClassroomIds.has(entry.classroomId)) {
      nextArchivedEntries.push(entry);
    }
  });

  state.archivedClassrooms = nextArchivedEntries;
}

function normalizeTeacherTitle(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'mr') {
    return 'Mr';
  }
  if (normalized === 'ms') {
    return 'Ms';
  }
  return '';
}

function formatAnnouncementAuthorName(fullName, teacherTitle) {
  const safeName = String(fullName || '').trim().replace(/^(mr|ms)\.?\s+/i, '') || 'Teacher';
  const normalizedTitle = normalizeTeacherTitle(teacherTitle);
  return normalizedTitle ? `${normalizedTitle} ${safeName}` : safeName;
}

function normalizeTeacherAccessRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'teacher') {
    return 'teacher';
  }
  return 'student';
}

function normalizeClassroomCoTeachers(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  const seen = new Set();
  const result = [];
  list.forEach((entry) => {
    const teacherUserId = Number(entry?.teacherUserId || entry?.userId || entry?.id);
    if (!Number.isInteger(teacherUserId) || teacherUserId <= 0 || seen.has(teacherUserId)) {
      return;
    }

    seen.add(teacherUserId);
    result.push({
      teacherUserId,
      name: String(entry?.name || `Teacher ${teacherUserId}`),
      email: String(entry?.email || ''),
      profilePictureUrl: entry?.profilePictureUrl || null,
      accessRole: normalizeTeacherAccessRole(entry?.accessRole)
    });
  });

  return result;
}

async function appendClassroomLog({
  actorUserId,
  actorRole,
  operationType,
  operationLabel,
  target,
  targetType,
  status = 'success',
  details = null
}) {
  await pool.query(
    `INSERT INTO classroom_activity_logs
     (actor_user_id, actor_role, operation_type, operation_label, target, target_type, status, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      actorUserId || null,
      actorRole || null,
      operationType,
      operationLabel,
      target || null,
      targetType || null,
      status,
      details ? JSON.stringify(details) : null
    ]
  );
}

async function getTeacherState(req, res) {
  try {
    await ensureClassroomTables();

    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Teacher access required' });
    }

    const teacherUserId = req.user.userId;
    const result = await pool.query(
      'SELECT state_json, updated_at FROM teacher_classroom_states WHERE teacher_user_id = $1',
      [teacherUserId]
    );

    if (result.rows.length === 0) {
      const emptyState = normalizeTeacherState({});
      await pool.query(
        `INSERT INTO teacher_classroom_states (teacher_user_id, state_json)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (teacher_user_id)
         DO NOTHING`,
        [teacherUserId, JSON.stringify(emptyState)]
      );

      return res.json({ state: emptyState, updatedAt: null });
    }

    const row = result.rows[0];
    const state = normalizeTeacherState(row.state_json);
    const todayKey = getLocalDateKey();
    let shouldPersistCurrentTeacherState = false;

    state.classrooms = (Array.isArray(state.classrooms) ? state.classrooms : []).map((classroom) => {
      const parsedOwnerTeacherId = Number(classroom?.ownerTeacherId);
      const hasExplicitOwnerTeacherId = Number.isInteger(parsedOwnerTeacherId) && parsedOwnerTeacherId > 0;
      const ownerTeacherId = hasExplicitOwnerTeacherId ? parsedOwnerTeacherId : teacherUserId;
      const normalizedClassroom = {
        ...classroom,
        ownerTeacherId: Number.isInteger(ownerTeacherId) && ownerTeacherId > 0 ? ownerTeacherId : teacherUserId,
        ownerTeacherName: String(classroom?.ownerTeacherName || req.user.fullName || 'Teacher'),
        ownerProfilePictureUrl: classroom?.ownerProfilePictureUrl || (Number(ownerTeacherId) === Number(teacherUserId) ? (req.user.profilePictureUrl || null) : null),
        status: normalizeClassroomStatus(classroom?.status),
        coTeachers: normalizeClassroomCoTeachers(classroom?.coTeachers),
        assistantAccessRole: 'owner',
        isSharedClassroom: false,
        _ownerExplicit: hasExplicitOwnerTeacherId
      };

      if (shouldAutoArchiveClassroom(normalizedClassroom, todayKey)) {
        shouldPersistCurrentTeacherState = true;
        return {
          ...normalizedClassroom,
          status: 'Archived',
          updatedAt: new Date().toISOString()
        };
      }

      return normalizedClassroom;
    }).filter((classroom) => {
      if (!classroom?._ownerExplicit) {
        return true;
      }

      return Number(classroom.ownerTeacherId) === Number(teacherUserId);
    });

    {
      const beforeSync = JSON.stringify(state);
      syncArchivedClassroomFolder(
        state,
        teacherUserId,
        String(req.user.fullName || 'Teacher'),
        new Date().toISOString()
      );
      if (beforeSync !== JSON.stringify(state)) {
        shouldPersistCurrentTeacherState = true;
      }
    }

    const seenClassroomIds = new Set(
      state.classrooms
        .filter((classroom) => Boolean(classroom?._ownerExplicit))
        .map((classroom) => Number(classroom?.classroomId || classroom?.id))
        .filter((value) => Number.isInteger(value) && value > 0)
    );

    const sharedTeacherStateRows = await pool.query(
      `SELECT
        tcs.teacher_user_id,
        tcs.state_json,
        u.full_name AS owner_name,
        u.teacher_title AS owner_teacher_title,
        u.profile_picture_url AS owner_profile_picture_url
       FROM teacher_classroom_states tcs
       JOIN users u ON u.user_id = tcs.teacher_user_id
       WHERE tcs.teacher_user_id <> $1
         AND u.role = 'teacher'`,
      [teacherUserId]
    );

    for (const sharedRow of sharedTeacherStateRows.rows) {
      const ownerTeacherId = Number(sharedRow.teacher_user_id);
      if (!Number.isInteger(ownerTeacherId) || ownerTeacherId <= 0) {
        continue;
      }

      const ownerState = normalizeTeacherState(sharedRow.state_json);
      let shouldPersistOwnerState = false;
      const ownerClassrooms = (Array.isArray(ownerState.classrooms) ? ownerState.classrooms : []).map((classroom) => {
        const normalizedClassroom = {
          ...classroom,
          status: normalizeClassroomStatus(classroom?.status)
        };

        if (shouldAutoArchiveClassroom(normalizedClassroom, todayKey)) {
          shouldPersistOwnerState = true;
          return {
            ...normalizedClassroom,
            status: 'Archived',
            updatedAt: new Date().toISOString()
          };
        }

        return normalizedClassroom;
      });

      if (shouldPersistOwnerState) {
        ownerState.classrooms = ownerClassrooms;
      } else {
        ownerState.classrooms = ownerClassrooms;
      }

      {
        const beforeOwnerSync = JSON.stringify(ownerState);
        syncArchivedClassroomFolder(
          ownerState,
          ownerTeacherId,
          formatAnnouncementAuthorName(sharedRow.owner_name, sharedRow.owner_teacher_title),
          new Date().toISOString()
        );
        if (beforeOwnerSync !== JSON.stringify(ownerState)) {
          shouldPersistOwnerState = true;
        }
      }

      if (shouldPersistOwnerState) {
        await pool.query(
          `UPDATE teacher_classroom_states
           SET state_json = $2::jsonb,
               updated_at = CURRENT_TIMESTAMP
           WHERE teacher_user_id = $1`,
          [ownerTeacherId, JSON.stringify(ownerState)]
        );
      }

      ownerClassrooms.forEach((classroom) => {
        const classroomId = Number(classroom?.classroomId || classroom?.id);
        if (!Number.isInteger(classroomId) || classroomId <= 0 || seenClassroomIds.has(classroomId)) {
          return;
        }

        const coTeachers = normalizeClassroomCoTeachers(classroom?.coTeachers);
        const currentTeacherAccess = coTeachers.find((entry) => entry.teacherUserId === teacherUserId);
        if (!currentTeacherAccess) {
          return;
        }

        seenClassroomIds.add(classroomId);
        state.classrooms.push({
          ...classroom,
          ownerTeacherId,
          ownerTeacherName: String(
            classroom?.ownerTeacherName
            || formatAnnouncementAuthorName(sharedRow.owner_name, sharedRow.owner_teacher_title)
            || `Teacher ${ownerTeacherId}`
          ),
          ownerProfilePictureUrl: sharedRow.owner_profile_picture_url || null,
          coTeachers: coTeachers.map(ct => ({
            ...ct,
            profilePictureUrl: ct.profilePictureUrl || null // Will be enriched later or already present
          })),
          assistantAccessRole: normalizeTeacherAccessRole(currentTeacherAccess.accessRole),
          isSharedClassroom: true,
          _ownerExplicit: true
        });

        if (ownerState.materialsByClassroom?.[classroomId] || ownerState.materialsByClassroom?.[String(classroomId)]) {
          state.materialsByClassroom[String(classroomId)] = ownerState.materialsByClassroom?.[String(classroomId)] || ownerState.materialsByClassroom?.[classroomId] || [];
        }

        if (ownerState.assignmentsByClassroom?.[classroomId] || ownerState.assignmentsByClassroom?.[String(classroomId)]) {
          state.assignmentsByClassroom[String(classroomId)] = ownerState.assignmentsByClassroom?.[String(classroomId)] || ownerState.assignmentsByClassroom?.[classroomId] || [];
        }

        if (ownerState.studentsByClassroom?.[classroomId] || ownerState.studentsByClassroom?.[String(classroomId)]) {
          state.studentsByClassroom[String(classroomId)] = ownerState.studentsByClassroom?.[String(classroomId)] || ownerState.studentsByClassroom?.[classroomId] || [];
        }

        if (ownerState.attendanceRecordsByClassroom?.[classroomId] || ownerState.attendanceRecordsByClassroom?.[String(classroomId)]) {
          state.attendanceRecordsByClassroom[String(classroomId)] = ownerState.attendanceRecordsByClassroom?.[String(classroomId)] || ownerState.attendanceRecordsByClassroom?.[classroomId] || {};
        }

        if (ownerState.attendanceStudentStatsByClassroom?.[classroomId] || ownerState.attendanceStudentStatsByClassroom?.[String(classroomId)]) {
          state.attendanceStudentStatsByClassroom[String(classroomId)] = ownerState.attendanceStudentStatsByClassroom?.[String(classroomId)] || ownerState.attendanceStudentStatsByClassroom?.[classroomId] || {};
        }

        if (ownerState.attendanceDetailByClassroom?.[classroomId] || ownerState.attendanceDetailByClassroom?.[String(classroomId)]) {
          state.attendanceDetailByClassroom[String(classroomId)] = ownerState.attendanceDetailByClassroom?.[String(classroomId)] || ownerState.attendanceDetailByClassroom?.[classroomId] || {};
        }
      });
    }

    const sharedClassroomCount = state.classrooms.filter((classroom) => Boolean(classroom?.isSharedClassroom)).length;
    const explicitOwnedClassroomCount = state.classrooms.filter((classroom) => {
      if (classroom?.isSharedClassroom) {
        return false;
      }

      return Boolean(classroom?._ownerExplicit) && Number(classroom?.ownerTeacherId || 0) === Number(teacherUserId);
    }).length;

    if (sharedClassroomCount > 0 && explicitOwnedClassroomCount === 0) {
      state.classrooms = state.classrooms.filter((classroom) => {
        if (classroom?.isSharedClassroom) {
          return true;
        }

        return Boolean(classroom?._ownerExplicit) && Number(classroom?.ownerTeacherId || 0) === Number(teacherUserId);
      });
    }

    const allowedClassroomIds = new Set(
      state.classrooms
        .map((classroom) => Number(classroom?.classroomId || classroom?.id))
        .filter((value) => Number.isInteger(value) && value > 0)
        .map((value) => String(value))
    );

    const keepAllowedClassroomMap = (source, fallback) => {
      const base = source && typeof source === 'object' ? source : fallback;
      if (!base || typeof base !== 'object') {
        return {};
      }

      const next = {};
      Object.entries(base).forEach(([key, value]) => {
        if (allowedClassroomIds.has(String(key))) {
          next[String(key)] = value;
        }
      });
      return next;
    };

    state.materialsByClassroom = keepAllowedClassroomMap(state.materialsByClassroom, {});
    state.assignmentsByClassroom = keepAllowedClassroomMap(state.assignmentsByClassroom, {});
    state.studentsByClassroom = keepAllowedClassroomMap(state.studentsByClassroom, {});
    state.attendanceRecordsByClassroom = keepAllowedClassroomMap(state.attendanceRecordsByClassroom, {});
    state.attendanceStudentStatsByClassroom = keepAllowedClassroomMap(state.attendanceStudentStatsByClassroom, {});
    state.attendanceDetailByClassroom = keepAllowedClassroomMap(state.attendanceDetailByClassroom, {});

    state.classrooms = state.classrooms.map((classroom) => {
      const nextClassroom = { ...classroom };
      delete nextClassroom._ownerExplicit;
      return nextClassroom;
    });

    if (shouldPersistCurrentTeacherState) {
      await pool.query(
        `UPDATE teacher_classroom_states
         SET state_json = $2::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE teacher_user_id = $1`,
        [teacherUserId, JSON.stringify(state)]
      );
    }

    const classroomIds = (Array.isArray(state.classrooms) ? state.classrooms : [])
      .map((classroom) => Number(classroom.classroomId || classroom.id))
      .filter((value) => Number.isInteger(value) && value > 0);

    const ownedClassroomIds = (Array.isArray(state.classrooms) ? state.classrooms : [])
      .filter((classroom) => Number(classroom?.ownerTeacherId || teacherUserId) === teacherUserId)
      .map((classroom) => Number(classroom.classroomId || classroom.id))
      .filter((value) => Number.isInteger(value) && value > 0);

    if (ownedClassroomIds.length > 0) {
      try {
        await ensureEnrollmentTable();

        const enrolledRows = await pool.query(
          `SELECT
             ue.target_id AS classroom_id,
             u.user_id,
             u.full_name,
             u.email,
             u.profile_picture_url
           FROM user_enrollments ue
           JOIN users u ON u.user_id = ue.user_id
           WHERE ue.target_type = 'classroom'
             AND ue.enrollment_status = 'active'
            AND ue.target_id = ANY($1::int[])`,
          [ownedClassroomIds]
        );

        const syncedStudentsByClassroom = {
          ...(state.studentsByClassroom && typeof state.studentsByClassroom === 'object'
            ? state.studentsByClassroom
            : {})
        };

        const enrolledByClassroom = new Map();
        enrolledRows.rows.forEach((entry) => {
          const classId = Number(entry.classroom_id);
          const studentUserId = Number(entry.user_id);
          if (!Number.isInteger(classId) || !Number.isInteger(studentUserId)) {
            return;
          }

          if (!enrolledByClassroom.has(classId)) {
            enrolledByClassroom.set(classId, []);
          }

          enrolledByClassroom.get(classId).push({
            studentId: studentUserId,
            userId: studentUserId,
            name: String(entry.full_name || `Student ${studentUserId}`),
            studentNo: `S${String(studentUserId).padStart(3, '0')}`,
            email: String(entry.email || ''),
            profilePictureUrl: entry.profile_picture_url || null,
            status: 'Active'
          });
        });

        for (const classroomId of ownedClassroomIds) {
          const rosterKey = String(classroomId);
          const existingRoster = syncedStudentsByClassroom[rosterKey]
            || syncedStudentsByClassroom[classroomId]
            || [];

          const mergedByStudent = new Map();
          (Array.isArray(existingRoster) ? existingRoster : []).forEach((student) => {
            const rosterStudentId = Number(student?.studentId || student?.userId || student?.id);
            if (!Number.isInteger(rosterStudentId) || rosterStudentId <= 0) {
              return;
            }

            mergedByStudent.set(rosterStudentId, {
              ...student,
              studentId: rosterStudentId,
              userId: rosterStudentId,
              name: String(student?.name || `Student ${rosterStudentId}`),
              studentNo: String(student?.studentNo || `S${String(rosterStudentId).padStart(3, '0')}`),
              email: String(student?.email || ''),
              status: String(student?.status || 'Active')
            });
          });

          const enrolledRoster = enrolledByClassroom.get(classroomId) || [];
          enrolledRoster.forEach((student) => {
            mergedByStudent.set(student.studentId, {
              ...(mergedByStudent.get(student.studentId) || {}),
              ...student,
              status: 'Active'
            });
          });

          syncedStudentsByClassroom[rosterKey] = Array.from(mergedByStudent.values());

          // --- Lazy Enrollment Sync ---
          // If the JSON roster has students but the enrollment join brought back 0 records for this specific classroom,
          // it means the classroom was likely affected by a previous sync blocker. We repair it now.
          const jsonRosterIds = (Array.isArray(existingRoster) ? existingRoster : [])
            .map(s => Number(s?.studentId || s?.userId || s?.id))
            .filter(id => Number.isInteger(id) && id > 0);
          
          if (jsonRosterIds.length > 0 && (!enrolledByClassroom.has(classroomId) || enrolledByClassroom.get(classroomId).length === 0)) {
            console.log(`[LazySync] Repairing enrollment for classroom ${classroomId} with ${jsonRosterIds.length} students`);
            for (const studentId of jsonRosterIds) {
              try {
                await pool.query(
                  `INSERT INTO user_enrollments (user_id, target_type, target_id, enrollment_status, enrolled_at, enrolled_by)
                   VALUES ($1, 'classroom', $2, 'active', CURRENT_TIMESTAMP, $3)
                   ON CONFLICT (user_id, target_type, target_id) DO UPDATE 
                   SET enrollment_status = 'active', enrolled_at = CURRENT_TIMESTAMP`,
                  [studentId, classroomId, teacherUserId]
                );
              } catch (err) {
                console.error(`LazySync failed for student ${studentId}:`, err.message);
              }
            }
            shouldPersistCurrentTeacherState = true;
          }
        }

        const previousSerializedRoster = JSON.stringify(state.studentsByClassroom || {});
        const nextSerializedRoster = JSON.stringify(syncedStudentsByClassroom);

        if (previousSerializedRoster !== nextSerializedRoster) {
          state.studentsByClassroom = syncedStudentsByClassroom;
          await pool.query(
            `UPDATE teacher_classroom_states
             SET state_json = $2::jsonb,
                 updated_at = CURRENT_TIMESTAMP
             WHERE teacher_user_id = $1`,
            [teacherUserId, JSON.stringify(state)]
          );
        }
      } catch (syncError) {
        console.warn('Failed to sync teacher roster from enrollments:', syncError?.message || syncError);
      }
    }

    if (classroomIds.length > 0) {
      const assignmentMetaByKey = new Map();
      Object.entries(state.assignmentsByClassroom || {}).forEach(([classroomKey, assignments]) => {
        const classroomId = Number(classroomKey);
        if (!Number.isInteger(classroomId) || !Array.isArray(assignments)) {
          return;
        }

        assignments.forEach((assignment, index) => {
          const assignmentId = toPositiveIntegerFromCandidates(assignment?.id, assignment?.assignmentId, index + 1);
          if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
            return;
          }
          assignmentMetaByKey.set(`${classroomId}:${assignmentId}`, {
            assignmentId,
            assignmentTitle: String(assignment?.title || `Assignment ${assignmentId}`)
          });
        });
      });

      const submissionsResult = await pool.query(
        `SELECT
          s.submission_id,
          s.student_user_id,
          s.classroom_id,
          s.assignment_id,
          s.file_id,
          COALESCE(s.file_id, matched_file.file_id) AS resolved_file_id,
          s.file_name,
          s.file_size,
          s.submission_status,
          s.grade,
          s.feedback,
          s.submitted_at,
          COALESCE(primary_file.file_type, matched_file.file_type) AS file_type,
          u.full_name AS student_name,
          u.profile_picture_url AS student_profile_picture_url
         FROM classroom_assignment_submissions s
         JOIN users u ON u.user_id = s.student_user_id
         LEFT JOIN files primary_file ON primary_file.file_id = s.file_id
         LEFT JOIN LATERAL (
           SELECT f.file_id, f.file_type
           FROM files f
           WHERE f.user_id = s.student_user_id
             AND f.is_deleted = false
             AND f.original_filename = s.file_name
             AND (
               (f.classroom_id IS NOT NULL AND f.classroom_id = s.classroom_id)
               OR
               (f.classroom_id IS NULL AND COALESCE(f.file_scope, 'personal') = 'personal')
             )
           ORDER BY f.uploaded_at DESC
           LIMIT 1
         ) matched_file ON true
         WHERE s.classroom_id = ANY($1::int[])
         ORDER BY s.submitted_at DESC`,
        [classroomIds]
      );

      const nextGradingSubmissionsByAssignment = {
        ...(state.gradingSubmissionsByAssignment && typeof state.gradingSubmissionsByAssignment === 'object'
          ? state.gradingSubmissionsByAssignment
          : {})
      };

      const existingRowsBySubmissionId = new Map();
      Object.values(nextGradingSubmissionsByAssignment).forEach((rows) => {
        if (!Array.isArray(rows)) {
          return;
        }
        rows.forEach((row) => {
          const rowId = Number(row?.id);
          if (Number.isInteger(rowId) && rowId > 0) {
            existingRowsBySubmissionId.set(rowId, row);
          }
        });
      });

      submissionsResult.rows.forEach((submission) => {
        const assignmentId = Number(submission.assignment_id);
        const classroomId = Number(submission.classroom_id);
        if (!Number.isInteger(assignmentId) || assignmentId <= 0 || !Number.isInteger(classroomId) || classroomId <= 0) {
          return;
        }

        const assignmentKey = `${classroomId}:${assignmentId}`;
        const assignmentMeta = assignmentMetaByKey.get(assignmentKey);
        if (!assignmentMeta) {
          return;
        }

        const existingRows = Array.isArray(nextGradingSubmissionsByAssignment[assignmentId])
          ? nextGradingSubmissionsByAssignment[assignmentId]
          : [];
        const existingRow = existingRowsBySubmissionId.get(Number(submission.submission_id));

        const nextStatus = submission.grade !== null && submission.grade !== undefined
          ? 'graded'
          : (String(submission.submission_status || '').toLowerCase() === 'late' ? 'late' : 'pending');

        const normalizedRow = {
          id: Number(submission.submission_id),
          submissionId: Number(submission.submission_id),
          assignmentId,
          classroomId,
          studentUserId: Number(submission.student_user_id),
          fileId: Number(submission.resolved_file_id || submission.file_id || 0) || null,
          fileType: String(submission.file_type || '').toLowerCase(),
          studentName: String(submission.student_name || `Student ${submission.student_user_id}`),
          studentNo: `S${String(submission.student_user_id).padStart(3, '0')}`,
          submittedAt: new Date(submission.submitted_at).toLocaleString('en-MY', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }),
          fileName: String(submission.file_name || 'Submission'),
          fileSize: String(submission.file_size || '-'),
          status: nextStatus,
          grade: submission.grade !== null && submission.grade !== undefined
            ? Number(submission.grade)
            : (typeof existingRow?.grade === 'number' ? existingRow.grade : null),
          feedback: submission.feedback || existingRow?.feedback || '',
          gradedByUserId: Number(existingRow?.gradedByUserId || 0) || null,
          gradedByName: String(existingRow?.gradedByName || ''),
          gradedAt: existingRow?.gradedAt || null,
          assignmentTitle: assignmentMeta.assignmentTitle,
          studentProfilePictureUrl: submission.student_profile_picture_url || null
        };

        const withoutCurrent = existingRows.filter((row) => Number(row?.id) !== Number(submission.submission_id));
        nextGradingSubmissionsByAssignment[assignmentId] = [normalizedRow, ...withoutCurrent];

        if (!submission.file_id && normalizedRow.fileId) {
          pool.query(
            `UPDATE classroom_assignment_submissions
             SET file_id = $1, updated_at = CURRENT_TIMESTAMP
             WHERE submission_id = $2
               AND (file_id IS NULL OR file_id = 0)`,
            [normalizedRow.fileId, Number(submission.submission_id)]
          ).catch((error) => {
            console.warn('Failed to backfill assignment submission file_id:', error?.message || error);
          });
        }
      });

      state.gradingSubmissionsByAssignment = nextGradingSubmissionsByAssignment;
    }

    // --- Global Profile Picture Enrichment ---
    const allUserIdsToEnrich = new Set();
    state.classrooms.forEach(classroom => {
      if (classroom.ownerTeacherId) allUserIdsToEnrich.add(Number(classroom.ownerTeacherId));
      if (Array.isArray(classroom.coTeachers)) {
        classroom.coTeachers.forEach(ct => {
          if (ct.teacherUserId) allUserIdsToEnrich.add(Number(ct.teacherUserId));
        });
      }
    });

    Object.values(state.studentsByClassroom || {}).forEach(roster => {
      if (Array.isArray(roster)) {
        roster.forEach(student => {
          const sid = Number(student.studentId || student.userId || student.id);
          if (sid > 0) allUserIdsToEnrich.add(sid);
        });
      }
    });

    if (allUserIdsToEnrich.size > 0) {
      try {
        const profileRows = await pool.query(
          'SELECT user_id, profile_picture_url FROM users WHERE user_id = ANY($1::int[])',
          [Array.from(allUserIdsToEnrich)]
        );
        
        const profileMap = new Map();
        profileRows.rows.forEach(row => {
          profileMap.set(Number(row.user_id), row.profile_picture_url);
        });

        // Apply enrichment to classrooms
        state.classrooms.forEach(classroom => {
          if (classroom.ownerTeacherId && profileMap.has(Number(classroom.ownerTeacherId))) {
            classroom.ownerProfilePictureUrl = profileMap.get(Number(classroom.ownerTeacherId)) || classroom.ownerProfilePictureUrl;
          }
          if (Array.isArray(classroom.coTeachers)) {
            classroom.coTeachers.forEach(ct => {
              if (ct.teacherUserId && profileMap.has(Number(ct.teacherUserId))) {
                ct.profilePictureUrl = profileMap.get(Number(ct.teacherUserId)) || ct.profilePictureUrl || null;
              }
            });
          }
        });

        // Apply enrichment to rosters
        Object.entries(state.studentsByClassroom || {}).forEach(([classId, roster]) => {
          if (Array.isArray(roster)) {
            roster.forEach(student => {
              const sid = Number(student.studentId || student.userId || student.id);
              if (sid > 0 && profileMap.has(sid)) {
                student.profilePictureUrl = profileMap.get(sid) || student.profilePictureUrl || null;
              }
            });
          }
        });

        // Apply enrichment to grading submissions
        Object.values(state.gradingSubmissionsByAssignment || {}).forEach(submissions => {
          if (Array.isArray(submissions)) {
            submissions.forEach(sub => {
              const sid = Number(sub.studentUserId || sub.userId || sub.studentId);
              if (sid > 0 && profileMap.has(sid)) {
                sub.studentProfilePictureUrl = profileMap.get(sid) || sub.studentProfilePictureUrl || null;
              }
            });
          }
        });
      } catch (enrichError) {
        console.warn('Failed to enrich profile pictures:', enrichError.message);
      }
    }

    return res.json({ state, updatedAt: row.updated_at });
  } catch (error) {
    console.error('Get teacher classroom state error:', error);
    return res.status(500).json({ error: 'Failed to fetch teacher classroom state' });
  }
}

async function saveTeacherState(req, res) {
  try {
    await ensureClassroomTables();

    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Teacher access required' });
    }

    const teacherUserId = req.user.userId;
    const requestOperationType = String(req.body?.operationType || '').trim();
    const rawState = req.body?.state;
    const incomingState = normalizeTeacherState(rawState);

    const existingResult = await pool.query(
      'SELECT state_json FROM teacher_classroom_states WHERE teacher_user_id = $1',
      [teacherUserId]
    );
    const existingState = existingResult.rows.length > 0
      ? normalizeTeacherState(existingResult.rows[0].state_json)
      : normalizeTeacherState({});

    const incomingClassrooms = Array.isArray(incomingState.classrooms) ? incomingState.classrooms : [];
    const normalizedIncomingClassrooms = incomingClassrooms
      .map((classroom) => {
        const classroomId = Number(classroom?.classroomId || classroom?.id);
        if (!Number.isInteger(classroomId) || classroomId <= 0) {
          return null;
        }

        const parsedOwnerTeacherId = Number(classroom?.ownerTeacherId);
        const hasExplicitOwnerTeacherId = Number.isInteger(parsedOwnerTeacherId) && parsedOwnerTeacherId > 0;
        const declaredSharedClassroom = Boolean(classroom?.isSharedClassroom);
        const ownerTeacherId = hasExplicitOwnerTeacherId
          ? parsedOwnerTeacherId
          : (declaredSharedClassroom ? null : teacherUserId);
        const isOwnedByCurrentTeacher = Number.isInteger(ownerTeacherId) && ownerTeacherId === teacherUserId;

        return {
          ...classroom,
          classroomId,
          ownerTeacherId: Number.isInteger(ownerTeacherId) && ownerTeacherId > 0 ? ownerTeacherId : teacherUserId,
          ownerTeacherName: String(classroom?.ownerTeacherName || req.user.fullName || 'Teacher'),
          coTeachers: normalizeClassroomCoTeachers(classroom?.coTeachers),
          assistantAccessRole: isOwnedByCurrentTeacher
            ? 'owner'
            : normalizeTeacherAccessRole(classroom?.assistantAccessRole || 'student'),
          isSharedClassroom: !isOwnedByCurrentTeacher,
          _ownerExplicit: hasExplicitOwnerTeacherId
        };
      })
      .filter(Boolean);

    const incomingOwnedClassrooms = normalizedIncomingClassrooms
      .filter((classroom) => Number(classroom.ownerTeacherId) === teacherUserId && classroom.isSharedClassroom !== true);

    const incomingSharedClassrooms = normalizedIncomingClassrooms
      .filter((classroom) => Number(classroom.ownerTeacherId) !== teacherUserId);

    const existingOwnedClassrooms = (Array.isArray(existingState.classrooms) ? existingState.classrooms : [])
      .filter((classroom) => Number(classroom?.ownerTeacherId || 0) === teacherUserId)
      .map((classroom) => ({
        ...classroom,
        ownerTeacherId: teacherUserId,
        ownerTeacherName: String(classroom?.ownerTeacherName || req.user.fullName || 'Teacher'),
        coTeachers: normalizeClassroomCoTeachers(classroom?.coTeachers),
        assistantAccessRole: 'owner',
        isSharedClassroom: false,
        _ownerExplicit: true
      }));

    const shouldKeepExistingClassrooms = existingOwnedClassrooms.length > 0 && incomingOwnedClassrooms.length === 0;
    const finalOwnedClassrooms = shouldKeepExistingClassrooms ? existingOwnedClassrooms : incomingOwnedClassrooms;

    const normalizedFinalOwnedClassrooms = finalOwnedClassrooms.map((classroom) => {
      const nextClassroom = { ...classroom };
      delete nextClassroom._ownerExplicit;
      return nextClassroom;
    });

    const ownedClassroomIds = new Set(
      normalizedFinalOwnedClassrooms.map((classroom) => Number(classroom.classroomId)).filter((value) => Number.isInteger(value) && value > 0)
    );

    const pickClassroomMap = (incomingMap, existingMap) => {
      const source = (incomingMap && Object.keys(incomingMap).length > 0)
        ? incomingMap
        : existingMap;

      const next = {};
      Object.entries(source || {}).forEach(([key, value]) => {
        const classroomId = Number(key);
        if (Number.isInteger(classroomId) && ownedClassroomIds.has(classroomId)) {
          next[String(classroomId)] = value;
        }
      });
      return next;
    };

    const state = {
      ...incomingState,
      classrooms: normalizedFinalOwnedClassrooms,
      materialsByClassroom: pickClassroomMap(incomingState.materialsByClassroom, existingState.materialsByClassroom),
      assignmentsByClassroom: pickClassroomMap(incomingState.assignmentsByClassroom, existingState.assignmentsByClassroom),
      studentsByClassroom: pickClassroomMap(incomingState.studentsByClassroom, existingState.studentsByClassroom),
      gradingSubmissionsByAssignment: incomingState.gradingSubmissionsByAssignment,
      attendanceRecordsByClassroom: pickClassroomMap(incomingState.attendanceRecordsByClassroom, existingState.attendanceRecordsByClassroom),
      attendanceStudentStatsByClassroom: pickClassroomMap(incomingState.attendanceStudentStatsByClassroom, existingState.attendanceStudentStatsByClassroom),
      attendanceDetailByClassroom: pickClassroomMap(incomingState.attendanceDetailByClassroom, existingState.attendanceDetailByClassroom),
      archivedClassrooms: Array.isArray(existingState.archivedClassrooms) ? existingState.archivedClassrooms : []
    };

    // --- Comprehensive Schedule Conflict Validation ---
    for (let i = 0; i < normalizedFinalOwnedClassrooms.length; i++) {
      const cls = normalizedFinalOwnedClassrooms[i];
      if (!cls.classSchedule || cls.classSchedule === '-' || normalizeClassroomStatus(cls.status) === 'Archived') continue;

      const currentClassroomId = Number(cls.classroomId || cls.id);

      // 1. Internal owner overlap check: against other classes in the same teacher state
      for (let j = i + 1; j < normalizedFinalOwnedClassrooms.length; j++) {
        const otherCls = normalizedFinalOwnedClassrooms[j];
        if (!otherCls.classSchedule || otherCls.classSchedule === '-' || normalizeClassroomStatus(otherCls.status) === 'Archived') continue;
        
        if (hasOverlap(cls.classSchedule, otherCls.classSchedule)) {
          return res.status(409).json({
            error: `Your classes overlap: "${cls.classroomName || cls.title || 'Class'}" and "${otherCls.classroomName || otherCls.title || 'Class'}" both have schedule "${cls.classSchedule}".`
          });
        }
      }

      // 2. External conflict for Owner: against classes where this teacher is a co-teacher (owned by others)
      const externalConflict = await checkTeacherScheduleConflict(teacherUserId, cls.classSchedule, currentClassroomId, pool);
      if (externalConflict.hasConflict) {
        return res.status(409).json({
          error: `Schedule conflict: You already have a class "${externalConflict.conflictingClassroomName}" at ${cls.classSchedule} (as owner or co-teacher).`
        });
      }

      // 3. Co-teacher (Assistant) conflict check
      const coTeachers = Array.isArray(cls.coTeachers) ? cls.coTeachers : [];
      for (const ct of coTeachers) {
        const ctId = Number(ct.teacherUserId || ct.userId || ct.id);
        if (Number.isInteger(ctId) && ctId > 0 && ctId !== teacherUserId) {
          const assistantConflict = await checkTeacherScheduleConflict(ctId, cls.classSchedule, currentClassroomId, pool);
          if (assistantConflict.hasConflict) {
            return res.status(409).json({
              error: `Assistant conflict: ${ct.name || `Teacher ${ctId}`} already has a class "${assistantConflict.conflictingClassroomName}" at ${cls.classSchedule}.`
            });
          }
        }
      }

      // 4. Venue conflict check
      if (cls.venueId) {
        const venueConflict = await checkVenueScheduleConflict(cls.venueId, cls.classSchedule, currentClassroomId, pool);
        if (venueConflict.hasConflict) {
          return res.status(409).json({
            error: `Venue crash: The selected venue is already occupied by class "${venueConflict.conflictingClassroomName}" during ${cls.classSchedule}.`
          });
        }
      }
    }

    if (requestOperationType === 'student_list_managed') {
      for (const classroom of normalizedFinalOwnedClassrooms) {
        const classroomId = Number(classroom?.classroomId);
        if (!Number.isInteger(classroomId) || classroomId <= 0) {
          continue;
        }

        const configuredMaximumCapacity = Number.parseInt(classroom?.maximumCapacity, 10);
        const maximumCapacity = Number.isInteger(configuredMaximumCapacity) && configuredMaximumCapacity > 0
          ? configuredMaximumCapacity
          : null;

        const rosterKey = String(classroomId);
        const incomingRoster = state.studentsByClassroom?.[rosterKey] || state.studentsByClassroom?.[classroomId] || [];
        const existingRoster = existingState.studentsByClassroom?.[rosterKey] || existingState.studentsByClassroom?.[classroomId] || [];

        const incomingCount = getUniqueStudentCountFromRoster(incomingRoster);
        const existingCount = getUniqueStudentCountFromRoster(existingRoster);
        const rosterChanged = JSON.stringify(incomingRoster || []) !== JSON.stringify(existingRoster || []);

        if (rosterChanged && maximumCapacity !== null && incomingCount > maximumCapacity && incomingCount > existingCount) {
          return res.status(409).json({
            error: `Classroom "${String(classroom?.classroomName || classroom?.title || classroomId)}" is full (${maximumCapacity} students max)`
          });
        }

        if (rosterChanged) {
          await ensureEnrollmentTable();
          
          const incomingIds = incomingRoster
            .map(s => Number(s?.studentId || s?.userId || s?.id))
            .filter(id => Number.isInteger(id) && id > 0);
          
          const existingIds = existingRoster
            .map(s => Number(s?.studentId || s?.userId || s?.id))
            .filter(id => Number.isInteger(id) && id > 0);

          const removedIds = existingIds.filter(id => !incomingIds.includes(id));
          const addedIds = incomingIds.filter(id => !existingIds.includes(id));

          if (removedIds.length > 0) {
            await pool.query(
              `UPDATE user_enrollments 
               SET enrollment_status = 'inactive'
               WHERE target_type = 'classroom' 
                 AND target_id = $1 
                 AND user_id = ANY($2::int[])`,
              [classroomId, removedIds]
            );
          }

          if (addedIds.length > 0) {
            const enrollmentConflicts = [];
            for (const newStudentId of addedIds) {
              // --- Student Schedule Conflict Validation ---
              const studentConflict = await checkUserScheduleConflict(newStudentId, classroomId, pool, getClassroomSchedule(classroom));
              if (studentConflict.hasConflict) {
                const studentName = (incomingRoster.find(s => Number(s?.studentId || s?.userId || s?.id) === newStudentId))?.name || `Student ${newStudentId}`;
                enrollmentConflicts.push({ studentName, conflictingClassroomName: studentConflict.conflictingClassroomName });
              }
            }

            if (enrollmentConflicts.length > 0) {
              const conflictMessages = enrollmentConflicts.map(c => `${c.studentName} (${c.conflictingClassroomName || 'another class'})`);
              return res.status(409).json({
                error: `Schedule conflict(s) detected for: ${conflictMessages.join(', ')}. No changes were saved.`
              });
            }

            for (const newStudentId of addedIds) {
              await pool.query(
                `INSERT INTO user_enrollments (user_id, target_type, target_id, enrollment_status, enrolled_at, enrolled_by)
                 VALUES ($1, 'classroom', $2, 'active', CURRENT_TIMESTAMP, $3)
                 ON CONFLICT (user_id, target_type, target_id) DO UPDATE 
                 SET enrollment_status = 'active', enrolled_at = CURRENT_TIMESTAMP`,
                [newStudentId, classroomId, teacherUserId]
              );
            }
          }

        }
      }
    }

    syncArchivedClassroomFolder(
      state,
      teacherUserId,
      String(req.user.fullName || 'Teacher'),
      new Date().toISOString()
    );

    if (incomingSharedClassrooms.length > 0) {
      const ownerUpdatesByTeacher = new Map();

      for (const sharedClassroom of incomingSharedClassrooms) {
        const ownerTeacherId = Number(sharedClassroom.ownerTeacherId);
        const classroomId = Number(sharedClassroom.classroomId);

        if (!Number.isInteger(ownerTeacherId) || ownerTeacherId <= 0 || !Number.isInteger(classroomId) || classroomId <= 0) {
          continue;
        }

        if (!ownerUpdatesByTeacher.has(ownerTeacherId)) {
          const ownerStateResult = await pool.query(
            'SELECT state_json FROM teacher_classroom_states WHERE teacher_user_id = $1',
            [ownerTeacherId]
          );

          const ownerState = ownerStateResult.rows.length > 0
            ? normalizeTeacherState(ownerStateResult.rows[0].state_json)
            : normalizeTeacherState({});

          ownerUpdatesByTeacher.set(ownerTeacherId, ownerState);
        }

        const ownerState = ownerUpdatesByTeacher.get(ownerTeacherId);

        const sharedCoTeachers = normalizeClassroomCoTeachers(sharedClassroom.coTeachers);
        const ownerClassroomRecord = (Array.isArray(ownerState.classrooms) ? ownerState.classrooms : [])
          .find((item) => Number(item?.classroomId || item?.id) === classroomId);
        const ownerCoTeachers = normalizeClassroomCoTeachers(ownerClassroomRecord?.coTeachers);
        const effectiveCoTeachers = sharedCoTeachers.length > 0 ? sharedCoTeachers : ownerCoTeachers;
        const currentTeacherAccess = effectiveCoTeachers.find((entry) => entry.teacherUserId === teacherUserId);

        if (!currentTeacherAccess || normalizeTeacherAccessRole(currentTeacherAccess.accessRole) !== 'teacher') {
          continue;
        }

        const ownerAssignments = ownerState.assignmentsByClassroom && typeof ownerState.assignmentsByClassroom === 'object'
          ? { ...ownerState.assignmentsByClassroom }
          : {};
        const ownerMaterials = ownerState.materialsByClassroom && typeof ownerState.materialsByClassroom === 'object'
          ? { ...ownerState.materialsByClassroom }
          : {};
        const ownerAttendanceRecords = ownerState.attendanceRecordsByClassroom && typeof ownerState.attendanceRecordsByClassroom === 'object'
          ? { ...ownerState.attendanceRecordsByClassroom }
          : {};
        const ownerAttendanceStudentStats = ownerState.attendanceStudentStatsByClassroom && typeof ownerState.attendanceStudentStatsByClassroom === 'object'
          ? { ...ownerState.attendanceStudentStatsByClassroom }
          : {};
        const ownerAttendanceDetail = ownerState.attendanceDetailByClassroom && typeof ownerState.attendanceDetailByClassroom === 'object'
          ? { ...ownerState.attendanceDetailByClassroom }
          : {};

        if (incomingState.assignmentsByClassroom?.[String(classroomId)] || incomingState.assignmentsByClassroom?.[classroomId]) {
          ownerAssignments[String(classroomId)] = incomingState.assignmentsByClassroom?.[String(classroomId)]
            || incomingState.assignmentsByClassroom?.[classroomId]
            || [];
          ownerState.assignmentsByClassroom = ownerAssignments;
        }

        if (incomingState.materialsByClassroom?.[String(classroomId)] || incomingState.materialsByClassroom?.[classroomId]) {
          ownerMaterials[String(classroomId)] = incomingState.materialsByClassroom?.[String(classroomId)]
            || incomingState.materialsByClassroom?.[classroomId]
            || [];
          ownerState.materialsByClassroom = ownerMaterials;
        }

        if (incomingState.attendanceRecordsByClassroom?.[String(classroomId)] || incomingState.attendanceRecordsByClassroom?.[classroomId]) {
          ownerAttendanceRecords[String(classroomId)] = incomingState.attendanceRecordsByClassroom?.[String(classroomId)]
            || incomingState.attendanceRecordsByClassroom?.[classroomId]
            || {};
          ownerState.attendanceRecordsByClassroom = ownerAttendanceRecords;
        }

        if (incomingState.attendanceStudentStatsByClassroom?.[String(classroomId)] || incomingState.attendanceStudentStatsByClassroom?.[classroomId]) {
          ownerAttendanceStudentStats[String(classroomId)] = incomingState.attendanceStudentStatsByClassroom?.[String(classroomId)]
            || incomingState.attendanceStudentStatsByClassroom?.[classroomId]
            || {};
          ownerState.attendanceStudentStatsByClassroom = ownerAttendanceStudentStats;
        }

        if (incomingState.attendanceDetailByClassroom?.[String(classroomId)] || incomingState.attendanceDetailByClassroom?.[classroomId]) {
          ownerAttendanceDetail[String(classroomId)] = incomingState.attendanceDetailByClassroom?.[String(classroomId)]
            || incomingState.attendanceDetailByClassroom?.[classroomId]
            || {};
          ownerState.attendanceDetailByClassroom = ownerAttendanceDetail;
        }
      }

      for (const [ownerTeacherId, ownerState] of ownerUpdatesByTeacher.entries()) {
        await pool.query(
          `INSERT INTO teacher_classroom_states (teacher_user_id, state_json, updated_at)
           VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
           ON CONFLICT (teacher_user_id)
           DO UPDATE SET
             state_json = EXCLUDED.state_json,
             updated_at = CURRENT_TIMESTAMP`,
          [ownerTeacherId, JSON.stringify(ownerState)]
        );
      }
    }
    const operationType = requestOperationType;
    const operationLabel = String(req.body?.operationLabel || '').trim();
    const target = String(req.body?.target || '').trim();
    const targetType = String(req.body?.targetType || '').trim();

    await pool.query(
      `INSERT INTO teacher_classroom_states (teacher_user_id, state_json, updated_at)
       VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (teacher_user_id)
       DO UPDATE SET
         state_json = EXCLUDED.state_json,
         updated_at = CURRENT_TIMESTAMP`,
      [teacherUserId, JSON.stringify(state)]
    );

    if (operationType && operationLabel) {
      await appendClassroomLog({
        actorUserId: teacherUserId,
        actorRole: req.user.role,
        operationType,
        operationLabel,
        target,
        targetType: targetType || 'Classroom',
        details: {
          classroomCount: state.classrooms.length,
          assignmentGroups: Object.keys(state.assignmentsByClassroom || {}).length,
          materialGroups: Object.keys(state.materialsByClassroom || {}).length
        }
      });
    }

    return res.json({ message: 'Teacher classroom state saved successfully' });
  } catch (error) {
    console.error('Save teacher classroom state error:', error);
    return res.status(500).json({ error: 'Failed to save teacher classroom state' });
  }
}

async function getStudentClasses(req, res) {
  try {
    await ensureClassroomTables();

    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Student access required' });
    }

    const studentUserId = req.user.userId;
    const studentProfileResult = await pool.query(
      'SELECT student_level FROM users WHERE user_id = $1 LIMIT 1',
      [studentUserId]
    );
    const studentLevel = String(studentProfileResult.rows?.[0]?.student_level || '');

    const enrollmentRows = await pool.query(
      `SELECT target_id
       FROM user_enrollments
       WHERE user_id = $1
         AND target_type = 'classroom'
         AND enrollment_status = 'active'`,
      [studentUserId]
    ).catch(() => ({ rows: [] }));

    const enrolledClassroomIds = new Set(
      (enrollmentRows.rows || []).map((row) => Number(row.target_id)).filter((value) => Number.isInteger(value))
    );

    const teacherStateRows = await pool.query(
      `SELECT
        tcs.teacher_user_id,
        tcs.state_json,
        u.full_name AS teacher_name
      FROM teacher_classroom_states tcs
      JOIN users u ON u.user_id = tcs.teacher_user_id
      WHERE u.role = 'teacher'
      ORDER BY tcs.updated_at DESC`
    );

    const teacherUserIds = Array.from(new Set(
      (teacherStateRows.rows || [])
        .map((entry) => Number(entry.teacher_user_id))
        .filter((value) => Number.isInteger(value) && value > 0)
    ));
    const enrolledClassroomIdList = Array.from(enrolledClassroomIds.values());
    const classroomMaterialFilesByClassroomId = new Map();

    if (teacherUserIds.length > 0 && enrolledClassroomIdList.length > 0) {
      const classroomFilesResult = await pool.query(
        `SELECT file_id, user_id, classroom_id, original_filename, file_size, uploaded_at
         FROM files
         WHERE is_deleted = false
           AND user_id = ANY($1::int[])
           AND classroom_id = ANY($2::int[])
           AND COALESCE(file_scope, 'personal') = 'classroom'
           AND encrypted_filename LIKE 'classroom/%'
         ORDER BY uploaded_at DESC`,
        [teacherUserIds, enrolledClassroomIdList]
      ).catch(() => ({ rows: [] }));

      (classroomFilesResult.rows || []).forEach((fileRow) => {
        const uploaderId = Number(fileRow.user_id);
        const classroomId = Number(fileRow.classroom_id);
        if (!Number.isInteger(uploaderId) || uploaderId <= 0 || !Number.isInteger(classroomId) || classroomId <= 0) {
          return;
        }

        if (!classroomMaterialFilesByClassroomId.has(classroomId)) {
          classroomMaterialFilesByClassroomId.set(classroomId, []);
        }
        classroomMaterialFilesByClassroomId.get(classroomId).push(fileRow);
      });
    }

    const submissionsResult = await pool.query(
      `SELECT classroom_id, assignment_id, file_id, file_name, file_size, comment, submission_status, grade, feedback, submitted_at
       FROM classroom_assignment_submissions
       WHERE student_user_id = $1`,
      [studentUserId]
    );

    const submissionMap = new Map();
    submissionsResult.rows.forEach((row) => {
      const key = `${row.classroom_id}:${row.assignment_id}`;
      submissionMap.set(key, row);
    });

    const classById = new Map();

    teacherStateRows.rows.forEach((row) => {
      const state = normalizeTeacherState(row.state_json);
      const teacherName = row.teacher_name || 'Teacher';

      state.classrooms.forEach((classroom) => {
        const classId = Number(classroom.classroomId || classroom.id);
        if (!Number.isInteger(classId)) {
          return;
        }

        const ownerTeacherId = Number(classroom?.ownerTeacherId || row.teacher_user_id || 0);
        if (!Number.isInteger(ownerTeacherId) || ownerTeacherId <= 0) {
          return;
        }

        const classIdentity = `${ownerTeacherId}:${classId}`;

        if (normalizeClassroomStatus(classroom?.status) === 'Archived') {
          return;
        }

        const isEnrolledByTarget = enrolledClassroomIds.size > 0 && enrolledClassroomIds.has(classId);
        const roster = state.studentsByClassroom?.[classId] || state.studentsByClassroom?.[String(classId)] || [];
        const isInRoster = Array.isArray(roster)
          ? roster.some((student) => {
            const studentId = Number(student.studentId || student.userId || student.id);
            return Number.isInteger(studentId) && studentId === studentUserId;
          })
          : false;

        const rosterHasEntries = Array.isArray(roster) && roster.length > 0;
        const isStudentAssociated = rosterHasEntries ? isInRoster : (isInRoster || isEnrolledByTarget);

        if (!isStudentAssociated) {
          return;
        }

        const classroomGradeLevel = String(classroom.gradeLevel || '');
        if (!isStudentLevelAllowedForClassroom(studentLevel, classroomGradeLevel)) {
          return;
        }

        const rawMaterials = state.materialsByClassroom?.[classId] || state.materialsByClassroom?.[String(classId)] || [];
        const rawAssignments = state.assignmentsByClassroom?.[classId] || state.assignmentsByClassroom?.[String(classId)] || [];
        const attendanceRecordsByClassroom = state.attendanceRecordsByClassroom?.[classId]
          || state.attendanceRecordsByClassroom?.[String(classId)]
          || {};
        const attendanceDetailByClassroom = state.attendanceDetailByClassroom?.[classId]
          || state.attendanceDetailByClassroom?.[String(classId)]
          || {};

        const materials = (Array.isArray(rawMaterials) ? rawMaterials : []).map((material, index) => ({
          id: Number(material.id || index + 1),
          fileId: Number(material.fileId || material.file_id || 0) || null,
          title: String(material.title || material.description || material.fileName || `Material ${index + 1}`),
          fileName: String(material.fileName || material.title || `Material ${index + 1}`),
          size: String(material.size || material.fileSize || '-'),
          uploadedDate: toIsoDate(material.uploadedDate || material.createdAt) || '-',
          isNew: Boolean(material.isNew),
          description: material.description || ''
        }));

        const coTeachers = normalizeClassroomCoTeachers(classroom?.coTeachers);
        const allowedUploaderIds = new Set([
          Number(ownerTeacherId),
          ...coTeachers
            .map((entry) => Number(entry.teacherUserId))
            .filter((value) => Number.isInteger(value) && value > 0)
        ].filter((value) => Number.isInteger(value) && value > 0));

        const ownerClassroomMaterialFiles = (classroomMaterialFilesByClassroomId.get(classId) || [])
          .filter((fileRow) => {
            const uploaderId = Number(fileRow.user_id);
            return Number.isInteger(uploaderId) && allowedUploaderIds.has(uploaderId);
          });
        if (ownerClassroomMaterialFiles.length > 0) {
          const seenMaterialKeys = new Set(
            materials.map((item) => {
              const fileId = Number(item.fileId || 0);
              if (Number.isInteger(fileId) && fileId > 0) {
                return `id:${fileId}`;
              }
              return `name:${String(item.fileName || '').trim().toLowerCase()}`;
            })
          );

          ownerClassroomMaterialFiles.forEach((fileRow) => {
            const fileId = Number(fileRow.file_id);
            const fileName = String(fileRow.original_filename || '').trim();
            const key = Number.isInteger(fileId) && fileId > 0
              ? `id:${fileId}`
              : `name:${fileName.toLowerCase()}`;

            if (!fileName || seenMaterialKeys.has(key)) {
              return;
            }

            seenMaterialKeys.add(key);
            materials.push({
              id: Number.isInteger(fileId) && fileId > 0 ? fileId : (Date.now() + materials.length),
              fileId: Number.isInteger(fileId) && fileId > 0 ? fileId : null,
              title: fileName,
              fileName,
              size: String(fileRow.file_size || '-'),
              uploadedDate: toIsoDate(fileRow.uploaded_at) || '-',
              isNew: false,
              description: ''
            });
          });
        }

        const assignments = (Array.isArray(rawAssignments) ? rawAssignments : []).map((assignment, index) => {
          const assignmentId = toPositiveIntegerFromCandidates(assignment?.id, assignment?.assignmentId, index + 1);
          const submission = submissionMap.get(`${classId}:${assignmentId}`);
          const statusFromSubmission = submission
            ? (submission.grade !== null && submission.grade !== undefined ? 'Graded' : 'Submitted')
            : null;

          return {
            id: assignmentId,
            title: String(assignment.title || `Assignment ${index + 1}`),
            description: assignment.description || '',
            dueDate: toIsoDate(assignment.dueDate) || '-',
            resourceFile: assignment.resourceFile || '',
            status: statusFromSubmission || String(assignment.status || 'Pending'),
            submittedDate: submission ? toIsoDate(submission.submitted_at) : null,
            submittedFileId: submission?.file_id ? Number(submission.file_id) : null,
            submittedFileName: submission?.file_name || null,
            submittedFileSize: submission?.file_size || null,
            submittedComment: submission?.comment || '',
            grade: submission?.grade !== null && submission?.grade !== undefined
              ? `${Number(submission.grade)}/100`
              : null,
            feedback: submission?.feedback || ''
          };
        });

        const attendanceDates = Object.keys(attendanceDetailByClassroom || {});
        const attendanceHistory = attendanceDates
          .reduce((rows, dateKey) => {
            const statusMap = attendanceDetailByClassroom?.[dateKey];
            if (!statusMap || typeof statusMap !== 'object') {
              return rows;
            }

            const hasStudentRecord = Object.prototype.hasOwnProperty.call(statusMap, studentUserId)
              || Object.prototype.hasOwnProperty.call(statusMap, String(studentUserId));

            if (!hasStudentRecord) {
              return rows;
            }

            const rawValue = statusMap[studentUserId] ?? statusMap[String(studentUserId)];
            const recordMeta = attendanceRecordsByClassroom?.[dateKey] || {};
            rows.push({
              date: String(dateKey),
              present: Boolean(rawValue),
              takenBy: String(recordMeta.recordedByName || recordMeta.updatedByName || teacherName || 'Teacher'),
              takenAt: recordMeta.recordedAt || recordMeta.updatedAt || null,
              updatedBy: recordMeta.updatedByName || null,
              updatedAt: recordMeta.updatedAt || null
            });
            return rows;
          }, [])
          .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());

        const attendanceStats = attendanceDates.reduce((summary, dateKey) => {
          const statusMap = attendanceDetailByClassroom?.[dateKey];
          if (!statusMap || typeof statusMap !== 'object') {
            return summary;
          }

          const hasStudentRecord = Object.prototype.hasOwnProperty.call(statusMap, studentUserId)
            || Object.prototype.hasOwnProperty.call(statusMap, String(studentUserId));

          if (!hasStudentRecord) {
            return summary;
          }

          const rawValue = statusMap[studentUserId] ?? statusMap[String(studentUserId)];
          const isPresent = Boolean(rawValue);

          return {
            sessions: summary.sessions + 1,
            present: summary.present + (isPresent ? 1 : 0),
            absent: summary.absent + (isPresent ? 0 : 1)
          };
        }, { sessions: 0, present: 0, absent: 0 });

        const attendanceRate = attendanceStats.sessions > 0
          ? Number(((attendanceStats.present / attendanceStats.sessions) * 100).toFixed(1))
          : null;

        const subjectLower = String(classroom.subject || '').toLowerCase();
        let displayIcon = 'fa-book';
        let displayTone = 'blue';

        if (subjectLower.includes('physics')) {
          displayIcon = 'fa-atom';
          displayTone = 'purple';
        } else if (subjectLower.includes('chemistry') || subjectLower.includes('science') || subjectLower.includes('sains')) {
          displayIcon = 'fa-flask';
          displayTone = 'green';
        } else if (subjectLower.includes('biology') || subjectLower.includes('biologi')) {
          displayIcon = 'fa-microscope';
          displayTone = 'orange';
        } else if (subjectLower.includes('math')) {
          displayIcon = 'fa-calculator';
          displayTone = 'blue';
        } else if (subjectLower.includes('history') || subjectLower.includes('sejarah') || subjectLower.includes('geography') || subjectLower.includes('geografi')) {
          displayIcon = 'fa-landmark';
          displayTone = 'brown';
        } else if (subjectLower.includes('english') || subjectLower.includes('melayu') || subjectLower.includes('language')) {
          displayIcon = 'fa-language';
          displayTone = 'red';
        }

        const classPayload = {
          id: classIdentity,
          classroomId: classId,
          ownerTeacherId,
          title: String(classroom.classroomName || classroom.title || `Classroom ${classId}`),
          subject: String(classroom.subject || ''),
          teacher: teacherName,
          schedule: String(classroom.classSchedule || classroom.schedule || '-'),
          icon: displayIcon,
          tone: displayTone,
          attendance: {
            sessions: attendanceStats.sessions,
            present: attendanceStats.present,
            absent: attendanceStats.absent,
            rate: attendanceRate,
            history: attendanceHistory
          },
          materials,
          assignments
        };

        const existingClass = classById.get(classIdentity);
        const isOwnerSource = ownerTeacherId === Number(row.teacher_user_id);
        const existingIsOwnerSource = existingClass ? Boolean(existingClass._isOwnerSource) : false;

        if (!existingClass || (isOwnerSource && !existingIsOwnerSource)) {
          classById.set(classIdentity, { ...classPayload, _isOwnerSource: isOwnerSource });
        }
      });
    });

    const classes = Array.from(classById.values()).map(({ _isOwnerSource, ...rest }) => rest);

    return res.json({ classes });
  } catch (error) {
    console.error('Get student classes error:', error);
    return res.status(500).json({ error: 'Failed to fetch student classes' });
  }
}

async function submitStudentAssignment(req, res) {
  try {
    await ensureClassroomTables();

    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Student access required' });
    }

    const studentUserId = req.user.userId;
    const assignmentId = parseInt(req.params.assignmentId, 10);
    const routeClassroomId = parseInt(req.params.classroomId, 10);
    const bodyClassroomId = parseInt(req.body?.classroomId, 10);
    const classroomId = Number.isInteger(routeClassroomId) && routeClassroomId > 0
      ? routeClassroomId
      : bodyClassroomId;
    const requestedFileId = Number(req.body?.fileId);
    const fileName = String(req.body?.fileName || '').trim();
    const fileSize = String(req.body?.fileSize || '').trim();
    const comment = String(req.body?.comment || '').trim();

    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ error: 'Valid assignmentId is required' });
    }

    if (!Number.isInteger(classroomId) || classroomId <= 0) {
      return res.status(400).json({ error: 'Valid classroomId is required' });
    }

    const studentProfileResult = await pool.query(
      'SELECT student_level FROM users WHERE user_id = $1 LIMIT 1',
      [studentUserId]
    );
    const studentLevel = String(studentProfileResult.rows?.[0]?.student_level || '');

    const enrollmentRows = await pool.query(
      `SELECT target_id
       FROM user_enrollments
       WHERE user_id = $1
         AND target_type = 'classroom'
         AND enrollment_status = 'active'`,
      [studentUserId]
    ).catch(() => ({ rows: [] }));

    const enrolledClassroomIds = new Set(
      (enrollmentRows.rows || [])
        .map((row) => Number(row.target_id))
        .filter((value) => Number.isInteger(value) && value > 0)
    );

    const teacherStateRows = await pool.query(
      `SELECT
         tcs.teacher_user_id,
         tcs.state_json
       FROM teacher_classroom_states tcs
       JOIN users u ON u.user_id = tcs.teacher_user_id
       WHERE u.role = 'teacher'`
    );

    const eligibleClassroomIdsForAssignment = new Set();

    for (const stateRow of teacherStateRows.rows) {
      const state = normalizeTeacherState(stateRow.state_json);
      const classrooms = Array.isArray(state.classrooms) ? state.classrooms : [];

      for (const classroom of classrooms) {
        const candidateClassroomId = toPositiveIntegerFromCandidates(classroom?.classroomId, classroom?.id);
        if (!candidateClassroomId) {
          continue;
        }

        if (normalizeClassroomStatus(classroom?.status) === 'Archived') {
          continue;
        }

        const classAssignments = state.assignmentsByClassroom?.[candidateClassroomId]
          || state.assignmentsByClassroom?.[String(candidateClassroomId)]
          || [];

        const hasAssignment = (Array.isArray(classAssignments) ? classAssignments : []).some((assignment, index) => {
          const normalizedAssignmentId = toPositiveIntegerFromCandidates(assignment?.id, assignment?.assignmentId, index + 1);
          return normalizedAssignmentId === assignmentId;
        });

        if (!hasAssignment) {
          continue;
        }

        const roster = state.studentsByClassroom?.[candidateClassroomId]
          || state.studentsByClassroom?.[String(candidateClassroomId)]
          || [];
        const rosterList = Array.isArray(roster) ? roster : [];
        const isInRoster = rosterList.some((student) => {
          const rosterStudentId = toPositiveIntegerFromCandidates(student?.studentId, student?.userId, student?.id);
          return rosterStudentId === studentUserId;
        });
        const isEnrolled = enrolledClassroomIds.has(candidateClassroomId);
        const isAssociated = rosterList.length > 0 ? isInRoster : (isInRoster || isEnrolled);

        if (!isAssociated) {
          continue;
        }

        const classroomGradeLevel = String(classroom?.gradeLevel || '');
        if (!isStudentLevelAllowedForClassroom(studentLevel, classroomGradeLevel)) {
          continue;
        }

        eligibleClassroomIdsForAssignment.add(candidateClassroomId);
      }
    }

    let resolvedClassroomId = classroomId;
    if (!eligibleClassroomIdsForAssignment.has(resolvedClassroomId)) {
      if (eligibleClassroomIdsForAssignment.size === 1) {
        resolvedClassroomId = Array.from(eligibleClassroomIdsForAssignment)[0];
      } else {
        return res.status(400).json({
          error: 'Selected classroom does not match your eligible class for this assignment. Please refresh and try again.'
        });
      }
    }

    const fileId = Number.isInteger(requestedFileId) && requestedFileId > 0
      ? requestedFileId
      : null;

    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required. Please upload the submission file before submitting.' });
    }

    let resolvedFileName = fileName;
    let resolvedFileSize = fileSize;

    const fileLookup = await pool.query(
      `SELECT file_id, original_filename, file_size
       FROM files
       WHERE file_id = $1
         AND user_id = $2
         AND is_deleted = false
       LIMIT 1`,
      [fileId, studentUserId]
    );

    if (fileLookup.rows.length === 0) {
      return res.status(400).json({ error: 'Uploaded file is invalid or not accessible' });
    }

    const uploadedFile = fileLookup.rows[0];
    if (!resolvedFileName) {
      resolvedFileName = String(uploadedFile.original_filename || 'Submission');
    }
    if (!resolvedFileSize) {
      resolvedFileSize = String(uploadedFile.file_size || '');
    }

    if (!resolvedFileName) {
      return res.status(400).json({ error: 'fileName is required' });
    }

    const upsertResult = await pool.query(
      `INSERT INTO classroom_assignment_submissions
        (student_user_id, classroom_id, assignment_id, file_id, file_name, file_size, comment, submission_status, submitted_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, 'submitted', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (student_user_id, classroom_id, assignment_id)
       DO UPDATE SET
         file_id = EXCLUDED.file_id,
         file_name = EXCLUDED.file_name,
         file_size = EXCLUDED.file_size,
         comment = EXCLUDED.comment,
         submission_status = 'submitted',
         submitted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
       RETURNING submission_id, classroom_id, assignment_id, file_id, file_name, file_size, comment, submitted_at`,
      [studentUserId, resolvedClassroomId, assignmentId, fileId, resolvedFileName, resolvedFileSize || null, comment || null]
    );

    // Auto-share assignment submission to teachers personal storage is disabled as requested by user.

    await appendClassroomLog({
      actorUserId: studentUserId,
      actorRole: req.user.role,
      operationType: 'assignment_submitted',
      operationLabel: 'Assignment Submitted',
      target: resolvedFileName,
      targetType: 'Assignment',
      details: {
        classroomId: resolvedClassroomId,
        assignmentId,
        fileId
      }
    });

    const saved = upsertResult.rows[0];
    return res.json({
      message: 'Assignment submitted successfully',
      submission: {
        submissionId: saved.submission_id,
        classroomId: saved.classroom_id,
        assignmentId: saved.assignment_id,
        fileId: saved.file_id,
        fileName: saved.file_name,
        fileSize: saved.file_size,
        comment: saved.comment,
        submittedAt: saved.submitted_at
      }
    });
  } catch (error) {
    console.error('Submit student assignment error:', error);
    return res.status(500).json({ error: 'Failed to submit assignment' });
  }
}

async function unsubmitStudentAssignment(req, res) {
  try {
    await ensureClassroomTables();

    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Student access required' });
    }

    const studentUserId = req.user.userId;
    const assignmentId = Number.parseInt(req.params.assignmentId, 10);
    const routeClassroomId = Number.parseInt(req.params.classroomId, 10);
    const bodyClassroomId = Number.parseInt(req.body?.classroomId, 10);
    const classroomId = Number.isInteger(routeClassroomId) && routeClassroomId > 0
      ? routeClassroomId
      : bodyClassroomId;

    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ error: 'Valid assignmentId is required' });
    }

    if (!Number.isInteger(classroomId) || classroomId <= 0) {
      return res.status(400).json({ error: 'Valid classroomId is required' });
    }

    const existingResult = await pool.query(
      `SELECT submission_id, file_name, grade, submission_status
       FROM classroom_assignment_submissions
       WHERE student_user_id = $1
         AND classroom_id = $2
         AND assignment_id = $3
       LIMIT 1`,
      [studentUserId, classroomId, assignmentId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'No submission found for this assignment' });
    }

    const submission = existingResult.rows[0];
    const status = String(submission.submission_status || '').toLowerCase();
    const isGraded = submission.grade !== null && submission.grade !== undefined;

    if (isGraded || status === 'graded' || status === 'returned') {
      return res.status(400).json({ error: 'Graded submissions cannot be unsubmitted' });
    }

    await pool.query(
      `DELETE FROM classroom_assignment_submissions
       WHERE submission_id = $1`,
      [Number(submission.submission_id)]
    );

    await appendClassroomLog({
      actorUserId: studentUserId,
      actorRole: req.user.role,
      operationType: 'assignment_unsubmitted',
      operationLabel: 'Assignment Unsubmitted',
      target: String(submission.file_name || `Assignment ${assignmentId}`),
      targetType: 'Assignment',
      details: {
        classroomId,
        assignmentId,
        submissionId: Number(submission.submission_id)
      }
    });

    return res.json({ message: 'Assignment unsubmitted successfully' });
  } catch (error) {
    console.error('Unsubmit student assignment error:', error);
    return res.status(500).json({ error: 'Failed to unsubmit assignment' });
  }
}

async function gradeStudentSubmission(req, res) {
  try {
    await ensureClassroomTables();

    if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Teacher access required' });
    }

    const teacherUserId = req.user.userId;
    const routeClassroomId = Number.parseInt(req.params.classroomId, 10);
    const assignmentId = Number.parseInt(req.params.assignmentId, 10);
    const submissionId = Number.parseInt(req.params.submissionId, 10);
    const grade = Number(req.body?.grade);
    const feedback = String(req.body?.feedback || '').trim();

    if (req.params.classroomId !== undefined && (!Number.isInteger(routeClassroomId) || routeClassroomId <= 0)) {
      return res.status(400).json({ error: 'Valid classroomId is required' });
    }

    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return res.status(400).json({ error: 'Valid assignmentId is required' });
    }

    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ error: 'Valid submissionId is required' });
    }

    if (!Number.isFinite(grade) || grade < 0 || grade > 100) {
      return res.status(400).json({ error: 'Grade must be between 0 and 100' });
    }

    const submissionResult = await pool.query(
      `SELECT submission_id, classroom_id, assignment_id, file_name, student_user_id
       FROM classroom_assignment_submissions
       WHERE submission_id = $1
         AND assignment_id = $2
         AND ($3::int IS NULL OR classroom_id = $3)
       LIMIT 1`,
      [submissionId, assignmentId, Number.isInteger(routeClassroomId) && routeClassroomId > 0 ? routeClassroomId : null]
    );

    if (submissionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const submission = submissionResult.rows[0];
    const classroomId = Number(submission.classroom_id);

    const teacherStateRows = await pool.query(
      `SELECT
         tcs.teacher_user_id,
         tcs.state_json
       FROM teacher_classroom_states tcs
       JOIN users u ON u.user_id = tcs.teacher_user_id
       WHERE u.role = 'teacher'`
    );

    let canGradeSubmission = false;

    for (const row of teacherStateRows.rows) {
      const stateTeacherUserId = Number(row.teacher_user_id);
      if (!Number.isInteger(stateTeacherUserId) || stateTeacherUserId <= 0) {
        continue;
      }

      const state = normalizeTeacherState(row.state_json);
      const classrooms = Array.isArray(state.classrooms) ? state.classrooms : [];

      for (const classroom of classrooms) {
        const stateClassroomId = Number(classroom?.classroomId || classroom?.id);
        if (!Number.isInteger(stateClassroomId) || stateClassroomId !== classroomId) {
          continue;
        }

        const parsedOwnerTeacherId = Number(classroom?.ownerTeacherId);
        const hasExplicitOwnerTeacherId = Number.isInteger(parsedOwnerTeacherId) && parsedOwnerTeacherId > 0;
        const ownerTeacherId = hasExplicitOwnerTeacherId ? parsedOwnerTeacherId : stateTeacherUserId;

        if (ownerTeacherId !== stateTeacherUserId) {
          continue;
        }

        if (normalizeClassroomStatus(classroom?.status) === 'Archived') {
          return res.status(403).json({ error: 'Archived classes cannot be graded' });
        }

        if (ownerTeacherId === teacherUserId) {
          canGradeSubmission = true;
          break;
        }

        const coTeachers = normalizeClassroomCoTeachers(classroom?.coTeachers);
        const currentTeacherAccess = coTeachers.find((entry) => Number(entry?.teacherUserId) === Number(teacherUserId));
        if (currentTeacherAccess && normalizeTeacherAccessRole(currentTeacherAccess.accessRole) === 'teacher') {
          canGradeSubmission = true;
          break;
        }
      }

      if (canGradeSubmission) {
        break;
      }
    }

    if (!canGradeSubmission) {
      return res.status(403).json({ error: 'You do not have permission to grade this class' });
    }

    const updateResult = await pool.query(
      `UPDATE classroom_assignment_submissions
       SET grade = $1,
           feedback = $2,
           submission_status = 'graded',
           updated_at = CURRENT_TIMESTAMP
       WHERE submission_id = $3
         AND assignment_id = $4
         AND classroom_id = $5
       RETURNING submission_id, assignment_id, classroom_id, student_user_id, grade, feedback, submission_status, updated_at`,
      [grade, feedback || null, submissionId, assignmentId, classroomId]
    );

    const updated = updateResult.rows[0];

    await appendClassroomLog({
      actorUserId: teacherUserId,
      actorRole: req.user.role,
      operationType: 'assignment_graded',
      operationLabel: 'Assignment Graded',
      target: String(submission.file_name || `Submission ${submissionId}`),
      targetType: 'Assignment',
      details: {
        submissionId: updated.submission_id,
        assignmentId: updated.assignment_id,
        classroomId: updated.classroom_id,
        studentUserId: updated.student_user_id,
        grade: Number(updated.grade)
      }
    });

    return res.json({
      message: 'Submission graded successfully',
      submission: {
        submissionId: updated.submission_id,
        assignmentId: updated.assignment_id,
        classroomId: updated.classroom_id,
        studentUserId: updated.student_user_id,
        grade: Number(updated.grade),
        feedback: updated.feedback || '',
        status: updated.submission_status,
        updatedAt: updated.updated_at
      }
    });
  } catch (error) {
    console.error('Grade student submission error:', error);
    return res.status(500).json({ error: 'Failed to grade submission' });
  }
}

async function joinClassByCode(req, res) {
  try {
    await ensureClassroomTables();
    await ensureEnrollmentTable();

    if (req.user.role !== 'student') {
      return res.status(403).json({ error: 'Student access required' });
    }

    const studentUserId = req.user.userId;
    const joinCode = String(req.body?.joinCode || '').trim().toUpperCase();

    if (!joinCode) {
      return res.status(400).json({ error: 'Join code is required' });
    }

    const teacherStateRows = await pool.query(
      `SELECT
        tcs.teacher_user_id,
        tcs.state_json,
        u.full_name AS teacher_name
      FROM teacher_classroom_states tcs
      JOIN users u ON u.user_id = tcs.teacher_user_id
      WHERE u.role = 'teacher'
      ORDER BY tcs.updated_at DESC`
    );

    let matchedClassroom = null;
    for (const row of teacherStateRows.rows) {
      const state = normalizeTeacherState(row.state_json);
      const classrooms = Array.isArray(state.classrooms) ? state.classrooms : [];

      const found = classrooms.find((classroom) => {
        const classJoinCode = String(classroom.joinCode || '').trim().toUpperCase();
        const selfEnrollmentEnabled = Boolean(classroom.selfEnrollmentEnabled);
        return selfEnrollmentEnabled && classJoinCode && classJoinCode === joinCode;
      });

      if (found) {
        matchedClassroom = {
          teacherUserId: row.teacher_user_id,
          teacherName: row.teacher_name || 'Teacher',
          classroom: found,
          teacherState: state
        };
        break;
      }
    }

    if (!matchedClassroom) {
      return res.status(404).json({ error: 'Invalid join code or self-enrollment is disabled for this class' });
    }

    const classroomId = Number(matchedClassroom.classroom.classroomId || matchedClassroom.classroom.id);
    if (!Number.isInteger(classroomId) || classroomId <= 0) {
      return res.status(400).json({ error: 'Matched classroom has invalid id' });
    }

    const configuredMaximumCapacity = Number.parseInt(matchedClassroom.classroom.maximumCapacity, 10);
    const maximumCapacity = Number.isInteger(configuredMaximumCapacity) && configuredMaximumCapacity > 0
      ? configuredMaximumCapacity
      : null;

    const studentProfileResult = await pool.query(
      'SELECT student_level FROM users WHERE user_id = $1 LIMIT 1',
      [studentUserId]
    );
    const studentLevel = String(studentProfileResult.rows?.[0]?.student_level || '');
    const classroomGradeLevel = String(matchedClassroom.classroom.gradeLevel || '');

    if (!isStudentLevelAllowedForClassroom(studentLevel, classroomGradeLevel)) {
      return res.status(403).json({
        error: `Only ${classroomGradeLevel || 'eligible'} students can join this classroom`
      });
    }

    const enrollmentClient = await pool.connect();

    try {
      await enrollmentClient.query('BEGIN');

      const existingEnrollmentResult = await enrollmentClient.query(
        `SELECT enrollment_status
         FROM user_enrollments
         WHERE user_id = $1
           AND target_type = 'classroom'
           AND target_id = $2
         LIMIT 1`,
        [studentUserId, classroomId]
      );

      const alreadyActiveEnrollment = String(existingEnrollmentResult.rows?.[0]?.enrollment_status || '').toLowerCase() === 'active';

      const teacherState = normalizeTeacherState(matchedClassroom.teacherState || {});
      const rosterKey = String(classroomId);
      const existingRoster = teacherState.studentsByClassroom?.[rosterKey]
        || teacherState.studentsByClassroom?.[classroomId]
        || [];
      const normalizedRoster = Array.isArray(existingRoster) ? existingRoster : [];

      const alreadyInRoster = normalizedRoster.some((item) => {
        const rosterStudentId = Number(item?.studentId || item?.userId || item?.id);
        return Number.isInteger(rosterStudentId) && rosterStudentId === studentUserId;
      });

      if (!alreadyInRoster && Number.isInteger(maximumCapacity)) {
        // Count unique students by filtering out the student that is trying to join
        const currentActiveStudents = normalizedRoster.filter(item => {
          const rosterStudentId = Number(item?.studentId || item?.userId || item?.id);
          return Number.isInteger(rosterStudentId) && rosterStudentId !== studentUserId;
        }).length;

        if (currentActiveStudents >= maximumCapacity) {
          await enrollmentClient.query('ROLLBACK');
          return res.status(409).json({
            error: 'The class is full. Please ask your teacher for further action.'
          });
        }
      }

      // Check for schedule overlapping with existing enrollments
      const scheduleConflict = await checkUserScheduleConflict(studentUserId, classroomId, pool, getClassroomSchedule(matchedClassroom.classroom));
      if (scheduleConflict.hasConflict) {
        await enrollmentClient.query('ROLLBACK');
        return res.status(409).json({
          error: `You already have a class at this duration that conflicts with ${scheduleConflict.conflictingClassroomName || 'another class'}. Please ask your teacher to join another class.`
        });
      }

      await enrollmentClient.query(
        `INSERT INTO user_enrollments (user_id, target_type, target_id, enrollment_status, enrolled_at)
         VALUES ($1, 'classroom', $2, 'active', CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, target_type, target_id)
         DO UPDATE SET
           enrollment_status = 'active',
           enrolled_at = CURRENT_TIMESTAMP`,
        [studentUserId, classroomId]
      );

      await enrollmentClient.query('COMMIT');
    } catch (enrollmentError) {
      try {
        await enrollmentClient.query('ROLLBACK');
      } catch (rollbackError) {
        console.warn('Rollback failed during join class enrollment transaction:', rollbackError?.message || rollbackError);
      }
      throw enrollmentError;
    } finally {
      enrollmentClient.release();
    }

    try {
      const studentResult = await pool.query(
        `SELECT user_id, full_name, email
         FROM users
         WHERE user_id = $1
         LIMIT 1`,
        [studentUserId]
      );

      const studentRow = studentResult.rows?.[0] || null;
      const teacherState = normalizeTeacherState(matchedClassroom.teacherState || {});
      const rosterKey = String(classroomId);
      const existingRoster = teacherState.studentsByClassroom?.[rosterKey]
        || teacherState.studentsByClassroom?.[classroomId]
        || [];
      const normalizedRoster = Array.isArray(existingRoster) ? existingRoster : [];

      const alreadyInRoster = normalizedRoster.some((item) => {
        const rosterStudentId = Number(item?.studentId || item?.userId || item?.id);
        return Number.isInteger(rosterStudentId) && rosterStudentId === studentUserId;
      });

      if (!alreadyInRoster && studentRow) {
        const rosterEntry = {
          studentId: studentUserId,
          userId: studentUserId,
          name: String(studentRow.full_name || `Student ${studentUserId}`),
          studentNo: `S${String(studentUserId).padStart(3, '0')}`,
          email: String(studentRow.email || ''),
          status: 'Active'
        };

        const nextState = {
          ...teacherState,
          studentsByClassroom: {
            ...(teacherState.studentsByClassroom || {}),
            [rosterKey]: [...normalizedRoster, rosterEntry]
          }
        };

        await pool.query(
          `UPDATE teacher_classroom_states
           SET state_json = $2::jsonb,
               updated_at = CURRENT_TIMESTAMP
           WHERE teacher_user_id = $1`,
          [matchedClassroom.teacherUserId, JSON.stringify(nextState)]
        );
      }
    } catch (syncError) {
      console.warn('Failed to sync joined student into teacher roster:', syncError?.message || syncError);
    }

    await appendClassroomLog({
      actorUserId: studentUserId,
      actorRole: 'student',
      operationType: 'class_join_code',
      operationLabel: 'Join Classroom via Code',
      target: String(matchedClassroom.classroom.classroomName || matchedClassroom.classroom.title || `Classroom ${classroomId}`),
      targetType: 'Classroom',
      details: {
        classroomId,
        joinCode,
        teacherUserId: matchedClassroom.teacherUserId
      }
    });

    return res.json({
      message: 'Joined classroom successfully',
      classroom: {
        id: classroomId,
        title: String(matchedClassroom.classroom.classroomName || matchedClassroom.classroom.title || `Classroom ${classroomId}`),
        teacher: matchedClassroom.teacherName
      }
    });
  } catch (error) {
    console.error('Join class by code error:', error);
    return res.status(500).json({ error: 'Failed to join classroom by code' });
  }
}

async function getClassAnnouncements(req, res) {
  try {
    await ensureClassroomTables();

    const result = await pool.query(
      `SELECT
        announcement_id,
        classroom_id,
        classroom_name,
        message,
        author_name,
        created_at
       FROM classroom_announcements
       ORDER BY created_at DESC
       LIMIT 300`
    );

    const announcementsByClassroom = {};

    result.rows.forEach((row) => {
      const classroomId = Number(row.classroom_id);
      if (!Number.isInteger(classroomId)) {
        return;
      }

      if (!announcementsByClassroom[classroomId]) {
        announcementsByClassroom[classroomId] = [];
      }

      announcementsByClassroom[classroomId].push({
        id: row.announcement_id,
        classroomId,
        classroomName: row.classroom_name || `Classroom ${classroomId}`,
        message: row.message,
        createdAt: row.created_at,
        authorName: row.author_name || 'Teacher'
      });
    });

    return res.json({ announcementsByClassroom });
  } catch (error) {
    console.error('Get class announcements error:', error);
    return res.status(500).json({ error: 'Failed to fetch class announcements' });
  }
}

async function postClassAnnouncement(req, res) {
  try {
    await ensureClassroomTables();

    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Teacher access required' });
    }

    const classroomId = parseInt(req.body?.classroomId, 10);
    const classroomName = String(req.body?.classroomName || '').trim();
    const message = String(req.body?.message || '').trim();

    if (!Number.isInteger(classroomId) || classroomId <= 0) {
      return res.status(400).json({ error: 'Valid classroomId is required' });
    }

    if (!message) {
      return res.status(400).json({ error: 'Announcement message is required' });
    }

    if (message.length > 260) {
      return res.status(400).json({ error: 'Announcement message must be 260 characters or less' });
    }

    const authorUserId = req.user.userId;
    const authorNameResult = await pool.query(
      'SELECT full_name, teacher_title, role FROM users WHERE user_id = $1',
      [authorUserId]
    );
    const authorProfile = authorNameResult.rows[0] || null;
    const authorRole = String(authorProfile?.role || req.user.role || '').toLowerCase();
    const authorName = authorRole === 'teacher'
      ? formatAnnouncementAuthorName(authorProfile?.full_name, authorProfile?.teacher_title)
      : String(authorProfile?.full_name || 'Teacher');

    const insertResult = await pool.query(
      `INSERT INTO classroom_announcements
        (classroom_id, classroom_name, message, author_user_id, author_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING announcement_id, classroom_id, classroom_name, message, created_at, author_name`,
      [classroomId, classroomName || null, message, authorUserId, authorName]
    );

    await appendClassroomLog({
      actorUserId: authorUserId,
      actorRole: req.user.role,
      operationType: 'class_announcement_posted',
      operationLabel: 'Class Announcement Posted',
      target: classroomName || `Classroom ${classroomId}`,
      targetType: 'Announcement',
      details: {
        classroomId,
        messageLength: message.length
      }
    });

    const row = insertResult.rows[0];
    return res.status(201).json({
      message: 'Announcement posted successfully',
      announcement: {
        id: row.announcement_id,
        classroomId: row.classroom_id,
        classroomName: row.classroom_name || `Classroom ${row.classroom_id}`,
        message: row.message,
        createdAt: row.created_at,
        authorName: row.author_name || 'Teacher'
      }
    });
  } catch (error) {
    console.error('Post class announcement error:', error);
    return res.status(500).json({ error: 'Failed to post class announcement' });
  }
}

async function getAdminClassrooms(req, res) {
  try {
    await ensureClassroomTables();

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const statesResult = await pool.query(
      `SELECT
         tcs.teacher_user_id,
         tcs.state_json,
         tcs.updated_at,
         u.full_name,
         u.teacher_title
       FROM teacher_classroom_states tcs
       JOIN users u ON u.user_id = tcs.teacher_user_id
       WHERE u.role = 'teacher'
       ORDER BY u.full_name ASC`
    );

    const seen = new Set();
    const classrooms = [];
    const nowIso = new Date().toISOString();

    for (const row of statesResult.rows) {
      const ownerTeacherId = Number(row.teacher_user_id);
      if (!Number.isInteger(ownerTeacherId) || ownerTeacherId <= 0) {
        continue;
      }

      const state = normalizeTeacherState(row.state_json);
      const ownerTeacherName = formatAnnouncementAuthorName(row.full_name, row.teacher_title);
      const beforeSync = JSON.stringify(state);
      syncArchivedClassroomFolder(state, ownerTeacherId, ownerTeacherName, nowIso);
      if (beforeSync !== JSON.stringify(state)) {
        await pool.query(
          `UPDATE teacher_classroom_states
           SET state_json = $2::jsonb,
               updated_at = CURRENT_TIMESTAMP
           WHERE teacher_user_id = $1`,
          [ownerTeacherId, JSON.stringify(state)]
        );
      }

      const stateClassrooms = Array.isArray(state.classrooms) ? state.classrooms : [];

      stateClassrooms.forEach((classroom) => {
        const classroomId = Number(classroom?.classroomId || classroom?.id);
        if (!Number.isInteger(classroomId) || classroomId <= 0) {
          return;
        }

        const parsedOwnerTeacherId = Number(classroom?.ownerTeacherId);
        const hasExplicitOwnerTeacherId = Number.isInteger(parsedOwnerTeacherId) && parsedOwnerTeacherId > 0;
        const normalizedOwnerTeacherId = hasExplicitOwnerTeacherId ? parsedOwnerTeacherId : ownerTeacherId;
        if (normalizedOwnerTeacherId !== ownerTeacherId) {
          return;
        }

        const dedupeKey = `${ownerTeacherId}:${classroomId}`;
        if (seen.has(dedupeKey)) {
          return;
        }

        seen.add(dedupeKey);

        classrooms.push({
          classroomId,
          classroomName: String(classroom?.classroomName || `Classroom ${classroomId}`),
          status: normalizeClassroomStatus(classroom?.status),
          ownerTeacherId,
          ownerTeacherName,
          level: String(classroom?.level || '-'),
          classSchedule: String(classroom?.classSchedule || '-'),
          roomNumber: String(classroom?.roomNumber || '-'),
          startDate: classroom?.startDate || null,
          endDate: classroom?.endDate || null,
          updatedAt: classroom?.updatedAt || row.updated_at || null,
          location: normalizeClassroomStatus(classroom?.status) === 'Archived' ? 'Archived Folder' : 'Active Classrooms',
          archivedAt: null,
          expiresAt: null
        });
      });

      const archivedEntries = Array.isArray(state.archivedClassrooms) ? state.archivedClassrooms : [];
      archivedEntries.forEach((entry) => {
        const normalizedEntry = normalizeArchivedEntry(entry);
        if (!normalizedEntry || normalizedEntry.ownerTeacherId !== ownerTeacherId) {
          return;
        }

        const dedupeKey = `${ownerTeacherId}:${normalizedEntry.classroomId}`;
        if (seen.has(dedupeKey)) {
          const existingIndex = classrooms.findIndex(
            (item) => Number(item.ownerTeacherId) === ownerTeacherId && Number(item.classroomId) === normalizedEntry.classroomId
          );
          if (existingIndex >= 0) {
            classrooms[existingIndex] = {
              ...classrooms[existingIndex],
              status: 'Archived',
              location: 'Archived Folder',
              archivedAt: normalizedEntry.archivedAt || null,
              expiresAt: normalizedEntry.expiresAt || null,
              updatedAt: normalizedEntry.lastActionAt || normalizedEntry.archivedAt || classrooms[existingIndex].updatedAt
            };
          }
          return;
        }

        seen.add(dedupeKey);
        classrooms.push({
          classroomId: normalizedEntry.classroomId,
          classroomName: String(normalizedEntry.classroom?.classroomName || `Classroom ${normalizedEntry.classroomId}`),
          status: 'Archived',
          ownerTeacherId,
          ownerTeacherName,
          level: String(normalizedEntry.classroom?.level || '-'),
          classSchedule: String(normalizedEntry.classroom?.classSchedule || '-'),
          roomNumber: String(normalizedEntry.classroom?.roomNumber || '-'),
          startDate: normalizedEntry.classroom?.startDate || null,
          endDate: normalizedEntry.classroom?.endDate || null,
          updatedAt: normalizedEntry.lastActionAt || normalizedEntry.archivedAt || row.updated_at || null,
          location: 'Archived Folder',
          archivedAt: normalizedEntry.archivedAt || null,
          expiresAt: normalizedEntry.expiresAt || null
        });
      });
    }

    classrooms.sort((left, right) => {
      const leftTime = new Date(left.updatedAt || 0).getTime();
      const rightTime = new Date(right.updatedAt || 0).getTime();
      return rightTime - leftTime;
    });

    return res.json({ classrooms });
  } catch (error) {
    console.error('Get admin classrooms error:', error);
    return res.status(500).json({ error: 'Failed to fetch classrooms' });
  }
}

async function restoreAdminClassroom(req, res) {
  try {
    await ensureClassroomTables();

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const classroomId = Number(req.params.classroomId);
    const ownerTeacherId = Number(req.body?.ownerTeacherId);

    if (!Number.isInteger(classroomId) || classroomId <= 0) {
      return res.status(400).json({ error: 'Valid classroomId is required' });
    }

    if (!Number.isInteger(ownerTeacherId) || ownerTeacherId <= 0) {
      return res.status(400).json({ error: 'Valid ownerTeacherId is required' });
    }

    const ownerResult = await pool.query(
      `SELECT
         tcs.state_json,
         u.full_name,
         u.teacher_title
       FROM teacher_classroom_states tcs
       JOIN users u ON u.user_id = tcs.teacher_user_id
       WHERE tcs.teacher_user_id = $1
         AND u.role = 'teacher'`,
      [ownerTeacherId]
    );

    if (ownerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Classroom owner not found' });
    }

    const ownerRow = ownerResult.rows[0];
    const ownerState = normalizeTeacherState(ownerRow.state_json);
    const ownerTeacherName = formatAnnouncementAuthorName(ownerRow.full_name, ownerRow.teacher_title);
    const nowIso = new Date().toISOString();
    syncArchivedClassroomFolder(ownerState, ownerTeacherId, ownerTeacherName, nowIso);

    const archiveKey = `${ownerTeacherId}:${classroomId}`;
    const archivedEntries = Array.isArray(ownerState.archivedClassrooms) ? ownerState.archivedClassrooms : [];
    const archiveIndex = archivedEntries.findIndex((entry) => {
      const normalizedEntry = normalizeArchivedEntry(entry);
      if (!normalizedEntry) {
        return false;
      }
      return `${normalizedEntry.ownerTeacherId}:${normalizedEntry.classroomId}` === archiveKey;
    });

    if (archiveIndex < 0) {
      return res.status(400).json({ error: 'Classroom is not archived' });
    }

    const archivedEntry = normalizeArchivedEntry(archivedEntries[archiveIndex]);
    if (!archivedEntry) {
      return res.status(400).json({ error: 'Archived classroom data is invalid' });
    }

    const restoredClassroom = {
      ...(archivedEntry.classroom || {}),
      classroomId,
      ownerTeacherId,
      ownerTeacherName,
      status: 'Active',
      updatedAt: nowIso
    };

    const existingClassroomIndex = (Array.isArray(ownerState.classrooms) ? ownerState.classrooms : []).findIndex((classroom) => {
      const currentClassroomId = Number(classroom?.classroomId || classroom?.id);
      const currentOwnerTeacherId = Number(classroom?.ownerTeacherId || ownerTeacherId);
      return currentClassroomId === classroomId && currentOwnerTeacherId === ownerTeacherId;
    });

    if (existingClassroomIndex >= 0) {
      ownerState.classrooms[existingClassroomIndex] = {
        ...ownerState.classrooms[existingClassroomIndex],
        ...restoredClassroom
      };
    } else {
      ownerState.classrooms = [...(Array.isArray(ownerState.classrooms) ? ownerState.classrooms : []), restoredClassroom];
    }

    const snapshot = archivedEntry.snapshot && typeof archivedEntry.snapshot === 'object'
      ? archivedEntry.snapshot
      : {};
    const classroomKey = String(classroomId);

    ownerState.materialsByClassroom = {
      ...(ownerState.materialsByClassroom || {}),
      [classroomKey]: snapshot.materialsByClassroom || []
    };
    ownerState.assignmentsByClassroom = {
      ...(ownerState.assignmentsByClassroom || {}),
      [classroomKey]: snapshot.assignmentsByClassroom || []
    };
    ownerState.studentsByClassroom = {
      ...(ownerState.studentsByClassroom || {}),
      [classroomKey]: snapshot.studentsByClassroom || []
    };
    ownerState.attendanceRecordsByClassroom = {
      ...(ownerState.attendanceRecordsByClassroom || {}),
      [classroomKey]: snapshot.attendanceRecordsByClassroom || {}
    };
    ownerState.attendanceStudentStatsByClassroom = {
      ...(ownerState.attendanceStudentStatsByClassroom || {}),
      [classroomKey]: snapshot.attendanceStudentStatsByClassroom || {}
    };
    ownerState.attendanceDetailByClassroom = {
      ...(ownerState.attendanceDetailByClassroom || {}),
      [classroomKey]: snapshot.attendanceDetailByClassroom || {}
    };

    const snapshotSubmissionMap = snapshot.gradingSubmissionsByAssignment && typeof snapshot.gradingSubmissionsByAssignment === 'object'
      ? snapshot.gradingSubmissionsByAssignment
      : {};

    Object.entries(snapshotSubmissionMap).forEach(([assignmentKey, rows]) => {
      const normalizedRows = Array.isArray(rows)
        ? rows.filter((row) => Number(row?.classroomId) === classroomId)
        : [];
      if (normalizedRows.length === 0) {
        return;
      }

      const existingRows = Array.isArray(ownerState.gradingSubmissionsByAssignment?.[assignmentKey])
        ? ownerState.gradingSubmissionsByAssignment[assignmentKey]
        : [];
      const mergedRows = [
        ...existingRows.filter((row) => Number(row?.classroomId) !== classroomId),
        ...normalizedRows
      ];

      ownerState.gradingSubmissionsByAssignment = {
        ...(ownerState.gradingSubmissionsByAssignment || {}),
        [assignmentKey]: mergedRows
      };
    });

    ownerState.archivedClassrooms = archivedEntries.filter((_, index) => index !== archiveIndex);

    await pool.query(
      `UPDATE teacher_classroom_states
       SET state_json = $2::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE teacher_user_id = $1`,
      [ownerTeacherId, JSON.stringify(ownerState)]
    );

    const restoredClassroomName = String(restoredClassroom?.classroomName || `Classroom ${classroomId}`);
    await appendClassroomLog({
      actorUserId: req.user.userId,
      actorRole: req.user.role,
      operationType: 'class_restored',
      operationLabel: 'Class Restored',
      target: restoredClassroomName,
      targetType: 'Classroom',
      details: {
        classroomId,
        ownerTeacherId,
        ownerTeacherName,
        restoredFrom: 'Archived Folder'
      }
    });

    return res.json({
      message: 'Class restored successfully',
      classroom: {
        classroomId,
        ownerTeacherId,
        classroomName: restoredClassroomName,
        status: 'Active'
      }
    });
  } catch (error) {
    console.error('Restore admin classroom error:', error);
    return res.status(500).json({ error: 'Failed to restore classroom' });
  }
}

async function getClassroomAuditLogs(req, res) {
  try {
    await ensureClassroomTables();

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const {
      page = 1,
      limit = 20,
      status,
      operationType,
      search
    } = req.query;

    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (parsedPage - 1) * parsedLimit;

    const params = [];
    const where = [];
    let paramCount = 0;

    if (status) {
      paramCount += 1;
      where.push(`cal.status = $${paramCount}`);
      params.push(String(status).trim().toLowerCase());
    }

    if (operationType) {
      paramCount += 1;
      where.push(`cal.operation_type = $${paramCount}`);
      params.push(String(operationType).trim());
    }

    if (search) {
      paramCount += 1;
      where.push(`(
        cal.operation_label ILIKE $${paramCount}
        OR cal.target ILIKE $${paramCount}
        OR COALESCE(u.full_name, '') ILIKE $${paramCount}
      )`);
      params.push(`%${String(search).trim()}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM classroom_activity_logs cal
       LEFT JOIN users u ON u.user_id = cal.actor_user_id
       ${whereSql}`,
      params
    );

    const total = countResult.rows[0]?.total || 0;

    const listResult = await pool.query(
      `SELECT
        cal.log_id,
        cal.created_at,
        cal.operation_type,
        cal.operation_label,
        cal.target,
        cal.target_type,
        cal.status,
        cal.details,
        COALESCE(u.full_name, 'System') AS user_name,
        COALESCE(u.role, cal.actor_role, 'system') AS user_role,
        u.user_id
       FROM classroom_activity_logs cal
       LEFT JOIN users u ON u.user_id = cal.actor_user_id
       ${whereSql}
       ORDER BY cal.created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, parsedLimit, offset]
    );

    const logs = listResult.rows.map((row, index) => {
      const role = String(row.user_role || '').toLowerCase();
      const prefix = role === 'teacher' ? 'T' : role === 'student' ? 'S' : role === 'admin' ? 'A' : 'U';
      const code = row.user_id ? `${prefix}${String(row.user_id).padStart(3, '0')}` : 'SYS';
      return {
        id: row.log_id,
        timestamp: row.created_at,
        operation: row.operation_label,
        operationType: row.operation_type,
        userName: row.user_name,
        userCode: code,
        userRole: role ? role.charAt(0).toUpperCase() + role.slice(1) : 'System',
        target: row.target || '-',
        targetType: row.target_type || 'Classroom',
        status: row.status || 'success',
        details: row.details || null
      };
    });

    return res.json({
      logs,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages: Math.ceil(total / parsedLimit)
      }
    });
  } catch (error) {
    console.error('Get classroom audit logs error:', error);
    return res.status(500).json({ error: 'Failed to fetch classroom audit logs' });
  }
}

async function getClassroomAuditStats(req, res) {
  try {
    await ensureClassroomTables();

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const statsResult = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'success')::int AS successful,
        COUNT(*) FILTER (WHERE status = 'warning')::int AS warnings,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM classroom_activity_logs
    `);

    const stats = statsResult.rows[0] || {
      total: 0,
      successful: 0,
      warnings: 0,
      failed: 0
    };

    return res.json({ stats });
  } catch (error) {
    console.error('Get classroom audit stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch classroom audit stats' });
  }
}

async function exportClassroomAuditLogs(req, res) {
  try {
    await ensureClassroomTables();

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await pool.query(
      `SELECT
        cal.created_at,
        cal.operation_type,
        cal.operation_label,
        cal.target,
        cal.target_type,
        cal.status,
        COALESCE(u.full_name, 'System') AS user_name,
        COALESCE(u.role, cal.actor_role, 'system') AS user_role
       FROM classroom_activity_logs cal
       LEFT JOIN users u ON u.user_id = cal.actor_user_id
       ORDER BY cal.created_at DESC`
    );

    let csv = 'Timestamp,Operation Type,Operation Label,User,Role,Target,Target Type,Status\n';
    result.rows.forEach((row) => {
      csv += `"${row.created_at}","${row.operation_type}","${row.operation_label}","${row.user_name}","${row.user_role}","${row.target || '-'}","${row.target_type || '-'}","${row.status}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=classroom-audit-logs-${Date.now()}.csv`);
    return res.send(csv);
  } catch (error) {
    console.error('Export classroom audit logs error:', error);
    return res.status(500).json({ error: 'Failed to export classroom audit logs' });
  }
}

async function checkScheduleConflict(req, res) {
  try {
    const { studentId, classroomId } = req.body;
    
    if (!studentId || !classroomId) {
      return res.status(400).json({ error: 'studentId and classroomId are required' });
    }

    const scheduleConflict = await checkUserScheduleConflict(studentId, classroomId, pool);
    return res.json({
      hasConflict: scheduleConflict.hasConflict,
      conflictingClassroomName: scheduleConflict.conflictingClassroomName
    });
  } catch (error) {
    console.error('Check schedule conflict error:', error);
    return res.status(500).json({ error: 'Failed to verify schedule' });
  }
}

module.exports = {
  getTeacherState,
  saveTeacherState,
  getStudentClasses,
  joinClassByCode,
  submitStudentAssignment,
  unsubmitStudentAssignment,
  gradeStudentSubmission,
  getClassAnnouncements,
  postClassAnnouncement,
  getAdminClassrooms,
  restoreAdminClassroom,
  getClassroomAuditLogs,
  getClassroomAuditStats,
  exportClassroomAuditLogs,
  checkScheduleConflict
};
