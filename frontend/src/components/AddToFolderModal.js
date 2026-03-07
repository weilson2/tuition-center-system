import React, { useState } from 'react';

function AddToFolderModal({ folders, selectedFiles, onClose, onConfirm }) {
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [adding, setAdding] = useState(false);

  const handleConfirm = async () => {
    if (!selectedFolderId) {
      alert('Please select a folder');
      return;
    }

    setAdding(true);
    await onConfirm(selectedFolderId, selectedFiles);
    setAdding(false);
    onClose();
  };

  return (
    <div className="add-folder-overlay" onClick={() => !adding && onClose()}>
      <div className="add-folder-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="add-folder-header">
          <h3>Add to Folders</h3>
          <button onClick={onClose} className="close-btn" disabled={adding}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Subtitle */}
        <div className="add-folder-subtitle">
          <p>Select folders for this file</p>
        </div>

        {/* Content */}
        <div className="add-folder-content">
          {/* Folder List */}
          <div className="folder-selection-list">
            {folders.filter(f => !f.is_system_folder).length === 0 ? (
              <div className="no-folders-message">
                <i className="fas fa-folder-open"></i>
                <p>No folders available</p>
                <small>Create a folder first</small>
              </div>
            ) : (
              folders.filter(f => !f.is_system_folder).map(folder => (
                <div
                  key={folder.folder_id}
                  className={`folder-selection-item ${selectedFolderId === folder.folder_id ? 'selected' : ''}`}
                  onClick={() => setSelectedFolderId(folder.folder_id)}
                >
                  <div className="folder-checkbox">
                    <input
                      type="radio"
                      name="folder"
                      checked={selectedFolderId === folder.folder_id}
                      onChange={() => setSelectedFolderId(folder.folder_id)}
                    />
                  </div>
                  <div className="folder-icon-wrapper">
                    <i className="fas fa-folder"></i>
                  </div>
                  <div className="folder-selection-info">
                    <span className="folder-selection-name">{folder.folder_name}</span>
                    <span className="folder-selection-count">{folder.file_count} files</span>
                  </div>
                  {selectedFolderId === folder.folder_id && (
                    <div className="folder-selected-check">
                      <i className="fas fa-check-circle"></i>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="add-folder-footer">
          <button 
            onClick={onClose} 
            className="cancel-folder-btn"
            disabled={adding}
          >
            Cancel
          </button>
          <button 
            onClick={handleConfirm}
            className="save-folder-btn"
            disabled={!selectedFolderId || adding}
          >
            {adding ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                Adding...
              </>
            ) : (
              <>
                <i className="fas fa-check"></i>
                Save
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddToFolderModal;