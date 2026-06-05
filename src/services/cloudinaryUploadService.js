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

const buildUploadOptions = (mimetype = '', originalName = '', options = {}) => {
    const { resourceType, transformImages = true } = options;
    const isImage = IMAGE_TYPES.has(mimetype);
    const resolvedResourceType = resourceType || (isImage ? 'image' : 'raw');
    return {
        folder: EVIDENCE_FOLDER,
        resource_type: resolvedResourceType,
        use_filename: true,
        unique_filename: true,
        filename_override: originalName || undefined,
        ...(isImage && resolvedResourceType === 'image' && transformImages && {
            transformation: [
                { width: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }
            ]
        })
    };
};

const formatUploadResult = (result, originalName, mimetype, resourceType) => ({
    url: result.secure_url,
    publicId: result.public_id,
    fileName: originalName,
    fileType: mimetype,
    fileSize: result.bytes,
    resourceType
});

const uploadWithOptions = async (filePath, originalName, mimetype, options) => {
    const result = await cloudinary.uploader.upload(filePath, options);
    return formatUploadResult(result, originalName, mimetype, options.resource_type);
};

const uploadToCloudinary = async (filePath, originalName, mimetype) => {
    const isImage = IMAGE_TYPES.has(mimetype);
    const options = buildUploadOptions(mimetype, originalName);

    try {
        return await uploadWithOptions(filePath, originalName, mimetype, options);
    } catch (primaryError) {
        if (!isImage) throw primaryError;

        try {
            return await uploadWithOptions(
                filePath,
                originalName,
                mimetype,
                buildUploadOptions(mimetype, originalName, { transformImages: false })
            );
        } catch (imageRetryError) {
            imageRetryError.primaryUploadError = primaryError;

            try {
                return await uploadWithOptions(
                    filePath,
                    originalName,
                    mimetype,
                    buildUploadOptions(mimetype, originalName, { resourceType: 'raw', transformImages: false })
                );
            } catch (rawRetryError) {
                rawRetryError.primaryUploadError = primaryError;
                rawRetryError.imageRetryError = imageRetryError;
                throw rawRetryError;
            }
        }
    }
};

const uploadDataUriToCloudinary = async (dataUri, originalName, mimetype) => {
    const options = buildUploadOptions(mimetype, originalName);
    const result = await cloudinary.uploader.upload(dataUri, options);

    return formatUploadResult(result, originalName, mimetype, options.resource_type);
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
