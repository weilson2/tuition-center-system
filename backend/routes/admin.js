const express = require('express');
const router = express.Router();
const multer = require('multer');
const adminController = require('../controllers/adminController');
const userManagementController = require('../controllers/userManagementController');
const classroomController = require('../controllers/classroomController');
const { authenticateToken } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
  console.log('🔐 Admin check - User:', req.user);
  
  if (!req.user || req.user.role !== 'admin') {
    console.log('❌ Access denied - not admin');
    return res.status(403).json({ error: 'Access forbidden. Admin only.' });
  }
  
  console.log('✅ Admin access granted');
  next();
};

// All routes require authentication AND admin role
router.use(authenticateToken);
router.use(requireAdmin);

// Audit log routes
router.get('/audit-logs', adminController.getAuditLogs);
router.get('/audit-stats', adminController.getAuditStats);
router.get('/audit-logs/export', adminController.exportAuditLogs);

// User management routes
router.get('/users', userManagementController.listUsers);
router.get('/users/stats', userManagementController.getUserStats);
router.post('/users', userManagementController.addUser);
router.put('/users/:userId', userManagementController.editUser);
router.post('/users/:userId/reset-password', userManagementController.resetUserPassword);
router.post('/users/:userId/system-reset-password', userManagementController.resetUserPassword);

router.post('/users/enroll', userManagementController.enrollUsers);

router.get('/rbac', userManagementController.getRolePermissions);
router.put('/rbac', userManagementController.updateRolePermissions);
router.post('/rbac/reset/:role', userManagementController.resetRolePermissions);

router.get('/users/import/template', userManagementController.downloadImportTemplate);
router.post('/users/import', upload.single('file'), userManagementController.importUsers);
router.post('/users/import/errors', userManagementController.downloadImportErrors);

router.get('/users/export', userManagementController.exportUsers);

// Classroom management routes
router.get('/classrooms', classroomController.getAdminClassrooms);
router.post('/classrooms/:classroomId/restore', classroomController.restoreAdminClassroom);

module.exports = router;