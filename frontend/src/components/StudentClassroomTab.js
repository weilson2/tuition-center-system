import React, { useEffect, useMemo, useState } from 'react';
import { classroomAPI } from '../services/api';
import api from '../services/api';
import SelectFromStorageModal from './SelectFromStorageModal';
import '../styles/StudentClassroomTab.css';

function formatLocalDate(dateObj) {
  if (!dateObj) return '';
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// eslint-disable-next-line no-unused-vars
const initialEnrolledClasses = [
  {
    id: 1,
    title: 'Mathematics Form 4',
    subject: 'Mathematics',
    teacher: 'Mr. John Doe',
    schedule: 'Mon, Wed 10:00-11:30',
    icon: 'fa-book',
    tone: 'blue',
    materials: [
      { id: 1, fileName: 'Chapter 5 Notes.pdf', size: '2.4 MB', uploadedDate: '2024-12-01', isNew: true },
      { id: 2, fileName: 'Practice Questions.docx', size: '890 KB', uploadedDate: '2024-12-02', isNew: true },
      { id: 3, fileName: 'Chapter 4 Summary.pdf', size: '1.5 MB', uploadedDate: '2024-11-25', isNew: false }
    ],
    assignments: [
      {
        id: 1,
        title: 'Quadratic Equations Exercise',
        description: 'Complete exercises 1-20 from Chapter 5',
        dueDate: '2024-12-15',
        resourceFile: 'Exercise_Sheet.pdf',
        status: 'Pending',
        submittedDate: null,
        grade: null,
        feedback: ''
      },
      {
        id: 2,
        title: 'Chapter 4 Quiz',
        description: '',
        dueDate: '2024-12-10',
        resourceFile: '',
        status: 'Submitted',
        submittedDate: '2024-12-08',
        submittedFileName: 'Chapter_4_Quiz_Submission.pdf',
        submittedFileSize: '0.32 MB',
        submittedComment: '',
        grade: null,
        feedback: ''
      },
      {
        id: 3,
        title: 'Homework Set 3',
        description: '',
        dueDate: '2024-12-01',
        resourceFile: '',
        status: 'Graded',
        submittedDate: '2024-11-30',
        submittedFileName: 'Homework_Set_3.pdf',
        submittedFileSize: '0.47 MB',
        submittedComment: 'Please review question 8 method as well.',
        grade: '85/100',
        feedback: 'Good effort and structure. Show more full working for final steps.'
      }
    ]
  },
  {
    id: 2,
    title: 'Chemistry Form 4',
    subject: 'Chemistry',
    teacher: 'Ms. Sarah Lee',
    schedule: 'Fri 09:00-11:00',
    icon: 'fa-book',
    tone: 'green',
    materials: [
      { id: 1, fileName: 'Periodic Table Reference.pdf', size: '1.1 MB', uploadedDate: '2024-11-28', isNew: false },
      { id: 2, fileName: 'Acids and Bases Notes.pdf', size: '1.8 MB', uploadedDate: '2024-12-03', isNew: true }
    ],
    assignments: [
      {
        id: 1,
        title: 'Chemical Bonding Worksheet',
        description: 'Answer all worksheet sections and upload your written steps.',
        dueDate: '2024-12-18',
        resourceFile: 'Bonding_Worksheet.pdf',
        status: 'Pending',
        submittedDate: null,
        grade: null,
        feedback: ''
      },
      {
        id: 2,
        title: 'Lab Report: Titration',
        description: '',
        dueDate: '2024-12-04',
        resourceFile: '',
        status: 'Graded',
        submittedDate: '2024-12-03',
        submittedFileName: 'Titration_Lab_Report.pdf',
        submittedFileSize: '0.84 MB',
        submittedComment: '',
        grade: '90/100',
        feedback: 'Excellent analysis section and clear conclusion.'
      },
      {
        id: 3,
        title: 'Reaction Rates Quiz',
        description: '',
        dueDate: '2024-12-12',
        resourceFile: '',
        status: 'Submitted',
        submittedDate: '2024-12-11',
        submittedFileName: 'Reaction_Rates_Quiz.pdf',
        submittedFileSize: '0.29 MB',
        submittedComment: '',
        grade: null,
        feedback: ''
      }
    ]
  }
];

const STUDENT_ASSIGNMENT_STATUS = {
  PENDING: 'Pending',
  SUBMITTED: 'Submitted',
  GRADED: 'Graded'
};

function normalizeAssignmentStatus(statusValue) {
  const normalized = String(statusValue || '').trim().toLowerCase();

  if (normalized === 'graded' || normalized === 'returned') {
    return STUDENT_ASSIGNMENT_STATUS.GRADED;
  }

  if (
    normalized === 'submitted'
    || normalized === 'awaiting_grade'
    || normalized === 'awaiting grade'
    || normalized === 'submitted_for_grading'
    || normalized === 'late'
  ) {
    return STUDENT_ASSIGNMENT_STATUS.SUBMITTED;
  }

  return STUDENT_ASSIGNMENT_STATUS.PENDING;
}

function getAssignmentSubmission(assignment) {
  if (assignment?.submission && assignment.submission.fileName) {
    return assignment.submission;
  }

  if (assignment?.submittedFileName) {
    return {
      fileId: assignment.submittedFileId || null,
      fileName: assignment.submittedFileName,
      fileSize: assignment.submittedFileSize || '-',
      submittedAt: assignment.submittedDate || '-',
      comment: assignment.submittedComment || ''
    };
  }

  return null;
}

function getAssignmentGrade(assignment) {
  if (assignment?.grade !== null && assignment?.grade !== undefined && assignment?.grade !== '') {
    return String(assignment.grade);
  }

  if (assignment?.grading?.score !== null && assignment?.grading?.score !== undefined) {
    return `${assignment.grading.score}/100`;
  }

  return '';
}

function getAssignmentFeedback(assignment) {
  return assignment?.feedback || assignment?.grading?.feedback || '';
}

function getMaterialDescription(material) {
  return material?.description || material?.notes || '';
}

function getMaterialLabel(material) {
  return material?.title || material?.description || material?.fileName || 'Material';
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

function parseUploadedDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function SubmitAssignmentModal({ assignment, onClose, onSubmit, isSubmitting = false }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [comment, setComment] = useState('');
  const [showStorageModal, setShowStorageModal] = useState(false);

  useEffect(() => {
    setSelectedFile(null);
    setComment('');
    setShowStorageModal(false);
  }, [assignment]);

  if (!assignment) {
    return null;
  }

  const formatFileSize = (bytes) => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleFilePicked = (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleStorageSelect = (storageFile) => {
    setSelectedFile({
      name: storageFile.fileName,
      size: storageFile.size,
      fileId: storageFile.fileId,
      fromStorage: true
    });
    setShowStorageModal(false);
  };

  const handleSubmit = () => {
    if (!selectedFile) {
      return;
    }

    onSubmit({
      assignmentId: assignment.id,
      file: selectedFile.fromStorage ? null : selectedFile,
      fileName: selectedFile.name,
      fileSize: selectedFile.fromStorage ? selectedFile.size : formatFileSize(selectedFile.size),
      fileId: selectedFile.fileId || null,
      fromStorage: !!selectedFile.fromStorage,
      comment: comment.trim()
    });
  };

  return (
    <div className="student-modal-backdrop">
      <div className="student-submit-modal">
        <div className="student-submit-header">
          <h3>Submit Assignment</h3>
          <button className="student-submit-close" onClick={onClose} aria-label="Close submit modal">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="student-submit-assignment-meta">
          <strong>{assignment.title}</strong>
          <p>Due: {assignment.dueDate}</p>
        </div>

        <div className="student-submit-section">
          <label>Upload Your Work</label>

          {!selectedFile && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label
                className="student-upload-dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
              >
                <input type="file" onChange={handleFilePicked} />
                <i className="fas fa-cloud-upload-alt"></i>
                <p>Drag and drop your file here</p>
                <span>Browse Files</span>
              </label>
              <div style={{ textAlign: 'center', margin: '5px 0', color: '#666' }}>OR</div>
              <button 
                type="button" 
                className="secondary" 
                style={{ width: '100%', padding: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
                onClick={() => setShowStorageModal(true)}
              >
                <i className="fas fa-cloud"></i> Choose from Storage
              </button>
            </div>
          )}

          {selectedFile && (
            <div className="student-upload-picked-file">
              <span className="student-upload-picked-icon"><i className="fas fa-file"></i></span>
              <div>
                <strong>{selectedFile.name}</strong>
                <p>{formatFileSize(selectedFile.size)}</p>
              </div>
              <button type="button" onClick={() => setSelectedFile(null)} aria-label="Remove selected file">
                <i className="fas fa-times"></i>
              </button>
            </div>
          )}
        </div>

        <div className="student-submit-section">
          <label>Comment (Optional)</label>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Add a comment for your teacher..."
            rows={3}
          />
        </div>

        <div className="student-submit-warning">
          <i className="fas fa-exclamation-triangle"></i>
          Once submitted, you cannot modify your submission.
        </div>

        <div className="student-submit-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="primary"
            onClick={handleSubmit}
            disabled={!selectedFile || isSubmitting}
          >
            <i className={`fas ${isSubmitting ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}></i>
            {isSubmitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </div>
      {showStorageModal && (
        <SelectFromStorageModal 
          onClose={() => setShowStorageModal(false)}
          onSelect={handleStorageSelect}
        />
      )}
    </div>
  );
}

function SubmissionDetailsModal({ assignment, onClose, onUnsubmit, isUnsubmitting = false }) {
  const submission = getAssignmentSubmission(assignment);
  const statusLabel = normalizeAssignmentStatus(assignment?.status);
  const canUnsubmit = statusLabel === STUDENT_ASSIGNMENT_STATUS.SUBMITTED;
  const submissionFileId = Number(submission?.fileId || assignment?.submittedFileId || 0);
  const [previewState, setPreviewState] = useState({
    loading: false,
    mode: 'iframe',
    url: '',
    text: '',
    error: ''
  });

  useEffect(() => {
    let isCancelled = false;
    let createdPreviewUrl = '';

    const loadPreview = async () => {
      if (!assignment) {
        return;
      }

      if (!Number.isInteger(submissionFileId) || submissionFileId <= 0) {
        setPreviewState({
          loading: false,
          mode: 'iframe',
          url: '',
          text: '',
          error: 'No uploaded file linked for preview.'
        });
        return;
      }

      setPreviewState({
        loading: true,
        mode: 'iframe',
        url: '',
        text: '',
        error: ''
      });

      try {
        const response = await classroomAPI.previewStudentClassMaterial(submissionFileId);
        if (isCancelled) {
          return;
        }

        const blob = response.data;
        const contentType = String(response.headers?.['content-type'] || blob?.type || '').toLowerCase();

        if (contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml') || contentType.includes('csv')) {
          const textContent = await blob.text();
          if (isCancelled) {
            return;
          }

          setPreviewState({
            loading: false,
            mode: 'text',
            url: '',
            text: textContent,
            error: ''
          });
          return;
        }

        createdPreviewUrl = window.URL.createObjectURL(blob);
        setPreviewState({
          loading: false,
          mode: contentType.startsWith('image/') ? 'image' : 'iframe',
          url: createdPreviewUrl,
          text: '',
          error: ''
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setPreviewState({
          loading: false,
          mode: 'iframe',
          url: '',
          text: '',
          error: error.response?.data?.error || 'Failed to load submission preview'
        });
      }
    };

    loadPreview();

    return () => {
      isCancelled = true;
      if (createdPreviewUrl) {
        window.URL.revokeObjectURL(createdPreviewUrl);
      }
    };
  }, [assignment, submissionFileId]);

  const handleUnsubmit = () => {
    if (!canUnsubmit || typeof onUnsubmit !== 'function') {
      return;
    }
    onUnsubmit(assignment);
  };

  if (!assignment) {
    return null;
  }

  return (
    <div className="student-modal-backdrop">
      <div className="student-preview-modal">
        <div className="student-preview-header">
          <div>
            <strong>{submission?.fileName || 'Submitted File'}</strong>
            <p>{submission?.fileSize || '-'} · Submitted: {submission?.submittedAt || '-'}</p>
          </div>
          <button className="student-modal-close" onClick={onClose} aria-label="Close submitted file details">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="student-preview-body inline">
          {previewState.loading && (
            <div className="student-preview-body">
              <i className="fas fa-spinner fa-spin"></i>
              <h4>Loading Preview</h4>
              <p>{submission?.fileName || '-'}</p>
            </div>
          )}

          {!previewState.loading && previewState.mode === 'image' && previewState.url && (
            <img
              src={previewState.url}
              alt={submission?.fileName || 'Submitted file preview'}
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
              title={submission?.fileName || 'Submission preview'}
              src={previewState.url}
              className="student-preview-frame"
            />
          )}

          {!previewState.loading && !previewState.url && previewState.mode !== 'text' && (
            <div className="student-preview-body">
              <i className="fas fa-file-circle-question"></i>
              <h4>Preview Unavailable</h4>
              <p>{submission?.fileName || '-'}</p>
              <small>{previewState.error || 'This file type cannot be previewed inline.'}</small>
            </div>
          )}
        </div>

        <div className="student-feedback-body">
          {submission?.comment && (
            <p>
              <strong>Comment:</strong> {submission.comment}
            </p>
          )}
        </div>

        <div className="student-download-actions">
          {canUnsubmit ? (
            <button className="secondary" onClick={handleUnsubmit} disabled={isUnsubmitting}>
              {isUnsubmitting ? 'Unsubmitting...' : 'Unsubmit'}
            </button>
          ) : null}
          <button className="primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function AssignmentFeedbackModal({ assignment, onClose }) {
  const gradeLabel = getAssignmentGrade(assignment);
  const feedbackText = getAssignmentFeedback(assignment);

  if (!assignment) {
    return null;
  }

  return (
    <div className="student-modal-backdrop">
      <div className="student-feedback-modal">
        <div className="student-download-header">
          <h3>Assignment Feedback</h3>
          <button className="student-modal-close" onClick={onClose} aria-label="Close feedback">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="student-feedback-body">
          <strong>{assignment.title}</strong>
          <p className="student-feedback-grade">
            <i className="fas fa-star"></i>
            Grade: {gradeLabel || '-'}
          </p>
          <p>{feedbackText || 'No feedback provided yet.'}</p>
        </div>

        <div className="student-download-actions">
          <button className="primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function PreviewMaterialModal({ material, onClose }) {
  if (!material) {
    return null;
  }

  const hasInlinePreview = Boolean(material.previewUrl);

  return (
    <div className="student-modal-backdrop">
      <div className="student-preview-modal">
        <div className="student-preview-header">
          <div>
            <strong>{getMaterialLabel(material)}</strong>
            <p>{material.size} · PDF</p>
          </div>
          <button className="student-modal-close" onClick={onClose} aria-label="Close preview">
            <i className="fas fa-times"></i>
          </button>
        </div>

        {hasInlinePreview ? (
          <div className="student-preview-body inline">
            <iframe
              title={getMaterialLabel(material)}
              src={material.previewUrl}
              className="student-preview-frame"
            />
          </div>
        ) : (
          <div className="student-preview-body">
            <i className="fas fa-file-pdf"></i>
            <h4>Preview: {getMaterialLabel(material)}</h4>
            <p>Full document preview would render here</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DownloadMaterialModal({ material, onClose, onConfirm }) {
  const [isDownloaded, setIsDownloaded] = useState(false);

  useEffect(() => {
    setIsDownloaded(false);
  }, [material]);

  if (!material) {
    return null;
  }

  const handleDownload = () => {
    setIsDownloaded(true);
    if (typeof onConfirm === 'function') {
      onConfirm(material);
    }
  };

  return (
    <div className="student-modal-backdrop">
      <div className="student-download-modal">
        <div className="student-download-header">
          <h3>Download File</h3>
          <button className="student-modal-close" onClick={onClose} aria-label="Close download dialog">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="student-download-file-row">
          <span className="student-file-icon"><i className="fas fa-file-pdf"></i></span>
          <div>
            <strong>{getMaterialLabel(material)}</strong>
            <p>{material.size}</p>
          </div>
        </div>

        {isDownloaded && (
          <div className="student-download-success" role="status" aria-live="polite">
            <i className="fas fa-check-circle"></i>
            Download complete!
          </div>
        )}

        <div className="student-download-actions">
          <button className="secondary" onClick={onClose}>Close</button>
          <button className="primary" onClick={handleDownload}>
            <i className="fas fa-download"></i>
            Download
          </button>
        </div>
      </div>
    </div>
  );
}

function StudentDialogModal({ dialog, onClose, onConfirm, isProcessing = false }) {
  if (!dialog) {
    return null;
  }

  const isConfirm = dialog.type === 'confirm';

  return (
    <div className="student-modal-backdrop">
      <div className="student-download-modal">
        <div className="student-download-header">
          <h3>{dialog.title || (isConfirm ? 'Confirm Action' : 'Message')}</h3>
          <button className="student-modal-close" onClick={onClose} aria-label="Close dialog">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="student-feedback-body">
          <p>{dialog.message || ''}</p>
        </div>

        <div className="student-download-actions">
          {isConfirm && (
            <button className="secondary" onClick={onClose} disabled={isProcessing}>{dialog.cancelText || 'Cancel'}</button>
          )}
          <button className="primary" onClick={onConfirm} disabled={isProcessing}>
            {isProcessing ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                Processing...
              </>
            ) : (dialog.confirmText || (isConfirm ? 'Confirm' : 'OK'))}
          </button>
        </div>
      </div>
    </div>
  );
}

function JoinClassCodeModal({ value, onChange, onClose, onSubmit, isJoining = false }) {
  return (
    <div className="student-modal-backdrop">
      <div className="student-download-modal">
        <div className="student-download-header">
          <h3>Join Class with Code</h3>
          <button className="student-modal-close" onClick={onClose} aria-label="Close join class dialog">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="student-feedback-body">
          <label className="student-join-code-label" htmlFor="student-join-code-input">Enter classroom join code</label>
          <input
            id="student-join-code-input"
            className="student-join-code-input"
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="e.g. ABC123"
            disabled={isJoining}
            autoFocus
          />
        </div>

        <div className="student-download-actions">
          <button className="secondary" onClick={onClose} disabled={isJoining}>Cancel</button>
          <button className="primary" onClick={onSubmit} disabled={isJoining || !String(value || '').trim()}>
            {isJoining ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                Joining...
              </>
            ) : 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StudentClassroomTab({ navigationIntent = null, onNavigationIntentConsumed = null }) {
  const [enrolledClasses, setEnrolledClasses] = useState([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [selectedClassId, setSelectedClassId] = useState(null);
  const [detailTab, setDetailTab] = useState('materials');
  const [previewMaterial, setPreviewMaterial] = useState(null);
  const [downloadMaterial, setDownloadMaterial] = useState(null);
  const [submitAssignment, setSubmitAssignment] = useState(null);
  const [feedbackAssignment, setFeedbackAssignment] = useState(null);
  const [submissionPreviewAssignment, setSubmissionPreviewAssignment] = useState(null);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [showJoinCodeModal, setShowJoinCodeModal] = useState(false);
  const [dialogState, setDialogState] = useState(null);
  const [refreshingData, setRefreshingData] = useState(false);
  const [dialogProcessing, setDialogProcessing] = useState(false);
  const [joiningClass, setJoiningClass] = useState(false);
  const [submittingAssignment, setSubmittingAssignment] = useState(false);
  const [previewingMaterialId, setPreviewingMaterialId] = useState(null);
  const [downloadingMaterialId, setDownloadingMaterialId] = useState(null);
  const [unsubmittingAssignmentId, setUnsubmittingAssignmentId] = useState(null);
  const [materialDateFilter, setMaterialDateFilter] = useState('all');

  const showInfoDialog = (message, title = 'Message') => {
    setDialogState({ type: 'info', title, message, confirmText: 'OK' });
  };

  const showConfirmDialog = ({ title = 'Confirm Action', message, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm }) => {
    setDialogState({ type: 'confirm', title, message, confirmText, cancelText, onConfirm });
  };

  const closeDialog = () => {
    if (dialogProcessing) {
      return;
    }
    setDialogState(null);
  };

  const handleDialogConfirm = async () => {
    if (dialogState?.type === 'confirm' && typeof dialogState?.onConfirm === 'function') {
      const action = dialogState.onConfirm;
      setDialogProcessing(true);
      try {
        const shouldClose = await action();
        if (shouldClose !== false) {
          setDialogState(null);
        }
      } finally {
        setDialogProcessing(false);
      }
      return;
    }

    setDialogState(null);
  };

  const loadStudentClasses = async () => {
    try {
      setLoadingClasses(true);
      const response = await classroomAPI.getStudentClasses();
      setEnrolledClasses(Array.isArray(response?.classes) ? response.classes : []);
    } catch (error) {
      console.error('Failed to load student classes:', error);
      setEnrolledClasses([]);
    } finally {
      setLoadingClasses(false);
    }
  };

  useEffect(() => {
    loadStudentClasses();
  }, []);

  const handleRefreshData = async () => {
    if (refreshingData) {
      return;
    }

    setRefreshingData(true);
    try {
      await loadStudentClasses();
    } catch (_error) {
      showInfoDialog('Failed to refresh classroom data', 'Refresh Failed');
    } finally {
      setRefreshingData(false);
    }
  };

  useEffect(() => {
    if (!navigationIntent) {
      return;
    }

    if (loadingClasses) {
      return;
    }

    const findClassByAssignment = (assignmentTitle) => enrolledClasses.find(
      (classroom) => classroom.assignments.some((assignment) => assignment.title === assignmentTitle)
    ) || null;

    const findClassByMaterial = (materialFileName) => enrolledClasses.find(
      (classroom) => classroom.materials.some((material) => material.fileName === materialFileName)
    ) || null;

    const classFromName = navigationIntent.className
      ? enrolledClasses.find((classroom) => classroom.title === navigationIntent.className) || null
      : null;

    const normalizedClassId = Number(navigationIntent.classId);
    const classFromId = Number.isInteger(normalizedClassId) && normalizedClassId > 0
      ? enrolledClasses.find((classroom) => Number(classroom.classroomId || classroom.id) === normalizedClassId) || null
      : null;

    const classFromAssignment = navigationIntent.assignmentTitle
      ? findClassByAssignment(navigationIntent.assignmentTitle)
      : null;

    const classFromMaterial = navigationIntent.materialFileName
      ? findClassByMaterial(navigationIntent.materialFileName)
      : null;

    const gradingDefaultClass = navigationIntent.subTab === 'grading'
      ? enrolledClasses.find((classroom) => classroom.assignments.some(
        (assignment) => normalizeAssignmentStatus(assignment.status) === STUDENT_ASSIGNMENT_STATUS.GRADED
      )) || enrolledClasses[0] || null
      : null;

    const attendanceDefaultClass = navigationIntent.detailTab === 'attendance'
      ? enrolledClasses.find((classroom) => Number(classroom?.attendance?.sessions || 0) > 0) || enrolledClasses[0] || null
      : null;

    const targetClass = classFromId || classFromName || classFromAssignment || classFromMaterial || gradingDefaultClass || attendanceDefaultClass;
    let handledIntent = false;

    if (targetClass) {
      setSelectedClassId(targetClass.id);
      handledIntent = true;
    }

    if (navigationIntent.detailTab === 'assignments' || navigationIntent.subTab === 'grading') {
      setDetailTab('assignments');
      handledIntent = true;
    } else if (navigationIntent.detailTab === 'materials') {
      setDetailTab('materials');
      handledIntent = true;
    } else if (navigationIntent.detailTab === 'attendance') {
      setDetailTab('attendance');
      handledIntent = true;
    }

    if (navigationIntent.action === 'submit-assignment' && targetClass) {
      const normalizedAssignmentId = Number(navigationIntent.assignmentId);
      const assignment = (
        (Number.isInteger(normalizedAssignmentId) && normalizedAssignmentId > 0
          ? targetClass.assignments.find((item) => Number(item.id) === normalizedAssignmentId)
          : null)
        || (navigationIntent.assignmentTitle
          ? targetClass.assignments.find((item) => item.title === navigationIntent.assignmentTitle)
          : null)
        || null
      );

      if (assignment && normalizeAssignmentStatus(assignment.status) === STUDENT_ASSIGNMENT_STATUS.PENDING) {
        setSubmitAssignment(assignment);
        handledIntent = true;
      }
    }

    if (navigationIntent.action === 'view-feedback' && targetClass) {
      const normalizedAssignmentId = Number(navigationIntent.assignmentId);
      const assignment = (
        (Number.isInteger(normalizedAssignmentId) && normalizedAssignmentId > 0
          ? targetClass.assignments.find((item) => Number(item.id) === normalizedAssignmentId)
          : null)
        || (navigationIntent.assignmentTitle
          ? targetClass.assignments.find((item) => item.title === navigationIntent.assignmentTitle)
          : null)
        || null
      );

      if (assignment && normalizeAssignmentStatus(assignment.status) === STUDENT_ASSIGNMENT_STATUS.GRADED) {
        setFeedbackAssignment(assignment);
        handledIntent = true;
      }
    }

    if (navigationIntent.action === 'download-material' && targetClass && navigationIntent.materialFileName) {
      const material = targetClass.materials.find((item) => item.fileName === navigationIntent.materialFileName) || null;

      if (material) {
        void handleDownloadMaterial(material);
        handledIntent = true;
      }
    }

    if (navigationIntent.action === 'preview-material' && targetClass && navigationIntent.materialFileName) {
      const material = targetClass.materials.find((item) => item.fileName === navigationIntent.materialFileName) || null;

      if (material) {
        void handlePreviewMaterial(material);
        handledIntent = true;
      }
    }

    if (typeof onNavigationIntentConsumed === 'function' && (handledIntent || enrolledClasses.length === 0 || !targetClass)) {
      onNavigationIntentConsumed();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrolledClasses, loadingClasses, navigationIntent, onNavigationIntentConsumed]);

  const selectedClass = useMemo(
    () => enrolledClasses.find((item) => String(item.id) === String(selectedClassId)) || null,
    [enrolledClasses, selectedClassId]
  );

  const displayedMaterials = useMemo(() => {
    const rawMaterials = Array.isArray(selectedClass?.materials) ? selectedClass.materials : [];

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const filtered = rawMaterials.filter((material) => {
      if (materialDateFilter === 'all') {
        return true;
      }

      const uploadedDate = parseUploadedDate(material?.uploadedDate);
      if (!uploadedDate) {
        return false;
      }

      const uploadedDay = new Date(uploadedDate.getFullYear(), uploadedDate.getMonth(), uploadedDate.getDate());

      if (materialDateFilter === 'today') {
        return uploadedDay.getTime() === startOfToday.getTime();
      }

      if (materialDateFilter === '7days') {
        const sevenDaysAgo = new Date(startOfToday);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        return uploadedDay >= sevenDaysAgo;
      }

      if (materialDateFilter === '30days') {
        const thirtyDaysAgo = new Date(startOfToday);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
        return uploadedDay >= thirtyDaysAgo;
      }

      return true;
    });

    return filtered
      .slice()
      .sort((left, right) => {
        const leftDate = parseUploadedDate(left?.uploadedDate);
        const rightDate = parseUploadedDate(right?.uploadedDate);

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
      });
  }, [materialDateFilter, selectedClass]);

  useEffect(() => {
    setMaterialDateFilter('all');
  }, [selectedClassId]);

  const selectedClassStats = useMemo(() => {
    if (!selectedClass) {
      return { materials: 0, pending: 0, submitted: 0, graded: 0 };
    }

    return {
      materials: selectedClass.materials.length,
      pending: selectedClass.assignments.filter((item) => normalizeAssignmentStatus(item.status) === STUDENT_ASSIGNMENT_STATUS.PENDING).length,
      submitted: selectedClass.assignments.filter((item) => normalizeAssignmentStatus(item.status) === STUDENT_ASSIGNMENT_STATUS.SUBMITTED).length,
      graded: selectedClass.assignments.filter((item) => normalizeAssignmentStatus(item.status) === STUDENT_ASSIGNMENT_STATUS.GRADED).length
    };
  }, [selectedClass]);

  const selectedAttendanceSummary = useMemo(() => {
    const attendance = selectedClass?.attendance;
    const sessions = Number(attendance?.sessions || 0);
    const present = Number(attendance?.present || 0);
    const absent = Number(attendance?.absent || 0);
    const rate = Number(attendance?.rate);

    return {
      sessions: Number.isFinite(sessions) ? sessions : 0,
      present: Number.isFinite(present) ? present : 0,
      absent: Number.isFinite(absent) ? absent : 0,
      rateLabel: Number.isFinite(rate) ? `${rate.toFixed(1)}%` : '--'
    };
  }, [selectedClass]);

  const selectedAttendanceHistory = useMemo(() => {
    const historyRows = Array.isArray(selectedClass?.attendance?.history) ? selectedClass.attendance.history : [];

    return historyRows
      .map((row) => {
        const rawDate = String(row?.date || '').trim();
        if (!rawDate) {
          return null;
        }

        const parsedDate = parseUploadedDate(rawDate);
        const sortableTimestamp = parsedDate ? parsedDate.getTime() : 0;
        const displayDate = parsedDate ? formatLocalDate(parsedDate) : rawDate;
        const takenAtRaw = row?.takenAt || row?.updatedAt || '';
        const parsedTakenAt = parseUploadedDate(takenAtRaw);
        const takenAtLabel = parsedTakenAt
          ? parsedTakenAt.toLocaleString('en-MY', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          })
          : (takenAtRaw ? String(takenAtRaw) : 'Unknown time');
        const takenByLabel = String(row?.takenBy || row?.updatedBy || 'Teacher');

        const isPresent = Boolean(row?.present);
        return {
          date: displayDate,
          sortableTimestamp,
          status: isPresent ? 'Present' : 'Absent',
          isPresent,
          takenBy: takenByLabel,
          takenAt: takenAtLabel
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (right.sortableTimestamp !== left.sortableTimestamp) {
          return right.sortableTimestamp - left.sortableTimestamp;
        }
        return String(right.date).localeCompare(String(left.date));
      });
  }, [selectedClass]);

  const selectedAttendanceHistoryRows = useMemo(() => {
    if (selectedAttendanceHistory.length > 0) {
      return selectedAttendanceHistory;
    }

    const presentCount = Number(selectedAttendanceSummary.present || 0);
    const absentCount = Number(selectedAttendanceSummary.absent || 0);
    const fallbackRows = [];

    for (let index = 0; index < presentCount; index += 1) {
      fallbackRows.push({
        date: `Session ${index + 1}`,
        status: 'Present',
        isPresent: true,
        isEstimated: true,
        takenBy: 'Teacher',
        takenAt: 'Unknown time'
      });
    }

    for (let index = 0; index < absentCount; index += 1) {
      fallbackRows.push({
        date: `Session ${presentCount + index + 1}`,
        status: 'Absent',
        isPresent: false,
        isEstimated: true,
        takenBy: 'Teacher',
        takenAt: 'Unknown time'
      });
    }

    return fallbackRows;
  }, [selectedAttendanceHistory, selectedAttendanceSummary.absent, selectedAttendanceSummary.present]);

  const openClassDetail = (classId) => {
    setSelectedClassId(classId);
    setDetailTab('materials');
  };

  const closeClassDetail = () => {
    setSelectedClassId(null);
  };

  const closePreviewMaterial = () => {
    setPreviewMaterial((previous) => {
      if (previous?.previewUrl) {
        window.URL.revokeObjectURL(previous.previewUrl);
      }
      return null;
    });
  };

  const handlePreviewMaterial = async (material) => {
    const fileId = Number(material?.fileId);
    setPreviewingMaterialId(material?.id || null);

    if (!Number.isInteger(fileId) || fileId <= 0) {
      setPreviewMaterial(material);
      setPreviewingMaterialId(null);
      return;
    }

    try {
      const response = await classroomAPI.previewStudentClassMaterial(fileId);
      const blobUrl = window.URL.createObjectURL(response.data);
      setPreviewMaterial((previous) => {
        if (previous?.previewUrl) {
          window.URL.revokeObjectURL(previous.previewUrl);
        }
        return {
          ...material,
          previewUrl: blobUrl
        };
      });
    } catch (error) {
      showInfoDialog(error.response?.data?.error || 'Failed to preview material', 'Preview Failed');
    } finally {
      setPreviewingMaterialId(null);
    }
  };

  useEffect(() => () => {
    if (previewMaterial?.previewUrl) {
      window.URL.revokeObjectURL(previewMaterial.previewUrl);
    }
  }, [previewMaterial?.previewUrl]);

  const handleDownloadMaterial = async (material) => {
    const fileId = Number(material?.fileId);
    setDownloadingMaterialId(material?.id || null);

    if (!Number.isInteger(fileId) || fileId <= 0) {
      setDownloadMaterial(material);
      setDownloadingMaterialId(null);
      return;
    }

    try {
      const response = await classroomAPI.downloadStudentClassMaterial(fileId);
      const fileName = getDownloadFileName(response.headers, material?.fileName || `file-${fileId}`);
      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      showInfoDialog(error.response?.data?.error || 'Failed to download material', 'Download Failed');
    } finally {
      setDownloadingMaterialId(null);
    }
  };

  const handleAssignmentSubmit = async ({ assignmentId, file, fileName, fileSize, comment, fromStorage, fileId }) => {
    if (!selectedClass) {
      return;
    }

    if (!file && !fromStorage) {
      showInfoDialog('Please select a file before submitting', 'Missing File');
      return;
    }

    const selectedClassroomId = Number(selectedClass?.classroomId || selectedClass?.id);
    if (!Number.isInteger(selectedClassroomId) || selectedClassroomId <= 0) {
      showInfoDialog('Classroom id is invalid. Please refresh and try again.', 'Submission Failed');
      return;
    }

    let submissionDate = formatLocalDate(new Date());
    let uploadedFileId = fileId || null;
    let normalizedFileName = fileName;
    let normalizedFileSize = fileSize;

    setSubmittingAssignment(true);

    try {
      if (fromStorage && uploadedFileId) {
        const copyResponse = await api.post(`/storage/files/${uploadedFileId}/copy`, {
          scope: 'classroom',
          classroomId: String(selectedClassroomId)
        });
        const copiedFile = copyResponse?.data?.file;
        uploadedFileId = Number(copiedFile?.file_id || 0) || null;
      } else if (!fromStorage) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('scope', 'classroom');
        formData.append('classroomId', String(selectedClassroomId));
        formData.append('uploadCategory', 'submission');

        const uploadResponse = await api.post('/storage/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });

        const uploadedFile = uploadResponse?.data?.file;
        uploadedFileId = Number(uploadedFile?.file_id || 0) || null;
        normalizedFileName = String(uploadedFile?.original_filename || fileName || file.name || 'Submission');
        normalizedFileSize = fileSize || String(uploadedFile?.file_size || '');
      }

      const submitResponse = await classroomAPI.submitStudentAssignment(selectedClassroomId, assignmentId, {
        classroomId: selectedClassroomId,
        fileId: uploadedFileId,
        fileName: normalizedFileName,
        fileSize: normalizedFileSize,
        comment
      });

      const savedSubmission = submitResponse?.submission;
      if (savedSubmission?.submittedAt) {
        submissionDate = formatLocalDate(new Date(savedSubmission.submittedAt));
      }
    } catch (error) {
      console.error('Failed to submit assignment:', error);
      showInfoDialog(error.response?.data?.error || 'Failed to submit assignment. Please try again.', 'Submission Failed');
      setSubmittingAssignment(false);
      return;
    }

    setEnrolledClasses((previous) =>
      previous.map((classroom) => {
        if (classroom.id !== selectedClass.id) {
          return classroom;
        }

        return {
          ...classroom,
          assignments: classroom.assignments.map((assignment) => {
            if (assignment.id !== assignmentId) {
              return assignment;
            }

            return {
              ...assignment,
              status: STUDENT_ASSIGNMENT_STATUS.SUBMITTED,
              submission: {
                fileId: uploadedFileId,
                fileName: normalizedFileName,
                fileSize: normalizedFileSize,
                submittedAt: submissionDate,
                comment
              },
              submittedDate: submissionDate,
              submittedFileId: uploadedFileId,
              submittedFileName: normalizedFileName,
              submittedFileSize: normalizedFileSize,
              submittedComment: comment
            };
          })
        };
      })
    );

    setSubmitAssignment(null);
    setSubmittingAssignment(false);
    showInfoDialog('Assignment submitted successfully', 'Success');
  };

  const handleJoinClassByCode = async () => {
    const joinCode = String(joinCodeInput || '').trim();
    if (!joinCode) {
      showInfoDialog('Please enter classroom join code', 'Join Class');
      return;
    }

    setJoiningClass(true);

    try {
      const response = await classroomAPI.joinStudentClassByCode(joinCode);
      await loadStudentClasses();
      setShowJoinCodeModal(false);
      setJoinCodeInput('');
      showInfoDialog(response?.message || 'Joined classroom successfully', 'Success');
    } catch (error) {
      showInfoDialog(error.response?.data?.error || 'Failed to join classroom with code', 'Join Failed');
    } finally {
      setJoiningClass(false);
    }
  };

  const handleAssignmentUnsubmit = async (assignment) => {
    if (!selectedClass || !assignment) {
      return;
    }

    const selectedClassroomId = Number(selectedClass?.classroomId || selectedClass?.id);
    if (!Number.isInteger(selectedClassroomId) || selectedClassroomId <= 0) {
      showInfoDialog('Classroom id is invalid. Please refresh and try again.', 'Unsubmit Failed');
      return false;
    }

    setUnsubmittingAssignmentId(assignment.id);

    try {
      await classroomAPI.unsubmitStudentAssignment(selectedClassroomId, assignment.id, {
        classroomId: selectedClassroomId
      });
    } catch (error) {
      showInfoDialog(error.response?.data?.error || 'Failed to unsubmit assignment', 'Unsubmit Failed');
      setUnsubmittingAssignmentId(null);
      return false;
    }

    setEnrolledClasses((previous) => previous.map((classroom) => {
      if (classroom.id !== selectedClass.id) {
        return classroom;
      }

      return {
        ...classroom,
        assignments: classroom.assignments.map((item) => {
          if (item.id !== assignment.id) {
            return item;
          }

          return {
            ...item,
            status: STUDENT_ASSIGNMENT_STATUS.PENDING,
            submission: null,
            submittedDate: null,
            submittedFileId: null,
            submittedFileName: null,
            submittedFileSize: null,
            submittedComment: ''
          };
        })
      };
    }));

    setSubmissionPreviewAssignment(null);
    setUnsubmittingAssignmentId(null);
    return true;
  };

  return (
    <div className="student-classroom-tab">
      <div className="student-classroom-top">
        <h2>My Classes</h2>
        <div className="student-classroom-top-actions">
          <button
            type="button"
            className="student-refresh-btn"
            onClick={() => {
              void handleRefreshData();
            }}
            disabled={refreshingData}
            title="Refresh classroom data"
          >
            <i className={`fas ${refreshingData ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`}></i>
          </button>

          {!selectedClass && (
            <button type="button" className="student-join-code-btn" onClick={() => setShowJoinCodeModal(true)}>
              <i className="fas fa-key"></i>
              Join Class with Code
            </button>
          )}
        </div>
      </div>

      {loadingClasses && (
        <div className="student-classroom-empty">
          <p>Loading classes...</p>
        </div>
      )}

      {!loadingClasses && !selectedClass && (
        <div className="student-classroom-grid">
          {enrolledClasses.map((classroom) => (
            <article
              key={classroom.id}
              className="student-class-card"
              role="button"
              tabIndex={0}
              onClick={() => openClassDetail(classroom.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  openClassDetail(classroom.id);
                }
              }}
            >
              <span className={`student-class-icon ${classroom.tone}`}>
                <i className={`fas ${classroom.icon}`}></i>
              </span>

              <h3>{classroom.title}</h3>
              <p className="subject">{classroom.subject}</p>
              <p><i className="fas fa-user"></i>{classroom.teacher}</p>
              <p><i className="fas fa-clock"></i>{classroom.schedule}</p>

              <div className="student-class-card-footer">
                <span>{classroom.assignments.filter((item) => normalizeAssignmentStatus(item.status) === STUDENT_ASSIGNMENT_STATUS.PENDING).length} pending assignments</span>
                <i className="fas fa-chevron-right"></i>
              </div>
            </article>
          ))}

          {enrolledClasses.length === 0 && (
            <div className="student-classroom-empty">
              <p>No classroom enrollment found yet.</p>
            </div>
          )}
        </div>
      )}

      {selectedClass && (
        <div className="student-classroom-detail">
          <button className="student-back-link" onClick={closeClassDetail}>
            <i className="fas fa-arrow-left"></i>
            Back to Classes
          </button>

          <div className="student-detail-header">
            <h3>{selectedClass.title}</h3>
            <p>{selectedClass.subject} • {selectedClass.teacher}</p>
            <p><i className="fas fa-clock"></i> {selectedClass.schedule}</p>
          </div>

          <div className="student-detail-stats">
            <div className="materials"><strong>{selectedClassStats.materials}</strong><span>Materials</span></div>
            <div className="pending"><strong>{selectedClassStats.pending}</strong><span>Pending</span></div>
            <div className="submitted"><strong>{selectedClassStats.submitted}</strong><span>Submitted</span></div>
            <div className="graded"><strong>{selectedClassStats.graded}</strong><span>Graded</span></div>
          </div>

          <div className="student-detail-tabs">
            <button className={detailTab === 'materials' ? 'active' : ''} onClick={() => setDetailTab('materials')}>
              <i className="fas fa-file-alt"></i>
              Materials ({selectedClassStats.materials})
            </button>
            <button className={detailTab === 'assignments' ? 'active' : ''} onClick={() => setDetailTab('assignments')}>
              <i className="fas fa-list-check"></i>
              Assignments ({selectedClass.assignments.length})
            </button>
            <button className={detailTab === 'attendance' ? 'active' : ''} onClick={() => setDetailTab('attendance')}>
              <i className="fas fa-clipboard-check"></i>
              Attendance
            </button>
          </div>

          {detailTab === 'materials' && (
            <>
              <div className="student-material-toolbar">
                <label htmlFor="student-material-date-filter">Date Filter</label>
                <select
                  id="student-material-date-filter"
                  value={materialDateFilter}
                  onChange={(event) => setMaterialDateFilter(event.target.value)}
                >
                  <option value="all">All Time</option>
                  <option value="today">Today</option>
                  <option value="7days">Last 7 Days</option>
                  <option value="30days">Last 30 Days</option>
                </select>
              </div>

              <div className="student-material-list">
                {displayedMaterials.map((material) => {
                const materialDescription = getMaterialDescription(material);

                return (
                  <div key={material.id} className="student-material-row">
                    <span className="student-material-icon-sm"><i className="fas fa-file-pdf"></i></span>
                    <div className="student-material-row-meta">
                      <strong>
                        {getMaterialLabel(material)}
                        {material.isNew && <em>New</em>}
                      </strong>
                      {material.title && material.fileName && material.title !== material.fileName && (
                        <p className="student-material-description">File: {material.fileName}</p>
                      )}
                      {materialDescription && <p className="student-material-description">{materialDescription}</p>}
                      <p>{material.size} · Uploaded {material.uploadedDate}</p>
                    </div>
                    <div className="student-material-row-actions">
                      <button
                        type="button"
                        onClick={() => handlePreviewMaterial(material)}
                        title="Preview"
                        disabled={previewingMaterialId === material.id || downloadingMaterialId === material.id}
                      >
                        <i className={`fas ${previewingMaterialId === material.id ? 'fa-spinner fa-spin' : 'fa-eye'}`}></i>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadMaterial(material)}
                        title="Download"
                        disabled={previewingMaterialId === material.id || downloadingMaterialId === material.id}
                      >
                        <i className={`fas ${downloadingMaterialId === material.id ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
                      </button>
                    </div>
                  </div>
                );
                })}

                {displayedMaterials.length === 0 && (
                  <div className="student-material-row">
                    <div className="student-material-row-meta">
                      <strong>No materials found</strong>
                      <p>Try changing the date filter.</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {detailTab === 'assignments' && (
            <div className="student-assignment-list">
              {selectedClass.assignments.map((assignment) => {
                const statusLabel = normalizeAssignmentStatus(assignment.status);
                const submission = getAssignmentSubmission(assignment);
                const gradeLabel = getAssignmentGrade(assignment);

                return (
                  <article key={assignment.id} className="student-assignment-card">
                    <div className="student-assignment-card-top">
                      <div className="student-assignment-card-main">
                        <strong>{assignment.title}</strong>
                        <span className={`status ${statusLabel.toLowerCase()}`}>{statusLabel}</span>
                      </div>

                      {statusLabel === STUDENT_ASSIGNMENT_STATUS.PENDING && (
                        <button className="student-assignment-action primary" onClick={() => setSubmitAssignment(assignment)}>
                          <i className="fas fa-upload"></i>
                          Submit
                        </button>
                      )}

                      {statusLabel === STUDENT_ASSIGNMENT_STATUS.SUBMITTED && (
                        <button className="student-assignment-action awaiting" type="button">
                          <i className="fas fa-hourglass-half"></i>
                          Awaiting Grade
                        </button>
                      )}

                      {statusLabel === STUDENT_ASSIGNMENT_STATUS.GRADED && (
                        <button
                          className="student-assignment-action graded"
                          type="button"
                          onClick={() => setFeedbackAssignment(assignment)}
                        >
                          <i className="fas fa-eye"></i>
                          View Feedback
                        </button>
                      )}
                    </div>

                    {assignment.description && <p className="student-assignment-description">{assignment.description}</p>}

                    <div className="student-assignment-meta">
                      <span><i className="fas fa-calendar"></i>Due: {assignment.dueDate}</span>
                      {submission?.submittedAt && <span><i className="fas fa-check"></i>Submitted: {submission.submittedAt}</span>}
                      {gradeLabel && <span className="grade"><i className="fas fa-star"></i>Grade: {gradeLabel}</span>}
                    </div>

                    {submission?.fileName && statusLabel !== STUDENT_ASSIGNMENT_STATUS.PENDING && (
                      <button
                        type="button"
                        className="student-assignment-resource"
                        onClick={() => setSubmissionPreviewAssignment(assignment)}
                      >
                        <i className="fas fa-eye"></i>
                        <i className="fas fa-paperclip"></i>
                        {submission.fileName}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {detailTab === 'attendance' && (
            <div className="student-attendance-panel">
              <div className="student-attendance-summary-grid">
                <div className="sessions">
                  <strong>{selectedAttendanceSummary.sessions}</strong>
                  <span>Total Sessions</span>
                </div>
                <div className="present">
                  <strong>{selectedAttendanceSummary.present}</strong>
                  <span>Present</span>
                </div>
                <div className="absent">
                  <strong>{selectedAttendanceSummary.absent}</strong>
                  <span>Absent</span>
                </div>
                <div className="rate">
                  <strong>{selectedAttendanceSummary.rateLabel}</strong>
                  <span>Attendance Rate</span>
                </div>
              </div>

              <div className="student-attendance-history-list">
                {selectedAttendanceHistoryRows.length === 0 && (
                  <div className="student-attendance-history-row empty">
                    <div className="student-attendance-history-meta">
                      <strong>No attendance records yet</strong>
                      <p>Your attendance record will appear once attendance has been taken.</p>
                    </div>
                  </div>
                )}

                {selectedAttendanceHistory.length === 0 && selectedAttendanceHistoryRows.length > 0 && (
                  <div className="student-attendance-history-row empty">
                    <div className="student-attendance-history-meta">
                      <strong>Showing summary-based records</strong>
                      <p>Exact attendance dates are not available yet.</p>
                    </div>
                  </div>
                )}

                {selectedAttendanceHistoryRows.map((row) => (
                  <div key={`${selectedClass.id}-${row.date}`} className="student-attendance-history-row">
                    <div className="student-attendance-history-meta">
                      <strong>{row.date}</strong>
                      <p>{row.isEstimated ? 'Class session attendance (summary)' : 'Class session attendance'}</p>
                      <p>Taken by {row.takenBy} at {row.takenAt}</p>
                    </div>
                    <span className={`student-attendance-status ${row.isPresent ? 'present' : 'absent'}`}>
                      {row.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {previewMaterial && <PreviewMaterialModal material={previewMaterial} onClose={closePreviewMaterial} />}

      {downloadMaterial && (
        <DownloadMaterialModal
          material={downloadMaterial}
          onClose={() => setDownloadMaterial(null)}
          onConfirm={() => {}}
        />
      )}

      {submitAssignment && (
        <SubmitAssignmentModal
          assignment={submitAssignment}
          onClose={() => {
            if (!submittingAssignment) {
              setSubmitAssignment(null);
            }
          }}
          onSubmit={handleAssignmentSubmit}
          isSubmitting={submittingAssignment}
        />
      )}

      {feedbackAssignment && (
        <AssignmentFeedbackModal assignment={feedbackAssignment} onClose={() => setFeedbackAssignment(null)} />
      )}

      {submissionPreviewAssignment && (
        <SubmissionDetailsModal
          assignment={submissionPreviewAssignment}
          onClose={() => setSubmissionPreviewAssignment(null)}
          isUnsubmitting={unsubmittingAssignmentId === submissionPreviewAssignment?.id}
          onUnsubmit={(assignment) => {
            showConfirmDialog({
              title: 'Confirm Unsubmit',
              message: 'Unsubmit this assignment? You will need to submit again before due date.',
              confirmText: 'Unsubmit',
              cancelText: 'Cancel',
              onConfirm: async () => {
                await handleAssignmentUnsubmit(assignment);
              }
            });
          }}
        />
      )}

      {showJoinCodeModal && (
        <JoinClassCodeModal
          value={joinCodeInput}
          onChange={setJoinCodeInput}
          onClose={() => {
            if (joiningClass) {
              return;
            }
            setShowJoinCodeModal(false);
            setJoinCodeInput('');
          }}
          onSubmit={handleJoinClassByCode}
          isJoining={joiningClass}
        />
      )}

      <StudentDialogModal
        dialog={dialogState}
        onClose={closeDialog}
        onConfirm={handleDialogConfirm}
        isProcessing={dialogProcessing}
      />
    </div>
  );
}

export default StudentClassroomTab;
