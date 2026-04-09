const pool = require('../config/database');
const Session = require('../models/Session');
const { hashPassword } = require('../utils/encryption');
const { logAudit } = require('../utils/auditLogger');
const {
  sendTemporaryPasswordEmail,
  sendRoleStatusChangedEmail,
  sendEnrollmentConfirmationEmail,
  sendWelcomeEmail
} = require('../services/emailService');
const User = require('../models/User');
const { checkUserScheduleConflict } = require('../utils/scheduleMatcher');

const EXPORT_RATE_TRACKER = new Map();

const ALLOWED_ROLES = ['admin', 'teacher', 'student'];
const ALLOWED_STATUS = ['active', 'inactive', 'suspended'];
const RBAC_ROLES = ['admin', 'teacher', 'student'];
const RBAC_PERMISSIONS = ['create', 'read', 'update', 'delete', 'execute'];
const BYTES_PER_GB = 1024 * 1024 * 1024;
const STUDENT_LEVEL_SEQUENCE = [
  'Standard 1',
  'Standard 2',
  'Standard 3',
  'Standard 4',
  'Standard 5',
  'Standard 6',
  'Form 1',
  'Form 2',
  'Form 3',
  'Form 4',
  'Form 5'
];
const STORAGE_QUOTA_BY_ROLE = {
  student: 1 * BYTES_PER_GB,
  teacher: 2 * BYTES_PER_GB
};

const DEFAULT_ROLE_PERMISSIONS = {
  admin: {
    user_management: RBAC_PERMISSIONS,
    storage: RBAC_PERMISSIONS,
    classroom: RBAC_PERMISSIONS,
    profile: RBAC_PERMISSIONS
  },
  teacher: {
    classroom: ['read', 'update', 'execute'],
    storage: ['create', 'read', 'update'],
    profile: ['read', 'update']
  },
  student: {
    classroom: ['read', 'execute'],
    storage: ['create', 'read'],
    profile: ['read', 'update']
  }
};

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function isValidFullName(fullName) {
  return /^[A-Za-z\s]+$/.test(String(fullName || '').trim());
}

function isStrongPassword(password) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(String(password || ''));
}

function normalizeStudentLevel(level) {
  const safe = String(level || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const match = STUDENT_LEVEL_SEQUENCE.find((item) => item.toLowerCase() === safe);
  return match || null;
}

function normalizeLevelValue(level) {
  return String(level || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isAllLevelClassroom(level) {
  const normalized = normalizeLevelValue(level);
  return normalized === 'all level' || normalized === 'all levels';
}

function promoteStudentLevel(level, yearsToPromote = 1) {
  const normalized = normalizeStudentLevel(level);
  if (!normalized) {
    return null;
  }

  const index = STUDENT_LEVEL_SEQUENCE.indexOf(normalized);
  if (index < 0) {
    return null;
  }

  const safeYears = Math.max(parseInt(yearsToPromote, 10) || 0, 0);
  const nextIndex = Math.min(STUDENT_LEVEL_SEQUENCE.length - 1, index + safeYears);
  return STUDENT_LEVEL_SEQUENCE[nextIndex];
}

async function ensureStudentLevelColumns() {
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS student_level VARCHAR(30)');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS student_level_updated_year INTEGER');
}

async function promoteStudentsForCurrentYear() {
  const currentYear = new Date().getFullYear();
  const candidates = await pool.query(
    `SELECT user_id, student_level, student_level_updated_year
     FROM users
     WHERE role = 'student'
       AND student_level IS NOT NULL
       AND student_level <> ''
       AND COALESCE(student_level_updated_year, 0) < $1`,
    [currentYear]
  );

  for (const row of candidates.rows) {
    const yearsToPromote = Math.max(currentYear - (parseInt(row.student_level_updated_year, 10) || currentYear), 0);
    if (yearsToPromote <= 0) {
      continue;
    }

    const promotedLevel = promoteStudentLevel(row.student_level, yearsToPromote);
    if (!promotedLevel) {
      continue;
    }

    await pool.query(
      `UPDATE users
       SET student_level = $1,
           student_level_updated_year = $2
       WHERE user_id = $3`,
      [promotedLevel, currentYear, row.user_id]
    );
  }
}

function getStorageQuotaByRole(role) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'admin') {
    return 0; // Admin does not have a quota limit, but database column cannot be null
  }
  return STORAGE_QUOTA_BY_ROLE[normalizedRole] || STORAGE_QUOTA_BY_ROLE.student;
}

function generateTemporaryPassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()_+-=';
  let generated = '';
  for (let index = 0; index < length; index += 1) {
    generated += chars[Math.floor(Math.random() * chars.length)];
  }

  if (!isStrongPassword(generated)) {
    return `Tc@${Math.random().toString(36).slice(2, 10)}9A`;
  }

  return generated;
}

function parseCsvLine(line) {
  const parsed = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      parsed.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  parsed.push(current.trim());
  return parsed;
}

function escapeCsv(value) {
  const safe = value === null || value === undefined ? '' : String(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

async function ensureRbacTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_permission_id SERIAL PRIMARY KEY,
      role VARCHAR(30) NOT NULL,
      module_key VARCHAR(100) NOT NULL,
      permission_key VARCHAR(30) NOT NULL,
      updated_by INTEGER,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(role, module_key, permission_key)
    )
  `);
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

async function listUsers(req, res) {
  try {
    await ensureStudentLevelColumns();
    await promoteStudentsForCurrentYear();

    const {
      page = 1,
      limit = 20,
      search = '',
      role,
      status
    } = req.query;

    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (parsedPage - 1) * parsedLimit;

    const whereClauses = [];
    const params = [];
    let paramCount = 0;

    if (search) {
      const trimmedSearch = search.trim();
      paramCount += 1;
      const searchParam = `%${trimmedSearch}%`;
      
      // Check for numeric ID or prefixed ID like S123, T456
      const idMatch = trimmedSearch.match(/^[A-Za-z]?(\d+)$/);
      
      if (idMatch) {
        const idValue = parseInt(idMatch[1], 10);
        whereClauses.push(`(u.full_name ILIKE $${paramCount} OR u.email ILIKE $${paramCount} OR u.user_id = $${paramCount + 1})`);
        params.push(searchParam, idValue);
        paramCount += 1;
      } else {
        whereClauses.push(`(u.full_name ILIKE $${paramCount} OR u.email ILIKE $${paramCount})`);
        params.push(searchParam);
      }
    }

    if (role && role !== 'all') {
      const normalizedRole = normalizeRole(role);
      if (ALLOWED_ROLES.includes(normalizedRole)) {
        paramCount += 1;
        whereClauses.push(`u.role = $${paramCount}`);
        params.push(normalizedRole);
      }
    }

    if (req.query.level && req.query.level !== '' && req.query.level !== 'all') {
      paramCount += 1;
      whereClauses.push(`u.student_level = $${paramCount}`);
      params.push(req.query.level);
    }

    if (status && status !== 'all') {
      const normalizedStatus = normalizeStatus(status);
      if (ALLOWED_STATUS.includes(normalizedStatus)) {
        paramCount += 1;
        whereClauses.push(`u.account_status = $${paramCount}`);
        params.push(normalizedStatus);
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM users u ${whereSql}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const listResult = await pool.query(
      `SELECT
        u.user_id,
        u.email,
        u.full_name,
        u.role,
        u.student_level,
        u.student_level_updated_year,
        u.account_status,
        u.is_active,
        u.phone_number,
        u.profile_picture_url,
        GREATEST(COALESCE(fs.storage_used, 0), COALESCE(u.storage_used, 0)) AS storage_used,
        CASE
          WHEN u.role = 'teacher' THEN ${STORAGE_QUOTA_BY_ROLE.teacher}
          WHEN u.role = 'student' THEN ${STORAGE_QUOTA_BY_ROLE.student}
          ELSE NULL
        END AS storage_quota,
        ROUND((GREATEST(COALESCE(fs.storage_used, 0), COALESCE(u.storage_used, 0))::numeric / ${BYTES_PER_GB}), 3) AS storage_used_gb,
        CASE
          WHEN u.role = 'teacher' THEN 2
          WHEN u.role = 'student' THEN 1
          ELSE NULL
        END AS storage_quota_gb,
        u.created_at,
        u.last_login
      FROM users u
      LEFT JOIN (
        SELECT
          user_id,
          SUM(
            CASE
              WHEN file_size::text ~ '^[0-9]+$' THEN file_size::bigint
              ELSE 0
            END
          )::bigint AS storage_used
        FROM files
        WHERE is_deleted = false
        GROUP BY user_id
      ) fs ON fs.user_id = u.user_id
      ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, parsedLimit, offset]
    );

    const statsResult = await pool.query(`
      SELECT
        COUNT(*)::int AS total_users,
        SUM(CASE WHEN role = 'teacher' THEN 1 ELSE 0 END)::int AS total_teachers,
        SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END)::int AS total_students,
        SUM(CASE WHEN is_active = true AND account_status = 'active' THEN 1 ELSE 0 END)::int AS active_users
      FROM users
    `);

    res.json({
      users: listResult.rows,
      stats: statsResult.rows[0] || {
        total_users: 0,
        total_teachers: 0,
        total_students: 0,
        active_users: 0
      },
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages: Math.ceil(total / parsedLimit)
      }
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
}

async function getUserStats(req, res) {
  try {
    const statsResult = await pool.query(`
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE role = 'teacher')::int AS total_teachers,
        COUNT(*) FILTER (WHERE role = 'student')::int AS total_students,
        COUNT(*) FILTER (WHERE is_active = true AND account_status = 'active')::int AS active_users
      FROM users
    `);

    res.json({
      stats: statsResult.rows[0] || {
        total_users: 0,
        total_teachers: 0,
        total_students: 0,
        active_users: 0
      }
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({ error: 'Failed to fetch user statistics' });
  }
}

async function addUser(req, res) {
  try {
    await ensureStudentLevelColumns();

    const { email, fullName, role, temporaryPassword, studentLevel } = req.body;
    const adminId = req.user.userId;
    const ipAddress = req.ip || req.connection.remoteAddress;

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!isValidFullName(fullName)) {
      return res.status(400).json({ error: 'Full name can only contain alphabetic characters and spaces' });
    }

    const normalizedRole = normalizeRole(role);
    if (!ALLOWED_ROLES.includes(normalizedRole)) {
      return res.status(400).json({ error: 'Invalid role. Allowed values: Admin, Teacher, Student' });
    }

    const normalizedStudentLevel = normalizedRole === 'student' ? normalizeStudentLevel(studentLevel) : null;
    if (normalizedRole === 'student' && !normalizedStudentLevel) {
      return res.status(400).json({
        error: 'Student level is required for student role. Allowed values: Standard 1-6, Form 1-5.'
      });
    }

    const existing = await pool.query('SELECT user_id FROM users WHERE email = $1', [String(email).trim().toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const resolvedPassword = temporaryPassword || generateTemporaryPassword();
    if (!isStrongPassword(resolvedPassword)) {
      return res.status(400).json({ error: 'Password must be at least 8 chars with uppercase, lowercase, number, and special character' });
    }

    const passwordHash = await hashPassword(resolvedPassword);
    const quota = getStorageQuotaByRole(normalizedRole);
    const currentYear = new Date().getFullYear();
    const insertResult = await pool.query(
      `INSERT INTO users (email, full_name, role, password_hash, account_status, is_active, storage_quota, student_level, student_level_updated_year)
       VALUES ($1, $2, $3, $4, 'active', true, $5, $6, $7)
       RETURNING user_id, email, full_name, role, student_level, account_status, created_at`,
      [
        String(email).trim().toLowerCase(),
        String(fullName).trim(),
        normalizedRole,
        passwordHash,
        quota,
        normalizedStudentLevel,
        normalizedRole === 'student' ? currentYear : null
      ]
    );

    const createdUser = insertResult.rows[0];

    await logAudit({
      userId: adminId,
      sessionId: req.sessionId,
      operationType: 'admin_user_create',
      ipAddress,
      operationDetails: JSON.stringify({
        createdUserId: createdUser.user_id,
        createdEmail: createdUser.email,
        role: createdUser.role,
        studentLevel: createdUser.student_level || null
      }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });

    sendTemporaryPasswordEmail(createdUser.email, createdUser.full_name, resolvedPassword).catch((error) => {
      console.error('Temporary password email failed:', error.message);
    });

    res.status(201).json({
      message: 'User created successfully',
      user: createdUser,
      temporaryPasswordGenerated: !temporaryPassword
    });
  } catch (error) {
    console.error('Add user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
}

async function editUser(req, res) {
  try {
    await ensureStudentLevelColumns();

    const userId = parseInt(req.params.userId, 10);
    const adminId = req.user.userId;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const { fullName, email, role, status, studentLevel } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const existingResult = await pool.query(
      'SELECT user_id, email, full_name, role, student_level, account_status FROM users WHERE user_id = $1',
      [userId]
    );
    const existingUser = existingResult.rows[0];
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (adminId === userId && (role || status)) {
      return res.status(403).json({ error: 'Administrators cannot change their own role or status' });
    }

    const nextEmail = email !== undefined ? String(email).trim().toLowerCase() : existingUser.email;
    const nextName = fullName !== undefined ? String(fullName).trim() : existingUser.full_name;
    const nextRole = role !== undefined ? normalizeRole(role) : existingUser.role;
    const nextStatus = status !== undefined ? normalizeStatus(status) : existingUser.account_status;
    const currentYear = new Date().getFullYear();
    const normalizedStudentLevel = nextRole === 'student'
      ? normalizeStudentLevel(studentLevel !== undefined ? studentLevel : existingUser.student_level)
      : null;

    if (!isValidEmail(nextEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!isValidFullName(nextName)) {
      return res.status(400).json({ error: 'Full name can only contain alphabetic characters and spaces' });
    }

    if (!ALLOWED_ROLES.includes(nextRole)) {
      return res.status(400).json({ error: 'Invalid role. Allowed values: Admin, Teacher, Student' });
    }

    if (!ALLOWED_STATUS.includes(nextStatus)) {
      return res.status(400).json({ error: 'Invalid status. Allowed values: Active, Inactive, Suspended' });
    }

    if (nextRole === 'student' && !normalizedStudentLevel) {
      return res.status(400).json({
        error: 'Student level is required for student role. Allowed values: Standard 1-6, Form 1-5.'
      });
    }

    const duplicateEmailResult = await pool.query(
      'SELECT user_id FROM users WHERE email = $1 AND user_id != $2',
      [nextEmail, userId]
    );
    if (duplicateEmailResult.rows.length > 0) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const modifiedFields = [];
    if (existingUser.email !== nextEmail) modifiedFields.push('email');
    if (existingUser.full_name !== nextName) modifiedFields.push('full_name');
    if (existingUser.role !== nextRole) modifiedFields.push('role');
    if ((existingUser.student_level || null) !== (normalizedStudentLevel || null)) modifiedFields.push('student_level');
    if (existingUser.account_status !== nextStatus) modifiedFields.push('account_status');
    const nextIsActive = nextStatus === 'active';

    const updateResult = await pool.query(
      `UPDATE users
       SET email = $1,
           full_name = $2,
           role = $3,
           account_status = $4,
           is_active = $5,
           storage_quota = $6,
           student_level = $7,
           student_level_updated_year = $8
       WHERE user_id = $9
       RETURNING user_id, email, full_name, role, student_level, account_status`,
      [
        nextEmail,
        nextName,
        nextRole,
        nextStatus,
        nextIsActive,
        getStorageQuotaByRole(nextRole),
        normalizedStudentLevel,
        nextRole === 'student' ? currentYear : null,
        userId
      ]
    );

    const updatedUser = updateResult.rows[0];

    if (existingUser.role !== nextRole || existingUser.account_status !== nextStatus) {
      await Session.invalidateAllUserSessions(userId);
      sendRoleStatusChangedEmail(updatedUser.email, updatedUser.full_name, {
        oldRole: existingUser.role,
        newRole: nextRole,
        oldStatus: existingUser.account_status,
        newStatus: nextStatus
      }).catch((error) => {
        console.error('Role/status notification email failed:', error.message);
      });
    }

    await logAudit({
      userId: adminId,
      sessionId: req.sessionId,
      operationType: 'admin_user_edit',
      ipAddress,
      operationDetails: JSON.stringify({
        editedUserId: userId,
        modifiedFields,
        before: existingUser,
        after: {
          email: nextEmail,
          full_name: nextName,
          role: nextRole,
          student_level: normalizedStudentLevel,
          account_status: nextStatus
        }
      }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });

    res.json({
      message: 'User updated successfully',
      user: updatedUser,
      modifiedFields
    });
  } catch (error) {
    console.error('Edit user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
}

async function resetUserPassword(req, res) {
  try {
    const userId = parseInt(req.params.userId, 10);
    const adminId = req.user.userId;
    const ipAddress = req.ip || req.connection.remoteAddress;

    const userResult = await pool.query(
      'SELECT user_id, email, full_name FROM users WHERE user_id = $1',
      [userId]
    );

    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    await pool.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [passwordHash, userId]);
    await Session.invalidateAllUserSessions(userId);

    let emailSent = true;
    let emailErrorMessage = '';

    try {
      await sendTemporaryPasswordEmail(user.email, user.full_name, temporaryPassword);
    } catch (emailError) {
      emailSent = false;
      emailErrorMessage = emailError.message;

      await logAudit({
        userId: adminId,
        sessionId: req.sessionId,
        operationType: 'admin_user_system_reset_password',
        ipAddress,
        operationDetails: JSON.stringify({
          resetUserId: userId,
          userEmail: user.email,
          emailSent: false,
          reason: emailError.message
        }),
        status: 'warning',
        userAgent: req.headers['user-agent']
      });
    }

    if (emailSent) {
      await logAudit({
        userId: adminId,
        sessionId: req.sessionId,
        operationType: 'admin_user_system_reset_password',
        ipAddress,
        operationDetails: JSON.stringify({
          resetUserId: userId,
          userEmail: user.email,
          emailSent: true
        }),
        status: 'success',
        userAgent: req.headers['user-agent']
      });
    }

    res.json({
      message: emailSent
        ? 'System reset successful. A temporary password has been sent to the user email.'
        : 'System reset successful, but email sending failed. Please share the temporary password manually.',
      emailSent,
      emailSentTo: emailSent ? user.email : null,
      temporaryPassword: emailSent ? null : temporaryPassword,
      emailError: emailSent ? null : emailErrorMessage
    });
  } catch (error) {
    console.error('Reset user password error:', error);
    res.status(500).json({ error: 'Failed to reset user password' });
  }
}

async function enrollUsers(req, res) {
  try {
    const { userIds, targetType, targetId } = req.body;
    const adminId = req.user.userId;
    const ipAddress = req.ip || req.connection.remoteAddress;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'At least one user must be selected' });
    }

    const normalizedTargetType = String(targetType || '').trim().toLowerCase();
    if (!['classroom', 'course'].includes(normalizedTargetType)) {
      return res.status(400).json({ error: 'targetType must be classroom or course' });
    }

    const parsedTargetId = parseInt(targetId, 10);
    if (!parsedTargetId) {
      return res.status(400).json({ error: 'Valid targetId is required' });
    }

    await ensureEnrollmentTable();

    const parsedUserIds = [...new Set(userIds.map((value) => parseInt(value, 10)).filter(Boolean))];
    const usersResult = await pool.query(
      'SELECT user_id, email, full_name, role, student_level FROM users WHERE user_id = ANY($1::int[])',
      [parsedUserIds]
    );

    const users = usersResult.rows;
    const userMap = new Map(users.map((item) => [item.user_id, item]));

    const success = [];
    const failed = [];

    let classroomGradeLevel = '';
    let classroomFound = false;
    if (normalizedTargetType === 'classroom') {
      const teacherStateRows = await pool.query(
        'SELECT state_json FROM teacher_classroom_states'
      ).catch(() => ({ rows: [] }));

      for (const stateRow of teacherStateRows.rows || []) {
        const classrooms = Array.isArray(stateRow?.state_json?.classrooms)
          ? stateRow.state_json.classrooms
          : [];

        const matched = classrooms.find((classroom) => {
          const classId = Number(classroom?.classroomId || classroom?.id);
          return Number.isInteger(classId) && classId === parsedTargetId;
        });

        if (matched) {
          classroomFound = true;
          classroomGradeLevel = String(matched.gradeLevel || '');
          break;
        }
      }

      if (!classroomFound) {
        return res.status(404).json({ error: 'Classroom not found for enrollment' });
      }
    }

    for (const selectedUserId of parsedUserIds) {
      const foundUser = userMap.get(selectedUserId);
      if (!foundUser) {
        failed.push({ userId: selectedUserId, reason: 'User not found' });
        continue;
      }

      const roleAllowed =
        (normalizedTargetType === 'classroom' && foundUser.role === 'student') ||
        (normalizedTargetType === 'course' && foundUser.role === 'teacher');

      if (!roleAllowed) {
        failed.push({
          userId: selectedUserId,
          reason: `Role ${foundUser.role} is not valid for ${normalizedTargetType} enrollment`
        });
        continue;
      }

      if (
        normalizedTargetType === 'classroom'
        && classroomGradeLevel
        && !isAllLevelClassroom(classroomGradeLevel)
      ) {
        const normalizedStudentLevel = normalizeLevelValue(foundUser.student_level);
        const normalizedClassroomLevel = normalizeLevelValue(classroomGradeLevel);
        if (!normalizedStudentLevel || normalizedStudentLevel !== normalizedClassroomLevel) {
          failed.push({
            userId: selectedUserId,
            reason: `Student level mismatch: requires ${classroomGradeLevel}`
          });
          continue;
        }
      }

      if (normalizedTargetType === 'classroom') {
        const scheduleConflict = await checkUserScheduleConflict(selectedUserId, parsedTargetId, pool);
        if (scheduleConflict.hasConflict) {
          failed.push({
            userId: selectedUserId,
            reason: `Schedule conflict with existing class: ${scheduleConflict.conflictingClassroomName || 'another class'}`
          });
          continue;
        }
      }

      try {
        const enrollmentInsertResult = await pool.query(
          `INSERT INTO user_enrollments (user_id, target_type, target_id, enrollment_status, enrolled_by)
           VALUES ($1, $2, $3, 'active', $4)
           ON CONFLICT (user_id, target_type, target_id) DO NOTHING
           RETURNING enrollment_id`,
          [selectedUserId, normalizedTargetType, parsedTargetId, adminId]
        );

        if (enrollmentInsertResult.rows.length === 0) {
          failed.push({ userId: selectedUserId, reason: 'Duplicate enrollment' });
          continue;
        }

        success.push({
          userId: selectedUserId,
          fullName: foundUser.full_name,
          email: foundUser.email
        });

        sendEnrollmentConfirmationEmail(foundUser.email, foundUser.full_name, {
          targetType: normalizedTargetType,
          targetId: parsedTargetId,
          enrolledAt: new Date().toISOString()
        }).catch((error) => {
          console.error('Enrollment email failed:', error.message);
        });
      } catch (error) {
        failed.push({ userId: selectedUserId, reason: error.message });
      }
    }

    await logAudit({
      userId: adminId,
      sessionId: req.sessionId,
      operationType: 'admin_users_enroll',
      ipAddress,
      operationDetails: JSON.stringify({
        targetType: normalizedTargetType,
        targetId: parsedTargetId,
        requestedUserIds: parsedUserIds,
        successCount: success.length,
        failedCount: failed.length
      }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });

    res.json({
      message: 'Enrollment process completed',
      summary: {
        totalSelected: parsedUserIds.length,
        successCount: success.length,
        failedCount: failed.length
      },
      enrolled: success,
      failed
    });
  } catch (error) {
    console.error('Enroll users error:', error);
    res.status(500).json({ error: 'Failed to enroll users' });
  }
}

async function getRolePermissions(req, res) {
  try {
    await ensureRbacTables();

    const rows = await pool.query(
      `SELECT role, module_key, permission_key
       FROM role_permissions
       ORDER BY role, module_key, permission_key`
    );

    const matrix = {};
    RBAC_ROLES.forEach((role) => {
      matrix[role] = {};
    });

    for (const row of rows.rows) {
      if (!matrix[row.role]) {
        matrix[row.role] = {};
      }
      if (!matrix[row.role][row.module_key]) {
        matrix[row.role][row.module_key] = [];
      }
      matrix[row.role][row.module_key].push(row.permission_key);
    }

    for (const role of RBAC_ROLES) {
      if (Object.keys(matrix[role]).length === 0 && DEFAULT_ROLE_PERMISSIONS[role]) {
        matrix[role] = DEFAULT_ROLE_PERMISSIONS[role];
      }
    }

    res.json({
      roles: RBAC_ROLES,
      permissions: RBAC_PERMISSIONS,
      matrix
    });
  } catch (error) {
    console.error('Get role permissions error:', error);
    res.status(500).json({ error: 'Failed to load role permissions' });
  }
}

async function updateRolePermissions(req, res) {
  const client = await pool.connect();
  try {
    await ensureRbacTables();
    const adminId = req.user.userId;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const { role, permissionsByModule, confirm } = req.body;
    const normalizedRole = normalizeRole(role);

    if (normalizedRole === 'admin') {
      return res.status(403).json({ error: 'Admin role permissions cannot be modified' });
    }

    if (!['teacher', 'student'].includes(normalizedRole)) {
      return res.status(400).json({ error: 'Only Teacher and Student role permissions can be modified' });
    }

    if (confirm !== true) {
      return res.status(400).json({ error: 'Permission changes require explicit confirmation' });
    }

    if (!permissionsByModule || typeof permissionsByModule !== 'object') {
      return res.status(400).json({ error: 'permissionsByModule is required' });
    }

    const flattened = [];
    for (const [moduleKey, permissions] of Object.entries(permissionsByModule)) {
      const normalizedModuleKey = String(moduleKey || '').trim().toLowerCase();
      if (!normalizedModuleKey) {
        return res.status(400).json({ error: 'Invalid module name in permissions payload' });
      }

      if (!Array.isArray(permissions)) {
        return res.status(400).json({ error: `Permissions for module ${moduleKey} must be an array` });
      }

      for (const permission of permissions) {
        const normalizedPermission = String(permission || '').trim().toLowerCase();
        if (!RBAC_PERMISSIONS.includes(normalizedPermission)) {
          return res.status(400).json({ error: `Invalid permission: ${permission}` });
        }

        flattened.push({
          moduleKey: normalizedModuleKey,
          permissionKey: normalizedPermission
        });
      }
    }

    await client.query('BEGIN');

    await client.query('DELETE FROM role_permissions WHERE role = $1', [normalizedRole]);

    for (const item of flattened) {
      await client.query(
        `INSERT INTO role_permissions (role, module_key, permission_key, updated_by)
         VALUES ($1, $2, $3, $4)`,
        [normalizedRole, item.moduleKey, item.permissionKey, adminId]
      );
    }

    await client.query(
      `UPDATE user_sessions s
       SET is_active = false,
           logged_out_at = CURRENT_TIMESTAMP
       FROM users u
       WHERE s.user_id = u.user_id
         AND s.is_active = true
         AND u.role = $1`,
      [normalizedRole]
    );

    await client.query('COMMIT');

    await logAudit({
      userId: adminId,
      sessionId: req.sessionId,
      operationType: 'admin_rbac_update',
      ipAddress,
      operationDetails: JSON.stringify({ role: normalizedRole, changes: flattened }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });

    res.json({ message: 'Role permissions updated successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update role permissions error:', error);
    res.status(500).json({ error: 'Failed to update role permissions' });
  } finally {
    client.release();
  }
}

async function resetRolePermissions(req, res) {
  const client = await pool.connect();
  try {
    await ensureRbacTables();
    const adminId = req.user.userId;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const role = normalizeRole(req.params.role);

    if (!['teacher', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Only Teacher and Student roles can be reset' });
    }

    const defaults = DEFAULT_ROLE_PERMISSIONS[role];
    await client.query('BEGIN');
    await client.query('DELETE FROM role_permissions WHERE role = $1', [role]);

    for (const [moduleKey, permissions] of Object.entries(defaults)) {
      for (const permission of permissions) {
        await client.query(
          `INSERT INTO role_permissions (role, module_key, permission_key, updated_by)
           VALUES ($1, $2, $3, $4)`,
          [role, moduleKey, permission, adminId]
        );
      }
    }

    await client.query('COMMIT');

    await logAudit({
      userId: adminId,
      sessionId: req.sessionId,
      operationType: 'admin_rbac_reset',
      ipAddress,
      operationDetails: JSON.stringify({ role }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });

    res.json({ message: `Role permissions reset to defaults for ${role}` });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Reset role permissions error:', error);
    res.status(500).json({ error: 'Failed to reset role permissions' });
  } finally {
    client.release();
  }
}

async function downloadImportTemplate(req, res) {
  const template = [
    'email,full_name,role,status,student_level,phone_number,temporary_password',
    'student1@example.com,Student One,Student,Active,Standard 3,0123456789,Tc@mpPass1!',
    'teacher1@example.com,Teacher One,Teacher,Active,,0111111111,'
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=user_import_template.csv');
  res.send(template);
}

async function importUsers(req, res) {
  const client = await pool.connect();
  try {
    await ensureStudentLevelColumns();

    const adminId = req.user.userId;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }

    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      return res.status(400).json({ error: 'Only CSV files are allowed' });
    }

    if (file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds 5MB limit' });
    }

    const content = file.buffer.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);

    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV file has no data rows' });
    }

    const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
    const requiredColumns = ['email', 'full_name', 'role', 'status'];
    const missingColumns = requiredColumns.filter((column) => !headers.includes(column));

    if (missingColumns.length > 0) {
      return res.status(400).json({
        error: 'CSV is missing required columns',
        missingColumns
      });
    }

    const indexMap = headers.reduce((accumulator, header, index) => {
      accumulator[header] = index;
      return accumulator;
    }, {});

    const errors = [];
    const success = [];

    await client.query('BEGIN');

    for (let lineNumber = 1; lineNumber < lines.length; lineNumber += 1) {
      const row = parseCsvLine(lines[lineNumber]);
      const rowNumber = lineNumber + 1;

      const email = String(row[indexMap.email] || '').trim().toLowerCase();
      const fullName = String(row[indexMap.full_name] || '').trim();
      const role = normalizeRole(row[indexMap.role]);
      const status = normalizeStatus(row[indexMap.status]);
      const studentLevel = normalizeStudentLevel(row[indexMap.student_level]);
      const phoneNumber = String(row[indexMap.phone_number] || '').trim() || null;
      const providedPassword = String(row[indexMap.temporary_password] || '').trim();

      if (!isValidEmail(email)) {
        errors.push({ row: rowNumber, email, reason: 'Invalid email format' });
        continue;
      }

      if (!isValidFullName(fullName)) {
        errors.push({ row: rowNumber, email, reason: 'Invalid full name format' });
        continue;
      }

      if (!ALLOWED_ROLES.includes(role)) {
        errors.push({ row: rowNumber, email, reason: 'Invalid role value' });
        continue;
      }

      if (!['active', 'inactive'].includes(status)) {
        errors.push({ row: rowNumber, email, reason: 'Invalid status value' });
        continue;
      }

      if (role === 'student' && !studentLevel) {
        errors.push({
          row: rowNumber,
          email,
          reason: 'student_level is required for student role (Standard 1-6 or Form 1-5)'
        });
        continue;
      }

      const emailExists = await client.query('SELECT user_id FROM users WHERE email = $1', [email]);
      if (emailExists.rows.length > 0) {
        errors.push({ row: rowNumber, email, reason: 'Email already exists' });
        continue;
      }

      const temporaryPassword = providedPassword || generateTemporaryPassword();
      if (!isStrongPassword(temporaryPassword)) {
        errors.push({ row: rowNumber, email, reason: 'Temporary password does not meet complexity rules' });
        continue;
      }

      const passwordHash = await hashPassword(temporaryPassword);
      const currentYear = new Date().getFullYear();

      const insertResult = await client.query(
        `INSERT INTO users (email, full_name, role, account_status, is_active, phone_number, password_hash, storage_quota, student_level, student_level_updated_year)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING user_id, email, full_name`,
        [
          email,
          fullName,
          role,
          status,
          status === 'active',
          phoneNumber,
          passwordHash,
          getStorageQuotaByRole(role),
          role === 'student' ? studentLevel : null,
          role === 'student' ? currentYear : null
        ]
      );

      success.push({
        row: rowNumber,
        userId: insertResult.rows[0].user_id,
        email,
        fullName
      });

      sendWelcomeEmail(email, fullName, temporaryPassword).catch((error) => {
        console.error('Welcome email failed:', error.message);
      });
    }

    await client.query('COMMIT');

    await logAudit({
      userId: adminId,
      sessionId: req.sessionId,
      operationType: 'admin_users_import',
      ipAddress,
      operationDetails: JSON.stringify({
        fileName: file.originalname,
        totalRows: lines.length - 1,
        successfulImports: success.length,
        failedImports: errors.length
      }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });

    res.json({
      message: 'Import completed',
      summary: {
        totalRows: lines.length - 1,
        successfulImports: success.length,
        failedImports: errors.length
      },
      successful: success,
      failed: errors
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Import users error:', error);
    res.status(500).json({ error: 'Failed to import users' });
  } finally {
    client.release();
  }
}

async function downloadImportErrors(req, res) {
  try {
    const failedRows = Array.isArray(req.body?.failedRows) ? req.body.failedRows : [];
    let csv = 'row,email,reason\n';
    for (const row of failedRows) {
      csv += `${escapeCsv(row.row)},${escapeCsv(row.email)},${escapeCsv(row.reason)}\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=import_errors_${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Download import errors error:', error);
    res.status(500).json({ error: 'Failed to download import error report' });
  }
}

async function exportUsers(req, res) {
  try {
    const adminId = req.user.userId;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const {
      role,
      status,
      dateFrom,
      dateTo,
      mode = 'all',
      userIds,
      pageSize = 1000
    } = req.query;

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const existingHits = EXPORT_RATE_TRACKER.get(adminId) || [];
    const recentHits = existingHits.filter((time) => time > oneHourAgo);
    if (recentHits.length >= 10) {
      return res.status(429).json({ error: 'Export rate limit exceeded. Maximum 10 exports per hour.' });
    }
    recentHits.push(now);
    EXPORT_RATE_TRACKER.set(adminId, recentHits);

    const whereClauses = [];
    const params = [];
    let paramCount = 0;

    if (mode === 'selected') {
      const parsedUserIds = String(userIds || '')
        .split(',')
        .map((value) => parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0);

      if (parsedUserIds.length === 0) {
        return res.status(400).json({ error: 'Please provide at least one user to export' });
      }

      paramCount += 1;
      whereClauses.push(`user_id = ANY($${paramCount}::int[])`);
      params.push(parsedUserIds);
    } else if (mode === 'filtered') {
      if (role) {
        const normalizedRole = normalizeRole(role);
        if (ALLOWED_ROLES.includes(normalizedRole)) {
          paramCount += 1;
          whereClauses.push(`role = $${paramCount}`);
          params.push(normalizedRole);
        }
      }

      if (status) {
        const normalizedStatus = normalizeStatus(status);
        if (ALLOWED_STATUS.includes(normalizedStatus)) {
          paramCount += 1;
          whereClauses.push(`account_status = $${paramCount}`);
          params.push(normalizedStatus);
        }
      }

      if (dateFrom) {
        paramCount += 1;
        whereClauses.push(`created_at >= $${paramCount}`);
        params.push(dateFrom);
      }

      if (dateTo) {
        paramCount += 1;
        whereClauses.push(`created_at <= $${paramCount}`);
        params.push(dateTo);
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) AS total FROM users ${whereSql}`, params);
    const total = parseInt(countResult.rows[0].total, 10);

    const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19).replace(/-/g, '_');
    const filename = `users_export_${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.write('user_id,email,full_name,role,status,created_date,last_login\n');

    const parsedPageSize = Math.min(Math.max(parseInt(pageSize, 10) || 1000, 100), 5000);
    let exportedCount = 0;

    for (let offset = 0; offset < total; offset += parsedPageSize) {
      const batchResult = await pool.query(
        `SELECT user_id, email, full_name, role, account_status, created_at, last_login
         FROM users
         ${whereSql}
         ORDER BY user_id ASC
         LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
        [...params, parsedPageSize, offset]
      );

      for (const user of batchResult.rows) {
        const createdDate = user.created_at
          ? new Date(user.created_at).toISOString().replace('T', ' ').slice(0, 19)
          : '';
        const lastLogin = user.last_login
          ? new Date(user.last_login).toISOString().replace('T', ' ').slice(0, 19)
          : '';

        res.write([
          user.user_id,
          escapeCsv(user.email),
          escapeCsv(user.full_name),
          escapeCsv(user.role),
          escapeCsv(user.account_status),
          escapeCsv(createdDate),
          escapeCsv(lastLogin)
        ].join(',') + '\n');

        exportedCount += 1;
      }
    }

    await logAudit({
      userId: adminId,
      sessionId: req.sessionId,
      operationType: 'admin_users_export',
      ipAddress,
      operationDetails: JSON.stringify({ filters: { role, status, dateFrom, dateTo, mode, userIds }, exportedCount }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });

    res.end();
  } catch (error) {
    console.error('Export users error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export users' });
      return;
    }
    res.end();
  }
}

async function deleteUser(req, res) {
  try {
    const userId = parseInt(req.params.userId, 10);
    const adminId = req.user.userId;
    const ipAddress = req.ip || req.connection.remoteAddress;

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    if (adminId === userId) {
      return res.status(403).json({ error: 'Administrators cannot delete their own account' });
    }

    console.log('🗑️ Attempting to delete user ID:', userId, 'by admin:', adminId);

    const userResult = await pool.query(
      'SELECT email, full_name, role FROM users WHERE user_id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const deletedUser = userResult.rows[0];

    // Delete user (cascade should handle dependencies if set up, or add manual cleanup)
    await pool.query('DELETE FROM users WHERE user_id = $1', [userId]);

    await logAudit({
      userId: adminId,
      sessionId: req.sessionId,
      operationType: 'admin_user_delete',
      ipAddress,
      operationDetails: JSON.stringify({
        deletedUserId: userId,
        deletedEmail: deletedUser.email,
        deletedName: deletedUser.full_name,
        deletedRole: deletedUser.role
      }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user. Ensure there are no dependent records.' });
  }
}

module.exports = {
  listUsers,
  getUserStats,
  addUser,
  editUser,
  deleteUser,
  resetUserPassword,
  enrollUsers,
  getRolePermissions,
  updateRolePermissions,
  resetRolePermissions,
  downloadImportTemplate,
  importUsers,
  downloadImportErrors,
  exportUsers
};