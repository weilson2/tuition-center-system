const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const { loginLimiter, adminLoginLimiter } = require('../middleware/rateLimit');
const { validateLogin, handleValidationErrors } = require('../utils/validators');

// Public routes
router.post('/login', loginLimiter, adminLoginLimiter, validateLogin, handleValidationErrors, authController.login);

// Protected routes
router.post('/logout', authenticateToken, authController.logout);
router.get('/me', authenticateToken, authController.getCurrentUser);

module.exports = router;