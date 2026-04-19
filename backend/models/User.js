const pool = require('../config/database');

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

function normalizeStudentLevel(level) {
  const safe = String(level || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const match = STUDENT_LEVEL_SEQUENCE.find((item) => item.toLowerCase() === safe);
  return match || null;
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

class User {
  static studentLevelColumnsEnsured = false;

  static async ensureStudentLevelColumns() {
    if (User.studentLevelColumnsEnsured) {
      return;
    }

    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS student_level VARCHAR(30)');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS student_level_updated_year INTEGER');
    User.studentLevelColumnsEnsured = true;
  }

  static async autoPromoteStudentLevel(userId) {
    await User.ensureStudentLevelColumns();

    const result = await pool.query(
      `SELECT user_id, role, student_level, student_level_updated_year
       FROM users
       WHERE user_id = $1`,
      [userId]
    );

    const user = result.rows[0];
    if (!user || user.role !== 'student' || !user.student_level) {
      return;
    }

    const currentYear = new Date().getFullYear();
    const lastYear = parseInt(user.student_level_updated_year, 10) || currentYear;
    if (currentYear <= lastYear) {
      return;
    }

    const yearsToPromote = currentYear - lastYear;
    const nextLevel = promoteStudentLevel(user.student_level, yearsToPromote);
    if (!nextLevel) {
      return;
    }

    await pool.query(
      `UPDATE users
       SET student_level = $1,
           student_level_updated_year = $2
       WHERE user_id = $3`,
      [nextLevel, currentYear, userId]
    );
  }

  // Find user by email
  static async findByEmail(email) {
  await User.ensureStudentLevelColumns();
  const result = await pool.query(
    'SELECT *, account_locked_until FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0];
}

  // Find user by ID
  static async findById(userId) {
    await User.ensureStudentLevelColumns();
    const result = await pool.query(
      'SELECT * FROM users WHERE user_id = $1',
      [userId]
    );
    return result.rows[0];
  }

  // Update last login
  static async updateLastLogin(userId) {
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1',
      [userId]
    );
  }

  // Increment failed login attempts
  static async incrementFailedAttempts(userId) {
    await pool.query(
      'UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE user_id = $1',
      [userId]
    );
  }

  // Reset failed login attempts
  static async resetFailedAttempts(userId) {
    await pool.query(
      'UPDATE users SET failed_login_attempts = 0, account_locked_until = NULL WHERE user_id = $1',
      [userId]
    );
  }


// Lock account
static async lockAccount(userId, lockDuration = 15) {
  // Calculate lock time in JavaScript
  const lockUntil = new Date();
  lockUntil.setMinutes(lockUntil.getMinutes() + lockDuration);
  
  await pool.query(
    `UPDATE users 
     SET account_locked_until = $1,
         failed_login_attempts = 5
     WHERE user_id = $2`,
    [lockUntil, userId]
  );
}

  // Check if account is locked
  static async isAccountLocked(userId) {
    const result = await pool.query(
      'SELECT account_locked_until FROM users WHERE user_id = $1',
      [userId]
    );
    
    const user = result.rows[0];
    if (!user || !user.account_locked_until) return false;
    
    // Compare dates in JavaScript (simpler and more reliable)
    const lockUntil = new Date(user.account_locked_until);
    const now = new Date();
    
    // If lock has expired, clear it
    if (lockUntil <= now) {
      await pool.query(
        'UPDATE users SET account_locked_until = NULL, failed_login_attempts = 0 WHERE user_id = $1',
        [userId]
      );
      return false;
    }
    
    // Lock is still active
    return true;
  }

  // Delete user
  static async delete(userId) {
    await pool.query('DELETE FROM users WHERE user_id = $1', [userId]);
  }
}

module.exports = User;