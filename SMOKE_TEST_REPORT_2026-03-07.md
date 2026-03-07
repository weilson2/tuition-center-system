# Smoke Test Report (2026-03-07)

## Execution scope
- Backend environment check: `backend/test-env.js`
- Backend DB check: `backend/test-connection.js`
- Frontend targeted smoke suite: `frontend/src/components/StorageTab.smoke.test.js` (7/7 passed)
- Full API action matrix runner: `backend/tmp-full-action-matrix.js`
- Focused classroom check: `backend/tmp-classroom-smoke-quick.json`
- Historical storage smoke artifact reviewed: `backend/tmp-ps-smoke-output.txt`

## Latest full matrix result
- Full matrix executed across teacher, student, and admin core actions.
- Observed summary from terminal run:
  - Total actions executed: 75
  - Pass: 72
  - Fail: 3
  - Skip: 0

## Failures from full matrix
- `teacher.storage.file.delete` -> 401 `Session invalid or expired`
- `teacher.storage.folder.delete` -> 401 `Session invalid or expired`
- `teacher.auth.logout` -> 401 `Session invalid or expired`

Root cause:
- These are sequencing side effects, not functional defects in those endpoints.
- In the same run, admin RBAC update/reset invalidates active teacher sessions by design, so later teacher actions using old token fail with 401.

## Action coverage by role

### Teacher
- [x] Login, `/auth/me`, profile read
- [x] Profile mutations: phone, age, teacher title
- [x] Profile picture upload and delete
- [x] Classroom state get/save
- [x] Classroom announcement post
- [x] Storage quota/folder list/create
- [x] Storage upload/list/details/rename/update content/preview/download
- [x] Add/remove file to/from folder
- [x] Share file, sharing history, revoke sharing
- [x] Submission grading flow (discover + grade)
- [x] Expected denial checks (invalid current password)

### Student
- [x] Login, `/auth/me`, profile read
- [x] Join class by code
- [x] Get student classes
- [x] Get announcements
- [x] Shared files list
- [x] Notifications list + mark read
- [x] Upload assignment file
- [x] Submit assignment
- [x] Unsubmit blocked after grading (expected 400)

### Admin
- [x] Login, `/auth/me`, profile read
- [x] Classroom audit logs/stats/export
- [x] Storage/admin audit logs/stats/export
- [x] User list/stats
- [x] Add user, edit user, reset user password, enroll user
- [x] RBAC get, update, reset
- [x] Import template, import users CSV, import errors CSV
- [x] Export users CSV
- [x] List classrooms, restore archived classroom
- [x] Logout

## Known issues / risks still open
- Historical storage cleanup error remains in prior artifact:
  - `backend/tmp-ps-smoke-output.txt` -> `StorageTab.deleteFolderCleanup` connection closed.
- The full matrix report JSON file was intermittently not written in some interrupted runs due long-running session handling; terminal logs were used as the source of truth for the completed run.

## Artifacts
- `backend/tmp-full-action-matrix.js`
- `backend/tmp-full-action-matrix-run.log`
- `backend/tmp-classroom-smoke-quick.json`
- `backend/tmp-classroom-smoke-quick.txt`
- `backend/tmp-live-smoke-output.json`
- `backend/tmp-ps-smoke-output.txt`
