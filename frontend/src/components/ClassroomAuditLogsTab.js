import React, { useEffect, useMemo, useState } from 'react';
import { classroomAPI } from '../services/api';
import '../styles/ClassroomAuditLogs.css';

const PAGE_SIZE = 10;

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function getOperationIcon(operationType) {
  const map = {
    class_created: 'fa-plus-circle',
    class_archived: 'fa-archive',
    class_announcement_posted: 'fa-bullhorn',
    class_join_code: 'fa-key',
    student_enrolled: 'fa-user-plus',
    student_removed: 'fa-user-minus',
    student_list_managed: 'fa-users-cog',
    attendance_taken: 'fa-clipboard-check',
    attendance_modified: 'fa-clipboard-list',
    material_uploaded: 'fa-upload',
    material_downloaded: 'fa-download',
    material_previewed: 'fa-eye',
    material_deleted: 'fa-trash',
    assignment_created: 'fa-list-check',
    assignment_submitted: 'fa-paper-plane',
    assignment_graded: 'fa-star',
    class_restored: 'fa-rotate-left',
    teacher_state_saved: 'fa-save'
  };

  return map[operationType] || 'fa-circle';
}

function parseLogDetails(details) {
  if (!details) {
    return null;
  }
  if (typeof details === 'object') {
    return details;
  }
  try {
    return JSON.parse(String(details));
  } catch (_error) {
    return null;
  }
}

function buildVisiblePages(totalPages, currentPage) {
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
}

function ClassroomAuditLogsTab() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [operationFilter, setOperationFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ total: 0, successful: 0, warnings: 0, failed: 0 });
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
  const [loading, setLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const [exportingLogs, setExportingLogs] = useState(false);
  const [copyingJson, setCopyingJson] = useState(false);
  const [actionNotice, setActionNotice] = useState('');
  const [refreshingData, setRefreshingData] = useState(false);
  const [classrooms, setClassrooms] = useState([]);
  const [loadingClassrooms, setLoadingClassrooms] = useState(false);
  const [restoringKey, setRestoringKey] = useState('');

  const loadStats = async () => {
    try {
      const response = await classroomAPI.getAuditStats();
      setStats(response?.stats || { total: 0, successful: 0, warnings: 0, failed: 0 });
    } catch (error) {
      console.error('Failed to load classroom audit stats:', error);
      setStats({ total: 0, successful: 0, warnings: 0, failed: 0 });
    }
  };

  const loadLogs = async () => {
    try {
      setLoading(true);
      const response = await classroomAPI.getAuditLogs({
        page,
        limit: PAGE_SIZE,
        status: statusFilter === 'all' ? '' : statusFilter,
        operationType: operationFilter === 'all' ? '' : operationFilter,
        search: search.trim()
      });

      setLogs(Array.isArray(response?.logs) ? response.logs : []);
      setPagination(response?.pagination || { page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } catch (error) {
      console.error('Failed to load classroom audit logs:', error);
      setLogs([]);
      setPagination({ page: 1, totalPages: 1, total: 0, limit: PAGE_SIZE });
    } finally {
      setLoading(false);
    }
  };

  const loadClassrooms = async () => {
    try {
      setLoadingClassrooms(true);
      const response = await classroomAPI.getAdminClassrooms();
      setClassrooms(Array.isArray(response?.classrooms) ? response.classrooms : []);
    } catch (error) {
      console.error('Failed to load classrooms:', error);
      setClassrooms([]);
    } finally {
      setLoadingClassrooms(false);
    }
  };

  useEffect(() => {
    loadStats();
    loadClassrooms();
  }, []);

  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, operationFilter, search]);

  const handleManualRefresh = async () => {
    if (refreshingData) {
      return;
    }

    setRefreshingData(true);
    setActionNotice('');
    try {
      await Promise.all([loadStats(), loadLogs(), loadClassrooms()]);
      setActionNotice('Audit data refreshed.');
    } finally {
      setRefreshingData(false);
    }
  };

  const restoreClassroom = async (classroom) => {
    const classroomId = Number(classroom?.classroomId);
    const ownerTeacherId = Number(classroom?.ownerTeacherId);
    if (!Number.isInteger(classroomId) || classroomId <= 0 || !Number.isInteger(ownerTeacherId) || ownerTeacherId <= 0) {
      return;
    }

    const key = `${ownerTeacherId}:${classroomId}`;
    if (restoringKey) {
      return;
    }

    try {
      setRestoringKey(key);
      setActionNotice('');
      await classroomAPI.restoreAdminClassroom(classroomId, ownerTeacherId);
      await Promise.all([loadClassrooms(), loadStats(), loadLogs()]);
      setActionNotice('Class restored successfully.');
    } catch (error) {
      console.error('Failed to restore classroom:', error);
      setActionNotice(error?.response?.data?.error || 'Failed to restore classroom.');
    } finally {
      setRestoringKey('');
    }
  };

  const archivedClassrooms = useMemo(
    () => classrooms.filter((item) => String(item?.status || '').trim().toLowerCase() === 'archived'),
    [classrooms]
  );

  const operationOptions = useMemo(
    () => Array.from(new Set(logs.map((item) => item.operationType))).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [logs]
  );

  const visiblePages = useMemo(
    () => buildVisiblePages(pagination.totalPages, pagination.page),
    [pagination.totalPages, pagination.page]
  );

  const startIndex = pagination.total === 0 ? 0 : ((pagination.page - 1) * PAGE_SIZE) + 1;
  const endIndex = Math.min(pagination.page * PAGE_SIZE, pagination.total);

  const exportFilteredLogs = async () => {
    if (exportingLogs) {
      return;
    }

    try {
      setExportingLogs(true);
      setActionNotice('');
      const blob = await classroomAPI.exportAuditLogs();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `classroom-activity-logs-${Date.now()}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setActionNotice('Export completed. CSV download started.');
    } catch (error) {
      console.error('Failed to export classroom audit logs:', error);
      setActionNotice('Failed to export classroom audit logs.');
    } finally {
      setExportingLogs(false);
    }
  };

  const detailsObject = selectedLog ? parseLogDetails(selectedLog.details) : null;

  const applySameUserFilter = () => {
    if (!selectedLog?.userName) {
      return;
    }
    setSearch(String(selectedLog.userName));
    setPage(1);
    setSelectedLog(null);
  };

  const applySameTargetFilter = () => {
    if (!selectedLog?.target || selectedLog.target === '-') {
      return;
    }
    setSearch(String(selectedLog.target));
    setPage(1);
    setSelectedLog(null);
  };

  const copyDetailsJson = async () => {
    if (!selectedLog) {
      return;
    }

    if (copyingJson) {
      return;
    }

    const payload = {
      id: selectedLog.id,
      timestamp: selectedLog.timestamp,
      operation: selectedLog.operation,
      operationType: selectedLog.operationType,
      userName: selectedLog.userName,
      userCode: selectedLog.userCode,
      userRole: selectedLog.userRole,
      target: selectedLog.target,
      targetType: selectedLog.targetType,
      status: selectedLog.status,
      details: selectedLog.details
    };

    try {
      setCopyingJson(true);
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setActionNotice('Log JSON copied');
    } catch (_error) {
      setActionNotice('Failed to copy JSON');
    } finally {
      setCopyingJson(false);
    }
  };

  return (
    <div className="audit-logs-tab classroom-audit-tab">
      <div className="admin-classrooms-panel">
        <div className="admin-classrooms-panel-header">
          <h3>Classrooms (Archived Folder)</h3>
          <span>
            {loadingClassrooms
              ? <><i className="fas fa-spinner fa-spin"></i> Loading classrooms...</>
              : `${classrooms.length} total • ${archivedClassrooms.length} archived`}
          </span>
        </div>

        <div className="admin-classrooms-table-wrap">
          <table className="admin-classrooms-table">
            <thead>
              <tr>
                <th>Classroom</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Location</th>
                <th>Schedule</th>
                <th>Auto Delete</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {classrooms.map((classroom) => {
                const status = String(classroom?.status || 'Active');
                const isArchived = status.toLowerCase() === 'archived';
                const key = `${classroom.ownerTeacherId}:${classroom.classroomId}`;
                const isRestoring = restoringKey === key;

                return (
                  <tr key={key}>
                    <td>
                      <div className="admin-classrooms-primary">{classroom.classroomName}</div>
                      <div className="admin-classrooms-secondary">ID #{classroom.classroomId}</div>
                    </td>
                    <td>{classroom.ownerTeacherName}</td>
                    <td>
                      <span className={`classroom-admin-status-pill ${isArchived ? 'archived' : 'active'}`}>
                        {status}
                      </span>
                    </td>
                    <td>{classroom.location || (isArchived ? 'Archived Folder' : 'Active Classrooms')}</td>
                    <td>{classroom.classSchedule || '-'}</td>
                    <td>{isArchived && classroom.expiresAt ? formatDateTime(classroom.expiresAt) : '-'}</td>
                    <td>
                      {isArchived ? (
                        <button
                          type="button"
                          className="classroom-admin-restore-btn"
                          onClick={() => {
                            void restoreClassroom(classroom);
                          }}
                          disabled={Boolean(restoringKey)}
                        >
                          <i className={`fas ${isRestoring ? 'fa-spinner fa-spin' : 'fa-rotate-left'}`}></i>
                          {isRestoring ? 'Restoring...' : 'Restore'}
                        </button>
                      ) : (
                        <span className="classroom-admin-action-muted">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!loadingClassrooms && classrooms.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: '#64748b' }}>
                    No classrooms found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="classroom-audit-stats">
        <div className="classroom-audit-stat">
          <div>
            <p>Total Operations</p>
            <strong>{stats.total}</strong>
          </div>
          <span className="icon blue"><i className="fas fa-chart-line"></i></span>
        </div>

        <div className="classroom-audit-stat">
          <div>
            <p>Successful</p>
            <strong>{stats.successful}</strong>
          </div>
          <span className="icon green"><i className="fas fa-check-circle"></i></span>
        </div>

        <div className="classroom-audit-stat">
          <div>
            <p>Warnings</p>
            <strong>{stats.warnings}</strong>
          </div>
          <span className="icon yellow"><i className="fas fa-exclamation-triangle"></i></span>
        </div>

        <div className="classroom-audit-stat">
          <div>
            <p>Failed</p>
            <strong>{stats.failed}</strong>
          </div>
          <span className="icon red"><i className="fas fa-times-circle"></i></span>
        </div>
      </div>

      <div className="classroom-audit-toolbar">
        <div className="search-box">
          <i className="fas fa-search"></i>
          <input
            type="text"
            placeholder="Search by user, target, or details..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="classroom-audit-toolbar-actions">
          <button
            className="clear-btn classroom-refresh-btn"
            onClick={() => {
              void handleManualRefresh();
            }}
            disabled={refreshingData}
            title="Refresh data"
            aria-label="Refresh data"
          >
            <i className={`fas fa-rotate-right ${refreshingData ? 'fa-spin' : ''}`}></i>
          </button>
          <button className="clear-btn" onClick={() => setShowFilters((previous) => !previous)}>
            <i className="fas fa-filter"></i>
            Filters
          </button>
          <button className="export-btn" onClick={exportFilteredLogs} disabled={exportingLogs}>
            <i className={`fas ${exportingLogs ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
            {exportingLogs ? 'Exporting...' : 'Export'}
          </button>
        </div>
      </div>

      {actionNotice && <p className="classroom-audit-action-notice">{actionNotice}</p>}

      {showFilters && (
        <div className="classroom-audit-filter-panel">
          <div className="filter-group">
            <label>Status</label>
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All Status</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Operation</label>
            <select
              value={operationFilter}
              onChange={(event) => {
                setOperationFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All Operations</option>
              {operationOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="logs-table-container classroom">
        <table className="logs-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Operation</th>
              <th>User</th>
              <th>Target</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="timestamp-cell">{formatDateTime(log.timestamp)}</td>
                <td>
                  <div className="operation-cell">
                    <i className={`fas ${getOperationIcon(log.operationType)}`}></i>
                    <span>{log.operation}</span>
                  </div>
                </td>
                <td>
                  <div className="user-cell">
                    <div className="user-name">{log.userName}</div>
                    <div className="user-meta">{log.userCode} • {log.userRole}</div>
                  </div>
                </td>
                <td>
                  <div className="file-cell">
                    <div className="file-name">{log.target}</div>
                    <div className="file-size">{log.targetType}</div>
                  </div>
                </td>
                <td>
                  <span className={`classroom-status-pill ${log.status}`}>
                    <i className={`fas ${log.status === 'success' ? 'fa-check-circle' : log.status === 'warning' ? 'fa-exclamation-triangle' : 'fa-times-circle'}`}></i>
                    {String(log.status || '').charAt(0).toUpperCase() + String(log.status || '').slice(1)}
                  </span>
                </td>
                <td>
                  <button className="classroom-view-btn" title="View Details" onClick={() => setSelectedLog(log)}>
                    <i className="fas fa-eye"></i>
                  </button>
                </td>
              </tr>
            ))}

            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: '#64748b' }}>
                  No classroom activity logs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="pagination classroom-pagination">
          <div className="pagination-info">
            {loading ? <><i className="fas fa-spinner fa-spin"></i> Loading logs...</> : `Showing ${startIndex} to ${endIndex} of ${pagination.total} results`}
          </div>
          <div className="pagination-controls">
            <button
              onClick={() => setPage(Math.max(1, pagination.page - 1))}
              disabled={pagination.page <= 1 || loading}
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
                  className={pagination.page === item ? 'active' : ''}
                  onClick={() => setPage(item)}
                  disabled={loading}
                  aria-label={`Go to page ${item}`}
                  aria-current={pagination.page === item ? 'page' : undefined}
                >
                  {item}
                </button>
              );
            })}
            <button
              onClick={() => setPage(Math.min(Math.max(1, pagination.totalPages), pagination.page + 1))}
              disabled={pagination.page >= Math.max(1, pagination.totalPages) || loading}
              aria-label="Go to next page"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {selectedLog && (
        <div className="classroom-log-modal-backdrop" onClick={() => setSelectedLog(null)}>
          <div className="classroom-log-modal" onClick={(event) => event.stopPropagation()}>
            <div className="classroom-log-modal-header">
              <h3>Log Details</h3>
              <button className="classroom-log-close" onClick={() => setSelectedLog(null)}>
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="classroom-log-grid">
              <div><strong>Timestamp</strong><p>{formatDateTime(selectedLog.timestamp)}</p></div>
              <div><strong>Operation</strong><p>{selectedLog.operation}</p></div>
              <div><strong>User</strong><p>{selectedLog.userName} ({selectedLog.userCode})</p></div>
              <div><strong>Role</strong><p>{selectedLog.userRole}</p></div>
              <div><strong>Target</strong><p>{selectedLog.target}</p></div>
              <div><strong>Status</strong><p>{selectedLog.status}</p></div>
            </div>

            <div className="classroom-log-details-block">
              <strong>Details JSON</strong>
              <pre>{JSON.stringify(detailsObject || selectedLog.details || {}, null, 2)}</pre>
            </div>

            <div className="classroom-log-modal-actions">
              <button type="button" className="secondary" onClick={applySameUserFilter}>Filter same user</button>
              <button type="button" className="secondary" onClick={applySameTargetFilter}>Filter same target</button>
              <button type="button" className="secondary" onClick={copyDetailsJson} disabled={copyingJson}>
                {copyingJson ? 'Copying...' : 'Copy JSON'}
              </button>
              <button type="button" className="primary" onClick={() => setSelectedLog(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ClassroomAuditLogsTab;
