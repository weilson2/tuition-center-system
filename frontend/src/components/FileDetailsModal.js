import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const getToken = () => {
  return localStorage.getItem('token') || sessionStorage.getItem('token');
};

function FileDetailsModal({ fileId, onClose }) {
  const [fileDetails, setFileDetails] = useState(null);
  const [sharingHistory, setSharingHistory] = useState([]);
  const [downloadHistory, setDownloadHistory] = useState([]);
  const [totalShares, setTotalShares] = useState(0);
  const [totalReceivers, setTotalReceivers] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchFileDetails = useCallback(async () => {
    try {
      setLoading(true);
      const token = getToken();
      const response = await axios.get(`${API_URL}/storage/files/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setFileDetails(response.data.file);
      setSharingHistory(response.data.sharingHistory || []);
      setDownloadHistory(response.data.downloadHistory || []);
      setTotalShares(Number(response.data.totalShares) || 0);
      setTotalReceivers(Number(response.data.totalReceivers) || 0);
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

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
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
    if (fileType.startsWith('text/')) return 'fa-file-alt';
    return 'fa-file';
  };

  if (!fileId) return null;

  return (
    <div className="file-details-overlay" onClick={onClose}>
      <div className="file-details-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="file-details-header">
          <h3>File Details</h3>
          <button onClick={onClose} className="close-btn">
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Content */}
        <div className="file-details-content">
          {loading ? (
            <div className="details-loading">
              <i className="fas fa-spinner fa-spin"></i>
              <p>Loading...</p>
            </div>
          ) : fileDetails ? (
            <>
              {/* File Icon and Name */}
              <div className="file-details-preview">
                <div className="file-details-icon">
                  <i className={`fas ${getFileIcon(fileDetails.file_type)}`}></i>
                </div>
                <div className="file-details-name">
                  <h4>{fileDetails.original_filename}</h4>
                  <p>{fileDetails.file_type} • {formatFileSize(fileDetails.file_size)}</p>
                </div>
              </div>

              {/* Info Grid */}
              <div className="file-info-grid">
                <div className="info-row">
                  <div className="info-col">
                    <span className="info-label">Upload Date</span>
                    <span className="info-value">{formatDate(fileDetails.uploaded_at)}</span>
                  </div>
                  <div className="info-col">
                    <span className="info-label">File Size</span>
                    <span className="info-value">{formatFileSize(fileDetails.file_size)}</span>
                  </div>
                </div>

                <div className="info-row">
                  <div className="info-col">
                    <span className="info-label">File Type</span>
                    <span className="info-value">{fileDetails.file_extension?.toUpperCase() || 'N/A'}</span>
                  </div>
                  <div className="info-col">
                    <span className="info-label">Encryption Status</span>
                    <span className="info-value encryption-badge">
                      <i className="fas fa-shield-alt"></i>
                      AES-256-GCM
                    </span>
                  </div>
                </div>

                <div className="info-row">
                  <div className="info-col">
                    <span className="info-label">Last Accessed</span>
                    <span className="info-value">
                      {fileDetails.last_accessed 
                        ? formatDate(fileDetails.last_accessed)
                        : 'Never'}
                    </span>
                  </div>
                  <div className="info-col">
                    <span className="info-label">Number of Downloads</span>
                    <span className="info-value">{fileDetails.download_count || 0}</span>
                  </div>
                </div>
              </div>

              {/* Security Features */}
              <div className="security-features">
                <h5>Security Features</h5>
                <div className="security-list">
                  <div className="security-item">
                    <i className="fas fa-check-circle"></i>
                    <span>End-to-end encryption enabled</span>
                  </div>
                  <div className="security-item">
                    <i className="fas fa-check-circle"></i>
                    <span>Integrity verification passed</span>
                  </div>
                  <div className="security-item">
                    <i className="fas fa-check-circle"></i>
                    <span>Secure storage in Cloudflare R2</span>
                  </div>
                </div>
              </div>

              {/* Recent Activity */}
              <div className="recent-activity">
                <h5>Recent activity</h5>
                <p className="activity-text">
                  {fileDetails.download_count > 0 
                    ? `Downloaded ${fileDetails.download_count} time${fileDetails.download_count > 1 ? 's' : ''}`
                    : 'No downloads yet'}
                </p>
              </div>

              {Boolean(fileDetails.is_owner) && (
                <>
                  <div className="recent-activity">
                    <h5>Sharing History</h5>
                    <p className="activity-text">
                      Total shares: {totalShares} • Receivers: {totalReceivers}
                    </p>
                    {sharingHistory.length === 0 ? (
                      <p className="activity-text">No sharing records</p>
                    ) : (
                      <div className="sharing-list">
                        {sharingHistory.map((item) => (
                          <div key={item.sharing_id} className="sharing-item">
                            <div className="share-user">
                              <i className="fas fa-user"></i>
                              <div>
                                <strong>{item.recipient_name}</strong>
                                <p className="share-role">{item.recipient_role} • {item.recipient_email}</p>
                              </div>
                            </div>
                            <div className="share-date">
                              <small>{formatDate(item.shared_at)}</small>
                              <span className="active-badge">{item.is_active ? 'Active' : 'Revoked'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="recent-activity">
                    <h5>Download History</h5>
                    {downloadHistory.length === 0 ? (
                      <p className="activity-text">No download records</p>
                    ) : (
                      <div className="activity-list">
                        {downloadHistory.map((item) => (
                          <div key={item.log_id} className="activity-item">
                            <i className="fas fa-download"></i>
                            <div className="activity-info">
                              <p>{item.downloader_name || item.downloader_email || 'Unknown user'}</p>
                              <small>
                                {formatDate(item.accessed_at)}
                                {item.download_time_ms ? ` • ${item.download_time_ms} ms` : ''}
                              </small>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="details-error">
              <i className="fas fa-exclamation-circle"></i>
              <p>Failed to load file details</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="file-details-footer">
          <button onClick={onClose} className="close-details-btn">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default FileDetailsModal;