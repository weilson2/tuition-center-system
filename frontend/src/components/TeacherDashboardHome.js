import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { classroomAPI } from '../services/api';
import '../styles/TeacherDashboardHome.css';

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) {
    return '-';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toClassList(state) {
  return Array.isArray(state?.classrooms) ? state.classrooms : [];
}

function isArchivedClassroom(classroom) {
  return String(classroom?.status || '').trim().toLowerCase() === 'archived';
}

function normalizeAssistantAccessRole(value) {
  return String(value || '').trim().toLowerCase() === 'teacher' ? 'teacher' : 'student';
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function TeacherDashboardHome({ user, onOpenClassroom }) {
  const [now, setNow] = useState(() => new Date());
  const [teacherState, setTeacherState] = useState(null);
  const [refreshingDashboard, setRefreshingDashboard] = useState(false);

  const loadTeacherState = async () => {
    try {
      const response = await classroomAPI.getTeacherState();
      setTeacherState(response?.state || {});
    } catch (error) {
      console.error('Failed to load teacher dashboard data:', error);
      setTeacherState({});
    }
  };

  useEffect(() => {
    loadTeacherState();
  }, []);

  const handleRefreshDashboard = async () => {
    if (refreshingDashboard) {
      return;
    }

    setRefreshingDashboard(true);
    try {
      await loadTeacherState();
    } finally {
      setRefreshingDashboard(false);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  const parseTimePart = useCallback((value) => {
    const [hoursString, minutesString] = value.trim().split(':');
    const hours = Number(hoursString);
    const minutes = Number(minutesString);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return null;
    }
    return hours * 60 + minutes;
  }, []);

  const isCurrentTimeInRange = useCallback((timeRange) => {
    const [startRaw, endRaw] = String(timeRange || '').split('-');
    if (!startRaw || !endRaw) {
      return false;
    }

    const start = parseTimePart(startRaw);
    const end = parseTimePart(endRaw);
    if (start === null || end === null) {
      return false;
    }

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    return currentMinutes >= start && currentMinutes <= end;
  }, [now, parseTimePart]);

  const classrooms = useMemo(() => toClassList(teacherState), [teacherState]);
  const visibleClassrooms = useMemo(
    () => classrooms.filter((classroom) => !isArchivedClassroom(classroom)),
    [classrooms]
  );
  const currentTeacherUserId = useMemo(
    () => toPositiveInteger(user?.userId || user?.id || user?.teacherUserId),
    [user?.userId, user?.id, user?.teacherUserId]
  );
  const gradingEligibleClassrooms = useMemo(
    () => visibleClassrooms.filter((classroom) => {
      const ownerTeacherId = toPositiveInteger(classroom?.ownerTeacherId);
      if (ownerTeacherId !== null && currentTeacherUserId !== null && ownerTeacherId === currentTeacherUserId) {
        return true;
      }

      return normalizeAssistantAccessRole(classroom?.assistantAccessRole) === 'teacher';
    }),
    [visibleClassrooms, currentTeacherUserId]
  );
  const attendanceEligibleClassroomIds = useMemo(
    () => new Set(
      visibleClassrooms
        .filter((classroom) => {
          const ownerTeacherId = toPositiveInteger(classroom?.ownerTeacherId);
          if (ownerTeacherId !== null && currentTeacherUserId !== null && ownerTeacherId === currentTeacherUserId) {
            return true;
          }

          return normalizeAssistantAccessRole(classroom?.assistantAccessRole) === 'teacher';
        })
        .map((classroom) => String(classroom?.classroomId))
    ),
    [visibleClassrooms, currentTeacherUserId]
  );

  const todayShortName = useMemo(() => {
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return labels[now.getDay()];
  }, [now]);

  const todayClasses = useMemo(
    () => visibleClassrooms
      .filter((classroom) => String(classroom.classSchedule || '').includes(todayShortName))
      .map((classroom) => {
        const scheduleText = String(classroom.classSchedule || '');
        const timeMatch = scheduleText.match(/(\d{2}:\d{2}-\d{2}:\d{2})$/);
        const time = timeMatch ? timeMatch[1].replace('-', ' - ') : '-';
        const studentsByClassroom = teacherState?.studentsByClassroom || {};
        const students = studentsByClassroom[classroom.classroomId] || studentsByClassroom[String(classroom.classroomId)] || [];

        return {
          id: classroom.classroomId,
          name: classroom.classroomName,
          time,
          students: Array.isArray(students) ? students.length : Number(classroom.currentEnrollment || 0),
          room: classroom.roomNumber || '-',
          canTakeAttendance: attendanceEligibleClassroomIds.has(String(classroom.classroomId))
        };
      }),
    [visibleClassrooms, teacherState, todayShortName, attendanceEligibleClassroomIds]
  );

  const classesWithTimeState = useMemo(
    () => todayClasses.map((item) => ({
      ...item,
      isInSession: isCurrentTimeInRange(item.time)
    })),
    [isCurrentTimeInRange, todayClasses]
  );

  const pendingSubmissions = useMemo(() => {
    const assignmentsByClassroom = teacherState?.assignmentsByClassroom || {};
    const studentsByClassroom = teacherState?.studentsByClassroom || {};
    const gradingSubmissionsByAssignment = teacherState?.gradingSubmissionsByAssignment || {};

    return gradingEligibleClassrooms
      .flatMap((classroom) => {
        const assignmentRows = assignmentsByClassroom[classroom.classroomId] || assignmentsByClassroom[String(classroom.classroomId)] || [];
        const classStudents = studentsByClassroom[classroom.classroomId] || studentsByClassroom[String(classroom.classroomId)] || [];
        const classStudentCount = Array.isArray(classStudents) ? classStudents.length : Number(classroom.currentEnrollment || 0);

        return assignmentRows.map((assignment) => {
          const total = Number(assignment.total || classStudentCount || 0);
          const submissionRows = gradingSubmissionsByAssignment[assignment.id] || gradingSubmissionsByAssignment[String(assignment.id)] || [];
          const scopedSubmissionRows = Array.isArray(submissionRows)
            ? submissionRows.filter((row) => Number(row?.classroomId) === Number(classroom.classroomId))
            : [];
          const submitted = scopedSubmissionRows.length;
          const pending = scopedSubmissionRows.filter((row) => {
            const status = String(row?.status || '').trim().toLowerCase();
            return status !== 'graded';
          }).length;

          return {
            id: `${classroom.classroomId}-${assignment.id}`,
            assignmentId: assignment.id,
            classroomId: classroom.classroomId,
            title: assignment.title,
            className: classroom.classroomName,
            submitted,
            total: total || 0,
            pending
          };
        });
      })
      .filter((item) => item.pending > 0)
      .sort((left, right) => right.pending - left.pending)
      .slice(0, 3);
  }, [gradingEligibleClassrooms, teacherState]);

  const recentActivity = useMemo(() => {
    const assignmentsByClassroom = teacherState?.assignmentsByClassroom || {};
    const materialsByClassroom = teacherState?.materialsByClassroom || {};

    const assignmentEvents = visibleClassrooms.flatMap((classroom) => {
      const assignments = assignmentsByClassroom[classroom.classroomId] || assignmentsByClassroom[String(classroom.classroomId)] || [];
      return assignments.map((assignment) => ({
        id: `assign-${classroom.classroomId}-${assignment.id}`,
        text: 'Assignment Updated',
        detail: `${assignment.title} · ${classroom.classroomName}`,
        date: parseDate(assignment.updatedAt || assignment.dueDate),
        icon: 'fa-list-check'
      }));
    });

    const materialEvents = visibleClassrooms.flatMap((classroom) => {
      const materials = materialsByClassroom[classroom.classroomId] || materialsByClassroom[String(classroom.classroomId)] || [];
      return materials.map((material) => ({
        id: `material-${classroom.classroomId}-${material.id}`,
        text: 'Material Uploaded',
        detail: `${material.fileName} · ${classroom.classroomName}`,
        date: parseDate(material.uploadedDate),
        icon: 'fa-upload'
      }));
    });

    return [...assignmentEvents, ...materialEvents]
      .sort((left, right) => {
        if (!left.date && !right.date) {
          return 0;
        }
        if (!left.date) {
          return 1;
        }
        if (!right.date) {
          return -1;
        }
        return right.date.getTime() - left.date.getTime();
      })
      .slice(0, 3)
      .map((item) => ({
        ...item,
        time: formatDate(item.date)
      }));
  }, [visibleClassrooms, teacherState]);

  const totalStudents = useMemo(() => {
    const studentsByClassroom = teacherState?.studentsByClassroom || {};
    const ids = new Set();
    visibleClassrooms.forEach((classroom) => {
      const students = studentsByClassroom[classroom.classroomId] || studentsByClassroom[String(classroom.classroomId)] || [];
      if (Array.isArray(students)) {
        students.forEach((student) => {
          const key = student.studentId || student.userId || student.id;
          if (key !== undefined && key !== null) {
            ids.add(String(key));
          }
        });
      }
    });
    return ids.size;
  }, [visibleClassrooms, teacherState]);

  const avgAttendance = useMemo(() => {
    const attendanceRecordsByClassroom = teacherState?.attendanceRecordsByClassroom || {};

    const totalPresent = visibleClassrooms.reduce((sum, classroom) => {
      const classRecords = attendanceRecordsByClassroom[classroom.classroomId]
        || attendanceRecordsByClassroom[String(classroom.classroomId)]
        || {};
      return sum + Object.values(classRecords).reduce((recordSum, record) => recordSum + Number(record?.present || 0), 0);
    }, 0);

    const totalExpected = visibleClassrooms.reduce((sum, classroom) => {
      const classRecords = attendanceRecordsByClassroom[classroom.classroomId]
        || attendanceRecordsByClassroom[String(classroom.classroomId)]
        || {};
      return sum + Object.values(classRecords).reduce((recordSum, record) => recordSum + Number(record?.total || 0), 0);
    }, 0);

    if (totalExpected > 0) {
      return `${Math.round((totalPresent / totalExpected) * 100)}%`;
    }

    const fallbackValues = visibleClassrooms
      .map((classroom) => Number(classroom.averageAttendance))
      .filter((value) => Number.isFinite(value));

    if (fallbackValues.length === 0) {
      return '0%';
    }

    const fallbackAverage = fallbackValues.reduce((sum, value) => sum + value, 0) / fallbackValues.length;
    return `${Math.round(fallbackAverage)}%`;
  }, [visibleClassrooms, teacherState]);

  const totalPending = useMemo(
    () => pendingSubmissions.reduce((sum, item) => sum + item.pending, 0),
    [pendingSubmissions]
  );

  return (
    <div className="teacher-home">
      <div className="teacher-hero">
        <div className="teacher-hero-head">
          <h2>Good morning, {user.fullName}! 👋</h2>
          <button
            type="button"
            className="teacher-hero-refresh"
            onClick={() => {
              void handleRefreshDashboard();
            }}
            disabled={refreshingDashboard}
            title="Refresh dashboard"
          >
            <i className={`fas ${refreshingDashboard ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`}></i>
          </button>
        </div>
        <p>You have {totalPending} submissions waiting to be graded and {todayClasses.length} classes today.</p>
      </div>

      <div className="teacher-stats-grid">
        <div className="teacher-stat-card">
          <p>My Classes</p>
          <h3>{visibleClassrooms.length}</h3>
          <i className="fas fa-chalkboard"></i>
        </div>
        <div className="teacher-stat-card">
          <p>Total Students</p>
          <h3>{totalStudents}</h3>
          <i className="fas fa-users"></i>
        </div>
        <div className="teacher-stat-card">
          <p>Pending Grading</p>
          <h3>{totalPending}</h3>
          <i className="fas fa-clock"></i>
        </div>
        <div className="teacher-stat-card">
          <p>Avg Attendance</p>
          <h3>{avgAttendance}</h3>
          <i className="fas fa-chart-line"></i>
        </div>
      </div>

      <div className="teacher-panels-grid">
        <div className="teacher-panel">
          <h4>Today's Classes</h4>
          {classesWithTimeState.map((classroom) => (
            <div key={classroom.id} className={`teacher-item-card ${classroom.isInSession ? 'time-active' : ''}`}>
              <strong>{classroom.name}</strong>
              <p>
                <i className="fas fa-clock"></i> {classroom.time}
                <span> · </span>
                <i className="fas fa-users"></i> {classroom.students}
                <span> · </span>
                <i className="fas fa-door-open"></i> {classroom.room}
              </p>
              {classroom.canTakeAttendance && (
                <button
                  onClick={() => onOpenClassroom({ subTab: 'attendance', classroomId: classroom.id })}
                >
                  Take Attendance
                </button>
              )}
            </div>
          ))}

          {classesWithTimeState.length === 0 && (
            <div className="teacher-item-card">
              <strong>No classes scheduled today</strong>
              <p>Your schedule is clear for today.</p>
            </div>
          )}
        </div>

        <div className="teacher-panel">
          <h4>Pending Submissions</h4>
          {pendingSubmissions.map((submission) => (
            <div key={submission.id} className="teacher-item-card grading">
              <strong>{submission.title}</strong>
              <p>{submission.className}</p>
              <div className="teacher-progress-row">
                <span>{submission.submitted}/{submission.total}</span>
                <span>{submission.pending} pending</span>
              </div>
              <div className="teacher-progress-bar">
                <div style={{ width: `${submission.total > 0 ? (submission.submitted / submission.total) * 100 : 0}%` }}></div>
              </div>
              <button
                onClick={() => onOpenClassroom({
                  subTab: 'grading',
                  classroomId: submission.classroomId,
                  assignmentId: submission.assignmentId
                })}
              >
                Grade Now
              </button>
            </div>
          ))}

          {pendingSubmissions.length === 0 && (
            <div className="teacher-item-card grading">
              <strong>No pending submissions</strong>
              <p>All current submissions are graded.</p>
            </div>
          )}
        </div>

        <div className="teacher-panel">
          <h4>Recent Activity</h4>
          <div className="teacher-activity-list">
            {recentActivity.map((activity) => (
              <div key={activity.id} className="teacher-activity-item">
                <i className={`fas ${activity.icon}`}></i>
                <div>
                  <strong>{activity.text}</strong>
                  <p>{activity.detail}</p>
                  <span>{activity.time}</span>
                </div>
              </div>
            ))}

            {recentActivity.length === 0 && (
              <div className="teacher-activity-item">
                <div>
                  <strong>No recent classroom activity</strong>
                  <p>New uploads and updates will appear here.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

export default TeacherDashboardHome;
