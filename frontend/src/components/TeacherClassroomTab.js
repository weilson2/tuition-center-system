import React, { useEffect, useMemo, useRef, useState } from 'react';
import Toast from './Toast';
import ConfirmDialog from './ConfirmDialog';
import api, { classroomAPI } from '../services/api';
import { storage } from '../utils/storage';
import '../styles/TeacherClassroomTab.css';

function formatLocalDate(dateObj) {
  if (!dateObj) return '';
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const SUBJECT_OPTIONS = [
  'Mathematics',
  'Additional Mathematics',
  'Science',
  'Physics',
  'Chemistry',
  'Biology',
  'English',
  'Bahasa Melayu',
  'History',
  'Geography'
];
const GRADE_OPTIONS = [
  'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6',
  'Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5',
  'Lower Six', 'Upper Six', 'All Level'
];
const SCHEDULE_DAY_OPTIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SCHEDULE_AM_HOUR_OPTIONS = ['08', '09', '10', '11'];
const SCHEDULE_PM_HOUR_OPTIONS = ['12', '01', '02', '03', '04', '05', '06', '07', '08'];
const SCHEDULE_MINUTE_OPTIONS = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];
const SCHEDULE_DURATION_OPTIONS = ['30', '45', '60', '75', '90', '120', '150', '180'];

function getClassroomTheme(subject) {
  const normalized = String(subject || '').toLowerCase();
  if (normalized.includes('physics')) {
    return { icon: 'fa-atom', tone: 'purple' };
  }
  if (normalized.includes('chemistry') || normalized.includes('science')) {
    return { icon: 'fa-flask', tone: 'green' };
  }
  return { icon: 'fa-book', tone: 'blue' };
}

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 8; index += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function normalizeTeacherAccessRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'teacher') {
    return 'teacher';
  }
  return 'student';
}

function normalizeCoTeacherList(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  list.forEach((entry) => {
    const teacherUserId = Number(entry?.teacherUserId || entry?.userId || entry?.id);
    if (!Number.isInteger(teacherUserId) || teacherUserId <= 0 || seen.has(teacherUserId)) {
      return;
    }

    seen.add(teacherUserId);
    normalized.push({
      teacherUserId,
      name: String(entry?.name || `Teacher ${teacherUserId}`),
      email: String(entry?.email || ''),
      accessRole: normalizeTeacherAccessRole(entry?.accessRole)
    });
  });

  return normalized;
}

function ClassroomFormModal({ mode, classroom, onClose, onSave, isSaving = false }) {
  const isView = mode === 'view';

  const parseScheduleText = (scheduleText) => {
    const value = String(scheduleText || '').trim();
    const match = value.match(/^(.*)\s(\d{2}:\d{2})-(\d{2}:\d{2})$/);
    if (!match) {
      return { days: [], startTime: '', duration: '' };
    }

    const days = match[1]
      .split(',')
      .map((item) => item.trim())
      .filter((item) => SCHEDULE_DAY_OPTIONS.includes(item));

    const [startHour, startMinute] = match[2].split(':').map((item) => Number(item));
    const [endHour, endMinute] = match[3].split(':').map((item) => Number(item));
    const startTotalMinutes = (startHour * 60) + startMinute;
    const endTotalMinutes = (endHour * 60) + endMinute;
    const duration = endTotalMinutes > startTotalMinutes ? String(endTotalMinutes - startTotalMinutes) : '';

    return {
      days,
      startTime: match[2],
      duration: SCHEDULE_DURATION_OPTIONS.includes(duration) ? duration : ''
    };
  };

  const initialSchedule = parseScheduleText(classroom?.classSchedule || '');
  const convert24To12 = (timeValue) => {
    if (!timeValue || !timeValue.includes(':')) {
      return { hour12: '', minute: '', meridiem: 'AM' };
    }

    const [hourText, minute] = timeValue.split(':');
    const hour24 = Number(hourText);
    if (!Number.isInteger(hour24)) {
      return { hour12: '', minute: '', meridiem: 'AM' };
    }

    const meridiem = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

    return {
      hour12: String(hour12).padStart(2, '0'),
      minute,
      meridiem
    };
  };

  const initialStartTime12 = convert24To12(initialSchedule.startTime);
  const [form, setForm] = useState({
    classroomName: classroom?.classroomName || '',
    subject: classroom?.subject || 'Mathematics',
    customSubject: '',
    gradeLevel: classroom?.gradeLevel || 'Form 4',
    section: classroom?.section || '',
    roomNumber: classroom?.roomNumber || '',
    classSchedule: classroom?.classSchedule || '',
    maximumCapacity: classroom?.maximumCapacity || 40,
    description: classroom?.description || '',
    visibility: classroom?.visibility || 'Public',
    academicYear: classroom?.academicYear || '2025/2026',
    semester: classroom?.semester || 'Semester 1',
    startDate: classroom?.startDate || '',
    endDate: classroom?.endDate || '',
    selfEnrollmentEnabled: Boolean(classroom?.selfEnrollmentEnabled),
    joinCode: classroom?.joinCode || '',
    status: classroom?.status || 'Active'
  });
  const [scheduleDays, setScheduleDays] = useState(initialSchedule.days);
  const [scheduleStartHour12, setScheduleStartHour12] = useState(initialStartTime12.hour12);
  const [scheduleStartMinute, setScheduleStartMinute] = useState(initialStartTime12.minute);
  const [scheduleStartMeridiem, setScheduleStartMeridiem] = useState(initialStartTime12.meridiem);
  const [scheduleDuration, setScheduleDuration] = useState(initialSchedule.duration);
  const [error, setError] = useState('');

  const convert12To24Time = (hour12Text, minuteText, meridiem) => {
    if (!hour12Text || !minuteText || !meridiem) {
      return '';
    }

    const hour12 = Number(hour12Text);
    const minute = Number(minuteText);
    if (!Number.isInteger(hour12) || !Number.isInteger(minute)) {
      return '';
    }

    let hour24 = hour12;
    if (meridiem === 'AM') {
      hour24 = hour12 === 12 ? 0 : hour12;
    } else {
      hour24 = hour12 === 12 ? 12 : hour12 + 12;
    }

    return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  };

  const scheduleStartTime = convert12To24Time(scheduleStartHour12, scheduleStartMinute, scheduleStartMeridiem);
  const scheduleStartHourOptions = scheduleStartMeridiem === 'AM' ? SCHEDULE_AM_HOUR_OPTIONS : SCHEDULE_PM_HOUR_OPTIONS;

  const calculateEndTimeFromDuration = (startTime, durationMinutes) => {
    if (!startTime || !durationMinutes) {
      return '';
    }

    const [startHourText, startMinuteText] = startTime.split(':');
    const startHour = Number(startHourText);
    const startMinute = Number(startMinuteText);
    const duration = Number(durationMinutes);

    if (!Number.isInteger(startHour) || !Number.isInteger(startMinute) || !Number.isInteger(duration)) {
      return '';
    }

    const startTotal = (startHour * 60) + startMinute;
    const endTotal = startTotal + duration;
    const latestAllowedEnd = (20 * 60) + 55;

    if (endTotal > latestAllowedEnd) {
      return '';
    }

    const endHour = Math.floor(endTotal / 60);
    const endMinute = endTotal % 60;
    return `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
  };

  const scheduleEndTime = calculateEndTimeFromDuration(scheduleStartTime, scheduleDuration);

  const setField = (key, value) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  useEffect(() => {
    if (scheduleDays.length === 0 || !scheduleStartTime || !scheduleDuration || !scheduleEndTime) {
      setField('classSchedule', '');
      return;
    }

    setField('classSchedule', `${scheduleDays.join(', ')} ${scheduleStartTime}-${scheduleEndTime}`);
  }, [scheduleDays, scheduleStartTime, scheduleDuration, scheduleEndTime]);

  const toggleScheduleDay = (day) => {
    setScheduleDays((previous) => (
      previous.includes(day)
        ? previous.filter((item) => item !== day)
        : [...previous, day]
    ));
  };


  const submit = (asDraft = false) => {
    if (isView) {
      onClose();
      return;
    }

    if (!form.classroomName.trim() || !form.gradeLevel) {
      setError('Please complete required fields: classroom name and grade level');
      return;
    }

    const actualSubject = form.subject === 'Other' ? form.customSubject.trim() : form.subject;
    if (!actualSubject) {
      setError('Subject is required');
      return;
    }

    const maxCap = parseInt(form.maximumCapacity, 10);
    if (!Number.isInteger(maxCap) || maxCap <= 0 || maxCap > 200) {
      setError('Maximum capacity must be a positive integer up to 200');
      return;
    }

    if (form.startDate && form.endDate && new Date(form.endDate) <= new Date(form.startDate)) {
      setError('End date must be after start date');
      return;
    }

    if (scheduleDays.length > 0 && (!scheduleStartTime || !scheduleDuration)) {
      setError('Please set start time and duration for class schedule');
      return;
    }

    if ((scheduleStartTime && !scheduleDuration) || (!scheduleStartTime && scheduleDuration)) {
      setError('Please complete both schedule time and duration');
      return;
    }

    if (scheduleStartTime && scheduleDuration && !scheduleEndTime) {
      setError('Class end time must be before 20:55. Please choose earlier start time or shorter duration');
      return;
    }

    if (scheduleStartTime) {
      const [startHourText] = scheduleStartTime.split(':');
      const startHour = Number(startHourText);
      if (startHour < 8 || startHour > 20) {
        setError('Class start hour must be between 08:00 AM and 08:59 PM');
        return;
      }
    }

    const startMinuteValue = Number(scheduleStartTime.split(':')[1] || '0');
    const endMinuteValue = Number(scheduleEndTime.split(':')[1] || '0');
    if ((scheduleStartTime && startMinuteValue % 5 !== 0) || (scheduleEndTime && endMinuteValue % 5 !== 0)) {
      setError('Please select time in 5-minute intervals only (00, 05, 10, ... 55)');
      return;
    }

    const payload = {
      ...form,
      subject: actualSubject,
      maximumCapacity: maxCap,
      status: asDraft ? 'Draft' : form.status,
      joinCode: form.selfEnrollmentEnabled
        ? (form.joinCode || generateJoinCode())
        : ''
    };

    onSave(payload, asDraft);
  };

  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-class-modal">
        <h3>{isView ? 'View Existing Classroom' : classroom ? 'Edit Classroom Details' : 'Create New Classroom'}</h3>

        <div className="teacher-class-form-grid">
          <label>Classroom Name *</label>
          <input
            value={form.classroomName}
            onChange={(event) => setField('classroomName', event.target.value)}
            disabled={isView}
          />

          <label>Subject *</label>
          <select
            value={form.subject}
            onChange={(event) => setField('subject', event.target.value)}
            disabled={isView}
          >
            {SUBJECT_OPTIONS.map((subject) => (
              <option value={subject} key={subject}>{subject}</option>
            ))}
            <option value="Other">Other</option>
          </select>

          {form.subject === 'Other' && (
            <>
              <label>Custom Subject *</label>
              <input
                value={form.customSubject}
                onChange={(event) => setField('customSubject', event.target.value)}
                disabled={isView}
              />
            </>
          )}

          <label>Grade Level *</label>
          <select
            value={form.gradeLevel}
            onChange={(event) => setField('gradeLevel', event.target.value)}
            disabled={isView}
          >
            {GRADE_OPTIONS.map((grade) => (
              <option value={grade} key={grade}>{grade}</option>
            ))}
          </select>

          <label>Room Number</label>
          <input
            value={form.roomNumber}
            onChange={(event) => setField('roomNumber', event.target.value)}
            disabled={isView}
          />

          <label>Class Schedule</label>
          <div className="teacher-schedule-builder">
            <div className="teacher-schedule-days">
              {SCHEDULE_DAY_OPTIONS.map((day) => (
                <button
                  key={day}
                  type="button"
                  className={scheduleDays.includes(day) ? 'active' : ''}
                  onClick={() => toggleScheduleDay(day)}
                  disabled={isView}
                >
                  {day}
                </button>
              ))}
            </div>
            <div className="teacher-schedule-time-row">
              <select
                value={scheduleStartHour12}
                onChange={(event) => {
                  setScheduleStartHour12(event.target.value);
                  setError('');
                }}
                disabled={isView}
              >
                <option value="">Start Hour</option>
                {scheduleStartHourOptions.map((hour) => (
                  <option key={`start-hour-${hour}`} value={hour}>{hour}</option>
                ))}
              </select>
              <select
                value={scheduleStartMinute}
                onChange={(event) => {
                  setScheduleStartMinute(event.target.value);
                  setError('');
                }}
                disabled={isView}
              >
                <option value="">Start Min</option>
                {SCHEDULE_MINUTE_OPTIONS.map((minute) => (
                  <option key={`start-minute-${minute}`} value={minute}>{minute}</option>
                ))}
              </select>
              <select
                value={scheduleStartMeridiem}
                onChange={(event) => {
                  setScheduleStartMeridiem(event.target.value);
                  setError('');
                }}
                disabled={isView}
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
              <select
                value={scheduleDuration}
                onChange={(event) => {
                  setScheduleDuration(event.target.value);
                  setError('');
                }}
                disabled={isView}
              >
                <option value="">Duration</option>
                {SCHEDULE_DURATION_OPTIONS.map((duration) => (
                  <option key={`duration-${duration}`} value={duration}>{duration} min</option>
                ))}
              </select>
            </div>
            <p className="teacher-schedule-preview">
              {form.classSchedule || 'Select day(s), start time, and duration'}
            </p>
          </div>

          <label>Maximum Capacity</label>
          <input
            type="number"
            value={form.maximumCapacity}
            onChange={(event) => setField('maximumCapacity', event.target.value)}
            disabled={isView}
          />

          <label>Start Date</label>
          <input
            type="date"
            value={form.startDate}
            onChange={(event) => setField('startDate', event.target.value)}
            disabled={isView}
          />

          <label>End Date</label>
          <input
            type="date"
            value={form.endDate}
            onChange={(event) => setField('endDate', event.target.value)}
            disabled={isView}
          />

          <label>Description / Syllabus</label>
          <textarea
            value={form.description}
            onChange={(event) => setField('description', event.target.value)}
            disabled={isView}
            rows={3}
          />

          <label className="teacher-switch-row">
            <input
              type="checkbox"
              checked={form.selfEnrollmentEnabled}
              onChange={(event) => setField('selfEnrollmentEnabled', event.target.checked)}
              disabled={isView}
            />
            Enable student self-enrollment
          </label>

          {form.selfEnrollmentEnabled && (
            <div className="teacher-join-code">
              Join Code: <strong>{form.joinCode || 'Will be generated'}</strong>
              {!isView && (
                <button type="button" onClick={() => setField('joinCode', generateJoinCode())}>Regenerate</button>
              )}
            </div>
          )}
        </div>

        {error && <p className="teacher-form-error">{error}</p>}

        <div className="teacher-class-modal-actions">
          <button className="secondary" onClick={onClose} disabled={isSaving}>Cancel</button>
          {!isView && (
            <button className="secondary" onClick={() => submit(true)} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Draft'}
            </button>
          )}
          {!isView && (
            <button className="primary" onClick={() => submit(false)} disabled={isSaving}>
              {isSaving ? 'Saving...' : (classroom ? 'Save Changes' : 'Create Classroom')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function UploadMaterialModal({ classroomName, onClose, onSubmit, isUploading = false }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const formatFileSize = (bytes) => {
    const sizeInKb = Math.max(1, Math.round(Number(bytes || 0) / 1024));
    return sizeInKb > 1024 ? `${(sizeInKb / 1024).toFixed(1)} MB` : `${sizeInKb} KB`;
  };

  const setSelectedFile = (nextFile) => {
    if (!nextFile) {
      return;
    }
    setError('');
    setFile(nextFile);
  };

  const handleSubmit = () => {
    if (!file) {
      setError('Please choose a file to upload');
      return;
    }

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const iconMap = {
      pdf: 'fa-file-pdf',
      doc: 'fa-file-word',
      docx: 'fa-file-word',
      ppt: 'fa-file-powerpoint',
      pptx: 'fa-file-powerpoint',
      xls: 'fa-file-excel',
      xlsx: 'fa-file-excel'
    };

    const formattedSize = formatFileSize(file.size);

    onSubmit({
      file,
      title: title.trim() || file.name,
      description: description.trim(),
      fileName: file.name,
      size: formattedSize,
      uploadedDate: formatLocalDate(new Date()),
      downloads: 0,
      icon: iconMap[extension] || 'fa-file'
    });
  };

  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-action-modal teacher-upload-material-modal">
        <div className="teacher-action-modal-header">
          <div>
            <h3>Upload Material to {classroomName}</h3>
            <p className="teacher-upload-modal-subtitle">Share notes, slides, and worksheets for this class.</p>
          </div>
          <button className="teacher-modal-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="teacher-upload-modal-body">
          <div
            className={`teacher-upload-dropzone ${dragging ? 'active' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              setSelectedFile(event.dataTransfer.files?.[0]);
            }}
          >
            <i className="fas fa-cloud-upload-alt"></i>
            <p>{dragging ? 'Drop file to upload' : 'Drag and drop file here'}</p>
            <input
              ref={fileInputRef}
              id="teacher-material-upload-input"
              type="file"
              className="teacher-hidden-input"
              onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
            />
            <button
              type="button"
              className="teacher-browse-btn"
              onClick={(event) => {
                event.stopPropagation();
                fileInputRef.current?.click();
              }}
              disabled={isUploading}
            >
              Browse Files
            </button>
          </div>

          {file && (
            <div className="teacher-upload-selected-file">
              <div className="teacher-upload-selected-file-main">
                <i className="fas fa-file"></i>
                <div>
                  <strong>{file.name}</strong>
                  <small>{formatFileSize(file.size)}</small>
                </div>
              </div>
              <button
                type="button"
                className="teacher-upload-remove-file"
                onClick={() => setFile(null)}
                disabled={isUploading}
              >
                Remove
              </button>
            </div>
          )}

          <div className="teacher-form-group">
            <label htmlFor="teacher-material-title">Title</label>
            <input
              id="teacher-material-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Chapter 5 Notes"
              maxLength={150}
            />
          </div>

          <div className="teacher-form-group">
            <label htmlFor="teacher-material-description">Description</label>
            <textarea
              id="teacher-material-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional short description"
              maxLength={500}
            />
          </div>
        </div>

        {error && <p className="teacher-form-error">{error}</p>}
        <div className="teacher-class-modal-actions">
          <button className="secondary" onClick={onClose} disabled={isUploading}>Cancel</button>
          <button className="primary" onClick={handleSubmit} disabled={!file || isUploading}>
            {isUploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateAssignmentModal({ onClose, onSubmit, defaultTotal = 0, isCreating = false }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [allowLateSubmissions, setAllowLateSubmissions] = useState(false);
  const [total, setTotal] = useState(defaultTotal || 1);
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (!title.trim()) {
      setError('Assignment title is required');
      return;
    }
    if (!dueDate) {
      setError('Due date is required');
      return;
    }
    const parsedTotal = parseInt(total, 10);
    if (!Number.isInteger(parsedTotal) || parsedTotal <= 0) {
      setError('Total students must be a positive integer');
      return;
    }

    onSubmit({
      title: title.trim(),
      dueDate,
      submitted: 0,
      total: parsedTotal,
      status: 'Active',
      description: description.trim(),
      attachmentName: attachment?.name || '',
      allowLateSubmissions
    });
  };

  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-action-modal">
        <div className="teacher-action-modal-header">
          <h3>Create Assignment</h3>
          <button className="teacher-modal-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <label>Assignment Title</label>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />

        <label>Description</label>
        <textarea
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <label>Due Date</label>
        <input type="datetime-local" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />

        <label>Attachment (Optional)</label>
        <input type="file" onChange={(event) => setAttachment(event.target.files?.[0] || null)} />

        <label className="teacher-checkbox-row">
          <input
            type="checkbox"
            checked={allowLateSubmissions}
            onChange={(event) => setAllowLateSubmissions(event.target.checked)}
          />
          Allow late submissions
        </label>

        <input type="hidden" value={total} onChange={(event) => setTotal(event.target.value)} />

        {error && <p className="teacher-form-error">{error}</p>}
        <div className="teacher-class-modal-actions">
          <button className="secondary" onClick={onClose} disabled={isCreating}>Cancel</button>
          <button className="primary" onClick={handleSubmit} disabled={isCreating}>
            {isCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GradingReviewModal({
  row,
  note,
  onNoteChange,
  onClose,
  onOpenGrade,
  canGrade,
  previewUrl,
  previewMode,
  previewText,
  previewLoading,
  previewError,
  onRetryPreview,
  onDownloadFile
}) {
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);

  useEffect(() => {
    setNotesCollapsed(false);
    setZoomScale(1);
  }, [row?.id]);

  const handleZoomIn = () => setZoomScale((prev) => Math.min(prev + 0.5, 5));
  const handleZoomOut = () => setZoomScale((prev) => Math.max(prev - 0.5, 0.5));
  const handleZoomReset = () => setZoomScale(1);

  if (!row) {
    return null;
  }

  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-grading-review-modal">
        <div className="teacher-grading-review-topbar">
          <div>
            <strong>{row.fileName}</strong>
            <p>{row.studentName} · {row.fileSize}</p>
          </div>
          <div className="teacher-grading-review-topbar-actions">
            <button className="primary" onClick={() => onOpenGrade(row)} disabled={!canGrade}>
              <i className="fas fa-pen"></i>
              {canGrade ? 'Grade' : 'View Only'}
            </button>
            <button className="teacher-modal-close" onClick={onClose} aria-label="Close">
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>

        <div className="teacher-grading-preview-canvas" style={{ position: 'relative', overflow: 'hidden' }}>
          {previewLoading && (
            <div className="teacher-grading-preview-placeholder">
              <i className="fas fa-spinner fa-spin"></i>
              <h4>Loading Preview</h4>
              <p>{row.fileName}</p>
            </div>
          )}

          {!previewLoading && previewMode === 'image' && previewUrl && (
            <div className="teacher-material-preview-body" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 10, display: 'flex', gap: '8px', background: 'rgba(255, 255, 255, 0.9)', padding: '4px', borderRadius: '4px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                <button type="button" className="secondary" style={{ padding: '4px 8px', fontSize: '14px' }} onClick={handleZoomOut} title="Zoom Out">
                  <i className="fas fa-search-minus"></i>
                </button>
                <button type="button" className="secondary" style={{ padding: '4px 8px', fontSize: '14px' }} onClick={handleZoomReset} title="Reset Zoom">
                  {Math.round(zoomScale * 100)}%
                </button>
                <button type="button" className="secondary" style={{ padding: '4px 8px', fontSize: '14px' }} onClick={handleZoomIn} title="Zoom In">
                  <i className="fas fa-search-plus"></i>
                </button>
              </div>
              <img
                src={previewUrl}
                alt={row.fileName || 'Submission preview'}
                style={{
                  transform: `scale(${zoomScale})`,
                  transformOrigin: 'top center',
                  transition: 'transform 0.2s ease',
                  cursor: zoomScale > 1 ? 'grab' : 'default',
                  maxWidth: '100%',
                  maxHeight: zoomScale === 1 ? '100%' : 'none'
                }}
              />
            </div>
          )}

          {!previewLoading && previewMode === 'text' && (
            <div className="teacher-material-preview-body" style={{ alignItems: 'stretch' }}>
              <pre style={{ width: '100%', height: '100%', overflow: 'auto', margin: 0, padding: '1rem' }}>{previewText || ''}</pre>
            </div>
          )}

          {!previewLoading && previewMode === 'iframe' && previewUrl && (
            <iframe
              title={row.fileName || 'Submission Preview'}
              src={previewUrl}
              className="teacher-grading-preview-frame"
            />
          )}

          {!previewLoading && !previewUrl && previewMode !== 'text' && (
            <div className="teacher-grading-preview-placeholder">
              <i className="fas fa-file-circle-question"></i>
              <h4>Preview Unavailable</h4>
              <p>{row.fileName}</p>
              <small>{previewError || 'This submission does not include a previewable file.'}</small>
              {typeof onRetryPreview === 'function' && (
                <button type="button" className="secondary" onClick={() => onRetryPreview(row)}>
                  Retry Preview
                </button>
              )}
              {typeof onDownloadFile === 'function' && (
                <button type="button" className="primary" onClick={() => onDownloadFile(row)}>
                  Download File
                </button>
              )}
            </div>
          )}
        </div>

        <div className={`teacher-grading-annotation-panel ${notesCollapsed ? 'collapsed' : ''}`}>
          <div className="teacher-grading-annotation-header">
            <label>Teacher Notes / Annotations</label>
            <button
              type="button"
              className="teacher-notes-toggle"
              onClick={() => setNotesCollapsed((previous) => !previous)}
            >
              {notesCollapsed ? 'Show Notes' : 'Hide Notes'}
            </button>
          </div>
          {!notesCollapsed && (
            <textarea
              rows={4}
              placeholder="Write annotation notes while reviewing this submission..."
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function GradeSubmissionModal({ row, initialGrade, initialFeedback, onClose, onSave }) {
  const [grade, setGrade] = useState(initialGrade);
  const [feedback, setFeedback] = useState(initialFeedback);
  const [error, setError] = useState('');

  const submit = () => {
    const parsedGrade = Number(grade);
    if (!Number.isFinite(parsedGrade) || parsedGrade < 0 || parsedGrade > 100) {
      setError('Grade must be a number between 0 and 100');
      return;
    }

    onSave(parsedGrade, feedback.trim());
  };

  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-grade-entry-modal">
        <div className="teacher-grade-entry-header">
          <h3>Grade Submission</h3>
          <button className="teacher-modal-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="teacher-grade-entry-student">
          <div className="teacher-grading-student-avatar">{row.studentName.charAt(0)}</div>
          <div>
            <strong>{row.studentName}</strong>
            <p>{row.studentNo} · Submitted: {row.submittedAt}</p>
          </div>
        </div>

        <label>Grade (out of 100)</label>
        <input
          type="number"
          min="0"
          max="100"
          value={grade}
          onChange={(event) => {
            setGrade(event.target.value);
            setError('');
          }}
        />

        <label>Feedback (Optional)</label>
        <textarea
          rows={3}
          placeholder="Provide feedback for the student..."
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
        />

        {error && <p className="teacher-form-error">{error}</p>}

        <div className="teacher-class-modal-actions">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit}>Save Grade</button>
        </div>
      </div>
    </div>
  );
}

function AssignmentSubmissionsModal({ assignment, rows, onClose, onOpenReview, onOpenGradingWorkspace }) {
  if (!assignment) {
    return null;
  }

  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-action-modal large">
        <div className="teacher-action-modal-header">
          <h3>{assignment.title} Submissions</h3>
          <button className="teacher-modal-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="teacher-grading-table-wrap">
          <table className="teacher-grading-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Submitted</th>
                <th>File</th>
                <th>Status</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="teacher-grading-student-cell">
                      <div className="teacher-grading-student-avatar">{row.studentName.charAt(0)}</div>
                      <div>
                        <strong>{row.studentName}</strong>
                        <p>{row.studentNo}</p>
                      </div>
                    </div>
                  </td>
                  <td>{row.submittedAt}</td>
                  <td>
                    <button className="teacher-grading-file-open" onClick={() => onOpenReview(row)}>
                      <div className="teacher-grading-file-cell">
                        <i className="fas fa-file-pdf"></i>
                        <div>
                          <strong>{row.fileName}</strong>
                          <p>{row.fileSize}</p>
                        </div>
                      </div>
                    </button>
                  </td>
                  <td>
                    <span className={`teacher-grade-status-pill ${row.status}`}>
                      {row.status === 'graded' ? 'Graded' : row.status === 'late' ? 'Late' : 'Pending'}
                    </span>
                  </td>
                  <td>
                    {typeof row.grade === 'number' ? `${row.grade}/100` : '-'}
                    {row.gradedByName && (
                      <p>
                        By {row.gradedByName}
                        {row.gradedAt ? ` · ${new Date(row.gradedAt).toLocaleString('en-MY')}` : ''}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && <p className="teacher-empty">No submissions yet for this assignment.</p>}
        </div>

        <div className="teacher-class-modal-actions">
          <button className="secondary" onClick={onClose}>Close</button>
          <button className="primary" onClick={onOpenGradingWorkspace}>
            <i className="fas fa-pen"></i>
            Open Grading Workspace
          </button>
        </div>
      </div>
    </div>
  );
}

function ManageStudentsModal({ classroomName, classroomGradeLevel, enrolledStudents, allStudents, onClose, onSave }) {
  const [localStudents, setLocalStudents] = useState(enrolledStudents);

  const normalizeLevel = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const hasSpecificClassLevel = Boolean(normalizeLevel(classroomGradeLevel));
  const isAllLevelClassroom = normalizeLevel(classroomGradeLevel) === 'all level' || normalizeLevel(classroomGradeLevel) === 'all levels';
  const isLevelAllowed = (student) => {
    if (!hasSpecificClassLevel || isAllLevelClassroom) {
      return true;
    }
    return normalizeLevel(student?.studentLevel) === normalizeLevel(classroomGradeLevel);
  };

  const enrolledIds = new Set(localStudents.map((student) => student.studentId));
  const availableStudents = allStudents.filter((student) => !enrolledIds.has(student.studentId) && isLevelAllowed(student));

  const removeStudent = (studentId) => {
    setLocalStudents((previous) => previous.filter((student) => student.studentId !== studentId));
  };

  const addStudent = async (student) => {
    if (!isLevelAllowed(student)) {
      return;
    }

    try {
      const conflictCheck = await api.checkScheduleConflict(student.studentId, window.selectedClassroomId);
      if (conflictCheck.hasConflict) {
        Toast.error(`${student.name} already has a class at this time: ${conflictCheck.conflictingClassroomName}`);
        return;
      }
    } catch (error) {
      console.warn('Could not verify schedule overlap, proceeding anyway:', error);
    }

    setLocalStudents((previous) => [...previous, student]);
  };

  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-action-modal large">
        <div className="teacher-action-modal-header">
          <h3>Manage Students - {classroomName}</h3>
          <button className="teacher-modal-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="teacher-manage-grid">
          <div>
            <h4>Enrolled Students ({localStudents.length})</h4>
            <div className="teacher-manage-list">
              {localStudents.map((student) => (
                <div key={student.studentId} className="teacher-manage-item enrolled">
                  <div className="teacher-manage-student-meta">
                    <div className="teacher-manage-avatar">{student.name.charAt(0).toUpperCase()}</div>
                    <span>
                      <strong>{student.name}</strong>
                      <small>{student.studentNo}</small>
                    </span>
                  </div>
                  <button className="danger-link" onClick={() => removeStudent(student.studentId)}>Remove</button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4>Available Students ({availableStudents.length})</h4>
            {hasSpecificClassLevel && !isAllLevelClassroom && (
              <p className="teacher-action-hint">Only {classroomGradeLevel} students can be added.</p>
            )}
            <div className="teacher-manage-list">
              {availableStudents.map((student) => (
                <div key={student.studentId} className="teacher-manage-item available">
                  <div className="teacher-manage-student-meta">
                    <div className="teacher-manage-avatar muted">{student.name.charAt(0).toUpperCase()}</div>
                    <span>
                      <strong>{student.name}</strong>
                      <small>{student.studentNo}</small>
                    </span>
                  </div>
                  <button className="add-link" onClick={() => addStudent(student)}>Add</button>
                </div>
              ))}
              {availableStudents.length === 0 && <p className="teacher-action-hint">No available students</p>}
            </div>
          </div>
        </div>

        <div className="teacher-class-modal-actions">
          <button className="secondary full" onClick={() => onSave(localStudents)}>Done</button>
        </div>
      </div>
    </div>
  );
}

function ManageTeachersModal({
  classroomName,
  ownerTeacherId,
  coTeachers,
  allTeachers,
  onClose,
  onSave
}) {
  const [localTeachers, setLocalTeachers] = useState(normalizeCoTeacherList(coTeachers));

  const enrolledIds = new Set(localTeachers.map((teacher) => teacher.teacherUserId));
  const availableTeachers = allTeachers
    .filter((teacher) => !enrolledIds.has(teacher.teacherUserId) && teacher.teacherUserId !== ownerTeacherId);

  const addTeacher = (teacher) => {
    setLocalTeachers((previous) => ([
      ...previous,
      {
        teacherUserId: teacher.teacherUserId,
        name: teacher.name,
        email: teacher.email,
        accessRole: 'student'
      }
    ]));
  };

  const removeTeacher = (teacherUserId) => {
    setLocalTeachers((previous) => previous.filter((teacher) => teacher.teacherUserId !== teacherUserId));
  };

  const changeAccessRole = (teacherUserId, accessRole) => {
    setLocalTeachers((previous) => previous.map((teacher) => (
      teacher.teacherUserId === teacherUserId
        ? { ...teacher, accessRole: normalizeTeacherAccessRole(accessRole) }
        : teacher
    )));
  };

  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-action-modal large">
        <div className="teacher-action-modal-header">
          <h3>Manage Teachers - {classroomName}</h3>
          <button className="teacher-modal-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="teacher-manage-grid">
          <div>
            <h4>Assigned Teachers ({localTeachers.length})</h4>
            <div className="teacher-manage-list">
              {localTeachers.map((teacher) => (
                <div key={teacher.teacherUserId} className="teacher-manage-item enrolled">
                  <div className="teacher-manage-student-meta">
                    <div className="teacher-manage-avatar">{String(teacher.name || 'T').charAt(0).toUpperCase()}</div>
                    <span>
                      <strong>{teacher.name}</strong>
                      <small>{teacher.email || `T${String(teacher.teacherUserId).padStart(3, '0')}`}</small>
                    </span>
                  </div>

                  <div className="teacher-manage-teacher-actions">
                    <select
                      className="teacher-co-teacher-access"
                      value={normalizeTeacherAccessRole(teacher.accessRole)}
                      onChange={(event) => changeAccessRole(teacher.teacherUserId, event.target.value)}
                    >
                      <option value="student">Student Access</option>
                      <option value="teacher">Assistant Teacher (Can Create Assignment)</option>
                    </select>
                    <button className="danger-link" onClick={() => removeTeacher(teacher.teacherUserId)}>Remove</button>
                  </div>
                </div>
              ))}
              {localTeachers.length === 0 && <p className="teacher-action-hint">No assistant teacher assigned</p>}
            </div>
          </div>

          <div>
            <h4>Available Teachers ({availableTeachers.length})</h4>
            <div className="teacher-manage-list">
              {availableTeachers.map((teacher) => (
                <div key={teacher.teacherUserId} className="teacher-manage-item available">
                  <div className="teacher-manage-student-meta">
                    <div className="teacher-manage-avatar muted">{String(teacher.name || 'T').charAt(0).toUpperCase()}</div>
                    <span>
                      <strong>{teacher.name}</strong>
                      <small>{teacher.email}</small>
                    </span>
                  </div>
                  <button className="add-link" onClick={() => addTeacher(teacher)}>Add</button>
                </div>
              ))}
              {availableTeachers.length === 0 && <p className="teacher-action-hint">No available teachers</p>}
            </div>
          </div>
        </div>

        <div className="teacher-class-modal-actions">
          <button className="secondary full" onClick={() => onSave(normalizeCoTeacherList(localTeachers))}>Done</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmRemoveMaterialModal({ fileName, isRemoving = false, onCancel, onConfirm }) {
  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-action-modal teacher-confirm-modal">
        <div className="teacher-action-modal-header">
          <h3>Remove Material</h3>
        </div>

        <p className="teacher-confirm-message">
          Remove "{fileName}" from class materials?
        </p>

        <div className="teacher-class-modal-actions">
          <button className="secondary" onClick={onCancel} disabled={isRemoving}>Cancel</button>
          <button className="danger" onClick={onConfirm} disabled={isRemoving}>
            {isRemoving ? 'Removing...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmArchiveClassModal({ classroomName, onCancel, onConfirm }) {
  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-action-modal teacher-confirm-modal">
        <div className="teacher-action-modal-header">
          <h3>Archive Class</h3>
        </div>

        <p className="teacher-confirm-message">
          Are you sure you want to archive "{classroomName}"?
        </p>

        <div className="teacher-class-modal-actions">
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

function ClassAnnouncementModal({ classroomName, message, onMessageChange, onClose, onPost, isPosting = false }) {
  const messageLength = String(message || '').length;

  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-action-modal teacher-announcement-modal">
        <div className="teacher-action-modal-header">
          <div>
            <h3>Post Announcement</h3>
            <p>{classroomName}</p>
          </div>
          <button className="teacher-modal-close" onClick={onClose} aria-label="Close announcement modal" disabled={isPosting}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <label htmlFor="teacher-announcement-modal-message">Announcement Message</label>
        <textarea
          id="teacher-announcement-modal-message"
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          placeholder="Write an announcement for students..."
          rows={5}
          maxLength={260}
        />
        <p className="teacher-announcement-count">{messageLength}/260</p>

        <div className="teacher-class-modal-actions">
          <button className="secondary" onClick={onClose} disabled={isPosting}>Cancel</button>
          <button className="primary" onClick={onPost} disabled={!message.trim() || isPosting}>
            <i className={`fas ${isPosting ? 'fa-spinner fa-spin' : 'fa-bullhorn'}`}></i>
            {isPosting ? 'Posting...' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TakeAttendanceModal({ classroomName, students, initialDate, onClose, onSave }) {
  const sortedStudents = useMemo(() => {
    const toSortNumber = (student) => {
      const rawCode = String(student?.studentNo || '');
      const numeric = Number(rawCode.replace(/[^0-9]/g, ''));
      if (Number.isInteger(numeric) && numeric > 0) {
        return numeric;
      }
      const fallbackId = Number(student?.studentId || student?.userId || 0);
      return Number.isInteger(fallbackId) && fallbackId > 0 ? fallbackId : Number.MAX_SAFE_INTEGER;
    };

    return [...(Array.isArray(students) ? students : [])].sort((first, second) => {
      const firstNo = toSortNumber(first);
      const secondNo = toSortNumber(second);
      if (firstNo !== secondNo) {
        return firstNo - secondNo;
      }
      return String(first?.name || '').localeCompare(String(second?.name || ''));
    });
  }, [students]);

  const [date, setDate] = useState(initialDate || formatLocalDate(new Date()));
  const displayStudentNoById = useMemo(() => {
    const next = {};
    sortedStudents.forEach((student, index) => {
      next[student.studentId] = `S${String(index + 1).padStart(3, '0')}`;
    });
    return next;
  }, [sortedStudents]);

  const [statusMap, setStatusMap] = useState(() => {
    const seed = {};
    students.forEach((student) => {
      seed[student.studentId] = false;
    });
    return seed;
  });

  const totalStudents = sortedStudents.length;
  const presentCount = sortedStudents.filter((student) => Boolean(statusMap[student.studentId])).length;

  const toggleStudent = (studentId) => {
    setStatusMap((previous) => ({
      ...previous,
      [studentId]: !previous[studentId]
    }));
  };

  const markAll = (isPresent) => {
    const updated = {};
    sortedStudents.forEach((student) => {
      updated[student.studentId] = isPresent;
    });
    setStatusMap(updated);
  };

  const handleSave = () => {
    onSave({ date, statusMap, presentCount, totalStudents, students: sortedStudents });
  };

  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-action-modal teacher-take-attendance-modal">
        <div className="teacher-action-modal-header">
          <div>
            <h3>Take Attendance</h3>
            <p>{classroomName}</p>
          </div>
          <button className="teacher-modal-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="teacher-take-attendance-body">
          <label>Date</label>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />

          <div className="teacher-take-attendance-tools">
            <span className="teacher-present-counter">{presentCount}/{totalStudents} Present</span>
            <button className="all-present" onClick={() => markAll(true)}>All Present</button>
            <button className="all-absent" onClick={() => markAll(false)}>All Absent</button>
          </div>

          <div className="teacher-take-student-list">
            {sortedStudents.map((student) => (
              <button
                key={student.studentId}
                className={`teacher-take-student-item ${statusMap[student.studentId] ? 'present' : ''}`}
                onClick={() => toggleStudent(student.studentId)}
              >
                <div className="student-main">
                  <div className="student-avatar">{student.name.charAt(0).toUpperCase()}</div>
                  <div>
                    <strong>{student.name}</strong>
                      <p>{displayStudentNoById[student.studentId] || student.studentNo}</p>
                  </div>
                </div>
                <span className={`teacher-toggle-dot ${statusMap[student.studentId] ? 'on' : ''}`}></span>
              </button>
            ))}
          </div>
        </div>

        <div className="teacher-class-modal-actions">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button className="success" onClick={handleSave}>Save Attendance</button>
        </div>
      </div>
    </div>
  );
}

function AttendanceRecordModal({ classroomName, dateKey, students, initialStatusMap, recordMeta, onClose, onSave }) {
  const sortedStudents = useMemo(() => {
    const toSortNumber = (student) => {
      const rawCode = String(student?.studentNo || '');
      const numeric = Number(rawCode.replace(/[^0-9]/g, ''));
      if (Number.isInteger(numeric) && numeric > 0) {
        return numeric;
      }
      const fallbackId = Number(student?.studentId || student?.userId || 0);
      return Number.isInteger(fallbackId) && fallbackId > 0 ? fallbackId : Number.MAX_SAFE_INTEGER;
    };

    return [...(Array.isArray(students) ? students : [])].sort((first, second) => {
      const firstNo = toSortNumber(first);
      const secondNo = toSortNumber(second);
      if (firstNo !== secondNo) {
        return firstNo - secondNo;
      }
      return String(first?.name || '').localeCompare(String(second?.name || ''));
    });
  }, [students]);

  const displayStudentNoById = useMemo(() => {
    const next = {};
    sortedStudents.forEach((student, index) => {
      next[student.studentId] = `S${String(index + 1).padStart(3, '0')}`;
    });
    return next;
  }, [sortedStudents]);

  const [statusMap, setStatusMap] = useState(() => ({ ...initialStatusMap }));

  const totalStudents = sortedStudents.length;
  const presentCount = sortedStudents.filter((student) => Boolean(statusMap[student.studentId])).length;
  const rate = totalStudents > 0 ? ((presentCount / totalStudents) * 100).toFixed(1) : '0.0';
  const dateLabel = new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-MY', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
  const recordedByLabel = String(recordMeta?.recordedByName || '-');
  const recordedAtLabel = recordMeta?.recordedAt ? new Date(recordMeta.recordedAt).toLocaleString('en-MY') : '';
  const updatedByLabel = String(recordMeta?.updatedByName || '');
  const updatedAtLabel = recordMeta?.updatedAt ? new Date(recordMeta.updatedAt).toLocaleString('en-MY') : '';

  const toggleStudent = (studentId) => {
    setStatusMap((previous) => ({
      ...previous,
      [studentId]: !previous[studentId]
    }));
  };

  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-action-modal teacher-attendance-record-modal">
        <div className="teacher-action-modal-header">
          <div>
            <h3>Attendance Record</h3>
            <p>{dateLabel}</p>
            <p>{classroomName}</p>
            <p>Recorded by {recordedByLabel}{recordedAtLabel ? ` · ${recordedAtLabel}` : ''}</p>
            {updatedByLabel && <p>Updated by {updatedByLabel}{updatedAtLabel ? ` · ${updatedAtLabel}` : ''}</p>}
          </div>
          <button className="teacher-modal-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="teacher-take-attendance-body">
          <div className="teacher-record-summary-strip">
            <span>{presentCount}/{totalStudents} Present</span>
            <span>{rate}% Attendance</span>
          </div>

          <div className="teacher-record-student-list">
            {sortedStudents.map((student) => {
              const isPresent = Boolean(statusMap[student.studentId]);
              return (
                <button
                  key={student.studentId}
                  className={`teacher-record-student-item ${isPresent ? 'present' : 'absent'}`}
                  onClick={() => toggleStudent(student.studentId)}
                >
                  <div className="student-main">
                    <div className="student-avatar">{student.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <strong>{student.name}</strong>
                      <p>{displayStudentNoById[student.studentId] || student.studentNo}</p>
                    </div>
                  </div>
                  <span className={`teacher-record-status-pill ${isPresent ? 'present' : 'absent'}`}>
                    {isPresent ? 'Present' : 'Absent'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="teacher-class-modal-actions">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => onSave(statusMap)}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

function StudentAttendanceModal({ classroomName, student, historyRows, onClose }) {
  const presentCount = historyRows.filter((row) => row.present).length;
  const absentCount = historyRows.length - presentCount;
  const rate = historyRows.length > 0 ? ((presentCount / historyRows.length) * 100).toFixed(1) : '0.0';

  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-action-modal teacher-student-attendance-modal">
        <div className="teacher-action-modal-header">
          <div className="teacher-student-modal-header-main">
            <div className="student-avatar">{student.name.charAt(0).toUpperCase()}</div>
            <div>
              <h3>{student.name}</h3>
              <p>{student.studentNo} · {classroomName}</p>
            </div>
          </div>
          <button className="teacher-modal-close" onClick={onClose} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="teacher-take-attendance-body">
          <div className="teacher-student-summary-cards">
            <div className="present">
              <strong>{presentCount}</strong>
              <span>Present</span>
            </div>
            <div className="absent">
              <strong>{absentCount}</strong>
              <span>Absent</span>
            </div>
            <div className="rate">
              <strong>{rate}%</strong>
              <span>Rate</span>
            </div>
          </div>

          <h4 className="teacher-student-history-title">Attendance History</h4>
          <div className="teacher-student-history-list">
            {historyRows.map((row) => (
              <div key={row.dateKey} className="teacher-student-history-item">
                <div>
                  <strong>{row.dateKey}</strong>
                  <p>{row.day}</p>
                </div>
                <span className={`teacher-record-status-pill ${row.present ? 'present' : 'absent'}`}>
                  {row.present ? 'Present' : 'Absent'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="teacher-class-modal-actions">
          <button className="secondary full" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function MaterialPreviewModal({ fileName, previewUrl, onClose }) {
  const [zoomScale, setZoomScale] = useState(1);
  const isImage = previewUrl && /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName || previewUrl);

  const handleZoomIn = () => setZoomScale((prev) => Math.min(prev + 0.5, 5));
  const handleZoomOut = () => setZoomScale((prev) => Math.max(prev - 0.5, 0.5));
  const handleZoomReset = () => setZoomScale(1);

  if (!previewUrl) {
    return null;
  }

  return (
    <div className="teacher-class-modal-backdrop">
      <div className="teacher-action-modal large teacher-material-preview-modal">
        <div className="teacher-action-modal-header">
          <h3>{fileName || 'Material Preview'}</h3>
          <button className="teacher-modal-close" onClick={onClose} aria-label="Close preview">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="teacher-material-preview-body" style={isImage ? { position: 'relative', width: '100%', height: '100%', overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center' } : {}}>
          {isImage ? (
            <>
              <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 10, display: 'flex', gap: '8px', background: 'rgba(255, 255, 255, 0.9)', padding: '4px', borderRadius: '4px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                <button type="button" className="secondary" style={{ padding: '4px 8px', fontSize: '14px' }} onClick={handleZoomOut} title="Zoom Out">
                  <i className="fas fa-search-minus"></i>
                </button>
                <button type="button" className="secondary" style={{ padding: '4px 8px', fontSize: '14px' }} onClick={handleZoomReset} title="Reset Zoom">
                  {Math.round(zoomScale * 100)}%
                </button>
                <button type="button" className="secondary" style={{ padding: '4px 8px', fontSize: '14px' }} onClick={handleZoomIn} title="Zoom In">
                  <i className="fas fa-search-plus"></i>
                </button>
              </div>
              <img
                src={previewUrl}
                alt={fileName || 'Material preview'}
                style={{
                  transform: `scale(${zoomScale})`,
                  transformOrigin: 'top center',
                  transition: 'transform 0.2s ease',
                  cursor: zoomScale > 1 ? 'grab' : 'default',
                  maxWidth: '100%',
                  maxHeight: zoomScale === 1 ? '100%' : 'none'
                }}
              />
            </>
          ) : (
            <iframe
              title={fileName || 'Material preview'}
              src={previewUrl}
              className="teacher-material-preview-frame"
            />
          )}
        </div>

        <div className="teacher-class-modal-actions">
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function TeacherClassroomTab({ navigationIntent = null, onNavigationIntentConsumed = null }) {
  const formatTeacherDisplayName = (teacherTitle, fullName) => {
    const normalizedTitle = String(teacherTitle || '').trim().toLowerCase();
    const normalizedName = String(fullName || '').trim();

    if (!normalizedName) {
      return 'Teacher';
    }

    if (/^(mr|ms)\.?\s+/i.test(normalizedName)) {
      return normalizedName;
    }

    if (normalizedTitle === 'mr') {
      return `Mr ${normalizedName}`;
    }

    if (normalizedTitle === 'ms') {
      return `Ms ${normalizedName}`;
    }

    return normalizedName;
  };

  const currentTeacherProfile = useMemo(() => {
    try {
      const raw = storage.getItem('user');
      const parsed = raw ? JSON.parse(raw) : null;
      const fullName = String(parsed?.fullName || parsed?.name || parsed?.username || '').trim();
      const teacherTitle = String(parsed?.teacherTitle || '').trim();
      return {
        teacherUserId: Number(parsed?.userId || 0),
        fullName: fullName || 'Teacher',
        teacherTitle,
        displayName: formatTeacherDisplayName(teacherTitle, fullName)
      };
    } catch (_error) {
      return { teacherUserId: 0, fullName: 'Teacher', teacherTitle: '', displayName: 'Teacher' };
    }
  }, []);

  const lastSyncedStateRef = useRef('');
  const skipNextSyncRef = useRef(true);
  const [subTab, setSubTab] = useState('my-classes');
  const [toast, setToast] = useState(null);
  const [materialPreviewDialog, setMaterialPreviewDialog] = useState({ open: false, url: '', fileName: '' });
  const [search, setSearch] = useState('');
  const [modalState, setModalState] = useState({ open: false, mode: 'create', classroom: null });
  const [actionModal, setActionModal] = useState({ open: false, type: null });
  const [removeMaterialDialog, setRemoveMaterialDialog] = useState({ open: false, materialId: null, fileName: '' });
  const [isRemovingMaterial, setIsRemovingMaterial] = useState(false);
  const [archiveClassDialog, setArchiveClassDialog] = useState({ open: false, classroomId: null, classroomName: '' });
  const [takeAttendanceModalOpen, setTakeAttendanceModalOpen] = useState(false);
  const [announcementModalOpen, setAnnouncementModalOpen] = useState(false);
  const [attendanceRecordModal, setAttendanceRecordModal] = useState({ open: false, dateKey: '' });
  const [studentAttendanceModal, setStudentAttendanceModal] = useState({ open: false, studentId: null });
  const [manageClassMenuOpen, setManageClassMenuOpen] = useState(false);
  const [announcementDraft, setAnnouncementDraft] = useState('');
  const [classAnnouncements, setClassAnnouncements] = useState({});
  const [postingAnnouncement, setPostingAnnouncement] = useState(false);
  const [savingClassroom, setSavingClassroom] = useState(false);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const [creatingAssignment, setCreatingAssignment] = useState(false);
  const [downloadingMaterialId, setDownloadingMaterialId] = useState(null);
  const [refreshingData, setRefreshingData] = useState(false);
  const [attendanceConfirmOpen, setAttendanceConfirmOpen] = useState(false);
  const [confirmingAttendance, setConfirmingAttendance] = useState(false);
  const [selectedClassroomId, setSelectedClassroomId] = useState(null);
  const [classroomDetailTab, setClassroomDetailTab] = useState('materials');

  const [classrooms, setClassrooms] = useState([]);

  const [attendanceDate, setAttendanceDate] = useState(formatLocalDate(new Date()));
  const [attendanceClassroomId, setAttendanceClassroomId] = useState(null);
  const [attendanceView, setAttendanceView] = useState('calendar');
  const [attendanceMonthOffset, setAttendanceMonthOffset] = useState(0);
  const [attendanceSearch, setAttendanceSearch] = useState('');

  const [gradingClassroomId, setGradingClassroomId] = useState(null);
  const [selectedGradingAssignmentId, setSelectedGradingAssignmentId] = useState(null);
  const [gradingSearch, setGradingSearch] = useState('');
  const [gradingStatusFilter, setGradingStatusFilter] = useState('all');

  const [gradingSubmissionsByAssignment, setGradingSubmissionsByAssignment] = useState({});
  const [allStudentsMaster, setAllStudentsMaster] = useState([]);
  const [allTeachersMaster, setAllTeachersMaster] = useState([]);
  const [materialsByClassroom, setMaterialsByClassroom] = useState({});
  const [assignmentsByClassroom, setAssignmentsByClassroom] = useState({});
  const [studentsByClassroom, setStudentsByClassroom] = useState({});

  const normalizeClassroomRecord = (classroom) => {
    const source = classroom && typeof classroom === 'object' ? classroom : {};
    const classroomId = Number(source.classroomId || source.id);
    const ownerTeacherId = Number(source.ownerTeacherId || currentTeacherProfile.teacherUserId || 0);
    return {
      ...source,
      classroomId: Number.isInteger(classroomId) ? classroomId : 0,
      classroomName: String(source.classroomName || source.title || ''),
      subject: String(source.subject || ''),
      classSchedule: String(source.classSchedule || source.schedule || ''),
      section: String(source.section || ''),
      status: String(source.status || 'Active'),
      ownerTeacherId: Number.isInteger(ownerTeacherId) && ownerTeacherId > 0 ? ownerTeacherId : currentTeacherProfile.teacherUserId,
      ownerTeacherName: String(source.ownerTeacherName || currentTeacherProfile.displayName || 'Teacher'),
      coTeachers: normalizeCoTeacherList(source.coTeachers),
      assistantAccessRole: String(source.assistantAccessRole || 'owner').toLowerCase(),
      isSharedClassroom: Boolean(source.isSharedClassroom)
    };
  };

  const filteredClassrooms = useMemo(() => {
    const visibleClassrooms = classrooms.filter((classroom) => String(classroom?.status || '').trim().toLowerCase() !== 'archived');
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return visibleClassrooms;
    }

    return visibleClassrooms.filter((classroom) => (
      String(classroom.classroomName || '').toLowerCase().includes(keyword)
      || String(classroom.subject || '').toLowerCase().includes(keyword)
      || String(classroom.section || '').toLowerCase().includes(keyword)
    ));
  }, [classrooms, search]);

  const selectedClassroom = useMemo(
    () => classrooms.find((item) => item.classroomId === selectedClassroomId) || null,
    [classrooms, selectedClassroomId]
  );

  const selectedClassMaterials = selectedClassroom ? (materialsByClassroom[selectedClassroom.classroomId] || []) : [];
  const selectedClassAssignments = selectedClassroom ? (assignmentsByClassroom[selectedClassroom.classroomId] || []) : [];
  const selectedClassStudents = selectedClassroom ? (studentsByClassroom[selectedClassroom.classroomId] || []) : [];
  const selectedClassAnnouncements = selectedClassroom ? (classAnnouncements[selectedClassroom.classroomId] || []) : [];
  const selectedClassCoTeachers = selectedClassroom ? normalizeCoTeacherList(selectedClassroom.coTeachers) : [];
  const isSelectedClassOwner = selectedClassroom
    ? Number(selectedClassroom.ownerTeacherId || 0) === Number(currentTeacherProfile.teacherUserId || 0)
    : false;
  const selectedCoTeacherEntry = selectedClassCoTeachers.find(
    (entry) => Number(entry.teacherUserId) === Number(currentTeacherProfile.teacherUserId || 0)
  ) || null;
  const selectedAssistantAccessRole = isSelectedClassOwner
    ? 'owner'
    : normalizeTeacherAccessRole(selectedCoTeacherEntry?.accessRole || selectedClassroom?.assistantAccessRole);
  const canCreateAssignmentOnSelectedClass = isSelectedClassOwner || selectedAssistantAccessRole === 'teacher';
  const canManageClassroomTeachers = isSelectedClassOwner;
  const canManageClassroomStudents = isSelectedClassOwner;
  const canManageClassroomMaterials = isSelectedClassOwner || selectedAssistantAccessRole === 'teacher';
  const canPostClassAnnouncement = isSelectedClassOwner;
  const selectedClassActiveAssignments = selectedClassAssignments.filter((item) => item.status === 'Active').length;
  const [gradingReviewModal, setGradingReviewModal] = useState({ open: false, row: null });
  const [gradeEntryModal, setGradeEntryModal] = useState({ open: false, row: null });
  const [gradingPreviewState, setGradingPreviewState] = useState({
    url: '',
    mode: 'iframe',
    text: '',
    loading: false,
    error: ''
  });
  const [assignmentSubmissionsModal, setAssignmentSubmissionsModal] = useState({ open: false, assignment: null });
  const [gradingNotesBySubmission, setGradingNotesBySubmission] = useState({});
  const [gradingFeedbackBySubmission, setGradingFeedbackBySubmission] = useState({});

  const selectedAssignmentSubmissionRows = useMemo(() => {
    if (!assignmentSubmissionsModal.assignment || !selectedClassroom) {
      return [];
    }

    const rows = gradingSubmissionsByAssignment[assignmentSubmissionsModal.assignment.id] || [];
    return rows.filter((row) => Number(row?.classroomId) === Number(selectedClassroom.classroomId));
  }, [assignmentSubmissionsModal.assignment, gradingSubmissionsByAssignment, selectedClassroom]);

  useEffect(() => {
    if (!navigationIntent) {
      return;
    }

    const { subTab: targetSubTab, classroomId, assignmentId } = navigationIntent;

    if (targetSubTab === 'attendance') {
      setSubTab('attendance');
      setAttendanceMonthOffset(0);

      const hasClassroom = classrooms.some((item) => item.classroomId === classroomId);
      if (hasClassroom) {
        setAttendanceClassroomId(classroomId);
      }
    } else if (targetSubTab === 'grading') {
      setSubTab('grading');
      if (typeof classroomId === 'number') {
        const hasClassroom = classrooms.some((item) => item.classroomId === classroomId);
        if (hasClassroom) {
          setGradingClassroomId(classroomId);
          const classroomAssignments = assignmentsByClassroom[classroomId] || [];
          const hasAssignment = classroomAssignments.some((assignment) => assignment.id === assignmentId);
          setSelectedGradingAssignmentId(hasAssignment ? assignmentId : null);
          setGradingSearch('');
          setGradingStatusFilter('all');
        }
      } else if (typeof assignmentId === 'number') {
        setSelectedGradingAssignmentId(assignmentId);
      }
    } else if (targetSubTab === 'my-classes') {
      setSubTab('my-classes');
      if (typeof classroomId === 'number') {
        const hasClassroom = classrooms.some((item) => item.classroomId === classroomId);
        if (hasClassroom) {
          setSelectedClassroomId(classroomId);
        }
      }
    }

    if (typeof onNavigationIntentConsumed === 'function') {
      onNavigationIntentConsumed();
    }
  }, [assignmentsByClassroom, classrooms, navigationIntent, onNavigationIntentConsumed]);

  const selectedGradingClassroom = useMemo(
    () => classrooms.find((item) => item.classroomId === gradingClassroomId) || null,
    [classrooms, gradingClassroomId]
  );

  const gradingEligibleClassrooms = useMemo(
    () => classrooms.filter((classroom) => {
      const ownerId = Number(classroom?.ownerTeacherId || 0);
      if (ownerId === Number(currentTeacherProfile.teacherUserId || 0)) {
        return true;
      }

      if (Boolean(classroom?.isSharedClassroom)) {
        return true;
      }

      const assistantRole = normalizeTeacherAccessRole(classroom?.assistantAccessRole);
      return assistantRole === 'teacher' || assistantRole === 'student';
    }),
    [classrooms, currentTeacherProfile.teacherUserId]
  );
  const canGradeSelectedClassroom = useMemo(() => {
    if (!selectedGradingClassroom) {
      return false;
    }

    const ownerId = Number(selectedGradingClassroom?.ownerTeacherId || 0);
    if (ownerId === Number(currentTeacherProfile.teacherUserId || 0)) {
      return true;
    }

    return normalizeTeacherAccessRole(selectedGradingClassroom?.assistantAccessRole) === 'teacher';
  }, [selectedGradingClassroom, currentTeacherProfile.teacherUserId]);

  const gradingAssignments = useMemo(
    () => assignmentsByClassroom[gradingClassroomId] || [],
    [assignmentsByClassroom, gradingClassroomId]
  );

  const selectedGradingAssignment = useMemo(() => {
    if (gradingAssignments.length === 0 || selectedGradingAssignmentId === null) {
      return null;
    }
    return gradingAssignments.find((item) => item.id === selectedGradingAssignmentId) || null;
  }, [gradingAssignments, selectedGradingAssignmentId]);

  const gradingRows = useMemo(() => {
    if (!selectedGradingAssignment || !selectedGradingClassroom) {
      return [];
    }

    const keyword = gradingSearch.trim().toLowerCase();
    const rows = (gradingSubmissionsByAssignment[selectedGradingAssignment.id] || [])
      .filter((row) => Number(row?.classroomId) === Number(selectedGradingClassroom.classroomId));

    return rows.filter((row) => {
      const statusMatched = gradingStatusFilter === 'all' || row.status === gradingStatusFilter;
      if (!statusMatched) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      return (
        row.studentName.toLowerCase().includes(keyword)
        || row.studentNo.toLowerCase().includes(keyword)
        || row.fileName.toLowerCase().includes(keyword)
      );
    });
  }, [gradingSearch, gradingStatusFilter, gradingSubmissionsByAssignment, selectedGradingAssignment, selectedGradingClassroom]);

  const gradingSummary = useMemo(() => {
    if (!selectedGradingAssignment) {
      return { total: 0, pending: 0, graded: 0, avgGrade: '0.0' };
    }

    const rows = (gradingSubmissionsByAssignment[selectedGradingAssignment.id] || [])
      .filter((row) => Number(row?.classroomId) === Number(selectedGradingClassroom?.classroomId));
    const pending = rows.filter((row) => row.status === 'pending' || row.status === 'late').length;
    const gradedRows = rows.filter((row) => row.status === 'graded' && typeof row.grade === 'number');
    const totalScore = gradedRows.reduce((sum, row) => sum + row.grade, 0);
    const avgGrade = gradedRows.length > 0 ? (totalScore / gradedRows.length).toFixed(1) : '0.0';

    return {
      total: rows.length,
      pending,
      graded: gradedRows.length,
      avgGrade
    };
  }, [gradingSubmissionsByAssignment, selectedGradingAssignment, selectedGradingClassroom]);

  useEffect(() => {
    if (gradingEligibleClassrooms.length === 0) {
      if (gradingClassroomId !== null) {
        setGradingClassroomId(null);
      }
      return;
    }

    const hasCurrentClassroom = gradingEligibleClassrooms.some((classroom) => classroom.classroomId === gradingClassroomId);
    if (!hasCurrentClassroom) {
      setGradingClassroomId(gradingEligibleClassrooms[0].classroomId);
      setSelectedGradingAssignmentId(null);
      setGradingSearch('');
      setGradingStatusFilter('all');
    }
  }, [gradingClassroomId, gradingEligibleClassrooms]);

  useEffect(() => {
    if (classrooms.length === 0) {
      if (attendanceClassroomId !== null) {
        setAttendanceClassroomId(null);
      }
      return;
    }

    const hasCurrentClassroom = classrooms.some((classroom) => classroom.classroomId === attendanceClassroomId);
    if (!hasCurrentClassroom) {
      setAttendanceClassroomId(classrooms[0].classroomId);
    }
  }, [attendanceClassroomId, classrooms]);

  const [attendanceRecordsByClassroom, setAttendanceRecordsByClassroom] = useState({});

  const selectedAttendanceRecords = useMemo(
    () => attendanceRecordsByClassroom[attendanceClassroomId] || {},
    [attendanceClassroomId, attendanceRecordsByClassroom]
  );
  const selectedAttendanceStudents = useMemo(
    () => studentsByClassroom[attendanceClassroomId] || [],
    [attendanceClassroomId, studentsByClassroom]
  );
  const todayKey = formatLocalDate(new Date());

  const [attendanceStudentStatsByClassroom, setAttendanceStudentStatsByClassroom] = useState({});
  const [attendanceDetailByClassroom, setAttendanceDetailByClassroom] = useState({});

  const selectedAttendanceDetailByDate = useMemo(
    () => attendanceDetailByClassroom[attendanceClassroomId] || {},
    [attendanceClassroomId, attendanceDetailByClassroom]
  );
  const editingAttendanceStatusMap = attendanceRecordModal.dateKey
    ? (selectedAttendanceDetailByDate[attendanceRecordModal.dateKey] || {})
    : {};
  const selectedAttendanceRecordMeta = attendanceRecordModal.dateKey
    ? (selectedAttendanceRecords[attendanceRecordModal.dateKey] || null)
    : null;
  const selectedAttendanceStudent = selectedAttendanceStudents.find((student) => student.studentId === studentAttendanceModal.studentId) || null;

  const selectedStudentHistoryRows = useMemo(() => {
    if (!studentAttendanceModal.studentId) {
      return [];
    }

    return Object.entries(selectedAttendanceDetailByDate)
      .map(([dateKey, statusMap]) => ({
        dateKey,
        day: new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-MY', { weekday: 'long' }),
        present: Boolean(statusMap?.[studentAttendanceModal.studentId])
      }))
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [selectedAttendanceDetailByDate, studentAttendanceModal.studentId]);

  const selectedAttendanceClassroom = classrooms.find((item) => item.classroomId === attendanceClassroomId) || null;
  const canTakeAttendanceSelectedClassroom = useMemo(() => {
    if (!selectedAttendanceClassroom) {
      return false;
    }

    const ownerId = Number(selectedAttendanceClassroom?.ownerTeacherId || 0);
    if (ownerId === Number(currentTeacherProfile.teacherUserId || 0)) {
      return true;
    }

    return normalizeTeacherAccessRole(selectedAttendanceClassroom?.assistantAccessRole) === 'teacher';
  }, [selectedAttendanceClassroom, currentTeacherProfile.teacherUserId]);

  const selectedClassAverageAttendance = useMemo(() => {
    if (!selectedClassroom) {
      return 0;
    }

    const classRecords = attendanceRecordsByClassroom[selectedClassroom.classroomId] || {};
    const records = Object.values(classRecords);
    const totalPresent = records.reduce((sum, record) => sum + Number(record?.present || 0), 0);
    const totalExpected = records.reduce((sum, record) => sum + Number(record?.total || 0), 0);

    if (totalExpected <= 0) {
      return 0;
    }

    return Number(((totalPresent / totalExpected) * 100).toFixed(1));
  }, [attendanceRecordsByClassroom, selectedClassroom]);

  const attendanceMonthDate = useMemo(
    () => {
      const today = new Date();
      return new Date(today.getFullYear(), today.getMonth() + attendanceMonthOffset, 1);
    },
    [attendanceMonthOffset]
  );

  const attendanceMonthLabel = useMemo(
    () => attendanceMonthDate.toLocaleString('en-MY', { month: 'long', year: 'numeric' }),
    [attendanceMonthDate]
  );

  const attendanceStatsCards = useMemo(() => {
    const records = Object.values(selectedAttendanceRecords);
    const studentStats = attendanceStudentStatsByClassroom[attendanceClassroomId] || {};
    const totalSessions = records.length;
    const totalPresent = records.reduce((sum, item) => sum + item.present, 0);
    const totalExpected = records.reduce((sum, item) => sum + item.total, 0);
    const maxStudents = records.reduce((max, item) => Math.max(max, item.total), 0);
    const overallRate = totalExpected > 0 ? ((totalPresent / totalExpected) * 100).toFixed(1) : '0.0';
    const lowAttendance = Object.values(studentStats).filter((item) => {
      const attempts = item.present + item.absent;
      if (attempts === 0) {
        return false;
      }
      return (item.present / attempts) < 0.8;
    }).length;
    return {
      totalSessions,
      overallRate,
      totalStudents: maxStudents,
      lowAttendance
    };
  }, [attendanceClassroomId, attendanceStudentStatsByClassroom, selectedAttendanceRecords]);

  const attendanceCalendarCells = useMemo(() => {
    const firstWeekDay = attendanceMonthDate.getDay();
    const daysInMonth = new Date(attendanceMonthDate.getFullYear(), attendanceMonthDate.getMonth() + 1, 0).getDate();
    const cells = [];

    for (let index = 0; index < firstWeekDay; index += 1) {
      cells.push({ key: `empty-start-${index}`, empty: true });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${attendanceMonthDate.getFullYear()}-${String(attendanceMonthDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const record = selectedAttendanceRecords[dateKey];
      cells.push({
        key: dateKey,
        day,
        dateKey,
        record,
        hasRecord: Boolean(record),
        full: record ? record.present === record.total : false,
        isToday: dateKey === todayKey
      });
    }

    const remaining = (7 - (cells.length % 7)) % 7;
    for (let index = 0; index < remaining; index += 1) {
      cells.push({ key: `empty-end-${index}`, empty: true });
    }

    return cells;
  }, [attendanceMonthDate, selectedAttendanceRecords, todayKey]);

  const attendanceListRows = useMemo(() => {
    const keyword = attendanceSearch.trim().toLowerCase();
    return Object.entries(selectedAttendanceRecords)
      .map(([dateKey, record]) => {
        const day = new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-MY', { weekday: 'long' });
        const rate = record.total > 0 ? Math.round((record.present / record.total) * 100) : 0;
        const doneBy = record.updatedByName || record.recordedByName || '-';
        const doneAt = record.updatedAt || record.recordedAt || '';
        return {
          dateKey,
          day,
          present: record.present,
          absent: Math.max(0, record.total - record.present),
          rate,
          doneBy,
          doneAt
        };
      })
      .filter((row) => {
        if (!keyword) {
          return true;
        }
        return row.dateKey.toLowerCase().includes(keyword) || row.day.toLowerCase().includes(keyword);
      })
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [attendanceSearch, selectedAttendanceRecords]);

  const attendanceStudentRows = useMemo(() => {
    const keyword = attendanceSearch.trim().toLowerCase();
    const studentStats = attendanceStudentStatsByClassroom[attendanceClassroomId] || {};
    return selectedAttendanceStudents
      .map((student) => {
        const stats = studentStats[student.studentId] || { present: 0, absent: 0 };
        const total = stats.present + stats.absent;
        const rate = total > 0 ? ((stats.present / total) * 100).toFixed(1) : '0.0';
        return {
          ...student,
          present: stats.present,
          absent: stats.absent,
          rate,
          rateNumber: Number(rate)
        };
      })
      .filter((student) => {
        if (!keyword) {
          return true;
        }
        return student.name.toLowerCase().includes(keyword) || student.studentNo.toLowerCase().includes(keyword);
      });
  }, [attendanceClassroomId, attendanceSearch, attendanceStudentStatsByClassroom, selectedAttendanceStudents]);

  const showMessage = (message, type = 'success') => {
    setToast({ message, type });
  };

  const formatBytesLabel = (value) => {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) {
      return '-';
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const sanitizeClassroomPayload = (payload) => {
    const sanitized = { ...payload };
    delete sanitized.bannerFile;
    return sanitized;
  };

  const getDownloadFileName = (headers, fallback) => {
    const disposition = headers?.['content-disposition'] || headers?.['Content-Disposition'] || '';
    const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
    const encodedName = match?.[1] || match?.[2];
    if (!encodedName) {
      return fallback || 'download';
    }
    try {
      return decodeURIComponent(encodedName);
    } catch (error) {
      return encodedName;
    }
  };

  const previewMaterialFile = async (material) => {
    const fileId = Number(material?.fileId);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      showMessage('Preview is only available for uploaded cloud files', 'warning');
      return;
    }

    try {
      const response = await api.get(`/storage/files/${fileId}/preview`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(response.data);
      setMaterialPreviewDialog((previous) => {
        if (previous.url) {
          window.URL.revokeObjectURL(previous.url);
        }
        return {
          open: true,
          url: blobUrl,
          fileName: material?.title || material?.fileName || 'Material Preview'
        };
      });
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to preview material', 'error');
    }
  };

  const closeMaterialPreview = () => {
    setMaterialPreviewDialog((previous) => {
      if (previous.url) {
        window.URL.revokeObjectURL(previous.url);
      }
      return { open: false, url: '', fileName: '' };
    });
  };

  useEffect(() => () => {
    if (materialPreviewDialog.url) {
      window.URL.revokeObjectURL(materialPreviewDialog.url);
    }
  }, [materialPreviewDialog.url]);

  const downloadMaterialFile = async (material) => {
    const fileId = Number(material?.fileId);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      showMessage('Download is only available for uploaded cloud files', 'warning');
      return;
    }

    try {
      setDownloadingMaterialId(material?.id || null);
      const response = await api.get(`/storage/files/${fileId}/download`, { responseType: 'blob' });
      const fileName = getDownloadFileName(response.headers, material?.fileName || `file-${fileId}`);
      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to download material', 'error');
    } finally {
      setDownloadingMaterialId(null);
    }
  };

  const persistTeacherStateNow = async (overrides = {}, logMeta = {}) => {
    const snapshot = {
      classrooms,
      materialsByClassroom,
      assignmentsByClassroom,
      studentsByClassroom,
      gradingSubmissionsByAssignment,
      attendanceRecordsByClassroom,
      attendanceStudentStatsByClassroom,
      attendanceDetailByClassroom,
      ...overrides
    };

    const operationType = String(logMeta.operationType || 'teacher_state_saved').trim();
    const operationLabel = String(logMeta.operationLabel || 'Teacher Classroom Updated').trim();
    const target = String(logMeta.target || 'Classroom Workspace').trim();
    const targetType = String(logMeta.targetType || 'Classroom').trim();

    await classroomAPI.saveTeacherState({
      state: snapshot,
      operationType,
      operationLabel,
      target,
      targetType
    });

    lastSyncedStateRef.current = JSON.stringify(snapshot);
  };

  const loadClassAnnouncements = async () => {
    try {
      const response = await classroomAPI.getClassAnnouncements();
      const grouped = response?.announcementsByClassroom;
      setClassAnnouncements(grouped && typeof grouped === 'object' ? grouped : {});
    } catch (error) {
      console.error('Failed to load class announcements:', error);
      setClassAnnouncements({});
    }
  };

  const loadActiveStudents = async () => {
    try {
      const response = await api.get('/users');
      const users = Array.isArray(response?.data?.users) ? response.data.users : [];

      const students = users
        .filter((item) => String(item.role || '').toLowerCase() === 'student')
        .map((item) => ({
          studentId: item.user_id,
          name: item.full_name,
          studentNo: `S${String(item.user_id).padStart(3, '0')}`,
          email: item.email,
          studentLevel: item.student_level || '',
          status: 'Active'
        }));

      const teachers = users
        .filter((item) => String(item.role || '').toLowerCase() === 'teacher')
        .map((item) => ({
          teacherUserId: Number(item.user_id),
          name: String(item.full_name || `Teacher ${item.user_id}`),
          email: String(item.email || '')
        }))
        .filter((item) => Number.isInteger(item.teacherUserId) && item.teacherUserId > 0);

      setAllStudentsMaster(students);
      setAllTeachersMaster(teachers);
    } catch (error) {
      console.error('Failed to load active students:', error);
      setAllStudentsMaster([]);
      setAllTeachersMaster([]);
    }
  };

  const loadTeacherState = async () => {
    try {
      const response = await classroomAPI.getTeacherState();
      const state = response?.state || {};

      if (Array.isArray(state.classrooms)) {
        const normalizedClassrooms = state.classrooms
          .map(normalizeClassroomRecord)
          .filter((item) => Number.isInteger(item.classroomId) && item.classroomId > 0);

        setClassrooms(normalizedClassrooms);

        const firstClassroom = normalizedClassrooms[0];
        if (firstClassroom?.classroomId) {
          setAttendanceClassroomId(firstClassroom.classroomId);
          setGradingClassroomId(firstClassroom.classroomId);
        }
      }

      if (state.materialsByClassroom && typeof state.materialsByClassroom === 'object') {
        setMaterialsByClassroom(state.materialsByClassroom);
      }

      if (state.assignmentsByClassroom && typeof state.assignmentsByClassroom === 'object') {
        const normalizedAssignmentsByClassroom = Object.entries(state.assignmentsByClassroom).reduce((accumulator, [classroomKey, assignments]) => {
          const normalizedAssignments = Array.isArray(assignments)
            ? assignments
              .map((assignment, index) => {
                const normalizedId = Number(assignment?.id || assignment?.assignmentId || index + 1);
                if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
                  return null;
                }

                return {
                  ...assignment,
                  id: normalizedId,
                  assignmentId: normalizedId
                };
              })
              .filter(Boolean)
            : [];

          accumulator[classroomKey] = normalizedAssignments;
          return accumulator;
        }, {});

        setAssignmentsByClassroom(normalizedAssignmentsByClassroom);
      }

      if (state.studentsByClassroom && typeof state.studentsByClassroom === 'object') {
        setStudentsByClassroom(state.studentsByClassroom);
      }

      if (state.gradingSubmissionsByAssignment && typeof state.gradingSubmissionsByAssignment === 'object') {
        setGradingSubmissionsByAssignment(state.gradingSubmissionsByAssignment);
      }

      if (state.attendanceRecordsByClassroom && typeof state.attendanceRecordsByClassroom === 'object') {
        setAttendanceRecordsByClassroom(state.attendanceRecordsByClassroom);
      }

      if (state.attendanceStudentStatsByClassroom && typeof state.attendanceStudentStatsByClassroom === 'object') {
        setAttendanceStudentStatsByClassroom(state.attendanceStudentStatsByClassroom);
      }

      if (state.attendanceDetailByClassroom && typeof state.attendanceDetailByClassroom === 'object') {
        setAttendanceDetailByClassroom(state.attendanceDetailByClassroom);
      }

      lastSyncedStateRef.current = JSON.stringify({
        classrooms: Array.isArray(state.classrooms) ? state.classrooms : classrooms,
        materialsByClassroom: state.materialsByClassroom && typeof state.materialsByClassroom === 'object' ? state.materialsByClassroom : materialsByClassroom,
        assignmentsByClassroom: state.assignmentsByClassroom && typeof state.assignmentsByClassroom === 'object' ? state.assignmentsByClassroom : assignmentsByClassroom,
        studentsByClassroom: state.studentsByClassroom && typeof state.studentsByClassroom === 'object' ? state.studentsByClassroom : studentsByClassroom,
        gradingSubmissionsByAssignment: state.gradingSubmissionsByAssignment && typeof state.gradingSubmissionsByAssignment === 'object' ? state.gradingSubmissionsByAssignment : gradingSubmissionsByAssignment,
        attendanceRecordsByClassroom: state.attendanceRecordsByClassroom && typeof state.attendanceRecordsByClassroom === 'object' ? state.attendanceRecordsByClassroom : attendanceRecordsByClassroom,
        attendanceStudentStatsByClassroom: state.attendanceStudentStatsByClassroom && typeof state.attendanceStudentStatsByClassroom === 'object' ? state.attendanceStudentStatsByClassroom : attendanceStudentStatsByClassroom,
        attendanceDetailByClassroom: state.attendanceDetailByClassroom && typeof state.attendanceDetailByClassroom === 'object' ? state.attendanceDetailByClassroom : attendanceDetailByClassroom
      });
    } catch (error) {
      console.error('Failed to load teacher classroom state:', error);
    } finally {
      skipNextSyncRef.current = false;
    }
  };

  useEffect(() => {
    loadClassAnnouncements();
  }, []);

  useEffect(() => {
    loadActiveStudents();
  }, []);

  useEffect(() => {
    loadTeacherState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualRefresh = async () => {
    if (refreshingData) {
      return;
    }

    setRefreshingData(true);
    try {
      await Promise.all([loadTeacherState(), loadActiveStudents(), loadClassAnnouncements()]);
      showMessage('Classroom data refreshed');
    } catch (_error) {
      showMessage('Failed to refresh classroom data', 'error');
    } finally {
      setRefreshingData(false);
    }
  };

  useEffect(() => {
    if (skipNextSyncRef.current) {
      return;
    }

    const snapshot = {
      classrooms,
      materialsByClassroom,
      assignmentsByClassroom,
      studentsByClassroom,
      gradingSubmissionsByAssignment,
      attendanceRecordsByClassroom,
      attendanceStudentStatsByClassroom,
      attendanceDetailByClassroom
    };

    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSyncedStateRef.current) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        await classroomAPI.saveTeacherState({
          state: snapshot,
          operationType: 'teacher_state_saved',
          operationLabel: 'Teacher Classroom Updated',
          target: 'Classroom Workspace',
          targetType: 'Classroom'
        });
        lastSyncedStateRef.current = serialized;
      } catch (error) {
        console.error('Failed to persist teacher classroom state:', error);
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [
    assignmentsByClassroom,
    attendanceDetailByClassroom,
    attendanceRecordsByClassroom,
    attendanceStudentStatsByClassroom,
    classrooms,
    gradingSubmissionsByAssignment,
    materialsByClassroom,
    studentsByClassroom
  ]);

  useEffect(() => {
    setAnnouncementDraft('');
    setAnnouncementModalOpen(false);
  }, [selectedClassroomId]);

  const openModal = (mode, classroom = null) => {
    setModalState({ open: true, mode, classroom });
  };

  const openClassroomDetails = (classroom) => {
    setSelectedClassroomId(classroom.classroomId);
    setClassroomDetailTab('materials');
  };

  const backToClassList = () => {
    setSelectedClassroomId(null);
    setManageClassMenuOpen(false);
  };

  const postClassAnnouncement = async () => {
    if (postingAnnouncement) {
      return;
    }

    if (!canPostClassAnnouncement) {
      showMessage('Only classroom owner can post announcements', 'warning');
      return;
    }

    if (!selectedClassroom) {
      return;
    }

    const message = announcementDraft.trim();
    if (!message) {
      showMessage('Please enter an announcement message', 'warning');
      return;
    }

    try {
      setPostingAnnouncement(true);
      await classroomAPI.postClassAnnouncement({
        classroomId: selectedClassroom.classroomId,
        classroomName: selectedClassroom.classroomName,
        message
      });

      await loadClassAnnouncements();
      window.dispatchEvent(new CustomEvent('classAnnouncementsUpdated'));
      setAnnouncementDraft('');
      setAnnouncementModalOpen(false);
      showMessage('Announcement posted');
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to post announcement', 'error');
    } finally {
      setPostingAnnouncement(false);
    }
  };

  const closeModal = () => {
    setModalState({ open: false, mode: 'create', classroom: null });
  };

  const openManageEditClass = () => {
    if (!selectedClassroom) {
      return;
    }
    setManageClassMenuOpen(false);
    openModal('edit', selectedClassroom);
  };

  const openManageArchiveClass = () => {
    if (!selectedClassroom) {
      return;
    }

    setManageClassMenuOpen(false);
    setArchiveClassDialog({
      open: true,
      classroomId: selectedClassroom.classroomId,
      classroomName: selectedClassroom.classroomName
    });
  };

  const cancelArchiveClass = () => {
    setArchiveClassDialog({ open: false, classroomId: null, classroomName: '' });
  };

  const confirmArchiveClass = async () => {
    if (!archiveClassDialog.classroomId) {
      cancelArchiveClass();
      return;
    }

    const nextClassrooms = classrooms.map((classroom) => (
      classroom.classroomId === archiveClassDialog.classroomId
        ? { ...classroom, status: 'Archived', updatedAt: new Date().toISOString() }
        : classroom
    ));

    setClassrooms(nextClassrooms);

    cancelArchiveClass();
    setSelectedClassroomId(null);

    try {
      await persistTeacherStateNow(
        { classrooms: nextClassrooms },
        {
          operationType: 'class_archived',
          operationLabel: 'Class Archived',
          target: selectedClassroom?.classroomName || `Classroom ${archiveClassDialog.classroomId}`,
          targetType: 'Classroom'
        }
      );
      showMessage('Class archived successfully');
    } catch (error) {
      console.error('Failed to archive class:', error);
      showMessage(error.response?.data?.error || 'Failed to archive class', 'error');
    }
  };

  const saveClassroom = async (payload, asDraft) => {
    if (savingClassroom) {
      return;
    }

    const sanitizedPayload = sanitizeClassroomPayload(payload);

    const duplicated = classrooms.find((item) => {
      if (modalState.classroom && item.classroomId === modalState.classroom.classroomId) {
        return false;
      }
      return item.classroomName.trim().toLowerCase() === sanitizedPayload.classroomName.trim().toLowerCase();
    });

    if (duplicated) {
      showMessage('Classroom name must be unique', 'error');
      return;
    }

    if (modalState.classroom) {
      const classStudents = studentsByClassroom[modalState.classroom.classroomId] || studentsByClassroom[String(modalState.classroom.classroomId)] || [];
      const studentCount = Array.isArray(classStudents) ? classStudents.length : 0;
      if (Number.isInteger(sanitizedPayload.maximumCapacity) && sanitizedPayload.maximumCapacity < studentCount) {
        showMessage(`Class capacity cannot be less than current enrolled students (${studentCount})`, 'error');
        return;
      }

      const updated = classrooms.map((item) => (
        item.classroomId === modalState.classroom.classroomId
          ? {
              ...item,
              ...sanitizedPayload,
              ownerTeacherId: Number(item.ownerTeacherId || currentTeacherProfile.teacherUserId || 0),
              ownerTeacherName: String(item.ownerTeacherName || currentTeacherProfile.displayName || 'Teacher'),
              coTeachers: normalizeCoTeacherList(item.coTeachers),
              status: asDraft ? 'Draft' : sanitizedPayload.status,
              updatedAt: new Date().toISOString()
            }
          : item
      ));
      try {
        setSavingClassroom(true);
        await persistTeacherStateNow({ classrooms: updated });
        setClassrooms(updated);
        showMessage('Classroom updated successfully');
        closeModal();
      } catch (error) {
        console.error('Failed to persist classroom update:', error);
        showMessage(error.response?.data?.error || 'Failed to save classroom to database', 'error');
      } finally {
        setSavingClassroom(false);
      }
      return;
    }

    const newClassroom = {
      classroomId: classrooms.length > 0 ? Math.max(...classrooms.map((item) => item.classroomId)) + 1 : 1,
      ...sanitizedPayload,
      ownerTeacherId: Number(currentTeacherProfile.teacherUserId || 0),
      ownerTeacherName: String(currentTeacherProfile.displayName || 'Teacher'),
      coTeachers: [],
      assistantAccessRole: 'owner',
      isSharedClassroom: false,
      currentEnrollment: 0,
      createdAt: formatLocalDate(new Date()),
      status: asDraft ? 'Draft' : 'Active'
    };

    const nextClassrooms = [newClassroom, ...classrooms];

    try {
      setSavingClassroom(true);
      await persistTeacherStateNow({ classrooms: nextClassrooms });
      setClassrooms(nextClassrooms);
      showMessage(asDraft ? 'Classroom saved as draft' : 'Classroom created successfully');
      closeModal();
    } catch (error) {
      console.error('Failed to persist classroom create:', error);
      showMessage(error.response?.data?.error || 'Failed to create classroom in database', 'error');
    } finally {
      setSavingClassroom(false);
    }
  };

  const confirmSubmitAttendance = async () => {
    if (confirmingAttendance) {
      return;
    }

    setConfirmingAttendance(true);
    await new Promise((resolve) => {
      setTimeout(resolve, 280);
    });
    setConfirmingAttendance(false);
    setAttendanceConfirmOpen(false);
    showMessage('Attendance submitted successfully');
  };

  const openTakeAttendanceModal = () => {
    if (!canTakeAttendanceSelectedClassroom) {
      showMessage('You have view-only access and cannot take attendance.', 'error');
      return;
    }
    setTakeAttendanceModalOpen(true);
  };

  const closeTakeAttendanceModal = () => {
    setTakeAttendanceModalOpen(false);
  };

  const buildAttendanceSnapshots = (classId, classDetailByDate) => {
    const classStudents = studentsByClassroom[classId] || [];
    const previousRecords = attendanceRecordsByClassroom[classId] || {};
    const nextRecords = {};
    const nextStudentStats = {};

    classStudents.forEach((student) => {
      nextStudentStats[student.studentId] = { present: 0, absent: 0 };
    });

    Object.entries(classDetailByDate || {}).forEach(([dateKey, dateStatusMap]) => {
      let present = 0;
      classStudents.forEach((student) => {
        const isPresent = Boolean(dateStatusMap?.[student.studentId]);
        if (isPresent) {
          present += 1;
          nextStudentStats[student.studentId].present += 1;
        } else {
          nextStudentStats[student.studentId].absent += 1;
        }
      });

      nextRecords[dateKey] = {
        ...(previousRecords[dateKey] || {}),
        present,
        total: classStudents.length
      };
    });

    return { nextRecords, nextStudentStats };
  };

  const saveTakeAttendance = async ({ date, statusMap }) => {
    if (!canTakeAttendanceSelectedClassroom) {
      showMessage('You have view-only access and cannot take attendance.', 'error');
      closeTakeAttendanceModal();
      return;
    }

    if (!date) {
      showMessage('Please select a date', 'error');
      return;
    }

    const classId = attendanceClassroomId;
    const classDetailByDate = {
      ...(attendanceDetailByClassroom[classId] || {}),
      [date]: { ...statusMap }
    };
    const { nextRecords, nextStudentStats } = buildAttendanceSnapshots(classId, classDetailByDate);

    const nextAttendanceDetailByClassroom = {
      ...attendanceDetailByClassroom,
      [classId]: classDetailByDate
    };
    const nextAttendanceRecordsByClassroom = {
      ...attendanceRecordsByClassroom,
      [classId]: nextRecords
    };
    const nextAttendanceStudentStatsByClassroom = {
      ...attendanceStudentStatsByClassroom,
      [classId]: nextStudentStats
    };

    nextAttendanceRecordsByClassroom[classId] = {
      ...(nextAttendanceRecordsByClassroom[classId] || {}),
      [date]: {
        ...(nextAttendanceRecordsByClassroom[classId]?.[date] || {}),
        present: Number(nextAttendanceRecordsByClassroom[classId]?.[date]?.present || 0),
        total: Number(nextAttendanceRecordsByClassroom[classId]?.[date]?.total || 0),
        recordedByUserId: Number(currentTeacherProfile.teacherUserId || 0),
        recordedByName: String(currentTeacherProfile.displayName || 'Teacher'),
        recordedAt: new Date().toISOString(),
        updatedByUserId: Number(currentTeacherProfile.teacherUserId || 0),
        updatedByName: String(currentTeacherProfile.displayName || 'Teacher'),
        updatedAt: new Date().toISOString()
      }
    };

    setAttendanceDetailByClassroom(nextAttendanceDetailByClassroom);
    setAttendanceRecordsByClassroom(nextAttendanceRecordsByClassroom);
    setAttendanceStudentStatsByClassroom(nextAttendanceStudentStatsByClassroom);

    setAttendanceDate(date);
    closeTakeAttendanceModal();

    try {
      await persistTeacherStateNow(
        {
          attendanceDetailByClassroom: nextAttendanceDetailByClassroom,
          attendanceRecordsByClassroom: nextAttendanceRecordsByClassroom,
          attendanceStudentStatsByClassroom: nextAttendanceStudentStatsByClassroom
        },
        {
          operationType: 'attendance_taken',
          operationLabel: 'Attendance Taken',
          target: selectedAttendanceClassroom?.classroomName || `Classroom ${classId}`,
          targetType: 'Attendance'
        }
      );
      showMessage('Attendance saved successfully');
    } catch (error) {
      console.error('Failed to persist attendance save:', error);
      showMessage(error.response?.data?.error || 'Failed to save attendance to database', 'error');
    }
  };

  const openAttendanceRecordModal = (dateKey) => {
    if (!canTakeAttendanceSelectedClassroom) {
      showMessage('You have view-only access and cannot edit attendance.', 'error');
      return;
    }
    setAttendanceRecordModal({ open: true, dateKey });
  };

  const closeAttendanceRecordModal = () => {
    setAttendanceRecordModal({ open: false, dateKey: '' });
  };

  const openStudentAttendanceModal = (studentId) => {
    setStudentAttendanceModal({ open: true, studentId });
  };

  const closeStudentAttendanceModal = () => {
    setStudentAttendanceModal({ open: false, studentId: null });
  };

  const saveAttendanceRecordChanges = async (statusMap) => {
    if (!canTakeAttendanceSelectedClassroom) {
      showMessage('You have view-only access and cannot edit attendance.', 'error');
      closeAttendanceRecordModal();
      return;
    }

    if (!attendanceRecordModal.dateKey) {
      closeAttendanceRecordModal();
      return;
    }

    const classId = attendanceClassroomId;
    const classDetailByDate = {
      ...(attendanceDetailByClassroom[classId] || {}),
      [attendanceRecordModal.dateKey]: { ...statusMap }
    };
    const { nextRecords, nextStudentStats } = buildAttendanceSnapshots(classId, classDetailByDate);

    const nextAttendanceDetailByClassroom = {
      ...attendanceDetailByClassroom,
      [classId]: classDetailByDate
    };
    const nextAttendanceRecordsByClassroom = {
      ...attendanceRecordsByClassroom,
      [classId]: nextRecords
    };
    const nextAttendanceStudentStatsByClassroom = {
      ...attendanceStudentStatsByClassroom,
      [classId]: nextStudentStats
    };

    const existingRecordMeta = attendanceRecordsByClassroom?.[classId]?.[attendanceRecordModal.dateKey] || {};
    nextAttendanceRecordsByClassroom[classId] = {
      ...(nextAttendanceRecordsByClassroom[classId] || {}),
      [attendanceRecordModal.dateKey]: {
        ...(nextAttendanceRecordsByClassroom[classId]?.[attendanceRecordModal.dateKey] || {}),
        present: Number(nextAttendanceRecordsByClassroom[classId]?.[attendanceRecordModal.dateKey]?.present || 0),
        total: Number(nextAttendanceRecordsByClassroom[classId]?.[attendanceRecordModal.dateKey]?.total || 0),
        recordedByUserId: Number(existingRecordMeta.recordedByUserId || 0) || Number(currentTeacherProfile.teacherUserId || 0),
        recordedByName: String(existingRecordMeta.recordedByName || currentTeacherProfile.displayName || 'Teacher'),
        recordedAt: existingRecordMeta.recordedAt || new Date().toISOString(),
        updatedByUserId: Number(currentTeacherProfile.teacherUserId || 0),
        updatedByName: String(currentTeacherProfile.displayName || 'Teacher'),
        updatedAt: new Date().toISOString()
      }
    };

    setAttendanceDetailByClassroom(nextAttendanceDetailByClassroom);
    setAttendanceRecordsByClassroom(nextAttendanceRecordsByClassroom);
    setAttendanceStudentStatsByClassroom(nextAttendanceStudentStatsByClassroom);

    closeAttendanceRecordModal();

    try {
      await persistTeacherStateNow(
        {
          attendanceDetailByClassroom: nextAttendanceDetailByClassroom,
          attendanceRecordsByClassroom: nextAttendanceRecordsByClassroom,
          attendanceStudentStatsByClassroom: nextAttendanceStudentStatsByClassroom
        },
        {
          operationType: 'attendance_modified',
          operationLabel: 'Attendance Record Updated',
          target: selectedAttendanceClassroom?.classroomName || `Classroom ${classId}`,
          targetType: 'Attendance'
        }
      );
      showMessage('Attendance record updated successfully');
    } catch (error) {
      console.error('Failed to persist attendance record update:', error);
      showMessage(error.response?.data?.error || 'Failed to update attendance in database', 'error');
    }
  };

  const formatGradeStatus = (status) => {
    if (status === 'graded') {
      return 'Graded';
    }
    if (status === 'late') {
      return 'Late';
    }
    return 'Pending';
  };

  const loadGradingSubmissionPreview = async (row) => {
    const fileId = Number(row?.fileId);

    setGradingPreviewState((previous) => {
      if (previous.url) {
        window.URL.revokeObjectURL(previous.url);
      }
      return { url: '', mode: 'iframe', text: '', loading: false, error: '' };
    });

    if (!Number.isInteger(fileId) || fileId <= 0) {
      setGradingPreviewState({
        url: '',
        mode: 'iframe',
        text: '',
        loading: false,
        error: 'No uploaded file was linked to this submission.'
      });
      return;
    }

    setGradingPreviewState({ url: '', mode: 'iframe', text: '', loading: true, error: '' });
    try {
      const response = await api.get(`/storage/files/${fileId}/preview`, { responseType: 'blob' });
      const blob = response.data;
      const contentType = String(response.headers?.['content-type'] || blob?.type || row?.fileType || '').toLowerCase();

      if (contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml') || contentType.includes('csv')) {
        const textContent = await blob.text();
        setGradingPreviewState({ url: '', mode: 'text', text: textContent, loading: false, error: '' });
        return;
      }

      const blobUrl = window.URL.createObjectURL(blob);
      const mode = contentType.startsWith('image/') ? 'image' : 'iframe';
      setGradingPreviewState({ url: blobUrl, mode, text: '', loading: false, error: '' });
    } catch (error) {
      setGradingPreviewState({
        url: '',
        mode: 'iframe',
        text: '',
        loading: false,
        error: error.response?.data?.error || 'Failed to load submission preview'
      });
    }
  };

  const downloadGradingSubmissionFile = async (row) => {
    const fileId = Number(row?.fileId);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      showMessage('No uploaded file linked to this submission', 'warning');
      return;
    }

    try {
      const response = await api.get(`/storage/files/${fileId}/download`, { responseType: 'blob' });
      const fileName = getDownloadFileName(response.headers, row?.fileName || `submission-${fileId}`);
      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      showMessage(error.response?.data?.error || 'Failed to download submission file', 'error');
    }
  };

  const openGradingReviewModal = async (row) => {
    setGradingReviewModal({ open: true, row });
    await loadGradingSubmissionPreview(row);
  };

  const openAssignmentSubmissionsModal = (assignment) => {
    if (!selectedClassroom || !assignment) {
      return;
    }

    setGradingClassroomId(selectedClassroom.classroomId);
    setSelectedGradingAssignmentId(assignment.id);
    setAssignmentSubmissionsModal({ open: true, assignment });
  };

  const closeAssignmentSubmissionsModal = () => {
    setAssignmentSubmissionsModal({ open: false, assignment: null });
  };

  const openSubmissionReviewFromAssignment = (row) => {
    closeAssignmentSubmissionsModal();
    openGradingReviewModal(row);
  };

  const openGradingWorkspaceFromAssignment = () => {
    closeAssignmentSubmissionsModal();
    setSubTab('grading');
    setGradingSearch('');
    setGradingStatusFilter('all');
  };

  const closeGradingReviewModal = () => {
    setGradingPreviewState((previous) => {
      if (previous.url) {
        window.URL.revokeObjectURL(previous.url);
      }
      return { url: '', mode: 'iframe', text: '', loading: false, error: '' };
    });
    setGradingReviewModal({ open: false, row: null });
  };

  useEffect(() => () => {
    if (gradingPreviewState.url) {
      window.URL.revokeObjectURL(gradingPreviewState.url);
    }
  }, [gradingPreviewState.url]);

  const openGradeEntryModal = (row) => {
    if (!canGradeSelectedClassroom) {
      showMessage('You have view-only access and cannot grade submissions.', 'error');
      return;
    }
    setGradeEntryModal({ open: true, row });
  };

  const closeGradeEntryModal = () => {
    setGradeEntryModal({ open: false, row: null });
  };

  const saveSubmissionGrade = async (gradeValue, feedbackValue) => {
    if (!canGradeSelectedClassroom) {
      showMessage('You have view-only access and cannot grade submissions.', 'error');
      closeGradeEntryModal();
      return;
    }

    if (!gradeEntryModal.row) {
      closeGradeEntryModal();
      return;
    }

    const submissionId = gradeEntryModal.row.id;
    let resolvedAssignmentId = null;

    const nextGradingSubmissionsByAssignment = {};
    Object.entries(gradingSubmissionsByAssignment).forEach(([assignmentId, rows]) => {
      if (
        resolvedAssignmentId === null
        && Array.isArray(rows)
        && rows.some((row) => row.id === submissionId)
      ) {
        const parsedAssignmentId = Number(assignmentId);
        if (Number.isInteger(parsedAssignmentId) && parsedAssignmentId > 0) {
          resolvedAssignmentId = parsedAssignmentId;
        }
      }

      nextGradingSubmissionsByAssignment[assignmentId] = rows.map((row) => (
        row.id === submissionId
          ? {
              ...row,
              grade: gradeValue,
              status: 'graded',
              feedback: feedbackValue,
              gradedByUserId: Number(currentTeacherProfile.teacherUserId || 0),
              gradedByName: String(currentTeacherProfile.displayName || 'Teacher'),
              gradedAt: new Date().toISOString()
            }
          : row
      ));
    });

    try {
      const assignmentIdToGrade = Number.isInteger(resolvedAssignmentId)
        ? resolvedAssignmentId
        : Number(selectedGradingAssignment?.id || gradeEntryModal.row.assignmentId || 0);

      if (!Number.isInteger(assignmentIdToGrade) || assignmentIdToGrade <= 0) {
        throw new Error('Unable to resolve assignment for grading');
      }

      await classroomAPI.gradeStudentSubmission(Number(selectedGradingClassroom?.classroomId || gradeEntryModal.row.classroomId || 0), assignmentIdToGrade, submissionId, {
        grade: gradeValue,
        feedback: feedbackValue
      });

      await persistTeacherStateNow(
        { gradingSubmissionsByAssignment: nextGradingSubmissionsByAssignment },
        {
          operationType: 'assignment_graded',
          operationLabel: 'Assignment Graded',
          target: selectedGradingAssignment?.title || gradeEntryModal.row.assignmentTitle || 'Assignment',
          targetType: 'Assignment'
        }
      );

      setGradingSubmissionsByAssignment(nextGradingSubmissionsByAssignment);
      setGradingFeedbackBySubmission((previous) => ({
        ...previous,
        [submissionId]: feedbackValue
      }));

      closeGradeEntryModal();
      closeGradingReviewModal();
      showMessage('Grade saved successfully');
    } catch (error) {
      console.error('Failed to persist submission grade:', error);
      showMessage(error.response?.data?.error || 'Failed to save grade to database', 'error');
    }
  };

  const openActionModal = (type) => {
    setActionModal({ open: true, type });
  };

  const closeActionModal = () => {
    setActionModal({ open: false, type: null });
  };

  const handleUploadMaterial = async (materialPayload) => {
    if (uploadingMaterial) {
      return;
    }

    if (!selectedClassroom) {
      return;
    }

    if (!canManageClassroomMaterials) {
      showMessage('Only classroom owner can manage materials', 'warning');
      return;
    }

    if (!materialPayload?.file) {
      showMessage('Please choose a file to upload', 'error');
      return;
    }

    try {
      setUploadingMaterial(true);
      const formData = new FormData();
      formData.append('file', materialPayload.file);
      formData.append('scope', 'classroom');
      formData.append('classroomId', String(selectedClassroom.classroomId));
      const uploadResponse = await api.post('/storage/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const uploadedFile = uploadResponse?.data?.file;
      const fileSize = uploadedFile?.file_size ?? materialPayload.file.size;
      const uploadedDate = uploadedFile?.uploaded_at
        ? formatLocalDate(new Date(uploadedFile.uploaded_at))
        : formatLocalDate(new Date());
      const normalizedTitle = String(
        materialPayload.title
        || materialPayload.description
        || uploadedFile?.original_filename
        || materialPayload.fileName
      ).trim();
      const normalizedDescription = String(materialPayload.description || '').trim();

      const materialRecord = {
        id: Number(uploadedFile?.file_id || Date.now()),
        fileId: Number(uploadedFile?.file_id || 0),
        title: normalizedTitle,
        description: normalizedDescription,
        fileName: String(uploadedFile?.original_filename || materialPayload.fileName),
        size: formatBytesLabel(fileSize),
        uploadedDate,
        downloads: 0,
        icon: materialPayload.icon || 'fa-file'
      };

      const existingMaterials = materialsByClassroom[selectedClassroom.classroomId] || [];
      const nextMaterialsByClassroom = {
        ...materialsByClassroom,
        [selectedClassroom.classroomId]: [materialRecord, ...existingMaterials]
      };

      await persistTeacherStateNow(
        { materialsByClassroom: nextMaterialsByClassroom },
        {
          operationType: 'material_uploaded',
          operationLabel: 'Class Material Uploaded',
          target: materialRecord.title || materialRecord.fileName || 'Material',
          targetType: 'Material'
        }
      );

      setMaterialsByClassroom(nextMaterialsByClassroom);

      // Auto-share material to students storage is disabled as requested by user.

      closeActionModal();
      showMessage('Material uploaded successfully (saved to Cloudflare R2)');
    } catch (error) {
      console.error('Failed to upload material to cloud storage:', error);
      showMessage(error.response?.data?.error || 'Failed to upload material to Cloudflare R2', 'error');
    } finally {
      setUploadingMaterial(false);
    }
  };

  const handleDeleteMaterial = (materialId, fileName = 'this material') => {
    if (!selectedClassroom) {
      return;
    }

    setRemoveMaterialDialog({
      open: true,
      materialId,
      fileName
    });
  };

  const cancelRemoveMaterial = () => {
    setRemoveMaterialDialog({ open: false, materialId: null, fileName: '' });
  };

  const confirmRemoveMaterial = async () => {
    if (!selectedClassroom || !removeMaterialDialog.materialId) {
      cancelRemoveMaterial();
      return;
    }

    if (isRemovingMaterial) {
      return;
    }

    const existingMaterials = materialsByClassroom[selectedClassroom.classroomId] || [];
    const materialToRemove = existingMaterials.find((item) => item.id === removeMaterialDialog.materialId) || null;
    const fileId = Number(materialToRemove?.fileId);
    const nextMaterialsByClassroom = {
      ...materialsByClassroom,
      [selectedClassroom.classroomId]: existingMaterials.filter((item) => item.id !== removeMaterialDialog.materialId)
    };

    try {
      setIsRemovingMaterial(true);

      if (Number.isInteger(fileId) && fileId > 0) {
        await api.delete(`/storage/files/${fileId}`);
      }

      await persistTeacherStateNow(
        { materialsByClassroom: nextMaterialsByClassroom },
        {
          operationType: 'material_deleted',
          operationLabel: 'Class Material Deleted',
          target: removeMaterialDialog.fileName || materialToRemove?.title || 'Material',
          targetType: 'Material'
        }
      );

      setMaterialsByClassroom(nextMaterialsByClassroom);

      cancelRemoveMaterial();
      showMessage('Material removed from class and cloud storage');
    } catch (error) {
      console.error('Failed to remove classroom material from cloud storage:', error);
      showMessage(error.response?.data?.error || 'Failed to remove material from cloud storage', 'error');
    } finally {
      setIsRemovingMaterial(false);
    }
  };

  const handleCreateAssignment = async (assignmentPayload) => {
    if (creatingAssignment) {
      return;
    }

    if (!selectedClassroom) {
      return;
    }

    if (!canCreateAssignmentOnSelectedClass) {
      showMessage('You do not have permission to create assignment for this classroom', 'warning');
      return;
    }

    const existing = assignmentsByClassroom[selectedClassroom.classroomId] || [];
    const nextId = existing.length > 0 ? Math.max(...existing.map((item) => item.id)) + 1 : 1;
    const nowIso = new Date().toISOString();
    const nextAssignmentsByClassroom = {
      ...assignmentsByClassroom,
      [selectedClassroom.classroomId]: [{
        id: nextId,
        ...assignmentPayload,
        createdByUserId: Number(currentTeacherProfile.teacherUserId || 0),
        createdByName: String(currentTeacherProfile.displayName || 'Teacher'),
        createdAt: nowIso
      }, ...existing]
    };

    try {
      setCreatingAssignment(true);
      await persistTeacherStateNow(
        { assignmentsByClassroom: nextAssignmentsByClassroom },
        {
          operationType: 'assignment_created',
          operationLabel: 'Assignment Created',
          target: assignmentPayload?.title || selectedClassroom.classroomName || 'Assignment',
          targetType: 'Assignment'
        }
      );

      setAssignmentsByClassroom(nextAssignmentsByClassroom);
      closeActionModal();
      showMessage('Assignment created successfully');
    } catch (error) {
      console.error('Failed to persist assignment create:', error);
      showMessage(error.response?.data?.error || 'Failed to create assignment in database', 'error');
    } finally {
      setCreatingAssignment(false);
    }
  };

  const handleSaveStudents = async (updatedStudents) => {
    if (!selectedClassroom) {
      return;
    }

    if (!canManageClassroomStudents) {
      showMessage('Only classroom owner can manage students', 'warning');
      return;
    }

    const configuredMaximumCapacity = Number.parseInt(selectedClassroom?.maximumCapacity, 10);
    const maximumCapacity = Number.isInteger(configuredMaximumCapacity) && configuredMaximumCapacity > 0
      ? configuredMaximumCapacity
      : null;

    const uniqueStudentCount = new Set(
      (Array.isArray(updatedStudents) ? updatedStudents : [])
        .map((student) => Number(student?.studentId || student?.userId || student?.id))
        .filter((value) => Number.isInteger(value) && value > 0)
    ).size;

    if (Number.isInteger(maximumCapacity) && uniqueStudentCount > maximumCapacity) {
      showMessage(`Class capacity is ${maximumCapacity}. Remove student(s) before saving.`, 'warning');
      return;
    }

    const nextStudentsByClassroom = {
      ...studentsByClassroom,
      [selectedClassroom.classroomId]: updatedStudents
    };

    const previousStudentIds = new Set(
      (studentsByClassroom[selectedClassroom.classroomId] || [])
        .map((student) => Number(student.studentId))
        .filter((value) => Number.isInteger(value) && value > 0)
    );
    const addedStudentIds = updatedStudents
      .map((student) => Number(student.studentId))
      .filter((value) => Number.isInteger(value) && value > 0 && !previousStudentIds.has(value));

    try {
      await persistTeacherStateNow(
        { studentsByClassroom: nextStudentsByClassroom },
        {
          operationType: 'student_list_managed',
          operationLabel: 'Class Student List Managed',
          target: selectedClassroom?.classroomName || `Classroom ${selectedClassroom?.classroomId || ''}`,
          targetType: 'Classroom'
        }
      );
      setStudentsByClassroom(nextStudentsByClassroom);

      if (addedStudentIds.length > 0) {
        const classMaterials = materialsByClassroom[selectedClassroom.classroomId] || [];
        const classFileIds = classMaterials
          .map((material) => Number(material.fileId))
          .filter((value) => Number.isInteger(value) && value > 0);

        if (classFileIds.length > 0) {
          try {
            await api.post('/storage/share', {
              fileIds: classFileIds,
              recipientIds: addedStudentIds
            });
          } catch (shareError) {
            console.error('Auto-share existing class materials failed:', shareError);
          }
        }
      }

      closeActionModal();
      showMessage('Student list updated successfully');
    } catch (error) {
      console.error('Failed to persist classroom students:', error);
      showMessage(error.response?.data?.error || 'Failed to save classroom students', 'error');
    }
  };

  const handleSaveClassTeachers = async (updatedCoTeachers) => {
    if (!selectedClassroom) {
      return;
    }

    if (!canManageClassroomTeachers) {
      showMessage('Only classroom owner can manage assistant teacher settings', 'warning');
      return;
    }

    const nextClassrooms = classrooms.map((classroom) => {
      if (classroom.classroomId !== selectedClassroom.classroomId) {
        return classroom;
      }

      return {
        ...classroom,
        ownerTeacherId: Number(classroom.ownerTeacherId || currentTeacherProfile.teacherUserId || 0),
        ownerTeacherName: String(classroom.ownerTeacherName || currentTeacherProfile.displayName || 'Teacher'),
        coTeachers: normalizeCoTeacherList(updatedCoTeachers),
        assistantAccessRole: 'owner',
        isSharedClassroom: false
      };
    });

    try {
      await persistTeacherStateNow(
        { classrooms: nextClassrooms },
        {
          operationType: 'class_teacher_access_updated',
          operationLabel: 'Class Assistant Teacher Updated',
          target: selectedClassroom?.classroomName || `Classroom ${selectedClassroom?.classroomId || ''}`,
          targetType: 'Classroom'
        }
      );

      setClassrooms(nextClassrooms);
      closeActionModal();
      showMessage('Assistant teacher settings updated successfully');
    } catch (error) {
      console.error('Failed to save class assistant teacher settings:', error);
      showMessage(error.response?.data?.error || 'Failed to save assistant teacher settings', 'error');
    }
  };

  return (
    <div className="teacher-classroom-module">
      <h2 className="teacher-classroom-page-title">Classroom Management</h2>

      <div className="teacher-classroom-header">
        <div className="teacher-classroom-subtabs">
          <button
            className={subTab === 'my-classes' ? 'active' : ''}
            onClick={() => setSubTab('my-classes')}
          >
            <i className="fas fa-chalkboard-teacher"></i>
            My Classes
          </button>
          <button
            className={subTab === 'attendance' ? 'active' : ''}
            onClick={() => {
              setSubTab('attendance');
              setAttendanceMonthOffset(0);
            }}
          >
            <i className="fas fa-clipboard-check"></i>
            Attendance
          </button>
          <button
            className={subTab === 'grading' ? 'active' : ''}
            onClick={() => setSubTab('grading')}
          >
            <i className="fas fa-pen"></i>
            Grading
          </button>
        </div>

        <div className="teacher-classroom-header-actions">
          <button
            className="teacher-refresh-btn"
            onClick={() => {
              void handleManualRefresh();
            }}
            disabled={refreshingData}
            title="Refresh classroom data"
          >
            <i className={`fas ${refreshingData ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`}></i>
          </button>

          {subTab === 'my-classes' && !selectedClassroom && (
            <button className="primary teacher-create-class-btn" onClick={() => openModal('create')}>
              <span className="teacher-create-class-icon" aria-hidden="true">
                <i className="fas fa-plus"></i>
              </span>
              <span>Create New Classroom</span>
            </button>
          )}
        </div>
      </div>

      {subTab === 'my-classes' && !selectedClassroom && (
        <div className="teacher-classroom-content">
          <div className="teacher-classroom-toolbar">
            <input
              placeholder="Search classroom by name, subject, section"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="teacher-classes-grid">
            {filteredClassrooms.map((classroom) => (
              (() => {
                const enrolledCount = (studentsByClassroom[classroom.classroomId] || []).length;
                return (
                  <div
                    key={classroom.classroomId}
                    className="teacher-class-card compact"
                    onClick={() => openClassroomDetails(classroom)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        openClassroomDetails(classroom);
                      }
                    }}
                  >
                    <div className={`teacher-class-icon ${getClassroomTheme(classroom.subject).tone}`}>
                      <i className={`fas ${getClassroomTheme(classroom.subject).icon}`}></i>
                    </div>

                    <h4>{classroom.classroomName}</h4>
                    <p className="teacher-class-subject">{classroom.subject}</p>

                    <p className="teacher-class-schedule-line">
                      <i className="fas fa-clock"></i>
                      {classroom.classSchedule || 'Schedule not set'}
                    </p>

                    <div className="teacher-class-footer-row">
                      <span><i className="fas fa-users"></i> {enrolledCount} students</span>
                      <i className="fas fa-chevron-right teacher-class-arrow"></i>
                    </div>
                  </div>
                );
              })()
            ))}
          </div>

          {filteredClassrooms.length === 0 && (
            <div className="teacher-classroom-empty-state">
              <i className="fas fa-inbox"></i>
              <h4>No classes available</h4>
              <p>Create a new class or adjust your search.</p>
            </div>
          )}
        </div>
      )}

      {subTab === 'my-classes' && selectedClassroom && (
        <div className="teacher-classroom-content detail-view">
          <button className="teacher-back-link" onClick={backToClassList}>
            <i className="fas fa-arrow-left"></i>
            Back to Classes
          </button>

          <div className="teacher-classroom-detail-header">
            <div>
              <h3>{selectedClassroom.classroomName}</h3>
              <p>{selectedClassroom.subject} • {selectedClassroom.classSchedule || 'No schedule set'}</p>
            </div>
            <div className="teacher-classroom-header-tools">
              {canPostClassAnnouncement && (
                <button
                  type="button"
                  className="teacher-class-announcement-btn"
                  onClick={() => setAnnouncementModalOpen(true)}
                >
                  <i className="fas fa-bullhorn"></i>
                  Announcement
                </button>
              )}

              {selectedClassAnnouncements.length > 0 && (
                <div className="teacher-announcement-latest">
                  <small>Latest</small>
                  <small className="teacher-announcement-author">By {selectedClassAnnouncements[0].authorName || 'Teacher'}</small>
                  <p>{selectedClassAnnouncements[0].message}</p>
                </div>
              )}

              <div className="teacher-classroom-code-box">
                {isSelectedClassOwner && (
                  <>
                    <button
                      type="button"
                      className="teacher-class-manage-btn"
                      onClick={() => setManageClassMenuOpen((previous) => !previous)}
                    >
                      <i className="fas fa-cog"></i>
                      Manage
                    </button>

                    {manageClassMenuOpen && (
                      <div className="teacher-class-manage-menu">
                        <button type="button" onClick={openManageEditClass}>
                          <i className="fas fa-pen"></i>
                          Edit Class Details
                        </button>
                        <button type="button" onClick={openManageArchiveClass}>
                          <i className="fas fa-box-archive"></i>
                          Archive Class
                        </button>
                      </div>
                    )}
                  </>
                )}

                <span>Class Code</span>
                <strong>{selectedClassroom.joinCode || 'N/A'}</strong>
              </div>
            </div>
          </div>

          <div className="teacher-classroom-mini-stats">
            <div className="students">
              <strong>{selectedClassStudents.length}</strong>
              <span>Students</span>
            </div>
            <div className="materials">
              <strong>{selectedClassMaterials.length}</strong>
              <span>Materials</span>
            </div>
            <div className="assignments">
              <strong>{selectedClassActiveAssignments}</strong>
              <span>Active Assignments</span>
            </div>
            <div className="attendance">
              <strong>{selectedClassAverageAttendance}%</strong>
              <span>Avg Attendance</span>
            </div>
          </div>

          <div className="teacher-classroom-detail-tabs">
            <button
              className={classroomDetailTab === 'materials' ? 'active' : ''}
              onClick={() => setClassroomDetailTab('materials')}
            >
              <i className="fas fa-file-alt"></i>
              Materials
            </button>
            <button
              className={classroomDetailTab === 'assignments' ? 'active' : ''}
              onClick={() => setClassroomDetailTab('assignments')}
            >
              <i className="fas fa-list-check"></i>
              Assignments
            </button>
            <button
              className={classroomDetailTab === 'students' ? 'active' : ''}
              onClick={() => setClassroomDetailTab('students')}
            >
              <i className="fas fa-users"></i>
              Students
            </button>
            <button
              className={classroomDetailTab === 'teachers' ? 'active' : ''}
              onClick={() => setClassroomDetailTab('teachers')}
            >
              <i className="fas fa-user-tie"></i>
              Teachers
            </button>
          </div>

          {classroomDetailTab === 'materials' && (
            <div className="teacher-detail-section">
              <div className="teacher-detail-section-header">
                <h4>Class Materials</h4>
                {canManageClassroomMaterials && (
                  <button className="teacher-action-cta" onClick={() => openActionModal('upload-material')}>
                    <i className="fas fa-upload"></i>
                    Upload Material
                  </button>
                )}
              </div>

              <div className="teacher-material-list">
                {selectedClassMaterials.map((material) => (
                  <div key={material.id} className="teacher-material-item">
                    <div className="teacher-material-main">
                      <div className="teacher-material-icon">
                        <i className={`fas ${material.icon}`}></i>
                      </div>
                      <div>
                          <strong>{material.title || material.description || material.fileName}</strong>
                          {material.fileName && (material.title || material.description) && material.fileName !== (material.title || material.description) && <p>{material.fileName}</p>}
                          {material.description && material.description !== material.title && <p>{material.description}</p>}
                        <p>{material.size} · Uploaded {material.uploadedDate}</p>
                      </div>
                    </div>
                    <div className="teacher-material-actions">
                      <button
                        className="preview-btn"
                        title="Preview"
                        aria-label="Preview material"
                        onClick={() => previewMaterialFile(material)}
                      >
                        <i className="fas fa-eye"></i>
                      </button>
                      <button
                        className="share-btn"
                        title="Download"
                        aria-label="Download material"
                        disabled={downloadingMaterialId === material.id}
                        onClick={() => downloadMaterialFile(material)}
                      >
                        <i className={`fas ${downloadingMaterialId === material.id ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
                      </button>
                      <button
                        className="delete-btn"
                        title="Delete"
                        aria-label="Delete material"
                        onClick={() => handleDeleteMaterial(material.id, material.title || material.fileName)}
                        disabled={!canManageClassroomMaterials}
                      >
                        <i className="fas fa-trash"></i>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {classroomDetailTab === 'assignments' && (
            <div className="teacher-detail-section">
              <div className="teacher-detail-section-header">
                <h4>Assignments</h4>
                {canCreateAssignmentOnSelectedClass && (
                  <button className="teacher-action-cta" onClick={() => openActionModal('create-assignment')}>
                    <i className="fas fa-plus"></i>
                    Create Assignment
                  </button>
                )}
              </div>

              <div className="teacher-assignment-list-detail">
                {selectedClassAssignments.map((assignment) => {
                  const normalizedAssignmentId = Number(assignment?.id || assignment?.assignmentId || 0);
                  const submittedCount = (gradingSubmissionsByAssignment[normalizedAssignmentId] || gradingSubmissionsByAssignment[String(normalizedAssignmentId)] || [])
                    .filter((row) => Number(row?.classroomId) === Number(selectedClassroom?.classroomId)).length;
                  const totalCount = Number(assignment.total) > 0
                    ? Number(assignment.total)
                    : selectedClassStudents.length;
                  const progress = totalCount > 0 ? (submittedCount / totalCount) * 100 : 0;
                  return (
                    <div key={assignment.id} className="teacher-assignment-item-detail">
                      <div className="teacher-assignment-title-row">
                        <h5>{assignment.title}</h5>
                        <span className={`teacher-assignment-status ${assignment.status.toLowerCase()}`}>{assignment.status}</span>
                      </div>
                      <p>Due: {assignment.dueDate}</p>
                      <p>
                        Posted by {
                          assignment.createdByName
                          || (Number(selectedClassroom?.ownerTeacherId || 0) === Number(currentTeacherProfile.teacherUserId || 0)
                            ? currentTeacherProfile.displayName
                            : selectedClassroom?.ownerTeacherName)
                          || 'Teacher'
                        }
                        {assignment.createdAt ? ` · ${new Date(assignment.createdAt).toLocaleString('en-MY')}` : ''}
                      </p>
                      <div className="teacher-assignment-progress-row">
                        <span><i className="fas fa-paper-plane"></i> {submittedCount}/{totalCount} submitted</span>
                        <button
                          type="button"
                          className="teacher-assignment-link-btn"
                          onClick={() => openAssignmentSubmissionsModal({
                            ...assignment,
                            id: Number.isInteger(normalizedAssignmentId) && normalizedAssignmentId > 0
                              ? normalizedAssignmentId
                              : assignment?.id
                          })}
                        >
                          View Submissions
                        </button>
                      </div>
                      <div className="teacher-assignment-progress-bar"><div style={{ width: `${progress}%` }}></div></div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {classroomDetailTab === 'students' && (
            <div className="teacher-detail-section">
              <div className="teacher-detail-section-header">
                <h4>Enrolled Students ({selectedClassStudents.length})</h4>
                {canManageClassroomStudents && (
                  <button className="teacher-action-cta" onClick={() => openActionModal('manage-students')}>
                    <i className="fas fa-user-cog"></i>
                    Manage
                  </button>
                )}
              </div>

              <div className="teacher-student-list-detail">
                {selectedClassStudents.map((student) => (
                  <div key={student.studentId} className="teacher-student-item-detail">
                    <div className="teacher-student-avatar">{student.name.charAt(0)}</div>
                    <div>
                      <strong>{student.name}</strong>
                      <p>{student.studentNo} · {student.email}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {classroomDetailTab === 'teachers' && (
            <div className="teacher-detail-section">
              <div className="teacher-detail-section-header">
                <h4>Teachers ({selectedClassCoTeachers.length + 1})</h4>
                {canManageClassroomTeachers && (
                  <button className="teacher-action-cta" onClick={() => openActionModal('manage-teachers')}>
                    <i className="fas fa-user-cog"></i>
                    Manage
                  </button>
                )}
              </div>

              <div className="teacher-student-list-detail">
                <div className="teacher-student-item-detail">
                  <div className="teacher-student-avatar">{String(selectedClassroom?.ownerTeacherName || 'T').charAt(0).toUpperCase()}</div>
                  <div>
                    <strong>{selectedClassroom?.ownerTeacherName || 'Owner Teacher'}</strong>
                    <p>Owner · Higher Priority</p>
                  </div>
                </div>

                {selectedClassCoTeachers.map((teacher) => (
                  <div key={teacher.teacherUserId} className="teacher-student-item-detail">
                    <div className="teacher-student-avatar">{String(teacher.name || 'T').charAt(0).toUpperCase()}</div>
                    <div>
                      <strong>{teacher.name}</strong>
                      <p>{normalizeTeacherAccessRole(teacher.accessRole) === 'teacher' ? 'Assistant Teacher (Can Create Assignment)' : 'Assistant Teacher (View Only)'}</p>
                    </div>
                  </div>
                ))}

                {selectedClassCoTeachers.length === 0 && (
                  <p className="teacher-empty">No assistant teacher assigned for this classroom.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === 'attendance' && (
        <div className="teacher-attendance-page">
          <div className="teacher-attendance-page-header">
            <h3>Attendance Records</h3>
            <button className="teacher-attendance-take-btn" onClick={openTakeAttendanceModal} disabled={!canTakeAttendanceSelectedClassroom}>
              <i className="fas fa-plus"></i>
              {canTakeAttendanceSelectedClassroom ? 'Take Attendance' : 'View Only'}
            </button>
          </div>

          <div className="teacher-attendance-filters-card">
            <div className="teacher-attendance-filter-group">
              <label>Select Class</label>
              <select
                value={attendanceClassroomId}
                onChange={(event) => setAttendanceClassroomId(Number(event.target.value))}
              >
                {classrooms.map((classroom) => (
                  <option key={classroom.classroomId} value={classroom.classroomId}>{classroom.classroomName}</option>
                ))}
              </select>
            </div>

            <div className="teacher-attendance-view-toggle">
              <button
                className={attendanceView === 'calendar' ? 'active' : ''}
                onClick={() => setAttendanceView('calendar')}
              >
                <i className="fas fa-calendar-alt"></i>
                Calendar
              </button>
              <button
                className={attendanceView === 'list' ? 'active' : ''}
                onClick={() => setAttendanceView('list')}
              >
                <i className="fas fa-list"></i>
                List
              </button>
              <button
                className={attendanceView === 'student' ? 'active' : ''}
                onClick={() => setAttendanceView('student')}
              >
                <i className="fas fa-user"></i>
                By Student
              </button>
            </div>
          </div>

          <div className="teacher-attendance-summary-grid">
            <div className="teacher-attendance-summary-card">
              <p>Total Sessions</p>
              <strong>{attendanceStatsCards.totalSessions}</strong>
              <span className="icon blue"><i className="fas fa-calendar"></i></span>
            </div>
            <div className="teacher-attendance-summary-card">
              <p>Overall Rate</p>
              <strong className="green">{attendanceStatsCards.overallRate}%</strong>
              <span className="icon green"><i className="fas fa-chart-pie"></i></span>
            </div>
            <div className="teacher-attendance-summary-card">
              <p>Total Students</p>
              <strong className="purple">{attendanceStatsCards.totalStudents}</strong>
              <span className="icon purple"><i className="fas fa-users"></i></span>
            </div>
            <div className="teacher-attendance-summary-card">
              <p>Low Attendance</p>
              <strong className="red">{attendanceStatsCards.lowAttendance}</strong>
              <span className="icon red"><i className="fas fa-exclamation-triangle"></i></span>
            </div>
          </div>

          {attendanceView === 'calendar' && (
            <div className="teacher-attendance-calendar-wrap">
              <div className="teacher-attendance-calendar-header">
                <button onClick={() => setAttendanceMonthOffset((previous) => previous - 1)}>
                  <i className="fas fa-chevron-left"></i>
                </button>
                <h4>{attendanceMonthLabel}</h4>
                <button onClick={() => setAttendanceMonthOffset((previous) => previous + 1)}>
                  <i className="fas fa-chevron-right"></i>
                </button>
              </div>

              <div className="teacher-attendance-weekdays">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>

              <div className="teacher-attendance-calendar-grid">
                {attendanceCalendarCells.map((cell) => {
                  if (cell.empty) {
                    return <div key={cell.key} className="teacher-attendance-day empty"></div>;
                  }

                  return (
                    <button
                      key={cell.key}
                      className={`teacher-attendance-day ${cell.hasRecord ? 'has-record clickable' : ''} ${cell.isToday ? 'today' : ''}`}
                      onClick={() => {
                        if (cell.hasRecord) {
                          openAttendanceRecordModal(cell.dateKey);
                        }
                      }}
                    >
                      <span className="day-number">{cell.day}</span>
                      {cell.isToday && <span className="today-marker">[Today]</span>}
                      {cell.record && (
                        <div className={`teacher-attendance-day-badge ${cell.full ? 'full' : 'partial'}`}>
                          {cell.record.present}/{cell.record.total}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="teacher-attendance-legend">
                <span><i className="dot has-record"></i>Has Record</span>
                <span><i className="dot full"></i>Full Attendance</span>
                <span><i className="dot partial"></i>Partial</span>
              </div>
            </div>
          )}

          {attendanceView === 'list' && (
            <div className="teacher-attendance-list-wrap">
              <div className="teacher-attendance-list-search">
                <input
                  placeholder="Search by date..."
                  value={attendanceSearch}
                  onChange={(event) => setAttendanceSearch(event.target.value)}
                />
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    <th>Present</th>
                    <th>Absent</th>
                    <th>Rate</th>
                    <th>Done By</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceListRows.map((row) => (
                    <tr key={row.dateKey}>
                      <td>{row.dateKey}</td>
                      <td>{row.day}</td>
                      <td><span className="count-pill present">{row.present}</span></td>
                      <td><span className="count-pill absent">{row.absent}</span></td>
                      <td>
                        <div className="rate-cell">
                          <div className="rate-bar"><div style={{ width: `${row.rate}%` }}></div></div>
                          <strong>{row.rate}%</strong>
                        </div>
                      </td>
                      <td>
                        {row.doneBy}
                        {row.doneAt ? ` · ${new Date(row.doneAt).toLocaleString('en-MY')}` : ''}
                      </td>
                      <td>
                        <button className="list-eye-btn" onClick={() => openAttendanceRecordModal(row.dateKey)}>
                          <i className="fas fa-eye"></i>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {attendanceView === 'student' && (
            <div className="teacher-attendance-student-wrap">
              <div className="teacher-attendance-list-search">
                <input
                  placeholder="Search students..."
                  value={attendanceSearch}
                  onChange={(event) => setAttendanceSearch(event.target.value)}
                />
              </div>

              {attendanceStudentRows.map((student) => (
                <div key={student.studentId} className="teacher-student-attendance-row">
                  <div className="student-main">
                    <div className="student-avatar">{student.name.charAt(0)}</div>
                    <div>
                      <strong>{student.name}</strong>
                      <p>{student.studentNo}</p>
                    </div>
                  </div>

                  <div className="student-stats">
                    <span>Present <strong>{student.present}</strong></span>
                    <span>Absent <strong className="red">{student.absent}</strong></span>
                    <span>Rate <strong className="green">{student.rate}%</strong></span>
                  </div>

                  <div className="student-rate-bar">
                    <div style={{ width: `${student.rateNumber}%` }}></div>
                  </div>

                  <button className="student-open-btn" onClick={() => openStudentAttendanceModal(student.studentId)}>
                    <i className="fas fa-eye"></i>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === 'grading' && (
        <div className="teacher-grading-page">
          <div className="teacher-grading-sidebar">
            <div className="teacher-grading-filter-card">
              <label>Select Class</label>
              <select
                value={gradingClassroomId}
                onChange={(event) => {
                  setGradingClassroomId(Number(event.target.value));
                  setSelectedGradingAssignmentId(null);
                  setGradingSearch('');
                  setGradingStatusFilter('all');
                }}
              >
                {gradingEligibleClassrooms.map((classroom) => (
                  <option key={classroom.classroomId} value={classroom.classroomId}>
                    {classroom.classroomName}
                  </option>
                ))}
              </select>
            </div>

            <div className="teacher-grading-assignment-list-card">
              <div className="teacher-grading-assignment-head">
                <h4>Assignments</h4>
              </div>
              {gradingAssignments.map((assignment) => {
                const rows = (gradingSubmissionsByAssignment[assignment.id] || [])
                  .filter((row) => Number(row?.classroomId) === Number(gradingClassroomId));
                const rowCount = rows.length;
                const pendingCount = rows.filter((row) => row.status !== 'graded').length;
                const isActive = selectedGradingAssignment?.id === assignment.id;

                return (
                  <button
                    key={assignment.id}
                    className={`teacher-grading-assignment-item ${isActive ? 'active' : ''}`}
                    onClick={() => setSelectedGradingAssignmentId(assignment.id)}
                  >
                    <div className="teacher-grading-assignment-item-top">
                      <strong>{assignment.title}</strong>
                      {pendingCount > 0 && <span className="teacher-grading-pending-badge">{pendingCount}</span>}
                    </div>
                    <p>Due: {assignment.dueDate}</p>
                    <p>
                      Posted by {
                        assignment.createdByName
                        || (Number(selectedGradingClassroom?.ownerTeacherId || 0) === Number(currentTeacherProfile.teacherUserId || 0)
                          ? currentTeacherProfile.displayName
                          : selectedGradingClassroom?.ownerTeacherName)
                        || 'Teacher'
                      }
                      {assignment.createdAt ? ` · ${new Date(assignment.createdAt).toLocaleString('en-MY')}` : ''}
                    </p>
                    <p>
                      <span className={`status-dot ${assignment.status.toLowerCase()}`}>{assignment.status.toLowerCase()}</span>
                      <span>{rowCount} submissions</span>
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="teacher-grading-main">
            {!selectedGradingAssignment && (
              <div className="teacher-grading-empty-state">
                <i className="fas fa-hand-pointer"></i>
                <h3>Select an Assignment</h3>
                <p>Choose an assignment from the left panel to view and grade submissions</p>
              </div>
            )}

            {selectedGradingAssignment && (
              <>
                <div className="teacher-grading-overview-card">
                  <div className="teacher-grading-overview-head">
                    <div>
                      <h3>{selectedGradingAssignment.title}</h3>
                      <p>Due: {selectedGradingAssignment.dueDate} · Total Marks: 100</p>
                      <p>
                        Posted by {
                          selectedGradingAssignment.createdByName
                          || (Number(selectedGradingClassroom?.ownerTeacherId || 0) === Number(currentTeacherProfile.teacherUserId || 0)
                            ? currentTeacherProfile.displayName
                            : selectedGradingClassroom?.ownerTeacherName)
                          || 'Teacher'
                        }
                        {selectedGradingAssignment.createdAt ? ` · ${new Date(selectedGradingAssignment.createdAt).toLocaleString('en-MY')}` : ''}
                      </p>
                    </div>
                    <span className="teacher-grading-overview-status">{selectedGradingAssignment.status}</span>
                  </div>

                  <div className="teacher-grading-summary-grid">
                    <div className="summary-item blue">
                      <strong>{gradingSummary.total}</strong>
                      <span>Total</span>
                    </div>
                    <div className="summary-item amber">
                      <strong>{gradingSummary.pending}</strong>
                      <span>Pending</span>
                    </div>
                    <div className="summary-item green">
                      <strong>{gradingSummary.graded}</strong>
                      <span>Graded</span>
                    </div>
                    <div className="summary-item purple">
                      <strong>{gradingSummary.avgGrade}</strong>
                      <span>Avg Grade</span>
                    </div>
                  </div>
                </div>

                <div className="teacher-grading-table-wrap">
                  <div className="teacher-grading-table-toolbar">
                    <input
                      placeholder="Search student..."
                      value={gradingSearch}
                      onChange={(event) => setGradingSearch(event.target.value)}
                    />
                    <select
                      value={gradingStatusFilter}
                      onChange={(event) => setGradingStatusFilter(event.target.value)}
                    >
                      <option value="all">All Status</option>
                      <option value="pending">Pending</option>
                      <option value="graded">Graded</option>
                      <option value="late">Late</option>
                    </select>
                  </div>

                  <table className="teacher-grading-table">
                    <thead>
                      <tr>
                        <th><input type="checkbox" /></th>
                        <th>Student</th>
                        <th>Submitted</th>
                        <th>File</th>
                        <th>Status</th>
                        <th>Grade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gradingRows.map((row) => (
                        <tr key={row.id}>
                          <td><input type="checkbox" /></td>
                          <td>
                            <div className="teacher-grading-student-cell">
                              <div className="teacher-grading-student-avatar">{row.studentName.charAt(0)}</div>
                              <div>
                                <strong>{row.studentName}</strong>
                                <p>{row.studentNo}</p>
                              </div>
                            </div>
                          </td>
                          <td>{row.submittedAt}</td>
                          <td>
                            <button className="teacher-grading-file-open" onClick={() => openGradingReviewModal(row)}>
                              <div className="teacher-grading-file-cell">
                              <i className="fas fa-file-pdf"></i>
                              <div>
                                <strong>{row.fileName}</strong>
                                <p>{row.fileSize}</p>
                              </div>
                              </div>
                            </button>
                          </td>
                          <td>
                            <span className={`teacher-grade-status-pill ${row.status}`}>
                              {formatGradeStatus(row.status)}
                            </span>
                          </td>
                          <td>
                            {typeof row.grade === 'number' ? `${row.grade}/100` : '-'}
                            {row.gradedByName && (
                              <p>
                                By {row.gradedByName}
                                {row.gradedAt ? ` · ${new Date(row.gradedAt).toLocaleString('en-MY')}` : ''}
                              </p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {gradingRows.length === 0 && <p className="teacher-empty">No submissions match your current filters.</p>}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {modalState.open && (
        <ClassroomFormModal
          mode={modalState.mode}
          classroom={modalState.classroom}
          onClose={closeModal}
          onSave={saveClassroom}
          isSaving={savingClassroom}
        />
      )}

      {actionModal.open && actionModal.type === 'upload-material' && (
        <UploadMaterialModal
          classroomName={selectedClassroom?.classroomName || 'Selected Class'}
          onClose={closeActionModal}
          onSubmit={handleUploadMaterial}
          isUploading={uploadingMaterial}
        />
      )}

      {materialPreviewDialog.open && (
        <MaterialPreviewModal
          fileName={materialPreviewDialog.fileName}
          previewUrl={materialPreviewDialog.url}
          onClose={closeMaterialPreview}
        />
      )}

      {assignmentSubmissionsModal.open && (
        <AssignmentSubmissionsModal
          assignment={assignmentSubmissionsModal.assignment}
          rows={selectedAssignmentSubmissionRows}
          onClose={closeAssignmentSubmissionsModal}
          onOpenReview={openSubmissionReviewFromAssignment}
          onOpenGradingWorkspace={openGradingWorkspaceFromAssignment}
        />
      )}

      {actionModal.open && actionModal.type === 'create-assignment' && (
        <CreateAssignmentModal
          onClose={closeActionModal}
          onSubmit={handleCreateAssignment}
          defaultTotal={selectedClassStudents.length || selectedClassroom?.currentEnrollment || 1}
          isCreating={creatingAssignment}
        />
      )}

      {actionModal.open && actionModal.type === 'manage-students' && (
        <ManageStudentsModal
          classroomName={selectedClassroom?.classroomName || 'Selected Class'}
          classroomGradeLevel={selectedClassroom?.gradeLevel || ''}
          enrolledStudents={selectedClassStudents}
          allStudents={allStudentsMaster}
          onClose={closeActionModal}
          onSave={handleSaveStudents}
        />
      )}

      {actionModal.open && actionModal.type === 'manage-teachers' && (
        <ManageTeachersModal
          classroomName={selectedClassroom?.classroomName || 'Selected Class'}
          ownerTeacherId={Number(selectedClassroom?.ownerTeacherId || currentTeacherProfile.teacherUserId || 0)}
          coTeachers={selectedClassCoTeachers}
          allTeachers={allTeachersMaster}
          onClose={closeActionModal}
          onSave={handleSaveClassTeachers}
        />
      )}

      {removeMaterialDialog.open && (
        <ConfirmRemoveMaterialModal
          fileName={removeMaterialDialog.fileName}
          isRemoving={isRemovingMaterial}
          onCancel={cancelRemoveMaterial}
          onConfirm={confirmRemoveMaterial}
        />
      )}

      {archiveClassDialog.open && (
        <ConfirmArchiveClassModal
          classroomName={archiveClassDialog.classroomName}
          onCancel={cancelArchiveClass}
          onConfirm={confirmArchiveClass}
        />
      )}

      {announcementModalOpen && selectedClassroom && (
        <ClassAnnouncementModal
          classroomName={selectedClassroom.classroomName}
          message={announcementDraft}
          onMessageChange={setAnnouncementDraft}
          onClose={() => {
            if (!postingAnnouncement) {
              setAnnouncementModalOpen(false);
            }
          }}
          onPost={postClassAnnouncement}
          isPosting={postingAnnouncement}
        />
      )}

      {takeAttendanceModalOpen && (
        <TakeAttendanceModal
          classroomName={selectedAttendanceClassroom?.classroomName || 'Selected Class'}
          students={selectedAttendanceStudents}
          initialDate={attendanceDate}
          onClose={closeTakeAttendanceModal}
          onSave={saveTakeAttendance}
        />
      )}

      {attendanceRecordModal.open && (
        <AttendanceRecordModal
          key={attendanceRecordModal.dateKey}
          classroomName={selectedAttendanceClassroom?.classroomName || 'Selected Class'}
          dateKey={attendanceRecordModal.dateKey}
          students={selectedAttendanceStudents}
          initialStatusMap={editingAttendanceStatusMap}
          recordMeta={selectedAttendanceRecordMeta}
          onClose={closeAttendanceRecordModal}
          onSave={saveAttendanceRecordChanges}
        />
      )}

      {studentAttendanceModal.open && selectedAttendanceStudent && (
        <StudentAttendanceModal
          classroomName={selectedAttendanceClassroom?.classroomName || 'Selected Class'}
          student={selectedAttendanceStudent}
          historyRows={selectedStudentHistoryRows}
          onClose={closeStudentAttendanceModal}
        />
      )}

      {gradingReviewModal.open && gradingReviewModal.row && (
        <GradingReviewModal
          row={gradingReviewModal.row}
          note={gradingNotesBySubmission[gradingReviewModal.row.id] || ''}
          previewUrl={gradingPreviewState.url}
          previewMode={gradingPreviewState.mode}
          previewText={gradingPreviewState.text}
          previewLoading={gradingPreviewState.loading}
          previewError={gradingPreviewState.error}
          onRetryPreview={loadGradingSubmissionPreview}
          onDownloadFile={downloadGradingSubmissionFile}
          onNoteChange={(nextNote) => setGradingNotesBySubmission((previous) => ({
            ...previous,
            [gradingReviewModal.row.id]: nextNote
          }))}
          onOpenGrade={openGradeEntryModal}
          canGrade={canGradeSelectedClassroom}
          onClose={closeGradingReviewModal}
        />
      )}

      {gradeEntryModal.open && gradeEntryModal.row && (
        <GradeSubmissionModal
          row={gradeEntryModal.row}
          initialGrade={typeof gradeEntryModal.row.grade === 'number' ? String(gradeEntryModal.row.grade) : ''}
          initialFeedback={gradingFeedbackBySubmission[gradeEntryModal.row.id] || ''}
          onSave={saveSubmissionGrade}
          onClose={closeGradeEntryModal}
        />
      )}

      <ConfirmDialog
        isOpen={attendanceConfirmOpen}
        title="Submit Attendance"
        message="Submit attendance for this date?"
        onCancel={() => {
          if (!confirmingAttendance) {
            setAttendanceConfirmOpen(false);
          }
        }}
        onConfirm={() => {
          void confirmSubmitAttendance();
        }}
        isConfirming={confirmingAttendance}
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

export default TeacherClassroomTab;
