/**
 * Cloudinary client settings (unsigned upload preset only).
 * Set `cloudName` to your Cloudinary cloud name to send uploads here instead of Firebase Storage.
 * Do not put your API secret in this file — it cannot be secured in static front-end code.
 * Optional: copy cloudinary-config.local.example.js to js/cloudinary-config.local.js, fill it in,
 * and add <script src="js/cloudinary-config.local.js"></script> after this file in index.html.
 */
(function () {
    window.PharmaFlow = window.PharmaFlow || {};
    window.PharmaFlow.cloudinaryConfig = {
        enabled: true,
        /** Your cloud name from the Cloudinary dashboard (required for uploads). */
        cloudName: 'dhhoou5mw',
        /** Unsigned upload preset (e.g. Pharmaflow). */
        uploadPreset: 'Pharmaflow',
        /** Optional: unsigned preset that allows PDF/raw if your image preset rejects DDA PDFs */
        rawUploadPreset: ''
    };
})();
