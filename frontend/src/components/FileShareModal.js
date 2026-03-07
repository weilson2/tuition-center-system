import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const getToken = () => {
  return localStorage.getItem('token') || sessionStorage.getItem('token');
};

function FileShareModal({ selectedFileIds, onClose, onShared }) {
  const [step, setStep] = useState(1); // 1: Review files, 2: Select recipients, 3: Confirm
  const [filesDetails, setFilesDetails] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserRole, setCurrentUserRole] = useState('student');
  const [sharePermission, setSharePermission] = useState('all');

  useEffect(() => {
    if (selectedFileIds && selectedFileIds.length > 0) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFileIds]);

  const loadData = async () => {
    try {
      setLoading(true);
      const token = getToken();
      
      // Fetch file details
      const filePromises = selectedFileIds.map(fileId =>
        axios.get(`${API_URL}/storage/files/${fileId}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      );
      const fileResponses = await Promise.all(filePromises);
      setFilesDetails(fileResponses.map(res => res.data.file));
      
      // Fetch users for recipient selection
      const usersResponse = await axios.get(`${API_URL}/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUsers(usersResponse.data.users);
      setCurrentUserId(usersResponse.data.currentUserId);
      setCurrentUserRole(usersResponse.data.currentUserRole || 'student');
      
      setLoading(false);
    } catch (error) {
      console.error('Load data error:', error);
      setLoading(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getFileIcon = (fileType) => {
    if (!fileType) return 'fa-file';
    if (fileType.startsWith('image/')) return 'fa-file-image';
    if (fileType === 'application/pdf') return 'fa-file-pdf';
    if (fileType.startsWith('video/')) return 'fa-file-video';
    if (fileType.startsWith('audio/')) return 'fa-file-audio';
    if (fileType.includes('word')) return 'fa-file-word';
    if (fileType.includes('excel')) return 'fa-file-excel';
    if (fileType.startsWith('text/')) return 'fa-file-alt';
    return 'fa-file';
  };

  const getRoleIcon = (role) => {
    if (role === 'teacher') return 'fa-chalkboard-teacher';
    if (role === 'student') return 'fa-user-graduate';
    return 'fa-user';
  };

  const toggleUserSelection = (userId) => {
    if (selectedUsers.includes(userId)) {
      setSelectedUsers(selectedUsers.filter(id => id !== userId));
    } else {
      setSelectedUsers([...selectedUsers, userId]);
    }
  };

  const filteredUsers = users.filter(user => {
    // Exclude current user (can't share with yourself)
    if (user.user_id === currentUserId) return false;

    if (!['teacher', 'student'].includes(String(user.role || '').toLowerCase())) return false;

    if (!['teacher', 'student'].includes(String(currentUserRole || '').toLowerCase())) return false;
    
    // Apply search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      return (
        user.full_name.toLowerCase().includes(searchLower) ||
        user.email.toLowerCase().includes(searchLower) ||
        user.role.toLowerCase().includes(searchLower)
      );
    }
    
    return true;
  });

  const permissionOptions = [
    { value: 'all', label: 'All', description: 'Allow download, edit, and rename.' },
    { value: 'download', label: 'Download only', description: 'Allow download and preview only.' },
    { value: 'edit', label: 'Edit', description: 'Allow editing text files (includes preview/download).' },
    { value: 'rename', label: 'Rename only', description: 'Allow renaming only.' }
  ];

  const selectedPermissionMeta = permissionOptions.find((option) => option.value === sharePermission) || permissionOptions[0];

  const handleShare = async () => {
    if (selectedUsers.length === 0) {
      alert('Please select at least one recipient');
      return;
    }

    try {
      setSharing(true);
      const token = getToken();
      
      await axios.post(
        `${API_URL}/storage/share`,
        {
          fileIds: selectedFileIds,
          recipientIds: selectedUsers,
          permission: sharePermission
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (onShared) {
        onShared(`Successfully shared ${selectedFileIds.length} file${selectedFileIds.length > 1 ? 's' : ''} with ${selectedUsers.length} recipient${selectedUsers.length > 1 ? 's' : ''}`);
      }
      
      onClose();
    } catch (error) {
      console.error('Share error:', error);
      alert(error.response?.data?.error || 'Failed to share files');
      setSharing(false);
    }
  };

  const getTotalSize = () => {
    return filesDetails.reduce((total, file) => total + parseInt(file.file_size), 0);
  };

  if (!selectedFileIds || selectedFileIds.length === 0) return null;

  return (
    <div className="file-share-overlay" onClick={() => !sharing && onClose()}>
      <div className="file-share-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="share-header">
          <div className="share-progress">
            <div className={`progress-step ${step >= 1 ? 'active' : ''}`}>
              <div className="step-number">1</div>
              <span>Review Files</span>
            </div>
            <div className="progress-line"></div>
            <div className={`progress-step ${step >= 2 ? 'active' : ''}`}>
              <div className="step-number">2</div>
              <span>Select Recipients</span>
            </div>
            <div className="progress-line"></div>
            <div className={`progress-step ${step >= 3 ? 'active' : ''}`}>
              <div className="step-number">3</div>
              <span>Confirm</span>
            </div>
          </div>
          <button onClick={onClose} className="close-btn" disabled={sharing}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Content */}
        <div className="share-content">
          {loading ? (
            <div className="share-loading">
              <i className="fas fa-spinner fa-spin"></i>
              <p>Loading...</p>
            </div>
          ) : (
            <>
              {/* Step 1: Review Files */}
              {step === 1 && (
                <div className="share-step">
                  <h3>Review Files to Share</h3>
                  <p className="step-description">
                    Review the files you're about to share. These files will remain encrypted.
                  </p>
                  
                  <div className="files-review-list">
                    {filesDetails.map(file => (
                      <div key={file.file_id} className="file-review-item">
                        <div className="file-review-icon">
                          <i className={`fas ${getFileIcon(file.file_type)}`}></i>
                        </div>
                        <div className="file-review-info">
                          <p className="file-review-name">{file.original_filename}</p>
                          <p className="file-review-meta">
                            {formatFileSize(file.file_size)} • {file.file_extension?.toUpperCase() || 'FILE'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="share-summary">
                    <div className="summary-item">
                      <span>Total Files:</span>
                      <strong>{filesDetails.length}</strong>
                    </div>
                    <div className="summary-item">
                      <span>Total Size:</span>
                      <strong>{formatFileSize(getTotalSize())}</strong>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Select Recipients */}
              {step === 2 && (
                <div className="share-step">
                  <h3>Select Recipients</h3>
                  <p className="step-description">
                    Choose who you want to share these files with. You cannot share files with yourself.
                  </p>

                  {/* Search */}
                  <div className="recipient-search">
                    <i className="fas fa-search"></i>
                    <input
                      type="text"
                      placeholder="Search by name, email, or role..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>

                  {/* Permission selection */}
                  <div className="permission-selector">
                    <div className="permission-selector-header">
                      <p className="permission-selector-title">Recipient permission</p>
                      <span className="permission-selected-pill">Selected: {selectedPermissionMeta.label}</span>
                    </div>
                    <div className="permission-option-list">
                      {permissionOptions.map((option) => (
                        <label
                          key={option.value}
                          className={`permission-option ${sharePermission === option.value ? 'active' : ''}`}
                        >
                          <input
                            type="radio"
                            name="sharePermission"
                            value={option.value}
                            checked={sharePermission === option.value}
                            onChange={() => setSharePermission(option.value)}
                          />
                          <span className="permission-option-indicator" aria-hidden="true"></span>
                          <div className="permission-option-body">
                            <strong className="permission-option-label">{option.label}</strong>
                            <p className="permission-option-description">{option.description}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Selected count */}
                  {selectedUsers.length > 0 && (
                    <div className="selected-count">
                      <i className="fas fa-check-circle"></i>
                      {selectedUsers.length} recipient{selectedUsers.length > 1 ? 's' : ''} selected
                    </div>
                  )}

                  {/* Users list */}
                  <div className="recipients-list">
                    {filteredUsers.length === 0 ? (
                      <div className="no-users">
                        <i className="fas fa-user-slash"></i>
                        <p>No users found</p>
                      </div>
                    ) : (
                      filteredUsers.map(user => (
                        <div
                          key={user.user_id}
                          className={`recipient-item ${selectedUsers.includes(user.user_id) ? 'selected' : ''}`}
                          onClick={() => toggleUserSelection(user.user_id)}
                        >
                          <div className="recipient-checkbox">
                            <input
                              type="checkbox"
                              checked={selectedUsers.includes(user.user_id)}
                              onChange={() => toggleUserSelection(user.user_id)}
                            />
                          </div>
                          <div className="recipient-avatar">
                            {user.profile_picture_url ? (
                              <img src={user.profile_picture_url} alt={user.full_name} />
                            ) : (
                              <div className="avatar-placeholder">
                                {user.full_name.charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className="recipient-info">
                            <p className="recipient-name">{user.full_name}</p>
                            <p className="recipient-meta">
                              <i className={`fas ${getRoleIcon(user.role)}`}></i>
                              {user.role.charAt(0).toUpperCase() + user.role.slice(1)} • {user.email}
                            </p>
                          </div>
                          {selectedUsers.includes(user.user_id) && (
                            <div className="recipient-selected-icon">
                              <i className="fas fa-check-circle"></i>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Confirm */}
              {step === 3 && (
                <div className="share-step">
                  <h3>Confirm Sharing</h3>
                  <p className="step-description">
                    Review your sharing details before confirming.
                  </p>

                  <div className="confirmation-section">
                    <h4>
                      <i className="fas fa-file"></i>
                      Files ({filesDetails.length})
                    </h4>
                    <div className="confirmation-list">
                      {filesDetails.map(file => (
                        <div key={file.file_id} className="confirmation-item">
                          <i className={`fas ${getFileIcon(file.file_type)}`}></i>
                          <span>{file.original_filename}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="confirmation-section">
                    <h4>
                      <i className="fas fa-users"></i>
                      Recipients ({selectedUsers.length})
                    </h4>
                    <div className="confirmation-list">
                      {selectedUsers.map(userId => {
                        const user = users.find(u => u.user_id === userId);
                        return user ? (
                          <div key={userId} className="confirmation-item">
                            <i className={`fas ${getRoleIcon(user.role)}`}></i>
                            <span>{user.full_name} ({user.role})</span>
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>

                  <div className="confirmation-section">
                    <h4>
                      <i className="fas fa-user-shield"></i>
                      Permission
                    </h4>
                    <div className="confirmation-list">
                      <div className="confirmation-item">
                        <i className="fas fa-key"></i>
                        <span>{selectedPermissionMeta.label}</span>
                      </div>
                    </div>
                  </div>

                  <div className="confirmation-note">
                    <i className="fas fa-info-circle"></i>
                    <div>
                      <strong>Note:</strong>
                      <p>Recipients will be notified and can access these files immediately. Files remain encrypted in storage.</p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="share-footer">
          <button
            onClick={onClose}
            className="cancel-share-btn"
            disabled={sharing}
          >
            Cancel
          </button>

          <div className="footer-actions">
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="back-btn"
                disabled={sharing}
              >
                <i className="fas fa-arrow-left"></i>
                Back
              </button>
            )}

            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                className="next-btn"
                disabled={step === 2 && selectedUsers.length === 0}
              >
                Next
                <i className="fas fa-arrow-right"></i>
              </button>
            ) : (
              <button
                onClick={handleShare}
                className="confirm-share-btn"
                disabled={sharing}
              >
                {sharing ? (
                  <>
                    <i className="fas fa-spinner fa-spin"></i>
                    Sharing...
                  </>
                ) : (
                  <>
                    <i className="fas fa-share-alt"></i>
                    Share Files
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default FileShareModal;
