/**
 * Copy this file to: js/cloudinary-config.local.js
 * That file is gitignored so your cloud name and preset stay off the remote.
 * Load order in index.html: cloudinary-config.js, optional cloudinary-config.local.js, cloudinary-upload.js
 * Unsigned uploads only — never put your API secret in front-end code.
 * If DDA PDF uploads fail, create an unsigned preset that allows "raw" and set rawUploadPreset below.
 */
(function () {
    var c = window.PharmaFlow && window.PharmaFlow.cloudinaryConfig;
    if (!c) return;
    c.enabled = true;
    c.cloudName = 'YOUR_CLOUD_NAME';
    c.uploadPreset = 'Pharmaflow';
    // c.rawUploadPreset = 'OPTIONAL_PRESET_FOR_PDF';
})();
