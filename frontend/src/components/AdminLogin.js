import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';
import '../styles/AdminLogin.css';

function AdminLogin() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent default behavior
    
    setError('');
    setLoading(true);

    try {
      const response = await authAPI.login(
        formData.email,
        formData.password,
        'admin',
        false
      );

      // Admin always uses session storage (no Remember Me for admin)
sessionStorage.setItem('token', response.token);
sessionStorage.setItem('user', JSON.stringify(response.user));

// Clear any existing localStorage
localStorage.removeItem('token');
localStorage.removeItem('user');
localStorage.removeItem('rememberMe');


// Navigate to admin dashboard
navigate('/admin/dashboard', { replace: true });

    } catch (err) {
      // Error handling - DON'T navigate
      console.error('Admin login error:', err);
      
      const errorData = err.response?.data;
      let errorMessage = '';
      
      if (errorData?.accountLocked) {
        errorMessage = errorData.error || 'Account is temporarily locked. Please try again later.';
        setFormData(prev => ({ ...prev, password: '' }));
      } else if (errorData?.attemptsRemaining !== undefined) {
        errorMessage = `${errorData.error || 'Invalid credentials'}. ${errorData.attemptsRemaining} attempt${errorData.attemptsRemaining !== 1 ? 's' : ''} remaining.`;
      } else if (err.response?.status === 401) {
        errorMessage = errorData?.error || 'Invalid admin credentials';
      } else if (err.response?.status === 403) {
        errorMessage = errorData?.error || 'Access forbidden';
      } else if (err.response?.status === 429) {
        errorMessage = 'Too many attempts. Please try again later.';
      } else {
        errorMessage = 'Login failed. Please try again.';
      }
      
      setError(errorMessage);
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    
    // Clear error when user starts typing
    if (error) {
      setError('');
    }
    
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  return (
    <div className="admin-login-container">
      <div className="admin-login-wrapper">
        <div className="admin-login-box">
          {/* Header */}
          <div className="admin-header">
            <div className="admin-icon">
              <i className="fas fa-user-shield"></i>
            </div>
            <h2>Admin Portal</h2>
            <p>Secure administrative access</p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="admin-form">
            {error && (
              <div className="admin-error">
                <i className="fas fa-exclamation-circle"></i>
                <span>{error}</span>
              </div>
            )}

            {/* Email Input */}
            <div className="admin-form-group">
              <label>Admin Email</label>
              <div className="admin-input-wrapper">
                <i className="fas fa-envelope"></i>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="admin@tuition.com"
                  required
                  disabled={loading}
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="admin-form-group">
              <label>Password</label>
              <div className="admin-input-wrapper">
                <i className="fas fa-lock"></i>
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Enter admin password"
                  required
                  disabled={loading}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="admin-password-toggle"
                  tabIndex="-1"
                >
                  <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
            </div>

            {/* Login Button */}
            <button type="submit" className="admin-login-btn" disabled={loading}>
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Signing In...
                </>
              ) : (
                <>
                  <i className="fas fa-arrow-right"></i>
                  Continue
                </>
              )}
            </button>
          </form>

          {/* Security Notice */}
          <div className="admin-security-notice">
            <i className="fas fa-exclamation-triangle"></i>
            <span>Admin access is monitored. Unauthorized access attempts will be logged and reported.</span>
          </div>

          {/* Back to User Login */}
          <div className="admin-back-link">
            <button 
              onClick={() => navigate('/login')} 
              className="back-btn"
              type="button"
            >
              <i className="fas fa-arrow-left"></i>
              Back to User Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminLogin;
