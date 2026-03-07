const express = require('express');
const router = express.Router();
const passwordResetController = require('../controllers/passwordResetController');
const { passwordResetLimiter } = require('../middleware/rateLimit');
const { body, param, validationResult } = require('express-validator');

// Validation middleware
const validatePasswordResetRequest = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail()
];

const validatePasswordReset = [
  body('token')
    .trim()
    .notEmpty()
    .withMessage('Reset token is required')
    .isLength({ min: 64, max: 64 })
    .withMessage('Invalid reset token format')
    .matches(/^[a-fA-F0-9]+$/)
    .withMessage('Invalid reset token format'),
  body('newPassword')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,128}$/)
    .withMessage('Password must contain uppercase, lowercase, number, and special character')
];

const validateVerifyResetToken = [
  param('token')
    .trim()
    .notEmpty()
    .withMessage('Reset token is required')
    .isLength({ min: 64, max: 64 })
    .withMessage('Invalid reset token format')
    .matches(/^[a-fA-F0-9]+$/)
    .withMessage('Invalid reset token format')
];

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

// Routes
router.post('/request', passwordResetLimiter, validatePasswordResetRequest, handleValidationErrors, passwordResetController.requestPasswordReset);
router.get('/verify/:token', validateVerifyResetToken, handleValidationErrors, passwordResetController.verifyResetToken);
router.post('/reset', validatePasswordReset, handleValidationErrors, passwordResetController.resetPassword);

module.exports = router;