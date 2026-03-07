import React, { useState } from 'react';

function CreateFolderModal({ onClose, onConfirm }) {
  const [folderName, setFolderName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!folderName.trim()) {
      return;
    }

    setCreating(true);
    await onConfirm(folderName.trim());
    setCreating(false);
  };

  return (
    <div className="create-folder-overlay" onClick={() => !creating && onClose()}>
      <div className="create-folder-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="create-folder-header">
          <div className="folder-icon-large">
            <i className="fas fa-folder-plus"></i>
          </div>
          <h3>Create New Folder</h3>
          <button onClick={onClose} className="close-btn" disabled={creating}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="create-folder-content">
          <div className="form-group">
            <label htmlFor="folderName">Folder Name</label>
            <input
              id="folderName"
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Enter folder name"
              autoFocus
              maxLength={50}
              disabled={creating}
            />
            <small className="char-count">{folderName.length}/50 characters</small>
          </div>

          {/* Footer */}
          <div className="create-folder-footer">
            <button
              type="button"
              onClick={onClose}
              className="cancel-create-btn"
              disabled={creating}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="confirm-create-btn"
              disabled={!folderName.trim() || creating}
            >
              {creating ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Creating...
                </>
              ) : (
                <>
                  <i className="fas fa-check"></i>
                  Create Folder
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateFolderModal;