import React, { useEffect } from 'react';
import '../styles/Toast.css';

function Toast({ message, type = 'success', onClose, duration = 3000 }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const getIcon = () => {
    switch (type) {
      case 'success':
        return 'fa-check-circle';
      case 'error':
        return 'fa-exclamation-circle';
      case 'info':
        return 'fa-info-circle';
      case 'warning':
        return 'fa-exclamation-triangle';
      default:
        return 'fa-info-circle';
    }
  };

  return (
    <div className={`toast toast-${type}`}>
      <i className={`fas ${getIcon()}`}></i>
      <span>{message}</span>
      <button onClick={onClose} className="toast-close">
        <i className="fas fa-times"></i>
      </button>
    </div>
  );
}

export default Toast;