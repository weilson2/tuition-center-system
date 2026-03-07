Set-Location "c:\Users\User\Downloads\tuition-center-system\backend"

$base = 'http://localhost:5000/api'
$rows = @()

function Add-Result($action, $status, $detail) {
  $script:rows += [PSCustomObject]@{
    Action = $action
    Status = $status
    Detail = $detail
  }
}

function Call-Json($method, $url, $body, $token) {
  $headers = @{}
  if ($token) { $headers['Authorization'] = "Bearer $token" }

  if ($null -ne $body) {
    return Invoke-RestMethod -Method $method -Uri $url -Headers $headers -Body ($body | ConvertTo-Json -Depth 12) -ContentType 'application/json' -TimeoutSec 30
  }

  return Invoke-RestMethod -Method $method -Uri $url -Headers $headers -TimeoutSec 30
}

$teacherToken = $null
$studentToken = $null
$teacherUser = $null

try {
  $t = Call-Json 'Post' "$base/auth/login" @{ email = 'teacher@test.com'; password = 'Teacher123!'; role = 'teacher' } $null
  $teacherToken = $t.token
  $teacherUser = $t.user
  Add-Result 'teacher.login' 'PASS' 'ok'
} catch {
  Add-Result 'teacher.login' 'FAIL' $_.Exception.Message
}

try {
  $s = Call-Json 'Post' "$base/auth/login" @{ email = 'student@test.com'; password = 'Student123!'; role = 'student' } $null
  $studentToken = $s.token
  Add-Result 'student.login' 'PASS' 'ok'
} catch {
  Add-Result 'student.login' 'FAIL' $_.Exception.Message
}

try {
  $null = Call-Json 'Get' "$base/classroom/teacher/state" $null $teacherToken
  Add-Result 'teacher.state.get' 'PASS' 'ok'
} catch {
  Add-Result 'teacher.state.get' 'FAIL' $_.Exception.Message
}

try {
  $saveBody = @{
    operationType = 'teacher_state_saved'
    operationLabel = 'Teacher State Saved'
    target = 'Smoke Classroom'
    targetType = 'Classroom'
    state = @{
      classrooms = @(@{
        classroomId = 99001
        classroomName = 'Smoke Classroom'
        subject = 'Math'
        classSchedule = 'Sat 10:00'
        status = 'Active'
        gradeLevel = 'all level'
        joinCode = 'SMOKE26'
        selfEnrollmentEnabled = $true
        ownerTeacherId = $teacherUser.userId
        ownerTeacherName = $teacherUser.fullName
        coTeachers = @()
      })
      materialsByClassroom = @{ '99001' = @() }
      assignmentsByClassroom = @{ '99001' = @(@{ id = 11001; title = 'Smoke Assignment'; description = 'Smoke'; dueDate = '2026-12-31'; status = 'Pending' }) }
      studentsByClassroom = @{ '99001' = @() }
      gradingSubmissionsByAssignment = @{}
      attendanceRecordsByClassroom = @{}
      attendanceStudentStatsByClassroom = @{}
      attendanceDetailByClassroom = @{}
      archivedClassrooms = @()
    }
  }

  $null = Call-Json 'Put' "$base/classroom/teacher/state" $saveBody $teacherToken
  Add-Result 'teacher.state.save' 'PASS' 'ok'
} catch {
  Add-Result 'teacher.state.save' 'FAIL' $_.Exception.Message
}

try {
  $null = Call-Json 'Post' "$base/classroom/student/join" @{ joinCode = 'SMOKE26' } $studentToken
  Add-Result 'student.join' 'PASS' 'ok'
} catch {
  Add-Result 'student.join' 'FAIL' $_.Exception.Message
}

try {
  $classes = Call-Json 'Get' "$base/classroom/student/classes" $null $studentToken
  $count = ($classes.classes | Measure-Object).Count
  Add-Result 'student.classes.get' 'PASS' "count=$count"
} catch {
  Add-Result 'student.classes.get' 'FAIL' $_.Exception.Message
}

try {
  $null = Call-Json 'Post' "$base/classroom/announcements" @{ classroomId = 99001; classroomName = 'Smoke Classroom'; message = 'Quick smoke announcement' } $teacherToken
  Add-Result 'teacher.announcement.post' 'PASS' 'ok'
} catch {
  Add-Result 'teacher.announcement.post' 'FAIL' $_.Exception.Message
}

try {
  $ann = Call-Json 'Get' "$base/classroom/announcements" $null $studentToken
  $keys = ($ann.announcementsByClassroom.PSObject.Properties.Name -join ',')
  Add-Result 'student.announcement.get' 'PASS' "classrooms=$keys"
} catch {
  Add-Result 'student.announcement.get' 'FAIL' $_.Exception.Message
}

try {
  $null = Call-Json 'Get' "$base/classroom/audit-logs" $null $teacherToken
  Add-Result 'teacher.classroom.audit.logs' 'PASS' 'ok'
} catch {
  Add-Result 'teacher.classroom.audit.logs' 'FAIL' $_.Exception.Message
}

$rows | Format-Table -AutoSize | Out-String | Set-Content -Path '.\tmp-classroom-smoke-quick.txt'
$rows | ConvertTo-Json -Depth 5 | Set-Content -Path '.\tmp-classroom-smoke-quick.json'
$rows | Format-Table -AutoSize
