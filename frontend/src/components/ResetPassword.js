import React, { useCallback, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import '../styles/ResetPassword.css';

function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [formData, setFormData] = useState({
    newPassword: '',
    confirmPassword: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [email, setEmail] = useState('');

  const verifyToken = useCallback(async () => {
    if (!token) {
      setError('Invalid reset link. No token provided.');
      setVerifying(false);
      return;
    }

    try {
      const response = await api.get(`/password-reset/verify/${token}`);
      setTokenValid(response.data.valid);
      setEmail(response.data.email);
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid or expired reset link.');
      setTokenValid(false);
    } finally {
      setVerifying(false);
    }
  }, [token]);

  useEffect(() => {
    void verifyToken();
  }, [verifyToken]);

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

  const strength = getPasswordStrength(formData.newPassword);
  const strengthInfo = getStrengthLabel(strength);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (formData.newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])/.test(formData.newPassword)) {
      setError('Password must contain uppercase, lowercase, number, and special character');
      return;
    }

    setLoading(true);

    try {
      await api.post('/password-reset/reset', {
        token,
        newPassword: formData.newPassword
      });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (error) setError('');
  };

  if (verifying) {
    return (
      <div className="reset-password-container">
        <div className="loading-state">
          <i className="fas fa-spinner fa-spin"></i>
          <p>Verifying reset link...</p>
        </div>
      </div>
    );
  }

  if (!tokenValid) {
    return (
      <div className="reset-password-container">
        <div className="error-state">
          <i className="fas fa-times-circle"></i>
          <h2>Invalid Reset Link</h2>
          <p>{error}</p>
          <button onClick={() => navigate('/forgot-password')} className="retry-btn">
            Request New Reset Link
          </button>
          <button onClick={() => navigate('/login')} className="back-btn-alt">
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="reset-password-container">
        <div className="success-state">
          <i className="fas fa-check-circle"></i>
          <h2>Password Reset Successful!</h2>
          <p>Your password has been changed successfully.</p>
          <p className="redirect-notice">Redirecting to login page...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="reset-password-container">
      <div className="reset-password-wrapper">
        <div className="reset-password-box">
          <div className="reset-header">
            <div className="reset-icon">
              <i className="fas fa-lock"></i>
            </div>
            <h2>Reset Password</h2>
            <p className="reset-email">for {email}</p>
          </div>

          <form onSubmit={handleSubmit} className="reset-form">
            {error && (
              <div className="reset-error">
                <i className="fas fa-exclamation-circle"></i>
                <span>{error}</span>
              </div>
            )}

            {/* New Password */}
            <div className="form-group">
              <label>New Password</label>
              <div className="input-wrapper">
                <i className="fas fa-lock"></i>
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="newPassword"
                  value={formData.newPassword}
                  onChange={handleChange}
                  placeholder="Enter new password"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="password-toggle"
                >
                  <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>

              {/* Password Strength Indicator */}
              {formData.newPassword && (
                <div className="password-strength">
                  <div className="strength-bar">
                    <div 
                      className="strength-fill" 
                      style={{ 
                        width: `${(strength / 5) * 100}%`,
                        background: strengthInfo.color
                      }}
                    ></div>
                  </div>
                  <span className="strength-label" style={{ color: strengthInfo.color }}>
                    {strengthInfo.label}
                  </span>
                </div>
              )}

              <p className="password-requirements">
                Must contain: 8+ characters, uppercase, lowercase, number, special character
              </p>
            </div>

            {/* Confirm Password */}
            <div className="form-group">
              <label>Confirm Password</label>
              <div className="input-wrapper">
                <i className="fas fa-lock"></i>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="Confirm new password"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="password-toggle"
                >
                  <i className={`fas ${showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>

              {/* Password Match Indicator */}
              {formData.confirmPassword && (
                <p className={`password-match ${formData.newPassword === formData.confirmPassword ? 'match' : 'no-match'}`}>
                  {formData.newPassword === formData.confirmPassword ? (
                    <><i className="fas fa-check"></i> Passwords match</>
                  ) : (
                    <><i className="fas fa-times"></i> Passwords do not match</>
                  )}
                </p>
              )}
            </div>

            <button type="submit" className="reset-submit-btn" disabled={loading}>
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Resetting Password...
                </>
              ) : (
                <>
                  <i className="fas fa-check"></i>
                  Reset Password
                </>
              )}
            </button>
          </form>

          <div className="back-to-login">
            <button onClick={() => navigate('/login')} className="back-btn">
              <i className="fas fa-arrow-left"></i>
              Back to Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ResetPassword;