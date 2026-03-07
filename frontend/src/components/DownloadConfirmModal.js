import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const getToken = () => {
  return localStorage.getItem('token') || sessionStorage.getItem('token');
};


function DownloadConfirmModal({ fileId, onClose, onConfirm }) {
  const [fileDetails, setFileDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchFileDetails = useCallback(async () => {
    try {
      setLoading(true);
      const token = getToken();
      const response = await axios.get(`${API_URL}/storage/files/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setFileDetails(response.data.file);
      setLoading(false);
    } catch (error) {
      console.error('Fetch file details error:', error);
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    if (fileId) {
      void fetchFileDetails();
    }
  }, [fileId, fetchFileDetails]);

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
    if (fileType.includes('powerpoint')) return 'fa-file-powerpoint';
    return 'fa-file';
  };

  if (!fileId) return null;

  return (
    <div className="download-confirm-overlay" onClick={onClose}>
      <div className="download-confirm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="download-header">
          <h3>Download File</h3>
          <button onClick={onClose} className="close-btn">
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Content */}
        <div className="download-content">
          {loading ? (
            <div className="download-loading">
              <i className="fas fa-spinner fa-spin"></i>
              <p>Loading...</p>
            </div>
          ) : fileDetails ? (
            <>
              {/* File Preview */}
              <div className="download-file-preview">
                <div className="file-icon-preview">
                  <i className={`fas ${getFileIcon(fileDetails.file_type)}`}></i>
                </div>
                <div className="file-info-preview">
                  <h4>{fileDetails.original_filename}</h4>
                  <p className="file-size-preview">{formatFileSize(fileDetails.file_size)} • {fileDetails.file_extension?.toUpperCase() || 'FILE'}</p>
                </div>
              </div>

              {/* Download Stats */}
      
              <div className="download-stats">
                <div className="stat-item">
                  <span className="stat-label">Last Accessed:</span>
                  <span className="stat-value">
                    {fileDetails.last_accessed
                      ? new Date(fileDetails.last_accessed).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })
                      : 'Never'}
                  </span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Number of Downloads:</span>
                  <span className="stat-value">{fileDetails.download_count || 0}</span>
                </div>
              </div>

              {/* Security Notice */}
              <div className="security-notice">
                <i className="fas fa-shield-alt"></i>
                <div>
                  <strong>Secure Download</strong>
                  <p>This file is encrypted and will be verified before download</p>
                </div>
              </div>
            </>
          ) : (
            <div className="download-error">
              <i className="fas fa-exclamation-circle"></i>
              <p>Failed to load file information</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="download-footer">
          <button onClick={onClose} className="cancel-download-btn">
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm(fileDetails.file_id, fileDetails.original_filename);
              onClose();
            }}
            className="confirm-download-btn"
            disabled={!fileDetails}
          >
            <i className="fas fa-download"></i>
            Download
          </button>
        </div>
      </div>
    </div>
  );
}

export default DownloadConfirmModal;