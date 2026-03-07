const pool = require('../config/database');
const bcrypt = require('bcrypt');
const { logAudit } = require('../utils/auditLogger');
const multer = require('multer');
const sharp = require('sharp');
const { uploadProfilePicture, uploadToR2, deleteProfilePicture: deleteFromR2 } = require('../services/r2Storage');
const { sendPasswordChangedConfirmationEmail } = require('../services/emailService');

let teacherTitleColumnEnsured = false;
let profileThumbnailColumnsEnsured = false;

async function ensureTeacherTitleColumn() {
  if (teacherTitleColumnEnsured) {
    return;
  }

  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS teacher_title VARCHAR(5)');
  teacherTitleColumnEnsured = true;
}

async function ensureProfileThumbnailColumns() {
  if (profileThumbnailColumnsEnsured) {
    return;
  }

  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture_thumbnail_url TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture_thumbnail_r2_path TEXT');
  profileThumbnailColumnsEnsured = true;
}

function normalizeTeacherTitle(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'mr') {
    return 'Mr';
  }
  if (normalized === 'ms') {
    return 'Ms';
  }
  return null;
}

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
    }
  }
});

// Get user profile
async function getProfile(req, res) {
  try {
    await ensureTeacherTitleColumn();
    await ensureProfileThumbnailColumns();

    const userId = req.user.userId;
    
    const result = await pool.query(
      `SELECT 
        user_id, 
        full_name, 
        email, 
        role, 
        phone_number, 
        age, 
        teacher_title,
        profile_picture_url,
        profile_picture_thumbnail_url,
        storage_quota,
        storage_used,
        is_active, 
        account_status, 
        created_at, 
        last_login,
        last_profile_update
      FROM users 
      WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    res.json({
      user: {
        userId: user.user_id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        phoneNumber: user.phone_number,
        age: user.age,
        teacherTitle: normalizeTeacherTitle(user.teacher_title),
        profilePictureUrl: user.profile_picture_url,
        profilePictureThumbnailUrl: user.profile_picture_thumbnail_url,
        storageQuota: user.storage_quota,
        storageUsed: user.storage_used,
        isActive: user.is_active,
        accountStatus: user.account_status,
        createdAt: user.created_at,
        lastLogin: user.last_login,
        lastProfileUpdate: user.last_profile_update
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
}

async function updateTeacherTitle(req, res) {
  try {
    await ensureTeacherTitleColumn();

    const userId = req.user.userId;
    const role = String(req.user.role || '').toLowerCase();
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (role !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can update title' });
    }

    const normalizedTitle = normalizeTeacherTitle(req.body?.teacherTitle);
    if (!normalizedTitle) {
      return res.status(400).json({ error: 'Teacher title must be Mr or Ms' });
    }

    await pool.query(
      `UPDATE users
       SET teacher_title = $1,
           last_profile_update = NOW()
       WHERE user_id = $2`,
      [normalizedTitle, userId]
    );

    await logAudit({
      userId,
      sessionId: req.sessionId,
      operationType: 'profile_update',
      ipAddress,
      operationDetails: `Teacher title updated to ${normalizedTitle}`,
      status: 'success',
      userAgent
    });

    return res.json({
      message: 'Teacher title updated successfully',
      teacherTitle: normalizedTitle
    });
  } catch (error) {
    console.error('Update teacher title error:', error);
    return res.status(500).json({ error: 'Failed to update teacher title' });
  }
}

// Update phone number
async function updatePhoneNumber(req, res) {
  try {
    const userId = req.user.userId;
    const { phone_number } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Format phone number (Malaysian format)
    let formattedPhone = phone_number;
    if (formattedPhone && !formattedPhone.startsWith('+')) {
      // Add +60 prefix if not present
      formattedPhone = '+60' + formattedPhone.replace(/^0+/, '');
    }

    // Check if phone number already exists for another user
    if (formattedPhone) {
      const existingPhone = await pool.query(
        'SELECT user_id FROM users WHERE phone_number = $1 AND user_id != $2',
        [formattedPhone, userId]
      );

      if (existingPhone.rows.length > 0) {
        return res.status(400).json({ 
          error: 'This phone number is already registered to another account' 
        });
      }
    }

    // Update phone number
    await pool.query(
      `UPDATE users 
       SET phone_number = $1, last_profile_update = NOW() 
       WHERE user_id = $2`,
      [formattedPhone || null, userId]
    );

    await logAudit({
      userId,
      sessionId: req.sessionId,
      operationType: 'profile_update',
      ipAddress,
      operationDetails: `Phone number updated to ${formattedPhone || 'removed'}`,
      status: 'success',
      userAgent
    });

    res.json({
      message: 'Phone number updated successfully',
      phoneNumber: formattedPhone
    });

  } catch (error) {
    console.error('Update phone number error:', error);
    res.status(500).json({ error: 'Failed to update phone number' });
  }
}

// Update age
async function updateAge(req, res) {
  try {
    const userId = req.user.userId;
    const { age } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Update age
    await pool.query(
      `UPDATE users 
       SET age = $1, last_profile_update = NOW() 
       WHERE user_id = $2`,
      [age || null, userId]
    );

    await logAudit({
      userId,
      sessionId: req.sessionId,
      operationType: 'profile_update',
      ipAddress,
      operationDetails: `Age updated to ${age || 'removed'}`,
      status: 'success',
      userAgent
    });

    res.json({
      message: 'Age updated successfully',
      age: age
    });

  } catch (error) {
    console.error('Update age error:', error);
    res.status(500).json({ error: 'Failed to update age' });
  }
}

// Change password
async function changePassword(req, res) {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Get current password hash
    const result = await pool.query(
      'SELECT password_hash, email, full_name FROM users WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);

    if (!isPasswordValid) {
      await logAudit({
        userId,
        sessionId: req.sessionId,
        operationType: 'password_change',
        ipAddress,
        operationDetails: 'Password change failed - incorrect current password',
        status: 'failed',
        errorMessage: 'Incorrect password',
        userAgent
      });

      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Check if new password is same as current
    const isSamePassword = await bcrypt.compare(newPassword, user.password_hash);
    if (isSamePassword) {
      return res.status(400).json({ 
        error: 'New password must be different from current password' 
      });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query(
      `UPDATE users 
       SET password_hash = $1, password_changed_at = NOW() 
       WHERE user_id = $2`,
      [newPasswordHash, userId]
    );

    // Invalidate all sessions except current one
    await pool.query(
      `UPDATE user_sessions 
       SET is_active = false, logged_out_at = NOW() 
       WHERE user_id = $1 AND session_id != $2 AND is_active = true`,
      [userId, req.sessionId]
    );

    await logAudit({
      userId,
      sessionId: req.sessionId,
      operationType: 'password_change',
      ipAddress,
      operationDetails: 'Password changed successfully',
      status: 'success',
      userAgent
    });

    try {
      await sendPasswordChangedConfirmationEmail(user.email, user.full_name || user.email);
    } catch (emailError) {
      console.error('Password change confirmation email failed:', emailError.message);
    }

    res.json({
      message: 'Password changed successfully. Other sessions have been logged out.'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
}

// Update profile picture
async function updateProfilePicture(req, res) {
  try {
    await ensureProfileThumbnailColumns();

    const userId = req.user.userId;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Process image: resize to 400x400 and optimize
    const processedImageBuffer = await sharp(req.file.buffer)
      .resize(400, 400, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 90 })
      .toBuffer();

    const thumbnailBuffer = await sharp(req.file.buffer)
      .resize(100, 100, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 85 })
      .toBuffer();

    // Get old profile picture to delete it
    const oldPicture = await pool.query(
      'SELECT profile_picture_r2_path, profile_picture_thumbnail_r2_path FROM users WHERE user_id = $1',
      [userId]
    );

    // Upload to R2
    const { key, url } = await uploadProfilePicture(processedImageBuffer, userId);
    const thumbnailUpload = await uploadToR2(
      thumbnailBuffer,
      `profile-${userId}-${Date.now()}-thumb.jpg`,
      'profile-pictures/thumbnails',
      'image/jpeg'
    );

    // Update database with new profile picture
    await pool.query(
      `UPDATE users 
       SET profile_picture_url = $1, 
           profile_picture_r2_path = $2, 
           profile_picture_thumbnail_url = $3,
           profile_picture_thumbnail_r2_path = $4,
           last_profile_update = NOW() 
       WHERE user_id = $5`,
      [url, key, thumbnailUpload.url, thumbnailUpload.key, userId]
    );

    // Delete old profile picture from R2 if exists
    if (oldPicture.rows[0]?.profile_picture_r2_path) {
      await deleteFromR2(oldPicture.rows[0].profile_picture_r2_path);
    }
    if (oldPicture.rows[0]?.profile_picture_thumbnail_r2_path) {
      await deleteFromR2(oldPicture.rows[0].profile_picture_thumbnail_r2_path);
    }

    await logAudit({
      userId,
      sessionId: req.sessionId,
      operationType: 'profile_picture_update',
      ipAddress,
      operationDetails: 'Profile picture updated',
      status: 'success',
      userAgent
    });

    res.json({
      message: 'Profile picture updated successfully',
      profilePictureUrl: url,
      profilePictureThumbnailUrl: thumbnailUpload.url
    });

  } catch (error) {
    console.error('Update profile picture error:', error);
    res.status(500).json({ error: 'Failed to update profile picture' });
  }
}

// Delete profile picture
async function deleteProfilePicture(req, res) {
  try {
    await ensureProfileThumbnailColumns();

    const userId = req.user.userId;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Get current profile picture path
    const result = await pool.query(
      'SELECT profile_picture_r2_path, profile_picture_thumbnail_r2_path FROM users WHERE user_id = $1',
      [userId]
    );

    // Delete from R2 if exists
    if (result.rows[0]?.profile_picture_r2_path) {
      await deleteFromR2(result.rows[0].profile_picture_r2_path);
    }
    if (result.rows[0]?.profile_picture_thumbnail_r2_path) {
      await deleteFromR2(result.rows[0].profile_picture_thumbnail_r2_path);
    }

    // Update database
    await pool.query(
      `UPDATE users 
       SET profile_picture_url = NULL,
           profile_picture_r2_path = NULL,
           profile_picture_thumbnail_url = NULL,
           profile_picture_thumbnail_r2_path = NULL,
           last_profile_update = NOW() 
       WHERE user_id = $1`,
      [userId]
    );

    await logAudit({
      userId,
      sessionId: req.sessionId,
      operationType: 'profile_picture_delete',
      ipAddress,
      operationDetails: 'Profile picture deleted',
      status: 'success',
      userAgent
    });

    res.json({
      message: 'Profile picture removed successfully'
    });

  } catch (error) {
    console.error('Delete profile picture error:', error);
    res.status(500).json({ error: 'Failed to delete profile picture' });
  }
}

module.exports = {
  getProfile,
  updatePhoneNumber,
  updateAge,
  updateTeacherTitle,
  changePassword,
  updateProfilePicture,
  deleteProfilePicture,
  upload // Export multer middleware
};