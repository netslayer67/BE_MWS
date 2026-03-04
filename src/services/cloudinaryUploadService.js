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

const uploadToCloudinary = async (filePath, originalName, mimetype) => {
    const isImage = IMAGE_TYPES.has(mimetype);
    const resourceType = isImage ? 'image' : 'raw';

    const result = await cloudinary.uploader.upload(filePath, {
        folder: EVIDENCE_FOLDER,
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true,
        ...(isImage && {
            transformation: [
                { width: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }
            ]
        })
    });

    return {
        url: result.secure_url,
        publicId: result.public_id,
        fileName: originalName,
        fileType: mimetype,
        fileSize: result.bytes,
        resourceType
    };
};

const cleanupTempFile = (filePath) => {
    try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore cleanup errors */ }
};

module.exports = {
    uploadToCloudinary,
    cleanupTempFile,
    ALLOWED_TYPES,
    MAX_FILE_SIZE,
    MAX_FILES,
    IMAGE_TYPES,
    DOC_TYPES
};
