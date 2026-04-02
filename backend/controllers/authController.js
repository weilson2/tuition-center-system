const User = require('../models/User');
const Session = require('../models/Session');
const { comparePassword } = require('../utils/encryption');
const { generateToken } = require('../config/jwt');
const { logAudit } = require('../utils/auditLogger');

// User Login
// User Login
async function login(req, res) {
  try {
    const { email, password, role, rememberMe = false } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Find user by email
    const user = await User.findByEmail(email);

    if (!user) {
      await logAudit({
        operationType: 'login_failed',
        ipAddress,
        operationDetails: `Failed login attempt for email: ${email}`,
        status: 'failed',
        errorMessage: 'User not found',
        userAgent
      });
      return res.status(401).json({
        error: 'Invalid email or password',
        attemptsRemaining: 5
      });
    }

    // Check if account is locked FIRST (before any other checks)
    // Check if account is locked FIRST (before any other checks)
    const isLocked = await User.isAccountLocked(user.user_id);
    if (isLocked) {
      // Get fresh user data to calculate remaining time
const freshUser = await User.findById(user.user_id);

// Calculate remaining time in JavaScript
const lockUntil = new Date(freshUser.account_locked_until);
const now = new Date();
const minutesRemaining = Math.ceil((lockUntil - now) / 60000);

      await logAudit({
        userId: user.user_id,
        operationType: 'login_blocked',
        ipAddress,
        operationDetails: `Login attempt on locked account (${minutesRemaining} minutes remaining)`,
        status: 'blocked',
        errorMessage: 'Account is locked',
        userAgent
      });

      return res.status(403).json({
        error: `Account is temporarily locked. Please try again in ${minutesRemaining} minute${minutesRemaining !== 1 ? 's' : ''}.`,
        accountLocked: true,
        attemptsRemaining: 0
      });
    }

    // Verify role matches
    if (user.role !== role) {
      await logAudit({
        userId: user.user_id,
        operationType: 'login_failed',
        ipAddress,
        operationDetails: `Role mismatch: expected ${role}, got ${user.role}`,
        status: 'failed',
        errorMessage: 'Role mismatch',
        userAgent
      });
      return res.status(401).json({
        error: 'Invalid login type. Please use the correct login portal.',
        attemptsRemaining: 5 - user.failed_login_attempts
      });
    }

    // Check account status
    if (!user.is_active || user.account_status !== 'active') {
      await logAudit({
        userId: user.user_id,
        operationType: 'login_failed',
        ipAddress,
        operationDetails: `Account status: ${user.account_status}`,
        status: 'failed',
        errorMessage: 'Account inactive',
        userAgent
      });
      return res.status(403).json({
        error: 'Account is inactive or suspended'
      });
    }

    // Verify password
    const isPasswordValid = await comparePassword(password, user.password_hash);

    if (!isPasswordValid) {
      // First, get current failed attempts
      const currentUser = await User.findById(user.user_id);
      const currentAttempts = currentUser.failed_login_attempts || 0;
      const newAttempts = currentAttempts + 1;

      // Increment failed attempts
      await User.incrementFailedAttempts(user.user_id);

      // Check if we should lock NOW (on 5th or more attempt)
      if (newAttempts >= 5) {
        // Lock the account
        await User.lockAccount(user.user_id, 15);

        await logAudit({
          userId: user.user_id,
          operationType: 'account_locked',
          ipAddress,
          operationDetails: `Account locked due to ${newAttempts} failed login attempts`,
          status: 'locked',
          userAgent
        });

        return res.status(403).json({
          error: 'Account locked due to too many failed attempts. Please try again in 15 minutes.',
          accountLocked: true,
          attemptsRemaining: 0
        });
      }

      // Not locked yet, just failed attempt
      const attemptsRemaining = 5 - newAttempts;

      await logAudit({
        userId: user.user_id,
        operationType: 'login_failed',
        ipAddress,
        operationDetails: `Failed login attempt ${newAttempts}/5`,
        status: 'failed',
        errorMessage: 'Invalid password',
        userAgent
      });

      return res.status(401).json({
        error: 'Invalid email or password',
        attemptsRemaining,
        totalAttempts: newAttempts
      });
    }

    // Password is correct! Reset failed attempts and any lock
    await User.resetFailedAttempts(user.user_id);
    await User.autoPromoteStudentLevel(user.user_id);
    const refreshedUser = await User.findById(user.user_id);

    // Generate JWT token
    const token = generateToken({
      userId: refreshedUser.user_id,
      email: refreshedUser.email,
      role: refreshedUser.role
    }, rememberMe);

    // Calculate expiration
    const expiresAt = new Date();
    if (rememberMe) {
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days
    } else {
      expiresAt.setHours(expiresAt.getHours() + 8); // 8 hours
    }

    // Create session in database
    const sessionId = await Session.create({
      userId: refreshedUser.user_id,
      sessionToken: token,
      ipAddress,
      userAgent,
      rememberMe,
      expiresAt
    });

    // Update last login
    await User.updateLastLogin(refreshedUser.user_id);

    // Log successful login
    await logAudit({
      userId: user.user_id,
      sessionId,
      operationType: 'login_success',
      ipAddress,
      operationDetails: `Successful login as ${role}`,
      status: 'success',
      userAgent
    });

    // Set HTTP-only cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000
    });

    res.json({
  message: 'Login successful',
  user: {
    userId: refreshedUser.user_id,
    fullName: refreshedUser.full_name,
    email: refreshedUser.email,
    role: refreshedUser.role,
    studentLevel: refreshedUser.student_level,
    studentLevelUpdatedYear: refreshedUser.student_level_updated_year,
    storageQuota: refreshedUser.storage_quota,
    storageUsed: refreshedUser.storage_used,
    profilePictureUrl: refreshedUser.profile_picture_url
  },
  token
});


  } catch (error) {
  console.error('❌ Login error:', error);
  console.error('Error stack:', error.stack);
  console.error('Error details:', {
    message: error.message,
    code: error.code,
    detail: error.detail
  });
  
  await logAudit({
    operationType: 'login_error',
    ipAddress: req.ip,
    operationDetails: `System error during login: ${error.message}`,
    status: 'error',
    errorMessage: error.message,
    userAgent: req.headers['user-agent']
  });
  
  res.status(500).json({ 
    error: 'Login failed. Please try again.',
    attemptsRemaining: 5,
    debug: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
}
}

// User Logout
async function logout(req, res) {
  try {
    const sessionId = req.sessionId;
    const userId = req.user.userId;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Invalidate session
    await Session.invalidate(sessionId);

    // Log logout
    await logAudit({
      userId,
      sessionId,
      operationType: 'logout',
      ipAddress,
      operationDetails: 'User logged out',
      status: 'success',
      userAgent
    });

    // Clear cookie
    res.clearCookie('token');

    res.json({ message: 'Logout successful' });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
}

// Get current user
async function getCurrentUser(req, res) {
  try {
    await User.autoPromoteStudentLevel(req.user.userId);
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        userId: user.user_id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        studentLevel: user.student_level,
        studentLevelUpdatedYear: user.student_level_updated_year,
        phoneNumber: user.phone_number,
        age: user.age,
        profilePictureUrl: user.profile_picture_url,
        storageQuota: user.storage_quota,
        storageUsed: user.storage_used,
        accountStatus: user.account_status,
        createdAt: user.created_at,
        lastLogin: user.last_login
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user data' });
  }
}

module.exports = {
  login,
  logout,
  getCurrentUser
};
