const express = require('express');
const router = express.Router();
const venueController = require('../controllers/venueController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const isAdmin = authorizeRoles('admin');

// Publicly available (authenticated) for teachers to see venues when creating classes
router.get('/', authenticateToken, venueController.getVenues);
router.get('/availability', authenticateToken, venueController.getAvailableVenues);
router.get('/:id/timetable', authenticateToken, venueController.getVenueTimetable);

// Admin only for CRUD
router.post('/', authenticateToken, isAdmin, venueController.addVenue);
router.put('/:id', authenticateToken, isAdmin, venueController.updateVenue);
router.delete('/:id', authenticateToken, isAdmin, venueController.deleteVenue);

module.exports = router;
