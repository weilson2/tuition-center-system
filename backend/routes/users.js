const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

async function ensureStudentLevelColumn() {
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS student_level VARCHAR(30)');
}

// Get all users (for file sharing feature)
router.get('/', authenticateToken, async (req, res) => {
  try {
    await ensureStudentLevelColumn();

    const currentUserId = req.user.userId;
    const currentUserRole = req.user.role;
    
    const result = await pool.query(
      `SELECT user_id, full_name, email, role, profile_picture_url, student_level
       FROM users 
       WHERE is_active = true
         AND account_status = 'active'
         AND role IN ('teacher', 'student')
       ORDER BY full_name ASC`
    );
    
    res.json({
      users: result.rows,
      currentUserId,
      currentUserRole
    });
    
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

module.exports = router;