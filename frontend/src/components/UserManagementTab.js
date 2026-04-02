import React, { useEffect, useMemo, useState } from 'react';
import { adminUserAPI } from '../services/api';
import Toast from './Toast';
import ConfirmDialog from './ConfirmDialog';
import '../styles/UserManagement.css';

const ROLE_OPTIONS = ['Admin', 'Teacher', 'Student'];
const STATUS_OPTIONS = ['Active', 'Inactive', 'Suspended'];
const STUDENT_LEVEL_OPTIONS = [
  'Standard 1',
  'Standard 2',
  'Standard 3',
  'Standard 4',
  'Standard 5',
  'Standard 6',
  'Form 1',
  'Form 2',
  'Form 3',
  'Form 4',
  'Form 5'
];

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function formatDateCompact(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function getUserCode(user, index) {
  const role = normalizeRole(user.role);
  const prefix = role === 'teacher' ? 'T' : role === 'student' ? 'S' : 'A';
  const numeric = Number.isFinite(Number(user.user_id)) ? Number(user.user_id) : index + 1;
  return `${prefix}${String(numeric).padStart(3, '0')}`;
}

function getStorageData(user) {
  const role = normalizeRole(user.role);
  const usedFromGb = Number(user.storage_used_gb);
  const usedFromBytes = Number(user.storage_used);
  const used = Number.isFinite(usedFromGb)
    ? usedFromGb
    : (Number.isFinite(usedFromBytes) ? usedFromBytes / (1024 * 1024 * 1024) : 0);
  const total = Number(user.storage_total_gb || user.storage_quota_gb);
  const safeUsed = Number.isFinite(used) && used >= 0 ? used : 0;

  if (role === 'admin') {
    return {
      used: safeUsed,
      total: null,
      ratio: 0,
      isUnlimited: true
    };
  }

  const safeTotal = Number.isFinite(total) && total > 0 ? total : (role === 'teacher' ? 2 : 1);
  return {
    used: safeUsed,
    total: safeTotal,
    ratio: Math.min(100, (safeUsed / safeTotal) * 100),
    isUnlimited: false
  };
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function AddUserModal({ onClose, onSubmit, loading }) {
  const [form, setForm] = useState({
    email: '',
    fullName: '',
    role: 'Teacher',
    studentLevel: '',
    temporaryPassword: ''
  });

  const normalizedRole = normalizeRole(form.role);

  const handleChange = (field, value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const submit = (event) => {
    event.preventDefault();
    onSubmit(form);
  };

  return (
    <div className="um-modal-backdrop">
      <div className="um-modal">
        <h3>Add User</h3>
        <form onSubmit={submit}>
          <label>Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(event) => handleChange('email', event.target.value)}
            required
          />

          <label>Full Name</label>
          <input
            type="text"
            value={form.fullName}
            onChange={(event) => handleChange('fullName', event.target.value)}
            required
          />

          <label>Role</label>
          <select value={form.role} onChange={(event) => handleChange('role', event.target.value)}>
            {ROLE_OPTIONS.map((roleOption) => (
              <option key={roleOption} value={roleOption}>
                {roleOption}
              </option>
            ))}
          </select>

          {normalizedRole === 'student' && (
            <>
              <label>Student Level</label>
              <select
                value={form.studentLevel}
                onChange={(event) => handleChange('studentLevel', event.target.value)}
                required
              >
                <option value="">Select Standard/Form</option>
                {STUDENT_LEVEL_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </>
          )}

          <label>Temporary Password (Optional)</label>
          <input
            type="text"
            value={form.temporaryPassword}
            onChange={(event) => handleChange('temporaryPassword', event.target.value)}
            placeholder="Auto-generated if empty"
          />

          <div className="um-modal-actions">
            <button type="button" className="um-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="um-btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditUserModal({ onClose, onSubmit, loading, user, currentAdminId }) {
  const [form, setForm] = useState({
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    studentLevel: user.student_level || '',
    status: user.account_status
  });

  const isSelf = currentAdminId === user.user_id;
  const normalizedRole = normalizeRole(form.role);

  const handleChange = (field, value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const submit = (event) => {
    event.preventDefault();
    onSubmit(form, { roleChanged: form.role !== user.role });
  };

  return (
    <div className="um-modal-backdrop">
      <div className="um-modal">
        <h3>Edit User</h3>
        <form onSubmit={submit}>
          <label>Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(event) => handleChange('email', event.target.value)}
            required
          />

          <label>Full Name</label>
          <input
            type="text"
            value={form.fullName}
            onChange={(event) => handleChange('fullName', event.target.value)}
            required
          />

          <label>Role</label>
          <select
            value={form.role}
            onChange={(event) => handleChange('role', event.target.value)}
            disabled={isSelf}
          >
            {ROLE_OPTIONS.map((roleOption) => (
              <option key={roleOption} value={roleOption.toLowerCase()}>
                {roleOption}
              </option>
            ))}
          </select>

          {normalizedRole === 'student' && (
            <>
              <label>Student Level</label>
              <select
                value={form.studentLevel}
                onChange={(event) => handleChange('studentLevel', event.target.value)}
                required
              >
                <option value="">Select Standard/Form</option>
                {STUDENT_LEVEL_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </>
          )}

          <label>Status</label>
          <select
            value={form.status}
            onChange={(event) => handleChange('status', event.target.value)}
            disabled={isSelf}
          >
            {STATUS_OPTIONS.map((statusOption) => (
              <option key={statusOption} value={statusOption.toLowerCase()}>
                {statusOption}
              </option>
            ))}
          </select>

          <div className="um-modal-actions">
            <button type="button" className="um-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="um-btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UserManagementTab({ currentUser }) {
  const [section, setSection] = useState('users');
  const [toast, setToast] = useState(null);

  const [users, setUsers] = useState([]);
  const [userStats, setUserStats] = useState({
    total_users: 0,
    total_teachers: 0,
    total_students: 0,
    active_users: 0
  });
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: 20 });
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userFilters, setUserFilters] = useState({ search: '', role: '', status: '' });

  const [showAddModal, setShowAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [resettingPasswordUserId, setResettingPasswordUserId] = useState(null);

  const [selectedEnrollUserIds, setSelectedEnrollUserIds] = useState([]);
  const [enrollData, setEnrollData] = useState({ targetType: 'classroom', targetId: '' });
  const [enrollLoading, setEnrollLoading] = useState(false);

  const [rbacData, setRbacData] = useState({ roles: [], permissions: [], matrix: {} });
  const [rbacLoading, setRbacLoading] = useState(false);
  const [rbacSavingRole, setRbacSavingRole] = useState('');
  const [rbacResettingRole, setRbacResettingRole] = useState('');

  const [importFile, setImportFile] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  const [importErrors, setImportErrors] = useState([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [errorCsvLoading, setErrorCsvLoading] = useState(false);

  const [exportLoading, setExportLoading] = useState(false);
  const [exportController, setExportController] = useState(null);
  const [selectedExportUserIds, setSelectedExportUserIds] = useState([]);
  const [showTemplateGuide, setShowTemplateGuide] = useState(false);
  const [exportFilters, setExportFilters] = useState({
    mode: 'selected',
    role: '',
    status: '',
    dateFrom: '',
    dateTo: '',
    userIds: ''
  });
  const [refreshingSection, setRefreshingSection] = useState(false);
  const [confirmDialogState, setConfirmDialogState] = useState({
    open: false,
    title: '',
    message: '',
    actionType: '',
    payload: null
  });
  const [confirmingDialogAction, setConfirmingDialogAction] = useState(false);

  const canResetErrors = importErrors.length > 0;

  const userRows = useMemo(() => users, [users]);

  const exportRows = useMemo(() => {
    const normalizedRoleFilter = normalizeRole(exportFilters.role);
    const normalizedStatusFilter = normalizeStatus(exportFilters.status);

    const fromDate = exportFilters.dateFrom ? new Date(`${exportFilters.dateFrom}T00:00:00`) : null;
    const toDate = exportFilters.dateTo ? new Date(`${exportFilters.dateTo}T23:59:59.999`) : null;

    return userRows.filter((item) => {
      if (normalizedRoleFilter && normalizeRole(item.role) !== normalizedRoleFilter) {
        return false;
      }

      if (normalizedStatusFilter && normalizeStatus(item.account_status) !== normalizedStatusFilter) {
        return false;
      }

      if (fromDate || toDate) {
        const createdAt = new Date(item.created_at);
        if (Number.isNaN(createdAt.getTime())) {
          return false;
        }

        if (fromDate && createdAt < fromDate) {
          return false;
        }

        if (toDate && createdAt > toDate) {
          return false;
        }
      }

      return true;
    });
  }, [
    userRows,
    exportFilters.role,
    exportFilters.status,
    exportFilters.dateFrom,
    exportFilters.dateTo
  ]);

  const showMessage = (message, type = 'success') => {
    setToast({ message, type });
  };

  const fetchUsers = async (page = pagination.page, filterOverrides = {}) => {
    try {
      setLoadingUsers(true);
      const response = await adminUserAPI.getUsers({
        page,
        limit: pagination.limit,
        search: filterOverrides.search !== undefined ? filterOverrides.search : userFilters.search,
        role: filterOverrides.role !== undefined ? filterOverrides.role : userFilters.role,
        status: filterOverrides.status !== undefined ? filterOverrides.status : userFilters.status
      });
      setUsers(response.users || []);
      setUserStats(response.stats || {
        total_users: 0,
        total_teachers: 0,
        total_students: 0,
        active_users: 0
      });
      setPagination(response.pagination || { page: 1, totalPages: 1, total: 0, limit: 20 });
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to load users', 'error');
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchRbac = async () => {
    try {
      setRbacLoading(true);
      const response = await adminUserAPI.getRbac();
      setRbacData(response);
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to load role permissions', 'error');
    } finally {
      setRbacLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (section === 'rbac') {
      fetchRbac();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  useEffect(() => {
    if (section === 'export' || section === 'enroll' || section === 'import') {
      fetchUsers(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const handleAddUser = async (payload) => {
    try {
      setSaving(true);
      await adminUserAPI.addUser(payload);
      setShowAddModal(false);
      showMessage('User created successfully');
      fetchUsers(1);
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to add user', 'error');
    } finally {
      setSaving(false);
    }
  };

  const performEditUser = async (payload) => {
    if (!editTarget) {
      return;
    }

    try {
      setSaving(true);
      await adminUserAPI.editUser(editTarget.user_id, payload);
      setEditTarget(null);
      showMessage('User updated successfully');
      fetchUsers(pagination.page);
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to update user', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEditUser = async (payload, options = {}) => {
    if (options?.roleChanged) {
      setConfirmDialogState({
        open: true,
        title: 'Confirm Role Change',
        message: 'Are you sure you want to change this user role?',
        actionType: 'edit-user-role-change',
        payload
      });
      return;
    }

    await performEditUser(payload);
  };

  const executeSystemResetPassword = async (userId) => {
    if (resettingPasswordUserId === userId) {
      return;
    }

    try {
      setResettingPasswordUserId(userId);
      const response = await adminUserAPI.systemResetPassword(userId);
      if (response?.emailSent === false && response?.temporaryPassword) {
        showMessage(`${response.message} Temporary password: ${response.temporaryPassword}`, 'warning');
      } else {
        showMessage(response?.message || 'System reset completed and email sent.');
      }
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to run system reset password', 'error');
    } finally {
      setResettingPasswordUserId(null);
    }
  };

  const handleSystemResetPassword = (userId) => {
    if (resettingPasswordUserId === userId) {
      return;
    }

    setConfirmDialogState({
      open: true,
      title: 'Confirm System Reset',
      message: 'Run SYSTEM RESET for this user? A new temporary password will be generated and sent to the user email.',
      actionType: 'system-reset-password',
      payload: { userId }
    });
  };

  const toggleEnrollSelection = (userId) => {
    setSelectedEnrollUserIds((previous) => {
      if (previous.includes(userId)) {
        return previous.filter((item) => item !== userId);
      }
      return [...previous, userId];
    });
  };

  const handleEnrollUsers = async () => {
    try {
      setEnrollLoading(true);
      const response = await adminUserAPI.enrollUsers({
        userIds: selectedEnrollUserIds,
        targetType: enrollData.targetType,
        targetId: enrollData.targetId
      });
      showMessage(
        `Enrollment complete: ${response.summary.successCount} success, ${response.summary.failedCount} failed`,
        response.summary.failedCount > 0 ? 'warning' : 'success'
      );
      setSelectedEnrollUserIds([]);
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to enroll users', 'error');
    } finally {
      setEnrollLoading(false);
    }
  };

  const togglePermission = (role, moduleKey, permission) => {
    if (role === 'admin') {
      return;
    }

    setRbacData((previous) => {
      const matrix = { ...previous.matrix };
      const roleData = { ...(matrix[role] || {}) };
      const modulePermissions = [...(roleData[moduleKey] || [])];
      const hasPermission = modulePermissions.includes(permission);

      roleData[moduleKey] = hasPermission
        ? modulePermissions.filter((item) => item !== permission)
        : [...modulePermissions, permission];

      matrix[role] = roleData;
      return { ...previous, matrix };
    });
  };

  const executeSaveRolePermissions = async (role) => {
    if (rbacSavingRole || rbacResettingRole) {
      return;
    }

    try {
      setRbacSavingRole(role);
      const permissionsByModule = rbacData.matrix[role] || {};
      await adminUserAPI.updateRbac({ role, permissionsByModule, confirm: true });
      showMessage('Permissions updated successfully');
      fetchRbac();
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to update role permissions', 'error');
    } finally {
      setRbacSavingRole('');
    }
  };

  const saveRolePermissions = (role) => {
    if (rbacSavingRole || rbacResettingRole) {
      return;
    }

    setConfirmDialogState({
      open: true,
      title: 'Confirm Save Permissions',
      message: `Save permission changes for ${role}?`,
      actionType: 'save-rbac',
      payload: { role }
    });
  };

  const executeResetRolePermissions = async (role) => {
    if (rbacSavingRole || rbacResettingRole) {
      return;
    }

    try {
      setRbacResettingRole(role);
      await adminUserAPI.resetRbacRole(role);
      showMessage(`${role} permissions reset to default`);
      fetchRbac();
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to reset role permissions', 'error');
    } finally {
      setRbacResettingRole('');
    }
  };

  const resetRolePermissions = (role) => {
    if (rbacSavingRole || rbacResettingRole) {
      return;
    }

    setConfirmDialogState({
      open: true,
      title: 'Confirm Reset Permissions',
      message: `Reset ${role} permissions to default?`,
      actionType: 'reset-rbac',
      payload: { role }
    });
  };

  const closeConfirmDialog = () => {
    if (confirmingDialogAction) {
      return;
    }
    setConfirmDialogState({ open: false, title: '', message: '', actionType: '', payload: null });
  };

  const runConfirmDialogAction = async () => {
    if (confirmingDialogAction) {
      return;
    }

    setConfirmingDialogAction(true);
    try {
      const { actionType, payload } = confirmDialogState;

      if (actionType === 'system-reset-password') {
        await executeSystemResetPassword(payload?.userId);
      } else if (actionType === 'save-rbac') {
        await executeSaveRolePermissions(payload?.role);
      } else if (actionType === 'reset-rbac') {
        await executeResetRolePermissions(payload?.role);
      } else if (actionType === 'edit-user-role-change') {
        await performEditUser(payload);
      } else if (actionType === 'delete-user') {
        await executeDeleteUser(payload?.userId);
      }

      setConfirmDialogState({ open: false, title: '', message: '', actionType: '', payload: null });
    } finally {
      setConfirmingDialogAction(false);
    }
  };

  const executeDeleteUser = async (userId) => {
    try {
      await adminUserAPI.deleteUser(userId);
      showMessage('User deleted successfully');
      fetchUsers(pagination.page);
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to delete user', 'error');
    }
  };

  const handleDeleteUser = (userId) => {
    setConfirmDialogState({
      open: true,
      title: 'Confirm Delete User',
      message: 'Are you sure you want to PERMANENTLY delete this user? This action cannot be undone.',
      actionType: 'delete-user',
      payload: { userId }
    });
  };

  const downloadTemplate = async () => {
    if (templateLoading) {
      return;
    }

    try {
      setTemplateLoading(true);
      const blob = await adminUserAPI.downloadImportTemplate();
      downloadBlob(blob, 'user_import_template.csv');
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to download template', 'error');
    } finally {
      setTemplateLoading(false);
    }
  };

  const doImport = async () => {
    if (!importFile) {
      showMessage('Please choose a CSV file first', 'warning');
      return;
    }

    try {
      setImportLoading(true);
      const response = await adminUserAPI.importUsers(importFile);
      setImportSummary(response.summary || null);
      setImportErrors(response.failed || []);
      showMessage('Import completed');
      fetchUsers(1);
    } catch (error) {
      showMessage(error.response?.data?.error || 'Import failed', 'error');
    } finally {
      setImportLoading(false);
    }
  };

  const downloadImportErrorCsv = async () => {
    if (errorCsvLoading) {
      return;
    }

    try {
      setErrorCsvLoading(true);
      const blob = await adminUserAPI.downloadImportErrors(importErrors);
      downloadBlob(blob, `import_errors_${Date.now()}.csv`);
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to download error report', 'error');
    } finally {
      setErrorCsvLoading(false);
    }
  };

  const doExport = async () => {
    if (exportFilters.mode === 'selected' && selectedExportUserIds.length === 0) {
      showMessage('Please select at least one user before export', 'warning');
      return;
    }

    const controller = new AbortController();
    setExportController(controller);

    try {
      setExportLoading(true);
      const blob = await adminUserAPI.exportUsers(
        {
          ...exportFilters,
          userIds: selectedExportUserIds.join(',')
        },
        controller.signal
      );
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      downloadBlob(blob, `users_export_${stamp}.csv`);
      showMessage('Users exported successfully');
    } catch (error) {
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        showMessage('Export canceled', 'info');
      } else {
        showMessage(error.response?.data?.error || 'Export failed', 'error');
      }
    } finally {
      setExportLoading(false);
      setExportController(null);
    }
  };

  const cancelExport = () => {
    if (exportController) {
      exportController.abort();
    }
  };

  const toggleExportSelection = (userId) => {
    setSelectedExportUserIds((previous) => {
      if (previous.includes(userId)) {
        return previous.filter((item) => item !== userId);
      }
      return [...previous, userId];
    });
  };

  const toggleSelectAllExportUsers = () => {
    if (exportRows.length === 0) {
      setSelectedExportUserIds([]);
      return;
    }

    const visibleIds = exportRows.map((item) => item.user_id);
    const allSelected = visibleIds.every((id) => selectedExportUserIds.includes(id));

    setSelectedExportUserIds((previous) => {
      if (allSelected) {
        return previous.filter((id) => !visibleIds.includes(id));
      }

      return Array.from(new Set([...previous, ...visibleIds]));
    });
  };

  const handleRefreshSection = async () => {
    if (refreshingSection) {
      return;
    }

    setRefreshingSection(true);
    try {
      if (section === 'users' || section === 'enroll') {
        await fetchUsers(1);
      } else if (section === 'rbac') {
        await fetchRbac();
      } else if (section === 'import' || section === 'export') {
        await fetchUsers(1);
      }
    } finally {
      setRefreshingSection(false);
    }
  };

  return (
    <div className="um-container">
      <div className="um-header-row">
        <div className="um-tabs">
          {['users', 'enroll', 'rbac', 'import', 'export'].map((item) => (
            <button
              key={item}
              className={`um-tab ${section === item ? 'active' : ''}`}
              onClick={() => setSection(item)}
            >
              {item.toUpperCase()}
            </button>
          ))}
        </div>

        {section === 'users' && (
          <div className="um-modal-actions">
            <button
              className="um-btn-secondary"
              onClick={() => {
                void handleRefreshSection();
              }}
              disabled={refreshingSection}
              title="Refresh data"
            >
              <i className={`fas ${refreshingSection ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`}></i>
            </button>
            <button className="um-btn-primary" onClick={() => setShowAddModal(true)}>
              Add User
            </button>
          </div>
        )}

        {section !== 'users' && (
          <button
            className="um-btn-secondary"
            onClick={() => {
              void handleRefreshSection();
            }}
            disabled={refreshingSection}
            title="Refresh data"
          >
            <i className={`fas ${refreshingSection ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`}></i>
          </button>
        )}
      </div>

      {section === 'users' && (
        <div className="um-card um-users-card">
          <h3 className="um-users-title">User Management</h3>

          <div className="um-stats-grid">
            <div className="um-stat-card total">
              <div>
                <p className="um-stat-label">Total Users</p>
                <h4 className="um-stat-value">{userStats.total_users}</h4>
              </div>
              <span className="um-stat-icon"><i className="fas fa-users"></i></span>
            </div>
            <div className="um-stat-card teacher">
              <div>
                <p className="um-stat-label">Teachers</p>
                <h4 className="um-stat-value">{userStats.total_teachers}</h4>
              </div>
              <span className="um-stat-icon"><i className="fas fa-chalkboard-teacher"></i></span>
            </div>
            <div className="um-stat-card student">
              <div>
                <p className="um-stat-label">Students</p>
                <h4 className="um-stat-value">{userStats.total_students}</h4>
              </div>
              <span className="um-stat-icon"><i className="fas fa-user-graduate"></i></span>
            </div>
            <div className="um-stat-card active">
              <div>
                <p className="um-stat-label">Active Users</p>
                <h4 className="um-stat-value">{userStats.active_users}</h4>
              </div>
              <span className="um-stat-icon"><i className="fas fa-user-check"></i></span>
            </div>
          </div>

          <div className="um-users-toolbar">
            <div className="um-users-filters">
              <div className="um-search-wrap">
                <i className="fas fa-search"></i>
                <input
                  type="text"
                  placeholder="Search users..."
                  value={userFilters.search}
                  onChange={(event) => setUserFilters((prev) => ({ ...prev, search: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      fetchUsers(1, { search: event.target.value });
                    }
                  }}
                />
              </div>

              <select
                value={userFilters.role}
                onChange={(event) => {
                  const value = event.target.value.toLowerCase();
                  setUserFilters((prev) => ({ ...prev, role: value }));
                  fetchUsers(1, { role: value });
                }}
              >
                <option value="">All Roles</option>
                {ROLE_OPTIONS.map((roleOption) => (
                  <option key={roleOption} value={roleOption.toLowerCase()}>
                    {roleOption}
                  </option>
                ))}
              </select>

              <select
                value={userFilters.status}
                onChange={(event) => {
                  const value = event.target.value.toLowerCase();
                  setUserFilters((prev) => ({ ...prev, status: value }));
                  fetchUsers(1, { status: value });
                }}
              >
                <option value="">All Status</option>
                {STATUS_OPTIONS.map((statusOption) => (
                  <option key={statusOption} value={statusOption.toLowerCase()}>
                    {statusOption}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="um-table-wrap">
            <table className="um-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Storage</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!loadingUsers && userRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="um-empty">
                      No users found
                    </td>
                  </tr>
                )}
                {userRows.map((item, index) => {
                  const role = normalizeRole(item.role);
                  const status = normalizeStatus(item.account_status);
                  const storageData = getStorageData(item);

                  return (
                  <tr key={item.user_id}>
                    <td>
                      <div className="um-user-cell">
                        <span className={`um-user-avatar ${role}`}>{String(item.full_name || 'U').charAt(0).toUpperCase()}</span>
                        <div>
                          <strong>{item.full_name}</strong>
                          <p>
                            {getUserCode(item, index)} • {item.email}
                            {role === 'student' && item.student_level ? ` • ${item.student_level}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`um-role-badge ${role}`}>
                        <i className={`fas ${role === 'teacher' ? 'fa-chalkboard-teacher' : role === 'student' ? 'fa-user-graduate' : 'fa-user-shield'}`}></i>
                        {item.role}
                      </span>
                    </td>
                    <td><span className={`um-status-badge ${status}`}>{item.account_status}</span></td>
                    <td>
                      <div className="um-storage-cell">
                        <span>{storageData.used.toFixed(2)} GB</span>
                        <div className="um-storage-bar"><div style={{ width: `${storageData.ratio}%` }}></div></div>
                        <small>{storageData.isUnlimited ? 'Unlimited' : `${storageData.total.toFixed(0)} GB`}</small>
                      </div>
                    </td>
                    <td>{formatDateCompact(item.last_login)}</td>
                    <td>
                      <div className="um-actions um-icon-actions">
                        <button className="um-btn-icon" title="Edit User" onClick={() => setEditTarget(item)}>
                          <i className="fas fa-pen"></i>
                        </button>
                        <button
                          className="um-btn-icon"
                          title="System Reset Password (Send Email)"
                          onClick={() => handleSystemResetPassword(item.user_id)}
                          disabled={resettingPasswordUserId === item.user_id}
                        >
                          <i className={`fas ${resettingPasswordUserId === item.user_id ? 'fa-spinner fa-spin' : 'fa-key'}`}></i>
                        </button>
                        <button
                          className="um-btn-icon delete"
                          title="Delete User"
                          onClick={() => handleDeleteUser(item.user_id)}
                          disabled={currentUser?.userId === item.user_id}
                        >
                          <i className="fas fa-trash"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
                })}
              </tbody>
            </table>
          </div>

          <div className="um-pagination modern">
            <span>Showing 1 to {userRows.length} of {pagination.total} users</span>
            <div className="um-page-controls">
              <button
                className="um-btn-secondary"
                onClick={() => fetchUsers(Math.max(1, pagination.page - 1))}
                disabled={pagination.page <= 1}
              >
                Previous
              </button>
              <span className="um-page-current">{pagination.page}</span>
              <button
                className="um-btn-secondary"
                onClick={() => fetchUsers(Math.min(pagination.totalPages, pagination.page + 1))}
                disabled={pagination.page >= pagination.totalPages}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {section === 'enroll' && (
        <div className="um-card">
          <h3>Enroll User</h3>
          <div className="um-filter-grid">
            <input
              type="text"
              placeholder="Search users by name/email"
              value={userFilters.search}
              onChange={(event) => setUserFilters((prev) => ({ ...prev, search: event.target.value }))}
            />
            <select
              value={enrollData.targetType}
              onChange={(event) => setEnrollData((prev) => ({ ...prev, targetType: event.target.value }))}
            >
              <option value="classroom">Classroom</option>
              <option value="course">Course</option>
            </select>
            <input
              type="number"
              placeholder="Classroom/Course ID"
              value={enrollData.targetId}
              onChange={(event) => setEnrollData((prev) => ({ ...prev, targetId: event.target.value }))}
            />
            <button className="um-btn-secondary" onClick={() => fetchUsers(1)}>
              Search
            </button>
          </div>

          <div className="um-table-wrap">
            <table className="um-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Level</th>
                </tr>
              </thead>
              <tbody>
                {users.map((item, index) => {
                  const role = normalizeRole(item.role);

                  return (
                    <tr key={item.user_id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedEnrollUserIds.includes(item.user_id)}
                          onChange={() => toggleEnrollSelection(item.user_id)}
                        />
                      </td>
                      <td>
                        <div className="um-user-cell">
                          <span className={`um-user-avatar ${role}`}>{String(item.full_name || 'U').charAt(0).toUpperCase()}</span>
                          <div>
                            <strong>{item.full_name}</strong>
                            <p>{getUserCode(item, index)}</p>
                          </div>
                        </div>
                      </td>
                      <td>{item.email}</td>
                      <td>
                        <span className={`um-role-badge ${role}`}>{item.role}</span>
                      </td>
                      <td>{role === 'student' ? (item.student_level || '-') : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="um-modal-actions">
            <button className="um-btn-secondary" onClick={() => setSelectedEnrollUserIds([])}>
              Cancel
            </button>
            <button className="um-btn-primary" onClick={handleEnrollUsers} disabled={enrollLoading}>
              {enrollLoading ? 'Enrolling...' : 'Enroll Selected Users'}
            </button>
          </div>
        </div>
      )}

      {section === 'rbac' && (
        <div className="um-card um-rbac-section">
          <div className="um-rbac-head">
            <h3>Role & Permission (RBAC)</h3>
            <p>Configure module access for each role.</p>
          </div>
          {rbacLoading && <p>Loading permissions...</p>}
          {!rbacLoading && (
            <div className="um-rbac-grid">
              {rbacData.roles.map((role) => {
                const modules = Object.keys(rbacData.matrix[role] || {});
                const roleLabel = String(role || '').toUpperCase();
                const roleIcon = role === 'admin' ? 'fa-user-shield' : role === 'teacher' ? 'fa-chalkboard-teacher' : 'fa-user-graduate';

                return (
                  <div className="um-rbac-card" key={role}>
                    <div className="um-rbac-card-head">
                      <h4>
                        <i className={`fas ${roleIcon}`}></i>
                        {roleLabel}
                      </h4>
                      {role === 'admin' && <span className="um-rbac-lock">System Default</span>}
                    </div>

                    {modules.length === 0 && <p>No permissions configured</p>}
                    {modules.map((moduleKey) => (
                      <div key={`${role}-${moduleKey}`} className="um-rbac-module">
                        <strong>{moduleKey.replace(/_/g, ' ')}</strong>
                        <div className="um-rbac-perms">
                          {rbacData.permissions.map((permission) => (
                            <label key={`${role}-${moduleKey}-${permission}`} className="um-rbac-perm-item">
                              <input
                                type="checkbox"
                                checked={(rbacData.matrix[role]?.[moduleKey] || []).includes(permission)}
                                disabled={role === 'admin'}
                                onChange={() => togglePermission(role, moduleKey, permission)}
                              />
                              <span>{permission}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}

                    {role !== 'admin' && (
                      <div className="um-modal-actions um-rbac-actions">
                        <button
                          className="um-btn-secondary"
                          onClick={() => resetRolePermissions(role)}
                          disabled={rbacSavingRole === role || rbacResettingRole === role}
                        >
                          {rbacResettingRole === role ? 'Resetting...' : 'Reset to Default'}
                        </button>
                        <button
                          className="um-btn-primary"
                          onClick={() => saveRolePermissions(role)}
                          disabled={rbacSavingRole === role || rbacResettingRole === role}
                        >
                          {rbacSavingRole === role ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {section === 'import' && (
        <div className="um-card">
          <h3>Import Users (CSV)</h3>
          <div className="um-import-actions">
            <button className="um-btn-secondary" onClick={downloadTemplate} disabled={templateLoading}>
              <i className="fas fa-file-csv"></i>
              {templateLoading ? 'Downloading Template Sheet...' : 'Download Template Sheet'}
            </button>
            <button
              className="um-btn-secondary"
              onClick={() => setShowTemplateGuide((previous) => !previous)}
              type="button"
            >
              <i className="fas fa-table"></i>
              {showTemplateGuide ? 'Hide Template Guide' : 'View Template Guide'}
            </button>
            <input type="file" accept=".csv" onChange={(event) => setImportFile(event.target.files?.[0] || null)} />
            <button className="um-btn-primary" onClick={doImport} disabled={importLoading}>
              {importLoading ? 'Importing...' : 'Import Users'}
            </button>
          </div>

          {showTemplateGuide && (
            <div className="um-template-guide">
              <p>Use the template sheet to avoid wrong data. Required columns: <strong>email</strong>, <strong>full_name</strong>, <strong>role</strong>, <strong>status</strong>.</p>
              <p>Allowed values: role = Admin/Teacher/Student, status = Active/Inactive, student_level required for Student.</p>
            </div>
          )}

          {importSummary && (
            <div className="um-summary">
              <p>Total Rows: {importSummary.totalRows}</p>
              <p>Successful Imports: {importSummary.successfulImports}</p>
              <p>Failed Imports: {importSummary.failedImports}</p>
            </div>
          )}

          {canResetErrors && (
            <div className="um-import-errors">
              <button className="um-btn-secondary" onClick={downloadImportErrorCsv} disabled={errorCsvLoading}>
                {errorCsvLoading ? 'Downloading Error Report...' : 'Download Error Report CSV'}
              </button>
              <div className="um-table-wrap">
                <table className="um-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Email</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importErrors.map((item, index) => (
                      <tr key={`${item.row}-${index}`}>
                        <td>{item.row}</td>
                        <td>{item.email}</td>
                        <td>{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {section === 'export' && (
        <div className="um-card">
          <h3>Export Users (CSV)</h3>
          <div className="um-filter-grid">
            <select
              value={exportFilters.mode}
              onChange={(event) => setExportFilters((prev) => ({ ...prev, mode: event.target.value }))}
            >
              <option value="selected">Export Selected</option>
              <option value="all">Export All</option>
              <option value="filtered">Export Filtered</option>
            </select>
            <select
              value={exportFilters.role}
              onChange={(event) => setExportFilters((prev) => ({ ...prev, role: event.target.value }))}
            >
              <option value="">All Roles</option>
              {ROLE_OPTIONS.map((roleOption) => (
                <option key={roleOption} value={roleOption.toLowerCase()}>
                  {roleOption}
                </option>
              ))}
            </select>
            <select
              value={exportFilters.status}
              onChange={(event) => setExportFilters((prev) => ({ ...prev, status: event.target.value }))}
            >
              <option value="">All Status</option>
              {STATUS_OPTIONS.map((statusOption) => (
                <option key={statusOption} value={normalizeStatus(statusOption)}>
                  {statusOption}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={exportFilters.dateFrom}
              onChange={(event) => setExportFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
            />
            <input
              type="date"
              value={exportFilters.dateTo}
              onChange={(event) => setExportFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
            />
          </div>

          <div className="um-export-select-head">
            <button className="um-btn-secondary" onClick={toggleSelectAllExportUsers} type="button">
              {exportRows.length > 0 && exportRows.every((row) => selectedExportUserIds.includes(row.user_id)) ? 'Unselect All' : 'Select All'}
            </button>
            <span>{selectedExportUserIds.length} user(s) selected for export</span>
          </div>

          <div className="um-table-wrap">
            <table className="um-table">
              <thead>
                <tr>
                  <th className="um-col-check">Select</th>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {exportRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="um-empty">No users match current filters</td>
                  </tr>
                )}
                {exportRows.map((item, index) => {
                  const role = normalizeRole(item.role);
                  const status = normalizeStatus(item.account_status);
                  return (
                    <tr key={`export-${item.user_id}`}>
                      <td className="um-col-check">
                        <input
                          type="checkbox"
                          checked={selectedExportUserIds.includes(item.user_id)}
                          onChange={() => toggleExportSelection(item.user_id)}
                        />
                      </td>
                      <td>
                        <div className="um-user-cell">
                          <span className={`um-user-avatar ${role}`}>{String(item.full_name || 'U').charAt(0).toUpperCase()}</span>
                          <div>
                            <strong>{item.full_name}</strong>
                            <p>{getUserCode(item, index)} • {item.email}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`um-role-badge ${role}`}>{item.role}</span>
                      </td>
                      <td>
                        <span className={`um-status-badge ${status}`}>{item.account_status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="um-modal-actions">
            <button className="um-btn-secondary" onClick={cancelExport} disabled={!exportLoading}>
              Cancel Export
            </button>
            <button className="um-btn-primary" onClick={doExport} disabled={exportLoading}>
              {exportLoading ? 'Generating Export...' : (exportFilters.mode === 'selected' ? 'Export Selected Users' : 'Export Users')}
            </button>
          </div>
        </div>
      )}

      {showAddModal && <AddUserModal onClose={() => setShowAddModal(false)} onSubmit={handleAddUser} loading={saving} />}
      {editTarget && (
        <EditUserModal
          onClose={() => setEditTarget(null)}
          onSubmit={handleEditUser}
          loading={saving}
          user={editTarget}
          currentAdminId={currentUser?.userId}
        />
      )}
      <ConfirmDialog
        isOpen={confirmDialogState.open}
        title={confirmDialogState.title}
        message={confirmDialogState.message}
        onCancel={closeConfirmDialog}
        onConfirm={() => {
          void runConfirmDialogAction();
        }}
        isConfirming={confirmingDialogAction}
        confirmText="Confirm"
        confirmingText="Confirming..."
      />
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

export default UserManagementTab;
