import React, { useMemo, useState } from 'react';

function splitFilename(filename) {
  const safeName = String(filename || '').trim();
  const lastDot = safeName.lastIndexOf('.');

  if (lastDot <= 0 || lastDot === safeName.length - 1) {
    return {
      baseName: safeName,
      extension: ''
    };
  }

  return {
    baseName: safeName.slice(0, lastDot),
    extension: safeName.slice(lastDot)
  };
}

function RenameFileModal({ file, onClose, onConfirm }) {
  const parsed = useMemo(() => splitFilename(file?.original_filename), [file]);
  const [baseName, setBaseName] = useState(parsed.baseName || '');
  const [renaming, setRenaming] = useState(false);

  if (!file) {
    return null;
  }

  const trimmed = String(baseName || '').trim();

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!trimmed || renaming) {
      return;
    }

    try {
      setRenaming(true);
      await onConfirm(trimmed);
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div className="rename-file-overlay" onClick={() => !renaming && onClose()}>
      <div className="rename-file-modal" onClick={(event) => event.stopPropagation()}>
        <div className="rename-file-header">
              <div className="rename-file-icon">
                <i className="fas fa-pencil-alt"></i>
          </div>
          <h3>Rename File</h3>
          <button onClick={onClose} className="close-btn" disabled={renaming}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="rename-file-content">
          <div className="form-group">
            <label htmlFor="renameFileName">Current filename</label>
            <div className="rename-current-name">{file.original_filename}</div>
          </div>

          <div className="form-group">
            <label htmlFor="renameFileName">New filename</label>
            <div className="rename-input-group">
              <input
                id="renameFileName"
                type="text"
                value={baseName}
                onChange={(event) => setBaseName(event.target.value)}
                placeholder="Enter new filename"
                autoFocus
                maxLength={180}
                disabled={renaming}
              />
              {parsed.extension && <span className="rename-extension">{parsed.extension}</span>}
            </div>
            <small className="rename-note">File extension is preserved automatically.</small>
          </div>

          <div className="rename-file-footer">
            <button type="button" onClick={onClose} className="cancel-rename-btn" disabled={renaming}>
              Cancel
            </button>
            <button type="submit" className="confirm-rename-btn" disabled={!trimmed || renaming}>
              {renaming ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Renaming...
                </>
              ) : (
                <>
                  <i className="fas fa-check"></i>
                  Rename
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default RenameFileModal;
