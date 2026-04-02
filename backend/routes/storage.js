const express = require('express');
const multer = require('multer');
const storageController = require('../controllers/storageController');
const folderController = require('../controllers/folderController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file upload (store in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max
  }
});

router.use(authenticateToken);

// File operations
router.post('/upload', upload.single('file'), storageController.uploadFile);
router.get('/files', storageController.getUserFiles);
router.get('/files/shared', storageController.getSharedFiles);
router.get('/files/:fileId', storageController.getFileDetails); 
router.put('/files/:fileId/rename', storageController.renameFile);
router.put('/files/:fileId/content', storageController.updateFileContent); 
router.get('/files/:fileId/preview', storageController.previewFile); 
router.get('/files/:fileId/download', storageController.downloadFile);
router.post('/files/:fileId/copy', storageController.copyFile);
router.delete('/files/:fileId', storageController.deleteFile);

// Storage quota
router.get('/quota', storageController.getStorageQuota);

// Folder operations
router.get('/folders', folderController.getFolders);
router.post('/folders', folderController.createFolder);
router.post('/folders/:folderId/files', folderController.addFilesToFolder);
router.delete('/folders/:folderId/files', folderController.removeFilesFromFolder);
router.put('/folders/:folderId/rename', folderController.renameFolder);
router.delete('/folders/:folderId', folderController.deleteFolder);
router.get('/files/:fileId', storageController.getFileDetails);


// Sharing operations
router.post('/share', storageController.shareFiles);
router.get('/files/:fileId/sharing-history', storageController.getSharingHistory);
router.delete('/sharing/:sharingId', storageController.revokeSharing);
router.get('/notifications', storageController.getNotifications);
router.put('/notifications/:notificationId/read', storageController.markNotificationRead);



module.exports = router;