const pool = require('../config/database');

class Session {
  // Create new session
  static async create(data) {
    const { userId, sessionToken, ipAddress, userAgent, rememberMe, expiresAt } = data;
    
    const result = await pool.query(
      `INSERT INTO user_sessions 
       (user_id, session_token, ip_address, user_agent, remember_me, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING session_id`,
      [userId, sessionToken, ipAddress, userAgent, rememberMe, expiresAt]
    );
    
    return result.rows[0].session_id;
  }

  // Find session by token
  static async findByToken(token) {
    const result = await pool.query(
      'SELECT * FROM user_sessions WHERE session_token = $1 AND is_active = true',
      [token]
    );
    return result.rows[0];
  }

  // Update last activity
  static async updateActivity(sessionId) {
    await pool.query(
      'UPDATE user_sessions SET last_activity_at = CURRENT_TIMESTAMP WHERE session_id = $1',
      [sessionId]
    );
  }

  static async rotateToken(sessionId, newToken, expiresAt) {
    await pool.query(
      `UPDATE user_sessions
       SET session_token = $1,
           expires_at = $2,
           last_activity_at = CURRENT_TIMESTAMP
       WHERE session_id = $3`,
      [newToken, expiresAt, sessionId]
    );
  }

  // Invalidate session (logout)
  static async invalidate(sessionId) {
    await pool.query(
      'UPDATE user_sessions SET is_active = false, logged_out_at = CURRENT_TIMESTAMP WHERE session_id = $1',
      [sessionId]
    );
  }

  // Invalidate all user sessions
  static async invalidateAllUserSessions(userId) {
    await pool.query(
      'UPDATE user_sessions SET is_active = false, logged_out_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND is_active = true',
      [userId]
    );
  }

  // Check if session is expired
  static isExpired(session) {
    return new Date(session.expires_at) < new Date();
  }
}

module.exports = Session;