import axios from 'axios';
import { storage } from '../utils/storage';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Authentication API calls
export const authAPI = {
  login: async (email, password, role, rememberMe = false) => {
    const response = await api.post('/auth/login', { email, password, role, rememberMe });
    return response.data;
  },

  logout: async () => {
    const response = await api.post('/auth/logout');
    return response.data;
  },

  getCurrentUser: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  }
};

export const adminUserAPI = {
  getUsers: async (params = {}) => {
    const response = await api.get('/admin/users', { params });
    return response.data;
  },

  getUserStats: async () => {
    const response = await api.get('/admin/users/stats');
    return response.data;
  },

  addUser: async (payload) => {
    const response = await api.post('/admin/users', payload);
    return response.data;
  },

  editUser: async (userId, payload) => {
    const response = await api.put(`/admin/users/${userId}`, payload);
    return response.data;
  },

  resetPassword: async (userId) => {
    const response = await api.post(`/admin/users/${userId}/reset-password`);
    return response.data;
  },

  systemResetPassword: async (userId) => {
    const response = await api.post(`/admin/users/${userId}/system-reset-password`);
    return response.data;
  },

  enrollUsers: async (payload) => {
    const response = await api.post('/admin/users/enroll', payload);
    return response.data;
  },

  getRbac: async () => {
    const response = await api.get('/admin/rbac');
    return response.data;
  },

  updateRbac: async (payload) => {
    const response = await api.put('/admin/rbac', payload);
    return response.data;
  },

  resetRbacRole: async (role) => {
    const response = await api.post(`/admin/rbac/reset/${role}`);
    return response.data;
  },

  downloadImportTemplate: async () => {
    const response = await api.get('/admin/users/import/template', { responseType: 'blob' });
    return response.data;
  },

  importUsers: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/admin/users/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  },

  downloadImportErrors: async (failedRows) => {
    const response = await api.post(
      '/admin/users/import/errors',
      { failedRows },
      { responseType: 'blob' }
    );
    return response.data;
  },

  exportUsers: async (params = {}, signal) => {
    const response = await api.get('/admin/users/export', {
      params,
      responseType: 'blob',
      signal
    });
    return response.data;
  }
};

export const classroomAPI = {
  getTeacherState: async () => {
    const response = await api.get('/classroom/teacher/state');
    return response.data;
  },

  saveTeacherState: async (payload) => {
    const response = await api.put('/classroom/teacher/state', payload);
    return response.data;
  },

  gradeStudentSubmission: async (classroomId, assignmentId, submissionId, payload) => {
    const response = await api.put(`/classroom/teacher/classrooms/${classroomId}/assignments/${assignmentId}/submissions/${submissionId}/grade`, payload);
    return response.data;
  },

  getStudentClasses: async () => {
    const response = await api.get('/classroom/student/classes');
    return response.data;
  },

  joinStudentClassByCode: async (joinCode) => {
    const response = await api.post('/classroom/student/join', { joinCode });
    return response.data;
  },

  submitStudentAssignment: async (classroomId, assignmentId, payload) => {
    const response = await api.post(`/classroom/student/classrooms/${classroomId}/assignments/${assignmentId}/submit`, payload);
    return response.data;
  },

  unsubmitStudentAssignment: async (classroomId, assignmentId, payload = {}) => {
    const response = await api.post(`/classroom/student/classrooms/${classroomId}/assignments/${assignmentId}/unsubmit`, payload);
    return response.data;
  },

  previewStudentClassMaterial: async (fileId) => {
    return api.get(`/storage/files/${fileId}/preview`, { responseType: 'blob' });
  },

  downloadStudentClassMaterial: async (fileId) => {
    return api.get(`/storage/files/${fileId}/download`, { responseType: 'blob' });
  },

  getClassAnnouncements: async () => {
    const response = await api.get('/classroom/announcements');
    return response.data;
  },

  postClassAnnouncement: async (payload) => {
    const response = await api.post('/classroom/announcements', payload);
    return response.data;
  },

  getAuditLogs: async (params = {}) => {
    const response = await api.get('/classroom/audit-logs', { params });
    return response.data;
  },

  getAuditStats: async () => {
    const response = await api.get('/classroom/audit-stats');
    return response.data;
  },

  getAdminClassrooms: async () => {
    const response = await api.get('/admin/classrooms');
    return response.data;
  },

  restoreAdminClassroom: async (classroomId, ownerTeacherId) => {
    const response = await api.post(`/admin/classrooms/${classroomId}/restore`, { ownerTeacherId });
    return response.data;
  },

  exportAuditLogs: async () => {
    const response = await api.get('/classroom/audit-logs/export', { responseType: 'blob' });
    return response.data;
  }
};

// Add token to requests if it exists
api.interceptors.request.use(
  (config) => {
    const token = storage.getItem('token'); // Use unified storage
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle response errors
api.interceptors.response.use(
  (response) => {
    const refreshedToken = response?.headers?.['x-session-token'];
    if (refreshedToken) {
      const rememberMe = storage.isRememberMe();
      storage.setItem('token', refreshedToken, rememberMe);
    }
    return response;
  },
  (error) => {
    const isLoginEndpoint = error.config?.url?.includes('/auth/login');
    const hasToken = storage.getItem('token'); // Use unified storage
    
    if (error.response?.status === 401 && !isLoginEndpoint && hasToken) {
      // Session expired - clear storage and redirect
      storage.clearAuth();
      window.location.href = '/login';
    }
    
    return Promise.reject(error);
  }
);

export default api;