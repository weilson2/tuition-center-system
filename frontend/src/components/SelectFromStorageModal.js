import React, { useState, useEffect } from 'react';
import api from '../services/api';
import '../styles/Storage.css';

export default function SelectFromStorageModal({ onClose, onSelect }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchFiles = async () => {
      try {
        const response = await api.get('/storage/files');
        setFiles(response.data.files || []);
        setError(null);
      } catch (err) {
        setError('Failed to load files from storage.');
      } finally {
        setLoading(false);
      }
    };
    fetchFiles();
  }, []);

  const formatFileSize = (bytes) => {
    if (bytes === null || bytes === undefined) return '-';
    const numBytes = Number(bytes);
    if (numBytes < 1024 * 1024) return `${(numBytes / 1024).toFixed(2)} KB`;
    return `${(numBytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getFileIcon = (fileType = '') => {
    if (fileType.startsWith('image/')) return 'fa-file-image';
    if (fileType === 'application/pdf') return 'fa-file-pdf';
    return 'fa-file';
  };

  return (
    <div className="upload-modal-overlay" style={{ zIndex: 10000 }}>
      <div className="upload-modal" style={{ maxWidth: '600px', width: '90%' }}>
        <div className="upload-modal-header">
          <h3>Select from Storage</h3>
          <button className="close-btn" onClick={onClose}><i className="fas fa-times"></i></button>
        </div>
        
        <div className="upload-modal-content" style={{ maxHeight: '60vh', overflowY: 'auto', padding: '20px' }}>
          {loading && <div style={{ padding: '20px', textAlign: 'center' }}><i className="fas fa-spinner fa-spin"></i> Loading...</div>}
          {error && <div style={{ color: 'red', padding: '20px', textAlign: 'center' }}>{error}</div>}
          
          {!loading && !error && files.length === 0 && (
             <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>No files found in your storage.</div>
          )}

          {!loading && !error && files.length > 0 && (
            <div className="file-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '15px' }}>
              {files.map(file => (
                <div 
                  key={file.file_id} 
                  className="file-card"
                  style={{ cursor: 'pointer', padding: '15px', border: '1px solid #ddd', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', transition: 'border-color 0.2s' }}
                  onClick={() => onSelect({
                    fileId: file.file_id,
                    fileName: file.original_filename,
                    size: file.file_size
                  })}
                  onMouseOver={(e) => e.currentTarget.style.borderColor = '#007bff'}
                  onMouseOut={(e) => e.currentTarget.style.borderColor = '#ddd'}
                >
                  <i className={`fas ${getFileIcon(file.file_type)}`} style={{ fontSize: '24px', marginBottom: '10px', color: '#555' }}></i>
                  <span style={{ textAlign: 'center', wordBreak: 'break-word', fontSize: '14px', fontWeight: '500' }}>
                    {file.original_filename}
                  </span>
                  <span style={{ fontSize: '12px', color: '#888', marginTop: '5px' }}>
                    {formatFileSize(file.file_size)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="upload-modal-footer">
          <button className="cancel-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
