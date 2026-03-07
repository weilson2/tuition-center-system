# Manual Test Actions By Role

Use this as your own test script. Mark each item PASS/FAIL while testing.

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
