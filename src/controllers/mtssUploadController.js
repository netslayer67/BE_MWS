const { uploadToCloudinary, cleanupTempFile, ALLOWED_TYPES, MAX_FILE_SIZE } = require('../services/cloudinaryUploadService');

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
            errors.push(`${file.originalname}: upload failed`);
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
