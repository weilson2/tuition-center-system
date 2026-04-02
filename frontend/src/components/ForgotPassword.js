import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import '../styles/ForgotPassword.css';

function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // 1: Email, 2: Success
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetData, setResetData] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/password-reset/request', { email });
      setResetData(response.data);
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send reset link. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="forgot-password-container">
      <div className="forgot-password-wrapper">
        <div className="forgot-password-box">
          {step === 1 ? (
            <>
              <div className="forgot-password-header">
                <div className="forgot-password-icon">
                  <i className="fas fa-key"></i>
                </div>
                <h2>Forgot Password?</h2>
                <p>No worries, we'll send you reset instructions</p>
              </div>

              <form onSubmit={handleSubmit} className="forgot-password-form">
                {error && (
                  <div className="forgot-error">
                    <i className="fas fa-exclamation-circle"></i>
                    <span>{error}</span>
                  </div>
                )}

                <div className="form-group">
                  <label>Email Address</label>
                  <div className="input-wrapper">
                    <i className="fas fa-envelope"></i>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your registered email"
                      required
                      disabled={loading}
                      autoFocus
                    />
                  </div>
                </div>

                <button type="submit" className="reset-btn" disabled={loading}>
                  {loading ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i>
                      Sending...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-paper-plane"></i>
                      Send Reset Link
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
            </>
          ) : (
            <>
              <div className="success-state">
                <div className="success-icon">
                  <i className="fas fa-check-circle"></i>
                </div>
                <h2>Check Your Email</h2>

                <div className="email-sent-notice">
                  <p className="email-message">
                    {resetData?.message}
                  </p>
                  <p className="email-sent-to">
                    We've sent a password reset link to<br />
                    <strong>{email}</strong>
                  </p>

                  <div className="info-box">
                    <i className="fas fa-info-circle"></i>
                    <p>The reset link will expire in 1 hour</p>
                  </div>

                  <div className="email-actions">
                    <p className="didnt-receive">Didn't receive the email?</p>
                    <button
                      onClick={() => setStep(1)}
                      className="resend-btn"
                    >
                      Try another email address
                    </button>
                  </div>
                </div>
              </div>

              <div className="back-to-login">
                <button onClick={() => navigate('/login')} className="back-btn">
                  <i className="fas fa-arrow-left"></i>
                  Back to Login
                </button>
              </div>
            </>
          )}

          <div className="rate-limit-notice">
            <i className="fas fa-shield-alt"></i>
            <span>Maximum 3 password reset requests per hour</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;
