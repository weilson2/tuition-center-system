import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/AuditLogs.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const getToken = () => {
  return localStorage.getItem('token') || sessionStorage.getItem('token');
};

const buildVisiblePages = (totalPages, currentPage) => {
  const safeTotalPages = Math.max(1, Number(totalPages) || 1);
  const safeCurrentPage = Math.min(safeTotalPages, Math.max(1, Number(currentPage) || 1));

  if (safeTotalPages <= 7) {
    return Array.from({ length: safeTotalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, safeTotalPages, safeCurrentPage - 1, safeCurrentPage, safeCurrentPage + 1]);
  const orderedPages = Array.from(pages)
    .filter((pageNumber) => pageNumber >= 1 && pageNumber <= safeTotalPages)
    .sort((first, second) => first - second);

  const visibleItems = [];
  orderedPages.forEach((pageNumber, index) => {
    if (index > 0 && pageNumber - orderedPages[index - 1] > 1) {
      visibleItems.push('ellipsis');
    }
    visibleItems.push(pageNumber);
  });

  return visibleItems;
};

function AuditLogsTab() {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedLogs, setSelectedLogs] = useState([]);
  const [filters, setFilters] = useState({
    operationType: '',
    status: '',
    userId: '',
    dateFrom: '',
    dateTo: '',
    search: ''
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });
  const [users, setUsers] = useState([]);
  const [refreshingData, setRefreshingData] = useState(false);

  const visiblePages = buildVisiblePages(pagination.totalPages, pagination.page);

  useEffect(() => {
    loadUsers();
    loadStats();
  }, []);

  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, pagination.page]);

  const handleManualRefresh = async () => {
    if (refreshingData) {
      return;
    }

    setRefreshingData(true);
    try {
      await Promise.all([loadUsers(), loadStats(), loadLogs()]);
    } finally {
      setRefreshingData(false);
    }
  };

  const loadUsers = async () => {
    try {
      const token = getToken();
      const response = await axios.get(`${API_URL}/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUsers(response.data.users);
    } catch (error) {
      console.error('Load users error:', error);
    }
  };

  const loadStats = async () => {
    try {
      const token = getToken();
      const response = await axios.get(`${API_URL}/admin/audit-stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStats(response.data);
    } catch (error) {
      console.error('Load stats error:', error);
    }
  };

  const loadLogs = async () => {
    try {
      setLoading(true);
      const token = getToken();
      
      
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        ...filters
      };

      const response = await axios.get(`${API_URL}/admin/audit-logs`, {
        headers: { Authorization: `Bearer ${token}` },
        params
      });


      setLogs(response.data.logs);
      setPagination(prev => ({
        ...prev,
        total: response.data.pagination.total,
        totalPages: response.data.pagination.totalPages
      }));
      setLoading(false);
    } catch (error) {
      console.error('❌ Load logs error:', error);
      console.error('Error response:', error.response?.data);
      setLoading(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 })); // Reset to page 1 on filter change
  };

  const handleSelectLog = (logId) => {
    setSelectedLogs(prev =>
      prev.includes(logId)
        ? prev.filter(id => id !== logId)
        : [...prev, logId]
    );
  };

  const handleSelectAll = () => {
    if (selectedLogs.length === logs.length) {
      setSelectedLogs([]);
    } else {
      setSelectedLogs(logs.map(log => log.log_id));
    }
  };

  const handleExport = async () => {
    try {
      const token = getToken();
      
      // Export ALL logs matching current filters
      const response = await axios.get(`${API_URL}/admin/audit-logs/export`, {
        headers: { Authorization: `Bearer ${token}` },
        params: filters, // Send current filters
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      
      // Generate filename based on filters
      let filename = 'storage-logs';
      if (filters.operationType) filename += `-${filters.operationType}`;
      if (filters.status) filename += `-${filters.status}`;
      if (filters.dateFrom || filters.dateTo) filename += '-filtered';
      filename += `-${Date.now()}.csv`;
      
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export logs');
    }
  };

  const handleExportSelected = async () => {
    if (selectedLogs.length === 0) {
      alert('Please select logs to export');
      return;
    }

    try {
      // Get the full log data for selected logs
      const selectedLogData = logs.filter(log => selectedLogs.includes(log.log_id));
      
      // Generate CSV manually on frontend
      let csv = 'Timestamp,Operation,User,Email,Role,Filename,File Size,Status,IP Address,Details\n';
      
      selectedLogData.forEach(log => {
        try {
          const details = JSON.parse(log.operation_details || '{}');
          const filename = details.filename || details.file_name || '-';
          const fileSize = details.size ? `${Math.round(details.size / 1024)} KB` : '-';
          const timestamp = formatDate(log.created_at);
          const errorMsg = log.error_message || '-';
          
          csv += `"${timestamp}","${log.operation_type}","${log.user_name || '-'}","${log.user_email || '-'}","${log.user_role || '-'}","${filename}","${fileSize}","${log.status}","${log.ip_address || '-'}","${errorMsg}"\n`;
        } catch (err) {
          console.error('Error processing log:', err);
        }
      });

      // Download CSV
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `selected-logs-${selectedLogs.length}-items-${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      alert(`Successfully exported ${selectedLogs.length} selected logs`);
      
      // Clear selection after export
      setSelectedLogs([]);
    } catch (error) {
      console.error('Export selected error:', error);
      alert('Failed to export selected logs');
    }
  };

  const getOperationIcon = (operation) => {
    const icons = {
      'upload': 'fa-cloud-upload-alt',
      'download': 'fa-download',
      'delete': 'fa-trash',
      'share': 'fa-share-alt',
      'edit': 'fa-edit',
      'preview': 'fa-eye',
      'add_to_folder': 'fa-folder-plus',
      'remove_from_folder': 'fa-folder-minus',
      'revoke_share': 'fa-user-slash'
    };
    return icons[operation] || 'fa-file';
  };

  const getStatusBadge = (status) => {
    const statusColors = {
      'success': 'bg-green-100 text-green-800',
      'failed': 'bg-red-100 text-red-800',
      'pending': 'bg-yellow-100 text-yellow-800'
    };
    
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[status] || 'bg-gray-100 text-gray-800'}`}>
        {status?.charAt(0).toUpperCase() + status?.slice(1)}
      </span>
    );
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    try {
      return new Date(dateString).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return '-';
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '-';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="audit-logs-tab">
      {/* Header with Stats */}
      <div className="audit-header">
        <div>
          <h2>Audit Logs</h2>
          <p>Monitor all storage system activities and security events</p>
        </div>
        <div className="header-actions">
          <button
            onClick={() => {
              void handleManualRefresh();
            }}
            className="export-btn refresh-icon-btn"
            disabled={refreshingData}
            title="Refresh data"
            aria-label="Refresh data"
          >
            <i className={`fas fa-rotate-right ${refreshingData ? 'fa-spin' : ''}`}></i>
          </button>
          {selectedLogs.length > 0 && (
            <button onClick={handleExportSelected} className="export-selected-btn">
              <i className="fas fa-file-export"></i>
              Export Selected ({selectedLogs.length})
            </button>
          )}
          <button onClick={handleExport} className="export-btn">
            <i className="fas fa-download"></i>
            Export {filters.operationType || filters.status || filters.dateFrom || filters.dateTo ? 'Filtered' : 'All'}
          </button>
        </div>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon blue">
              <i className="fas fa-list"></i>
            </div>
            <div className="stat-content">
              <p className="stat-label">Total Operations</p>
              <p className="stat-value">{(stats.totalOperations || 0).toLocaleString()}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon green">
              <i className="fas fa-clock"></i>
            </div>
            <div className="stat-content">
              <p className="stat-label">Last 24 Hours</p>
              <p className="stat-value">{(stats.recentActivity || 0).toLocaleString()}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon red">
              <i className="fas fa-exclamation-triangle"></i>
            </div>
            <div className="stat-content">
              <p className="stat-label">Failed (7 days)</p>
              <p className="stat-value">{(stats.failedOperations || 0)}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon purple">
              <i className="fas fa-users"></i>
            </div>
            <div className="stat-content">
              <p className="stat-label">Active Users</p>
              <p className="stat-value">{(stats.topUsers?.length || 0)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="filters-section">
        <div className="filters-row">
          <div className="filter-group">
            <label>Operation Type</label>
            <select
              value={filters.operationType}
              onChange={(e) => handleFilterChange('operationType', e.target.value)}
            >
              <option value="">All Operations</option>
              <option value="upload">Upload</option>
              <option value="download">Download</option>
              <option value="delete">Delete</option>
              <option value="share">Share</option>
              <option value="edit">Edit</option>
              <option value="preview">Preview</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Status</label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="filter-group">
            <label>User</label>
            <select
              value={filters.userId}
              onChange={(e) => handleFilterChange('userId', e.target.value)}
            >
              <option value="">All Users</option>
              {users.map(user => (
                <option key={user.user_id} value={user.user_id}>
                  {user.full_name} ({user.role})
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Date From</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
            />
          </div>

          <div className="filter-group">
            <label>Date To</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => handleFilterChange('dateTo', e.target.value)}
            />
          </div>
        </div>

        <div className="search-row">
          <div className="search-box">
            <i className="fas fa-search"></i>
            <input
              type="text"
              placeholder="Search by user, file, operation, or IP address..."
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
            />
          </div>
          <button onClick={() => setFilters({
            operationType: '',
            status: '',
            userId: '',
            dateFrom: '',
            dateTo: '',
            search: ''
          })} className="clear-btn">
            Clear Filters
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="logs-table-container">
        {selectedLogs.length > 0 && (
          <div className="selection-toolbar">
            <span className="selection-count">
              <i className="fas fa-check-circle"></i>
              {selectedLogs.length} log{selectedLogs.length > 1 ? 's' : ''} selected
            </span>
            <button onClick={() => setSelectedLogs([])} className="clear-selection-btn">
              <i className="fas fa-times"></i>
              Clear Selection
            </button>
          </div>
        )}
        
        {loading ? (
          <div className="loading-state">
            <i className="fas fa-spinner fa-spin"></i>
            <p>Loading audit logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <i className="fas fa-clipboard-list"></i>
            <p>No audit logs found</p>
            <small>Try adjusting your filters</small>
          </div>
        ) : (
          <>
            <table className="logs-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selectedLogs.length === logs.length && logs.length > 0}
                      onChange={handleSelectAll}
                    />
                  </th>
                  <th>Timestamp</th>
                  <th>Operation</th>
                  <th>User</th>
                  <th>File</th>
                  <th>IP Address</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.log_id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedLogs.includes(log.log_id)}
                        onChange={() => handleSelectLog(log.log_id)}
                      />
                    </td>
                    <td className="timestamp-cell">{formatDate(log.created_at)}</td>
                    <td>
                      <div className="operation-cell">
                        <i className={`fas ${getOperationIcon(log.operation_type)}`}></i>
                        <span>{log.operation_type?.replace(/_/g, ' ')}</span>
                      </div>
                    </td>
                    <td>
                      <div className="user-cell">
                        <div className="user-name">{log.user_name || 'Unknown'}</div>
                        <div className="user-meta">{log.user_email} • {log.user_role}</div>
                      </div>
                    </td>
                    <td>
                      <div className="file-cell">
                        <div className="file-name">
                          {(() => {
                            try {
                              const details = JSON.parse(log.operation_details || '{}');
                              return details.filename || details.file_name || '-';
                            } catch {
                              return '-';
                            }
                          })()}
                        </div>
                        <div className="file-size">
                          {(() => {
                            try {
                              const details = JSON.parse(log.operation_details || '{}');
                              return details.size ? formatFileSize(details.size) : '';
                            } catch {
                              return '';
                            }
                          })()}
                        </div>
                      </div>
                    </td>
                    <td className="ip-cell">{log.ip_address || '-'}</td>
                    <td>{getStatusBadge(log.status)}</td>
                    <td className="details-cell">
                      {log.error_message || JSON.parse(log.operation_details || '{}').filename || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="pagination">
              <div className="pagination-info">
                Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                {pagination.total} results
              </div>
              <div className="pagination-controls">
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                  disabled={pagination.page === 1 || loading}
                  aria-label="Go to previous page"
                >
                  Previous
                </button>
                {visiblePages.map((item, index) => {
                  if (item === 'ellipsis') {
                    return (
                      <span key={`ellipsis-${index}`} className="pagination-ellipsis" aria-hidden="true">
                        …
                      </span>
                    );
                  }

                  return (
                    <button
                      key={item}
                      onClick={() => setPagination(prev => ({ ...prev, page: item }))}
                      className={pagination.page === item ? 'active' : ''}
                      disabled={loading}
                      aria-label={`Go to page ${item}`}
                      aria-current={pagination.page === item ? 'page' : undefined}
                    >
                      {item}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                  disabled={pagination.page === pagination.totalPages || loading}
                  aria-label="Go to next page"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default AuditLogsTab;
