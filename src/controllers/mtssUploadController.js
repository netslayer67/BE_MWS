const winston = require('winston');
const { uploadToCloudinary, cleanupTempFile, ALLOWED_TYPES, MAX_FILE_SIZE } = require('../services/cloudinaryUploadService');

const summarizeUploadError = (err) => {
    const message = String(err?.message || '').replace(/\s+/g, ' ').trim();
    if (!message) return 'upload failed';

    if (/api key|signature|credential|cloud name/i.test(message)) {
        return 'upload service configuration failed';
    }

    return `upload failed: ${message.slice(0, 180)}`;
};

const logUploadError = (file, err) => {
    winston.warn('MTSS evidence upload failed', {
        fileName: file?.originalname,
        mimetype: file?.mimetype,
        size: file?.size,
        message: err?.message,
        httpCode: err?.http_code,
        code: err?.code,
        primaryMessage: err?.primaryUploadError?.message,
        imageRetryMessage: err?.imageRetryError?.message
    });
};

const uploadEvidence = async (req, res) => {
    const files = req.files || [];
    if (!files.length) {
        return res.status(400).json({ success: false, message: 'No files provided' });
    }

    const results = [];
    const errors = [];

    for (const file of files) {
        try {
            if (!ALLOWED_TYPES.has(file.mimetype)) {
                errors.push(`${file.originalname}: unsupported file type`);
                cleanupTempFile(file.path);
                continue;
            }
            if (file.size > MAX_FILE_SIZE) {
                errors.push(`${file.originalname}: exceeds 5MB limit`);
                cleanupTempFile(file.path);
                continue;
            }

            const uploaded = await uploadToCloudinary(file.path, file.originalname, file.mimetype);
            results.push(uploaded);
        } catch (err) {
            logUploadError(file, err);
            errors.push(`${file.originalname}: ${summarizeUploadError(err)}`);
        } finally {
            cleanupTempFile(file.path);
        }
    }

    if (!results.length && errors.length) {
        return res.status(400).json({ success: false, message: 'All uploads failed', errors });
    }

    res.json({
        success: true,
        data: { evidence: results },
        ...(errors.length && { warnings: errors })
    });
};

module.exports = { uploadEvidence };
