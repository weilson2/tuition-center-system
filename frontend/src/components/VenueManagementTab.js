import React, { useEffect, useState, useMemo } from 'react';
import api from '../services/api';
import Toast from './Toast';
import ConfirmDialog from './ConfirmDialog';
import '../styles/UserManagement.css'; // Reusing some CSS or I will create a specific one

const venuesAPI = {
  getVenues: () => api.get('/venues'),
  addVenue: (data) => api.post('/venues', data),
  updateVenue: (id, data) => api.put(`/venues/${id}`, data),
  deleteVenue: (id) => api.delete(`/venues/${id}`),
  getTimetable: (id) => api.get(`/venues/${id}/timetable`)
};

function VenueManagementTab() {
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [viewingTimetable, setViewingTimetable] = useState(null);
  const [timetableClasses, setTimetableClasses] = useState([]);
  const [loadingTimetable, setLoadingTimetable] = useState(false);
  
  const [form, setForm] = useState({
    name: '',
    capacity: '',
    location: '',
    description: ''
  });

  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null, name: '' });

  const [availabilityFilter, setAvailabilityFilter] = useState({
    day: 'Mon',
    startHour: '08',
    startMin: '00',
    meridiem: 'AM',
    duration: '60'
  });
  const [availableVenues, setAvailableVenues] = useState(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  const fetchVenues = async () => {
    try {
      setLoading(true);
      const response = await venuesAPI.getVenues();
      setVenues(response.data.venues || []);
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to fetch venues', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVenues();
  }, []);

  const showMessage = (message, type = 'success') => {
    setToast({ message, type });
  };

  const checkAvailability = async () => {
    try {
      setCheckingAvailability(true);
      
      let h24 = parseInt(availabilityFilter.startHour);
      if (availabilityFilter.meridiem === 'PM' && h24 !== 12) h24 += 12;
      if (availabilityFilter.meridiem === 'AM' && h24 === 12) h24 = 0;
      
      const startStr = `${String(h24).padStart(2, '0')}:${availabilityFilter.startMin}`;
      const totalStartMin = h24 * 60 + parseInt(availabilityFilter.startMin);
      const totalEndMin = totalStartMin + parseInt(availabilityFilter.duration);
      const endStr = `${String(Math.floor(totalEndMin / 60)).padStart(2, '0')}:${String(totalEndMin % 60).padStart(2, '0')}`;
      
      const schedule = `${availabilityFilter.day} ${startStr}-${endStr}`;
      
      const response = await api.get(`/venues/availability?schedule=${encodeURIComponent(schedule)}`);
      setAvailableVenues(response.data.venues.map(v => v.venue_id));
      showMessage(`Availability checked for ${schedule}`);
    } catch (error) {
      showMessage('Failed to check availability', 'error');
    } finally {
      setCheckingAvailability(false);
    }
  };

  const handleOpenAdd = () => {
    setEditTarget(null);
    setForm({ name: '', capacity: '', location: '', description: '' });
    setShowModal(true);
  };

  const handleOpenEdit = (venue) => {
    setEditTarget(venue);
    setForm({
      name: venue.name,
      capacity: venue.capacity || '',
      location: venue.location || '',
      description: venue.description || ''
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      if (editTarget) {
        await venuesAPI.updateVenue(editTarget.venue_id, form);
        showMessage('Venue updated successfully');
      } else {
        await venuesAPI.addVenue(form);
        showMessage('Venue added successfully');
      }
      setShowModal(false);
      fetchVenues();
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to save venue', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (venue) => {
    setDeleteConfirm({ open: true, id: venue.venue_id, name: venue.name });
  };

  const confirmDelete = async () => {
    try {
      setSaving(true);
      await venuesAPI.deleteVenue(deleteConfirm.id);
      showMessage('Venue deleted successfully');
      setDeleteConfirm({ open: false, id: null, name: '' });
      fetchVenues();
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to delete venue', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleViewTimetable = async (venue) => {
    try {
      setViewingTimetable(venue);
      setLoadingTimetable(true);
      const response = await venuesAPI.getTimetable(venue.venue_id);
      setTimetableClasses(response.data.classes || []);
    } catch (error) {
      showMessage('Failed to load timetable', 'error');
    } finally {
      setLoadingTimetable(false);
    }
  };

  const filteredVenues = useMemo(() => {
    if (availableVenues === null) return venues;
    return venues.filter(v => availableVenues.includes(v.venue_id));
  }, [venues, availableVenues]);

  return (
    <div className="um-container">
      <div className="um-header">
        <div className="um-title-section">
          <h2>Venue Management</h2>
          <p>Manage tuition center venues and view schedules</p>
        </div>
        <button className="um-btn-primary" onClick={handleOpenAdd}>
          <i className="fas fa-plus"></i> Add Venue
        </button>
      </div>

      {/* Availability Filter */}
      <div className="um-filter-section" style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #e9ecef' }}>
        <h4 style={{ marginBottom: '10px' }}>Check Venue Availability</h4>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: '12px', display: 'block' }}>Day</label>
            <select 
              value={availabilityFilter.day} 
              onChange={e => setAvailabilityFilter({...availabilityFilter, day: e.target.value})}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
            >
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '12px', display: 'block' }}>Start Time</label>
            <div style={{ display: 'flex', gap: '5px' }}>
              <select 
                value={availabilityFilter.startHour} 
                onChange={e => setAvailabilityFilter({...availabilityFilter, startHour: e.target.value})}
                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              >
                {['08', '09', '10', '11', '12', '01', '02', '03', '04', '05', '06', '07', '08'].map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              <select 
                value={availabilityFilter.startMin} 
                onChange={e => setAvailabilityFilter({...availabilityFilter, startMin: e.target.value})}
                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              >
                {['00', '15', '30', '45'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <select 
                value={availabilityFilter.meridiem} 
                onChange={e => setAvailabilityFilter({...availabilityFilter, meridiem: e.target.value})}
                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontSize: '12px', display: 'block' }}>Duration (min)</label>
            <select 
              value={availabilityFilter.duration} 
              onChange={e => setAvailabilityFilter({...availabilityFilter, duration: e.target.value})}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
            >
              {['30', '45', '60', '90', '120', '180'].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <button 
            className="um-btn-secondary" 
            onClick={checkAvailability} 
            disabled={checkingAvailability}
            style={{ padding: '8px 15px' }}
          >
            {checkingAvailability ? 'Checking...' : 'Filter Available'}
          </button>
          {availableVenues !== null && (
            <button 
              className="um-btn-secondary" 
              onClick={() => setAvailableVenues(null)}
              style={{ padding: '8px 15px', background: 'none', border: 'none', color: '#dc3545', textDecoration: 'underline', cursor: 'pointer' }}
            >
              Clear Filter
            </button>
          )}
        </div>
      </div>

      <div className="um-table-container">
        {loading ? (
          <div className="um-loading">
            <i className="fas fa-spinner fa-spin"></i> Loading venues...
          </div>
        ) : (
          <table className="um-table">
            <thead>
              <tr>
                <th>Venue Name</th>
                <th>Capacity</th>
                <th>Location</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredVenues.length === 0 ? (
                <tr>
                  <td colSpan="4" className="um-empty">No venues found.</td>
                </tr>
              ) : (
                filteredVenues.map(venue => (
                  <tr key={venue.venue_id}>
                    <td>
                      <div className="um-user-info">
                        <strong>{venue.name}</strong>
                        <span className="um-user-email">{venue.description || 'No description'}</span>
                      </div>
                    </td>
                    <td>{venue.capacity || '-'}</td>
                    <td>{venue.location || '-'}</td>
                    <td>
                      <div className="um-actions">
                        <button className="um-action-btn" onClick={() => handleViewTimetable(venue)} title="View Timetable">
                          <i className="fas fa-calendar-alt"></i>
                        </button>
                        <button className="um-action-btn" onClick={() => handleOpenEdit(venue)} title="Edit">
                          <i className="fas fa-edit"></i>
                        </button>
                        <button className="um-action-btn delete" onClick={() => handleDelete(venue)} title="Delete">
                          <i className="fas fa-trash"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Timetable View */}
      {viewingTimetable && (
        <div className="um-modal-backdrop">
          <div className="um-modal timetable-modal" style={{ maxWidth: '800px' }}>
            <div className="um-modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Timetable for {viewingTimetable.name}</h3>
              <button className="um-close-btn" onClick={() => setViewingTimetable(null)}>&times;</button>
            </div>
            
            <div className="um-modal-content" style={{ marginTop: '20px' }}>
              {loadingTimetable ? (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <i className="fas fa-spinner fa-spin"></i> Loading...
                </div>
              ) : timetableClasses.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                  No classes scheduled for this venue.
                </div>
              ) : (
                <table className="um-table">
                  <thead>
                    <tr>
                      <th>Class Name</th>
                      <th>Schedule</th>
                      <th>Teacher</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timetableClasses.map(cls => (
                      <tr key={cls.id}>
                        <td>{cls.name}</td>
                        <td>{cls.schedule}</td>
                        <td>{cls.teacherName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            
            <div className="um-modal-actions">
              <button className="um-btn-secondary" onClick={() => setViewingTimetable(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="um-modal-backdrop">
          <div className="um-modal">
            <h3>{editTarget ? 'Edit Venue' : 'Add Venue'}</h3>
            <form onSubmit={handleSubmit}>
              <label>Venue Name</label>
              <input 
                type="text" 
                value={form.name} 
                onChange={e => setForm({...form, name: e.target.value})} 
                required 
                placeholder="e.g. Room A"
              />
              
              <label>Capacity</label>
              <input 
                type="number" 
                value={form.capacity} 
                onChange={e => setForm({...form, capacity: e.target.value})} 
                placeholder="Number of students"
              />
              
              <label>Location</label>
              <input 
                type="text" 
                value={form.location} 
                onChange={e => setForm({...form, location: e.target.value})} 
                placeholder="e.g. Level 2"
              />
              
              <label>Description</label>
              <textarea 
                value={form.description} 
                onChange={e => setForm({...form, description: e.target.value})} 
                placeholder="Any additional details"
                className="um-textarea"
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ddd', minHeight: '80px' }}
              />

              <div className="um-modal-actions">
                <button type="button" className="um-btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Cancel</button>
                <button type="submit" className="um-btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : (editTarget ? 'Update Venue' : 'Add Venue')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteConfirm.open}
        title="Delete Venue"
        message={`Are you sure you want to delete venue "${deleteConfirm.name}"? This action cannot be undone.`}
        confirmText="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm({ open: false, id: null, name: '' })}
        isConfirming={saving}
      />

      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast(null)} 
        />
      )}
    </div>
  );
}

export default VenueManagementTab;
