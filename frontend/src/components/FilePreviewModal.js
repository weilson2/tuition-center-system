import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const getToken = () => {
  return localStorage.getItem('token') || sessionStorage.getItem('token');
};


function FilePreviewModal({ fileId, onClose, onDownload }) {
  const [fileDetails, setFileDetails] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [textContent, setTextContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (fileId) {
      fetchFilePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const fetchFilePreview = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = getToken();

      
      // Get file details
      const detailsResponse = await axios.get(`${API_URL}/storage/files/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setFileDetails(detailsResponse.data.file);
      
      // Check if file can be previewed
      const fileType = detailsResponse.data.file.file_type;
      const canPreview = 
        fileType.startsWith('image/') || 
        fileType === 'application/pdf' ||
        fileType.startsWith('text/') ||
        fileType === 'application/json' ||
        fileType === 'application/xml';
      
      if (canPreview) {
        // Fetch preview (decrypted file)
        const previewResponse = await axios.get(`${API_URL}/storage/files/${fileId}/preview`, {
          headers: { Authorization: `Bearer ${token}` },
          responseType: fileType.startsWith('text/') || fileType === 'application/json' || fileType === 'application/xml' ? 'text' : 'blob'
        });
        
        // For text files, store as text content
        if (fileType.startsWith('text/') || fileType === 'application/json' || fileType === 'application/xml') {
          setTextContent(previewResponse.data);
        } else {
          // For images and PDFs, create blob URL
          const blob = new Blob([previewResponse.data], { type: fileType });
          const url = window.URL.createObjectURL(blob);
          setPreviewUrl(url);
        }
      } else {
        setError('Preview not available for this file type');
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Preview error:', error);
      setError(error.response?.data?.error || 'Failed to load preview');
      setLoading(false);
    }
  };

  const getFileIcon = (fileType) => {
    if (!fileType) return 'fa-file';
    if (fileType.startsWith('image/')) return 'fa-file-image';
    if (fileType === 'application/pdf') return 'fa-file-pdf';
    if (fileType.startsWith('text/')) return 'fa-file-code';
    if (fileType === 'application/json') return 'fa-file-code';
    return 'fa-file';
  };

  const getLanguageFromFileType = (fileType, filename) => {
    if (fileType === 'text/html') return 'HTML';
    if (fileType === 'text/css') return 'CSS';
    if (fileType === 'text/javascript') return 'JavaScript';
    if (fileType === 'application/json') return 'JSON';
    if (fileType === 'application/xml') return 'XML';
    if (fileType === 'text/plain') {
      // Try to guess from extension
      const ext = filename?.split('.').pop()?.toLowerCase();
      if (ext === 'py') return 'Python';
      if (ext === 'java') return 'Java';
      if (ext === 'cpp' || ext === 'c') return 'C/C++';
      if (ext === 'js') return 'JavaScript';
      if (ext === 'jsx') return 'React';
      if (ext === 'ts') return 'TypeScript';
      if (ext === 'php') return 'PHP';
      if (ext === 'rb') return 'Ruby';
      if (ext === 'go') return 'Go';
      if (ext === 'rs') return 'Rust';
      if (ext === 'sql') return 'SQL';
      if (ext === 'sh') return 'Shell';
      return 'Text';
    }
    return 'Text';
  };

  const renderPreview = () => {
    if (loading) {
      return (
        <div className="preview-loading">
          <i className="fas fa-spinner fa-spin"></i>
          <p>Preparing preview...</p>
          <small>Decrypting file...</small>
        </div>
      );
    }

    if (error) {
      return (
        <div className="preview-error">
          <i className="fas fa-exclamation-circle"></i>
          <p>{error}</p>
          <button onClick={() => onDownload(fileId, fileDetails?.original_filename)} className="download-instead-btn">
            <i className="fas fa-download"></i>
            Download File Instead
          </button>
        </div>
      );
    }

    if (!fileDetails) {
      return null;
    }

    const fileType = fileDetails.file_type;

    // Image preview
    if (fileType.startsWith('image/') && previewUrl) {
      return (
        <div className="preview-image-container">
          <img 
            src={previewUrl} 
            alt={fileDetails.original_filename}
            className="preview-image"
          />
        </div>
      );
    }

    // PDF preview
    if (fileType === 'application/pdf' && previewUrl) {
      return (
        <div className="preview-pdf-container">
          <iframe
            src={previewUrl}
            title={fileDetails.original_filename}
            className="preview-pdf"
          />
        </div>
      );
    }

    // Text/Code file preview (using <pre> tag, not iframe)
    if (textContent !== null) {
      return (
        <div className="preview-code-container">
          <div className="code-header">
            <span className="code-language">
              {getLanguageFromFileType(fileType, fileDetails.original_filename)}
            </span>
            <span className="code-filename">{fileDetails.original_filename}</span>
          </div>
          <div className="code-content-wrapper">
            <pre className="code-content">
              <code>{textContent}</code>
            </pre>
          </div>
        </div>
      );
    }

    return null;
  };

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        window.URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  if (!fileId) return null;

  return (
    <div className="file-preview-overlay" onClick={onClose}>
      <div className="file-preview-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="preview-header">
          <div className="preview-file-info">
            {fileDetails && (
              <>
                <i className={`fas ${getFileIcon(fileDetails.file_type)}`}></i>
                <div className="preview-file-details">
                  <h3>{fileDetails.original_filename}</h3>
                  <p>{fileDetails.file_type}</p>
                </div>
              </>
            )}
          </div>
          <div className="preview-actions">
            {fileDetails && !error && (
              <button 
                onClick={() => onDownload(fileId, fileDetails.original_filename)}
                className="preview-download-btn"
                title="Download"
              >
                <i className="fas fa-download"></i>
              </button>
            )}
            <button onClick={onClose} className="preview-close-btn" title="Close">
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>

        {/* Preview Content */}
        <div className="preview-content">
          {renderPreview()}
        </div>
      </div>
    </div>
  );
}

export default FilePreviewModal;