const rateLimit = require('express-rate-limit');

const getRequesterIp = (req) => req.ip || req.connection.remoteAddress || 'unknown';

const getNormalizedEmail = (value) => String(value || '').trim().toLowerCase();

// Login rate limiter - 20 attempts per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Increased from 5 to 20
  message: {
    error: 'Too many login attempts from this IP address. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRequesterIp
});

// Admin login limiter - max 3 attempts per 15 minutes (email + IP)
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: {
    error: 'Too many admin login attempts. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = getRequesterIp(req);
    const email = getNormalizedEmail(req.body?.email);
    return `${ip}:${email || 'no-email'}`;
  },
  skip: (req) => getNormalizedEmail(req.body?.role) !== 'admin'
});

// Password reset limiter - 3 attempts per hour
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: {
    error: 'Too many password reset requests. Please try again after 1 hour.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = getNormalizedEmail(req.body?.email);
    return email || getRequesterIp(req);
  }
});

module.exports = {
  loginLimiter,
  adminLoginLimiter,
  passwordResetLimiter
};