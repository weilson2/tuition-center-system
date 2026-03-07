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

function Invoke-Json($method, $url, $body, $token) {
  $headers = @{}
  if ($token) { $headers['Authorization'] = "Bearer $token" }

  if ($null -ne $body) {
    return Invoke-RestMethod -Method $method -Uri $url -Headers $headers -Body ($body | ConvertTo-Json -Depth 12) -ContentType 'application/json' -TimeoutSec 30
  }

  return Invoke-RestMethod -Method $method -Uri $url -Headers $headers -TimeoutSec 30
}

$teacherToken = $null
$studentToken = $null
$teacherId = $null
$fileId = $null
$folderId = $null
$sharingId = $null
$notificationId = $null

try {
  $t = Invoke-Json 'Post' "$base/auth/login" @{ email = 'teacher@test.com'; password = 'Teacher123!'; role = 'teacher' } $null
  $teacherToken = $t.token
  $teacherId = $t.user.userId
  Add-Result 'teacher.login' 'PASS' 'ok'
} catch {
  Add-Result 'teacher.login' 'FAIL' $_.Exception.Message
}

try {
  $s = Invoke-Json 'Post' "$base/auth/login" @{ email = 'student@test.com'; password = 'Student123!'; role = 'student' } $null
  $studentToken = $s.token
  Add-Result 'student.login' 'PASS' 'ok'
} catch {
  Add-Result 'student.login' 'FAIL' $_.Exception.Message
}

try {
  $q = Invoke-Json 'Get' "$base/storage/quota" $null $teacherToken
  Add-Result 'storage.quota' 'PASS' "used=$($q.used)"
} catch {
  Add-Result 'storage.quota' 'FAIL' $_.Exception.Message
}

try {
  $f = Invoke-Json 'Get' "$base/storage/folders" $null $teacherToken
  Add-Result 'storage.folders.list' 'PASS' "count=$(($f.folders | Measure-Object).Count)"
} catch {
  Add-Result 'storage.folders.list' 'FAIL' $_.Exception.Message
}

try {
  $newFolder = Invoke-Json 'Post' "$base/storage/folders" @{ folderName = "Smoke Folder $(Get-Date -Format yyyyMMddHHmmss)" } $teacherToken
  $folderId = $newFolder.folder.folder_id
  Add-Result 'storage.folder.create' 'PASS' "folderId=$folderId"
} catch {
  Add-Result 'storage.folder.create' 'FAIL' $_.Exception.Message
}

try {
  $files = Invoke-Json 'Get' "$base/storage/files" $null $teacherToken
  $fileId = ($files.files | Select-Object -First 1).file_id
  if ($fileId) {
    Add-Result 'storage.files.list' 'PASS' "pickedFileId=$fileId"
  } else {
    Add-Result 'storage.files.list' 'FAIL' 'No file available for detail/share flow'
  }
} catch {
  Add-Result 'storage.files.list' 'FAIL' $_.Exception.Message
}

if ($fileId) {
  try {
    $null = Invoke-Json 'Get' "$base/storage/files/$fileId" $null $teacherToken
    Add-Result 'storage.file.details' 'PASS' 'ok'
  } catch {
    Add-Result 'storage.file.details' 'FAIL' $_.Exception.Message
  }

  try {
    $hist = Invoke-Json 'Get' "$base/storage/files/$fileId/sharing-history" $null $teacherToken
    Add-Result 'storage.sharing.history' 'PASS' "count=$(($hist.sharingHistory | Measure-Object).Count)"
  } catch {
    Add-Result 'storage.sharing.history' 'FAIL' $_.Exception.Message
  }

  try {
    $users = Invoke-Json 'Get' "$base/users" $null $teacherToken
    $recipient = $users.users | Where-Object { $_.user_id -ne $teacherId } | Select-Object -First 1
    if ($recipient) {
      $null = Invoke-Json 'Post' "$base/storage/share" @{ fileIds = @($fileId); recipientIds = @($recipient.user_id); permission = 'all' } $teacherToken
      Add-Result 'storage.file.share' 'PASS' "recipient=$($recipient.user_id)"

      $hist2 = Invoke-Json 'Get' "$base/storage/files/$fileId/sharing-history" $null $teacherToken
      $sharingId = ($hist2.sharingHistory | Select-Object -First 1).sharing_id
      if ($sharingId) {
        $null = Invoke-Json 'Delete' "$base/storage/sharing/$sharingId" $null $teacherToken
        Add-Result 'storage.share.revoke' 'PASS' "sharingId=$sharingId"
      } else {
        Add-Result 'storage.share.revoke' 'FAIL' 'No sharingId available after share'
      }
    } else {
      Add-Result 'storage.file.share' 'FAIL' 'No recipient available'
      Add-Result 'storage.share.revoke' 'FAIL' 'No recipient available'
    }
  } catch {
    Add-Result 'storage.file.share' 'FAIL' $_.Exception.Message
  }
} else {
  Add-Result 'storage.file.details' 'FAIL' 'No file id'
  Add-Result 'storage.sharing.history' 'FAIL' 'No file id'
  Add-Result 'storage.file.share' 'FAIL' 'No file id'
  Add-Result 'storage.share.revoke' 'FAIL' 'No file id'
}

try {
  $shared = Invoke-Json 'Get' "$base/storage/files/shared" $null $studentToken
  Add-Result 'student.sharedFiles.list' 'PASS' "count=$(($shared.files | Measure-Object).Count)"
} catch {
  Add-Result 'student.sharedFiles.list' 'FAIL' $_.Exception.Message
}

try {
  $notif = Invoke-Json 'Get' "$base/storage/notifications" $null $studentToken
  $notificationId = ($notif.notifications | Select-Object -First 1).notification_id
  Add-Result 'student.notifications.list' 'PASS' "count=$(($notif.notifications | Measure-Object).Count)"

  if ($notificationId) {
    $null = Invoke-Json 'Put' "$base/storage/notifications/$notificationId/read" $null $studentToken
    Add-Result 'student.notifications.markRead' 'PASS' "notificationId=$notificationId"
  } else {
    Add-Result 'student.notifications.markRead' 'FAIL' 'No notification to mark read'
  }
} catch {
  Add-Result 'student.notifications.list' 'FAIL' $_.Exception.Message
  Add-Result 'student.notifications.markRead' 'FAIL' $_.Exception.Message
}

if ($folderId) {
  try {
    $null = Invoke-Json 'Delete' "$base/storage/folders/$folderId" $null $teacherToken
    Add-Result 'storage.folder.delete' 'PASS' "folderId=$folderId"
  } catch {
    Add-Result 'storage.folder.delete' 'FAIL' $_.Exception.Message
  }
} else {
  Add-Result 'storage.folder.delete' 'FAIL' 'No folder id'
}

$rows | Format-Table -AutoSize | Out-String | Set-Content -Path '.\tmp-storage-smoke-quick.txt'
$rows | ConvertTo-Json -Depth 5 | Set-Content -Path '.\tmp-storage-smoke-quick.json'
$rows | Format-Table -AutoSize
