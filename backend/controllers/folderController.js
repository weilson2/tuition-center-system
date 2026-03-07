const pool = require('../config/database');
const { logAudit } = require('../utils/auditLogger');

// Get user folders
async function getFolders(req, res) {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT f.*, 
        COUNT(ffa.file_id) as file_count
      FROM folders f
      LEFT JOIN file_folder_associations ffa ON f.folder_id = ffa.folder_id
      WHERE f.user_id = $1
      GROUP BY f.folder_id
      ORDER BY f.is_system_folder DESC, f.created_at ASC`,
      [userId]
    );

    res.json({ folders: result.rows });

  } catch (error) {
    console.error('Get folders error:', error);
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
}

// Create folder
async function createFolder(req, res) {
  try {
    const userId = req.user.userId;
    const { folderName, parentFolderId } = req.body;

    if (!folderName || folderName.trim() === '') {
      return res.status(400).json({ error: 'Folder name cannot be empty' });
    }

    // Check for duplicate folder name
    const duplicateCheck = await pool.query(
      `SELECT folder_id FROM folders 
       WHERE user_id = $1 AND folder_name = $2 AND parent_folder_id IS NOT DISTINCT FROM $3`,
      [userId, folderName.trim(), parentFolderId || null]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Folder with this name already exists' });
    }

    // Create folder path
    let folderPath = folderName.trim();
    if (parentFolderId) {
      const parentResult = await pool.query(
        'SELECT folder_path FROM folders WHERE folder_id = $1 AND user_id = $2',
        [parentFolderId, userId]
      );

      if (parentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Parent folder not found' });
      }

      folderPath = `${parentResult.rows[0].folder_path}/${folderName.trim()}`;
    }

    const result = await pool.query(
      `INSERT INTO folders (user_id, parent_folder_id, folder_name, folder_path, is_system_folder)
       VALUES ($1, $2, $3, $4, false)
       RETURNING *`,
      [userId, parentFolderId || null, folderName.trim(), folderPath]
    );

    await logAudit({
      userId,
      sessionId: req.sessionId,
      operationType: 'folder_create',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({ folder_name: folderName, parent_folder_id: parentFolderId }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });

    res.json({
      message: 'Folder created successfully',
      folder: result.rows[0]
    });

  } catch (error) {
    console.error('Create folder error:', error);

    await logAudit({
      userId: req.user.userId,
      sessionId: req.sessionId,
      operationType: 'folder_create',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({ error: error.message }),
      status: 'failed',
      errorMessage: error.message,
      userAgent: req.headers['user-agent']
    });

    res.status(500).json({ error: 'Failed to create folder' });
  }
}

// Rename folder
async function renameFolder(req, res) {
  try {
    const { folderId } = req.params;
    const { newFolderName } = req.body;
    const userId = req.user.userId;

    if (!newFolderName || newFolderName.trim() === '') {
      return res.status(400).json({ error: 'Folder name cannot be empty' });
    }

    // Verify ownership and not system folder
    const folderResult = await pool.query(
      'SELECT * FROM folders WHERE folder_id = $1 AND user_id = $2',
      [folderId, userId]
    );

    if (folderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const folder = folderResult.rows[0];

    if (folder.is_system_folder) {
      return res.status(400).json({ error: 'Cannot rename system folders' });
    }

    // Check for duplicate
    const duplicateCheck = await pool.query(
      `SELECT folder_id FROM folders 
       WHERE user_id = $1 AND folder_name = $2 AND parent_folder_id IS NOT DISTINCT FROM $3 AND folder_id != $4`,
      [userId, newFolderName.trim(), folder.parent_folder_id, folderId]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Folder with this name already exists' });
    }

    // Update folder path
    let newFolderPath = newFolderName.trim();
    if (folder.parent_folder_id) {
      const parentResult = await pool.query(
        'SELECT folder_path FROM folders WHERE folder_id = $1',
        [folder.parent_folder_id]
      );
      newFolderPath = `${parentResult.rows[0].folder_path}/${newFolderName.trim()}`;
    }

    await pool.query(
      'UPDATE folders SET folder_name = $1, folder_path = $2, updated_at = CURRENT_TIMESTAMP WHERE folder_id = $3',
      [newFolderName.trim(), newFolderPath, folderId]
    );

    await logAudit({
      userId,
      sessionId: req.sessionId,
      operationType: 'folder_rename',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({ folder_id: folderId, old_name: folder.folder_name, new_name: newFolderName }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });

    res.json({ message: 'Folder renamed successfully' });

  } catch (error) {
    console.error('Rename folder error:', error);

    await logAudit({
      userId: req.user.userId,
      sessionId: req.sessionId,
      operationType: 'folder_rename',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({ error: error.message }),
      status: 'failed',
      errorMessage: error.message,
      userAgent: req.headers['user-agent']
    });

    res.status(500).json({ error: 'Failed to rename folder' });
  }
}

// Delete folder
async function deleteFolder(req, res) {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const { folderId } = req.params;
    const userId = req.user.userId;

    // Verify ownership and not system folder
    const folderResult = await client.query(
      'SELECT * FROM folders WHERE folder_id = $1 AND user_id = $2',
      [folderId, userId]
    );

    if (folderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'Folder not found' });
    }

    const folder = folderResult.rows[0];

    if (folder.is_system_folder) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'Cannot delete system folders' });
    }

    // Remove file associations (files remain, just removed from folder)
    await client.query(
      'DELETE FROM file_folder_associations WHERE folder_id = $1',
      [folderId]
    );

    // Delete folder
    await client.query(
      'DELETE FROM folders WHERE folder_id = $1',
      [folderId]
    );

    await client.query('COMMIT');

    await logAudit({
      userId,
      sessionId: req.sessionId,
      operationType: 'folder_delete',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({ folder_id: folderId, folder_name: folder.folder_name }),
      status: 'success',
      userAgent: req.headers['user-agent']
    });

    res.json({ message: 'Folder deleted successfully' });

  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }
    console.error('Delete folder error:', error);

    await logAudit({
      userId: req.user.userId,
      sessionId: req.sessionId,
      operationType: 'folder_delete',
      ipAddress: req.ip,
      operationDetails: JSON.stringify({ error: error.message }),
      status: 'failed',
      errorMessage: error.message,
      userAgent: req.headers['user-agent']
    });

    res.status(500).json({ error: 'Failed to delete folder' });
  } finally {
    client.release();
  }
}

// Add files to folder
// Add files to folder
async function addFilesToFolder(req, res) {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const { folderId } = req.params;
    const { fileIds } = req.body;
    const userId = req.user.userId;

    console.log('📁 Add to folder request:', { folderId, fileIds, userId });

    if (!fileIds || fileIds.length === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'No files provided' });
    }

    // Verify folder ownership
    const folderResult = await client.query(
      'SELECT folder_id FROM folders WHERE folder_id = $1 AND user_id = $2',
      [folderId, userId]
    );

    if (folderResult.rows.length === 0) {
      console.log('❌ Folder not found or access denied');
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'Folder not found' });
    }

    // Verify file ownership
    const filesResult = await client.query(
      'SELECT file_id FROM files WHERE file_id = ANY($1::integer[]) AND user_id = $2 AND is_deleted = false',
      [fileIds, userId]
    );

    console.log('📄 Files found:', filesResult.rows.length, 'of', fileIds.length);

    if (filesResult.rows.length !== fileIds.length) {
      console.log('❌ Some files not found or not owned by user');
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(403).json({ error: 'You can only add your own files to folders' });
    }

    // Add files to folder
    let addedCount = 0;
    for (const fileId of fileIds) {
      const result = await client.query(
        `INSERT INTO file_folder_associations (file_id, folder_id)
         VALUES ($1, $2)
         ON CONFLICT (file_id, folder_id) DO NOTHING
         RETURNING *`,
        [fileId, folderId]
      );

      if (result.rows.length > 0) {
        addedCount++;
      }
    }

    await client.query('COMMIT');

    console.log('✅ Successfully added', addedCount, 'files to folder');

    // Log audit (don't fail if this errors)
    try {
      await logAudit({
        userId,
        sessionId: req.sessionId,
        operationType: 'add_to_folder',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ file_ids: fileIds, folder_id: folderId, count: addedCount }),
        status: 'success',
        userAgent: req.headers['user-agent']
      });
    } catch (auditError) {
      console.error('Audit log error (non-critical):', auditError);
    }

    res.json({
      message: addedCount === 0
        ? 'All files are already in this folder'
        : `Successfully added ${addedCount} file(s) to folder`,
      addedCount,
      totalRequested: fileIds.length
    });

  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }
    console.error('❌ Add to folder error:', error);

    // Log audit failure (don't fail if this errors)
    try {
      await logAudit({
        userId: req.user.userId,
        sessionId: req.sessionId,
        operationType: 'add_to_folder',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ error: error.message }),
        status: 'failed',
        errorMessage: error.message,
        userAgent: req.headers['user-agent']
      });
    } catch (auditError) {
      console.error('Audit log error (non-critical):', auditError);
    }

    res.status(500).json({ error: 'Failed to add files to folder' });
  } finally {
    client.release();
  }
}

// Remove files from folder
async function removeFilesFromFolder(req, res) {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const { folderId } = req.params;
    const { fileIds } = req.body;
    const userId = req.user.userId;

    console.log('📁 Remove from folder request:', { folderId, fileIds, userId });

    if (!fileIds || fileIds.length === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'No files provided' });
    }

    // Verify folder ownership
    const folderResult = await client.query(
      'SELECT folder_id, folder_name FROM folders WHERE folder_id = $1 AND user_id = $2',
      [folderId, userId]
    );

    if (folderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'Folder not found' });
    }

    // Remove files from folder
    const result = await client.query(
      'DELETE FROM file_folder_associations WHERE folder_id = $1 AND file_id = ANY($2::integer[]) RETURNING file_id',
      [folderId, fileIds]
    );

    await client.query('COMMIT');

    console.log('✅ Successfully removed', result.rows.length, 'files from folder');

    // Log audit
    try {
      await logAudit({
        userId,
        sessionId: req.sessionId,
        operationType: 'remove_from_folder',
        ipAddress: req.ip,
        operationDetails: JSON.stringify({ file_ids: fileIds, folder_id: folderId, count: result.rows.length }),
        status: 'success',
        userAgent: req.headers['user-agent']
      });
    } catch (auditError) {
      console.error('Audit log error (non-critical):', auditError);
    }

    res.json({
      message: `Successfully removed ${result.rows.length} file(s) from folder`,
      removedCount: result.rows.length
    });

  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
    }
    console.error('❌ Remove from folder error:', error);

    res.status(500).json({ error: 'Failed to remove files from folder' });
  } finally {
    client.release();
  }
}

module.exports = {
  getFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  addFilesToFolder,
  removeFilesFromFolder
};