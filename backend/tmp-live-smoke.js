const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:5000/api';

const credentials = {
  teacher: { email: 'teacher@test.com', password: 'Teacher123!', role: 'teacher' },
  student: { email: 'student@test.com', password: 'Student123!', role: 'student' },
  admin: { email: 'admin@test.com', password: 'Admin123!', role: 'admin' }
};

const results = [];

function pushResult(role, action, status, message, httpStatus = null) {
  results.push({ role, action, status, message, httpStatus, timestamp: new Date().toISOString() });
  const badge = status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : 'FAIL';
  const code = httpStatus ? ` [${httpStatus}]` : '';
  console.log(`${badge} | ${role} | ${action}${code} | ${message}`);
}

async function apiRequest(method, endpoint, { token, body, headers } = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.SMOKE_REQUEST_TIMEOUT_MS || 20000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const requestHeaders = { ...(headers || {}) };
  let requestBody = undefined;

  if (body instanceof FormData) {
    requestBody = body;
  } else if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}${endpoint}`, {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Request timed out after ${timeoutMs}ms (${method} ${endpoint})`);
      timeoutError.status = 0;
      throw timeoutError;
    }
    throw error;
  }

  const contentType = res.headers.get('content-type') || '';
  let data = null;

  try {
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Response body timed out after ${timeoutMs}ms (${method} ${endpoint})`);
      timeoutError.status = 0;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  return { ok: res.ok, status: res.status, data };
}

async function runAction(role, action, fn) {
  try {
    const payload = await fn();
    const msg = payload?.message || 'ok';
    const httpStatus = payload?.status || null;
    pushResult(role, action, 'PASS', msg, httpStatus);
    return payload;
  } catch (error) {
    const status = error?.status || null;
    const msg = error?.message || String(error);
    pushResult(role, action, 'FAIL', msg, status);
    return null;
  }
}

function requireOk(response, fallbackMessage) {
  if (!response.ok) {
    const message = (response.data && (response.data.error || response.data.message)) || fallbackMessage;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return response;
}

function skipAction(role, action, reason) {
  pushResult(role, action, 'SKIP', reason);
}

(async () => {
  const state = {
    tokens: {},
    users: {},
    ids: {
      teacherFolderId: null,
      teacherFileId: null,
      sharedRecipientId: null,
      sharingId: null,
      notificationId: null,
      classroomId: 99001,
      assignmentId: 11001,
      submissionId: null,
      studentSubmissionFileId: null
    },
    joinCode: 'SMOKE26'
  };

  await runAction('system', 'health', async () => {
    const res = await apiRequest('GET', '/health');
    requireOk(res, 'Health check failed');
    return { status: res.status, message: 'health ok' };
  });

  for (const role of ['teacher', 'student', 'admin']) {
    await runAction(role, 'auth.login', async () => {
      const res = await apiRequest('POST', '/auth/login', { body: credentials[role] });
      requireOk(res, `Login failed for ${role}`);
      state.tokens[role] = res.data.token;
      state.users[role] = res.data.user;
      return { status: res.status, message: `login ok (${res.data.user?.email || role})` };
    });

    await runAction(role, 'auth.me', async () => {
      const res = await apiRequest('GET', '/auth/me', { token: state.tokens[role] });
      requireOk(res, 'auth.me failed');
      return { status: res.status, message: 'auth.me ok' };
    });

    await runAction(role, 'profile.me', async () => {
      const res = await apiRequest('GET', '/profile/me', { token: state.tokens[role] });
      requireOk(res, 'profile.me failed');
      return { status: res.status, message: 'profile.me ok' };
    });
  }

  await runAction('teacher', 'classroom.teacher.state.get', async () => {
    const res = await apiRequest('GET', '/classroom/teacher/state', { token: state.tokens.teacher });
    requireOk(res, 'teacher state get failed');
    return { status: res.status, message: 'teacher state fetched' };
  });

  await runAction('teacher', 'classroom.teacher.state.save', async () => {
    const body = {
      operationType: 'teacher_state_saved',
      operationLabel: 'Teacher State Saved',
      target: 'Smoke Classroom',
      targetType: 'Classroom',
      state: {
        classrooms: [
          {
            classroomId: state.ids.classroomId,
            classroomName: 'Smoke Classroom',
            subject: 'Mathematics',
            classSchedule: 'Saturday 10:00',
            status: 'Active',
            gradeLevel: 'all level',
            joinCode: state.joinCode,
            selfEnrollmentEnabled: true,
            ownerTeacherId: state.users.teacher?.userId,
            ownerTeacherName: state.users.teacher?.fullName || 'Teacher User',
            coTeachers: []
          }
        ],
        materialsByClassroom: {
          [String(state.ids.classroomId)]: []
        },
        assignmentsByClassroom: {
          [String(state.ids.classroomId)]: [
            {
              id: state.ids.assignmentId,
              title: 'Smoke Assignment',
              description: 'Basic smoke assignment',
              dueDate: '2026-12-31',
              status: 'Pending'
            }
          ]
        },
        studentsByClassroom: {
          [String(state.ids.classroomId)]: []
        },
        gradingSubmissionsByAssignment: {},
        attendanceRecordsByClassroom: {},
        attendanceStudentStatsByClassroom: {},
        attendanceDetailByClassroom: {},
        archivedClassrooms: []
      }
    };

    const res = await apiRequest('PUT', '/classroom/teacher/state', { token: state.tokens.teacher, body });
    requireOk(res, 'teacher state save failed');
    return { status: res.status, message: 'teacher state saved' };
  });

  await runAction('student', 'classroom.student.classes.get.beforeJoin', async () => {
    const res = await apiRequest('GET', '/classroom/student/classes', { token: state.tokens.student });
    requireOk(res, 'student classes fetch failed');
    return { status: res.status, message: `classes returned (${Array.isArray(res.data?.classes) ? res.data.classes.length : 0})` };
  });

  await runAction('student', 'classroom.student.join', async () => {
    const res = await apiRequest('POST', '/classroom/student/join', {
      token: state.tokens.student,
      body: { joinCode: state.joinCode }
    });
    requireOk(res, 'student join failed');
    return { status: res.status, message: 'student joined class' };
  });

  await runAction('student', 'classroom.student.classes.get.afterJoin', async () => {
    const res = await apiRequest('GET', '/classroom/student/classes', { token: state.tokens.student });
    requireOk(res, 'student classes fetch failed');
    const classes = Array.isArray(res.data?.classes) ? res.data.classes : [];
    const hasSmokeClass = classes.some((entry) => Number(entry.classroomId) === state.ids.classroomId);
    if (!hasSmokeClass) {
      const err = new Error('joined class not visible in student classes');
      err.status = res.status;
      throw err;
    }
    return { status: res.status, message: 'joined class visible' };
  });

  await runAction('teacher', 'classroom.announcement.post', async () => {
    const res = await apiRequest('POST', '/classroom/announcements', {
      token: state.tokens.teacher,
      body: {
        classroomId: state.ids.classroomId,
        classroomName: 'Smoke Classroom',
        message: 'Smoke announcement from teacher'
      }
    });
    requireOk(res, 'announcement post failed');
    return { status: res.status, message: 'announcement posted' };
  });

  await runAction('student', 'classroom.announcement.get', async () => {
    const res = await apiRequest('GET', '/classroom/announcements', { token: state.tokens.student });
    requireOk(res, 'announcement fetch failed');
    return { status: res.status, message: 'announcements fetched' };
  });

  await runAction('teacher', 'storage.quota', async () => {
    const res = await apiRequest('GET', '/storage/quota', { token: state.tokens.teacher });
    requireOk(res, 'storage quota failed');
    return { status: res.status, message: 'quota fetched' };
  });

  await runAction('teacher', 'storage.folders.list', async () => {
    const res = await apiRequest('GET', '/storage/folders', { token: state.tokens.teacher });
    requireOk(res, 'folders list failed');
    return { status: res.status, message: 'folders listed' };
  });

  await runAction('teacher', 'storage.folder.create', async () => {
    const res = await apiRequest('POST', '/storage/folders', {
      token: state.tokens.teacher,
      body: { folderName: `Smoke Folder ${Date.now()}` }
    });
    requireOk(res, 'folder create failed');
    state.ids.teacherFolderId = Number(res.data?.folder?.folder_id);
    return { status: res.status, message: `folder created (${state.ids.teacherFolderId || 'unknown'})` };
  });

  await runAction('teacher', 'storage.file.upload', async () => {
    const form = new FormData();
    const nowTag = Date.now();
    form.append('file', new Blob([`smoke content ${nowTag}`], { type: 'text/plain' }), `smoke-${nowTag}.txt`);
    if (state.ids.teacherFolderId) {
      form.append('folderId', String(state.ids.teacherFolderId));
    }

    const res = await apiRequest('POST', '/storage/upload', {
      token: state.tokens.teacher,
      body: form
    });
    requireOk(res, 'file upload failed');
    state.ids.teacherFileId = Number(res.data?.file?.file_id);
    return { status: res.status, message: `file uploaded (${state.ids.teacherFileId || 'unknown'})` };
  });

  await runAction('teacher', 'storage.files.list', async () => {
    const res = await apiRequest('GET', '/storage/files', { token: state.tokens.teacher });
    requireOk(res, 'my files list failed');
    return { status: res.status, message: 'my files listed' };
  });

  if (state.ids.teacherFileId) {
    await runAction('teacher', 'storage.file.details', async () => {
      const res = await apiRequest('GET', `/storage/files/${state.ids.teacherFileId}`, { token: state.tokens.teacher });
      requireOk(res, 'file details failed');
      return { status: res.status, message: 'file details ok' };
    });

    await runAction('teacher', 'storage.file.rename', async () => {
      const res = await apiRequest('PUT', `/storage/files/${state.ids.teacherFileId}/rename`, {
        token: state.tokens.teacher,
        body: { filename: `smoke-renamed-${Date.now()}.txt` }
      });
      requireOk(res, 'rename failed');
      return { status: res.status, message: 'file renamed' };
    });

    await runAction('teacher', 'storage.file.updateContent', async () => {
      const res = await apiRequest('PUT', `/storage/files/${state.ids.teacherFileId}/content`, {
        token: state.tokens.teacher,
        body: { content: `updated smoke content ${Date.now()}` }
      });
      requireOk(res, 'update content failed');
      return { status: res.status, message: 'file content updated' };
    });

    await runAction('teacher', 'storage.file.preview', async () => {
      const res = await apiRequest('GET', `/storage/files/${state.ids.teacherFileId}/preview`, { token: state.tokens.teacher });
      requireOk(res, 'preview failed');
      return { status: res.status, message: 'preview ok' };
    });

    await runAction('teacher', 'storage.file.download', async () => {
      const res = await apiRequest('GET', `/storage/files/${state.ids.teacherFileId}/download`, { token: state.tokens.teacher });
      requireOk(res, 'download failed');
      return { status: res.status, message: 'download ok' };
    });

    await runAction('teacher', 'users.list.forSharing', async () => {
      const res = await apiRequest('GET', '/users', { token: state.tokens.teacher });
      requireOk(res, 'users list failed');
      const users = Array.isArray(res.data?.users) ? res.data.users : [];
      const recipient = users.find((u) => Number(u.user_id) !== Number(state.users.teacher?.userId));
      if (!recipient) {
        const err = new Error('no recipient available for share');
        err.status = res.status;
        throw err;
      }
      state.ids.sharedRecipientId = Number(recipient.user_id);
      return { status: res.status, message: `share recipient selected (${state.ids.sharedRecipientId})` };
    });

    if (state.ids.sharedRecipientId) {
      await runAction('teacher', 'storage.file.share', async () => {
        const res = await apiRequest('POST', '/storage/share', {
          token: state.tokens.teacher,
          body: {
            fileIds: [state.ids.teacherFileId],
            recipientIds: [state.ids.sharedRecipientId],
            permission: 'all'
          }
        });
        requireOk(res, 'share failed');
        return { status: res.status, message: 'file shared' };
      });

      await runAction('teacher', 'storage.sharingHistory', async () => {
        const res = await apiRequest('GET', `/storage/files/${state.ids.teacherFileId}/sharing-history`, { token: state.tokens.teacher });
        requireOk(res, 'sharing history failed');
        const rows = Array.isArray(res.data?.sharingHistory) ? res.data.sharingHistory : [];
        const first = rows[0] || null;
        state.ids.sharingId = first ? Number(first.sharing_id || first.sharingId) : null;
        return { status: res.status, message: `sharing history fetched (${rows.length})` };
      });

      await runAction('student', 'storage.sharedFiles.list', async () => {
        const res = await apiRequest('GET', '/storage/files/shared', { token: state.tokens.student });
        requireOk(res, 'shared files list failed');
        return { status: res.status, message: 'shared files listed' };
      });

      await runAction('student', 'storage.notifications.list', async () => {
        const res = await apiRequest('GET', '/storage/notifications', { token: state.tokens.student });
        requireOk(res, 'notifications failed');
        const notifications = Array.isArray(res.data?.notifications) ? res.data.notifications : [];
        const first = notifications[0] || null;
        state.ids.notificationId = first ? Number(first.notification_id || first.notificationId) : null;
        return { status: res.status, message: `notifications fetched (${notifications.length})` };
      });

      if (state.ids.notificationId) {
        await runAction('student', 'storage.notification.markRead', async () => {
          const res = await apiRequest('PUT', `/storage/notifications/${state.ids.notificationId}/read`, {
            token: state.tokens.student
          });
          requireOk(res, 'mark notification read failed');
          return { status: res.status, message: 'notification marked read' };
        });
      } else {
        skipAction('student', 'storage.notification.markRead', 'No notification id resolved');
      }

      if (state.ids.sharingId) {
        await runAction('teacher', 'storage.share.revoke', async () => {
          const res = await apiRequest('DELETE', `/storage/sharing/${state.ids.sharingId}`, { token: state.tokens.teacher });
          requireOk(res, 'revoke sharing failed');
          return { status: res.status, message: 'sharing revoked' };
        });
      } else {
        skipAction('teacher', 'storage.share.revoke', 'No sharing id resolved from sharing history');
      }
    } else {
      skipAction('teacher', 'storage.file.share', 'No recipient id available');
      skipAction('teacher', 'storage.sharingHistory', 'No recipient id available');
      skipAction('student', 'storage.sharedFiles.list', 'No share created');
      skipAction('student', 'storage.notifications.list', 'No share created');
      skipAction('student', 'storage.notification.markRead', 'No share created');
      skipAction('teacher', 'storage.share.revoke', 'No share created');
    }

    await runAction('teacher', 'storage.file.delete', async () => {
      const res = await apiRequest('DELETE', `/storage/files/${state.ids.teacherFileId}`, { token: state.tokens.teacher });
      requireOk(res, 'delete file failed');
      return { status: res.status, message: 'file deleted' };
    });
  } else {
    skipAction('teacher', 'storage.file.details', 'No uploaded file id');
    skipAction('teacher', 'storage.file.rename', 'No uploaded file id');
    skipAction('teacher', 'storage.file.updateContent', 'No uploaded file id');
    skipAction('teacher', 'storage.file.preview', 'No uploaded file id');
    skipAction('teacher', 'storage.file.download', 'No uploaded file id');
    skipAction('teacher', 'users.list.forSharing', 'No uploaded file id');
    skipAction('teacher', 'storage.file.share', 'No uploaded file id');
    skipAction('teacher', 'storage.sharingHistory', 'No uploaded file id');
    skipAction('student', 'storage.sharedFiles.list', 'No uploaded file id');
    skipAction('student', 'storage.notifications.list', 'No uploaded file id');
    skipAction('student', 'storage.notification.markRead', 'No uploaded file id');
    skipAction('teacher', 'storage.share.revoke', 'No uploaded file id');
    skipAction('teacher', 'storage.file.delete', 'No uploaded file id');
  }

  if (state.ids.teacherFolderId) {
    await runAction('teacher', 'storage.folder.delete', async () => {
      const res = await apiRequest('DELETE', `/storage/folders/${state.ids.teacherFolderId}`, { token: state.tokens.teacher });
      requireOk(res, 'delete folder failed');
      return { status: res.status, message: 'folder deleted' };
    });
  } else {
    skipAction('teacher', 'storage.folder.delete', 'No folder id available');
  }

  await runAction('student', 'storage.file.upload.forAssignment', async () => {
    const form = new FormData();
    const nowTag = Date.now();
    form.append('file', new Blob([`student assignment ${nowTag}`], { type: 'text/plain' }), `student-assignment-${nowTag}.txt`);

    const res = await apiRequest('POST', '/storage/upload', {
      token: state.tokens.student,
      body: form
    });
    requireOk(res, 'student upload for assignment failed');
    state.ids.studentSubmissionFileId = Number(res.data?.file?.file_id);
    return { status: res.status, message: `student assignment file uploaded (${state.ids.studentSubmissionFileId || 'unknown'})` };
  });

  if (state.ids.studentSubmissionFileId) {
    await runAction('student', 'classroom.assignment.submit', async () => {
      const res = await apiRequest('POST', `/classroom/student/classrooms/${state.ids.classroomId}/assignments/${state.ids.assignmentId}/submit`, {
        token: state.tokens.student,
        body: {
          classroomId: state.ids.classroomId,
          fileId: state.ids.studentSubmissionFileId,
          fileName: 'student-submission.txt',
          fileSize: '128',
          comment: 'smoke submission'
        }
      });
      requireOk(res, 'assignment submit failed');
      return { status: res.status, message: 'assignment submitted' };
    });

    await runAction('teacher', 'classroom.teacher.state.get.afterSubmit', async () => {
      const res = await apiRequest('GET', '/classroom/teacher/state', { token: state.tokens.teacher });
      requireOk(res, 'teacher state get after submit failed');
      const gradingMap = res.data?.state?.gradingSubmissionsByAssignment || {};
      const rows = gradingMap[String(state.ids.assignmentId)] || gradingMap[state.ids.assignmentId] || [];
      const first = Array.isArray(rows) ? rows[0] : null;
      const resolved = first ? Number(first.submissionId || first.submission_id || first.id) : null;
      if (!resolved) {
        const err = new Error('submission id not found in grading map after submit');
        err.status = res.status;
        throw err;
      }
      state.ids.submissionId = resolved;
      return { status: res.status, message: `submission discovered (${state.ids.submissionId})` };
    });

    if (state.ids.submissionId) {
      await runAction('teacher', 'classroom.submission.grade', async () => {
        const res = await apiRequest('PUT', `/classroom/teacher/classrooms/${state.ids.classroomId}/assignments/${state.ids.assignmentId}/submissions/${state.ids.submissionId}/grade`, {
          token: state.tokens.teacher,
          body: { grade: 88, feedback: 'smoke grading feedback' }
        });
        requireOk(res, 'grade submission failed');
        return { status: res.status, message: 'submission graded' };
      });
    } else {
      skipAction('teacher', 'classroom.submission.grade', 'No submission id resolved');
    }
  } else {
    skipAction('student', 'classroom.assignment.submit', 'No student submission file id');
    skipAction('teacher', 'classroom.teacher.state.get.afterSubmit', 'No student submission file id');
    skipAction('teacher', 'classroom.submission.grade', 'No student submission file id');
  }

  await runAction('admin', 'classroom.audit.logs', async () => {
    const res = await apiRequest('GET', '/classroom/audit-logs', { token: state.tokens.admin });
    requireOk(res, 'classroom audit logs failed');
    return { status: res.status, message: 'classroom audit logs fetched' };
  });

  await runAction('admin', 'classroom.audit.stats', async () => {
    const res = await apiRequest('GET', '/classroom/audit-stats', { token: state.tokens.admin });
    requireOk(res, 'classroom audit stats failed');
    return { status: res.status, message: 'classroom audit stats fetched' };
  });

  await runAction('admin', 'classroom.audit.export', async () => {
    const res = await apiRequest('GET', '/classroom/audit-logs/export', { token: state.tokens.admin });
    requireOk(res, 'classroom audit export failed');
    return { status: res.status, message: 'classroom audit export fetched' };
  });

  await runAction('admin', 'admin.audit.logs', async () => {
    const res = await apiRequest('GET', '/admin/audit-logs', { token: state.tokens.admin });
    requireOk(res, 'admin audit logs failed');
    return { status: res.status, message: 'admin audit logs fetched' };
  });

  await runAction('admin', 'admin.audit.stats', async () => {
    const res = await apiRequest('GET', '/admin/audit-stats', { token: state.tokens.admin });
    requireOk(res, 'admin audit stats failed');
    return { status: res.status, message: 'admin audit stats fetched' };
  });

  await runAction('admin', 'admin.audit.export', async () => {
    const res = await apiRequest('GET', '/admin/audit-logs/export', { token: state.tokens.admin });
    requireOk(res, 'admin audit export failed');
    return { status: res.status, message: 'admin audit export fetched' };
  });

  await runAction('admin', 'admin.users.list', async () => {
    const res = await apiRequest('GET', '/admin/users', { token: state.tokens.admin });
    requireOk(res, 'admin users list failed');
    return { status: res.status, message: 'admin users listed' };
  });

  await runAction('admin', 'admin.users.stats', async () => {
    const res = await apiRequest('GET', '/admin/users/stats', { token: state.tokens.admin });
    requireOk(res, 'admin users stats failed');
    return { status: res.status, message: 'admin users stats fetched' };
  });

  await runAction('admin', 'admin.rbac.get', async () => {
    const res = await apiRequest('GET', '/admin/rbac', { token: state.tokens.admin });
    requireOk(res, 'admin rbac fetch failed');
    return { status: res.status, message: 'admin rbac fetched' };
  });

  await runAction('admin', 'admin.classrooms.list', async () => {
    const res = await apiRequest('GET', '/admin/classrooms', { token: state.tokens.admin });
    requireOk(res, 'admin classrooms list failed');
    return { status: res.status, message: 'admin classrooms listed' };
  });

  for (const role of ['teacher', 'student', 'admin']) {
    await runAction(role, 'auth.logout', async () => {
      const res = await apiRequest('POST', '/auth/logout', { token: state.tokens[role] });
      requireOk(res, 'logout failed');
      return { status: res.status, message: 'logout ok' };
    });
  }

  const totals = {
    total: results.length,
    pass: results.filter((x) => x.status === 'PASS').length,
    fail: results.filter((x) => x.status === 'FAIL').length,
    skip: results.filter((x) => x.status === 'SKIP').length
  };

  const output = {
    baseUrl: BASE_URL,
    executedAt: new Date().toISOString(),
    totals,
    results
  };

  const outJson = path.join(__dirname, 'tmp-live-smoke-output.json');
  fs.writeFileSync(outJson, JSON.stringify(output, null, 2));

  console.log('\n=== LIVE SMOKE SUMMARY ===');
  console.log(`Total: ${totals.total}, Pass: ${totals.pass}, Fail: ${totals.fail}, Skip: ${totals.skip}`);
  console.log(`Report: ${outJson}`);

  if (totals.fail > 0) {
    process.exitCode = 1;
  }
})();
