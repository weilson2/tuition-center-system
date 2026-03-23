import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000/api";

const getToken = () => {
  return localStorage.getItem("token") || sessionStorage.getItem("token");
};

// Then use: const token = getToken();

function BulkDeleteModal({ fileIds, onClose, onConfirm }) {
  const [filesDetails, setFilesDetails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const fetchFilesDetails = useCallback(async () => {
    try {
      setLoading(true);
      const token = getToken();

      const promises = fileIds.map((fileId) =>
        axios.get(`${API_URL}/storage/files/${fileId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );

      const responses = await Promise.all(promises);
      const files = responses.map((res) => res.data.file);
      setFilesDetails(files);
      setLoading(false);
    } catch (error) {
      console.error("Fetch files details error:", error);
      setLoading(false);
    }
  }, [fileIds]);

  useEffect(() => {
    if (fileIds && fileIds.length > 0) {
      void fetchFilesDetails();
    }
  }, [fetchFilesDetails, fileIds]);

  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const getTotalSize = () => {
    return filesDetails.reduce(
      (total, file) => total + parseInt(file.file_size),
      0,
    );
  };

  const getFileIcon = (fileType) => {
    if (!fileType) return "fa-file";
    if (fileType.startsWith("image/")) return "fa-file-image";
    if (fileType === "application/pdf") return "fa-file-pdf";
    if (fileType.startsWith("video/")) return "fa-file-video";
    if (fileType.startsWith("audio/")) return "fa-file-audio";
    if (fileType.includes("word")) return "fa-file-word";
    if (fileType.includes("excel")) return "fa-file-excel";
    if (fileType.includes("powerpoint")) return "fa-file-powerpoint";
    if (fileType.startsWith("text/")) return "fa-file-alt";
    return "fa-file";
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onConfirm(fileIds);
    setDeleting(false);
    onClose();
  };

  if (!fileIds || fileIds.length === 0) return null;

  return (
    <div className="bulk-delete-overlay" onClick={() => !deleting && onClose()}>
      <div className="bulk-delete-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="bulk-delete-header">
          <div className="delete-icon-warning">
            <i className="fas fa-exclamation-triangle"></i>
          </div>
          <h3>
            Delete {fileIds.length} File{fileIds.length > 1 ? "s" : ""}?
          </h3>
          <button onClick={onClose} className="close-btn" disabled={deleting}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Content */}
        <div className="bulk-delete-content">
          {loading ? (
            <div className="delete-loading">
              <i className="fas fa-spinner fa-spin"></i>
              <p>Loading file details...</p>
            </div>
          ) : filesDetails.length > 0 ? (
            <>
              <div className="delete-warning-banner">
                <i className="fas fa-exclamation-circle"></i>
                <div>
                  <strong>This action is irreversible</strong>
                  <p>
                    The following {fileIds.length} file
                    {fileIds.length > 1 ? "s" : ""} will be permanently removed
                    from your storage.
                  </p>
                </div>
              </div>

              {/* Files List */}
              <div className="files-to-delete-list">
                <h4>Files to Delete:</h4>
                <div className="files-list-scroll">
                  {filesDetails.map((file, index) => (
                    <div key={index} className="file-delete-item">
                      <div className="file-delete-icon">
                        <i className={`fas ${getFileIcon(file.file_type)}`}></i>
                      </div>
                      <div className="file-delete-info">
                        <p className="file-delete-name">
                          {file.original_filename}
                        </p>
                        <p className="file-delete-size">
                          {formatFileSize(file.file_size)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Storage Summary */}
              <div className="delete-storage-summary">
                <div className="storage-summary-item">
                  <span className="summary-label">Total files:</span>
                  <span className="summary-value">{fileIds.length}</span>
                </div>
                <div className="storage-summary-item highlight">
                  <span className="summary-label">Storage to be freed:</span>
                  <span className="summary-value">
                    {formatFileSize(getTotalSize())}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="delete-error">
              <i className="fas fa-exclamation-circle"></i>
              <p>Failed to load file information</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bulk-delete-footer">
          <button
            onClick={onClose}
            className="cancel-delete-btn"
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            className="confirm-bulk-delete-btn"
            disabled={loading || deleting}
          >
            {deleting ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                Deleting...
              </>
            ) : (
              <>
                <i className="fas fa-trash"></i>
                Delete {fileIds.length} File{fileIds.length > 1 ? "s" : ""}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BulkDeleteModal;
