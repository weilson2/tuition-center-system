import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';
import '../styles/Login.css';

function Login() {
  const navigate = useNavigate();
  const [selectedRole, setSelectedRole] = useState('student');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent any default behavior

    setError('');
    setLoading(true);

    try {
      const response = await authAPI.login(
        formData.email,
        formData.password,
        selectedRole,
        formData.rememberMe
      );

      // Save based on Remember Me choice
      if (formData.rememberMe) {
        // Persistent storage - use localStorage (lasts forever)
        localStorage.setItem('token', response.token);
        localStorage.setItem('user', JSON.stringify(response.user));
        localStorage.setItem('rememberMe', 'true');
        console.log('✅ Saved to localStorage (persistent)');
      } else {
        // Session storage - use sessionStorage (deleted when browser closes)
        sessionStorage.setItem('token', response.token);
        sessionStorage.setItem('user', JSON.stringify(response.user));
        sessionStorage.setItem('rememberMe', 'false');

        // Clear any existing localStorage
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('rememberMe');
        console.log('✅ Saved to sessionStorage (session only)');
      }

      // Navigate to dashboard
      navigate('/dashboard', { replace: true });

    } catch (err) {
      // Error handling - DON'T navigate anywhere
      console.error('Login error:', err);

      const errorData = err.response?.data;
      let errorMessage = '';

      if (errorData?.accountLocked) {
        errorMessage = errorData.error || 'Account is temporarily locked. Please try again later.';
        // Clear password on lock
        setFormData(prev => ({ ...prev, password: '' }));
      } else if (errorData?.attemptsRemaining !== undefined) {
        errorMessage = `${errorData.error || 'Invalid credentials'}. ${errorData.attemptsRemaining} attempt${errorData.attemptsRemaining !== 1 ? 's' : ''} remaining.`;
      } else if (err.response?.status === 401) {
        errorMessage = errorData?.error || 'Invalid email or password';
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
    const { name, value, type, checked } = e.target;

    // Clear error when user starts typing
    if (error) {
      setError('');
    }

    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  return (
    <div className={`login-container ${selectedRole === 'teacher' ? 'theme-teacher' : 'theme-student'}`}>
      {/* Left Side - Branding */}
      <div className="login-branding">
        <div className="branding-content">
          <h1 className="branding-title">
            <i className="fas fa-graduation-cap"></i>
            Tuition Center
          </h1>
          <p className="branding-subtitle">
            Secure Cloud Storage with File Sharing & Classroom Management Platform
          </p>
        </div>

        <div className="features">
          <div className="feature">
            <div className="feature-icon">
              <i className="fas fa-lock"></i>
            </div>
            <div>
              <h3>End-to-End Encryption</h3>
              <p>Your files are protected with AES-256-GCM encryption</p>
            </div>
          </div>

          <div className="feature">
            <div className="feature-icon">
              <i className="fas fa-users"></i>
            </div>
            <div>
              <h3>Easy Collaboration</h3>
              <p>Share files securely with teachers and students</p>
            </div>
          </div>

          <div className="feature">
            <div className="feature-icon">
              <i className="fas fa-cloud"></i>
            </div>
            <div>
              <h3>Cloud Storage</h3>
              <p>Access your files anywhere, anytime</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="login-form-container">
        <div className="login-form-wrapper">
          <div className="login-header">
            <h2>Welcome Back</h2>
            <p>Sign in to your account to continue</p>
          </div>

          {/* Role Selector */}
          <div className="role-selector">
            <button
              type="button"
              onClick={() => {
                setSelectedRole('student');
                setError('');
              }}
              className={`role-btn ${selectedRole === 'student' ? 'active' : ''}`}
            >
              <i className="fas fa-user-graduate"></i>
              Student
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedRole('teacher');
                setError('');
              }}
              className={`role-btn ${selectedRole === 'teacher' ? 'active' : ''}`}
            >
              <i className="fas fa-chalkboard-teacher"></i>
              Teacher
            </button>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="login-form">
            {error && (
              <div className="error-message">
                <i className="fas fa-exclamation-circle"></i>
                <span>{error}</span>
              </div>
            )}

            {/* Email Input */}
            <div className="form-group">
              <label>Email Address</label>
              <div className="input-wrapper">
                <i className="fas fa-envelope input-icon"></i>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="Enter your email"
                  required
                  disabled={loading}
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="form-group">
              <label>Password</label>
              <div className="input-wrapper">
                <i className="fas fa-lock input-icon"></i>
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Enter your password"
                  required
                  disabled={loading}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="password-toggle"
                  tabIndex="-1"
                >
                  <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
            </div>

            {/* Remember Me & Forgot Password */}
            <div className="form-options">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="rememberMe"
                  checked={formData.rememberMe}
                  onChange={handleChange}
                  disabled={loading}
                />
                <span>Remember me</span>
              </label>
              <button
                type="button"
                className="forgot-password"
                onClick={() => navigate('/forgot-password')}
              >
                Forgot Password?
              </button>
            </div>

            {/* Login Button */}
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Signing In...
                </>
              ) : (
                <>
                  <i className="fas fa-sign-in-alt"></i>
                  Sign In
                </>
              )}
            </button>
          </form>

          {/* Admin Login Link */}
          <div className="admin-login-link">
            <button
              onClick={() => navigate('/admin/login')}
              className="admin-link-btn"
              type="button"
            >
              Admin? <span className="highlight">Click here to login</span>
            </button>
          </div>

          {/* Rate Limit Warning */}
          <div className="rate-limit-notice">
            <i className="fas fa-shield-alt"></i>
            <span>Maximum 5 login attempts per 15 minutes per account</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
