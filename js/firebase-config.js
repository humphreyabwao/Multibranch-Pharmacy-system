/**
 * PharmaFlow - Firebase Configuration
 * Replace the placeholder values below with your actual Firebase project credentials.
 * Go to Firebase Console > Project Settings > General > Your apps > Firebase SDK snippet
 */

const firebaseConfig = {
    apiKey: "AIzaSyDao6sLkfp-b3bHpbJYUV7Pgidpp2MUMI8",
    authDomain: "multitenant-pharamcy-system.firebaseapp.com",
    databaseURL: "https://multitenant-pharamcy-system-default-rtdb.firebaseio.com",
    projectId: "multitenant-pharamcy-system",
    storageBucket: "multitenant-pharamcy-system.firebasestorage.app",
    messagingSenderId: "387741125014",
    appId: "1:387741125014:web:9aa841106bc29e647135b7",
    measurementId: "G-VG20C55QG5"
};

// Validate that Firebase config has been set up
function isFirebaseConfigured() {
    return firebaseConfig.apiKey !== "" && firebaseConfig.projectId !== "";
}

// Firebase CDN modules loaded via importmap won't work in older browsers,
// so we use the compat SDK loaded from CDN scripts in the HTML.
// The scripts below are loaded dynamically to keep config in one place.

(function loadFirebaseSDK() {
    const scripts = [
        {
            src: 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
            ready: function () { return typeof firebase !== 'undefined' && typeof firebase.initializeApp === 'function'; }
        },
        {
            src: 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
            ready: function () { return typeof firebase !== 'undefined' && typeof firebase.auth === 'function'; }
        },
        {
            src: 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js',
            ready: function () { return typeof firebase !== 'undefined' && typeof firebase.firestore === 'function'; }
        },
        {
            src: 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage-compat.js',
            ready: function () { return typeof firebase !== 'undefined' && typeof firebase.storage === 'function'; }
        }
    ];

    function loadNext(index) {
        if (index >= scripts.length) {
            initializeFirebase();
            return;
        }

        const dependency = scripts[index];
        if (dependency.ready()) {
            loadNext(index + 1);
            return;
        }

        const existing = document.querySelector('script[src="' + dependency.src + '"]');
        if (existing) {
            existing.addEventListener('load', function () { loadNext(index + 1); }, { once: true });
            existing.addEventListener('error', function () {
                console.error('Failed to load Firebase SDK:', dependency.src);
            }, { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = dependency.src;
        script.onload = function () { loadNext(index + 1); };
        script.onerror = function() {
            console.error('Failed to load Firebase SDK:', dependency.src);
        };
        document.head.appendChild(script);
    }

    loadNext(0);
})();

function initializeFirebase() {
    if (!isFirebaseConfigured()) {
        console.warn('PharmaFlow: Firebase is not configured. Please update js/firebase-config.js with your Firebase credentials.');
        return;
    }

    if (firebase.apps.length === 0) {
        firebase.initializeApp(firebaseConfig);
    }

    // Make services globally available
    window.db = firebase.firestore();
    window.auth = firebase.auth();
    window.storage = firebase.storage();

    // Enable offline persistence for faster loading & offline support
    window.db.enablePersistence({ synchronizeTabs: true })
        .catch(function (err) {
            if (err.code === 'failed-precondition') {
                console.warn('Firestore persistence: Multiple tabs open, only one can enable persistence at a time.');
            } else if (err.code === 'unimplemented') {
                console.warn('Firestore persistence: Browser does not support offline persistence.');
            }
        });

    // Dispatch event so other modules know Firebase is ready
    window.dispatchEvent(new CustomEvent('firebase-ready'));
}

/**
 * Firestore collection paths follow a multi-tenant structure:
 *
 * /businesses/{businessId}/...
 *   - pharmacy data scoped to a specific business (franchise)
 *
 * /users/{uid}
 *   - user profiles with role + businessId assignment
 *
 * /superadmin/config
 *   - global configuration accessible only to superadmin
 *
 * Helper to get business-scoped collection:
 */
function getBusinessCollection(businessId, collectionName) {
    if (!window.db) {
        throw new Error('Firestore not initialized');
    }
    if (!window.PharmaFlow || !PharmaFlow.Auth || !PharmaFlow.Auth.authorizationReady) {
        throw new Error('Tenant context is not authorized');
    }
    PharmaFlow.Auth.assertBusinessAccess(businessId);
    if (typeof collectionName !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(collectionName)) {
        throw new Error('Invalid tenant collection');
    }
    var collectionRef = window.db.collection('businesses').doc(businessId).collection(collectionName);
    if (window.PharmaFlow && PharmaFlow.SupabaseFallback && typeof PharmaFlow.SupabaseFallback.wrapCollectionRef === 'function') {
        return PharmaFlow.SupabaseFallback.wrapCollectionRef(collectionRef, businessId, collectionName);
    }
    return collectionRef;
}

/**
 * Roles:
 * - superadmin: Can manage all businesses, users, and global settings
 * - admin: Can manage their assigned business (franchise)
 * - staff: Limited access within their assigned business
 */
const USER_ROLES = {
    SUPERADMIN: 'superadmin',
    ADMIN: 'admin',
    STAFF: 'staff'
};

// Master superadmin email — always has full system access, cannot be demoted or deleted
const MASTER_EMAIL = 'admin@pharmaflow.com';

// Export for use by other modules
window.PharmaFlow = window.PharmaFlow || {};
window.PharmaFlow.firebaseConfig = firebaseConfig;
window.PharmaFlow.isFirebaseConfigured = isFirebaseConfigured;
window.PharmaFlow.getBusinessCollection = getBusinessCollection;
window.PharmaFlow.USER_ROLES = USER_ROLES;
window.PharmaFlow.MASTER_EMAIL = MASTER_EMAIL;
