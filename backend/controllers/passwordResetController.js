const User = require('../models/User');
const { hashPassword } = require('../utils/encryption');
const { logAudit } = require('../utils/auditLogger');
const { sendPasswordResetEmail, sendPasswordChangedConfirmationEmail } = require('../services/emailService');
const crypto = require('crypto');
const pool = require('../config/database');

// Request password reset
async function requestPasswordReset(req, res) {
  try {
    const { email } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const user = await User.findByEmail(email);

    // Always return a generic success message to avoid email enumeration.
    const successMessage = 'If an account exists with this email, a password reset link has been sent.';

    if (!user) {
      await logAudit({
        operationType: 'password_reset_request',
        ipAddress,
        operationDetails: `Password reset requested for non-existent email: ${email}`,
        status: 'failed',
        errorMessage: 'Email not found',
        userAgent
      });

      return res.json({ message: successMessage });
    }

    if (!user.is_active || user.account_status !== 'active') {
      await logAudit({
        userId: user.user_id,
        operationType: 'password_reset_request',
        ipAddress,
        operationDetails: 'Password reset requested for inactive account',
        status: 'failed',
        errorMessage: 'Account inactive',
        userAgent
      });

      return res.json({ message: successMessage });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date();
    tokenExpiry.setHours(tokenExpiry.getHours() + 1); // 1 hour expiry

    await pool.query(
      `INSERT INTO password_reset_tokens
       (user_id, reset_token, token_expiry, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [user.user_id, resetToken, tokenExpiry, ipAddress]
    );

    await logAudit({
      userId: user.user_id,
      operationType: 'password_reset_request',
      ipAddress,
      operationDetails: 'Password reset token generated',
      status: 'success',
      userAgent
    });

    try {
      await sendPasswordResetEmail(email, resetToken, user.full_name);
      res.json({ message: successMessage });
    } catch (emailError) {
      console.error('Password reset email failed:', emailError.message);

      await logAudit({
        userId: user.user_id,
        operationType: 'password_reset_request',
        ipAddress,
        operationDetails: 'Email sending failed',
        status: 'failed',
        errorMessage: emailError.message,
        userAgent
      });

      res.json({ message: successMessage });
    }
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({
      error: 'Failed to process password reset request. Please try again.'
    });
  }
}

// Verify reset token
async function verifyResetToken(req, res) {
  try {
    const { token } = req.params;

    const result = await pool.query(
      `SELECT prt.*, u.email, u.full_name
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.user_id
       WHERE prt.reset_token = $1
       AND prt.is_used = false
       AND prt.token_expiry > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: 'Invalid or expired reset token.',
        valid: false
      });
    }

    const tokenData = result.rows[0];

    res.json({
      valid: true,
      email: tokenData.email,
      message: 'Token is valid'
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({
      error: 'Failed to verify token.',
      valid: false
    });
  }
}

// Reset password with token
async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters long.'
      });
    }

    const result = await pool.query(
      `SELECT prt.*, u.user_id, u.email, u.full_name
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.user_id
       WHERE prt.reset_token = $1
       AND prt.is_used = false
       AND prt.token_expiry > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      await logAudit({
        operationType: 'password_reset',
        ipAddress,
        operationDetails: 'Password reset attempted with invalid/expired token',
        status: 'failed',
        errorMessage: 'Invalid token',
        userAgent
      });

      return res.status(400).json({
        error: 'Invalid or expired reset token.'
      });
    }

    const tokenData = result.rows[0];
    const userId = tokenData.user_id;

    const passwordHash = await hashPassword(newPassword);

    await pool.query(
      'UPDATE users SET password_hash = $1, password_changed_at = NOW() WHERE user_id = $2',
      [passwordHash, userId]
    );

    await pool.query(
      'UPDATE password_reset_tokens SET is_used = true, used_at = NOW() WHERE token_id = $1',
      [tokenData.token_id]
    );

    await pool.query(
      'UPDATE user_sessions SET is_active = false, logged_out_at = NOW() WHERE user_id = $1 AND is_active = true',
      [userId]
    );

    await logAudit({
      userId,
      operationType: 'password_reset',
      ipAddress,
      operationDetails: 'Password reset successful',
      status: 'success',
      userAgent
    });

    try {
      await sendPasswordChangedConfirmationEmail(tokenData.email, tokenData.full_name || tokenData.email);
    } catch (emailError) {
      console.error('Password reset confirmation email failed:', emailError.message);
    }

    res.json({
      message: 'Password reset successful. Please login with your new password.'
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({
      error: 'Failed to reset password. Please try again.'
    });
  }
}

module.exports = {
  requestPasswordReset,
  verifyResetToken,
  resetPassword
};
