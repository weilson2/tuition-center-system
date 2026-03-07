import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';
import { storage } from '../utils/storage';
import UserProfile from './UserProfile';
import StorageTab from './StorageTab';
import TeacherDashboardHome from './TeacherDashboardHome';
import StudentDashboardHome from './StudentDashboardHome';
import TeacherClassroomTab from './TeacherClassroomTab';
import StudentClassroomTab from './StudentClassroomTab';
import ConfirmDialog from './ConfirmDialog';
import '../styles/Dashboard.css';

function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'storage', 'classroom'
  const [classroomNavigationIntent, setClassroomNavigationIntent] = useState(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [backConfirmOpen, setBackConfirmOpen] = useState(false);

  const handleOpenClassroom = (intent = null) => {
    setClassroomNavigationIntent(intent);
    setActiveTab('classroom');
  };

  const loadUserData = useCallback(async () => {
    try {
      const storedUser = storage.getItem('user');
      if (storedUser) {
        setUser(JSON.parse(storedUser));
      }
      setLoading(false);
    } catch (error) {
      console.error('Error loading user:', error);
      navigate('/login');
    }
  }, [navigate]);

  useEffect(() => {
    void loadUserData();

    const handleProfileUpdate = () => {
      void loadUserData();
    };

    window.addEventListener('profileUpdated', handleProfileUpdate);

    return () => {
      window.removeEventListener('profileUpdated', handleProfileUpdate);
    };
  }, [loadUserData]);

  const executeLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    try {
      setIsLoggingOut(true);
      await authAPI.logout();
      storage.clearAuth();
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('Logout error:', error);
      storage.clearAuth();
      navigate('/login', { replace: true });
    } finally {
      setIsLoggingOut(false);
      setLogoutConfirmOpen(false);
      setBackConfirmOpen(false);
    }
  };

  useEffect(() => {
    const token = storage.getItem('token');
    if (!token) {
      return undefined;
    }

    const handlePopState = () => {
      if (isLoggingOut) {
        return;
      }

      window.history.pushState({ dashboardGuard: true }, '', window.location.href);
      setBackConfirmOpen(true);
    };

    window.history.pushState({ dashboardGuard: true }, '', window.location.href);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isLoggingOut]);

  const handleLogout = () => {
    if (isLoggingOut) {
      return;
    }
    setLogoutConfirmOpen(true);
  };

  if (loading) {
    return (
      <div className="loading-container">
        <i className="fas fa-spinner fa-spin"></i>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    navigate('/login');
    return null;
  }

  const getRoleDisplay = () => {
    switch (user.role) {
      case 'teacher':
        return { icon: 'fa-chalkboard-teacher', text: 'Teacher', color: '#8b5cf6' };
      case 'student':
        return { icon: 'fa-user-graduate', text: 'Student', color: '#3b82f6' };
      case 'admin':
        return { icon: 'fa-user-shield', text: 'Administrator', color: '#ef4444' };
      default:
        return { icon: 'fa-user', text: 'User', color: '#6b7280' };
    }
  };

  const roleInfo = getRoleDisplay();

  return (
    <div className="dashboard-container">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-content">
          <h1 className="header-title">
            <i className="fas fa-graduation-cap"></i>
            Tuition Center
          </h1>
          <div className="header-actions">
            <span className="user-name">
              <i className={`fas ${roleInfo.icon}`} style={{ color: roleInfo.color }}></i>
              {user.fullName}
            </span>
            <button 
              onClick={() => setShowProfile(true)} 
              className="profile-avatar-btn"
              title="View Profile"
            >
              {user.profilePictureUrl ? (
                <img src={user.profilePictureUrl} alt="Profile" className="profile-avatar-img" />
              ) : (
                <span className="avatar-initials">
                  {user.fullName.charAt(0).toUpperCase()}
                </span>
              )}
            </button>
            <button onClick={handleLogout} className="logout-btn" disabled={isLoggingOut}>
              <i className={`fas ${isLoggingOut ? 'fa-spinner fa-spin' : 'fa-sign-out-alt'}`}></i>
              {isLoggingOut ? 'Logging out...' : 'Logout'}
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="dashboard-nav">
        <button
          className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <i className="fas fa-home"></i>
          Dashboard
        </button>
        <button
          className={`nav-tab ${activeTab === 'storage' ? 'active' : ''}`}
          onClick={() => setActiveTab('storage')}
        >
          <i className="fas fa-cloud"></i>
          Storage
        </button>
        <button
          className={`nav-tab ${activeTab === 'classroom' ? 'active' : ''}`}
          onClick={() => setActiveTab('classroom')}
        >
          <i className="fas fa-chalkboard"></i>
          Classroom
        </button>
      </nav>

      {/* Main Content */}
      <main className="dashboard-main">
        {activeTab === 'dashboard' && (
          user.role === 'teacher' ? (
            <TeacherDashboardHome
              user={user}
              onOpenClassroom={handleOpenClassroom}
            />
          ) : user.role === 'student' ? (
            <StudentDashboardHome
              user={user}
              onOpenClassroom={handleOpenClassroom}
            />
          ) : (
            <div className="welcome-section">
              <h2 className="welcome-title">
                Welcome back, {user.fullName}!
              </h2>
              <p className="welcome-subtitle">
                You are logged in as a <strong style={{ color: roleInfo.color }}>{roleInfo.text}</strong>
              </p>
              <div className="content-placeholder">
                <i className="fas fa-box-open" style={{ fontSize: '4rem', color: '#d1d5db', marginBottom: '1rem' }}></i>
                <p style={{ color: '#6b7280' }}>Dashboard content coming soon...</p>
              </div>
            </div>
          )
        )}

        {activeTab === 'storage' && <StorageTab />}

        {activeTab === 'classroom' && (
          user.role === 'teacher' ? (
            <TeacherClassroomTab
              navigationIntent={classroomNavigationIntent}
              onNavigationIntentConsumed={() => setClassroomNavigationIntent(null)}
            />
          ) : user.role === 'student' ? (
            <StudentClassroomTab
              navigationIntent={classroomNavigationIntent}
              onNavigationIntentConsumed={() => setClassroomNavigationIntent(null)}
            />
          ) : (
            <div className="content-placeholder">
              <i className="fas fa-chalkboard" style={{ fontSize: '4rem', color: '#d1d5db', marginBottom: '1rem' }}></i>
              <p style={{ color: '#6b7280' }}>Classroom content coming soon...</p>
            </div>
          )
        )}
      </main>

      {/* User Profile Modal */}
      <UserProfile 
        isOpen={showProfile} 
        onClose={() => setShowProfile(false)} 
      />

      <ConfirmDialog
        isOpen={logoutConfirmOpen}
        title="Confirm Logout"
        message="Are you sure you want to log out?"
        onCancel={() => setLogoutConfirmOpen(false)}
        onConfirm={() => {
          void executeLogout();
        }}
        isConfirming={isLoggingOut}
        confirmText="Confirm"
        confirmingText="Confirming..."
      />

      <ConfirmDialog
        isOpen={backConfirmOpen}
        title="Leave Dashboard"
        message="Go back and log out from this account? You will need to log in again to access dashboard."
        onCancel={() => setBackConfirmOpen(false)}
        onConfirm={() => {
          void executeLogout();
        }}
        isConfirming={isLoggingOut}
        confirmText="Confirm"
        confirmingText="Confirming..."
      />
    </div>
  );
}

export default Dashboard;