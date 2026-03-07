const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:5000/api';
const REQUEST_TIMEOUT_MS = Number(process.env.SMOKE_REQUEST_TIMEOUT_MS || 25000);
const ACTION_TIMEOUT_MS = Number(process.env.SMOKE_ACTION_TIMEOUT_MS || 35000);

const creds = {
  teacher: { email: 'teacher@test.com', password: 'Teacher123!', role: 'teacher' },
  student: { email: 'student@test.com', password: 'Student123!', role: 'student' },
  admin: { email: 'admin@test.com', password: 'Admin123!', role: 'admin' }
};

const state = {
  tokens: {},
  users: {},
  ids: {
    classroomId: 99001,
    assignmentId: 11001,
    teacherFolderId: null,
    teacherFileId: null,
    studentSubmissionFileId: null,
    sharingId: null,
    notificationId: null,
    submissionId: null,
    createdUserId: null,
    createdUserEmail: null,
    importedUserEmail: null
  },
  joinCode: 'SMOKE26',
  report: []
};

function logLine(level, text) {
  console.log(`${level} | ${text}`);
}

function addResult(role, action, status, message, httpStatus = null) {
  state.report.push({ role, action, status, message, httpStatus, timestamp: new Date().toISOString() });
  const code = httpStatus !== null ? ` [${httpStatus}]` : '';
  logLine(status, `${role}.${action}${code} | ${message}`);
}

async function apiRequest(method, endpoint, { token, body, headers, responseType = 'auto' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const requestHeaders = { ...(headers || {}) };
  let requestBody;

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
      const err = new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms (${method} ${endpoint})`);
      err.status = 0;
      throw err;
    }
    throw error;
  }

  let data;
  try {
    if (responseType === 'text') {
      data = await res.text();
    } else {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        data = await res.json();
      } else {
        data = await res.text();
      }
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      const err = new Error(`Response timeout after ${REQUEST_TIMEOUT_MS}ms (${method} ${endpoint})`);
      err.status = 0;
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  return { ok: res.ok, status: res.status, data };
}

function ensureStatus(res, expected, fallbackMessage) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (allowed.includes(res.status)) {
    return res;
  }
  const msg = (res.data && (res.data.error || res.data.message)) || fallbackMessage || `Unexpected status ${res.status}`;
  const err = new Error(msg);
  err.status = res.status;
  throw err;
}

async function runAction(role, action, fn) {
  let timer = null;
  const label = `${role}.${action}`;

  const guarded = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Action timed out after ${ACTION_TIMEOUT_MS}ms (${label})`);
      err.status = 0;
      reject(err);
    }, ACTION_TIMEOUT_MS);

    Promise.resolve()
      .then(fn)
      .then(resolve)
      .catch(reject);
  });

  try {
    const payload = await guarded;
    addResult(role, action, 'PASS', payload?.message || 'ok', payload?.httpStatus ?? null);
    return payload;
  } catch (error) {
    addResult(role, action, 'FAIL', error?.message || String(error), error?.status ?? null);
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function skipAction(role, action, reason) {
  addResult(role, action, 'SKIP', reason, null);
}

function makeTinyPngBlob() {
  const tinyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2W2XkAAAAASUVORK5CYII=';
  const bytes = Buffer.from(tinyPngBase64, 'base64');
  return new Blob([bytes], { type: 'image/png' });
}

(async () => {
  logLine('INFO', `Running full matrix against ${BASE_URL}`);

  await runAction('system', 'health', async () => {
    const res = await apiRequest('GET', '/health');
    ensureStatus(res, 200, 'Health failed');
    return { message: 'health ok', httpStatus: res.status };
  });

  for (const role of ['teacher', 'student', 'admin']) {
    await runAction(role, 'auth.login', async () => {
      const res = await apiRequest('POST', '/auth/login', { body: creds[role] });
      ensureStatus(res, 200, `Login failed: ${role}`);
      state.tokens[role] = res.data.token;
      state.users[role] = res.data.user;
      return { message: `login ok (${res.data.user?.email || role})`, httpStatus: res.status };
    });

    await runAction(role, 'auth.me', async () => {
      const res = await apiRequest('GET', '/auth/me', { token: state.tokens[role] });
      ensureStatus(res, 200, 'auth.me failed');
      return { message: 'auth.me ok', httpStatus: res.status };
    });

    await runAction(role, 'profile.me', async () => {
      const res = await apiRequest('GET', '/profile/me', { token: state.tokens[role] });
      ensureStatus(res, 200, 'profile.me failed');
      return { message: 'profile.me ok', httpStatus: res.status };
    });
  }

  await runAction('teacher', 'profile.phone.update', async () => {
    const res = await apiRequest('PUT', '/profile/phone', {
      token: state.tokens.teacher,
      body: { phone_number: '0123456789' }
    });
    ensureStatus(res, 200, 'phone update failed');
    return { message: 'phone updated', httpStatus: res.status };
  });

  await runAction('teacher', 'profile.age.update', async () => {
    const res = await apiRequest('PUT', '/profile/age', {
      token: state.tokens.teacher,
      body: { age: 30 }
    });
    ensureStatus(res, 200, 'age update failed');
    return { message: 'age updated', httpStatus: res.status };
  });

  await runAction('teacher', 'profile.teacherTitle.update', async () => {
    const res = await apiRequest('PUT', '/profile/teacher-title', {
      token: state.tokens.teacher,
      body: { teacherTitle: 'Mr' }
    });
    ensureStatus(res, 200, 'teacher title update failed');
    return { message: 'teacher title updated', httpStatus: res.status };
  });

  await runAction('student', 'profile.teacherTitle.forbidden', async () => {
    const res = await apiRequest('PUT', '/profile/teacher-title', {
      token: state.tokens.student,
      body: { teacherTitle: 'Ms' }
    });
    ensureStatus(res, [403, 400], 'expected teacher-title denial for student');
    return { message: 'expected denial confirmed', httpStatus: res.status };
  });

  await runAction('teacher', 'profile.password.change.invalidCurrent', async () => {
    const res = await apiRequest('POST', '/profile/change-password', {
      token: state.tokens.teacher,
      body: {
        currentPassword: 'WrongCurrent123!',
        newPassword: 'AnotherPass123!',
        confirmPassword: 'AnotherPass123!'
      }
    });
    ensureStatus(res, 401, 'expected invalid current password');
    return { message: 'invalid-current protection works', httpStatus: res.status };
  });

  await runAction('teacher', 'profile.picture.upload', async () => {
    const form = new FormData();
    form.append('profilePicture', makeTinyPngBlob(), 'tiny.png');
    const res = await apiRequest('POST', '/profile/profile-picture', {
      token: state.tokens.teacher,
      body: form
    });
    ensureStatus(res, 200, 'profile picture upload failed');
    return { message: 'profile picture uploaded', httpStatus: res.status };
  });

  await runAction('teacher', 'profile.picture.delete', async () => {
    const res = await apiRequest('DELETE', '/profile/profile-picture', {
      token: state.tokens.teacher
    });
    ensureStatus(res, 200, 'profile picture delete failed');
    return { message: 'profile picture deleted', httpStatus: res.status };
  });

  await runAction('public', 'passwordReset.request', async () => {
    const res = await apiRequest('POST', '/password-reset/request', {
      body: { email: 'teacher@test.com' }
    });
    ensureStatus(res, 200, 'password reset request failed');
    const token = res.data?.resetToken;
    if (token) {
      state.resetToken = token;
    }
    return { message: token ? 'request ok + token returned (test mode)' : 'request ok', httpStatus: res.status };
  });

  if (state.resetToken) {
    await runAction('public', 'passwordReset.verify', async () => {
      const res = await apiRequest('GET', `/password-reset/verify/${state.resetToken}`);
      ensureStatus(res, 200, 'reset token verify failed');
      return { message: 'reset token verified', httpStatus: res.status };
    });
  } else {
    skipAction('public', 'passwordReset.verify', 'No reset token returned by request endpoint');
  }

  await runAction('teacher', 'classroom.state.get', async () => {
    const res = await apiRequest('GET', '/classroom/teacher/state', { token: state.tokens.teacher });
    ensureStatus(res, 200, 'teacher state get failed');
    return { message: 'teacher state fetched', httpStatus: res.status };
  });

  await runAction('teacher', 'classroom.state.save', async () => {
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
        materialsByClassroom: { [String(state.ids.classroomId)]: [] },
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
        studentsByClassroom: { [String(state.ids.classroomId)]: [] },
        gradingSubmissionsByAssignment: {},
        attendanceRecordsByClassroom: {},
        attendanceStudentStatsByClassroom: {},
        attendanceDetailByClassroom: {},
        archivedClassrooms: []
      }
    };

    const res = await apiRequest('PUT', '/classroom/teacher/state', {
      token: state.tokens.teacher,
      body
    });
    ensureStatus(res, 200, 'teacher state save failed');
    return { message: 'teacher state saved', httpStatus: res.status };
  });

  await runAction('student', 'classroom.join', async () => {
    const res = await apiRequest('POST', '/classroom/student/join', {
      token: state.tokens.student,
      body: { joinCode: state.joinCode }
    });
    ensureStatus(res, [200, 409], 'student join failed');
    return { message: res.status === 200 ? 'joined class' : 'already joined', httpStatus: res.status };
  });

  await runAction('student', 'classroom.classes.get', async () => {
    const res = await apiRequest('GET', '/classroom/student/classes', { token: state.tokens.student });
    ensureStatus(res, 200, 'student classes get failed');
    return { message: `classes=${Array.isArray(res.data?.classes) ? res.data.classes.length : 0}`, httpStatus: res.status };
  });

  await runAction('teacher', 'classroom.announcement.post', async () => {
    const res = await apiRequest('POST', '/classroom/announcements', {
      token: state.tokens.teacher,
      body: {
        classroomId: state.ids.classroomId,
        classroomName: 'Smoke Classroom',
        message: 'Smoke announcement from matrix run'
      }
    });
    ensureStatus(res, 201, 'announcement post failed');
    return { message: 'announcement posted', httpStatus: res.status };
  });

  await runAction('student', 'classroom.announcement.get', async () => {
    const res = await apiRequest('GET', '/classroom/announcements', { token: state.tokens.student });
    ensureStatus(res, 200, 'announcement get failed');
    return { message: 'announcements fetched', httpStatus: res.status };
  });

  await runAction('teacher', 'storage.quota', async () => {
    const res = await apiRequest('GET', '/storage/quota', { token: state.tokens.teacher });
    ensureStatus(res, 200, 'quota failed');
    return { message: 'quota ok', httpStatus: res.status };
  });

  await runAction('teacher', 'storage.folders.list', async () => {
    const res = await apiRequest('GET', '/storage/folders', { token: state.tokens.teacher });
    ensureStatus(res, 200, 'folders list failed');
    return { message: 'folders listed', httpStatus: res.status };
  });

  await runAction('teacher', 'storage.folder.create', async () => {
    const res = await apiRequest('POST', '/storage/folders', {
      token: state.tokens.teacher,
      body: { folderName: `Smoke Folder ${Date.now()}` }
    });
    ensureStatus(res, 200, 'create folder failed');
    state.ids.teacherFolderId = Number(res.data?.folder?.folder_id);
    return { message: `folderId=${state.ids.teacherFolderId || 'n/a'}`, httpStatus: res.status };
  });

  await runAction('teacher', 'storage.file.upload', async () => {
    const form = new FormData();
    const name = `smoke-${Date.now()}.txt`;
    form.append('file', new Blob([`matrix content ${Date.now()}`], { type: 'text/plain' }), name);
    if (state.ids.teacherFolderId) {
      form.append('folderId', String(state.ids.teacherFolderId));
    }

    const res = await apiRequest('POST', '/storage/upload', {
      token: state.tokens.teacher,
      body: form
    });
    ensureStatus(res, 200, 'upload failed');
    state.ids.teacherFileId = Number(res.data?.file?.file_id);
    return { message: `fileId=${state.ids.teacherFileId || 'n/a'}`, httpStatus: res.status };
  });

  await runAction('teacher', 'storage.files.list', async () => {
    const res = await apiRequest('GET', '/storage/files', { token: state.tokens.teacher });
    ensureStatus(res, 200, 'files list failed');
    return { message: `files=${Array.isArray(res.data?.files) ? res.data.files.length : 0}`, httpStatus: res.status };
  });

  if (state.ids.teacherFileId) {
    await runAction('teacher', 'storage.file.details', async () => {
      const res = await apiRequest('GET', `/storage/files/${state.ids.teacherFileId}`, { token: state.tokens.teacher });
      ensureStatus(res, 200, 'file details failed');
      return { message: 'details ok', httpStatus: res.status };
    });

    await runAction('teacher', 'storage.file.rename', async () => {
      const res = await apiRequest('PUT', `/storage/files/${state.ids.teacherFileId}/rename`, {
        token: state.tokens.teacher,
        body: { filename: `matrix-renamed-${Date.now()}.txt` }
      });
      ensureStatus(res, 200, 'rename failed');
      return { message: 'renamed', httpStatus: res.status };
    });

    await runAction('teacher', 'storage.file.updateContent', async () => {
      const res = await apiRequest('PUT', `/storage/files/${state.ids.teacherFileId}/content`, {
        token: state.tokens.teacher,
        body: { content: `matrix updated ${Date.now()}` }
      });
      ensureStatus(res, 200, 'content update failed');
      return { message: 'content updated', httpStatus: res.status };
    });

    await runAction('teacher', 'storage.file.preview', async () => {
      const res = await apiRequest('GET', `/storage/files/${state.ids.teacherFileId}/preview`, { token: state.tokens.teacher });
      ensureStatus(res, 200, 'preview failed');
      return { message: 'preview ok', httpStatus: res.status };
    });

    await runAction('teacher', 'storage.file.download', async () => {
      const res = await apiRequest('GET', `/storage/files/${state.ids.teacherFileId}/download`, {
        token: state.tokens.teacher,
        responseType: 'text'
      });
      ensureStatus(res, 200, 'download failed');
      return { message: 'download ok', httpStatus: res.status };
    });

    await runAction('teacher', 'storage.folder.addFile', async () => {
      if (!state.ids.teacherFolderId) {
        throw Object.assign(new Error('No folder id available'), { status: 0 });
      }
      const res = await apiRequest('POST', `/storage/folders/${state.ids.teacherFolderId}/files`, {
        token: state.tokens.teacher,
        body: { fileIds: [state.ids.teacherFileId] }
      });
      ensureStatus(res, 200, 'add file to folder failed');
      return { message: 'file added to folder', httpStatus: res.status };
    });

    await runAction('teacher', 'storage.folder.removeFile', async () => {
      if (!state.ids.teacherFolderId) {
        throw Object.assign(new Error('No folder id available'), { status: 0 });
      }
      const res = await apiRequest('DELETE', `/storage/folders/${state.ids.teacherFolderId}/files`, {
        token: state.tokens.teacher,
        body: { fileIds: [state.ids.teacherFileId] }
      });
      ensureStatus(res, 200, 'remove file from folder failed');
      return { message: 'file removed from folder', httpStatus: res.status };
    });

    await runAction('teacher', 'users.list', async () => {
      const res = await apiRequest('GET', '/users', { token: state.tokens.teacher });
      ensureStatus(res, 200, 'users list failed');
      const users = Array.isArray(res.data?.users) ? res.data.users : [];
      const recipient = users.find((x) => Number(x.user_id) !== Number(state.users.teacher?.userId));
      state.shareRecipientId = recipient ? Number(recipient.user_id) : null;
      return { message: `users=${users.length}`, httpStatus: res.status };
    });

    if (state.shareRecipientId) {
      await runAction('teacher', 'storage.file.share', async () => {
        const res = await apiRequest('POST', '/storage/share', {
          token: state.tokens.teacher,
          body: {
            fileIds: [state.ids.teacherFileId],
            recipientIds: [state.shareRecipientId],
            permission: 'all'
          }
        });
        ensureStatus(res, 200, 'share failed');
        return { message: 'shared', httpStatus: res.status };
      });

      await runAction('teacher', 'storage.sharingHistory', async () => {
        const res = await apiRequest('GET', `/storage/files/${state.ids.teacherFileId}/sharing-history`, {
          token: state.tokens.teacher
        });
        ensureStatus(res, 200, 'sharing history failed');
        const rows = Array.isArray(res.data?.sharingHistory) ? res.data.sharingHistory : [];
        const first = rows[0];
        state.ids.sharingId = first ? Number(first.sharing_id || first.sharingId) : null;
        return { message: `history=${rows.length}`, httpStatus: res.status };
      });

      await runAction('student', 'storage.sharedFiles.list', async () => {
        const res = await apiRequest('GET', '/storage/files/shared', { token: state.tokens.student });
        ensureStatus(res, 200, 'shared files list failed');
        return { message: 'shared files listed', httpStatus: res.status };
      });

      await runAction('student', 'storage.notifications.list', async () => {
        const res = await apiRequest('GET', '/storage/notifications', { token: state.tokens.student });
        ensureStatus(res, 200, 'notifications list failed');
        const list = Array.isArray(res.data?.notifications) ? res.data.notifications : [];
        const first = list[0];
        state.ids.notificationId = first ? Number(first.notification_id || first.notificationId) : null;
        return { message: `notifications=${list.length}`, httpStatus: res.status };
      });

      if (state.ids.notificationId) {
        await runAction('student', 'storage.notification.markRead', async () => {
          const res = await apiRequest('PUT', `/storage/notifications/${state.ids.notificationId}/read`, {
            token: state.tokens.student
          });
          ensureStatus(res, 200, 'mark read failed');
          return { message: 'notification read', httpStatus: res.status };
        });
      } else {
        skipAction('student', 'storage.notification.markRead', 'No notification id');
      }

      if (state.ids.sharingId) {
        await runAction('teacher', 'storage.share.revoke', async () => {
          const res = await apiRequest('DELETE', `/storage/sharing/${state.ids.sharingId}`, {
            token: state.tokens.teacher
          });
          ensureStatus(res, 200, 'revoke failed');
          return { message: 'sharing revoked', httpStatus: res.status };
        });
      } else {
        skipAction('teacher', 'storage.share.revoke', 'No sharing id');
      }
    } else {
      skipAction('teacher', 'storage.file.share', 'No recipient');
      skipAction('teacher', 'storage.sharingHistory', 'No recipient');
      skipAction('student', 'storage.sharedFiles.list', 'No recipient');
      skipAction('student', 'storage.notifications.list', 'No recipient');
      skipAction('student', 'storage.notification.markRead', 'No recipient');
      skipAction('teacher', 'storage.share.revoke', 'No recipient');
    }
  } else {
    skipAction('teacher', 'storage.file.details', 'No file id');
    skipAction('teacher', 'storage.file.rename', 'No file id');
    skipAction('teacher', 'storage.file.updateContent', 'No file id');
    skipAction('teacher', 'storage.file.preview', 'No file id');
    skipAction('teacher', 'storage.file.download', 'No file id');
    skipAction('teacher', 'storage.folder.addFile', 'No file id');
    skipAction('teacher', 'storage.folder.removeFile', 'No file id');
    skipAction('teacher', 'users.list', 'No file id');
    skipAction('teacher', 'storage.file.share', 'No file id');
    skipAction('teacher', 'storage.sharingHistory', 'No file id');
    skipAction('student', 'storage.sharedFiles.list', 'No file id');
    skipAction('student', 'storage.notifications.list', 'No file id');
    skipAction('student', 'storage.notification.markRead', 'No file id');
    skipAction('teacher', 'storage.share.revoke', 'No file id');
  }

  await runAction('student', 'storage.file.upload.forSubmission', async () => {
    const form = new FormData();
    form.append('file', new Blob([`submission ${Date.now()}`], { type: 'text/plain' }), `submission-${Date.now()}.txt`);
    const res = await apiRequest('POST', '/storage/upload', {
      token: state.tokens.student,
      body: form
    });
    ensureStatus(res, 200, 'student upload failed');
    state.ids.studentSubmissionFileId = Number(res.data?.file?.file_id);
    return { message: `fileId=${state.ids.studentSubmissionFileId || 'n/a'}`, httpStatus: res.status };
  });

  if (state.ids.studentSubmissionFileId) {
    await runAction('student', 'classroom.assignment.submit', async () => {
      const res = await apiRequest('POST', `/classroom/student/classrooms/${state.ids.classroomId}/assignments/${state.ids.assignmentId}/submit`, {
        token: state.tokens.student,
        body: {
          classroomId: state.ids.classroomId,
          fileId: state.ids.studentSubmissionFileId,
          fileName: `submission-${Date.now()}.txt`,
          fileSize: '128',
          comment: 'matrix submit'
        }
      });
      ensureStatus(res, 200, 'assignment submit failed');
      return { message: 'assignment submitted', httpStatus: res.status };
    });

    await runAction('teacher', 'classroom.submission.discover', async () => {
      const res = await apiRequest('GET', '/classroom/teacher/state', {
        token: state.tokens.teacher
      });
      ensureStatus(res, 200, 'teacher state for discover failed');
      const map = res.data?.state?.gradingSubmissionsByAssignment || {};
      const rows = map[String(state.ids.assignmentId)] || map[state.ids.assignmentId] || [];
      const first = Array.isArray(rows) ? rows[0] : null;
      state.ids.submissionId = first ? Number(first.submissionId || first.submission_id || first.id) : null;
      if (!state.ids.submissionId) {
        const err = new Error('submission id not found for grading');
        err.status = 0;
        throw err;
      }
      return { message: `submissionId=${state.ids.submissionId}`, httpStatus: res.status };
    });

    if (state.ids.submissionId) {
      await runAction('teacher', 'classroom.submission.grade', async () => {
        const res = await apiRequest('PUT', `/classroom/teacher/classrooms/${state.ids.classroomId}/assignments/${state.ids.assignmentId}/submissions/${state.ids.submissionId}/grade`, {
          token: state.tokens.teacher,
          body: { grade: 85, feedback: 'matrix feedback' }
        });
        ensureStatus(res, 200, 'grade failed');
        return { message: 'graded', httpStatus: res.status };
      });

      await runAction('student', 'classroom.assignment.unsubmit.forbiddenAfterGrade', async () => {
        const res = await apiRequest('POST', `/classroom/student/classrooms/${state.ids.classroomId}/assignments/${state.ids.assignmentId}/unsubmit`, {
          token: state.tokens.student,
          body: { classroomId: state.ids.classroomId }
        });
        ensureStatus(res, 400, 'expected graded unsubmit rejection');
        return { message: 'graded unsubmit blocked as expected', httpStatus: res.status };
      });
    }
  }

  await runAction('admin', 'classroom.audit.logs', async () => {
    const res = await apiRequest('GET', '/classroom/audit-logs', { token: state.tokens.admin });
    ensureStatus(res, 200, 'admin classroom audit logs failed');
    return { message: 'classroom audit logs ok', httpStatus: res.status };
  });

  await runAction('admin', 'classroom.audit.stats', async () => {
    const res = await apiRequest('GET', '/classroom/audit-stats', { token: state.tokens.admin });
    ensureStatus(res, 200, 'admin classroom audit stats failed');
    return { message: 'classroom audit stats ok', httpStatus: res.status };
  });

  await runAction('admin', 'classroom.audit.export', async () => {
    const res = await apiRequest('GET', '/classroom/audit-logs/export', {
      token: state.tokens.admin,
      responseType: 'text'
    });
    ensureStatus(res, 200, 'admin classroom audit export failed');
    return { message: 'classroom audit export ok', httpStatus: res.status };
  });

  await runAction('admin', 'admin.audit.logs', async () => {
    const res = await apiRequest('GET', '/admin/audit-logs', { token: state.tokens.admin });
    ensureStatus(res, 200, 'admin audit logs failed');
    return { message: 'admin audit logs ok', httpStatus: res.status };
  });

  await runAction('admin', 'admin.audit.stats', async () => {
    const res = await apiRequest('GET', '/admin/audit-stats', { token: state.tokens.admin });
    ensureStatus(res, 200, 'admin audit stats failed');
    return { message: 'admin audit stats ok', httpStatus: res.status };
  });

  await runAction('admin', 'admin.audit.export', async () => {
    const res = await apiRequest('GET', '/admin/audit-logs/export', {
      token: state.tokens.admin,
      responseType: 'text'
    });
    ensureStatus(res, 200, 'admin audit export failed');
    return { message: 'admin audit export ok', httpStatus: res.status };
  });

  await runAction('admin', 'admin.users.list', async () => {
    const res = await apiRequest('GET', '/admin/users', { token: state.tokens.admin });
    ensureStatus(res, 200, 'admin users list failed');
    return { message: 'admin users list ok', httpStatus: res.status };
  });

  await runAction('admin', 'admin.users.stats', async () => {
    const res = await apiRequest('GET', '/admin/users/stats', { token: state.tokens.admin });
    ensureStatus(res, 200, 'admin users stats failed');
    return { message: 'admin users stats ok', httpStatus: res.status };
  });

  await runAction('admin', 'admin.user.create', async () => {
    const email = `matrix.user.${Date.now()}@test.com`;
    const res = await apiRequest('POST', '/admin/users', {
      token: state.tokens.admin,
      body: {
        email,
        fullName: 'Matrix User',
        role: 'student',
        temporaryPassword: 'Matrix123!Pass',
        studentLevel: 'Standard 3'
      }
    });
    ensureStatus(res, 201, 'admin create user failed');
    state.ids.createdUserId = Number(res.data?.user?.user_id);
    state.ids.createdUserEmail = email;
    return { message: `createdUserId=${state.ids.createdUserId || 'n/a'}`, httpStatus: res.status };
  });

  if (state.ids.createdUserId) {
    await runAction('admin', 'admin.user.edit', async () => {
      const res = await apiRequest('PUT', `/admin/users/${state.ids.createdUserId}`, {
        token: state.tokens.admin,
        body: {
          fullName: 'Matrix User Updated',
          email: state.ids.createdUserEmail,
          role: 'student',
          status: 'active',
          studentLevel: 'Standard 4'
        }
      });
      ensureStatus(res, 200, 'admin edit user failed');
      return { message: 'user edited', httpStatus: res.status };
    });

    await runAction('admin', 'admin.user.resetPassword', async () => {
      const res = await apiRequest('POST', `/admin/users/${state.ids.createdUserId}/reset-password`, {
        token: state.tokens.admin
      });
      ensureStatus(res, 200, 'admin reset password failed');
      return { message: 'password reset triggered', httpStatus: res.status };
    });

    await runAction('admin', 'admin.user.enroll', async () => {
      const res = await apiRequest('POST', '/admin/users/enroll', {
        token: state.tokens.admin,
        body: {
          userIds: [state.ids.createdUserId],
          targetType: 'classroom',
          targetId: state.ids.classroomId
        }
      });
      ensureStatus(res, [200, 207], 'admin enroll user failed');
      return { message: 'enroll call completed', httpStatus: res.status };
    });
  } else {
    skipAction('admin', 'admin.user.edit', 'No created user id');
    skipAction('admin', 'admin.user.resetPassword', 'No created user id');
    skipAction('admin', 'admin.user.enroll', 'No created user id');
  }

  await runAction('admin', 'admin.rbac.get', async () => {
    const res = await apiRequest('GET', '/admin/rbac', { token: state.tokens.admin });
    ensureStatus(res, 200, 'rbac get failed');
    state.rbacMatrix = res.data?.matrix || {};
    return { message: 'rbac get ok', httpStatus: res.status };
  });

  await runAction('admin', 'admin.rbac.update.teacher', async () => {
    const teacherPerms = state.rbacMatrix?.teacher || {
      classroom: ['read', 'update', 'execute'],
      storage: ['create', 'read', 'update'],
      profile: ['read', 'update']
    };
    const res = await apiRequest('PUT', '/admin/rbac', {
      token: state.tokens.admin,
      body: {
        role: 'teacher',
        permissionsByModule: teacherPerms,
        confirm: true
      }
    });
    ensureStatus(res, 200, 'rbac update failed');
    return { message: 'rbac updated', httpStatus: res.status };
  });

  await runAction('admin', 'admin.rbac.reset.teacher', async () => {
    const res = await apiRequest('POST', '/admin/rbac/reset/teacher', {
      token: state.tokens.admin
    });
    ensureStatus(res, 200, 'rbac reset failed');
    return { message: 'rbac reset teacher', httpStatus: res.status };
  });

  await runAction('teacher', 'auth.relogin.afterRbac', async () => {
    const res = await apiRequest('POST', '/auth/login', {
      body: { ...creds.teacher }
    });
    ensureStatus(res, 200, 'teacher relogin after rbac failed');
    state.tokens.teacher = res.data?.token;
    state.users.teacher = res.data?.user;
    return { message: 'teacher session refreshed', httpStatus: res.status };
  });

  await runAction('admin', 'admin.import.template', async () => {
    const res = await apiRequest('GET', '/admin/users/import/template', {
      token: state.tokens.admin,
      responseType: 'text'
    });
    ensureStatus(res, 200, 'import template failed');
    return { message: 'import template downloaded', httpStatus: res.status };
  });

  await runAction('admin', 'admin.import.users', async () => {
    const email = `matrix.import.${Date.now()}@test.com`;
    state.ids.importedUserEmail = email;
    const csv = [
      'email,full_name,role,status,student_level,phone_number,temporary_password',
      `${email},Matrix Import User,Student,Active,Standard 2,0122222222,Matrix123!Pass`
    ].join('\n');

    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'matrix-import.csv');

    const res = await apiRequest('POST', '/admin/users/import', {
      token: state.tokens.admin,
      body: form
    });
    ensureStatus(res, 200, 'import users failed');
    return { message: 'users import completed', httpStatus: res.status };
  });

  await runAction('admin', 'admin.import.errors.csv', async () => {
    const res = await apiRequest('POST', '/admin/users/import/errors', {
      token: state.tokens.admin,
      body: {
        failedRows: [
          { row: 2, email: 'bad-email', reason: 'Invalid email format' }
        ]
      },
      responseType: 'text'
    });
    ensureStatus(res, 200, 'import errors csv failed');
    return { message: 'import errors csv generated', httpStatus: res.status };
  });

  await runAction('admin', 'admin.users.export', async () => {
    const res = await apiRequest('GET', '/admin/users/export?mode=filtered&role=student', {
      token: state.tokens.admin,
      responseType: 'text'
    });
    ensureStatus(res, 200, 'users export failed');
    return { message: 'users export ok', httpStatus: res.status };
  });

  await runAction('admin', 'admin.classrooms.list', async () => {
    const res = await apiRequest('GET', '/admin/classrooms', { token: state.tokens.admin });
    ensureStatus(res, 200, 'admin classrooms list failed');
    const rows = Array.isArray(res.data?.classrooms) ? res.data.classrooms : [];
    state.archivedClassroom = rows.find((row) => String(row?.status || '').toLowerCase() === 'archived');
    return { message: `classrooms=${rows.length}`, httpStatus: res.status };
  });

  if (state.archivedClassroom?.classroomId && state.archivedClassroom?.ownerTeacherId) {
    await runAction('admin', 'admin.classroom.restore', async () => {
      const res = await apiRequest('POST', `/admin/classrooms/${state.archivedClassroom.classroomId}/restore`, {
        token: state.tokens.admin,
        body: { ownerTeacherId: state.archivedClassroom.ownerTeacherId }
      });
      ensureStatus(res, 200, 'admin classroom restore failed');
      return { message: 'archived classroom restored', httpStatus: res.status };
    });
  } else {
    skipAction('admin', 'admin.classroom.restore', 'No archived classroom available');
  }

  if (state.ids.teacherFileId) {
    await runAction('teacher', 'storage.file.delete', async () => {
      const res = await apiRequest('DELETE', `/storage/files/${state.ids.teacherFileId}`, {
        token: state.tokens.teacher
      });
      ensureStatus(res, 200, 'delete file failed');
      return { message: 'file deleted', httpStatus: res.status };
    });
  }

  if (state.ids.teacherFolderId) {
    await runAction('teacher', 'storage.folder.delete', async () => {
      const res = await apiRequest('DELETE', `/storage/folders/${state.ids.teacherFolderId}`, {
        token: state.tokens.teacher
      });
      ensureStatus(res, 200, 'folder delete failed');
      return { message: 'folder deleted', httpStatus: res.status };
    });
  }

  for (const role of ['teacher', 'student', 'admin']) {
    await runAction(role, 'auth.logout', async () => {
      const res = await apiRequest('POST', '/auth/logout', { token: state.tokens[role] });
      ensureStatus(res, 200, 'logout failed');
      return { message: 'logout ok', httpStatus: res.status };
    });
  }

  const totals = {
    total: state.report.length,
    pass: state.report.filter((x) => x.status === 'PASS').length,
    fail: state.report.filter((x) => x.status === 'FAIL').length,
    skip: state.report.filter((x) => x.status === 'SKIP').length
  };

  const output = {
    baseUrl: BASE_URL,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    actionTimeoutMs: ACTION_TIMEOUT_MS,
    executedAt: new Date().toISOString(),
    totals,
    results: state.report
  };

  const outPath = path.join(__dirname, 'tmp-full-action-matrix-output.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  logLine('INFO', `SUMMARY total=${totals.total} pass=${totals.pass} fail=${totals.fail} skip=${totals.skip}`);
  logLine('INFO', `REPORT ${outPath}`);

  if (totals.fail > 0) {
    process.exitCode = 1;
  }
})();
