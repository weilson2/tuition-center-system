$backendPath = 'c:\Users\IvanYeoh\Desktop\tuition-center-system\tuition-center-system\backend\controllers\storageController.js'
$frontendPath = 'c:\Users\IvanYeoh\Desktop\tuition-center-system\tuition-center-system\frontend\src\components\FileShareModal.js'

$backend = (Get-Content -Raw $backendPath).Replace("`r`n", "`n")
$frontend = (Get-Content -Raw $frontendPath).Replace("`r`n", "`n")

$backend = $backend.Replace(
"let sharingNotificationColumnsEnsured = false;`n",
"let sharingNotificationColumnsEnsured = false;`nlet sharingPermissionColumnsEnsured = false;`n`nconst SHARE_PERMISSION_PRESETS = {`n  all: { canDownload: true, canEdit: true, canRename: true },`n  download: { canDownload: true, canEdit: false, canRename: false },`n  edit: { canDownload: true, canEdit: true, canRename: false },`n  rename: { canDownload: false, canEdit: false, canRename: true }`n};`n"
)

$backend = $backend.Replace(
"// Share files with recipients`nasync function shareFiles(req, res) {",
"function normalizeSharePermissionPreset(preset) {`n  const normalized = String(preset || 'all').trim().toLowerCase();`n  return Object.prototype.hasOwnProperty.call(SHARE_PERMISSION_PRESETS, normalized)`n    ? normalized`n    : 'all';`n}`n`nfunction resolveSharePermissions(preset) {`n  const normalizedPreset = normalizeSharePermissionPreset(preset);`n  return {`n    preset: normalizedPreset,`n    ...SHARE_PERMISSION_PRESETS[normalizedPreset]`n  };`n}`n`n// Share files with recipients`nasync function shareFiles(req, res) {"
)

$backend = $backend.Replace(
"    await client.query('BEGIN');`n    await ensureSharingNotificationColumns(client);`n    `n    const { fileIds, recipientIds } = req.body;`n    const userId = req.user.userId;`n    const shareBatchId = crypto.randomUUID();",
"    await client.query('BEGIN');`n    await ensureSharingNotificationColumns(client);`n    await ensureSharingPermissionColumns(client);`n    `n    const { fileIds, recipientIds } = req.body;`n    const userId = req.user.userId;`n    const shareBatchId = crypto.randomUUID();`n    const sharePermissions = resolveSharePermissions(req.body?.permission || req.body?.sharePermission || 'all');"
)

$backend = $backend.Replace(
"    console.log('📤 Share request:', { fileIds, recipientIds, userId });",
"    console.log('📤 Share request:', {`n      fileIds,`n      recipientIds,`n      userId,`n      permission: sharePermissions.preset`n    });"
)

$backend = $backend.Replace(
"          `INSERT INTO file_sharings (file_id, sharer_user_id, recipient_user_id, shared_at, is_active)`n           VALUES ($1, $2, $3, CURRENT_TIMESTAMP, true)`n           ON CONFLICT (file_id, sharer_user_id, recipient_user_id) `n           DO UPDATE SET is_active = true, shared_at = CURRENT_TIMESTAMP`n           RETURNING sharing_id`,`n          [fileId, userId, recipientId]",
"          `INSERT INTO file_sharings (`n             file_id, sharer_user_id, recipient_user_id, shared_at, is_active,`n             can_download, can_edit, can_rename`n           )`n           VALUES ($1, $2, $3, CURRENT_TIMESTAMP, true, $4, $5, $6)`n           ON CONFLICT (file_id, sharer_user_id, recipient_user_id) `n           DO UPDATE SET`n             is_active = true,`n             shared_at = CURRENT_TIMESTAMP,`n             can_download = EXCLUDED.can_download,`n             can_edit = EXCLUDED.can_edit,`n             can_rename = EXCLUDED.can_rename`n           RETURNING sharing_id`,`n          [`n            fileId,`n            userId,`n            recipientId,`n            sharePermissions.canDownload,`n            sharePermissions.canEdit,`n            sharePermissions.canRename`n          ]"
)

$backend = $backend.Replace(
"          notification_count: notificationCount`n        }),",
"          notification_count: notificationCount,`n          permission: sharePermissions.preset,`n          can_download: sharePermissions.canDownload,`n          can_edit: sharePermissions.canEdit,`n          can_rename: sharePermissions.canRename`n        }),"
)

$backend = $backend.Replace(
"      recipientsNotified: normalizedRecipientIds.length,`n      sharedAt: new Date().toISOString()`n    });",
"      recipientsNotified: normalizedRecipientIds.length,`n      sharedAt: new Date().toISOString(),`n      permission: sharePermissions.preset,`n      permissions: {`n        canDownload: sharePermissions.canDownload,`n        canEdit: sharePermissions.canEdit,`n        canRename: sharePermissions.canRename`n      }`n    });"
)

$backend = $backend.Replace(
"async function ensureSharingNotificationColumns(clientLike = pool) {`n  if (sharingNotificationColumnsEnsured) {`n    return;`n  }`n`n  try {`n    await clientLike.query('ALTER TABLE sharing_notifications ADD COLUMN IF NOT EXISTS notification_group_id VARCHAR(80)');`n    await clientLike.query('CREATE INDEX IF NOT EXISTS idx_sharing_notifications_group ON sharing_notifications(notification_group_id)');`n  } catch (error) {`n    console.warn('Failed to ensure sharing notification columns:', error?.message || error);`n  } finally {`n    sharingNotificationColumnsEnsured = true;`n  }`n}`n",
"async function ensureSharingNotificationColumns(clientLike = pool) {`n  if (sharingNotificationColumnsEnsured) {`n    return;`n  }`n`n  try {`n    await clientLike.query('ALTER TABLE sharing_notifications ADD COLUMN IF NOT EXISTS notification_group_id VARCHAR(80)');`n    await clientLike.query('CREATE INDEX IF NOT EXISTS idx_sharing_notifications_group ON sharing_notifications(notification_group_id)');`n  } catch (error) {`n    console.warn('Failed to ensure sharing notification columns:', error?.message || error);`n  } finally {`n    sharingNotificationColumnsEnsured = true;`n  }`n}`n`nasync function ensureSharingPermissionColumns(clientLike = pool) {`n  if (sharingPermissionColumnsEnsured) {`n    return;`n  }`n`n  try {`n    await clientLike.query('ALTER TABLE file_sharings ADD COLUMN IF NOT EXISTS can_download BOOLEAN DEFAULT true');`n    await clientLike.query('ALTER TABLE file_sharings ADD COLUMN IF NOT EXISTS can_edit BOOLEAN DEFAULT true');`n    await clientLike.query('ALTER TABLE file_sharings ADD COLUMN IF NOT EXISTS can_rename BOOLEAN DEFAULT true');`n`n    await clientLike.query('UPDATE file_sharings SET can_download = true WHERE can_download IS NULL');`n    await clientLike.query('UPDATE file_sharings SET can_edit = true WHERE can_edit IS NULL');`n    await clientLike.query('UPDATE file_sharings SET can_rename = true WHERE can_rename IS NULL');`n  } catch (error) {`n    console.warn('Failed to ensure sharing permission columns:', error?.message || error);`n  } finally {`n    sharingPermissionColumnsEnsured = true;`n  }`n}`n"
)

$frontend = $frontend.Replace(
"  const [currentUserRole, setCurrentUserRole] = useState('student');`n",
"  const [currentUserRole, setCurrentUserRole] = useState('student');`n  const [sharePermission, setSharePermission] = useState('all');`n"
)

$frontend = $frontend.Replace(
"  const handleShare = async () => {",
"  const permissionOptions = [`n    { value: 'all', label: 'All', description: 'Allow download, edit, and rename.' },`n    { value: 'download', label: 'Download only', description: 'Allow download and preview only.' },`n    { value: 'edit', label: 'Edit', description: 'Allow editing text files (includes preview/download).' },`n    { value: 'rename', label: 'Rename only', description: 'Allow renaming only.' }`n  ];`n`n  const selectedPermissionMeta = permissionOptions.find((option) => option.value === sharePermission) || permissionOptions[0];`n`n  const handleShare = async () => {"
)

$frontend = $frontend.Replace(
"          recipientIds: selectedUsers`n",
"          recipientIds: selectedUsers,`n          permission: sharePermission`n"
)

$frontend = $frontend.Replace(
"                  {/* Selected count */}",
"                  <div className=\"permission-selector\">`n                    <p className=\"permission-selector-title\">Recipient permission</p>`n                    <div className=\"permission-option-list\">`n                      {permissionOptions.map((option) => (`n                        <label`n                          key={option.value}`n                          className={`permission-option ${sharePermission === option.value ? 'active' : ''}`}`n                        >`n                          <input`n                            type=\"radio\"`n                            name=\"sharePermission\"`n                            value={option.value}`n                            checked={sharePermission === option.value}`n                            onChange={() => setSharePermission(option.value)}`n                          />`n                          <div>`n                            <strong>{option.label}</strong>`n                            <p>{option.description}</p>`n                          </div>`n                        </label>`n                      ))}`n                    </div>`n                  </div>`n`n                  {/* Selected count */}"
)

$frontend = $frontend.Replace(
"                  <div className=\"confirmation-note\">",
"                  <div className=\"confirmation-section\">`n                    <h4>`n                      <i className=\"fas fa-user-shield\"></i>`n                      Permission`n                    </h4>`n                    <div className=\"confirmation-list\">`n                      <div className=\"confirmation-item\">`n                        <i className=\"fas fa-key\"></i>`n                        <span>{selectedPermissionMeta.label}</span>`n                      </div>`n                    </div>`n                  </div>`n`n                  <div className=\"confirmation-note\">"
)

Set-Content -Path $backendPath -Value $backend -NoNewline
Set-Content -Path $frontendPath -Value $frontend -NoNewline
Write-Output 'Patched backend share flow + FileShareModal permission selector.'