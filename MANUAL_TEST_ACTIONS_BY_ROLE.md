# Manual Test Actions By Role

Use this as your own test script. Mark each item PASS/FAIL while testing.

## Latest Automated Smoke Result

- Run source: `backend/tmp-full-action-matrix.js`
- Artifact: `backend/tmp-full-action-matrix-output.json`
- Executed at: `2026-03-08T02:06:12.532Z`
- Last rerun totals: `69 total`, `2 pass`, `0 fail`, `67 skip`

### Current Failures

- None in latest run (`fail = 0`).

### Smoke Run Observation

- This run happened while login and password-reset rate-limit windows were active.
- Teacher/student/admin login steps returned `429` and were marked `SKIP`.
- Dependent role-authenticated actions were intentionally marked `SKIP` (token unavailable) instead of `FAIL`.
- Public password-reset request was also `SKIP` due to active `429` limiter window.

## Validation Checklist (Expected Behavior)

### Authentication and Session Validations
- Login works for teacher/student/admin with valid credentials
- Invalid credential login is rejected
- `auth/me` only works with valid session token
- Logout invalidates current session
- Accessing protected endpoint after logout is rejected
- Session may require re-login after RBAC permission updates

### Profile Validations
- Profile read endpoint returns own profile
- Phone update accepts valid phone input
- Age update accepts valid age range
- Teacher title only accepts allowed values (`Mr`, `Ms`)
- Invalid teacher title value is rejected
- Student cannot use teacher-only title update path
- Password change with wrong current password is rejected
- Profile picture upload succeeds with valid image
- Profile picture delete succeeds

### Classroom Enrollment and Capacity Validations
- Join-code enrollment only works when self-enrollment is enabled
- Invalid join code is rejected
- Join-code enrollment enforces grade-level eligibility
- Join-code enrollment enforces `maximumCapacity` strictly
- Over-capacity join returns conflict with full-classroom error
- Teacher "Manage Students" save cannot exceed `maximumCapacity`
- Over-capacity manual roster save is blocked (UI warning + API rejection)

### Classroom Data and Workflow Validations
- Teacher classroom state fetch works
- Teacher classroom state save works
- Class announcements post and retrieval work
- Student enrolled classes list contains joined classroom
- Student assignment submit works with uploaded file reference
- Student unsubmit works only when allowed
- Unsubmit after grading is rejected
- Teacher grading succeeds for valid submission
- Grading invalid submission ID is rejected

### Attendance Validations
- Attendance take/save writes per-date status map
- Attendance edit updates record metadata
- Student attendance summary shows sessions/present/absent/rate
- Student attendance rows show status per session
- New attendance records show "taken by" and "taken at"
- Edited attendance records expose updated-by/updated-at metadata
- If historical date metadata is missing, summary fallback rows render (no contradictory empty-state)

### Storage and File Validations
- Storage quota endpoint returns user quota
- Folder create/rename/delete works
- File upload/list/details/preview/download works
- File rename/content-update works
- Add file to folder and remove file from folder works
- File delete works and removed file is no longer active

### Sharing and Notification Validations
- Teacher can list recipient users for sharing
- Teacher can share file to student
- Sharing history reflects created share
- Revoke sharing removes/invalidates access
- Student shared-files list shows shared items
- Notification list returns share/activity notifications
- Mark single notification as read works
- Mark all notifications as read works

### Admin and Audit Validations
- Admin dashboard endpoints are accessible to admin only
- Storage audit logs/stats/export endpoints work
- Classroom audit logs/stats/export endpoints work
- Admin users list and user stats endpoints work
- RBAC matrix fetch/update/reset works for supported roles
- Admin classrooms list/restore archived classroom works

### RBAC and Cross-Role Security Validations
- Teacher cannot access admin-only endpoints (403)
- Student cannot access admin-only endpoints (403)
- Student cannot perform teacher-only classroom operations (deny)
- Unauthorized file operations across users are denied unless explicitly shared with permission
- Admin-role permission edits are protected according to policy (invalid operations rejected)

## Teacher Actions

### Authentication and Session
- Login as teacher
- Open dashboard after login
- Refresh page while logged in
- Logout
- Try opening protected page after logout (should redirect/deny)

### Profile
- View profile data
- Update phone number
- Update age
- Update teacher title (`Mr` or `Ms`)
- Try invalid teacher title value (should reject)
- Upload profile picture
- Delete profile picture
- Change password with wrong current password (should reject)

### Storage
- View quota
- View folders list
- Create folder
- Rename folder
- Delete folder
- Upload text file
- View files list
- Open file details
- Preview file
- Download file
- Rename file
- Edit text file content
- Add file to folder
- Remove file from folder
- Delete file

### Sharing
- Open users list for share recipients
- Share file to student
- Check sharing history
- Revoke sharing

### Classroom
- Open teacher classroom tab
- Get teacher state
- Save teacher state with changes
- Create/update classroom with join code enabled
- Post class announcement
- Grade student submission
- Try grading invalid submission id (should reject)

## Student Actions

### Authentication and Session
- Login as student
- Open dashboard after login
- Refresh page while logged in
- Logout
- Try opening protected page after logout (should redirect/deny)

### Profile
- View profile data
- Update phone number
- Update age (within allowed student range)
- Try teacher title endpoint/action (should reject)

### Storage
- View quota
- View own files list
- Upload file
- Open file details
- Preview file
- Download own file
- Delete own file

### Shared Files and Notifications
- Open shared files list
- Open notifications list
- Mark single notification as read
- Mark all notifications as read

### Classroom
- Join class using join code
- Open enrolled classes list
- Open announcements
- Upload assignment file
- Submit assignment
- Unsubmit before grading (if available in flow)
- Unsubmit after grading (should reject)

## Admin Actions

### Authentication and Session
- Login as admin
- Open admin dashboard
- Refresh page while logged in
- Logout
- Try opening protected admin page after logout (should redirect/deny)

### Audit and Monitoring
- Open storage audit logs
- Open storage audit stats
- Export storage audit logs
- Open classroom audit logs
- Open classroom audit stats
- Export classroom audit logs

### User Management
- Open users list
- Open user stats
- Create new user (teacher)
- Create new user (student with valid level)
- Edit existing user
- Reset user password
- Enroll user into classroom
- Export users CSV

### RBAC
- Open RBAC permissions matrix
- Update teacher permissions
- Reset teacher permissions to default
- Update student permissions
- Reset student permissions to default
- Try editing admin role permissions (should reject)

### Import and Export
- Download import template CSV
- Import valid CSV users
- Import invalid CSV rows (should return row errors)
- Download import errors CSV

### Classroom Admin
- Open classrooms list
- Restore archived classroom

## Cross-Role Security Checks
- Teacher cannot access admin endpoints (should return 403/deny)
- Student cannot access admin endpoints (should return 403/deny)
- Student cannot perform teacher-only classroom operations (should deny)
- User cannot rename/edit/delete files they do not own unless explicitly shared with permission
- Session invalidation behavior after RBAC changes (teacher/student may need re-login)

## Known Areas To Watch Closely
- Folder cleanup/delete flow under repeated create/add/remove/delete cycles
- Session behavior immediately after RBAC updates
- Admin login limiter behavior under rapid repeated login attempts
