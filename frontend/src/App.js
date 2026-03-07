import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import AdminLogin from './components/AdminLogin';
import Dashboard from './components/Dashboard';
import AdminDashboard from './components/AdminDashboard';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import { storage } from './utils/storage';

// Protected Route Component for Student/Teacher
function UserProtectedRoute({ children }) {
  const user = JSON.parse(storage.getItem('user') || 'null');
  const token = storage.getItem('token');

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === 'admin') {
    return <Navigate to="/admin/dashboard" replace />;
  }

  if (user.role !== 'student' && user.role !== 'teacher') {
    return <Navigate to="/login" replace />;
  }

  return children;
}

// Protected Route Component for Admin
function AdminProtectedRoute({ children }) {
  const user = JSON.parse(storage.getItem('user') || 'null');
  const token = storage.getItem('token');

  if (!token || !user) {
    return <Navigate to="/admin/login" replace />;
  }

  if (user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

// Auto-redirect based on stored credentials
function RootRedirect() {
  const user = JSON.parse(storage.getItem('user') || 'null');
  const token = storage.getItem('token');

  if (token && user) {
    if (user.role === 'admin') {
      return <Navigate to="/admin/dashboard" replace />;
    } else {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <Navigate to="/login" replace />;
}

function App() {
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const token = storage.getItem('token');
      const user = storage.getItem('user');
      const rememberMe = storage.isRememberMe();

      if (token && user) {
        console.log('✅ Found existing session');
        console.log('Remember Me:', rememberMe);
      } else {
        console.log('❌ No session found');
      }

      setIsCheckingAuth(false);
    };

    checkAuth();
  }, []);

  if (isCheckingAuth) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <i className="fas fa-spinner fa-spin" style={{ fontSize: '3rem', color: '#2563eb' }}></i>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route 
          path="/dashboard" 
          element={
            <UserProtectedRoute>
              <Dashboard />
            </UserProtectedRoute>
          } 
        />
        <Route 
          path="/admin/dashboard" 
          element={
            <AdminProtectedRoute>
              <AdminDashboard />
            </AdminProtectedRoute>
          } 
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;