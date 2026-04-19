const pool = require('../config/database');

const SUPPLEMENTAL_AUDIT_OPERATION_TYPES = [
  'edit',
  'preview',
  'rename',
  'revoke_share',
  'access_denied',
  'delete'
];

let auditLogTimestampColumnPromise = null;

async function getAuditLogTimestampColumn() {
  if (!auditLogTimestampColumnPromise) {
    auditLogTimestampColumnPromise = pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'audit_logs'`
    )
      .then((result) => {
        const columns = new Set((result.rows || []).map((row) => String(row.column_name || '').toLowerCase()));
        const candidates = ['created_at', 'timestamp', 'logged_at', 'occurred_at', 'operation_time', 'log_time'];
        return candidates.find((columnName) => columns.has(columnName)) || 'CURRENT_TIMESTAMP';
      })
      .catch((error) => {
        console.warn('Failed to detect audit_logs timestamp column:', error?.message || error);
        return 'CURRENT_TIMESTAMP';
      });
  }

  return auditLogTimestampColumnPromise;
}

async function buildStorageAuditBaseQuery() {
  const auditTimestampColumn = await getAuditLogTimestampColumn();
  const auditTimestampExpression = auditTimestampColumn === 'CURRENT_TIMESTAMP'
    ? 'CURRENT_TIMESTAMP'
    : `al.${auditTimestampColumn}`;

  return `
    WITH combined_logs AS (
      SELECT
        'upload_' || f.file_id AS log_id,
        f.user_id,
        'upload' AS operation_type,
        NULL AS ip_address,
        f.uploaded_at AS created_at,
        'success' AS status,
        NULL AS error_message,
        json_build_object(
          'filename', f.original_filename,
          'size', f.file_size,
          'file_type', f.file_type
        )::text AS operation_details,
        u.full_name AS user_name,
        u.email AS user_email,
        u.role AS user_role
      FROM files f
      JOIN users u ON f.user_id = u.user_id
      WHERE f.is_deleted = false

      UNION ALL

      SELECT
        'access_' || fal.access_log_id AS log_id,
        fal.user_id,
        fal.access_type AS operation_type,
        fal.ip_address,
        fal.accessed_at AS created_at,
        CASE WHEN fal.integrity_check_passed THEN 'success' ELSE 'failed' END AS status,
        CASE WHEN NOT fal.integrity_check_passed THEN 'Integrity check failed' ELSE NULL END AS error_message,
        json_build_object(
          'filename', f.original_filename,
          'size', f.file_size,
          'file_type', f.file_type
        )::text AS operation_details,
        u.full_name AS user_name,
        u.email AS user_email,
        u.role AS user_role
      FROM file_access_logs fal
      JOIN users u ON fal.user_id = u.user_id
      JOIN files f ON fal.file_id = f.file_id

      UNION ALL

      SELECT
        'share_' || fs.sharing_id AS log_id,
        fs.sharer_user_id AS user_id,
        'share' AS operation_type,
        NULL AS ip_address,
        fs.shared_at AS created_at,
        CASE WHEN fs.is_active THEN 'success' ELSE 'revoked' END AS status,
        NULL AS error_message,
        json_build_object(
          'filename', f.original_filename,
          'size', f.file_size,
          'recipient', recipient.full_name
        )::text AS operation_details,
        sharer.full_name AS user_name,
        sharer.email AS user_email,
        sharer.role AS user_role
      FROM file_sharings fs
      JOIN users sharer ON fs.sharer_user_id = sharer.user_id
      JOIN users recipient ON fs.recipient_user_id = recipient.user_id
      JOIN files f ON fs.file_id = f.file_id

      UNION ALL

      SELECT
        'delete_legacy_' || f.file_id AS log_id,
        f.user_id,
        'delete' AS operation_type,
        NULL AS ip_address,
        f.deleted_at AS created_at,
        'success' AS status,
        NULL AS error_message,
        json_build_object(
          'filename', f.original_filename,
          'size', f.file_size
        )::text AS operation_details,
        u.full_name AS user_name,
        u.email AS user_email,
        u.role AS user_role
      FROM files f
      JOIN users u ON f.user_id = u.user_id
      WHERE f.is_deleted = true AND f.deleted_at IS NOT NULL

      UNION ALL

      SELECT
        'audit_' || al.log_id::text AS log_id,
        al.user_id,
        al.operation_type,
        al.ip_address,
        ${auditTimestampExpression} AS created_at,
        COALESCE(al.status, 'success') AS status,
        al.error_message,
        COALESCE(al.operation_details, '{}')::text AS operation_details,
        u.full_name AS user_name,
        u.email AS user_email,
        u.role AS user_role
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.user_id
      WHERE al.operation_type = ANY($1::text[])
    )
    SELECT * FROM combined_logs
    WHERE 1=1
  `;
}

function appendAuditFilters(query, params, filters = {}) {
  const nextParams = [...params];
  let nextQuery = query;
  let paramCount = nextParams.length;

  const { operationType, status, userId, dateFrom, dateTo, search } = filters;

  if (operationType) {
    paramCount++;
    nextQuery += ` AND operation_type = $${paramCount}`;
    nextParams.push(String(operationType).trim());
  }

  if (status) {
    paramCount++;
    nextQuery += ` AND status = $${paramCount}`;
    nextParams.push(String(status).trim());
  }

  if (userId) {
    paramCount++;
    nextQuery += ` AND user_id = $${paramCount}`;
    nextParams.push(userId);
  }

  if (dateFrom) {
    paramCount++;
    nextQuery += ` AND created_at >= $${paramCount}`;
    nextParams.push(dateFrom);
  }

  if (dateTo) {
    paramCount++;
    nextQuery += ` AND created_at <= $${paramCount}`;
    nextParams.push(dateTo);
  }

  if (search) {
    paramCount++;
    nextQuery += ` AND (
      user_name ILIKE $${paramCount}
      OR user_email ILIKE $${paramCount}
      OR operation_type ILIKE $${paramCount}
      OR COALESCE(ip_address, '') ILIKE $${paramCount}
      OR operation_details ILIKE $${paramCount}
    )`;
    nextParams.push(`%${String(search).trim()}%`);
  }

  return { query: nextQuery, params: nextParams, paramCount };
}

function normalizeFilename(details) {
  return details.filename || details.file_name || details.original_filename || '-';
}

function normalizeFileSize(details) {
  const candidate = details.size ?? details.file_size ?? details.new_size ?? details.old_size ?? null;
  const numericSize = Number(candidate);
  return Number.isFinite(numericSize) && numericSize > 0 ? numericSize : null;
}

function normalizeLogRow(log) {
  let parsedDetails = {};

  try {
    parsedDetails = typeof log.operation_details === 'string'
      ? JSON.parse(log.operation_details || '{}')
      : (log.operation_details || {});
  } catch (error) {
    parsedDetails = {};
  }

  return {
    ...log,
    operation_details: JSON.stringify(parsedDetails)
  };
}

async function getAuditLogs(req, res) {
  try {
    const {
      page = 1,
      limit = 50,
      operationType,
      status,
      userId,
      dateFrom,
      dateTo,
      search
    } = req.query;

    const numericPage = Math.max(1, parseInt(page, 10) || 1);
    const numericLimit = Math.max(1, parseInt(limit, 10) || 50);
    const offset = (numericPage - 1) * numericLimit;

    const baseQuery = await buildStorageAuditBaseQuery();
    const { query: filteredQuery, params, paramCount } = appendAuditFilters(
      baseQuery,
      [SUPPLEMENTAL_AUDIT_OPERATION_TYPES],
      { operationType, status, userId, dateFrom, dateTo, search }
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM (${filteredQuery}) AS filtered_logs`,
      params
    );
    const total = parseInt(countResult.rows[0]?.total, 10) || 0;

    const result = await pool.query(
      `${filteredQuery} ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, numericLimit, offset]
    );

    res.json({
      logs: result.rows.map(normalizeLogRow),
      pagination: {
        page: numericPage,
        limit: numericLimit,
        total,
        totalPages: Math.ceil(total / numericLimit)
      }
    });
  } catch (error) {
    console.error('Get storage logs error:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
}

async function getAuditStats(req, res) {
  try {
    const baseQuery = await buildStorageAuditBaseQuery();
    const statsResult = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_operations,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS recent_activity,
          COUNT(*) FILTER (WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '7 days')::int AS failed_operations
        FROM (${baseQuery}) AS storage_logs
      `,
      [SUPPLEMENTAL_AUDIT_OPERATION_TYPES]
    );

    const byTypeResult = await pool.query(
      `
        SELECT operation_type, COUNT(*)::int AS count
        FROM (${baseQuery}) AS storage_logs
        GROUP BY operation_type
        ORDER BY count DESC, operation_type ASC
      `,
      [SUPPLEMENTAL_AUDIT_OPERATION_TYPES]
    );

    const byStatusResult = await pool.query(
      `
        SELECT status, COUNT(*)::int AS count
        FROM (${baseQuery}) AS storage_logs
        GROUP BY status
        ORDER BY count DESC, status ASC
      `,
      [SUPPLEMENTAL_AUDIT_OPERATION_TYPES]
    );

    const topUsersResult = await pool.query(
      `
        SELECT
          user_id,
          user_name AS full_name,
          user_email AS email,
          user_role AS role,
          COUNT(*)::int AS operation_count
        FROM (${baseQuery}) AS storage_logs
        WHERE user_id IS NOT NULL
          AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY user_id, user_name, user_email, user_role
        ORDER BY operation_count DESC, user_name ASC
        LIMIT 10
      `,
      [SUPPLEMENTAL_AUDIT_OPERATION_TYPES]
    );

    const summary = statsResult.rows[0] || {};

    res.json({
      totalOperations: summary.total_operations || 0,
      operationsByType: byTypeResult.rows,
      operationsByStatus: byStatusResult.rows,
      recentActivity: summary.recent_activity || 0,
      failedOperations: summary.failed_operations || 0,
      topUsers: topUsersResult.rows
    });
  } catch (error) {
    console.error('Get audit stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
}

async function exportAuditLogs(req, res) {
  try {
    const { operationType, status, userId, dateFrom, dateTo, search } = req.query;

    const baseQuery = await buildStorageAuditBaseQuery();
    const { query: filteredQuery, params } = appendAuditFilters(
      baseQuery,
      [SUPPLEMENTAL_AUDIT_OPERATION_TYPES],
      { operationType, status, userId, dateFrom, dateTo, search }
    );

    const result = await pool.query(`${filteredQuery} ORDER BY created_at DESC`, params);

    let csv = 'Timestamp,Operation,User,Email,Role,Filename,File Size,Status,IP Address\n';

    result.rows.forEach((log) => {
      let details = {};

      try {
        details = typeof log.operation_details === 'string'
          ? JSON.parse(log.operation_details || '{}')
          : (log.operation_details || {});
      } catch (error) {
        details = {};
      }

      const filename = normalizeFilename(details);
      const fileSizeBytes = normalizeFileSize(details);
      const fileSize = fileSizeBytes ? `${Math.round(fileSizeBytes / 1024)} KB` : '-';

      csv += `"${log.created_at}","${log.operation_type}","${log.user_name || '-'}","${log.user_email || '-'}","${log.user_role || '-'}","${filename}","${fileSize}","${log.status || '-'}","${log.ip_address || '-'}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=storage-audit-logs-${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Export audit logs error:', error);
    res.status(500).json({ error: 'Failed to export logs' });
  }
}

module.exports = {
  getAuditLogs,
  getAuditStats,
  exportAuditLogs
};
