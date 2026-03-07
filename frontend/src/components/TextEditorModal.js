import React, { useEffect, useState } from 'react';
import axios from 'axios';
import ConfirmDialog from './ConfirmDialog';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const getToken = () => {
  return localStorage.getItem('token') || sessionStorage.getItem('token');
};

function TextEditorModal({ fileId, onClose, onSaved }) {
  const [fileDetails, setFileDetails] = useState(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  useEffect(() => {
    if (fileId) {
      fetchFileContent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  useEffect(() => {
    setHasChanges(content !== originalContent);
  }, [content, originalContent]);

  const fetchFileContent = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = getToken();
      
      // Get file details
      const detailsResponse = await axios.get(`${API_URL}/storage/files/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setFileDetails(detailsResponse.data.file);
      
      // Fetch file content (decrypted)
      const contentResponse = await axios.get(`${API_URL}/storage/files/${fileId}/preview`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'text'
      });
      
      setContent(contentResponse.data);
      setOriginalContent(contentResponse.data);
      setLoading(false);
    } catch (error) {
      console.error('Fetch content error:', error);
      setError(error.response?.data?.error || 'Failed to load file');
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!hasChanges) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const token = getToken();
      
      await axios.put(
        `${API_URL}/storage/files/${fileId}/content`,
        { content },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setOriginalContent(content);
      setSaving(false);
      
      // Show success message and close after a moment
      if (onSaved) {
        onSaved('File saved successfully!');
      }
      
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (error) {
      console.error('Save error:', error);
      setError(error.response?.data?.error || 'Failed to save file');
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (hasChanges) {
      setCloseConfirmOpen(true);
      return;
    }
    onClose();
  };

  const getFileIcon = (fileType) => {
    if (fileType === 'text/plain') return 'fa-file-alt';
    if (fileType === 'text/markdown') return 'fa-file-code';
    return 'fa-file-code';
  };

  const getLanguageLabel = (filename) => {
    const ext = filename?.split('.').pop()?.toLowerCase();
    if (ext === 'txt') return 'Plain Text';
    if (ext === 'md') return 'Markdown';
    return 'Text';
  };

  if (!fileId) return null;

  return (
    <div className="text-editor-overlay" onClick={handleClose}>
      <div className="text-editor-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="editor-header">
          <div className="editor-file-info">
            {fileDetails && (
              <>
                <i className={`fas ${getFileIcon(fileDetails.file_type)}`}></i>
                <div className="editor-file-details">
                  <h3>{fileDetails.original_filename}</h3>
                  <div className="editor-meta">
                    <span className="file-type-badge">
                      {getLanguageLabel(fileDetails.original_filename)}
                    </span>
                    {hasChanges && <span className="unsaved-indicator">● Unsaved changes</span>}
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="editor-actions">
            <button 
              onClick={handleSave}
              className={`editor-save-btn ${hasChanges ? 'has-changes' : ''}`}
              disabled={!hasChanges || saving}
              title="Save (Ctrl+S)"
            >
              {saving ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Saving...
                </>
              ) : (
                <>
                  <i className="fas fa-save"></i>
                  Save
                </>
              )}
            </button>
            <button onClick={handleClose} className="editor-close-btn" title="Close">
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>

        {/* Editor Content */}
        <div className="editor-content">
          {loading ? (
            <div className="editor-loading">
              <i className="fas fa-spinner fa-spin"></i>
              <p>Loading file...</p>
              <small>Decrypting content...</small>
            </div>
          ) : error ? (
            <div className="editor-error">
              <i className="fas fa-exclamation-circle"></i>
              <p>{error}</p>
            </div>
          ) : (
            <div className="editor-wrapper">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="editor-textarea"
                placeholder="Start typing..."
                spellCheck="false"
                autoFocus
              />
              
              {/* Toolbar */}
              <div className="editor-toolbar">
                <div className="toolbar-info">
                  <span className="char-count">{content.length} characters</span>
                  <span className="line-count">{content.split('\n').length} lines</span>
                </div>
                <div className="toolbar-actions">
                  {hasChanges && (
                    <button 
                      onClick={() => setContent(originalContent)}
                      className="toolbar-btn"
                      title="Discard changes"
                    >
                      <i className="fas fa-undo"></i>
                      Discard Changes
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={closeConfirmOpen}
        title="Discard Unsaved Changes"
        message="You have unsaved changes. Are you sure you want to close?"
        onCancel={() => setCloseConfirmOpen(false)}
        onConfirm={() => {
          setCloseConfirmOpen(false);
          onClose();
        }}
        confirmText="Confirm"
        confirmingText="Confirming..."
      />
    </div>
  );
}

export default TextEditorModal;