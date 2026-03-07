import React from 'react';
import '../styles/ConfirmDialog.css';

function ConfirmDialog({
  isOpen,
  title = 'Please Confirm',
  message = '',
  onCancel,
  onConfirm,
  isConfirming = false,
  confirmText = 'Confirm',
  confirmingText = 'Confirming...',
  cancelText = 'Cancel'
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="confirm-dialog-backdrop" onClick={() => !isConfirming && onCancel?.()}>
      <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-dialog-icon-wrap" aria-hidden="true">
          <i className={`fas ${isConfirming ? 'fa-rotate-right fa-spin' : 'fa-circle-exclamation'}`}></i>
        </div>

        <h3>{title}</h3>
        <p>{message}</p>

        <div className="confirm-dialog-actions">
          <button type="button" className="confirm-cancel-btn" onClick={onCancel} disabled={isConfirming}>
            {cancelText}
          </button>
          <button type="button" className="confirm-ok-btn" onClick={onConfirm} disabled={isConfirming}>
            <i className={`fas ${isConfirming ? 'fa-rotate-right fa-spin' : 'fa-check'}`}></i>
            {isConfirming ? confirmingText : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
