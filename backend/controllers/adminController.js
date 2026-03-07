const pool = require('../config/database');

// Get storage operation logs from actual storage tables
async function getAuditLogs(req, res) {
  try {
    console.log('📊 Storage logs request:', req.query);
    
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

    const offset = (page - 1) * limit;
    
    // Query to combine logs from different storage tables
    let query = `
      WITH combined_logs AS (
        -- File uploads
        SELECT 
          'upload_' || f.file_id as log_id,
          f.user_id,
          'upload' as operation_type,
          NULL as ip_address,
          f.uploaded_at as created_at,
          'success' as status,
          NULL as error_message,
          json_build_object(
            'filename', f.original_filename,
            'size', f.file_size,
            'file_type', f.file_type
          )::text as operation_details,
          u.full_name as user_name,
          u.email as user_email,
          u.role as user_role
        FROM files f
        JOIN users u ON f.user_id = u.user_id
        WHERE f.is_deleted = false
        
        UNION ALL
        
        -- File downloads/access
        SELECT 
          'access_' || fal.access_log_id as log_id,
          fal.user_id,
          fal.access_type as operation_type,
          fal.ip_address,
          fal.accessed_at as created_at,
          CASE WHEN fal.integrity_check_passed THEN 'success' ELSE 'failed' END as status,
          CASE WHEN NOT fal.integrity_check_passed THEN 'Integrity check failed' ELSE NULL END as error_message,
          json_build_object(
            'filename', f.original_filename,
            'size', f.file_size,
            'file_type', f.file_type
          )::text as operation_details,
          u.full_name as user_name,
          u.email as user_email,
          u.role as user_role
        FROM file_access_logs fal
        JOIN users u ON fal.user_id = u.user_id
        JOIN files f ON fal.file_id = f.file_id
        
        UNION ALL
        
        -- File shares
        SELECT 
          'share_' || fs.sharing_id as log_id,
          fs.sharer_user_id as user_id,
          'share' as operation_type,
          NULL as ip_address,
          fs.shared_at as created_at,
          CASE WHEN fs.is_active THEN 'success' ELSE 'revoked' END as status,
          NULL as error_message,
          json_build_object(
            'filename', f.original_filename,
            'size', f.file_size,
            'recipient', recipient.full_name
          )::text as operation_details,
          sharer.full_name as user_name,
          sharer.email as user_email,
          sharer.role as user_role
        FROM file_sharings fs
        JOIN users sharer ON fs.sharer_user_id = sharer.user_id
        JOIN users recipient ON fs.recipient_user_id = recipient.user_id
        JOIN files f ON fs.file_id = f.file_id
        
        UNION ALL
        
        -- Deleted files
        SELECT 
          'delete_' || f.file_id as log_id,
          f.user_id,
          'delete' as operation_type,
          NULL as ip_address,
          f.deleted_at as created_at,
          'success' as status,
          NULL as error_message,
          json_build_object(
            'filename', f.original_filename,
            'size', f.file_size
          )::text as operation_details,
          u.full_name as user_name,
          u.email as user_email,
          u.role as user_role
        FROM files f
        JOIN users u ON f.user_id = u.user_id
        WHERE f.is_deleted = true AND f.deleted_at IS NOT NULL
      )
      SELECT * FROM combined_logs
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;
    
    // Add filters
    if (operationType) {
      paramCount++;
      query += ` AND operation_type = $${paramCount}`;
      params.push(operationType);
    }
    
    if (status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(status);
    }
    
    if (userId) {
      paramCount++;
      query += ` AND user_id = $${paramCount}`;
      params.push(userId);
    }
    
    if (dateFrom) {
      paramCount++;
      query += ` AND created_at >= $${paramCount}`;
      params.push(dateFrom);
    }
    
    if (dateTo) {
      paramCount++;
      query += ` AND created_at <= $${paramCount}`;
      params.push(dateTo);
    }
    
    if (search) {
      paramCount++;
      query += ` AND (user_name ILIKE $${paramCount} OR user_email ILIKE $${paramCount} OR operation_details ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }
    
    // Get total count for pagination
    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as filtered_logs`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);
    
    // Add sorting and pagination
    query += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    console.log('✅ Found logs:', result.rows.length);
    console.log('📋 Sample log:', result.rows[0]);
    
    res.json({
      logs: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Get storage logs error:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
}

// Get storage statistics
async function getAuditStats(req, res) {
  try {
    // Total operations from all storage tables
    const totalUploads = await pool.query('SELECT COUNT(*) FROM files WHERE is_deleted = false');
    const totalDownloads = await pool.query('SELECT COUNT(*) FROM file_access_logs WHERE access_type = $1', ['download']);
    const totalShares = await pool.query('SELECT COUNT(*) FROM file_sharings WHERE is_active = true');
    const totalDeletes = await pool.query('SELECT COUNT(*) FROM files WHERE is_deleted = true');
    
    const total = 
      parseInt(totalUploads.rows[0].count) + 
      parseInt(totalDownloads.rows[0].count) + 
      parseInt(totalShares.rows[0].count) + 
      parseInt(totalDeletes.rows[0].count);
    
    // Operations by type
    const byType = [
      { operation_type: 'upload', count: parseInt(totalUploads.rows[0].count) },
      { operation_type: 'download', count: parseInt(totalDownloads.rows[0].count) },
      { operation_type: 'share', count: parseInt(totalShares.rows[0].count) },
      { operation_type: 'delete', count: parseInt(totalDeletes.rows[0].count) }
    ];
    
    // By status (most are success, failed only for downloads with integrity issues)
    const failedDownloads = await pool.query(
      'SELECT COUNT(*) FROM file_access_logs WHERE integrity_check_passed = false'
    );
    
    const byStatus = [
      { status: 'success', count: total - parseInt(failedDownloads.rows[0].count) },
      { status: 'failed', count: parseInt(failedDownloads.rows[0].count) }
    ];
    
    // Recent activity (last 24 hours)
    const recentUploads = await pool.query(
      'SELECT COUNT(*) FROM files WHERE uploaded_at >= NOW() - INTERVAL \'24 hours\''
    );
    const recentDownloads = await pool.query(
      'SELECT COUNT(*) FROM file_access_logs WHERE accessed_at >= NOW() - INTERVAL \'24 hours\''
    );
    const recentShares = await pool.query(
      'SELECT COUNT(*) FROM file_sharings WHERE shared_at >= NOW() - INTERVAL \'24 hours\''
    );
    
    const recentActivity = 
      parseInt(recentUploads.rows[0].count) + 
      parseInt(recentDownloads.rows[0].count) + 
      parseInt(recentShares.rows[0].count);
    
    // Failed operations (last 7 days)
    const recentFailed = await pool.query(
      `SELECT COUNT(*) FROM file_access_logs 
       WHERE integrity_check_passed = false 
       AND accessed_at >= NOW() - INTERVAL '7 days'`
    );
    
    // Top users by activity
    const topUsers = await pool.query(`
      WITH user_activity AS (
        SELECT user_id FROM files WHERE uploaded_at >= NOW() - INTERVAL '7 days'
        UNION ALL
        SELECT user_id FROM file_access_logs WHERE accessed_at >= NOW() - INTERVAL '7 days'
        UNION ALL
        SELECT sharer_user_id as user_id FROM file_sharings WHERE shared_at >= NOW() - INTERVAL '7 days'
      )
      SELECT 
        u.user_id,
        u.full_name,
        u.email,
        u.role,
        COUNT(*) as operation_count
      FROM user_activity ua
      JOIN users u ON ua.user_id = u.user_id
      GROUP BY u.user_id, u.full_name, u.email, u.role
      ORDER BY operation_count DESC
      LIMIT 10
    `);
    
    res.json({
      totalOperations: total,
      operationsByType: byType,
      operationsByStatus: byStatus,
      recentActivity: recentActivity,
      failedOperations: parseInt(recentFailed.rows[0].count),
      topUsers: topUsers.rows
    });
    
  } catch (error) {
    console.error('Get audit stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
}

// Export audit logs to CSV
async function exportAuditLogs(req, res) {
  try {
    const {
      operationType,
      status,
      userId,
      dateFrom,
      dateTo
    } = req.query;
    
    // Same query as getAuditLogs but without pagination
    let query = `
      WITH combined_logs AS (
        SELECT 
          'upload' as operation_type,
          f.uploaded_at as created_at,
          u.full_name as user_name,
          u.email as user_email,
          u.role as user_role,
          f.original_filename as filename,
          f.file_size,
          'success' as status,
          NULL as ip_address
        FROM files f
        JOIN users u ON f.user_id = u.user_id
        WHERE f.is_deleted = false
        
        UNION ALL
        
        SELECT 
          fal.access_type as operation_type,
          fal.accessed_at as created_at,
          u.full_name as user_name,
          u.email as user_email,
          u.role as user_role,
          f.original_filename as filename,
          f.file_size,
          CASE WHEN fal.integrity_check_passed THEN 'success' ELSE 'failed' END as status,
          fal.ip_address
        FROM file_access_logs fal
        JOIN users u ON fal.user_id = u.user_id
        JOIN files f ON fal.file_id = f.file_id
        
        UNION ALL
        
        SELECT 
          'share' as operation_type,
          fs.shared_at as created_at,
          sharer.full_name as user_name,
          sharer.email as user_email,
          sharer.role as user_role,
          f.original_filename as filename,
          f.file_size,
          CASE WHEN fs.is_active THEN 'success' ELSE 'revoked' END as status,
          NULL as ip_address
        FROM file_sharings fs
        JOIN users sharer ON fs.sharer_user_id = sharer.user_id
        JOIN files f ON fs.file_id = f.file_id
        
        UNION ALL
        
        SELECT 
          'delete' as operation_type,
          f.deleted_at as created_at,
          u.full_name as user_name,
          u.email as user_email,
          u.role as user_role,
          f.original_filename as filename,
          f.file_size,
          'success' as status,
          NULL as ip_address
        FROM files f
        JOIN users u ON f.user_id = u.user_id
        WHERE f.is_deleted = true AND f.deleted_at IS NOT NULL
      )
      SELECT * FROM combined_logs WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;
    
    if (operationType) {
      paramCount++;
      query += ` AND operation_type = $${paramCount}`;
      params.push(operationType);
    }
    
    if (dateFrom) {
      paramCount++;
      query += ` AND created_at >= $${paramCount}`;
      params.push(dateFrom);
    }
    
    if (dateTo) {
      paramCount++;
      query += ` AND created_at <= $${paramCount}`;
      params.push(dateTo);
    }
    
    query += ` ORDER BY created_at DESC`;
    
    const result = await pool.query(query, params);
    
    // Generate CSV
    let csv = 'Timestamp,Operation,User,Email,Role,Filename,File Size,Status,IP Address\n';
    
    result.rows.forEach(log => {
      const fileSize = log.file_size ? `${Math.round(log.file_size / 1024)} KB` : '-';
      csv += `"${log.created_at}","${log.operation_type}","${log.user_name}","${log.user_email}","${log.user_role}","${log.filename}","${fileSize}","${log.status}","${log.ip_address || '-'}"\n`;
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