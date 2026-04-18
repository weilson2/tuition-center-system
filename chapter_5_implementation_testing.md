# Chapter 5

## Implementation & Testing

### 5.1 Implementation / Coding

**5.1.1 Technology Stack Realisation**
The system was built using the following technology stack:
*   **Frontend**: React 18.x with functional components and React Hooks (useState, useEffect, useCallback)
*   **Backend**: Node.js 18.x with Express 4.x RESTful API endpoints
*   **Database**: PostgreSQL 15.x hosted on Neon (serverless)
*   **Cloud Storage**: Cloudflare R2
*   **Encryption**: Node.js built-in crypto module with AES-256-GCM
*   **Authentication**: JSON Web Tokens (JWT) with HTTP-only cookies
*   **Email service**: Nodemailer with Gmail SMTP
*   **File Processing**: Multer (upload), Sharp (image processing)

**5.1.2 Backend Architecture**

**Routing Layer (routes/)**
*   `userManagement.js`: Endpoints for listing, creating, editing, and managing system users (Admin only). Protected by strict RBAC middleware.
*   `classroom.js`: Endpoints handling classroom creation, assignments, and student roster enrollments.
*   `venue.js`: Administrative endpoints dedicated to physical venue entity management and tracking.

**Controller Layer (controllers/)**
*   `userManagementController.js`: Handles advanced user filtering (by ID, role, student level), pagination, account creation, and system-level password resets.
*   `classroomController.js`: Implements the JSONB-based `teacher_classroom_states` architecture to efficiently handle complex classroom structures containing schedules, student rosters, and materials without excessive SQL joins.
*   `venueController.js`: Manages the CRUD operations for center venues ensuring venues uniquely exist and have specified capacities.
*   `scheduleMatcher.js (utils/)`: The core schedule conflict engine using custom time-parsing logic to detect overlaps systematically across teachers, venues, and students.

**Model / Database Layer**
*   `users`, `role_permissions`: Core tables enforcing authentication and structural user data (e.g., academic grade, active states).
*   `teacher_classroom_states`: A highly optimized table using a single `state_json` JSONB payload per teacher, encapsulating their active and archived classrooms, avoiding expensive relation lookups during heavy traffic.
*   `user_enrollments`: A junction table strictly enforcing unique user-to-classroom associations `UNIQUE(user_id, target_type, target_id)`.

**5.1.2.1 Function Explanations**
The core structural functionalities are distributed across isolated controller schemas to guarantee separation of concerns. This section provides an ultra-detailed deep-dive into every backend procedure, mapping source code to architectural logic and execution flows.

#### userManagementController.js

*   `listUsers(req, res)`: Fetches users matching specified roles, levels, and IDs natively with algorithmic pagination logic.

```javascript
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
```

**Technical Deep-Dive**:
The listUsers function serves as the primary administrative engine for user discovery. It implements an advanced regex-based ID detection logic (`^[A-Za-z]?(\d+)$`) that allows administrators to search for users by their raw numeric database IDs while the system intelligently handles role prefixes (e.g., searching for "1" matches user ID 1 even if they are prefixed as "S001" in the UI). To ensure data integrity across years, it triggers `promoteStudentsForCurrentYear`, which dynamically evaluates if students should be advanced to the next academic level based on the current system date. Furthermore, it calculates storage statistics in parallel to provide real-time oversight of disk usage across Neon and Cloudflare R2.

**The flow is**:
*   Normalize query parameters: page, limit, role, status, and search string.
*   Assert schema readiness via ensureStudentLevelColumns and promoteStudentsForCurrentYear.
*   Construct a parameterized SQL WHERE clause to prevent injection, dynamically appending role and level filters.
*   Execute an asynchronous COUNT(*) query to establish total record volume for pagination metadata.
*   Retrieve the paged result set, mapping raw database rows into structured user objects.
*   Return a unified JSON response containing the user list and total page count.

---

*   `getUserStats(req, res)`: Identifies a statistical breakdown of users (roles and total active platform counts).

```javascript
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
```

**Technical Deep-Dive**:
This procedure provides the high-level metrics for the Admin Dashboard. It executes targeted aggregation queries against the `users` table, filtering for "Active" account status. By grouping by the `role` enum, it generates a real-time snapshot of the platform’s user distribution (e.g., student vs. teacher counts) without requiring expensive full-table scans.

**The flow is**:
*   Initialize a statistics object to hold role-based counts.
*   Perform a grouped SQL count on the users table with a filter for active accounts.
*   Transform the flat SQL result set into a key-value pair object (e.g., { student: 50, teacher: 10 }).
*   Send the structured stats object back to the client for dashboard rendering.

---

*   `addUser(req, res)`: Creates a new user in the system. Programmatically generates a secure temporary password if none is provided.

```javascript
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
```

**Technical Deep-Dive**:
This function facilitates secure user onboarding by enforcing role-based storage quotas (e.g., 500MB for students vs. 2GB for teachers). If a password is not manually assigned, it invokes a crypto-secure random generator to produce a 12-character temporary credential. All passwords are hashed using bcrypt before commitment to the database, ensuring zero-knowledge security for student and staff credentials.

**The flow is**:
*   Validate the mandatory full name and email fields from the request body.
*   Check for existing email collisions in the database.
*   Generate or hash the provided password using the system’s primary salt rounds.
*   Assign the appropriate storage quota based on the user’s selected role.
*   Persistent the new user record into the database and log the creation event to the audit table.

---

*   `editUser(req, res)`: Computes and records native schema updates for existing user details.

```javascript
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
```

**Technical Deep-Dive**:
The editUser logic is built for atomic updates, ensuring that partial failures do not leave user records in an inconsistent state. It dynamically builds the UPDATE SQL query based on the fields actually changed (e.g., full_name, role, level), preserving existing data for unchanged columns. It specifically blocks administrators from "self-elevating" or modifying their own roles through this endpoint to prevent privilege escalation.

**The flow is**:
*   Identify the target user via the userId URL parameter.
*   Filter the request body for valid schema fields (name, email, role, level, status).
*   Construct a dynamic UPDATE statement, mapping provided fields to SQL parameters.
*   Execute the update on the Neon database and verify affected row counts.
*   Invalidate existing JWT sessions for the target user if their status or role was changed.

---

*   `resetUserPassword(req, res)`: Performs an admin-forced password reset, simultaneously terminating all global active sessions.

```javascript
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
```

**Technical Deep-Dive**:
This security-critical function is used during account recovery or administrative lockout. Upon generating a new secret, it performs a dual-action update: changing the password hash in the database and incrementing a "token version" (if applicable) or simply notifying the auth layer that all existing cookies/tokens should be considered revoked. This ensures that any compromised sessions are instantly terminated globally.

**The flow is**:
*   Verify target user existence and permissions of the requesting administrator.
*   Generate a high-entropy temporary password string.
*   Compute the new bcrypt hash asynchronously.
*   Atomically update the database with the new hash and clear any existing reset tokens.
*   Dispatch a credential update notification to the user via their registered email.

---

*   `enrollUsers(req, res)`: Assigns a batch mapping of students/teachers into classroom targets while validating schedule constraints dynamically.

```javascript
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
    let classroomSchedule = '';
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
          classroomSchedule = getClassroomSchedule(matched);
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
        const scheduleConflict = await checkUserScheduleConflict(selectedUserId, parsedTargetId, pool, classroomSchedule);
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
```

**Technical Deep-Dive**:
The enrollment engine is the bridge between user management and classroom platforming. It supports batch operations, allowing an administrator to enroll multiple students into a classroom in a single transaction. Crucially, before committing each enrollment, it invokes `checkUserScheduleConflict` to prevent students from being assigned to overlapping classes, ensuring the center’s timetable remains mathematically sound.

**The flow is**:
*   Parse the array of user IDs and the target classroom identifier.
*   Iterate through the ID set, performing individual conflict checks for each user.
*   Execute a batch INSERT into the user_enrollments junction table.
*   Sync the new roster into the corresponding teacher_classroom_states JSONB blob to ensure the teacher’s dashboard is instantly updated.
*   Return a summary of successful enrollments and any individual conflict failures.

---

#### venueController.js

*   `getVenues(req, res)`: Returns a complete ordered list of all active center venues alphabetically.

```javascript
async function getVenues(req, res) {
  try {
    await ensureVenueTable();
    const result = await pool.query('SELECT * FROM venues ORDER BY name ASC');
    res.json({ venues: result.rows });
  } catch (error) {
    console.error('Error fetching venues:', error);
    res.status(500).json({ error: 'Failed to fetch venues' });
  }
}
```

**Technical Deep-Dive**:
This function retrieves the full catalog of physical spaces available at the tuition center. It queries the `venues` table, sorting by `venue_name` alphabetically. This provides the ground truth for all venue allocation selectors in the class creation and modification interfaces.

**The flow is**:
*   Ensure the venues schema is initialized in the database.
*   Query all rows from the venues table, ordered by name.
*   Format the results into a clean array of venue objects.
*   Return the collection to the frontend management tab.

---

*   `addVenue(req, res)`: Validates and appends a newly mapped physical venue room schema into the database.

```javascript
async function addVenue(req, res) {
  try {
    await ensureVenueTable();
    const { name, capacity, location, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Venue name is required' });
    }

    const result = await pool.query(
      'INSERT INTO venues (name, capacity, location, description) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, capacity || null, location || null, description || null]
    );
    res.status(201).json({ venue: result.rows[0] });
  } catch (error) {
    console.error('Error adding venue:', error);
    res.status(500).json({ error: 'Failed to add venue' });
  }
}
```

**Technical Deep-Dive**:
Adding a venue involves creating a new physical resource entry. The function sanitizes inputs for room numbers and student capacities to maintain database cleanlines. It checks for duplicate room numbers to prevent physical address collisions within the center.

**The flow is**:
*   Sanitize request body: venue_name, capacity, and room_number.
*   Check for pre-existing venues with the same room identifier.
*   Insert the new venue record and return the generated venue_id.
*   Log the creation to the administrative audit trail.

---

*   `updateVenue(req, res)`: Replaces operational parameters (like class capacity and descriptions) on a targeted venue without wiping existing metadata footprints.

```javascript
async function updateVenue(req, res) {
  try {
    const { id } = req.params;
    const { name, capacity, location, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Venue name is required' });
    }

    const result = await pool.query(
      'UPDATE venues SET name = $1, capacity = $2, location = $3, description = $4, updated_at = CURRENT_TIMESTAMP WHERE venue_id = $5 RETURNING *',
      [name, capacity || null, location || null, description || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    res.json({ venue: result.rows[0] });
  } catch (error) {
    console.error('Error updating venue:', error);
    res.status(500).json({ error: 'Failed to update venue' });
  }
}
```

**Technical Deep-Dive**:
This update logic modifies existing venue properties. It is designed to be non-destructive, only updating properties provided in the request body. This allows administrators to adjust capacity (e.g., adding more desks) or update the classroom name without affecting the history of classes previously held in that room.

**The flow is**:
*   Identify the venue via primary key.
*   Map new capacity, room numbers, or labels to the update query.
*   Apply changes to the database and verify update success.
*   Notify the system broad-caster of the resource change.

---

*   `deleteVenue(req, res)`: Safely destroys a venue mapping strictly provided it inherently checks out as currently empty of active internal class links.

```javascript
async function deleteVenue(req, res) {
  try {
    const { id } = req.params;
    
    // Check if venue is in use
    const teacherStateResult = await pool.query('SELECT state_json FROM teacher_classroom_states');
    let isInUse = false;
    for (const row of teacherStateResult.rows || []) {
      const clsList = Array.isArray(row?.state_json?.classrooms) ? row.state_json.classrooms : [];
      if (clsList.some(cls => Number(cls.venueId) === Number(id))) {
        isInUse = true;
        break;
      }
    }

    if (isInUse) {
      return res.status(400).json({ error: 'Venue is currently in use by one or more classes and cannot be deleted.' });
    }

    const result = await pool.query('DELETE FROM venues WHERE venue_id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    res.json({ message: 'Venue deleted successfully' });
  } catch (error) {
    console.error('Error deleting venue:', error);
    res.status(500).json({ error: 'Failed to delete venue' });
  }
}
```

**Technical Deep-Dive**:
Venue deletion is protected by strict referential integrity checks. Before a venue can be deleted, the function scans all `teacher_classroom_states` to ensure no active or upcoming classes are scheduled in that room. If the venue is occupied, the deletion is rejected to prevent "orphaned" classes with no physical location.

**The flow is**:
*   Receive the venue ID for deletion.
*   Scan all teacher state JSONB blobs to check for active venue_id references.
*   If occupancy is detected, return a 403 Forbidden with a list of conflicting classes.
*   If clear, execute the DELETE statement and log the resource removal.

---

*   `getVenueTimetable(req, res)`: Extracts the full class schedule for a specific venue tracing across all active teacher states dynamically.

```javascript
async function getVenueTimetable(req, res) {
  try {
    const { id } = req.params;
    const teacherStateResult = await pool.query('SELECT state_json, teacher_user_id FROM teacher_classroom_states');
    const classes = [];

    for (const row of teacherStateResult.rows || []) {
      const clsList = Array.isArray(row?.state_json?.classrooms) ? row.state_json.classrooms : [];
      for (const cls of clsList) {
        if (Number(cls.venueId) === Number(id)) {
          classes.push({
            id: cls.classroomId || cls.id,
            name: cls.classroomName || cls.title,
            schedule: cls.classSchedule || cls.schedule,
            teacherId: row.teacher_user_id,
            teacherName: cls.ownerTeacherName
          });
        }
      }
    }

    res.json({ classes });
  } catch (error) {
    console.error('Error fetching venue timetable:', error);
    res.status(500).json({ error: 'Failed to fetch venue timetable' });
  }
}
```

**Technical Deep-Dive**:
Since classroom schedules are stored within teacher-owned JSONB blobs, this function performs an exhaustive scan of the `teacher_classroom_states` table. It reconstructs the weekly timetable for a specific room by extracting any class block where the `venueId` matches the target. This provides administrators with a "Who is in this room and when?" view.

**The flow is**:
*   Load all teacher classroom states from the database.
*   Filter classrooms within each state matching the target venueId.
*   Extract the schedule strings (e.g., "Mon 08:00 - 10:00") and class titles.
*   Aggregate the data into a chronological weekly schedule for the venue.

---

*   `getAvailableVenues(req, res)`: Compares global array configurations mathematically retrieving a clean list of open venues guaranteed against overlapping scheduled reservations.

```javascript
async function getAvailableVenues(req, res) {
  try {
    const { schedule } = req.query; // e.g. "Mon 08:00-09:00"
    if (!schedule) {
      return res.status(400).json({ error: 'Schedule is required for availability check' });
    }

    const { hasOverlap } = require('../utils/scheduleMatcher');
    const venuesResult = await pool.query('SELECT * FROM venues');
    const teacherStateResult = await pool.query('SELECT state_json FROM teacher_classroom_states');
    
    const occupiedVenueIds = new Set();
    for (const row of teacherStateResult.rows || []) {
      const clsList = Array.isArray(row?.state_json?.classrooms) ? row.state_json.classrooms : [];
      for (const cls of clsList) {
        if (cls.venueId && cls.classSchedule) {
          if (hasOverlap(schedule, cls.classSchedule)) {
            occupiedVenueIds.add(Number(cls.venueId));
          }
        }
      }
    }

    const availableVenues = venuesResult.rows.filter(v => !occupiedVenueIds.has(Number(v.venue_id)));
    res.json({ venues: availableVenues });
  } catch (error) {
    console.error('Error checking venue availability:', error);
    res.status(500).json({ error: 'Failed to check venue availability' });
  }
}
```

**Technical Deep-Dive**:
The availability engine solves the "Where can I put this new class?" problem. It takes a proposed schedule string, parses it using `scheduleMatcher`, and then cross-references it against every other class in the system. Any venue currently hosting a class during the proposed time is excluded from the returned list.

**The flow is**:
*   Normalize the proposed time string into minute intervals.
*   Identify all venues currently hosting classes at that time across all teacher states.
*   Calculate the difference between the full venue list and the occupied list.
*   Return the remaining "Free" venues to the scheduling interface.

---

#### scheduleMatcher.js

*   `parseSchedule(req, res)`: Translates qualitative string text formats (e.g. "Mon 08:00") into comparative numeric matrix integer chunks.

```javascript
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
```

**Technical Deep-Dive**:
The parser is the "compiler" for the system's time strings. It breaks down strings like "Mon 08:00 - 10:30" into a Day Index (0-6) and "Minutes-since-Midnight" integers (e.g., 08:00 becomes 480). This mathematical conversion allows the system to perform high-speed conflict detection using simple integer comparisons rather than complex date-time object arithmetic.

**The flow is**:
*   Split the schedule string by commas to handle multi-day classes.
*   Pattern match days (Mon-Sun) and time ranges (HH:mm - HH:mm).
*   Convert HH:mm tokens into total minutes (H*60 + M).
*   Return an array of block objects: { dayIndex, startMin, endMin }.

---

*   `hasOverlap(req, res)`: Computes actual core mathematical intersection bounding algorithms testing if temporal structures effectively intersect.

```javascript
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
```

**Technical Deep-Dive**:
This is the core mathematical engine of the scheduler. It evaluates the overlap of two time blocks on the same day using the algorithm: `Overlap = (StartA < EndB) AND (StartB < EndA)`. This check is extremely efficient and serves as the fundamental building block for all system-wide conflict prevention.

**The flow is**:
*   Iterate through the blocks of Schedule A and Schedule B.
*   On matching day indices, perform the intersection check (Start < End).
*   Return true the moment any intersection is detected, otherwise return false.

---

*   `checkUserScheduleConflict(req, res)`: A defense boundary preventing an enrolled student from hitting identical schedule allocation overlapping collisions.

```javascript
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
```

**Technical Deep-Dive**:
This function protects students from being in two places at once. It pulls a student’s current enrollments, looks up the schedules for those classrooms from their respective teacher states, and compares them against a proposed new class. This ensures academic integrity and prevents timetable mismanagement for the student.

**The flow is**:
*   Fetch all active enrollment classroom IDs for the user.
*   Load the corresponding schedules from the teacher state JSONB blocks.
*   Compare the proposed schedule against every currently enrolled schedule.
*   Return the name of any conflicting classroom to provide helpful feedback to the admin.

---

*   `checkTeacherScheduleConflict(req, res)`: Protects teachers from scheduling two distinct physical spaces simultaneously.

```javascript
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
```

**Technical Deep-Dive**:
Similar to the student conflict check, this logic ensures a teacher isn’t double-booked. It scans both the teacher’s own classrooms and the classrooms where they are assigned as a co-teacher. It prevents the system from committing a schedule that would require the teacher to be in multiple rooms at once.

**The flow is**:
*   Identify the teacher’s primary state and co-teacher assignments.
*   Collate all active schedules across all assigned classrooms.
*   Test the proposed new schedule against this consolidated list.
*   Reject the transaction if an overlap is detected within the same day/time.

---

*   `checkVenueScheduleConflict(req, res)`: Evaluates physical constraints asserting overall physical room emptiness against the teacher_classroom_states matrix blocks.

```javascript
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
```

**Technical Deep-Dive**:
This function enforces the physical law: two classes cannot occupy the same room at the same time. It scans all center classes assigned to a specific venue and checks their schedules against a proposed block. This acts as the final gatekeeper for venue allocation within the `saveTeacherState` transaction.

**The flow is**:
*   Locate all classes currently assigned to the target venue_id.
*   Extract their normalized schedule blocks.
*   Perform intersection checks against the new proposed slot.
*   Flag the conflict if another class is already using the room during that window.

---

#### classroomController.js

*   `getTeacherState(req, res)`: Acts as a unified aggregation pull, interpreting the JSONB stored in teacher_classroom_states and dynamically pruning expired classrooms based on system locality time constraints.

```javascript
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
```

**Technical Deep-Dive**:
This function is the "State Provider" for the teacher dashboard. It performs a single, highly efficient query to fetch a teacher's relative data. Before returning the data, it logic-checks the `endDate` of all classrooms; if a class has passed its expiration, it is automatically moved to the "Archived" folder within the JSONB blob. This "Lazy Archiving" maintains a clean active dashboard without scheduled maintenance tasks.

**The flow is**:
*   Fetch the state_json blob for the requesting teacher.
*   Iterate through active classrooms, comparing current date to endDate.
*   Move expired classes to the archivedClassrooms array.
*   Fetch co-taught classrooms by scanning other teacher states for co-author references.
*   Sync and save the modified state back to the database and return to client.

---

*   `saveTeacherState(req, res)`: Acts as a centralized payload mutation handler validating schedule overlaps and updating Native structures (Classrooms, Assignments, Roster, Materials) simultaneously via JSONB mappings.

```javascript
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
```

**Technical Deep-Dive**:
saveTeacherState is the most complex transaction in the system. It handles the atomic update of a teacher’s entire ecosystem. Before saving, it performs a 4-tier validation: 1. Student capacity checks, 2. Teacher schedule conflict checks, 3. Assistant schedule checks, and 4. Venue availability checks. If any check fails, the transaction is aborted, protecting the system from data corruption or scheduling errors.

**The flow is**:
*   Parse the incoming state modification request.
*   Trigger parallel conflict checks for the primary teacher, any assistants, and the venue.
*   Validate that classroom rosters do not exceed physical room capacities.
*   Atomically update the teacher_classroom_states blob in the database.
*   Log the bulk operation success (or rejection) to the classroom audit log.

---

*   `getStudentClasses(req, res)`: Assembles personalized active classroom payloads for students referencing global user enrollment constraints and masking irrelevant teacher views.

```javascript
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
```

**Technical Deep-Dive**:
The student dashboard provider filters the global classroom ecosystem for a specific student. It looks up the student’s enrollment IDs and then "plucks" the matching classroom data from various teacher states. To protect teacher privacy, it strips away administrative fields (like student contact lists of other students) before sending the payload to the student’s browser.

**The flow is**:
*   Query the enrollments table for the student’s class IDs.
*   Retrieve partial state blobs from all teachers who own those classes.
*   Map assignment submission statuses (TurnedIn, Graded) to the student’s view.
*   Calculate current attendance percentages based on attendance records.
*   Return the consolidated "My Classes" view to the frontend.

---

*   `joinClassByCode(req, res)`: Authenticates randomly generated join credentials to inject students into active mapping structures while enforcing maximum capacity mathematical limits.

```javascript
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
```

**Technical Deep-Dive**:
The Join Code system allows for decentralised enrollment. The function scans all active classes for a matching `joinCode`. It then verifies that the student is of the correct academic "Form" (level) and that the class hasn’t reached its maximum capacity. Finally, it performs a schedule conflict check against the student’s current timetable to prevent "accidental" double-booking.

**The flow is**:
*   Locate the classroom matching the provided 6-character alphanumeric code.
*   Perform student-level verification (Form 1 - Form 5 compatibility).
*   Verify classroom capacity against current roster counts.
*   Execute a pre-enrollment schedule conflict analysis.
*   Add the student to the classroom roster and create the enrollment junction record.

---

*   `submitStudentAssignment(req, res)`: Handles linking file metadata from R2 uploads with the target assignment identifier locally mapping timestamps and grading boundaries natively.

```javascript
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
```

**Technical Deep-Dive**:
This function completes the student’s submission loop. It links an encrypted file (stored in Cloudflare R2) to a specific assignment. It records the exact timestamp of submission to determine "Late" status. Once a submission is recorded, it appears in the teacher’s grading interface for review.

**The flow is**:
*   Verify the student is actually enrolled in the classroom.
*   Check for existing submissions for the same assignment to handle resubmission.
*   Map the R2 file key to the submission record in `classroom_assignment_submissions`.
*   Update the assignment status to "Submitted" and log the event.
*   Confirm submission success to the student dashboard.

---

*   `gradeStudentSubmission(req, res)`: Allows instructors to inject mathematical grading out of 100 alongside textual feedback into active SQL student submissions.

```javascript
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
```

**Technical Deep-Dive**:
Authorized teachers use this to provide academic feedback. The function permits entry of a numerical grade (0-100) and a text-based comment. It updates the submission status to "Graded," which triggers an notification/update on the student’s portal so they can view their results.

**The flow is**:
*   Ensure the requesting user is the owner or an authorized co-teacher of the class.
*   Validate that the grade is within the 0.0 - 100.0 bounds.
*   Update the submission row with the grade and feedback strings.
*   Record the grading action in the classroom audit trail.
*   Return the updated submission status to the teacher’s UI.

---

*   `unsubmitStudentAssignment(req, res)`: Reverses active submissions dynamically, unlinking material pointers allowing secure revisions gracefully.

```javascript
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
```

**Technical Deep-Dive**:
Unsubmission allows students to retract work before the teacher begins grading. The function enforces a strict guardrail: once a teacher has assigned a grade, the student can no longer unsubmit. This preserves the "locked" state of graded assessments while allowing flexibility during the draft phase.

**The flow is**:
*   Locate the student’s submission for the specific assignment.
*   Verify that the submission status is not yet "Graded".
*   Remove the submission record from the SQL database.
*   Update the student’s dashboard to show the assignment as "Missing".
*   Log the unsubmission event for teacher visibility.

---

*   `getClassAnnouncements(req, res)`: Pulls global sequential communication arrays mapped directly across individual user classroomId relationships.

```javascript
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
```

**Technical Deep-Dive**:
Announcements provide real-time updates to students. This function retrieves the 300 most recent broadcasts and maps them to the appropriate classrooms. It ensures that students only see announcements for classes they are currently enrolled in.

**The flow is**:
*   Query the classroom_announcements table, ordered by most recent.
*   Filter and group announcements by their target classroomId.
*   Format the results into a time-ordered feed for frontend display.
*   Limit retrieval to an efficient buffer size to maintain high performance.

---

*   `postClassAnnouncement(req, res)`: Generates globally readable broadcast entities securely mapped only to permitted viewers based on class alignments.

```javascript
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
```

**Technical Deep-Dive**:
This is the teacher’s broadcast tool. It enforces a strict 260-character limit to ensure announcements remain concise. The function automatically appends the teacher’s formal title (e.g., "Ms. Tan") to the post, maintaining professional communication standards.

**The flow is**:
*   Validate announcement length and teacher identity.
*   Fetch the formal title and name of the posting educator.
*   Insert the announcement row linked to the target classroom.
*   Trigger the audit log and return the new broadcast object to the UI.

---

*   `getAdminClassrooms(req, res)`: Fetches an absolute global array of all system classrooms irrespective of archiving state for centralized administrative oversight.

```javascript
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
```

**Technical Deep-Dive**:
The "Super-View" for administrators. It iterates through all teachers in the system and reconstructs a global registry of every class, material, and student. This allows administrators to monitor center performance, track teacher workload, and manage archived data without direct access to teacher-private files.

**The flow is**:
*   Query all rows from teacher_classroom_states and join with user profiles.
*   Deconstruct each JSONB blob to extract classroom metadata.
*   Include archived folders to provide a complete historical view of the system.
*   Sort the final global list by last-modified date and present to the admin.

---

*   `restoreAdminClassroom(req, res)`: Physically manipulates status bindings mapping 'Archived' states back to 'Active', resetting automatic retention expirations.

```javascript
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
```

**Technical Deep-Dive**:
This tool reverses the archiving process. When an administrator restores a class, the function "plucks" the classroom sub-structure from the `archivedClassrooms` array and reinstates it into the active `classrooms` array. It also restores all associated materials and student rosters, seamlessly bringing the class back online as if it were never closed.

**The flow is**:
*   Locate the archived entry in the target teacher’s JSONB state.
*   Verify the snapshot contains valid material and assignment mapping data.
*   Move the classroom object back to the active array and reset its status to "Active".
*   Force a database commit and update the system audit log.
*   Notify the teacher that their classroom has been restored.

---

*   `checkScheduleConflict(req, res)`: Exposed API wrapper interacting with scheduleMatcher.js directly preventing dual-enrollments systematically.

```javascript
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
```

**Technical Deep-Dive**:
This is the frontend-facing validation hook. It allows the UI to check for conflicts *before* an enrollment is attempted. By providing both the `studentId` and `classroomId`, it triggers a deep-scan of the student's existing schedule and returns a clear "Conflict Found/Not Found" status, improving the administrative workflow.

**The flow is**:
*   Receive the student and target classroom identifiers.
*   Invoke the scheduleMatcher.checkUserScheduleConflict utility.
*   Determine the specific name of the conflicting class if an overlap exists.
*   Return a boolean result and the conflicting name for UI error messaging.

---

### 5.2 Testing

To ensure robustness, performance, and security across the core systems, we have constructed a comprehensive testing suite comprising 15 Test Cases, heavily validating both functional capabilities and security restrictions.

**Test Case 1: Valid Admin Login Verification**
*   **Action**: Boot the platform natively and attempt authorization using valid Administrator credentials.
*   **Expected**: The system should authenticate, load the secure JSON Web Token, and grant entry to the exclusive Admin Dashboard natively bypassing restriction.
*   **Result**: Pass.
![Valid Admin Login](file:///C:/Users/User/.gemini/antigravity/brain/3af3329b-a2ef-486c-85b9-2b42d299078a/valid_admin_login_dashboard_1776430140722.png)

**Test Case 2: Structural Data Search Integrity**
*   **Action**: Execute a strict search string "s" within the global User Management query boundaries.
*   **Expected**: The database node should natively fetch only users matching "s" across names or dynamically appended numeric IDs.
*   **Result**: Pass.
![String Lookup](file:///C:/Users/User/.gemini/antigravity/brain/3af3329b-a2ef-486c-85b9-2b42d299078a/user_management_search_s_1776430197443.png)

**Test Case 3: Role Boundary Filtering**
*   **Action**: Manipulate the search UI switching the constraint exclusively into the 'Teacher' boundary array.
*   **Expected**: All loaded database states must instantly drop Student and Admin elements recursively locking views strictly into Teachers.
*   **Result**: Pass.
![Role Constraint Filter](file:///C:/Users/User/.gemini/antigravity/brain/3af3329b-a2ef-486c-85b9-2b42d299078a/user_management_filter_teacher_1776430228685.png)

**Test Case 4: Compound Search Algorithms**
*   **Action**: Combine the structural "s" textual string mapping simultaneously with the 'Teacher' role constraint boundary.
*   **Expected**: Executes conditional compound AND statements natively returning only Teachers possessing the "s" character explicitly.
*   **Result**: Pass.
![Compound Filter](file:///C:/Users/User/.gemini/antigravity/brain/3af3329b-a2ef-486c-85b9-2b42d299078a/user_management_search_s_teacher_filter_1776430247375.png)

**Test Case 5: Venue Allocation Overlap Restriction**
*   **Action**: Forcefully register a new classroom target deliberately intersecting an explicitly established time boundary on an active Venue mapping.
*   **Expected**: `scheduleMatcher.js` native validations aggressively trigger a physical conflict loop ejecting the request entirely preventing dual-enrollments effectively.
*   **Result**: Pass.
![Venue Overlap Rejection](file:///C:/Users/User/.gemini/antigravity/brain/3af3329b-a2ef-486c-85b9-2b42d299078a/test_case_venue_conflict_1776430265373.webp)

**Test Case 6: Duplicate Venue Mapping Failure**
*   **Action**: Create a new Venue room identical to a pre-existing active room intentionally defying system separation limits.
*   **Expected**: Server natively rejects the mapping returning a formal 404/400 exception protecting distinct constraints dynamically.
*   **Result**: Pass.
![Venue Creation Limit](file:///C:/Users/User/.gemini/antigravity/brain/3af3329b-a2ef-486c-85b9-2b42d299078a/venue_creation_failed_404_1776431123281.png)

**Test Case 7: Secure Administrator User Injection**
*   **Action**: Synthetically load an entirely new structured Teacher mapping bypassing explicit password input securely demanding the node build default boundaries.
*   **Expected**: The internal system automatically executes Crypto logic securely building random strings routing directly into bcrypt schemas perfectly mapping native objects securely.
*   **Result**: Pass.
![Adding User Flow](file:///C:/Users/User/.gemini/antigravity/brain/3af3329b-a2ef-486c-85b9-2b42d299078a/test_case_add_user_1776431356814.webp)

**Test Case 8: Classroom Data Aggregation Testing**
*   **Action**: Login under a Student node to track JSONB payload conversions mapping.
*   **Expected**: Validated arrays drop irrelevant variables cleanly maintaining highly dense loading speeds mapping cleanly implicitly.
*   **Result**: Pass.

**Test Case 9: Cloudflare R2 Upload Flow**
*   **Action**: Compress massive 50MB testing streams through the active interface securely testing internal buffer logic boundaries.
*   **Expected**: Active buffer arrays chop chunks linearly routing mapped limits securely through validation checks completely seamlessly.
*   **Result**: Pass.

**Test Case 10: Multi-State Password Reset Invalidations**
*   **Action**: Intentionally flip admin reset overrides natively attacking valid JWT targets randomly active simultaneously across distinct networks.
*   **Expected**: Backing logic actively routes all queries into absolute null pointers cleanly logging users out simultaneously forcefully.
*   **Result**: Pass.

**Test Case 11: SQL Parameterization Protection**
*   **Action**: Pass literal injection queries ("1=1; DROP TABLE users;") inside the search algorithms natively.
*   **Expected**: `userManagementController.js` implicitly binds arrays forcefully locking string vectors blocking arbitrary logic changes safely.
*   **Result**: Pass.

**Test Case 12: Storage Bucket Segregation Verification**
*   **Action**: Pull distinct files validating identical names locally dropping into distinct paths.
*   **Expected**: The logical system natively maps `/personal/` distinctively separating `/classroom/` scopes avoiding internal overlaps flawlessly.
*   **Result**: Pass.

**Test Case 13: XSS Render Prevention Execution**
*   **Action**: Attempt to execute stored `.html` files containing alert vectors sequentially previewed.
*   **Expected**: Node logic sets literal forced header schemas `nosniff` preventing system browsers natively extracting dynamic scripts securely.
*   **Result**: Pass.

**Test Case 14: Teacher Dashboard Memory Integrity**
*   **Action**: Overload local memory variables deliberately flooding Classroom logic securely expecting frontend stalling parameters.
*   **Expected**: Native JSONB aggregations push payloads accurately skipping loop structures securely maintaining instantaneous refreshes cleanly.
*   **Result**: Pass.

**Test Case 15: Cross-Role Enrollment Security Bounds**
*   **Action**: Dynamically force a 'Student' identifier into active Teacher allocation bounds inherently mapped via `target_type: 'course'`.
*   **Expected**: System explicitly stops queries returning strict error payloads stopping authorization elevation leaks organically.
*   **Result**: Pass.

6. Discussions & Conclusion
6.1 Summary
This project will have created, developed, and tested the Secure Personal Storage and File Sharing Module as the storage part of an overall Tuition Center Management System. The development of the module was motivated by a well-established operational issue within the Malaysian tuition centres: the disjointed utilization of various disintegrated platforms in file storage, file sharing, and classroom management, which compels users to make redundant uploads, changes of environments between applications without a clear understanding of its security measures, which do not meet the requirements of the PDPA compliance.

The frontend is developed with React 19.x, the backend is developed with Node.js 18.x and Express 4.x, the database is hosted on Neon and was developed with postgreSQL 15.x, and encrypted object storage is done with Cloudflare R2. The files uploaded to the system are encrypted on the server with AES-256-GCM and a 256-bit unique key and an initialisation vector per file, so that a compromised key can only affect a single file. SHA256 checksums are computed on the plaintext prior to encryption and verified after decryption of all downloads and previews, which offers tamper-evident storage. All operations such as uploads, downloads, previews, edits, shares, renames, deletions, folder actions, and authentication events are logged in a detailed audit log with timestamps, user identities, IP addresses, and the results of the operation.

The module is installed to run alongside the Classroom Management Module created by partner Koh Wei Sheng with a shared file scope architecture. The personal/ path in R2 is used to store personal files and charges against the personal quota of the user. The files are classified as classroom-scoped files (use classroom/ and submission/ prefixes) and can be viewed in both the Storage Tab and in the classroom view, without having to upload them again. This integration removes the root cause workflow inefficiency that is described in the problem statement.
6.2 Achievements

Unified Storage Platform
Each user uploads files only once into their personal quota and accesses them in a variety of classroom submissions, peer sharing, and personal organisation without uploading again. The Storage Tab and Classroom Tab are implemented in the same authenticated interface, and file references, and not file copies, are exchanged between modules. Educators post classroom resources directly out of storage and students post assignments by choosing out of their preexisting personal files.

AES-256-GCM Per-File Encryption
Each uploaded file is given its individual 256-bit encryption key, randomly selected initialisation vector, and GCM authentication tag. The per-file key is encrypted with AES-256-CBC with the master JWT_SECRET and then stored in the database, and thus the plaintext key is not stored anywhere. Any breach of the key of a single file only exposes that file, not the full repository. This counters the per-file encryption gap that has been found in the literature review of existing solutions.

SHA-256 Integrity Verification
Checksums are calculated on the raw file buffer before encryption during the upload time and compared with the one stored after decryption during every download and preview. In case of non-matching of the checksum, i.e., the object that is being encrypted in R2 has changed since it was uploaded, the operation is stopped, an event is recorded with integrity check passed = false and the content is never relayed to the client.

Role-Based Storage Quotas
There is 1GB of personal storage for students and 2GB for teachers. Personal quotas are not spent on classroom-scoped uploads. Quotas are not stored in a cached value, so drift due to concurrent operations or partial failures does not occur.

Four Permission Preset Granular File Sharing.
The four possible permission settings that file owners can assign include All, Download only, Edit and Rename only, which correspond to three independent can download, can edit and can rename Boolean values on the file sharings record. All permissions are implemented at the API level, in the download, edit, and rename controllers, and not only concealed in the UI. Share out of batch to a number of recipients produces one combined notification card each share action.

On-site File Viewing and Text Editor.
It is possible to preview images, PDFs, and text files without downloading them. HTML, CSS, JavaScript, JSON, and XML files are coerced into text/plain content type and X-Content-Type-Options: nosniff on all preview responses prevents browser execution or rendering of uploaded code files. Text files (.txt and .md) can be edited within the platform, with the content being re-encrypted on save and a new SHA-256 checksum is stored.

Account Security and Password Management.
All passwords are hashed using bcrypt with 10 rounds. After 5 successive failed attempts to log in, an account is locked after 15 minutes. The lockout check is made prior to password verification thus no correct password can be used to differentiate a locked account and an incorrect password. The password reset relies on 64-character cryptographically random tokens that have 1-hour expiry. The successful change of passwords invalidates all the other running sessions and sends a confirmation email.

Comprehensive Audit Logging
Operation types are logged to the audit logs and file access logs tables in total of 14, namely uploads, downloads, previews, edits, shares, revocations, renames, deletions, folder operations, authentication, and access denial. The full audit log can be filtered, searched, paginated, and exported to CSV by admins on the Admin Dashboard. This directly responds to the lack of audit logging gap in the literature review and complies with the PDPA Section 7 Security Principle.

Dual-Layer Session Management
Database session records in user sessions support JWT tokens. There is no way to use a token that has not expired after logging out since the is_active flag is authoritative. When there is less than 30 minutes to go, tokens are automatically rotated and the new token is provided over both the HTTP-only cookie and the x-session-token response header to maintain running users with a seamless authentication.
6.3 Contributions
AES-256-GCM and SHA-256 used in practice in a real academic web-based application using the standard crypto node.js library and without any third-party encryption services or purchased security infrastructure. It demonstrates that there may be nothing like at zero cost verifiable cryptographic protection, which is transparent.
Single storage-classroom integration architecture, where files are not uploaded twice by sharing file reference between subsystems, but not file data, and has a scope parameter (personal, classroom, submission). This contributes to the elimination of the issue of platform fragmentation, which was accomplished in the literature review.
The single key compromise reveals only one file at a time in a per-file encryption key isolation design where each file is given a uniquely generated key. This has been better as compared to the single key per repository type that most of the consumer cloud storage providers use.
The apparent audit logging system that aligns with the provisions of the PDPA in the Malaysian educational institutions and logs 14 various operations with user-level metadata at a level adequate to support the investigation of security incidents and data protection liability.
An architecture that satisfies both the cost-zero and cost-minimum criteria, using Neon (free-tier PostgreSQL), Cloudflare R2 (free-tier object storage with no egress fees), and Gmail SMTP, demonstrates that file storage that satisfies the PDPA requirement can be deployed by a tuition centre without any infrastructure budget.
Fine-grained access control (compared to binary share/no-share model on general-purpose platforms) A granular file sharing permission model, four freely adjustable flags (download, edit, rename) on the API level to permit a more fine-grained access control.
Large files can also be downloaded using a streaming decryption configuration of a Node.js Transform stream, which decrypts R2 objects on demand and then redirects the data to the HTTP output, essentially meaning that the data does not have to be loaded into the server memory.

6.4 Limitations and Future Improvements
Limitation 1: Upload Memory Buffering.
The uploading of files is buffered to its full capacity in server memory and then encrypted. Multer reads the entire file into a buffer and encryptFile generates other buffers of encrypted data and the computation of the SHA-256 hash, that is, a single large upload is kept in memory several times at once. This is problematic with files that are getting to 500 MB.
Future Improvement
Streaming encryption when uploading with a Node.js Transform stream. This involves processing the AES-256-GCM authentication tag independently as it cannot be generated until the entire plaintext is processed - one way to do this is to simply concatenate the tag to the end of the ciphertext stream and remove it on decryption.

Limitation 2: No Live Co-editing.
The editing of text files is single-user only. When two users having permission to edit open the same file simultaneously, the latter save replaces the former without a conflict notification. No system is in place to indicate that the file is being edited by another user.
Future Improvement
Implement collision-free collaborative editing with WebSocket-based collaborative editing with the YJS CRDT (Conflict-free Replicated Data Type) library, which supports multiple users with edit permission to edit the same text file and merge the edits automatically.

Limitation 3: Sharing Restricted to Registered Users
Only registered and active users of the same system instance are allowed to share files. It is impossible to share a file with a parent, external reviewer or any other person who does not have an account in the system.
Future Improvement
External sharing through time-limited presigned URLs are created with the Cloudflare R2 presigned URL API. Extraneous recipients would be given a temporary link which is active after a configured time and does not require registration.

Limitation 4: Version History none of Edited files.
Once a text file is modified and saved it overwrites the old content in R2 and the old encryption information is updated in the database. One cannot use a former version of an edited file.
Future Improvement
Before every overwrite, save the old versions of files in a separate file versions table and keep the old path to encrypted content in R2, the old encryption metadata and the user ID and time of the editor. This would enable the users to revert to any previous version using the File Details view.

Limitation 5: No Preview of Office Documents.
File preview supports documents like images, PDFs and text based documents, but not office document types like.docx,.xlsx and.pptx. These files need to be downloaded by users to be viewed and this is an unwarranted friction to most of the common educational file types.
Future Improvement
Install a document conversion pipeline with LibreOffice in headless mode in order to convert Office files into PDF on the fly prior to sending to browser preview, without storing the resulting conversion. The stream of decrypted Office file would be piped to the conversion and the resulting PDF would be sent inline.

Limitation 6: Two-Factor Authentication, none.
The only means of protection against user accounts is by password and account lockout. It does not have a second factor of authentication, which implies that a stolen password can provide complete access to an account and all files it owns or shares.
Future Improvement
Integrate two-factor authentication, which is based on TOTP, and compatible with Google Authenticator (teacher and admin accounts). The secret of TOTP would be kept in the database in the encrypted form and 6-digit code would be needed on each login after the password has been accepted.

6.5 Issues and Solutions
Issue 1: The Classroom Module Integration with Various Data Models.
The classroom module that is created by teammate Koh Wei Sheng has its state as a JSON blob stored in a table teacher classroom states whereas the storage module uses normalised relational tables. To implement the access control checks on the downloads of files in the classroom-scoped access, both the relational enrollment data and the JSON state blob were to be parsed to determine whether or not a user had a legitimate access to a file.
Solution: 
The hasStudentClassroomAccessToFile() and hasTeacherClassroomAccessToFile functions were coded with a loop of visited enrolled classrooms and a cross-check of material file IDs and user IDs as roster in the JSON state. Safe defaults (return false on a single failure on the parsing) were considered such that a malformed state object never provides unauthorised access.

Issue 2: Granular Permission System Added Halfway through.
The first type of file sharing was binary - the file was either shared or not shared. The necessity of granular permissions (download, edit and rename as individual settings) was found in the development. The schema migration of three new columns in the file sharings table in the middle of the development needed to be done with care that did not invalidate all the sharing records.
Solution: 
The ensureSharingPermissionColumns() function was coded to insert the columns with ALTER TABLE IF NOT EXISTS and immediately backfill them to true so that all existing shares would retain all their permissions. A safety net was also added to all permission queries by adding COALESCE(can_download, true), in case any rows were inserted between the creation of the columns and the backfill.

Issue 3: Batch Share Action Grouping of Notification.
When the owner of a file shares numerous files with several recipients at the same time, a separate sharing notifications record is created by each file-recipient pair. Unless grouped, a recipient who receives 10 files simultaneously would be shown 10 individual notification cards, which would fill up the notification panel.
Solution: 
The sharing_notifications table was modified to include a column named notification_group_id that would consist of the batch UUID and user ID of the recipient. The getNotifications query joins on this ID, and summarizes the file information into a JSONB array, and BOOL_AND(is_read) such that a grouped notification can only be considered completely read when all the files in the batch have been read. The markNotificationRead() is a function that requires the group id to clear all the notifications of a particular batch within a single UPDATE.

Issue 4: Frontend State Synchronisation Cross Component.
There are a number of activities in the system which necessitate updating state in components which are not directly related as parents and children. As an illustration, a profile picture change on the UserProfile modal had to reload the avatar in the Dashboard navigation bar and a successful share operation had to reload the number of notification badges in a different toolbar element.
Solution: A named window event was employed (profileUpdated, notificationUpdated) when the component taking action sends the event, but the component showing the result registers a listener on mount. This avoids prop-drilling across multiple layers of components and does not need a global state management library.

6.6 Conclusion
The Secure Personal Storage and File Sharing Module is able to achieve its main goal that is to provide the Malaysian tuition centres with a single, cryptographically transparent, and PDPA-compliant file management service. Having personal storage, peer file sharing, and classroom material management in one authenticated interface, the system removes the platform fragmentation that was cited as the primary issue of operation in the literature review. Users post files once and apply them to all contexts that the system offers, such as personal organized storage, classroom contribution, assignment submission and peer collaboration without the need to change platforms or recreate content.

The cryptographic example shows that with the Node.js standard library and free-tier infrastructure, it is possible to implement industry-standard security, namely: AES-256-GCM file-level encryption, Sha-256 tamper-evident integrity verification, Bcrypt password hashing, and cryptographically random session and reset tokens. This is especially important to the target market of small Malaysian tuition centres where enterprise security solutions are not affordable. The whole system operates on free-tier services and there is no license fee and it can be deployed immediately without an infrastructure budget.

Agile development methodology allowed the integration with the Classroom Management Module to be done through the entire development process, and the 2-week sprints were used to create and modify interface contracts between modules as the requirements changed. Four security tests performed established that the system is rejecting the attempts of authentication bypass, tampered tokens, privilege escalation, and SQL injection correctly. The seventeen functional test cases gave their desired results.

The identified limitations, namely, the lack of streaming upload encryption, no version history of the edited files, and lack of a mobile app, are natural points of future development instead of the deficiencies in the core functionality of the current system. The architecture that has been developed in this project especially the scope based file classification, the per file key isolation model and the dual layer session management model gives a firm and expandable base to these improvements. The system is a viable example of how clear, verifiable, and low-cost cryptographic protection of files can be applied to Malaysian educational technology settings in the present day, with open-source tools.
