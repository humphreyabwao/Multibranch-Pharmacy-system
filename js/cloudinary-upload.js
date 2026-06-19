/**
 * PharmaFlow — Cloudinary uploads (unsigned preset; no API secret in the browser).
 * When cloudinaryConfig.enabled is true and cloudName + uploadPreset are set,
 * image/raw uploads use Cloudinary instead of Firebase Storage.
 */
(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    function getCfg() {
        var c = window.PharmaFlow.cloudinaryConfig;
        if (!c) return null;
        return c;
    }

    function isActive() {
        var c = getCfg();
        return !!(c && c.enabled && c.cloudName && c.uploadPreset);
    }

    function resourceTypeForFile(file) {
        var mime = (file && file.type) || '';
        var name = (file && file.name) || '';
        if (
            mime === 'application/pdf' ||
            mime === 'application/msword' ||
            mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            /\.(pdf|doc|docx)$/i.test(name)
        ) return 'raw';
        return 'image';
    }

    function presetForResourceType(cfg, type) {
        if (type === 'raw' && cfg.rawUploadPreset) return cfg.rawUploadPreset;
        return cfg.uploadPreset;
    }

    /**
     * @param {File} file
     * @param {{ publicId?: string, folder?: string, resourceType?: string }} [options]
     * @returns {Promise<string>} secure_url
     */
    async function uploadFile(file, options) {
        var cfg = getCfg();
        if (!cfg || !cfg.enabled || !cfg.cloudName || !cfg.uploadPreset) {
            throw new Error('Cloudinary is not configured');
        }
        options = options || {};
        var rType = options.resourceType || resourceTypeForFile(file);
        var preset = presetForResourceType(cfg, rType);
        if (!preset) throw new Error('Missing upload preset for resource type');

        var fd = new FormData();
        fd.append('file', file);
        fd.append('upload_preset', preset);
        if (options.publicId) fd.append('public_id', options.publicId);
        if (options.folder) fd.append('folder', options.folder);

        var url = 'https://api.cloudinary.com/v1_1/' + encodeURIComponent(cfg.cloudName) + '/' + rType + '/upload';
        var res = await fetch(url, { method: 'POST', body: fd });
        var data = await res.json();
        if (!res.ok) {
            var msg = (data.error && data.error.message) || res.statusText || 'Cloudinary upload failed';
            throw new Error(msg);
        }
        if (!data.secure_url) throw new Error('Cloudinary response missing URL');
        return data.secure_url;
    }

    function isFirebaseStorageUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return url.indexOf('firebasestorage.googleapis.com') !== -1;
    }

    window.PharmaFlow.CloudinaryUpload = {
        isActive: isActive,
        uploadFile: uploadFile,
        isFirebaseStorageUrl: isFirebaseStorageUrl
    };
})();
