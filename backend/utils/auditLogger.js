const pool = require('../config/database');

async function logAudit(data) {
  const {
    userId = null,
    sessionId = null,
    operationType,
    ipAddress,
    operationDetails = null,
    status,
    errorMessage = null,
    userAgent = null
  } = data;

  try {
    await pool.query(
      `INSERT INTO audit_logs 
       (user_id, session_id, operation_type, ip_address, operation_details, status, error_message, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, sessionId, operationType, ipAddress, operationDetails, status, errorMessage, userAgent]
    );
  } catch (error) {
    console.error('Audit logging failed:', error);
  }
}

module.exports = { logAudit };