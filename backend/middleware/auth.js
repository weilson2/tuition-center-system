const { verifyToken } = require('../config/jwt');
const { generateToken } = require('../config/jwt');
const Session = require('../models/Session');
const User = require('../models/User');

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

async function authenticateToken(req, res, next) {
  try {
    // Get token from cookie or Authorization header
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify JWT token
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Check session in database
    const session = await Session.findByToken(token);
    if (!session || !session.is_active) {
      return res.status(401).json({ error: 'Session invalid or expired' });
    }

    // Check if session is expired
    if (Session.isExpired(session)) {
      await Session.invalidate(session.session_id);
      return res.status(401).json({ error: 'Session expired' });
    }

    // Get user details
    const user = await User.findById(decoded.userId);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User account not found or inactive' });
    }

    // Update last activity
    await Session.updateActivity(session.session_id);

    // Refresh session token 30 minutes prior to expiration
    const now = Date.now();
    const expiresAt = new Date(session.expires_at).getTime();
    const timeRemainingMs = expiresAt - now;

    if (Number.isFinite(timeRemainingMs) && timeRemainingMs > 0 && timeRemainingMs <= THIRTY_MINUTES_MS) {
      const refreshedToken = generateToken({
        userId: user.user_id,
        email: user.email,
        role: user.role
      }, Boolean(session.remember_me));

      const refreshedExpiry = new Date();
      if (session.remember_me) {
        refreshedExpiry.setDate(refreshedExpiry.getDate() + 30);
      } else {
        refreshedExpiry.setHours(refreshedExpiry.getHours() + 8);
      }

      await Session.rotateToken(session.session_id, refreshedToken, refreshedExpiry);

      res.cookie('token', refreshedToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: session.remember_me ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000
      });
      res.setHeader('x-session-token', refreshedToken);
    }

    // Attach user and session to request
    req.user = {
      userId: user.user_id,
      email: user.email,
      role: user.role,
      fullName: user.full_name
    };
    req.sessionId = session.session_id;

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// Role-based authorization middleware
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access forbidden' });
    }

    next();
  };
}

module.exports = {
  authenticateToken,
  authorizeRoles
};