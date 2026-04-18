const pool = require('../config/database');

async function ensureVenueTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS venues (
      venue_id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      capacity INTEGER,
      location TEXT,
      description TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getVenues(req, res) {
  try {
    await ensureVenueTable();
    const result = await pool.query('SELECT * FROM venues ORDER BY name ASC');
    res.json({ venues: result.rows });
  } catch (error) {
    console.error('Error fetching venues:', error);
    res.status(500).json({ error: 'Failed to fetch venues' });
  }
}

async function addVenue(req, res) {
  try {
    await ensureVenueTable();
    const { name, capacity, location, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Venue name is required' });
    }

    const result = await pool.query(
      'INSERT INTO venues (name, capacity, location, description) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, capacity || null, location || null, description || null]
    );
    res.status(201).json({ venue: result.rows[0] });
  } catch (error) {
    console.error('Error adding venue:', error);
    res.status(500).json({ error: 'Failed to add venue' });
  }
}

async function updateVenue(req, res) {
  try {
    const { id } = req.params;
    const { name, capacity, location, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Venue name is required' });
    }

    const result = await pool.query(
      'UPDATE venues SET name = $1, capacity = $2, location = $3, description = $4, updated_at = CURRENT_TIMESTAMP WHERE venue_id = $5 RETURNING *',
      [name, capacity || null, location || null, description || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    res.json({ venue: result.rows[0] });
  } catch (error) {
    console.error('Error updating venue:', error);
    res.status(500).json({ error: 'Failed to update venue' });
  }
}

async function deleteVenue(req, res) {
  try {
    const { id } = req.params;
    
    // Check if venue is in use
    const teacherStateResult = await pool.query('SELECT state_json FROM teacher_classroom_states');
    let isInUse = false;
    for (const row of teacherStateResult.rows || []) {
      const clsList = Array.isArray(row?.state_json?.classrooms) ? row.state_json.classrooms : [];
      if (clsList.some(cls => Number(cls.venueId) === Number(id))) {
        isInUse = true;
        break;
      }
    }

    if (isInUse) {
      return res.status(400).json({ error: 'Venue is currently in use by one or more classes and cannot be deleted.' });
    }

    const result = await pool.query('DELETE FROM venues WHERE venue_id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    res.json({ message: 'Venue deleted successfully' });
  } catch (error) {
    console.error('Error deleting venue:', error);
    res.status(500).json({ error: 'Failed to delete venue' });
  }
}

async function getVenueTimetable(req, res) {
  try {
    const { id } = req.params;
    const teacherStateResult = await pool.query('SELECT state_json, teacher_user_id FROM teacher_classroom_states');
    const classes = [];

    for (const row of teacherStateResult.rows || []) {
      const clsList = Array.isArray(row?.state_json?.classrooms) ? row.state_json.classrooms : [];
      for (const cls of clsList) {
        if (Number(cls.venueId) === Number(id)) {
          classes.push({
            id: cls.classroomId || cls.id,
            name: cls.classroomName || cls.title,
            schedule: cls.classSchedule || cls.schedule,
            teacherId: row.teacher_user_id,
            teacherName: cls.ownerTeacherName
          });
        }
      }
    }

    res.json({ classes });
  } catch (error) {
    console.error('Error fetching venue timetable:', error);
    res.status(500).json({ error: 'Failed to fetch venue timetable' });
  }
}

async function getAvailableVenues(req, res) {
  try {
    const { schedule, excludeClassroomId, teacherUserId } = req.query; // e.g. "Mon 08:00-09:00", excludeClassroomId=123
    if (!schedule) {
      return res.status(400).json({ error: 'Schedule is required for availability check' });
    }

    const { hasOverlap } = require('../utils/scheduleMatcher');
    const venuesResult = await pool.query('SELECT * FROM venues');
    const teacherStateResult = await pool.query('SELECT state_json, teacher_user_id FROM teacher_classroom_states');
    
    const occupiedVenueIds = new Set();
    for (const row of teacherStateResult.rows || []) {
      const clsList = Array.isArray(row?.state_json?.classrooms) ? row.state_json.classrooms : [];
      for (const cls of clsList) {
        // Skip current classroom if excluding (robust check for self-conflict during edits)
        const clsId = String(cls.classroomId || cls.id || '');
        const targetId = String(excludeClassroomId || '');
        const isSameTeacher = teacherUserId ? String(row.teacher_user_id) === String(teacherUserId) : true;
        
        if (targetId && clsId === targetId && isSameTeacher) {
          continue;
        }

        if (cls.venueId && cls.classSchedule) {
          if (hasOverlap(schedule, cls.classSchedule)) {
            occupiedVenueIds.add(Number(cls.venueId));
          }
        }
      }
    }

    const availableVenues = venuesResult.rows.filter(v => !occupiedVenueIds.has(Number(v.venue_id)));
    res.json({ venues: availableVenues });
  } catch (error) {
    console.error('Error checking venue availability:', error);
    res.status(500).json({ error: 'Failed to check venue availability' });
  }
}

module.exports = {
  getVenues,
  addVenue,
  updateVenue,
  deleteVenue,
  getVenueTimetable,
  getAvailableVenues,
  ensureVenueTable
};
