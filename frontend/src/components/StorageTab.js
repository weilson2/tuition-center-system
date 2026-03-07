import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import FileDetailsModal from './FileDetailsModal';
import DownloadConfirmModal from './DownloadConfirmModal';
import AddToFolderModal from './AddToFolderModal';
import Toast from './Toast';
import CreateFolderModal from './CreateFolderModal';
import BulkDeleteModal from './BulkDeleteModal';
import FilePreviewModal from './FilePreviewModal';
import TextEditorModal from './TextEditorModal';
import FileShareModal from './FileShareModal';
import RenameFileModal from './RenameFileModal';
import '../styles/Storage.css';


const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const getToken = () => {
  return localStorage.getItem('token') || sessionStorage.getItem('token');
};

function StorageTab() {
  const [activeSection, setActiveSection] = useState('myFiles');
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [storageQuota, setStorageQuota] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchAll, setSearchAll] = useState(false);
  const [recentSearches, setRecentSearches] = useState([]);
  const [fileTypeFilter, setFileTypeFilter] = useState('');
  const [dateField, setDateField] = useState('uploaded');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [detailsFileId, setDetailsFileId] = useState(null);
  const [bulkDeleteFileIds, setBulkDeleteFileIds] = useState(null);
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [showAddToFolderModal, setShowAddToFolderModal] = useState(false);
  const [sharedFileFilter, setSharedFileFilter] = useState('all');
  const [toast, setToast] = useState(null);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [previewFileId, setPreviewFileId] = useState(null);
  const [editFileId, setEditFileId] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [renameFileTarget, setRenameFileTarget] = useState(null);
  const [refreshingData, setRefreshingData] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [showNotificationsPopup, setShowNotificationsPopup] = useState(false);
  const [markingAllNotificationsRead, setMarkingAllNotificationsRead] = useState(false);

  // Upload states
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState({});
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Download confirmation
  const [downloadFileId, setDownloadFileId] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState({
    active: false,
    filename: '',
    percent: 0
  });

  useEffect(() => {
    const storedSearches = JSON.parse(localStorage.getItem('storageRecentSearches') || '[]');
    if (Array.isArray(storedSearches)) {
      setRecentSearches(storedSearches.slice(0, 6));
    }
  }, []);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, selectedFolder, searchTerm, fileTypeFilter, sharedFileFilter, searchAll, dateFrom, dateTo, dateField]);

  useEffect(() => {
    if (activeSection === 'sharedFiles' && dateField !== 'shared') {
      setDateField('shared');
    }
    if (activeSection === 'myFiles' && dateField === 'shared') {
      setDateField('uploaded');
    }
  }, [activeSection, dateField]);

  const refreshSharedViewSilently = useCallback(async () => {
    if (activeSection !== 'sharedFiles') {
      return;
    }

    try {
      const token = getToken();
      const params = {
        search: searchTerm || undefined,
        fileType: fileTypeFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        sharerRole: sharedFileFilter !== 'all' ? (sharedFileFilter === 'teachers' ? 'teacher' : 'student') : undefined
      };

      const [filesResponse, notificationsResponse] = await Promise.all([
        axios.get(`${API_URL}/storage/files/shared`, {
          headers: { Authorization: `Bearer ${token}` },
          params
        }),
        axios.get(`${API_URL}/storage/notifications`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      setFiles(filesResponse.data.files || []);
      setNotifications(notificationsResponse.data.notifications || []);
      setUnreadNotificationCount(Number(notificationsResponse.data.unreadCount) || 0);
    } catch (error) {
      console.error('Silent shared view refresh error:', error);
    }
  }, [activeSection, searchTerm, fileTypeFilter, sharedFileFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (activeSection !== 'sharedFiles') {
      return undefined;
    }

    const intervalId = setInterval(() => {
      void refreshSharedViewSilently();
    }, 3000);

    return () => {
      clearInterval(intervalId);
    };
  }, [activeSection, refreshSharedViewSilently]);

  const loadNotifications = async (silent = false) => {
    try {
      if (!silent) {
        setNotificationsLoading(true);
      }

      const token = getToken();
      const response = await axios.get(`${API_URL}/storage/notifications`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setNotifications(response.data.notifications || []);
      setUnreadNotificationCount(Number(response.data.unreadCount) || 0);
    } catch (error) {
      console.error('Load notifications error:', error);
    } finally {
      if (!silent) {
        setNotificationsLoading(false);
      }
    }
  };

  const markNotificationAsRead = async (notificationId) => {
    try {
      const token = getToken();
      await axios.put(`${API_URL}/storage/notifications/${notificationId}/read`, null, {
        headers: { Authorization: `Bearer ${token}` }
      });

      await loadNotifications(true);
    } catch (error) {
      console.error('Mark notification read error:', error);
    }
  };

  const markAllNotificationsAsRead = async () => {
    const unreadNotifications = notifications.filter((notification) => !notification.is_read);
    if (unreadNotifications.length === 0 || markingAllNotificationsRead) {
      return;
    }

    try {
      setMarkingAllNotificationsRead(true);
      const token = getToken();

      await Promise.all(
        unreadNotifications.map((notification) =>
          axios.put(`${API_URL}/storage/notifications/${notification.notification_id}/read`, null, {
            headers: { Authorization: `Bearer ${token}` }
          })
        )
      );

      await loadNotifications(true);
      showToast(`${unreadNotifications.length} notification${unreadNotifications.length > 1 ? 's' : ''} marked as read`, 'success');
    } catch (error) {
      console.error('Mark all notifications read error:', error);
      showToast('Failed to mark all notifications as read', 'error');
    } finally {
      setMarkingAllNotificationsRead(false);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const token = getToken();

      const quotaResponse = await axios.get(`${API_URL}/storage/quota`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStorageQuota(quotaResponse.data);

      if (activeSection === 'myFiles') {
        const foldersResponse = await axios.get(`${API_URL}/storage/folders`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setFolders(foldersResponse.data.folders);
      }

      const params = {
        search: searchTerm || undefined,
        fileType: fileTypeFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        dateField: dateField || undefined
      };

      // Add folder filter for My Files
      if (activeSection === 'myFiles') {
        params.folderId = selectedFolder?.folder_id || undefined;
      }

      // Add role filter for Shared Files
      if (activeSection === 'sharedFiles' && sharedFileFilter !== 'all') {
        params.sharerRole = sharedFileFilter === 'teachers' ? 'teacher' : 'student';
      }

      if (searchAll && searchTerm) {
        const [myFilesResponse, sharedFilesResponse] = await Promise.all([
          axios.get(`${API_URL}/storage/files`, {
            headers: { Authorization: `Bearer ${token}` },
            params: {
              search: searchTerm,
              fileType: fileTypeFilter || undefined,
              dateFrom: dateFrom || undefined,
              dateTo: dateTo || undefined,
              dateField: dateField || undefined
            }
          }),
          axios.get(`${API_URL}/storage/files/shared`, {
            headers: { Authorization: `Bearer ${token}` },
            params: {
              search: searchTerm,
              sharerRole: sharedFileFilter !== 'all' ? (sharedFileFilter === 'teachers' ? 'teacher' : 'student') : undefined,
              dateFrom: dateFrom || undefined,
              dateTo: dateTo || undefined
            }
          })
        ]);

        const merged = [
          ...(myFilesResponse.data.files || []).map((item) => ({ ...item, source_section: 'myFiles' })),
          ...(sharedFilesResponse.data.files || []).map((item) => ({ ...item, source_section: 'sharedFiles' }))
        ];
        setFiles(merged);
      } else {
        const endpoint = activeSection === 'myFiles'
          ? `${API_URL}/storage/files`
          : `${API_URL}/storage/files/shared`;

        const filesResponse = await axios.get(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
          params
        });
        setFiles(filesResponse.data.files);
      }

      if (activeSection === 'sharedFiles') {
        await loadNotifications(true);
      }

      setLoading(false);
    } catch (error) {
      console.error('Load data error:', error);
      setLoading(false);
    }
  };

  const handleRefreshData = async () => {
    if (refreshingData) {
      return;
    }

    setRefreshingData(true);
    try {
      await loadData();
    } finally {
      setRefreshingData(false);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const newFiles = Array.from(e.dataTransfer.files);
      handleFilesSelected(newFiles, true); // true = append mode
    }
  };
  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      handleFilesSelected(newFiles, true); // true = append mode
      e.target.value = ''; // Reset input to allow selecting same file again
    }
  };

  const handleFilesSelected = (files, append = false) => {
    const validFiles = files.filter(file => {
      if (file.size > 500 * 1024 * 1024) {
        alert(`${file.name} exceeds 500MB limit`);
        return false;
      }
      return true;
    });

    if (append) {
      // Add to existing files (remove duplicates by name)
      setSelectedFiles(prev => {
        const existingNames = prev.map(f => f.name);
        const newUniqueFiles = validFiles.filter(f => !existingNames.includes(f.name));
        return [...prev, ...newUniqueFiles];
      });
    } else {
      // Replace all files
      setSelectedFiles(validFiles);
    }

    setShowUploadModal(true);
  };

  const removeSelectedFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    try {
      setUploading(true);
      const token = getToken();

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const formData = new FormData();
        formData.append('file', file);
        if (selectedFolder) {
          formData.append('folderId', selectedFolder.folder_id);
        }

        setUploadProgress(prev => ({ ...prev, [file.name]: 0 }));

        await axios.post(`${API_URL}/storage/upload`, formData, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data'
          },
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(prev => ({ ...prev, [file.name]: percentCompleted }));
          }
        });
      }

      setShowUploadModal(false);
      setSelectedFiles([]);
      setUploadProgress({});
      loadData();
    } catch (error) {
      console.error('Upload error:', error);
      alert(error.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleFileDownload = async (fileId, filename) => {
    try {
      const token = getToken();

      setDownloadProgress({
        active: true,
        filename: filename || 'Downloading file',
        percent: 0
      });

      const response = await axios.get(`${API_URL}/storage/files/${fileId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
        onDownloadProgress: (event) => {
          if (event.total) {
            const percent = Math.min(100, Math.round((event.loaded * 100) / event.total));
            setDownloadProgress((prev) => ({ ...prev, percent }));
          }
        }
      });

      setDownloadProgress((prev) => ({ ...prev, percent: 100 }));

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to download file');
    } finally {
      setTimeout(() => {
        setDownloadProgress({
          active: false,
          filename: '',
          percent: 0
        });
      }, 500);
    }
  };

  const persistRecentSearch = (term) => {
    const normalized = String(term || '').trim();
    if (!normalized) {
      return;
    }

    setRecentSearches((prev) => {
      const deduped = [normalized, ...prev.filter((item) => item.toLowerCase() !== normalized.toLowerCase())].slice(0, 6);
      localStorage.setItem('storageRecentSearches', JSON.stringify(deduped));
      return deduped;
    });
  };

  const handleSearchSubmit = (value) => {
    const normalized = String(value || '').trim();
    setSearchTerm(normalized);
    if (normalized) {
      persistRecentSearch(normalized);
    }
  };

  const removeFilter = (key) => {
    if (key === 'search') setSearchTerm('');
    if (key === 'type') setFileTypeFilter('');
    if (key === 'dateFrom') setDateFrom('');
    if (key === 'dateTo') setDateTo('');
    if (key === 'dateField') setDateField(activeSection === 'sharedFiles' ? 'shared' : 'uploaded');
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setFileTypeFilter('');
    setDateFrom('');
    setDateTo('');
    setDateField(activeSection === 'sharedFiles' ? 'shared' : 'uploaded');
  };

  const openRenameModal = (file) => {
    if (!file) {
      return;
    }

    if (activeSection === 'sharedFiles' && file.can_rename === false) {
      return;
    }

    setRenameFileTarget(file);
  };

  const handleRenameFile = async (baseName) => {
    if (!renameFileTarget) {
      return;
    }

    const trimmed = String(baseName || '').trim();
    if (!trimmed) {
      showToast('Filename cannot be empty', 'error');
      return;
    }

    try {
      const token = getToken();
      const response = await axios.put(
        `${API_URL}/storage/files/${renameFileTarget.file_id}/rename`,
        { filename: trimmed },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      showToast(response.data?.message || 'File renamed successfully', 'success');
      setRenameFileTarget(null);
      await loadData();
    } catch (error) {
      console.error('Rename error:', error);
      showToast(error.response?.data?.error || 'Failed to rename file', 'error');
    }
  };

  const handleBulkDelete = async (fileIds) => {
    try {
      const token = getToken();

      // Delete files one by one
      let successCount = 0;
      let errorCount = 0;

      for (const fileId of fileIds) {
        try {
          await axios.delete(`${API_URL}/storage/files/${fileId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          successCount++;
        } catch (error) {
          console.error(`Failed to delete file ${fileId}:`, error);
          errorCount++;
        }
      }

      if (errorCount === 0) {
        showToast(`${successCount} file${successCount > 1 ? 's' : ''} deleted successfully!`, 'success');
      } else if (successCount > 0) {
        showToast(`${successCount} file${successCount > 1 ? 's' : ''} deleted, ${errorCount} failed`, 'warning');
      } else {
        showToast('Failed to delete files', 'error');
      }

      setSelectedFileIds([]);
      setBulkDeleteFileIds(null);
      loadData();
    } catch (error) {
      console.error('Bulk delete error:', error);
      showToast('Failed to delete files', 'error');
    }
  };

  const handleCreateFolder = async (folderName) => {
    try {
      const token = getToken();
      await axios.post(`${API_URL}/storage/folders`,
        { folderName },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      showToast('Folder created successfully!', 'success');
      setShowCreateFolderModal(false);
      loadData();
    } catch (error) {
      console.error('Create folder error:', error);
      showToast(error.response?.data?.error || 'Failed to create folder', 'error');
    }
  };

  const handleAddToFolder = async (folderId, fileIds) => {
    try {
      const token = getToken();
      const response = await axios.post(`${API_URL}/storage/folders/${folderId}/files`,
        { fileIds },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.addedCount === 0) {
        showToast('All selected files are already in this folder', 'info');
      } else {
        showToast(response.data.message || 'Files added to folder successfully!', 'success');
      }

      setSelectedFileIds([]);
      setShowAddToFolderModal(false);
      loadData();
    } catch (error) {
      console.error('Add to folder error:', error);
      showToast(error.response?.data?.error || 'Failed to add files to folder', 'error');
    }
  };

  // Add this function after handleAddToFolder
  const handleRemoveFromFolder = async (folderId, fileIds) => {
    try {
      const token = getToken();
      const response = await axios.delete(`${API_URL}/storage/folders/${folderId}/files`,
        {
          headers: { Authorization: `Bearer ${token}` },
          data: { fileIds }
        }
      );

      showToast(response.data.message || 'Files removed from folder successfully!', 'success');
      setSelectedFileIds([]);
      loadData();
    } catch (error) {
      console.error('Remove from folder error:', error);
      showToast(error.response?.data?.error || 'Failed to remove files from folder', 'error');
    }
  };

  // Add checkbox selection handlers
  const handleFileSelect = (fileId) => {
    setSelectedFileIds(prev =>
      prev.includes(fileId)
        ? prev.filter(id => id !== fileId)
        : [...prev, fileId]
    );
  };

  const handleSelectAll = () => {
    if (selectedFileIds.length === files.length) {
      setSelectedFileIds([]);
    } else {
      setSelectedFileIds(files.map(f => f.file_id));
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes))) {
      return 'Unlimited';
    }
    const normalizedBytes = Number(bytes);
    if (normalizedBytes <= 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(normalizedBytes) / Math.log(k));
    return Math.round(normalizedBytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getFileIcon = (fileType) => {
    if (fileType.startsWith('image/')) return 'fa-file-image';
    if (fileType === 'application/pdf') return 'fa-file-pdf';
    if (fileType.startsWith('video/')) return 'fa-file-video';
    if (fileType.startsWith('audio/')) return 'fa-file-audio';
    if (fileType.includes('word')) return 'fa-file-word';
    if (fileType.includes('excel')) return 'fa-file-excel';
    if (fileType.includes('powerpoint')) return 'fa-file-powerpoint';
    return 'fa-file';
  };

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
  };

  const getTotalSelectedSize = () => {
    return selectedFiles.reduce((total, file) => total + file.size, 0);
  };

  return (
    <div className="storage-tab">
      {/* Header */}
      <div className="storage-header">
        <h2>
          <i className="fas fa-cloud"></i>
          Cloud Storage
        </h2>
        <div className="storage-header-actions">
          <button
            type="button"
            className="storage-refresh-btn"
            onClick={() => {
              void handleRefreshData();
            }}
            disabled={refreshingData}
            title="Refresh storage data"
          >
            <i className={`fas ${refreshingData ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`}></i>
          </button>

          {storageQuota && (
            <div className="storage-quota">
              <div className="quota-info">
                <span className="quota-used">{formatFileSize(storageQuota.used)}</span>
                <span className="quota-separator">/</span>
                <span className="quota-total">{formatFileSize(storageQuota.quota)}</span>
              </div>
              <div className="quota-bar">
                <div
                  className="quota-bar-fill"
                  style={{
                    width: `${Math.min(Number(storageQuota.percentageUsed) || 0, 100)}%`,
                    backgroundColor: storageQuota.percentageUsed >= 90 ? '#ef4444' :
                      storageQuota.percentageUsed >= 80 ? '#f59e0b' : '#3b82f6'
                  }}
                ></div>
              </div>
              <div className="quota-percentage">
                {storageQuota.isUnlimited ? 'No quota limit' : `${storageQuota.percentageUsed}% used`}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="storage-tabs">
        <button
          className={`tab-btn ${activeSection === 'myFiles' ? 'active' : ''}`}
          onClick={() => {
            setActiveSection('myFiles');
            setSelectedFolder(null);
          }}
        >
          <i className="fas fa-folder"></i>
          My Cloud Storage
        </button>
        <button
          className={`tab-btn ${activeSection === 'sharedFiles' ? 'active' : ''}`}
          onClick={() => {
            setActiveSection('sharedFiles');
            setSelectedFolder(null);
          }}
        >
          <i className="fas fa-share-alt"></i>
          Shared Files
        </button>
      </div>

      {/* Main Content */}
      <div className="storage-content">
        {/* Folder Sidebar */}
        <div className="folder-sidebar">
          {activeSection === 'myFiles' ? (
            <>
              <div className="sidebar-header">
                <h3>
                  <i className="fas fa-folder"></i>
                  Folders
                </h3>
                <button
                  onClick={() => setShowCreateFolderModal(true)}
                  className="create-folder-btn"
                  title="New Folder"
                >
                  <i className="fas fa-plus"></i>
                </button>
              </div>

              <div className="folder-list">
                <div
                  className={`folder-item ${!selectedFolder ? 'active' : ''}`}
                  onClick={() => setSelectedFolder(null)}
                >
                  <i className="fas fa-home"></i>
                  <span>All Files</span>
                </div>

                {folders.filter(f => !f.is_system_folder).map(folder => (
                  <div
                    key={folder.folder_id}
                    className={`folder-item ${selectedFolder?.folder_id === folder.folder_id ? 'active' : ''}`}
                    onClick={() => setSelectedFolder(folder)}
                  >
                    <i className="fas fa-folder"></i>
                    <span>{folder.folder_name}</span>
                    <span className="file-count">({folder.file_count})</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="sidebar-header">
                <h3>
                  <i className="fas fa-share-alt"></i>
                  Shared Files
                </h3>
              </div>

              <div className="shared-sidebar-actions">
                <button
                  type="button"
                  className="shared-notifications-trigger"
                  onClick={() => setShowNotificationsPopup(true)}
                >
                  <i className="fas fa-bell"></i>
                  <span>Share Notifications</span>
                  <span className="shared-notifications-unread">{unreadNotificationCount} unread</span>
                </button>
              </div>

              <div className="folder-list">
                <div
                  className={`folder-item ${sharedFileFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setSharedFileFilter('all')}
                >
                  <i className="fas fa-globe"></i>
                  <span>All Shared Files</span>
                </div>

                <div
                  className={`folder-item ${sharedFileFilter === 'teachers' ? 'active' : ''}`}
                  onClick={() => setSharedFileFilter('teachers')}
                >
                  <i className="fas fa-chalkboard-teacher"></i>
                  <span>From Teachers</span>
                </div>

                <div
                  className={`folder-item ${sharedFileFilter === 'students' ? 'active' : ''}`}
                  onClick={() => setSharedFileFilter('students')}
                >
                  <i className="fas fa-user-graduate"></i>
                  <span>From Students</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Files Area */}
        <div className="files-area">
          {/* Toolbar */}
          <div className="files-toolbar">
            <div className="search-box">
              <i className="fas fa-search"></i>
              <input
                type="text"
                placeholder="Search files..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onBlur={(e) => handleSearchSubmit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearchSubmit(e.currentTarget.value);
                  }
                }}
              />
            </div>

            <label className="search-all-toggle">
              <input
                type="checkbox"
                checked={searchAll}
                onChange={(e) => setSearchAll(e.target.checked)}
              />
              <span>Search All</span>
            </label>

            <select
              value={fileTypeFilter}
              onChange={(e) => setFileTypeFilter(e.target.value)}
              className="filter-select"
            >
              <option value="">All Types</option>
              <option value="image">Images</option>
              <option value="application/pdf">PDFs</option>
              <option value="text">Text Files</option>
              <option value="video">Videos</option>
            </select>

            <select
              value={dateField}
              onChange={(e) => setDateField(e.target.value)}
              className="filter-select"
            >
              {activeSection === 'myFiles' && <option value="uploaded">Upload Date</option>}
              {activeSection === 'myFiles' && <option value="edited">Last Edited Date</option>}
              {activeSection === 'sharedFiles' && <option value="shared">Share Date</option>}
            </select>

            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="date-filter-input"
              title="From date"
            />

            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="date-filter-input"
              title="To date"
            />

            <button
              onClick={clearAllFilters}
              className="clear-filters-btn"
            >
              Clear All Filters
            </button>

            {activeSection === 'myFiles' && selectedFileIds.length > 0 && (
              <>
                <button
                  onClick={() => setShowAddToFolderModal(true)}
                  className="add-folder-action-btn"
                >
                  <i className="fas fa-folder-plus"></i>
                  Add to Folder ({selectedFileIds.length})
                </button>

                {selectedFolder && (
                  <button
                    onClick={() => handleRemoveFromFolder(selectedFolder.folder_id, selectedFileIds)}
                    className="remove-folder-action-btn"
                  >
                    <i className="fas fa-folder-minus"></i>
                    Remove from Folder ({selectedFileIds.length})
                  </button>
                )}

                <button
                  onClick={() => setShowShareModal(true)}
                  className="share-action-btn"
                >
                  <i className="fas fa-share-alt"></i>
                  Share ({selectedFileIds.length})
                </button>

                <button
                  onClick={() => setBulkDeleteFileIds(selectedFileIds)}
                  className="bulk-delete-action-btn"
                >
                  <i className="fas fa-trash"></i>
                  Delete ({selectedFileIds.length})
                </button>
              </>
            )}

            {activeSection === 'myFiles' && (
              <button
                onClick={() => setShowUploadModal(true)}
                className="upload-btn"
              >
                <i className="fas fa-cloud-upload-alt"></i>
                Upload Files
              </button>
            )}
          </div>

          {recentSearches.length > 0 && (
            <div className="recent-searches">
              <span className="recent-searches-label">Recent:</span>
              {recentSearches.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="recent-search-chip"
                  onClick={() => handleSearchSubmit(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          )}

          <div className="active-filters">
            {((activeSection === 'myFiles' && dateField === 'edited')) && (
              <button type="button" className="filter-chip" onClick={() => removeFilter('dateField')}>
                Date: Last Edited <span>×</span>
              </button>
            )}
            {searchTerm && (
              <button type="button" className="filter-chip" onClick={() => removeFilter('search')}>
                Search: {searchTerm} <span>×</span>
              </button>
            )}
            {fileTypeFilter && (
              <button type="button" className="filter-chip" onClick={() => removeFilter('type')}>
                Type: {fileTypeFilter} <span>×</span>
              </button>
            )}
            {dateFrom && (
              <button type="button" className="filter-chip" onClick={() => removeFilter('dateFrom')}>
                From: {dateFrom} <span>×</span>
              </button>
            )}
            {dateTo && (
              <button type="button" className="filter-chip" onClick={() => removeFilter('dateTo')}>
                To: {dateTo} <span>×</span>
              </button>
            )}
          </div>

          {downloadProgress.active && (
            <div className="download-progress-banner">
              <div className="download-progress-meta">
                <strong>Downloading:</strong> {downloadProgress.filename}
              </div>
              <div className="download-progress-track">
                <div className="download-progress-fill" style={{ width: `${downloadProgress.percent}%` }}></div>
              </div>
              <div className="download-progress-percent">{downloadProgress.percent}%</div>
            </div>
          )}

          {/* File List */}
          {loading ? (
            <div className="loading-state">
              <i className="fas fa-spinner fa-spin"></i>
              <p>Loading files...</p>
            </div>
          ) : files.length === 0 ? (
            <div className="empty-state">
              <i className="fas fa-folder-open"></i>
              <p>No files found</p>
              <small>Upload files or adjust your filters</small>
            </div>
          ) : (
            <div className="file-list">
              <div className={`file-list-header ${searchAll ? 'with-source' : ''}`}>
                {activeSection === 'myFiles' && (
                  <div className="header-cell checkbox-cell">
                    <input
                      type="checkbox"
                      checked={selectedFileIds.length === files.length && files.length > 0}
                      onChange={handleSelectAll}
                    />
                  </div>
                )}
                <div className="header-cell name-cell">Name</div>
                <div className="header-cell size-cell">Size</div>
                <div className="header-cell date-cell">
                  {activeSection === 'myFiles' ? 'Uploaded' : 'Shared'}
                </div>
                {searchAll && <div className="header-cell source-cell">Source</div>}
                {activeSection === 'sharedFiles' && (
                  <div className="header-cell sharer-cell">Shared By</div>
                )}
                <div className="header-cell actions-cell">Actions</div>
              </div>

              <div className="file-list-body">
                {files.map(file => (
                  <div key={file.file_id} className={`file-row ${searchAll ? 'with-source' : ''}`}>
                    {activeSection === 'myFiles' && (
                      <div className="file-cell checkbox-cell">
                        <input
                          type="checkbox"
                          checked={selectedFileIds.includes(file.file_id)}
                          onChange={() => handleFileSelect(file.file_id)}
                        />
                      </div>
                    )}

                    <div className="file-cell name-cell">
                      <i className={`fas ${getFileIcon(file.file_type)}`}></i>
                      <div>
                        <span className="file-name">{file.original_filename}</span>
                        {activeSection === 'myFiles' && Number(file.total_share_count) > 0 && (
                          <div className="file-share-summary">
                            {Number(file.total_share_count)} shares • {Number(file.recipient_count) || 0} receivers
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="file-cell size-cell">
                      {formatFileSize(file.file_size)}
                    </div>

                    <div className="file-cell date-cell">
                      {formatDate(
                        searchAll
                          ? (file.source_section === 'sharedFiles' ? file.shared_at : file.uploaded_at)
                          : (activeSection === 'myFiles' ? file.uploaded_at : file.shared_at)
                      )}
                    </div>

                    {searchAll && (
                      <div className="file-cell source-cell">
                        <span className="source-badge">{file.source_section === 'sharedFiles' ? 'Shared Files' : 'My Files'}</span>
                      </div>
                    )}

                    {activeSection === 'sharedFiles' && (
                      <div className="file-cell sharer-cell">
                        <span className={`role-badge ${file.sharer_role}`}>
                          {file.sharer_role === 'teacher' ? '👨‍🏫' : '👨‍🎓'} {file.sharer_name}
                        </span>
                      </div>
                    )}

                    <div className="file-cell actions-cell">
                      <div className="actions-cell-grid">
                        {/* Column 1: Edit - only for text files (My Files) */}
                        {(file.file_type === 'text/plain' || file.file_type === 'text/markdown') &&
                          (activeSection === 'myFiles' || file.can_edit !== false) ? (
                            <button
                              onClick={() => setEditFileId(file.file_id)}
                              className="action-btn edit-btn"
                              title="Edit"
                            >
                              <i className="fas fa-edit"></i>
                            </button>
                          ) : (
                            <span className="action-btn-placeholder" aria-hidden="true" />
                          )}
                        {/* Column 2: Preview - only for previewable files */}
                        {(file.file_type.startsWith('image/') ||
                          file.file_type === 'application/pdf' ||
                          file.file_type.startsWith('text/')) &&
                          (activeSection === 'myFiles' || file.can_download !== false) ? (
                            <button
                              onClick={() => setPreviewFileId(file.file_id)}
                              className="action-btn preview-btn"
                              title="Preview"
                            >
                              <i className="fas fa-eye"></i>
                            </button>
                          ) : (
                            <span className="action-btn-placeholder" aria-hidden="true" />
                          )}
                        {/* Column 3: Info */}
                        <button
                          onClick={() => setDetailsFileId(file.file_id)}
                          className="action-btn info-btn"
                          title="View Details"
                        >
                          <i className="fas fa-info-circle"></i>
                        </button>
                        {/* Column 4: Rename */}
                        {(activeSection === 'myFiles' || file.can_rename !== false) ? (
                          <button
                            onClick={() => openRenameModal(file)}
                            className="action-btn rename-btn"
                            title="Rename"
                          >
                            <i className="fas fa-pencil-alt"></i>
                          </button>
                        ) : (
                          <span className="action-btn-placeholder" aria-hidden="true" />
                        )}
                        {/* Column 5: Download */}
                        {(activeSection === 'myFiles' || file.can_download !== false) ? (
                          <button
                            onClick={() => setDownloadFileId(file.file_id)}
                            className="action-btn download-btn"
                            title="Download"
                          >
                            <i className="fas fa-download"></i>
                          </button>
                        ) : (
                          <span className="action-btn-placeholder" aria-hidden="true" />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="upload-modal-overlay" onClick={() => !uploading && setShowUploadModal(false)}>
          <div className="upload-modal" onClick={(e) => e.stopPropagation()}>
            <div className="upload-modal-header">
              <h3>Upload Files</h3>
              <button onClick={() => setShowUploadModal(false)} className="close-btn" disabled={uploading}>
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="upload-modal-content">
              {/* Drag and Drop Zone */}
              <div
                className={`drag-drop-zone ${dragActive ? 'drag-active' : ''}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <i className="fas fa-cloud-upload-alt"></i>
                <p>Drag and drop files here</p>
                <span>or</span>
                <label className="browse-btn">
                  <input
                    type="file"
                    multiple
                    onChange={handleFileInputChange}
                    style={{ display: 'none' }}
                    disabled={uploading}
                  />
                  Browse Files
                </label>
                <small>Maximum file size: 500MB per file</small>
              </div>

              {/* Selected Files List */}
              {selectedFiles.length > 0 && (
                <div className="selected-files-section">
                  <h4>Selected Files ({selectedFiles.length})</h4>
                  <p className="total-size">Total: {formatFileSize(getTotalSelectedSize())}</p>

                  <div className="selected-files-list">
                    {selectedFiles.map((file, index) => (
                      <div key={index} className="selected-file-item">
                        <div className="file-item-info">
                          <i className={`fas ${getFileIcon(file.type)}`}></i>
                          <div className="file-item-details">
                            <p className="file-item-name">{file.name}</p>
                            <p className="file-item-size">{formatFileSize(file.size)} • {file.type.split('/')[1]?.toUpperCase()}</p>
                          </div>
                        </div>

                        {uploading ? (
                          <div className="upload-progress-bar">
                            <div
                              className="upload-progress-fill"
                              style={{ width: `${uploadProgress[file.name] || 0}%` }}
                            ></div>
                            <span className="upload-progress-text">{uploadProgress[file.name] || 0}%</span>
                          </div>
                        ) : (
                          <button
                            onClick={() => removeSelectedFile(index)}
                            className="remove-file-btn"
                          >
                            <i className="fas fa-times"></i>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="upload-modal-footer">
              <button
                onClick={() => setShowUploadModal(false)}
                className="cancel-upload-btn"
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                className="confirm-upload-btn"
                disabled={selectedFiles.length === 0 || uploading}
              >
                {uploading ? (
                  <>
                    <i className="fas fa-spinner fa-spin"></i>
                    Uploading ({Object.keys(uploadProgress).length}/{selectedFiles.length})
                  </>
                ) : (
                  <>
                    <i className="fas fa-upload"></i>
                    Upload ({selectedFiles.length})
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Add to Folder Modal */}
      {showAddToFolderModal && (
        <AddToFolderModal
          folders={folders}
          selectedFiles={selectedFileIds}
          onClose={() => setShowAddToFolderModal(false)}
          onConfirm={handleAddToFolder}
        />
      )}


      {/* Bulk Delete Confirmation Modal */}
      {bulkDeleteFileIds && (
        <BulkDeleteModal
          fileIds={bulkDeleteFileIds}
          onClose={() => setBulkDeleteFileIds(null)}
          onConfirm={handleBulkDelete}
        />
      )}

      {/* Download Confirmation Modal */}
      {downloadFileId && (
        <DownloadConfirmModal
          fileId={downloadFileId}
          onClose={() => setDownloadFileId(null)}
          onConfirm={handleFileDownload}
        />
      )}

      {/* File Details Modal */}
      {detailsFileId && (
        <FileDetailsModal
          fileId={detailsFileId}
          onClose={() => setDetailsFileId(null)}
        />
      )}

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Create Folder Modal */}
      {showCreateFolderModal && (
        <CreateFolderModal
          onClose={() => setShowCreateFolderModal(false)}
          onConfirm={handleCreateFolder}
        />
      )}

      {/* File Preview Modal */}
      {previewFileId && (
        <FilePreviewModal
          fileId={previewFileId}
          onClose={() => setPreviewFileId(null)}
          onDownload={handleFileDownload}
        />
      )}

      {/* Text Editor Modal */}
      {editFileId && (
        <TextEditorModal
          fileId={editFileId}
          onClose={() => setEditFileId(null)}
          onSaved={(message) => {
            showToast(message, 'success');
            loadData(); // Refresh file list
          }}
        />
      )}

      {/* File Share Modal */}
      {showShareModal && (
        <FileShareModal
          selectedFileIds={selectedFileIds}
          onClose={() => setShowShareModal(false)}
          onShared={(message) => {
            showToast(message, 'success');
            setSelectedFileIds([]);
            setShowShareModal(false);
            loadData();
          }}
        />
      )}

      {renameFileTarget && (
        <RenameFileModal
          file={renameFileTarget}
          onClose={() => setRenameFileTarget(null)}
          onConfirm={handleRenameFile}
        />
      )}

      {showNotificationsPopup && activeSection === 'sharedFiles' && (
        <div
          className="shared-notifications-popup-overlay"
          onClick={() => setShowNotificationsPopup(false)}
        >
          <div
            className="shared-notifications-popup"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shared-notifications-header">
              <h4>
                <i className="fas fa-bell"></i>
                Share Notifications
              </h4>
              <div className="shared-notifications-header-actions">
                <span className="shared-notifications-unread">{unreadNotificationCount} unread</span>
                <button
                  type="button"
                  className="shared-mark-all-read-btn"
                  onClick={markAllNotificationsAsRead}
                  disabled={markingAllNotificationsRead || unreadNotificationCount === 0}
                >
                  {markingAllNotificationsRead ? 'Marking...' : 'Mark all as read'}
                </button>
                <button
                  type="button"
                  className="close-btn"
                  onClick={() => setShowNotificationsPopup(false)}
                  aria-label="Close notifications"
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
            </div>

            {notificationsLoading ? (
              <div className="shared-notifications-loading">
                <i className="fas fa-spinner fa-spin"></i>
                Loading notifications...
              </div>
            ) : notifications.length === 0 ? (
              <div className="shared-notifications-empty">No new share notifications.</div>
            ) : (
              <div className="shared-notifications-list">
                {notifications.slice(0, 10).map((notification) => (
                  <div
                    key={notification.notification_id}
                    className={`shared-notification-item ${notification.is_read ? 'read' : 'unread'}`}
                  >
                    <div className="shared-notification-top">
                      <div>
                        <strong>{notification.sharer_name}</strong>
                        <span className="shared-notification-role"> ({notification.sharer_role})</span>
                      </div>
                      <small>{formatDate(notification.shared_at || notification.created_at)}</small>
                    </div>
                    <div className="shared-notification-body">
                      Shared {notification.file_count} file{Number(notification.file_count) > 1 ? 's' : ''}
                    </div>
                    <ul className="shared-notification-files">
                      {(notification.files || []).map((item) => (
                        <li key={`${notification.notification_id}-${item.fileId}`}>{item.fileName}</li>
                      ))}
                    </ul>

                    {!notification.is_read && (
                      <button
                        type="button"
                        className="shared-notification-read-btn"
                        onClick={() => markNotificationAsRead(notification.notification_id)}
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default StorageTab;
