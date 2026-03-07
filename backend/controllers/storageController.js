const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const pool = require('../config/database');
const { logAudit } = require('../utils/auditLogger');

const BYTES_PER_GB = 1024 * 1024 * 1024;
const ROLE_QUOTA_BYTES = {
  student: 1 * BYTES_PER_GB,
  teacher: 2 * BYTES_PER_GB
};

let fileScopeColumnsEnsured = false;
let fileScopeSupported = null;
let classroomAuditTableEnsured = false;
let accessLogColumnsEnsured = false;
let fileUpdatedAtColumnEnsured = false;
let sharingNotificationColumnsEnsured = false;
let sharingPermissionColumnsEnsured = false;

const SHARE_PERMISSION_PRESETS = {
  all: { canDownload: true, canEdit: true, canRename: true },
  download: { canDownload: true, canEdit: false, canRename: false },
  edit: { canDownload: true, canEdit: true, canRename: false },
  rename: { canDownload: false, canEdit: false, canRename: true }
};

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function normalizeClassroomAccessRole(role) {
  return String(role || '').trim().toLowerCase() === 'teacher' ? 'teacher' : 'student';
}

function getEffectiveQuotaBytes(role, fallbackQuota) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'admin') {
    return null;
  }
  return ROLE_QUOTA_BYTES[normalizedRole] || parseInt(fallbackQuota, 10) || ROLE_QUOTA_BYTES.student;
}

async function ensureFileScopeColumns(clientLike = pool) {
  if (fileScopeColumnsEnsured) {
    return;
  }

  try {
    await clientLike.query(`
      ALTER TABLE files
      ADD COLUMN IF NOT EXISTS file_scope VARCHAR(20) NOT NULL DEFAULT 'personal'
    `);

    await clientLike.query(`
      ALTER TABLE files
      ADD COLUMN IF NOT EXISTS classroom_id INTEGER NULL
    `);
  } catch (error) {
    console.warn('File scope columns auto-migration skipped:', error?.message || error);
  } finally {
    fileScopeColumnsEnsured = true;
  }
}

async function hasFileScopeColumns(clientLike = pool) {
  if (typeof fileScopeSupported === 'boolean') {
    return fileScopeSupported;
  }

  try {
    const result = await clientLike.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'files'
         AND column_name IN ('file_scope', 'classroom_id')`
    );

    const columns = new Set((result.rows || []).map((row) => String(row.column_name || '').toLowerCase()));
    fileScopeSupported = columns.has('file_scope') && columns.has('classroom_id');
    return fileScopeSupported;
  } catch (error) {
    console.warn('Failed to detect file scope columns:', error?.message || error);
    fileScopeSupported = false;
    return false;
  }
}

function normalizeFileScope(scope) {
  const normalized = String(scope || '').trim().toLowerCase();
  return normalized === 'classroom' ? 'classroom' : 'personal';
}

async function getPersonalStorageUsedBytes(clientLike, userId) {
  await ensureFileScopeColumns(clientLike);

  const scopeSupported = await hasFileScopeColumns(clientLike);
  const usageResult = await clientLike.query(
    scopeSupported
      ? `SELECT COALESCE(SUM(file_size), 0) AS used_bytes
         FROM files
         WHERE user_id = $1
           AND is_deleted = false
           AND COALESCE(file_scope, 'personal') = 'personal'`
      : `SELECT COALESCE(SUM(file_size), 0) AS used_bytes
         FROM files
         WHERE user_id = $1
           AND is_deleted = false`,
    [userId]
  );

  return parseInt(usageResult.rows?.[0]?.used_bytes, 10) || 0;
}

async function syncUserPersonalStorageUsed(clientLike, userId) {
  const usedBytes = await getPersonalStorageUsedBytes(clientLike, userId);
  await clientLike.query(
    'UPDATE users SET storage_used = $1 WHERE user_id = $2',
    [usedBytes, userId]
  );
  return usedBytes;
}

async function ensureClassroomAuditTable(clientLike = pool) {
  if (classroomAuditTableEnsured) {
    return;
  }

  await clientLike.query(`
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

  classroomAuditTableEnsured = true;
}

async function ensureDownloadMetricsColumns(clientLike = pool) {
  if (accessLogColumnsEnsured) {
    return;
  }

  try {
    await clientLike.query('ALTER TABLE file_access_logs ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT');
    await clientLike.query('ALTER TABLE file_access_logs ADD COLUMN IF NOT EXISTS download_time_ms INTEGER');
  } catch (error) {
    console.warn('Failed to ensure download metrics columns:', error?.message || error);
  } finally {
    accessLogColumnsEnsured = true;
  }
}

async function appendClassroomStorageLog({
  actorUserId,
  actorRole,
  operationType,
  operationLabel,
  target,
  targetType,
  status = 'success',
  details = null
}) {
  try {
    await ensureClassroomAuditTable(pool);
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
        targetType || 'Material',
        status,
        details ? JSON.stringify(details) : null
      ]
    );
  } catch (error) {
    console.warn('Failed to append classroom storage log:', error?.message || error);
  }
}

// Initialize R2 Client
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Helper function to generate encryption key
const generateEncryptionKey = () => {
  return crypto.randomBytes(32); // 256-bit key
};

// Helper function to encrypt file
const encryptFile = (buffer) => {
  const key = generateEncryptionKey();
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    encryptedData: encrypted,
    key: key.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    checksum
  };
};

// Helper function to decrypt file
const decryptFile = (encryptedBuffer, key, iv, authTag) => {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'base64'),
    Buffer.from(iv, 'base64')
  );

  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final()
  ]);

  return decrypted;
};

// Helper to convert stream to buffer
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function hasStudentClassroomAccessToFile(userId, fileId) {
  try {
    const numericUserId = Number(userId);
    const numericFileId = Number(fileId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0 || !Number.isInteger(numericFileId) || numericFileId <= 0) {
      return false;
    }

    const enrollmentRows = await pool.query(
      `SELECT target_id
       FROM user_enrollments
       WHERE user_id = $1
         AND target_type = 'classroom'
         AND enrollment_status = 'active'`,
      [numericUserId]
    ).catch(() => ({ rows: [] }));

    const enrolledClassroomIds = new Set(
      (enrollmentRows.rows || [])
        .map((row) => Number(row.target_id))
        .filter((value) => Number.isInteger(value) && value > 0)
    );

    const teacherStates = await pool.query('SELECT state_json FROM teacher_classroom_states').catch(() => ({ rows: [] }));

    for (const row of teacherStates.rows || []) {
      const state = row?.state_json && typeof row.state_json === 'object' ? row.state_json : {};
      const classrooms = Array.isArray(state.classrooms) ? state.classrooms : [];
      const materialsByClassroom = state.materialsByClassroom && typeof state.materialsByClassroom === 'object'
        ? state.materialsByClassroom
        : {};
      const studentsByClassroom = state.studentsByClassroom && typeof state.studentsByClassroom === 'object'
        ? state.studentsByClassroom
        : {};

      for (const classroom of classrooms) {
        const classroomId = Number(classroom?.classroomId || classroom?.id);
        if (!Number.isInteger(classroomId) || classroomId <= 0) {
          continue;
        }

        const classMaterials = materialsByClassroom[classroomId] || materialsByClassroom[String(classroomId)] || [];
        const hasMaterialMatch = Array.isArray(classMaterials)
          ? classMaterials.some((material) => Number(material?.fileId || material?.file_id || 0) === numericFileId)
          : false;

        if (!hasMaterialMatch) {
          continue;
        }

        const classRoster = studentsByClassroom[classroomId] || studentsByClassroom[String(classroomId)] || [];
        const isInRoster = Array.isArray(classRoster)
          ? classRoster.some((student) => Number(student?.studentId || student?.userId || student?.id) === numericUserId)
          : false;

        const isEnrolled = enrolledClassroomIds.size > 0 && enrolledClassroomIds.has(classroomId);

        if (isInRoster || isEnrolled) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.error('Classroom material access fallback check failed:', error);
    return false;
  }
}

async function hasTeacherClassroomAccessToFile(userId, fileRecord) {
  try {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0 || !fileRecord || typeof fileRecord !== 'object') {
      return false;
    }

    const classroomIds = new Set();
    const fileScope = normalizeFileScope(fileRecord.file_scope);
    const classroomIdFromFile = Number(fileRecord.classroom_id);

    if (fileScope === 'classroom' && Number.isInteger(classroomIdFromFile) && classroomIdFromFile > 0) {
      classroomIds.add(classroomIdFromFile);
    }

    const numericFileId = Number(fileRecord.file_id);
    if (Number.isInteger(numericFileId) && numericFileId > 0) {
      const submissionRows = await pool.query(
        `SELECT DISTINCT classroom_id
         FROM classroom_assignment_submissions
         WHERE file_id = $1`,
        [numericFileId]
      ).catch(() => ({ rows: [] }));

      for (const row of submissionRows.rows || []) {
        const submissionClassroomId = Number(row?.classroom_id);
        if (Number.isInteger(submissionClassroomId) && submissionClassroomId > 0) {
          classroomIds.add(submissionClassroomId);
        }
      }
    }

    if (classroomIds.size === 0) {
      return false;
    }

    const teacherStates = await pool.query(
      'SELECT teacher_user_id, state_json FROM teacher_classroom_states'
    ).catch(() => ({ rows: [] }));

    for (const row of teacherStates.rows || []) {
      const state = row?.state_json && typeof row.state_json === 'object' ? row.state_json : {};
      const classrooms = Array.isArray(state.classrooms) ? state.classrooms : [];

      for (const classroom of classrooms) {
        const currentClassroomId = Number(classroom?.classroomId || classroom?.id);
        if (!Number.isInteger(currentClassroomId) || !classroomIds.has(currentClassroomId)) {
          continue;
        }

        const ownerTeacherId = Number(classroom?.ownerTeacherId || row?.teacher_user_id);
        if (Number.isInteger(ownerTeacherId) && ownerTeacherId === numericUserId) {
          return true;
        }

        const coTeachers = Array.isArray(classroom?.coTeachers) ? classroom.coTeachers : [];
        const hasTeachingAccess = coTeachers.some((entry) => {
          const coTeacherUserId = Number(entry?.teacherUserId || entry?.userId || entry?.id);
          return Number.isInteger(coTeacherUserId)
            && coTeacherUserId === numericUserId
            && normalizeClassroomAccessRole(entry?.accessRole) === 'teacher';
        });

        if (hasTeachingAccess) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.error('Teacher classroom access fallback check failed:', error);
    return false;
  }
}

// Upload File
async function uploadFile(req, res) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await ensureFileScopeColumns(client);
    const scopeSupported = await hasFileScopeColumns(client);

    const { folderId } = req.body;
    const requestedScope = normalizeFileScope(req.body?.scope);
    const requestedClassroomId = Number.isInteger(Number(req.body?.classroomId)) ? Number(req.body.classroomId) : null;
    const uploadCategory = String(req.body?.uploadCategory || '').trim().toLowerCase();
    const uploadScope = scopeSupported ? requestedScope : 'personal';
    const classroomId = scopeSupported && uploadScope === 'classroom'
      ? requestedClassroomId
      : null;
    const userId = req.user.userId;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Validate file size (500MB max)
    const MAX_FILE_SIZE = 500 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      await logAudit({
        userId,
        sessionId: req.sessionId,
        operationType: 'upload',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ filename: file.originalname, size: file.size }),
        status: 'failed',
        errorMessage: 'File exceeds 500MB limit',
        userAgent: req.headers['user-agent']
      });
      return res.status(400).json({ error: 'File exceeds maximum size of 500MB' });
    }

    // Get user's storage quota and usage
    const userResult = await client.query(
      'SELECT role, storage_quota, storage_used FROM users WHERE user_id = $1',
      [userId]
    );

    const user = userResult.rows[0];
    const quotaLimit = getEffectiveQuotaBytes(user.role, user.storage_quota);
    const currentUsed = await getPersonalStorageUsedBytes(client, userId);
    const fileSize = file.buffer.length;

    console.log('📊 Storage Check:');
    console.log('  Current used:', currentUsed);
    console.log('  File size:', fileSize);
    console.log('  Total after upload:', currentUsed + fileSize);
    console.log('  Quota limit:', quotaLimit);
    console.log('  Will exceed?', (currentUsed + fileSize) > quotaLimit);

    // Check if upload would exceed quota (only personal uploads count toward personal quota)
    if (uploadScope === 'personal' && quotaLimit !== null && currentUsed + fileSize > quotaLimit) {
      const remainingSpace = quotaLimit - currentUsed;
      await logAudit({
        userId,
        sessionId: req.sessionId,
        operationType: 'upload',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ filename: file.originalname, size: file.size, remaining: remainingSpace }),
        status: 'failed',
        errorMessage: 'Storage quota exceeded',
        userAgent: req.headers['user-agent']
      });
      return res.status(400).json({
        error: 'Storage quota exceeded',
        remaining: remainingSpace,
        required: fileSize
      });
    }

    // Encrypt file
    const encryptionResult = encryptFile(file.buffer);

    // Generate unique filename for R2
    const fileId = crypto.randomUUID();
    const isSubmissionUpload = uploadScope === 'classroom'
      && classroomId
      && normalizeRole(req.user?.role) === 'student'
      && uploadCategory === 'submission';

    const encryptedFilename = isSubmissionUpload
      ? `submission/${classroomId}/${userId}/${fileId}`
      : (uploadScope === 'classroom' && classroomId
        ? `classroom/${classroomId}/${userId}/${fileId}`
        : `personal/${userId}/${fileId}`);

    // Upload to R2
    await r2Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: encryptedFilename,
      Body: encryptionResult.encryptedData,
      ContentType: file.mimetype,
    }));

    // Get file extension
    const fileExtension = file.originalname.split('.').pop() || '';

    // Encrypt the encryption key
    const masterKey = process.env.JWT_SECRET;
    const keyIv = crypto.randomBytes(16);
    const keyCipher = crypto.createCipheriv('aes-256-cbc', crypto.createHash('sha256').update(masterKey).digest(), keyIv);
    const encryptedKey = Buffer.concat([keyCipher.update(encryptionResult.key, 'base64'), keyCipher.final()]);

    // Store file metadata in database
    const fileInsertSql = scopeSupported
      ? `INSERT INTO files (
          user_id, folder_id, original_filename, encrypted_filename,
          file_size, file_type, file_extension, encryption_key_encrypted,
          initialization_vector, authentication_tag, sha256_checksum, r2_storage_path,
          file_scope, classroom_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *`
      : `INSERT INTO files (
          user_id, folder_id, original_filename, encrypted_filename,
          file_size, file_type, file_extension, encryption_key_encrypted,
          initialization_vector, authentication_tag, sha256_checksum, r2_storage_path
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`;

    const fileInsertParams = scopeSupported
      ? [
        userId, folderId || null, file.originalname, encryptedFilename,
        file.size, file.mimetype, fileExtension,
        encryptedKey.toString('base64') + ':' + keyIv.toString('base64'),
        encryptionResult.iv, encryptionResult.authTag, encryptionResult.checksum,
        encryptedFilename,
        uploadScope,
        classroomId
      ]
      : [
        userId, folderId || null, file.originalname, encryptedFilename,
        file.size, file.mimetype, fileExtension,
        encryptedKey.toString('base64') + ':' + keyIv.toString('base64'),
        encryptionResult.iv, encryptionResult.authTag, encryptionResult.checksum,
        encryptedFilename
      ];

    const fileResult = await client.query(fileInsertSql, fileInsertParams);

    // If folder is specified, create association
    if (folderId) {
      await client.query(
        'INSERT INTO file_folder_associations (file_id, folder_id) VALUES ($1, $2)',
        [fileResult.rows[0].file_id, folderId]
      );
    }

    // Keep users.storage_used synced to PERSONAL scope only
    await syncUserPersonalStorageUsed(client, userId);

    await client.query('COMMIT');

    // Log successful upload
    await logAudit({
      userId,
      fileId: fileResult.rows[0].file_id,
      sessionId: req.sessionId,
      operationType: 'upload',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({ filename: file.originalname, size: file.size }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });

    if (requestedScope === 'classroom') {
      await appendClassroomStorageLog({
        actorUserId: userId,
        actorRole: req.user.role,
        operationType: 'material_uploaded',
        operationLabel: 'Class Material Uploaded',
        target: file.originalname,
        targetType: 'Material',
        details: {
          fileId: fileResult.rows[0].file_id,
          classroomId: classroomId || requestedClassroomId || null,
          scope: requestedScope
        }
      });
    }

    res.json({
      message: 'File uploaded successfully',
      file: fileResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Upload error:', error);

    await logAudit({
      userId: req.user.userId,
      sessionId: req.sessionId,
      operationType: 'upload',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({ error: error.message }),
      status: 'failed',
      errorMessage: error.message,
      userAgent: req.headers['user-agent']
    });

    res.status(500).json({ error: 'Upload failed' });
  } finally {
    client.release();
  }
}

// Get User Files
// Get User Files
async function getUserFiles(req, res) {
  try {
    await ensureFileScopeColumns(pool);
    await ensureFileUpdatedAtColumn(pool);
    const scopeSupported = await hasFileScopeColumns(pool);

    const userId = req.user.userId;
    const { folderId, search, fileType, dateFrom, dateTo, dateField = 'uploaded' } = req.query;
    const normalizedDateField = String(dateField || 'uploaded').trim().toLowerCase() === 'edited'
      ? 'edited'
      : 'uploaded';
    
    console.log('📁 Get user files request:', { userId, folderId, search, fileType });
    
    let query = `
      SELECT f.*, 
        ARRAY_AGG(DISTINCT ffa.folder_id) FILTER (WHERE ffa.folder_id IS NOT NULL) as folder_ids,
        ARRAY_AGG(DISTINCT fo.folder_name) FILTER (WHERE fo.folder_name IS NOT NULL) as folder_names,
        (
          SELECT COUNT(DISTINCT fs.recipient_user_id)
          FROM file_sharings fs
          WHERE fs.file_id = f.file_id
            AND fs.sharer_user_id = f.user_id
            AND fs.is_active = true
        ) AS recipient_count,
        (
          SELECT COUNT(*)
          FROM file_sharings fs
          WHERE fs.file_id = f.file_id
            AND fs.sharer_user_id = f.user_id
        ) AS total_share_count
      FROM files f
      LEFT JOIN file_folder_associations ffa ON f.file_id = ffa.file_id
      LEFT JOIN folders fo ON ffa.folder_id = fo.folder_id
      WHERE f.user_id = $1
        AND f.is_deleted = false
        ${scopeSupported ? "AND COALESCE(f.file_scope, 'personal') = 'personal'" : ''}
    `;
    
    const params = [userId];
    let paramCount = 1;
    
    if (folderId) {
      paramCount++;
      query += ` AND ffa.folder_id = $${paramCount}`;
      params.push(folderId);
    }
    
    if (search) {
      paramCount++;
      query += ` AND f.original_filename ILIKE $${paramCount}`;
      params.push(`%${search}%`);
    }
    
    if (fileType) {
      paramCount++;
      query += ` AND f.file_type LIKE $${paramCount}`;
      params.push(`${fileType}%`);
    }
    
    if (dateFrom) {
      paramCount++;
      query += normalizedDateField === 'edited'
        ? ` AND COALESCE(f.updated_at, f.uploaded_at) >= $${paramCount}`
        : ` AND f.uploaded_at >= $${paramCount}`;
      params.push(dateFrom);
    }
    
    if (dateTo) {
      paramCount++;
      query += normalizedDateField === 'edited'
        ? ` AND COALESCE(f.updated_at, f.uploaded_at) <= $${paramCount}`
        : ` AND f.uploaded_at <= $${paramCount}`;
      params.push(dateTo);
    }
    
    query += ` GROUP BY f.file_id ORDER BY f.uploaded_at DESC`;
    
    console.log('📊 Query:', query);
    console.log('📊 Params:', params);
    
    const result = await pool.query(query, params);
    
    console.log(`✅ Found ${result.rows.length} files for user ${userId}`);
    
    res.json({ files: result.rows });
    
  } catch (error) {
    console.error('❌ Get files error:', error);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
}

// Get Shared Files
async function getSharedFiles(req, res) {
  try {
    await ensureSharingPermissionColumns(pool);

    const userId = req.user.userId;
    const { search, sharerRole, dateFrom, dateTo } = req.query;
    
    console.log('📥 Get shared files request:', { userId, search, sharerRole, dateFrom, dateTo });
    
    let query = `
      SELECT f.*, fs.shared_at, fs.sharing_id, fs.is_active as sharing_active,
        COALESCE(fs.can_download, true) AS can_download,
        COALESCE(fs.can_edit, true) AS can_edit,
        COALESCE(fs.can_rename, true) AS can_rename,
        u.full_name as sharer_name, u.role as sharer_role, u.user_id as sharer_id
      FROM file_sharings fs
      JOIN files f ON fs.file_id = f.file_id
      JOIN users u ON fs.sharer_user_id = u.user_id
      WHERE fs.recipient_user_id = $1 AND fs.is_active = true AND f.is_deleted = false
    `;
    
    const params = [userId];
    let paramCount = 1;
    
    if (search) {
      paramCount++;
      query += ` AND (f.original_filename ILIKE $${paramCount} OR u.full_name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }
    
    if (sharerRole) {
      paramCount++;
      query += ` AND u.role = $${paramCount}`;
      params.push(sharerRole);
    }
    
    if (dateFrom) {
      paramCount++;
      query += ` AND fs.shared_at >= $${paramCount}`;
      params.push(dateFrom);
    }
    
    if (dateTo) {
      paramCount++;
      query += ` AND fs.shared_at <= $${paramCount}`;
      params.push(dateTo);
    }
    
    query += ` ORDER BY fs.shared_at DESC`;
    
    console.log('📊 Query:', query);
    console.log('📊 Params:', params);
    
    const result = await pool.query(query, params);
    
    console.log(`✅ Found ${result.rows.length} shared files for user ${userId}`);
    
    res.json({ files: result.rows });
    
  } catch (error) {
    console.error('❌ Get shared files error:', error);
    res.status(500).json({ error: 'Failed to fetch shared files' });
  }
}

// Download File
async function downloadFile(req, res) {
  try {
    await ensureSharingPermissionColumns(pool);

    const { fileId } = req.params;
    const userId = req.user.userId;
    const downloadStartedAt = Date.now();

    // Check permissions
    const permissionResult = await pool.query(
      `SELECT f.*, 
        CASE 
          WHEN f.user_id = $1 THEN true
          WHEN EXISTS (
            SELECT 1 FROM file_sharings fs 
            WHERE fs.file_id = f.file_id 
            AND fs.recipient_user_id = $1 
            AND fs.is_active = true
            AND COALESCE(fs.can_download, true) = true
          ) THEN true
          ELSE false
        END as has_permission
      FROM files f
      WHERE f.file_id = $2 AND f.is_deleted = false`,
      [userId, fileId]
    );

    if (permissionResult.rows.length === 0) {
      await logAudit({
        userId,
        fileId: parseInt(fileId),
        sessionId: req.sessionId,
        operationType: 'download',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ file_id: fileId }),
        status: 'failed',
        errorMessage: 'File not found',
        userAgent: req.headers['user-agent']
      });
      return res.status(404).json({ error: 'File not found' });
    }

    const file = permissionResult.rows[0];
    let hasPermission = Boolean(file.has_permission);
    if (!hasPermission && normalizeRole(req.user.role) === 'student') {
      hasPermission = await hasStudentClassroomAccessToFile(userId, fileId);
    } else if (!hasPermission && normalizeRole(req.user.role) === 'teacher') {
      hasPermission = await hasTeacherClassroomAccessToFile(userId, file);
    }

    if (!hasPermission) {
      await logAudit({
        userId,
        fileId: parseInt(fileId),
        sessionId: req.sessionId,
        operationType: 'access_denied',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ file_id: fileId, attempted_operation: 'download' }),
        status: 'failed',
        errorMessage: 'Permission denied',
        userAgent: req.headers['user-agent']
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    // Retrieve encrypted file from R2
    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: file.r2_storage_path,
    });

    const r2Response = await r2Client.send(getCommand);
    const encryptedStream = r2Response.Body;

    // Decrypt encryption key
    const [encryptedKey, keyIv] = file.encryption_key_encrypted.split(':');
    const masterKey = process.env.JWT_SECRET;
    const keyDecipher = crypto.createDecipheriv(
      'aes-256-cbc',
      crypto.createHash('sha256').update(masterKey).digest(),
      Buffer.from(keyIv, 'base64')
    );
    const decryptedKey = Buffer.concat([
      keyDecipher.update(Buffer.from(encryptedKey, 'base64')),
      keyDecipher.final()
    ]).toString('base64');

    let decryptedChecksum = null;
    const decryptStream = createDecryptionStream({
      key: decryptedKey,
      iv: file.initialization_vector,
      authTag: file.authentication_tag,
      onHashFinalized: (hash) => {
        decryptedChecksum = hash;
      }
    });

    res.setHeader('Content-Disposition', `attachment; filename="${file.original_filename}"`);
    res.setHeader('Content-Type', file.file_type || 'application/octet-stream');
    if (Number(file.file_size) > 0) {
      res.setHeader('Content-Length', String(Number(file.file_size)));
      res.setHeader('x-download-file-size', String(Number(file.file_size)));
    }

    await pipeline(encryptedStream, decryptStream, res);

    const integrityPassed = !file.sha256_checksum || decryptedChecksum === file.sha256_checksum;
    const downloadTimeMs = Date.now() - downloadStartedAt;

    await ensureDownloadMetricsColumns(pool);
    await pool.query(
      `INSERT INTO file_access_logs
       (file_id, user_id, access_type, integrity_check_passed, ip_address, file_size_bytes, download_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [fileId, userId, 'download', integrityPassed, req.ip, Number(file.file_size) || 0, downloadTimeMs]
    );

    await logAudit({
      userId,
      fileId: parseInt(fileId),
      sessionId: req.sessionId,
      operationType: 'download',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({
        file_id: fileId,
        filename: file.original_filename,
        size: Number(file.file_size) || 0,
        download_time_ms: downloadTimeMs,
        integrity_check_passed: integrityPassed
      }),
      status: integrityPassed ? 'success' : 'warning',
      userAgent: req.headers['user-agent']
    });

    if (String(file.file_scope || '').toLowerCase() === 'classroom') {
      await appendClassroomStorageLog({
        actorUserId: userId,
        actorRole: req.user.role,
        operationType: 'material_downloaded',
        operationLabel: 'Class Material Downloaded',
        target: file.original_filename,
        targetType: 'Material',
        details: {
          fileId: Number(file.file_id) || Number(fileId),
          classroomId: Number(file.classroom_id) || null,
          scope: 'classroom',
          downloadTimeMs,
          fileSizeBytes: Number(file.file_size) || 0
        }
      });
    }

  } catch (error) {
    console.error('Download error:', error);

    await logAudit({
      userId: req.user.userId,
      fileId: parseInt(req.params.fileId),
      sessionId: req.sessionId,
      operationType: 'download',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({ error: error.message }),
      status: 'failed',
      errorMessage: error.message,
      userAgent: req.headers['user-agent']
    });

    res.status(500).json({ error: 'Download failed' });
  }
}

// Delete File
// Delete File
async function deleteFile(req, res) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    await ensureFileScopeColumns(client);
    
    const { fileId } = req.params;
    const userId = req.user.userId;
    
    // Verify ownership - MUST be the owner, not just have access via sharing
    const fileResult = await client.query(
      'SELECT * FROM files WHERE file_id = $1 AND is_deleted = false',
      [fileId]
    );
    
    if (fileResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'File not found' });
    }
    
    const file = fileResult.rows[0];
    
    // Check if user is the actual owner
    const ownerId = Number(file.user_id);
    const actorId = Number(userId);
    const isOwner = Number.isFinite(ownerId) && Number.isFinite(actorId)
      ? ownerId === actorId
      : String(file.user_id) === String(userId);

    if (!isOwner) {
      await logAudit({
        userId,
        fileId: parseInt(fileId),
        sessionId: req.sessionId,
        operationType: 'access_denied',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ file_id: fileId, attempted_operation: 'delete' }),
        status: 'failed',
        errorMessage: 'Permission denied',
        userAgent: req.headers['user-agent']
      });
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        error: 'You can only delete files you own. Shared files cannot be deleted.' 
      });
    }
    
    // Delete from R2
    if (file.r2_storage_path) {
      try {
        await r2Client.send(new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: file.r2_storage_path,
        }));
      } catch (r2Error) {
        const code = String(r2Error?.name || r2Error?.Code || '');
        const isMissingObject = code === 'NoSuchKey' || code === 'NotFound';
        if (!isMissingObject) {
          throw r2Error;
        }
      }
    }

    // Remove sharing permissions and related notifications
    await client.query(
      `DELETE FROM sharing_notifications sn
       USING file_sharings fs
       WHERE sn.sharing_id = fs.sharing_id
         AND fs.file_id = $1`,
      [fileId]
    );
    await client.query('DELETE FROM file_sharings WHERE file_id = $1', [fileId]);

    // Remove folder associations
    await client.query('DELETE FROM file_folder_associations WHERE file_id = $1', [fileId]);

    // Remove access logs if present
    try {
      await client.query('DELETE FROM file_access_logs WHERE file_id = $1', [fileId]);
    } catch (logDeleteError) {
      console.warn('Skipping file_access_logs cleanup:', logDeleteError?.message || logDeleteError);
    }
    
    // Hard delete file metadata row from database
    await client.query(
      `DELETE FROM files
       WHERE file_id = $1`,
      [fileId]
    );
    
    // Keep users.storage_used synced to PERSONAL scope only
    await syncUserPersonalStorageUsed(client, userId);
    
    await client.query('COMMIT');
    
    // Log deletion
    await logAudit({
      userId,
      fileId: parseInt(fileId),
      sessionId: req.sessionId,
      operationType: 'delete',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({ filename: file.original_filename, size: file.file_size }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });

    if (String(file.file_scope || '').toLowerCase() === 'classroom') {
      await appendClassroomStorageLog({
        actorUserId: userId,
        actorRole: req.user.role,
        operationType: 'material_deleted',
        operationLabel: 'Class Material Deleted',
        target: file.original_filename,
        targetType: 'Material',
        details: {
          fileId: Number(file.file_id) || Number(fileId),
          classroomId: Number(file.classroom_id) || null,
          scope: 'classroom'
        }
      });
    }
    
    res.json({ 
      message: 'File deleted successfully',
      freedSpace: file.file_size
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete error:', error);
    
    await logAudit({
      userId: req.user.userId,
      fileId: parseInt(req.params.fileId),
      sessionId: req.sessionId,
      operationType: 'delete',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({ error: error.message }),
      status: 'failed',
      errorMessage: error.message,
      userAgent: req.headers['user-agent']
    });
    
    res.status(500).json({ error: 'Deletion failed' });
  } finally {
    client.release();
  }
}

// Preview File (returns decrypted file for browser preview)
async function previewFile(req, res) {
  try {
    const { fileId } = req.params;
    const userId = req.user.userId;
    
    // Check permissions
    const permissionResult = await pool.query(
      `SELECT f.*, 
        CASE 
          WHEN f.user_id = $1 THEN true
          WHEN EXISTS (
            SELECT 1 FROM file_sharings fs 
            WHERE fs.file_id = f.file_id 
            AND fs.recipient_user_id = $1 
            AND fs.is_active = true
          ) THEN true
          ELSE false
        END as has_permission
      FROM files f
      WHERE f.file_id = $2 AND f.is_deleted = false`,
      [userId, fileId]
    );
    
    if (permissionResult.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = permissionResult.rows[0];
    let hasPermission = Boolean(file.has_permission);
    if (!hasPermission && normalizeRole(req.user.role) === 'student') {
      hasPermission = await hasStudentClassroomAccessToFile(userId, fileId);
    } else if (!hasPermission && normalizeRole(req.user.role) === 'teacher') {
      hasPermission = await hasTeacherClassroomAccessToFile(userId, file);
    }

    if (!hasPermission) {
      await logAudit({
        userId,
        fileId: parseInt(fileId),
        sessionId: req.sessionId,
        operationType: 'access_denied',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ file_id: fileId, attempted_operation: 'preview' }),
        status: 'failed',
        errorMessage: 'Permission denied',
        userAgent: req.headers['user-agent']
      });
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Check if file type is previewable
    const previewableTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'text/plain', 'text/html', 'text/css', 'text/javascript', 'text/csv',
      'application/json', 'application/xml',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.oasis.opendocument.text',
      'application/rtf',
      'text/rtf'
    ];
    
    if (!previewableTypes.includes(file.file_type) && !file.file_type.startsWith('image/') && !file.file_type.startsWith('text/')) {
      return res.status(400).json({ error: 'File type not supported for preview' });
    }
    
    // Retrieve encrypted file from R2
    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: file.r2_storage_path,
    });
    
    const r2Response = await r2Client.send(getCommand);
    const encryptedBuffer = await streamToBuffer(r2Response.Body);
    
    // Decrypt encryption key
    const [encryptedKey, keyIv] = file.encryption_key_encrypted.split(':');
    const masterKey = process.env.JWT_SECRET;
    const keyDecipher = crypto.createDecipheriv(
      'aes-256-cbc',
      crypto.createHash('sha256').update(masterKey).digest(),
      Buffer.from(keyIv, 'base64')
    );
    const decryptedKey = Buffer.concat([
      keyDecipher.update(Buffer.from(encryptedKey, 'base64')),
      keyDecipher.final()
    ]).toString('base64');
    
    // Decrypt file
    const decryptedBuffer = decryptFile(
      encryptedBuffer,
      decryptedKey,
      file.initialization_vector,
      file.authentication_tag
    );
    
    // Verify integrity
    const checksum = crypto.createHash('sha256').update(decryptedBuffer).digest('hex');
    const integrityPassed = checksum === file.sha256_checksum;
    
    if (!integrityPassed) {
      await logAudit({
        userId,
        fileId: parseInt(fileId),
        sessionId: req.sessionId,
        operationType: 'preview',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ file_id: fileId, filename: file.original_filename }),
        status: 'failed',
        errorMessage: 'Integrity check failed',
        userAgent: req.headers['user-agent']
      });
      
      return res.status(500).json({ error: 'File integrity verification failed' });
    }
    
    // Log preview access
    await logAudit({
      userId,
      fileId: parseInt(fileId),
      sessionId: req.sessionId,
      operationType: 'preview',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({ file_id: fileId, filename: file.original_filename }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });
    
    await pool.query(
      'INSERT INTO file_access_logs (file_id, user_id, access_type, integrity_check_passed, ip_address) VALUES ($1, $2, $3, $4, $5)',
      [fileId, userId, 'preview', true, req.ip]
    );

    if (String(file.file_scope || '').toLowerCase() === 'classroom') {
      await appendClassroomStorageLog({
        actorUserId: userId,
        actorRole: req.user.role,
        operationType: 'material_previewed',
        operationLabel: 'Class Material Previewed',
        target: file.original_filename,
        targetType: 'Material',
        details: {
          fileId: Number(file.file_id) || Number(fileId),
          classroomId: Number(file.classroom_id) || null,
          scope: 'classroom'
        }
      });
    }
    
    // IMPORTANT: Force text files (including HTML, CSS, JS) to display as plain text
    let contentType = file.file_type;
    if (file.file_type === 'text/html' || 
        file.file_type === 'text/css' || 
        file.file_type === 'text/javascript' ||
        file.file_type === 'application/json' ||
        file.file_type === 'application/xml') {
      contentType = 'text/plain'; // Force as plain text to show code
    }
    
    // Send decrypted file for preview
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff'); // Security: prevent MIME sniffing
    res.send(decryptedBuffer);
    
  } catch (error) {
    console.error('Preview error:', error);
    
    await logAudit({
      userId: req.user.userId,
      fileId: parseInt(req.params.fileId),
      sessionId: req.sessionId,
      operationType: 'preview',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({ error: error.message }),
      status: 'failed',
      errorMessage: error.message,
      userAgent: req.headers['user-agent']
    });
    
    res.status(500).json({ error: 'Preview failed' });
  }
}

// Edit/Update File Content (for text files)
async function updateFileContent(req, res) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    await ensureFileScopeColumns(client);
    
    const { fileId } = req.params;
    const { content } = req.body;
    const userId = req.user.userId;
    
    if (content === undefined || content === null) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    // Verify ownership - only file owner can edit
    const fileResult = await client.query(
      'SELECT * FROM files WHERE file_id = $1 AND is_deleted = false',
      [fileId]
    );
    
    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const file = fileResult.rows[0];
    
    // Check if user is the owner
    if (file.user_id !== userId) {
      await logAudit({
        userId,
        fileId: parseInt(fileId),
        sessionId: req.sessionId,
        operationType: 'access_denied',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ file_id: fileId, attempted_operation: 'edit' }),
        status: 'failed',
        errorMessage: 'Permission denied',
        userAgent: req.headers['user-agent']
      });
      return res.status(403).json({ 
        error: 'You can only edit files you own' 
      });
    }
    
    // Check if file type is editable
    const editableTypes = ['text/plain', 'text/markdown'];
    if (!editableTypes.includes(file.file_type)) {
      return res.status(400).json({ 
        error: 'This file type cannot be edited. Only .txt and .md files are supported.' 
      });
    }
    
    // Convert content string to buffer
    const contentBuffer = Buffer.from(content, 'utf-8');
    const newFileSize = contentBuffer.length;
    const oldFileSize = parseInt(file.file_size);
    const sizeDifference = newFileSize - oldFileSize;
    
    console.log('📝 File Edit:', {
      filename: file.original_filename,
      oldSize: oldFileSize,
      newSize: newFileSize,
      difference: sizeDifference
    });
    
    // Check storage quota ONLY if file size increased
    if (sizeDifference > 0) {
      const userResult = await client.query(
        'SELECT role, storage_quota, storage_used FROM users WHERE user_id = $1',
        [userId]
      );
      
      const user = userResult.rows[0];
      const currentUsed = await getPersonalStorageUsedBytes(client, userId);
      const quotaLimit = getEffectiveQuotaBytes(user.role, user.storage_quota);
      const availableSpace = quotaLimit === null ? Number.POSITIVE_INFINITY : quotaLimit - currentUsed;
      
      console.log('💾 Storage Check:', {
        currentUsed,
        quotaLimit,
        availableSpace,
        needsAdditional: sizeDifference,
        willExceed: quotaLimit === null ? false : (currentUsed + sizeDifference) > quotaLimit
      });
      
      // We only need to check if we have enough space for the ADDITIONAL bytes
      if (quotaLimit !== null && sizeDifference > availableSpace) {
        return res.status(400).json({ 
          error: `Storage quota exceeded. This edit requires ${Math.round(sizeDifference / 1024)} KB more space, but only ${Math.round(availableSpace / 1024)} KB is available.`
        });
      }
    }
    
    // Encrypt new content
    const encryptionResult = encryptFile(contentBuffer);
    
    // Upload encrypted file to R2 (replace existing)
    await r2Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: file.r2_storage_path,
      Body: encryptionResult.encryptedData,
      ContentType: file.file_type,
    }));
    
    // Encrypt the encryption key
    const masterKey = process.env.JWT_SECRET;
    const keyIv = crypto.randomBytes(16);
    const keyCipher = crypto.createCipheriv('aes-256-cbc', crypto.createHash('sha256').update(masterKey).digest(), keyIv);
    const encryptedKey = Buffer.concat([keyCipher.update(encryptionResult.key, 'base64'), keyCipher.final()]);
    
    // Update file metadata in database
    await client.query(
      `UPDATE files SET
        file_size = $1,
        encryption_key_encrypted = $2,
        initialization_vector = $3,
        authentication_tag = $4,
        sha256_checksum = $5,
        last_modified_at = CURRENT_TIMESTAMP
      WHERE file_id = $6`,
      [
        newFileSize,
        encryptedKey.toString('base64') + ':' + keyIv.toString('base64'),
        encryptionResult.iv,
        encryptionResult.authTag,
        encryptionResult.checksum,
        fileId
      ]
    );
    
    // Keep users.storage_used synced to PERSONAL scope only
    if (sizeDifference !== 0) {
      await syncUserPersonalStorageUsed(client, userId);
      console.log(`✅ Updated storage usage by ${sizeDifference > 0 ? '+' : ''}${sizeDifference} bytes`);
    }
    
    await client.query('COMMIT');
    
    // Log edit
    try {
      await logAudit({
        userId,
        fileId: parseInt(fileId),
        sessionId: req.sessionId,
        operationType: 'edit',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ 
          filename: file.original_filename, 
          old_size: oldFileSize, 
          new_size: newFileSize,
          size_difference: sizeDifference
        }),
        status: 'success',
        userAgent: req.headers['user-agent']
      });
    } catch (auditError) {
      console.error('Audit log error (non-critical):', auditError);
    }
    
    res.json({ 
      message: 'File updated successfully',
      fileSize: newFileSize,
      sizeDifference
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Update file error:', error);
    
    try {
      await logAudit({
        userId: req.user.userId,
        fileId: parseInt(req.params.fileId),
        sessionId: req.sessionId,
        operationType: 'edit',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ error: error.message }),
        status: 'failed',
        errorMessage: error.message,
        userAgent: req.headers['user-agent']
      });
    } catch (auditError) {
      console.error('Audit log error (non-critical):', auditError);
    }
    
    res.status(500).json({ error: 'Failed to update file' });
  } finally {
    client.release();
  }
}

// Get storage quota
async function getStorageQuota(req, res) {
  try {
    await ensureFileScopeColumns(pool);

    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT storage_quota, role FROM users WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { storage_quota, role } = result.rows[0];
    const storage_used = await getPersonalStorageUsedBytes(pool, userId);
    await pool.query('UPDATE users SET storage_used = $1 WHERE user_id = $2', [storage_used, userId]);
    const effectiveQuota = getEffectiveQuotaBytes(role, storage_quota);
    const isUnlimited = effectiveQuota === null;
    const percentageUsed = isUnlimited ? 0 : (storage_used / effectiveQuota) * 100;

    res.json({
      quota: effectiveQuota,
      used: storage_used,
      remaining: isUnlimited ? null : effectiveQuota - storage_used,
      percentageUsed: percentageUsed.toFixed(2),
      isUnlimited,
      role
    });

  } catch (error) {
    console.error('Get quota error:', error);
    res.status(500).json({ error: 'Failed to fetch storage quota' });
  }
}


// Get file details
async function getFileDetails(req, res) {
  try {
    await ensureDownloadMetricsColumns(pool);

    const { fileId } = req.params;
    const userId = req.user.userId;
    
    // Get file with download count and last access
    const result = await pool.query(
      `SELECT f.*,
        CASE 
          WHEN f.user_id = $1 THEN true
          WHEN EXISTS (
            SELECT 1 FROM file_sharings fs2
            WHERE fs2.file_id = f.file_id AND fs2.recipient_user_id = $1 AND fs2.is_active = true
          ) THEN true
          ELSE false
        END as has_permission,
        CASE WHEN f.user_id = $1 THEN true ELSE false END as is_owner,
        (SELECT COUNT(*) FROM file_access_logs WHERE file_id = f.file_id AND access_type = 'download') as download_count,
        (SELECT MAX(accessed_at) FROM file_access_logs WHERE file_id = f.file_id AND access_type = 'download') as last_accessed
      FROM files f
      WHERE f.file_id = $2 AND f.is_deleted = false`,
      [userId, fileId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];
    let hasPermission = Boolean(file.has_permission);
    if (!hasPermission && normalizeRole(req.user.role) === 'student') {
      hasPermission = await hasStudentClassroomAccessToFile(userId, fileId);
    } else if (!hasPermission && normalizeRole(req.user.role) === 'teacher') {
      hasPermission = await hasTeacherClassroomAccessToFile(userId, file);
    }

    if (!hasPermission) {
      await logAudit({
        userId,
        fileId: parseInt(fileId),
        sessionId: req.sessionId,
        operationType: 'access_denied',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ file_id: fileId, attempted_operation: 'view_file_details' }),
        status: 'failed',
        errorMessage: 'Permission denied',
        userAgent: req.headers['user-agent']
      });
      return res.status(404).json({ error: 'File not found' });
    }
    
    const responsePayload = { file };

    if (Boolean(file.is_owner)) {
      const sharingHistoryResult = await pool.query(
        `SELECT
          fs.sharing_id,
          fs.shared_at,
          fs.is_active,
          u.user_id AS recipient_id,
          u.full_name AS recipient_name,
          u.email AS recipient_email,
          u.role AS recipient_role
         FROM file_sharings fs
         JOIN users u ON fs.recipient_user_id = u.user_id
         WHERE fs.file_id = $1
           AND fs.sharer_user_id = $2
         ORDER BY fs.shared_at DESC`,
        [fileId, userId]
      );

      const downloadHistoryResult = await pool.query(
        `SELECT
          fal.access_log_id AS log_id,
          fal.user_id,
          u.full_name AS downloader_name,
          u.email AS downloader_email,
          fal.integrity_check_passed,
          fal.file_size_bytes,
          fal.download_time_ms,
          fal.accessed_at
         FROM file_access_logs fal
         LEFT JOIN users u ON fal.user_id = u.user_id
         WHERE fal.file_id = $1
           AND fal.access_type = 'download'
         ORDER BY fal.accessed_at DESC
         LIMIT 100`,
        [fileId]
      );

      responsePayload.sharingHistory = sharingHistoryResult.rows;
      responsePayload.totalShares = sharingHistoryResult.rows.length;
      responsePayload.totalReceivers = new Set(sharingHistoryResult.rows.map((row) => row.recipient_id)).size;
      responsePayload.downloadHistory = downloadHistoryResult.rows;
    }

    res.json(responsePayload);
    
  } catch (error) {
    console.error('Get file details error:', error);
    res.status(500).json({ error: 'Failed to fetch file details' });
  }
}


function normalizeSharePermissionPreset(preset) {
  const normalized = String(preset || 'all').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SHARE_PERMISSION_PRESETS, normalized)
    ? normalized
    : 'all';
}

function resolveSharePermissions(preset) {
  const normalizedPreset = normalizeSharePermissionPreset(preset);
  return {
    preset: normalizedPreset,
    ...SHARE_PERMISSION_PRESETS[normalizedPreset]
  };
}

// Share files with recipients
async function shareFiles(req, res) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    await ensureSharingNotificationColumns(client);
    await ensureSharingPermissionColumns(client);

    const { fileIds, recipientIds } = req.body;
    const userId = req.user.userId;
    const shareBatchId = crypto.randomUUID();
    const sharePermissions = resolveSharePermissions(req.body?.permission || req.body?.sharePermission || 'all');
    
    console.log('📤 Share request:', { fileIds, recipientIds, userId });
    
    if (!fileIds || fileIds.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }
    
    if (!recipientIds || recipientIds.length === 0) {
      return res.status(400).json({ error: 'No recipients provided' });
    }

    const normalizedRecipientIds = [...new Set(
      recipientIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )];

    if (normalizedRecipientIds.length === 0) {
      return res.status(400).json({ error: 'No valid recipients provided' });
    }
    
    // Check if trying to share with self
    if (normalizedRecipientIds.includes(Number(userId))) {
      return res.status(400).json({ error: 'You cannot share files with yourself' });
    }
    
    // Verify file ownership
    const filesResult = await client.query(
      'SELECT file_id, original_filename FROM files WHERE file_id = ANY($1::integer[]) AND user_id = $2 AND is_deleted = false',
      [fileIds, userId]
    );
    
    if (filesResult.rows.length !== fileIds.length) {
      return res.status(403).json({ error: 'You can only share files you own' });
    }
    
    // Verify recipients exist and are active
    const recipientsResult = await client.query(
      `SELECT user_id, full_name, email, role
       FROM users
       WHERE user_id = ANY($1::integer[])
         AND is_active = true
         AND account_status = $2
         AND role IN ('teacher', 'student')`,
      [normalizedRecipientIds, 'active']
    );
    
    if (recipientsResult.rows.length !== normalizedRecipientIds.length) {
      return res.status(400).json({ error: 'Some recipients are invalid or inactive' });
    }
    
    let shareCount = 0;
    let notificationCount = 0;
    const notifications = [];
    
    // Create sharing permissions for each file-recipient pair
    for (const fileId of fileIds) {
      for (const recipientId of normalizedRecipientIds) {
        // Insert sharing permission (ignore if already shared)
        const shareResult = await client.query(
          `INSERT INTO file_sharings (
             file_id, sharer_user_id, recipient_user_id, shared_at, is_active,
             can_download, can_edit, can_rename
           )
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP, true, $4, $5, $6)
           ON CONFLICT (file_id, sharer_user_id, recipient_user_id) 
           DO UPDATE SET
             is_active = true,
             shared_at = CURRENT_TIMESTAMP,
             can_download = EXCLUDED.can_download,
             can_edit = EXCLUDED.can_edit,
             can_rename = EXCLUDED.can_rename
           RETURNING sharing_id`,
          [
            fileId,
            userId,
            recipientId,
            sharePermissions.canDownload,
            sharePermissions.canEdit,
            sharePermissions.canRename
          ]
        );
        
        if (shareResult.rows.length > 0) {
          shareCount++;
          const sharingId = shareResult.rows[0].sharing_id;
          const notificationGroupId = `${shareBatchId}:${recipientId}`;
          
          // Create notification for recipient
          await client.query(
            `INSERT INTO sharing_notifications (sharing_id, recipient_user_id, notification_group_id, is_read, created_at)
             VALUES ($1, $2, $3, false, CURRENT_TIMESTAMP)`,
            [sharingId, recipientId, notificationGroupId]
          );
          
          notificationCount++;
          
          // Store notification details for response
          const recipient = recipientsResult.rows.find(r => r.user_id === recipientId);
          const file = filesResult.rows.find(f => f.file_id === fileId);
          notifications.push({
            recipientName: recipient.full_name,
            fileName: file.original_filename
          });
        }
      }
    }
    
    await client.query('COMMIT');
    
    // Log sharing activity
    try {
      await logAudit({
        userId,
        sessionId: req.sessionId,
        operationType: 'share',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ 
          file_ids: fileIds,
          recipient_ids: recipientIds,
          share_count: shareCount,
          notification_count: notificationCount,
          permission: sharePermissions.preset,
          can_download: sharePermissions.canDownload,
          can_edit: sharePermissions.canEdit,
          can_rename: sharePermissions.canRename
        }),
        status: 'success',
        userAgent: req.headers['user-agent']
      });
    } catch (auditError) {
      console.error('Audit log error (non-critical):', auditError);
    }
    
    console.log(`✅ Successfully shared ${fileIds.length} file(s) with ${recipientIds.length} recipient(s)`);
    
    res.json({ 
      message: `Successfully shared ${fileIds.length} file(s) with ${normalizedRecipientIds.length} recipient(s)`,
      shareCount,
      notificationCount,
      filesShared: fileIds.length,
      recipientsNotified: normalizedRecipientIds.length,
      sharedAt: new Date().toISOString(),
      permission: sharePermissions.preset,
      permissions: {
        canDownload: sharePermissions.canDownload,
        canEdit: sharePermissions.canEdit,
        canRename: sharePermissions.canRename
      }
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Share error:', error);
    
    try {
      await logAudit({
        userId: req.user.userId,
        sessionId: req.sessionId,
        operationType: 'share',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ error: error.message }),
        status: 'failed',
        errorMessage: error.message,
        userAgent: req.headers['user-agent']
      });
    } catch (auditError) {
      console.error('Audit log error (non-critical):', auditError);
    }
    
    res.status(500).json({ error: 'Failed to share files' });
  } finally {
    client.release();
  }
}

// Get sharing history for a file
async function getSharingHistory(req, res) {
  try {
    const { fileId } = req.params;
    const userId = req.user.userId;
    
    // Verify file ownership
    const fileResult = await pool.query(
      'SELECT file_id, original_filename FROM files WHERE file_id = $1 AND user_id = $2 AND is_deleted = false',
      [fileId, userId]
    );
    
    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'File not found or you do not own this file' });
    }
    
    // Get sharing history
    const historyResult = await pool.query(
      `SELECT 
        fs.sharing_id,
        fs.shared_at,
        fs.is_active,
        u.user_id as recipient_id,
        u.full_name as recipient_name,
        u.email as recipient_email,
        u.role as recipient_role,
        u.profile_picture_url as recipient_picture
      FROM file_sharings fs
      JOIN users u ON fs.recipient_user_id = u.user_id
      WHERE fs.file_id = $1 AND fs.sharer_user_id = $2
      ORDER BY fs.shared_at DESC`,
      [fileId, userId]
    );
    
    // Get total share count
    const totalShares = historyResult.rows.filter(r => r.is_active).length;
    
    res.json({
      file: fileResult.rows[0],
      sharingHistory: historyResult.rows,
      totalActiveShares: totalShares,
      totalRecords: historyResult.rows.length
    });
    
  } catch (error) {
    console.error('Get sharing history error:', error);
    res.status(500).json({ error: 'Failed to fetch sharing history' });
  }
}

// Revoke sharing permission
async function revokeSharing(req, res) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { sharingId } = req.params;
    const userId = req.user.userId;
    
    // Verify ownership and get sharing details
    const sharingResult = await client.query(
      `SELECT fs.*, f.original_filename, u.full_name as recipient_name
       FROM file_sharings fs
       JOIN files f ON fs.file_id = f.file_id
       JOIN users u ON fs.recipient_user_id = u.user_id
       WHERE fs.sharing_id = $1 AND fs.sharer_user_id = $2`,
      [sharingId, userId]
    );
    
    if (sharingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Sharing permission not found or access denied' });
    }
    
    const sharing = sharingResult.rows[0];
    
    // Revoke sharing (set is_active to false)
    await client.query(
      'UPDATE file_sharings SET is_active = false WHERE sharing_id = $1',
      [sharingId]
    );
    
    await client.query('COMMIT');
    
    // Log revocation
    try {
      await logAudit({
        userId,
        sessionId: req.sessionId,
        operationType: 'revoke_share',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ 
          sharing_id: sharingId,
          file_name: sharing.original_filename,
          recipient_name: sharing.recipient_name
        }),
        status: 'success',
        userAgent: req.headers['user-agent']
      });
    } catch (auditError) {
      console.error('Audit log error (non-critical):', auditError);
    }
    
    res.json({ 
      message: 'Sharing permission revoked successfully',
      fileName: sharing.original_filename,
      recipientName: sharing.recipient_name
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Revoke sharing error:', error);
    res.status(500).json({ error: 'Failed to revoke sharing permission' });
  } finally {
    client.release();
  }
}

// Get notifications for current user
async function getNotifications(req, res) {
  try {
    await ensureSharingNotificationColumns(pool);

    const userId = req.user.userId;
    
    const result = await pool.query(
      `WITH notification_rows AS (
        SELECT
          sn.notification_id,
          sn.notification_group_id,
          sn.is_read,
          sn.read_at,
          sn.created_at,
          fs.shared_at,
          fs.file_id,
          f.original_filename,
          f.file_type,
          f.file_size,
          sharer.user_id AS sharer_id,
          sharer.full_name AS sharer_name,
          sharer.role AS sharer_role,
          sharer.profile_picture_url AS sharer_picture
        FROM sharing_notifications sn
        JOIN file_sharings fs ON sn.sharing_id = fs.sharing_id
        JOIN files f ON fs.file_id = f.file_id
        JOIN users sharer ON fs.sharer_user_id = sharer.user_id
        WHERE sn.recipient_user_id = $1
          AND fs.is_active = true
      )
      SELECT
        COALESCE(notification_group_id, CONCAT('single-', notification_id::text)) AS notification_group_id,
        MIN(notification_id) AS notification_id,
        BOOL_AND(is_read) AS is_read,
        MAX(read_at) AS read_at,
        MAX(created_at) AS created_at,
        MAX(shared_at) AS shared_at,
        MAX(sharer_id) AS sharer_id,
        MAX(sharer_name) AS sharer_name,
        MAX(sharer_role) AS sharer_role,
        MAX(sharer_picture) AS sharer_picture,
        COUNT(DISTINCT file_id) AS file_count,
        JSONB_AGG(
          DISTINCT JSONB_BUILD_OBJECT(
            'fileId', file_id,
            'fileName', original_filename,
            'fileType', file_type,
            'fileSize', file_size
          )
        ) AS files,
        ARRAY_AGG(notification_id) AS notification_ids
      FROM notification_rows
      GROUP BY COALESCE(notification_group_id, CONCAT('single-', notification_id::text))
      ORDER BY MAX(created_at) DESC
      LIMIT 50`,
      [userId]
    );
    
    const unreadCount = result.rows.filter((item) => !item.is_read).length;
    
    res.json({
      notifications: result.rows,
      unreadCount,
      totalCount: result.rows.length
    });
    
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
}

// Mark notification as read
async function markNotificationRead(req, res) {
  try {
    const { notificationId } = req.params;
    const userId = req.user.userId;

    await ensureSharingNotificationColumns(pool);

    const existingResult = await pool.query(
      `SELECT notification_id, notification_group_id
       FROM sharing_notifications
       WHERE notification_id = $1
         AND recipient_user_id = $2
       LIMIT 1`,
      [notificationId, userId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const notification = existingResult.rows[0];
    
    if (notification.notification_group_id) {
      await pool.query(
        `UPDATE sharing_notifications
         SET is_read = true, read_at = CURRENT_TIMESTAMP
         WHERE notification_group_id = $1
           AND recipient_user_id = $2`,
        [notification.notification_group_id, userId]
      );
    } else {
      await pool.query(
        `UPDATE sharing_notifications 
         SET is_read = true, read_at = CURRENT_TIMESTAMP 
         WHERE notification_id = $1 AND recipient_user_id = $2`,
        [notificationId, userId]
      );
    }
    
    res.json({ message: 'Notification marked as read' });
    
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
}



module.exports = {
  uploadFile,
  getUserFiles,
  getSharedFiles,
  downloadFile,
  deleteFile,
  getStorageQuota,
  getFileDetails,
  renameFile,
  previewFile,
  updateFileContent,
  shareFiles,              
  getSharingHistory,       
  revokeSharing,          
  getNotifications,       
  markNotificationRead,
};

function createDecryptionStream({ key, iv, authTag, onHashFinalized }) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'base64'),
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  const hash = crypto.createHash('sha256');
  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        const decryptedChunk = decipher.update(chunk);
        if (decryptedChunk.length > 0) {
          hash.update(decryptedChunk);
          this.push(decryptedChunk);
        }
        callback();
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      try {
        const finalChunk = decipher.final();
        if (finalChunk.length > 0) {
          hash.update(finalChunk);
          this.push(finalChunk);
        }
        if (typeof onHashFinalized === 'function') {
          onHashFinalized(hash.digest('hex'));
        }
        callback();
      } catch (error) {
        callback(error);
      }
    }
  });
}

function splitFilenameAndExtension(filename) {
  const safeFilename = String(filename || '').trim();
  const lastDotIndex = safeFilename.lastIndexOf('.');

  if (lastDotIndex <= 0 || lastDotIndex === safeFilename.length - 1) {
    return {
      baseName: safeFilename,
      extension: ''
    };
  }

  return {
    baseName: safeFilename.slice(0, lastDotIndex),
    extension: safeFilename.slice(lastDotIndex)
  };
}

async function renameFile(req, res) {
  try {
    await ensureFileUpdatedAtColumn(pool);
    await ensureSharingPermissionColumns(pool);

    const { fileId } = req.params;
    const userId = req.user.userId;
    const rawNewFilename = String(req.body?.filename || '').trim();

    if (!rawNewFilename) {
      return res.status(400).json({ error: 'Filename cannot be empty' });
    }

    const fileResult = await pool.query(
      `SELECT
        f.file_id,
        f.user_id,
        f.original_filename,
        f.file_extension,
        EXISTS (
          SELECT 1
          FROM file_sharings fs
          WHERE fs.file_id = f.file_id
            AND fs.recipient_user_id = $2
            AND fs.is_active = true
            AND COALESCE(fs.can_rename, true) = true
        ) AS can_rename_shared
       FROM files f
       WHERE f.file_id = $1 AND f.is_deleted = false`,
      [fileId, userId]
    );

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = fileResult.rows[0];
    const isOwner = Number(file.user_id) === Number(userId);
    const canRenameShared = Boolean(file.can_rename_shared);
    if (!isOwner && !canRenameShared) {
      await logAudit({
        userId,
        fileId: parseInt(fileId),
        sessionId: req.sessionId,
        operationType: 'access_denied',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ file_id: fileId, attempted_operation: 'rename' }),
        status: 'failed',
        errorMessage: 'Permission denied',
        userAgent: req.headers['user-agent']
      });
      return res.status(403).json({ error: 'You do not have permission to rename this shared file' });
    }

    const { extension: currentExtension } = splitFilenameAndExtension(file.original_filename);
    const requestedParts = splitFilenameAndExtension(rawNewFilename);
    const desiredBase = requestedParts.baseName || rawNewFilename;
    const finalFilename = `${desiredBase}${currentExtension || ''}`;

    if (!desiredBase.trim()) {
      return res.status(400).json({ error: 'Filename cannot be empty' });
    }

    const duplicateResult = await pool.query(
      `SELECT file_id
       FROM files
       WHERE user_id = $1
         AND is_deleted = false
         AND LOWER(original_filename) = LOWER($2)
         AND file_id <> $3
       LIMIT 1`,
      [file.user_id, finalFilename, fileId]
    );

    if (duplicateResult.rows.length > 0) {
      return res.status(409).json({ error: 'A file with this name already exists' });
    }

    await pool.query(
      'UPDATE files SET original_filename = $1, updated_at = CURRENT_TIMESTAMP WHERE file_id = $2',
      [finalFilename, fileId]
    );

    await logAudit({
      userId,
      fileId: parseInt(fileId),
      sessionId: req.sessionId,
      operationType: 'rename',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({ old_filename: file.original_filename, new_filename: finalFilename }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });

    return res.json({
      message: 'File renamed successfully',
      fileId: Number(fileId),
      filename: finalFilename
    });
  } catch (error) {
    console.error('Rename file error:', error);
    return res.status(500).json({ error: 'Failed to rename file' });
  }
}

async function ensureFileUpdatedAtColumn(clientLike = pool) {
  if (fileUpdatedAtColumnEnsured) {
    return;
  }

  try {
    await clientLike.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP');
  } catch (error) {
    console.warn('File updated_at column auto-migration skipped:', error?.message || error);
  } finally {
    fileUpdatedAtColumnEnsured = true;
  }
}

async function ensureSharingNotificationColumns(clientLike = pool) {
  if (sharingNotificationColumnsEnsured) {
    return;
  }

  try {
    await clientLike.query('ALTER TABLE sharing_notifications ADD COLUMN IF NOT EXISTS notification_group_id VARCHAR(80)');
    await clientLike.query('CREATE INDEX IF NOT EXISTS idx_sharing_notifications_group ON sharing_notifications(notification_group_id)');
  } catch (error) {
    console.warn('Failed to ensure sharing notification columns:', error?.message || error);
  } finally {
    sharingNotificationColumnsEnsured = true;
  }
}

async function ensureSharingPermissionColumns(clientLike = pool) {
  if (sharingPermissionColumnsEnsured) {
    return;
  }

  try {
    await clientLike.query('ALTER TABLE file_sharings ADD COLUMN IF NOT EXISTS can_download BOOLEAN DEFAULT true');
    await clientLike.query('ALTER TABLE file_sharings ADD COLUMN IF NOT EXISTS can_edit BOOLEAN DEFAULT true');
    await clientLike.query('ALTER TABLE file_sharings ADD COLUMN IF NOT EXISTS can_rename BOOLEAN DEFAULT true');

    await clientLike.query('UPDATE file_sharings SET can_download = true WHERE can_download IS NULL');
    await clientLike.query('UPDATE file_sharings SET can_edit = true WHERE can_edit IS NULL');
    await clientLike.query('UPDATE file_sharings SET can_rename = true WHERE can_rename IS NULL');
  } catch (error) {
    console.warn('Failed to ensure sharing permission columns:', error?.message || error);
  } finally {
    sharingPermissionColumnsEnsured = true;
  }
}
