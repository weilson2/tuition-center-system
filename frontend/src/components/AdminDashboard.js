import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';
import { storage } from '../utils/storage';
import AuditLogsTab from './AuditLogsTab';
import UserManagementTab from './UserManagementTab';
import ClassroomAuditLogsTab from './ClassroomAuditLogsTab';
import ConfirmDialog from './ConfirmDialog';
import '../styles/AdminDashboard.css';

function AdminDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('storage');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [backConfirmOpen, setBackConfirmOpen] = useState(false);

  const loadUserData = useCallback(async () => {
    try {
      const storedUser = storage.getItem('user');
      if (storedUser) {
        const userData = JSON.parse(storedUser);
        
        // Check if user is actually an admin
        if (userData.role !== 'admin') {
          storage.clearAuth();
          navigate('/login');
          return;
        }
        
        setUser(userData);
      } else {
        navigate('/admin/login');
      }
      setLoading(false);
    } catch (error) {
      console.error('Error loading user:', error);
      navigate('/admin/login');
    }
  }, [navigate]);

  useEffect(() => {
    void loadUserData();
  }, [loadUserData]);

  const executeLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    try {
      setIsLoggingOut(true);
      await authAPI.logout();
      storage.clearAuth();
      navigate('/admin/login', { replace: true });
    } catch (error) {
      console.error('Logout error:', error);
      storage.clearAuth();
      navigate('/admin/login', { replace: true });
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

      window.history.pushState({ adminDashboardGuard: true }, '', window.location.href);
      setBackConfirmOpen(true);
    };

    window.history.pushState({ adminDashboardGuard: true }, '', window.location.href);
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
      <div className="admin-loading">
        <i className="fas fa-spinner fa-spin"></i>
        <p>Loading Admin Panel...</p>
      </div>
    );
  }

  if (!user) {
    navigate('/admin/login');
    return null;
  }

  return (
    <div className="admin-dashboard">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <i className="fas fa-user-shield"></i>
          <h2>Admin Panel</h2>
        </div>
        
        <nav className="admin-nav">
          <button
            type="button"
            className={`admin-nav-item ${activeTab === 'storage' ? 'active' : ''}`}
            onClick={() => setActiveTab('storage')}
          >
            <i className="fas fa-database"></i>
            <span>Storage Logs</span>
          </button>
          <button
            type="button"
            className={`admin-nav-item ${activeTab === 'classroom' ? 'active' : ''}`}
            onClick={() => setActiveTab('classroom')}
          >
            <i className="fas fa-chalkboard"></i>
            <span>Classroom Logs</span>
          </button>
          <button
            type="button"
            className={`admin-nav-item ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            <i className="fas fa-users"></i>
            <span>User Management</span>
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="admin-main">
        {/* Top Bar */}
        <div className="admin-topbar">
          <h1>
            {activeTab === 'storage' && 'Storage System Audit Logs'}
            {activeTab === 'classroom' && 'Classroom Activity Logs'}
            {activeTab === 'users' && 'User Management'}
          </h1>
          <div className="admin-user-info">
            <span>{user.fullName}</span>
            <div className="admin-avatar">
              <i className="fas fa-user-shield"></i>
            </div>
            <button onClick={handleLogout} className="admin-logout-btn" disabled={isLoggingOut}>
              <i className={`fas ${isLoggingOut ? 'fa-spinner fa-spin' : 'fa-sign-out-alt'}`}></i>
              <span>{isLoggingOut ? 'Logging out...' : 'Logout'}</span>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="admin-content">
          {activeTab === 'storage' && <AuditLogsTab />}
          
          {activeTab === 'classroom' && <ClassroomAuditLogsTab />}
          
          {activeTab === 'users' && (
            <UserManagementTab currentUser={user} />
          )}
        </div>

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
          title="Leave Admin Dashboard"
          message="Go back and log out from admin account? You will need to log in again to access admin dashboard."
          onCancel={() => setBackConfirmOpen(false)}
          onConfirm={() => {
            void executeLogout();
          }}
          isConfirming={isLoggingOut}
          confirmText="Confirm"
          confirmingText="Confirming..."
        />
      </main>
    </div>
  );
}

export default AdminDashboard;