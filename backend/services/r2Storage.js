const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

// Initialize R2 client
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Upload file to Cloudflare R2
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileName - Original file name
 * @param {string} folder - Folder path (e.g., 'profile-pictures', 'files')
 * @param {string} contentType - MIME type
 * @returns {Promise<{key: string, url: string}>}
 */
async function uploadToR2(fileBuffer, fileName, folder, contentType) {
  try {
    // Generate unique file key
    const fileExtension = fileName.split('.').pop();
    const uniqueFileName = `${crypto.randomBytes(16).toString('hex')}.${fileExtension}`;
    const key = `${folder}/${uniqueFileName}`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    });

    await r2Client.send(command);

    // Generate public URL
    // If R2_PUBLIC_URL is not set, construct it from account ID and bucket name
    const publicUrl = process.env.R2_PUBLIC_URL || 
                      `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const url = `${publicUrl}/${key}`;

    console.log(`✅ File uploaded to R2: ${key}`);
    console.log(`📍 URL: ${url}`);

    return { key, url };
  } catch (error) {
    console.error('R2 upload error:', error);
    throw new Error('Failed to upload file to cloud storage');
  }
}

/**
 * Delete file from Cloudflare R2
 * @param {string} key - File key in R2
 * @returns {Promise<void>}
 */
async function deleteFromR2(key) {
  try {
    if (!key) return;

    const command = new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    });

    await r2Client.send(command);
    console.log(`🗑️ File deleted from R2: ${key}`);
  } catch (error) {
    console.error('R2 delete error:', error);
    // Don't throw error for delete failures
  }
}

/**
 * Upload profile picture to R2
 * @param {Buffer} imageBuffer - Processed image buffer
 * @param {number} userId - User ID
 * @returns {Promise<{key: string, url: string}>}
 */
async function uploadProfilePicture(imageBuffer, userId) {
  const fileName = `profile-${userId}-${Date.now()}.jpg`;
  return uploadToR2(imageBuffer, fileName, 'profile-pictures', 'image/jpeg');
}

/**
 * Delete profile picture from R2
 * @param {string} r2Path - R2 path/key
 * @returns {Promise<void>}
 */
async function deleteProfilePicture(r2Path) {
  return deleteFromR2(r2Path);
}

module.exports = {
  uploadToR2,
  deleteFromR2,
  uploadProfilePicture,
  deleteProfilePicture,
  r2Client
};