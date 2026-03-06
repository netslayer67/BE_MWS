const fs = require('fs');
const path = require('path');
const cloudinary = require('../config/cloudinary');

const EVIDENCE_FOLDER = 'MWS Students Design/evidence';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOC_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);
const ALLOWED_TYPES = new Set([...IMAGE_TYPES, ...DOC_TYPES]);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES = 5;

const buildUploadOptions = (mimetype = '', originalName = '') => {
    const isImage = IMAGE_TYPES.has(mimetype);
    return {
        folder: EVIDENCE_FOLDER,
        resource_type: isImage ? 'image' : 'raw',
        use_filename: true,
        unique_filename: true,
        filename_override: originalName || undefined,
        ...(isImage && {
            transformation: [
                { width: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }
            ]
        })
    };
};

const uploadToCloudinary = async (filePath, originalName, mimetype) => {
    const options = buildUploadOptions(mimetype, originalName);
    const result = await cloudinary.uploader.upload(filePath, options);

    return {
        url: result.secure_url,
        publicId: result.public_id,
        fileName: originalName,
        fileType: mimetype,
        fileSize: result.bytes,
        resourceType: options.resource_type
    };
};

const uploadDataUriToCloudinary = async (dataUri, originalName, mimetype) => {
    const options = buildUploadOptions(mimetype, originalName);
    const result = await cloudinary.uploader.upload(dataUri, options);

    return {
        url: result.secure_url,
        publicId: result.public_id,
        fileName: originalName,
        fileType: mimetype,
        fileSize: result.bytes,
        resourceType: options.resource_type
    };
};

const cleanupTempFile = (filePath) => {
    try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore cleanup errors */ }
};

module.exports = {
    EVIDENCE_FOLDER,
    uploadToCloudinary,
    uploadDataUriToCloudinary,
    cleanupTempFile,
    ALLOWED_TYPES,
    MAX_FILE_SIZE,
    MAX_FILES,
    IMAGE_TYPES,
    DOC_TYPES
};
