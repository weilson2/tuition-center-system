const express = require('express');
const router = express.Router();
const classroomController = require('../controllers/classroomController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.get('/teacher/state', classroomController.getTeacherState);
router.put('/teacher/state', classroomController.saveTeacherState);
router.put('/teacher/classrooms/:classroomId/assignments/:assignmentId/submissions/:submissionId/grade', classroomController.gradeStudentSubmission);
router.put('/teacher/assignments/:assignmentId/submissions/:submissionId/grade', classroomController.gradeStudentSubmission);

router.get('/student/classes', classroomController.getStudentClasses);
router.post('/student/join', classroomController.joinClassByCode);
router.post('/student/classrooms/:classroomId/assignments/:assignmentId/submit', classroomController.submitStudentAssignment);
router.post('/student/classrooms/:classroomId/assignments/:assignmentId/unsubmit', classroomController.unsubmitStudentAssignment);
router.post('/student/assignments/:assignmentId/submit', classroomController.submitStudentAssignment);
router.post('/student/assignments/:assignmentId/unsubmit', classroomController.unsubmitStudentAssignment);

router.get('/announcements', classroomController.getClassAnnouncements);
router.post('/announcements', classroomController.postClassAnnouncement);

router.post('/check-schedule-conflict', classroomController.checkScheduleConflict);

router.get('/audit-logs', classroomController.getClassroomAuditLogs);
router.get('/audit-stats', classroomController.getClassroomAuditStats);
router.get('/audit-logs/export', classroomController.exportClassroomAuditLogs);

module.exports = router;
