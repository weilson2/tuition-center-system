const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { authenticateToken } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: errors.array()[0].msg,
      details: errors.array() 
    });
  }
  next();
};

// Validation rules
const validatePhoneNumber = [
  body('phone_number')
    .optional({ nullable: true, checkFalsy: true })
    .matches(/^[0-9\s\-\+]+$/)
    .withMessage('Phone number can only contain numbers, spaces, hyphens, and plus signs')
    .isLength({ min: 8, max: 15 })
    .withMessage('Phone number must be between 8 and 15 digits')
];

const validateAge = [
  body('age')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 5, max: 120 })
    .withMessage('Age must be between 5 and 120')
    .custom((value, { req }) => {
      const role = req.user?.role;
      if (role === 'student' && (value < 5 || value > 17)) {
        throw new Error('Students must be between 5 and 17 years old');
      }
      if (role === 'teacher' && value < 18) {
        throw new Error('Teachers must be at least 18 years old');
      }
      return true;
    })
];

const validateTeacherTitle = [
  body('teacherTitle')
    .notEmpty()
    .withMessage('Teacher title is required')
    .isIn(['Mr', 'Ms', 'mr', 'ms'])
    .withMessage('Teacher title must be Mr or Ms')
];

const validatePasswordChange = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]/)
    .withMessage('Password must contain uppercase, lowercase, number, and special character'),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Passwords do not match');
      }
      return true;
    })
];

// Routes
router.get('/me', authenticateToken, profileController.getProfile);
router.put('/phone', authenticateToken, validatePhoneNumber, handleValidationErrors, profileController.updatePhoneNumber);
router.put('/age', authenticateToken, validateAge, handleValidationErrors, profileController.updateAge);
router.put('/teacher-title', authenticateToken, validateTeacherTitle, handleValidationErrors, profileController.updateTeacherTitle);
router.post('/change-password', authenticateToken, validatePasswordChange, handleValidationErrors, profileController.changePassword);
router.post('/profile-picture', authenticateToken, profileController.upload.single('profilePicture'), profileController.updateProfilePicture);
router.delete('/profile-picture', authenticateToken, profileController.deleteProfilePicture);

module.exports = router;