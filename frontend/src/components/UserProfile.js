import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { storage } from '../utils/storage';
import '../styles/UserProfile.css';
import ConfirmDialog from './ConfirmDialog';

function UserProfile({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('view');
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Edit states
  const [editingField, setEditingField] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [age, setAge] = useState('');
  const [teacherTitle, setTeacherTitle] = useState('Mr');

  // Password change states
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Profile picture states
  const [showImageUpload, setShowImageUpload] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [deletingImage, setDeletingImage] = useState(false);
  const [deleteImageConfirmOpen, setDeleteImageConfirmOpen] = useState(false);
  const passwordLogoutTimeoutRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      fetchProfile();
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (passwordLogoutTimeoutRef.current) {
        clearTimeout(passwordLogoutTimeoutRef.current);
      }
    };
  }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const response = await api.get('/profile/me');
      setProfile(response.data.user);
      setPhoneNumber(response.data.user.phoneNumber || '');
      setAge(response.data.user.age || '');
      setTeacherTitle(response.data.user.teacherTitle || 'Mr');
    } catch (err) {
      setError('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePhoneNumber = async () => {
    try {
      setError('');
      setSuccess('');
      const response = await api.put('/profile/phone', { phone_number: phoneNumber });
      setSuccess(response.data.message);
      setEditingField(null);
      await fetchProfile();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update phone number');
    }
  };

  const handleUpdateAge = async () => {
    try {
      setError('');
      setSuccess('');
      
      if (age && (parseInt(age) < 5 || parseInt(age) > 120)) {
        setError('Age must be between 5 and 120');
        return;
      }

      const response = await api.put('/profile/age', { age: age ? parseInt(age) : null });
      setSuccess(response.data.message);
      setEditingField(null);
      await fetchProfile();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update age');
    }
  };

  const handleUpdateTeacherTitle = async () => {
    try {
      setError('');
      setSuccess('');
      const response = await api.put('/profile/teacher-title', { teacherTitle });
      setSuccess(response.data.message);
      setEditingField(null);
      await fetchProfile();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update teacher title');
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      const response = await api.post('/profile/change-password', {
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword,
        confirmPassword: passwordData.confirmPassword
      });
      
      setSuccess(response.data.message);
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });

      if (passwordLogoutTimeoutRef.current) {
        clearTimeout(passwordLogoutTimeoutRef.current);
      }

      passwordLogoutTimeoutRef.current = setTimeout(async () => {
        try {
          await api.post('/auth/logout');
        } catch (logoutError) {
          console.error('Auto logout after password change failed:', logoutError);
        } finally {
          storage.clearAuth();
          window.location.href = '/login';
        }
      }, 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password');
    }
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    
    if (!file) {
      return;
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setError('Invalid file type. Please upload JPEG, PNG, GIF, or WebP images only.');
      return;
    }

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      setError('File size must be less than 5MB');
      return;
    }

    setSelectedImage(file);
    
    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result);
      setShowImageUpload(true);
    };
    reader.onerror = () => {
      console.error('❌ Error reading file');
      setError('Failed to read image file');
    };
    reader.readAsDataURL(file);
  };

  const handleImageUpload = async () => {
    if (!selectedImage) return;

    try {
      setError('');
      setSuccess('');
      setUploadingImage(true);

      const formData = new FormData();
      formData.append('profilePicture', selectedImage);

      const response = await api.post('/profile/profile-picture', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      setSuccess(response.data.message);
      setShowImageUpload(false);
      setSelectedImage(null);
      setImagePreview(null);
      
      // Refresh profile data
      await fetchProfile();

      // Update localStorage to reflect the change immediately
      const storage = await import('../utils/storage');
      const storedUser = storage.storage.getItem('user');
      if (storedUser) {
        const userData = JSON.parse(storedUser);
        userData.profilePictureUrl = response.data.profilePictureUrl;
        storage.storage.setItem('user', JSON.stringify(userData));
      }

      // Trigger a custom event to notify Dashboard
      window.dispatchEvent(new Event('profileUpdated'));
      
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload profile picture');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleDeleteProfilePicture = async () => {
    setDeleteImageConfirmOpen(true);
  };

  const confirmDeleteProfilePicture = async () => {
    try {
      setError('');
      setSuccess('');
      setDeletingImage(true);
      const response = await api.delete('/profile/profile-picture');
      setSuccess(response.data.message);
      await fetchProfile();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete profile picture');
    } finally {
      setDeletingImage(false);
      setDeleteImageConfirmOpen(false);
    }
  };

  const getPasswordStrength = (password) => {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[@$!%*?&#]/.test(password)) strength++;
    return strength;
  };

  const getStrengthLabel = (strength) => {
    if (strength === 0) return { label: 'Very Weak', color: '#ef4444' };
    if (strength === 1) return { label: 'Weak', color: '#f97316' };
    if (strength === 2) return { label: 'Fair', color: '#eab308' };
    if (strength === 3) return { label: 'Good', color: '#3b82f6' };
    if (strength === 4) return { label: 'Strong', color: '#10b981' };
    return { label: 'Very Strong', color: '#059669' };
  };

  const strength = getPasswordStrength(passwordData.newPassword);
  const strengthInfo = getStrengthLabel(strength);

  const formatStorageSize = (bytes) => {
    if (!bytes) return '0 B';
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
  };

  const getStoragePercentage = () => {
    if (!profile) return 0;
    return ((profile.storageUsed / profile.storageQuota) * 100).toFixed(1);
  };

  if (!isOpen) return null;

  if (loading) {
    return (
      <div className="user-profile-overlay">
        <div className="user-profile-modal">
          <div className="profile-loading">
            <i className="fas fa-spinner fa-spin"></i>
            <p>Loading profile...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Profile Modal */}
      <div className="user-profile-overlay" onClick={onClose}>
        <div className="user-profile-modal" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="profile-header">
            <h2>User Profile</h2>
            <button onClick={onClose} className="close-btn">
              <i className="fas fa-times"></i>
            </button>
          </div>

          {/* Tabs */}
          <div className="profile-tabs">
            <button
              onClick={() => setActiveTab('view')}
              className={`tab-btn ${activeTab === 'view' ? 'active' : ''}`}
            >
              <i className="fas fa-user"></i>
              View Profile
            </button>
            <button
              onClick={() => setActiveTab('edit')}
              className={`tab-btn ${activeTab === 'edit' ? 'active' : ''}`}
            >
              <i className="fas fa-edit"></i>
              Edit Profile
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={`tab-btn ${activeTab === 'security' ? 'active' : ''}`}
            >
              <i className="fas fa-lock"></i>
              Security
            </button>
          </div>

          {/* Messages */}
          {error && (
            <div className="profile-error">
              <i className="fas fa-exclamation-circle"></i>
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="profile-success">
              <i className="fas fa-check-circle"></i>
              <span>{success}</span>
            </div>
          )}

          {/* Content */}
          <div className="profile-content">
            {activeTab === 'view' && (
              <div className="profile-view">
                {/* Profile Picture & Basic Info */}
                <div className="profile-basic-info">
                  <div className="profile-avatar-container">
                    <div className="profile-avatar">
                      {profile.profilePictureUrl ? (
                        <img src={profile.profilePictureUrl} alt="Profile" />
                      ) : (
                        <div className="avatar-placeholder">
                          {profile.fullName.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="avatar-actions">
                      <label className="change-picture-btn">
                        <i className="fas fa-camera"></i>
                        Change
                        <input
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                          onChange={handleImageSelect}
                          style={{ display: 'none' }}
                        />
                      </label>
                      {profile.profilePictureUrl && (
                        <button 
                          onClick={handleDeleteProfilePicture}
                          className="remove-picture-btn"
                        >
                          <i className="fas fa-trash"></i>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="profile-details">
                    <h3>{profile.fullName}</h3>
                    <p className="profile-role">
                      <i className="fas fa-briefcase"></i>
                      {profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
                    </p>
                    <p className="profile-status">
                      <span className={`status-indicator ${profile.isActive ? 'active' : 'inactive'}`}></span>
                      {profile.accountStatus}
                    </p>
                  </div>
                </div>

                {/* Profile Information Grid */}
                <div className="profile-info-grid">
                  <div className="info-card">
                    <p className="info-label">Email Address</p>
                    <p className="info-value">
                      <i className="fas fa-envelope"></i>
                      {profile.email}
                    </p>
                  </div>

                  <div className="info-card">
                    <p className="info-label">Phone Number</p>
                    <p className="info-value">
                      <i className="fas fa-phone"></i>
                      {profile.phoneNumber || 'Not provided'}
                    </p>
                  </div>

                  <div className="info-card">
                    <p className="info-label">Age</p>
                    <p className="info-value">
                      <i className="fas fa-birthday-cake"></i>
                      {profile.age || 'Not provided'}
                    </p>
                  </div>

                  {profile.role === 'teacher' && (
                    <div className="info-card">
                      <p className="info-label">Title</p>
                      <p className="info-value">
                        <i className="fas fa-user-tie"></i>
                        {profile.teacherTitle || 'Not set'}
                      </p>
                    </div>
                  )}

                  <div className="info-card">
                    <p className="info-label">Account Created</p>
                    <p className="info-value">
                      <i className="fas fa-calendar"></i>
                      {new Date(profile.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {/* Storage Info */}
                <div className="storage-info">
                  <h4>
                    <i className="fas fa-database"></i>
                    Storage Information
                  </h4>
                  <div className="storage-details">
                    <div className="storage-row">
                      <span>Current Usage</span>
                      <span className="storage-value">
                        {formatStorageSize(profile.storageUsed)} / {formatStorageSize(profile.storageQuota)}
                      </span>
                    </div>
                    <div className="storage-bar">
                      <div 
                        className="storage-fill" 
                        style={{ 
                          width: `${getStoragePercentage()}%`,
                          backgroundColor: getStoragePercentage() > 80 ? '#ef4444' : '#3b82f6'
                        }}
                      ></div>
                    </div>
                    <div className="storage-row">
                      <span>Available Space</span>
                      <span className="storage-value available">
                        {formatStorageSize(profile.storageQuota - profile.storageUsed)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'edit' && (
              <div className="profile-edit">
                {/* Edit Phone Number */}
                <div className="edit-section">
                  <h4>Phone Number</h4>
                  {editingField === 'phone' ? (
                    <div className="edit-form">
                      <input
                        type="text"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+60 12-345 6789"
                        className="edit-input"
                      />
                      <div className="edit-actions">
                        <button onClick={handleUpdatePhoneNumber} className="save-btn">
                          Save
                        </button>
                        <button 
                          onClick={() => {
                            setEditingField(null);
                            setPhoneNumber(profile.phoneNumber || '');
                          }} 
                          className="cancel-btn"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="display-value">
                      <span>{profile.phoneNumber || 'Not provided'}</span>
                      <button onClick={() => setEditingField('phone')} className="edit-btn">
                        <i className="fas fa-edit"></i>
                        Edit
                      </button>
                    </div>
                  )}
                </div>

                {/* Edit Age */}
                <div className="edit-section">
                  <h4>Age</h4>
                  {editingField === 'age' ? (
                    <div className="edit-form">
                      <input
                        type="number"
                        value={age}
                        onChange={(e) => setAge(e.target.value)}
                        placeholder="Enter age"
                        min="5"
                        max="120"
                        className="edit-input"
                      />
                      <p className="field-hint">
                        {profile.role === 'student' 
                          ? 'Students must be between 5 and 17 years old' 
                          : 'Teachers must be at least 18 years old'}
                      </p>
                      <div className="edit-actions">
                        <button onClick={handleUpdateAge} className="save-btn">
                          Save
                        </button>
                        <button 
                          onClick={() => {
                            setEditingField(null);
                            setAge(profile.age || '');
                          }} 
                          className="cancel-btn"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="display-value">
                      <span>{profile.age || 'Not provided'}</span>
                      <button onClick={() => setEditingField('age')} className="edit-btn">
                        <i className="fas fa-edit"></i>
                        Edit
                      </button>
                    </div>
                  )}
                </div>

                {profile.role === 'teacher' && (
                  <div className="edit-section">
                    <h4>Title for Announcements</h4>
                    {editingField === 'teacherTitle' ? (
                      <div className="edit-form">
                        <select
                          value={teacherTitle}
                          onChange={(e) => setTeacherTitle(e.target.value)}
                          className="edit-input"
                        >
                          <option value="Mr">Mr</option>
                          <option value="Ms">Ms</option>
                        </select>
                        <p className="field-hint">This title will appear in class announcements (for example: Mr Lim).</p>
                        <div className="edit-actions">
                          <button onClick={handleUpdateTeacherTitle} className="save-btn">
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingField(null);
                              setTeacherTitle(profile.teacherTitle || 'Mr');
                            }}
                            className="cancel-btn"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="display-value">
                        <span>{profile.teacherTitle || 'Not set'}</span>
                        <button onClick={() => setEditingField('teacherTitle')} className="edit-btn">
                          <i className="fas fa-edit"></i>
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <p className="last-updated">
                  <i className="fas fa-info-circle"></i>
                  Last updated: {profile.lastProfileUpdate ? new Date(profile.lastProfileUpdate).toLocaleDateString() : 'Never'}
                </p>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="profile-security">
                <h4>Change Password</h4>
                <form onSubmit={handleChangePassword} className="password-form">
                  <div className="form-group">
                    <label>Current Password</label>
                    <div className="input-wrapper">
                      <input
                        type={showCurrentPassword ? 'text' : 'password'}
                        value={passwordData.currentPassword}
                        onChange={(e) => setPasswordData({...passwordData, currentPassword: e.target.value})}
                        placeholder="Enter current password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                        className="password-toggle"
                      >
                        <i className={`fas ${showCurrentPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                      </button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>New Password</label>
                    <div className="input-wrapper">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        value={passwordData.newPassword}
                        onChange={(e) => setPasswordData({...passwordData, newPassword: e.target.value})}
                        placeholder="Enter new password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="password-toggle"
                      >
                        <i className={`fas ${showNewPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                      </button>
                    </div>
                    {passwordData.newPassword && (
                      <div className="password-strength">
                        <div className="strength-bar">
                          <div 
                            className="strength-fill" 
                            style={{ 
                              width: `${(strength / 5) * 100}%`,
                              backgroundColor: strengthInfo.color
                            }}
                          ></div>
                        </div>
                        <span className="strength-label" style={{ color: strengthInfo.color }}>
                          {strengthInfo.label}
                        </span>
                      </div>
                    )}
                    <p className="field-hint">
                      Must contain: 8+ characters, uppercase, lowercase, number, special character
                    </p>
                  </div>

                  <div className="form-group">
                    <label>Confirm New Password</label>
                    <div className="input-wrapper">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={passwordData.confirmPassword}
                        onChange={(e) => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                        placeholder="Confirm new password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="password-toggle"
                      >
                        <i className={`fas ${showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                      </button>
                    </div>
                    {passwordData.confirmPassword && (
                      <p className={`password-match ${passwordData.newPassword === passwordData.confirmPassword ? 'match' : 'no-match'}`}>
                        {passwordData.newPassword === passwordData.confirmPassword ? (
                          <><i className="fas fa-check"></i> Passwords match</>
                        ) : (
                          <><i className="fas fa-times"></i> Passwords do not match</>
                        )}
                      </p>
                    )}
                  </div>

                  <button type="submit" className="change-password-btn">
                    <i className="fas fa-lock"></i>
                    Change Password
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="profile-footer">
            <button onClick={onClose} className="close-footer-btn">
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Image Upload Modal - Separate from Profile Modal */}
      {showImageUpload && (
        <div className="image-upload-overlay" onClick={() => !uploadingImage && setShowImageUpload(false)}>
          <div className="image-upload-modal" onClick={(e) => e.stopPropagation()}>
            <div className="upload-header">
              <h3>Upload Profile Picture</h3>
              <button 
                onClick={() => setShowImageUpload(false)} 
                className="close-btn"
                disabled={uploadingImage}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="upload-content">
              <div className="image-preview-container">
                {imagePreview && (
                  <img src={imagePreview} alt="Preview" className="image-preview" />
                )}
              </div>

              <div className="upload-info">
                <p className="file-name">
                  <i className="fas fa-file-image"></i>
                  {selectedImage?.name}
                </p>
                <p className="file-size">
                  Size: {(selectedImage?.size / 1024).toFixed(2)} KB
                </p>
                <p className="upload-hint">
                  <i className="fas fa-info-circle"></i>
                  Image will be resized to 400x400 pixels
                </p>
              </div>
            </div>

            <div className="upload-actions">
              <button
                onClick={() => setShowImageUpload(false)}
                className="cancel-upload-btn"
                disabled={uploadingImage}
              >
                Cancel
              </button>
              <button
                onClick={handleImageUpload}
                className="confirm-upload-btn"
                disabled={uploadingImage}
              >
                {uploadingImage ? (
                  <>
                    <i className="fas fa-spinner fa-spin"></i>
                    Uploading...
                  </>
                ) : (
                  <>
                    <i className="fas fa-upload"></i>
                    Upload Picture
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteImageConfirmOpen}
        title="Remove Profile Picture"
        message="Are you sure you want to remove your profile picture?"
        onCancel={() => setDeleteImageConfirmOpen(false)}
        onConfirm={() => {
          void confirmDeleteProfilePicture();
        }}
        isConfirming={deletingImage}
        confirmText="Confirm"
        confirmingText="Confirming..."
      />
    </>
  );
}

export default UserProfile;
