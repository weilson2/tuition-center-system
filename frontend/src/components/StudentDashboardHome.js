import React, { useEffect, useMemo, useState } from 'react';
import { classroomAPI } from '../services/api';
import '../styles/StudentDashboardHome.css';

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) {
    return '-';
  }
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) {
    return '-';
  }

  const datePart = date.toISOString().slice(0, 10);
  const timePart = date.toLocaleTimeString('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return `${datePart} ${timePart}`;
}

function getDownloadFileName(headers, fallbackName = 'download') {
  const disposition = headers?.['content-disposition'] || headers?.['Content-Disposition'] || '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const encodedName = match?.[1] || match?.[2];

  if (!encodedName) {
    return fallbackName;
  }

  try {
    return decodeURIComponent(encodedName);
  } catch (error) {
    return encodedName;
  }
}

function normalizeAssignmentStatus(statusValue) {
  const normalized = String(statusValue || '').trim().toLowerCase();

  if (
    normalized === 'graded'
    || normalized === 'returned'
    || normalized === 'completed'
  ) {
    return 'graded';
  }

  if (
    normalized === 'submitted'
    || normalized === 'awaiting_grade'
    || normalized === 'awaiting grade'
    || normalized === 'submitted_for_grading'
    || normalized === 'late'
  ) {
    return 'submitted';
  }

  return 'pending';
}

function getDaysLeftLabel(dueDate) {
  const due = toDate(dueDate);
  if (!due) {
    return '--';
  }

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffDays = Math.ceil((dueStart - todayStart) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return 'Due';
  }

  return `${diffDays}d`;
}

function StudentDashboardHome({ user, onOpenClassroom }) {
  const firstName = String(user?.fullName || 'Student').trim().split(' ')[0] || 'Student';
  const [announcementsByClassroom, setAnnouncementsByClassroom] = useState({});
  const [studentClasses, setStudentClasses] = useState([]);
  const [previewMaterial, setPreviewMaterial] = useState(null);
  const [previewState, setPreviewState] = useState({
    loading: false,
    mode: 'iframe',
    url: '',
    text: '',
    error: ''
  });
  const [previewingMaterialId, setPreviewingMaterialId] = useState(null);
  const [downloadingMaterialId, setDownloadingMaterialId] = useState(null);
  const [refreshingDashboard, setRefreshingDashboard] = useState(false);

  const loadAnnouncements = async () => {
    try {
      const response = await classroomAPI.getClassAnnouncements();
      const grouped = response?.announcementsByClassroom;
      setAnnouncementsByClassroom(grouped && typeof grouped === 'object' ? grouped : {});
    } catch (error) {
      console.error('Failed to load class announcements:', error);
      setAnnouncementsByClassroom({});
    }
  };

  const loadStudentClassesData = async () => {
    try {
      const response = await classroomAPI.getStudentClasses();
      setStudentClasses(Array.isArray(response?.classes) ? response.classes : []);
    } catch (error) {
      console.error('Failed to load student dashboard data:', error);
      setStudentClasses([]);
    }
  };

  useEffect(() => {
    loadAnnouncements();
    loadStudentClassesData();

    const refreshAnnouncements = () => {
      loadAnnouncements();
    };

    window.addEventListener('classAnnouncementsUpdated', refreshAnnouncements);
    return () => window.removeEventListener('classAnnouncementsUpdated', refreshAnnouncements);
  }, []);

  const handleRefreshDashboard = async () => {
    if (refreshingDashboard) {
      return;
    }

    setRefreshingDashboard(true);
    try {
      await Promise.all([loadAnnouncements(), loadStudentClassesData()]);
    } finally {
      setRefreshingDashboard(false);
    }
  };

  const latestAnnouncements = useMemo(() => {
    const grouped = Object.values(announcementsByClassroom || {});
    const merged = grouped.flatMap((items) => (Array.isArray(items) ? items : []));
    return merged
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 1);
  }, [announcementsByClassroom]);

  const allAssignments = useMemo(
    () => studentClasses.flatMap((classroom) =>
      (classroom.assignments || []).map((assignment) => ({
        ...assignment,
        classId: classroom.classroomId || classroom.id,
        className: classroom.title
      }))
    ),
    [studentClasses]
  );

  const allMaterials = useMemo(
    () => studentClasses.flatMap((classroom) =>
      (classroom.materials || []).map((material) => ({
        ...material,
        className: classroom.title
      }))
    ),
    [studentClasses]
  );

  const pendingAssignments = useMemo(
    () => allAssignments.filter((item) => normalizeAssignmentStatus(item.status) === 'pending'),
    [allAssignments]
  );

  const upcomingDeadlines = useMemo(
    () => {
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      return pendingAssignments
        .filter((item) => {
          const dueDate = toDate(item.dueDate);
          if (!dueDate) {
            return false;
          }
          const dueStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
          return dueStart.getTime() >= todayStart.getTime();
        })
        .slice()
      .sort((left, right) => {
        const leftDate = toDate(left.dueDate);
        const rightDate = toDate(right.dueDate);
        if (!leftDate && !rightDate) {
          return 0;
        }
        if (!leftDate) {
          return 1;
        }
        if (!rightDate) {
          return -1;
        }
        return leftDate.getTime() - rightDate.getTime();
      })
      .slice(0, 3)
      .map((item, index) => ({
        id: `${item.className}-${item.id}`,
        assignmentId: item.id,
        classId: item.classId,
        dayLeft: getDaysLeftLabel(item.dueDate),
        title: item.title,
        className: item.className,
        dueDate: formatDate(item.dueDate),
        urgent: index === 0
      }));
    },
    [pendingAssignments]
  );

  const recentGrades = useMemo(
    () => allAssignments
      .filter((item) => item.grade)
      .slice()
      .sort((left, right) => {
        const leftDate = toDate(left.submittedDate);
        const rightDate = toDate(right.submittedDate);
        if (!leftDate && !rightDate) {
          return 0;
        }
        if (!leftDate) {
          return 1;
        }
        if (!rightDate) {
          return -1;
        }
        return rightDate.getTime() - leftDate.getTime();
      })
      .slice(0, 2)
      .map((item) => ({
        id: `${item.className}-${item.id}`,
        assignmentId: item.id,
        classId: item.classId,
        title: item.title,
        className: item.className,
        score: item.grade,
        date: formatDate(item.submittedDate)
      })),
    [allAssignments]
  );

  const recentMaterials = useMemo(
    () => allMaterials
      .slice()
      .sort((left, right) => {
        const leftDate = toDate(left.uploadedDate);
        const rightDate = toDate(right.uploadedDate);
        if (!leftDate && !rightDate) {
          return 0;
        }
        if (!leftDate) {
          return 1;
        }
        if (!rightDate) {
          return -1;
        }
        return rightDate.getTime() - leftDate.getTime();
      })
      .slice(0, 2)
      .map((item) => ({
        id: `${item.className}-${item.id}`,
        fileId: item.fileId,
        size: item.size,
        fileName: item.fileName,
        className: item.className,
        date: formatDate(item.uploadedDate),
        isNew: Boolean(item.isNew)
      })),
    [allMaterials]
  );

  const storageTotal = Number(user?.storageQuota || 0);
  const storageUsed = Number(user?.storageUsed || 0);
  const storageProgress = storageTotal > 0 ? Math.min(100, Math.round((storageUsed / storageTotal) * 100)) : 0;

  const attendanceRateLabel = useMemo(() => {
    const attendanceRows = studentClasses
      .map((classroom) => classroom?.attendance)
      .filter((attendance) => attendance && Number.isFinite(Number(attendance.rate)));

    if (attendanceRows.length === 0) {
      return '--';
    }

    const totalSessions = attendanceRows.reduce((sum, attendance) => sum + Number(attendance.sessions || 0), 0);
    const totalPresent = attendanceRows.reduce((sum, attendance) => sum + Number(attendance.present || 0), 0);

    if (totalSessions <= 0) {
      return '--';
    }

    const rate = Math.round((totalPresent / totalSessions) * 100);
    return `${rate}%`;
  }, [studentClasses]);

  const statCards = [
    { id: 'classes', label: 'Enrolled Classes', value: String(studentClasses.length), icon: 'fa-book', tone: 'blue' },
    { id: 'tasks', label: 'Pending Tasks', value: String(pendingAssignments.length), icon: 'fa-list-check', tone: 'orange' },
    { id: 'attendance', label: 'Attendance Rate', value: attendanceRateLabel, icon: 'fa-clipboard-check', tone: 'green' },
    { id: 'storage', label: 'Storage Used', value: `${storageProgress}%`, icon: 'fa-database', tone: 'purple', progress: storageProgress }
  ];

  const handleDeadlineSubmit = (item) => {
    onOpenClassroom?.({
      subTab: 'my-classes',
      classId: Number(item.classId),
      className: item.className,
      detailTab: 'assignments',
      assignmentId: Number(item.assignmentId),
      assignmentTitle: item.title,
      action: 'submit-assignment'
    });
  };

  const handleViewGradeFeedback = (item) => {
    onOpenClassroom?.({
      subTab: 'my-classes',
      classId: Number(item.classId),
      className: item.className,
      detailTab: 'assignments',
      assignmentId: Number(item.assignmentId),
      assignmentTitle: item.title,
      action: 'view-feedback'
    });
  };

  const handleMaterialDownload = async (item) => {
    const fileId = Number(item?.fileId || 0);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      return;
    }

    setDownloadingMaterialId(item.id);

    try {
      const response = await classroomAPI.downloadStudentClassMaterial(fileId);
      const fileName = getDownloadFileName(response.headers, item?.fileName || `file-${fileId}`);
      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Failed to download material:', error);
    } finally {
      setDownloadingMaterialId(null);
    }
  };

  const closeMaterialPreview = () => {
    setPreviewState((previous) => {
      if (previous.url) {
        window.URL.revokeObjectURL(previous.url);
      }
      return { loading: false, mode: 'iframe', url: '', text: '', error: '' };
    });
    setPreviewMaterial(null);
  };

  const handleMaterialPreview = async (item) => {
    const fileId = Number(item?.fileId || 0);
    setPreviewingMaterialId(item.id);
    setPreviewMaterial(item);

    if (!Number.isInteger(fileId) || fileId <= 0) {
      setPreviewState({
        loading: false,
        mode: 'iframe',
        url: '',
        text: '',
        error: 'Preview is not available for this file.'
      });
      setPreviewingMaterialId(null);
      return;
    }

    setPreviewState({ loading: true, mode: 'iframe', url: '', text: '', error: '' });

    try {
      const response = await classroomAPI.previewStudentClassMaterial(fileId);
      const blob = response.data;
      const contentType = String(response.headers?.['content-type'] || blob?.type || '').toLowerCase();

      if (contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml') || contentType.includes('csv')) {
        const textContent = await blob.text();
        setPreviewState({ loading: false, mode: 'text', url: '', text: textContent, error: '' });
        return;
      }

      const blobUrl = window.URL.createObjectURL(blob);
      setPreviewState({
        loading: false,
        mode: contentType.startsWith('image/') ? 'image' : 'iframe',
        url: blobUrl,
        text: '',
        error: ''
      });
    } catch (error) {
      console.error('Failed to preview material:', error);
      setPreviewState({
        loading: false,
        mode: 'iframe',
        url: '',
        text: '',
        error: error.response?.data?.error || 'Failed to preview material'
      });
    } finally {
      setPreviewingMaterialId(null);
    }
  };

  useEffect(() => () => {
    if (previewState.url) {
      window.URL.revokeObjectURL(previewState.url);
    }
  }, [previewState.url]);

  return (
    <div className="student-home">
      <div className="student-hero">
        <div className="student-hero-head">
          <h2>Welcome back, {firstName}! 👋</h2>
          <button
            type="button"
            className="student-hero-refresh"
            onClick={() => {
              void handleRefreshDashboard();
            }}
            disabled={refreshingDashboard}
            title="Refresh dashboard"
          >
            <i className={`fas ${refreshingDashboard ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`}></i>
          </button>
        </div>
        <p>You have {pendingAssignments.length} pending assignments. Keep up the great work!</p>
      </div>

      <div className="student-stats-grid">
        {statCards.map((card) => (
          <div key={card.id} className={`student-stat-card ${card.tone}`}>
            <p>{card.label}</p>
            <h3>{card.value}</h3>
            <span className="student-stat-icon"><i className={`fas ${card.icon}`}></i></span>
            {typeof card.progress === 'number' && (
              <div className="student-storage-progress">
                <div style={{ width: `${card.progress}%` }}></div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="student-panel student-announcements-panel">
        <div className="student-panel-head">
          <h4>Class Announcements</h4>
        </div>

        {latestAnnouncements.length === 0 && (
          <p className="student-announcement-empty">No announcements yet.</p>
        )}

        {latestAnnouncements.map((announcement) => (
          <div key={announcement.id} className="student-announcement-item">
            <div className="student-announcement-head">
              <strong>{announcement.classroomName}</strong>
              <span>Published: {formatDateTime(announcement.createdAt)}</span>
            </div>
            <span className="student-announcement-author">By {announcement.authorName || 'Teacher'}</span>
            <p>{announcement.message}</p>
          </div>
        ))}
      </div>

      <div className="student-panels-grid">
        <div className="student-panel">
          <div className="student-panel-head">
            <h4>Upcoming Deadlines</h4>
          </div>

          {upcomingDeadlines.map((item) => (
            <div key={item.id} className="student-deadline-item">
              <span className={`student-day-chip ${item.urgent ? 'urgent' : ''}`}>{item.dayLeft}</span>
              <div className="student-deadline-meta">
                <strong>{item.title}</strong>
                <p>{item.className} · Due: {item.dueDate}</p>
              </div>
              <button type="button" onClick={() => handleDeadlineSubmit(item)}>Submit</button>
            </div>
          ))}

          {upcomingDeadlines.length === 0 && (
            <div className="student-deadline-item">
              <div className="student-deadline-meta">
                <strong>No upcoming deadlines</strong>
                <p>You're all caught up.</p>
              </div>
            </div>
          )}
        </div>

        <div className="student-panel">
          <div className="student-panel-head">
            <h4>Recent Grades</h4>
          </div>

          {recentGrades.map((item) => (
            <div key={item.id} className="student-grade-item">
              <span className="student-grade-icon"><i className="fas fa-star"></i></span>
              <div className="student-grade-meta">
                <strong>{item.title}</strong>
                <p>{item.className}</p>
              </div>
              <button type="button" className="student-grade-feedback-btn" onClick={() => handleViewGradeFeedback(item)}>
                View Feedback
              </button>
              <div className="student-grade-score">
                <strong>{item.score}</strong>
                <small>{item.date}</small>
              </div>
            </div>
          ))}

          {recentGrades.length === 0 && (
            <div className="student-grade-item">
              <div className="student-grade-meta">
                <strong>No graded assignments yet</strong>
                <p>Grades will appear here once available.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="student-panel materials">
        <div className="student-panel-head">
          <h4>Recent Materials</h4>
        </div>

        <div className="student-material-grid">
          {recentMaterials.map((item) => (
            <div key={item.id} className="student-material-item">
              <span className="student-material-icon"><i className="fas fa-file-pdf"></i></span>
              <div className="student-material-meta">
                <strong>
                  {item.fileName}
                  {item.isNew && <em>New</em>}
                </strong>
                <p>{item.className} · {item.date}</p>
              </div>
              <div className="student-material-actions">
                <button
                  type="button"
                  className="student-material-action"
                  aria-label="Preview material"
                  disabled={previewingMaterialId === item.id || downloadingMaterialId === item.id}
                  onClick={() => {
                    void handleMaterialPreview(item);
                  }}
                >
                  <i className={`fas ${previewingMaterialId === item.id ? 'fa-spinner fa-spin' : 'fa-eye'}`}></i>
                </button>
                <button
                  type="button"
                  className="student-material-action"
                  aria-label="Download material"
                  disabled={previewingMaterialId === item.id || downloadingMaterialId === item.id}
                  onClick={() => {
                    void handleMaterialDownload(item);
                  }}
                >
                  <i className={`fas ${downloadingMaterialId === item.id ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
                </button>
              </div>
            </div>
          ))}

          {recentMaterials.length === 0 && (
            <div className="student-material-item">
              <div className="student-material-meta">
                <strong>No materials uploaded yet</strong>
                <p>Teacher materials will appear here.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {previewMaterial && (
        <div className="student-home-preview-backdrop">
          <div className="student-home-preview-modal">
            <div className="student-home-preview-header">
              <div>
                <strong>{previewMaterial.fileName || 'Material Preview'}</strong>
                <p>{previewMaterial.className} · {previewMaterial.size || '-'}</p>
              </div>
              <button className="student-home-preview-close" onClick={closeMaterialPreview} aria-label="Close preview">
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="student-home-preview-canvas">
              {previewState.loading && (
                <div className="student-home-preview-placeholder">
                  <i className="fas fa-spinner fa-spin"></i>
                  <h4>Loading Preview</h4>
                  <p>{previewMaterial.fileName || '-'}</p>
                </div>
              )}

              {!previewState.loading && previewState.mode === 'image' && previewState.url && (
                <img
                  src={previewState.url}
                  alt={previewMaterial.fileName || 'Preview'}
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              )}

              {!previewState.loading && previewState.mode === 'text' && (
                <pre style={{ width: '100%', height: '100%', overflow: 'auto', margin: 0, padding: '0.85rem' }}>
                  {previewState.text || ''}
                </pre>
              )}

              {!previewState.loading && previewState.mode === 'iframe' && previewState.url && (
                <iframe
                  title={previewMaterial.fileName || 'Material preview'}
                  src={previewState.url}
                  className="student-home-preview-frame"
                />
              )}

              {!previewState.loading && !previewState.url && previewState.mode !== 'text' && (
                <div className="student-home-preview-placeholder">
                  <i className="fas fa-file-circle-question"></i>
                  <h4>Preview Unavailable</h4>
                  <p>{previewMaterial.fileName || '-'}</p>
                  <small>{previewState.error || 'This file cannot be previewed inline.'}</small>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StudentDashboardHome;
