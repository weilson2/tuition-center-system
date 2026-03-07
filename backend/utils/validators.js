const { body, validationResult } = require('express-validator');

const validateLogin = [
  body('email')
    .trim()
    .isLength({ max: 254 })
    .withMessage('Email is too long')
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 1, max: 128 })
    .withMessage('Password length is invalid'),
  body('role')
    .trim()
    .isIn(['student', 'teacher', 'admin'])
    .withMessage('Valid role is required'),
  body('rememberMe')
    .optional()
    .isBoolean()
    .withMessage('rememberMe must be a boolean')
    .toBoolean()
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array() 
    });
  }
  next();
};

module.exports = {
  validateLogin,
  handleValidationErrors
};