/**
 * PharmaFlow - Authentication Module
 * Handles login, logout, password reset, and session management.
 * Works with Firebase Auth and Firestore user profiles.
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    const Auth = {
        currentUser: null,
        userProfile: null,
        pendingLoginNoticeKey: 'pf_login_error',

        /**
         * Initialize auth state listener
         */
        init: function () {
            // Wait for Firebase to be ready
            if (!window.auth) {
                window.addEventListener('firebase-ready', () => this.init());
                return;
            }

            window.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    this.currentUser = user;
                    try {
                        await this.loadUserProfile(user.uid);
                        this.onAuthSuccess();
                    } catch (err) {
                        // Handle franchise isolation errors
                        if (err.message === 'ACCOUNT_DISABLED') {
                            this.showLoginError('Your account has been disabled. Please contact your administrator.');
                            this.onAuthRequired();
                        } else if (err.message === 'FRANCHISE_INACTIVE') {
                            const stored = localStorage.getItem(this.pendingLoginNoticeKey);
                            if (stored) localStorage.removeItem(this.pendingLoginNoticeKey);
                            this.showLoginError(stored || 'This branch has been suspended. Please contact the system administrator.');
                            this.onAuthRequired();
                        } else {
                            console.error('Profile load error:', err);
                            this.onAuthSuccess();
                        }
                    }
                } else {
                    this.currentUser = null;
                    this.userProfile = null;
                    this.onAuthRequired();
                }
            });

            this.bindLoginForm();
            this.bindForgotPasswordForm();
            this.bindPasswordToggle();
            this.consumeStoredLoginNotice();
        },

        /**
         * Show/hide login page alert boxes (.login-hidden uses !important; must toggle class)
         */
        _setLoginAlertVisible: function (elementId, visible) {
            const el = document.getElementById(elementId);
            if (!el) return;
            if (visible) {
                el.classList.remove('login-hidden');
            } else {
                el.classList.add('login-hidden');
            }
        },

        /**
         * Login button: show animated loading state
         */
        setLoginSubmitLoading: function (loading) {
            const btn = document.getElementById('login-btn');
            const defaultEl = document.getElementById('login-btn-default');
            const loadingEl = document.getElementById('login-btn-loading');
            if (!btn) return;

            if (loading) {
                btn.classList.add('is-loading');
                btn.disabled = true;
                btn.setAttribute('aria-busy', 'true');
                if (defaultEl) defaultEl.setAttribute('aria-hidden', 'true');
                if (loadingEl) {
                    loadingEl.classList.remove('login-hidden');
                    loadingEl.setAttribute('aria-hidden', 'false');
                }
            } else {
                btn.classList.remove('is-loading');
                btn.disabled = false;
                btn.setAttribute('aria-busy', 'false');
                if (defaultEl) defaultEl.setAttribute('aria-hidden', 'false');
                if (loadingEl) {
                    loadingEl.classList.add('login-hidden');
                    loadingEl.setAttribute('aria-hidden', 'true');
                }
            }
        },

        clearCachedSessionState: function () {
            try {
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (!key || !key.startsWith('pf_')) continue;
                    if (key === 'pf_last_active_business_id' || key === this.pendingLoginNoticeKey) continue;
                    if (key.indexOf('pf_brand_snapshot_') === 0) continue;
                    if (key === 'pf_brand_name' || key === 'pf_brand_tagline' || key === 'pf_brand_icon' || key === 'pf_brand_company_logo') {
                        continue;
                    }
                    keysToRemove.push(key);
                }
                keysToRemove.forEach(key => localStorage.removeItem(key));

                const sessionKeysToRemove = [];
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    if (key && key.startsWith('pf_')) {
                        sessionKeysToRemove.push(key);
                    }
                }
                sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key));

                PharmaFlow.selectedBusinessId = null;
                if (PharmaFlow.Sidebar) {
                    PharmaFlow.Sidebar.activeModuleId = null;
                    PharmaFlow.Sidebar.activeSubModuleId = null;
                    PharmaFlow.Sidebar.expandedModules = new Set();
                }
            } catch (err) {
                console.warn('Failed to clear cached session state:', err);
            }
        },

        /**
         * Load user profile from Firestore
         */
        loadUserProfile: async function (uid) {
            try {
                const doc = await window.db.collection('users').doc(uid).get();
                if (doc.exists) {
                    this.userProfile = { id: doc.id, ...doc.data() };
                } else {
                    console.warn('User profile not found in Firestore for UID:', uid);
                    // Auto-create profile with a default business
                    await this.autoProvisionUser(uid);
                }
            } catch (err) {
                console.error('Error loading user profile:', err);
                await this.autoProvisionUser(uid);
            }

            // If profile exists but has no businessId, auto-assign one
            if (this.userProfile && !this.userProfile.businessId) {
                await this.autoAssignBusiness(uid);
            }

            // Enforce franchise isolation: check user status and franchise active state
            if (this.userProfile && this.userProfile.role !== 'superadmin') {
                // Master email always gets superadmin — self-heal if role was changed
                const masterEmail = (PharmaFlow.MASTER_EMAIL || 'admin@pharmaflow.com').toLowerCase();
                if (this.userProfile.email && this.userProfile.email.toLowerCase() === masterEmail) {
                    this.userProfile.role = 'superadmin';
                    try {
                        await window.db.collection('users').doc(uid).update({ role: 'superadmin' });
                    } catch (e) { /* best effort */ }
                }
            }

            if (this.userProfile && this.userProfile.role !== 'superadmin') {
                // Check if user account is disabled
                if (this.userProfile.status === 'disabled') {
                    await window.auth.signOut();
                    this.currentUser = null;
                    this.userProfile = null;
                    throw new Error('ACCOUNT_DISABLED');
                }

                // Check if franchise is active
                if (this.userProfile.businessId) {
                    try {
                        const bizDoc = await window.db.collection('businesses').doc(this.userProfile.businessId).get();
                        if (bizDoc.exists && bizDoc.data().isActive === false) {
                            const suspensionMessage = this.getSuspensionMessage(bizDoc.data());
                            try { localStorage.setItem(this.pendingLoginNoticeKey, suspensionMessage); } catch (e) { /* ignore */ }
                            await window.auth.signOut();
                            this.currentUser = null;
                            this.userProfile = null;
                            throw new Error('FRANCHISE_INACTIVE');
                        }
                    } catch (bizErr) {
                        if (bizErr.message === 'FRANCHISE_INACTIVE') throw bizErr;
                        console.error('Error checking franchise status:', bizErr);
                    }
                }
            }
        },

        /**
         * Auto-create a Firestore user doc and default business for first-time users
         */
        autoProvisionUser: async function (uid) {
            try {
                // Find or create a default business
                const bizId = await this.findOrCreateDefaultBusiness();

                // Master superadmin always gets superadmin role
                const email = this.currentUser.email || '';
                const isMaster = email.toLowerCase() === (PharmaFlow.MASTER_EMAIL || 'admin@pharmaflow.com').toLowerCase();

                const profileData = {
                    email: email,
                    displayName: this.currentUser.displayName || this.currentUser.email?.split('@')[0] || 'User',
                    role: isMaster ? 'superadmin' : (PharmaFlow.USER_ROLES?.ADMIN || 'admin'),
                    businessId: bizId,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                await window.db.collection('users').doc(uid).set(profileData);
                this.userProfile = { id: uid, ...profileData };
                console.log('Auto-provisioned user profile with business:', bizId);
            } catch (err) {
                console.error('Auto-provision failed:', err);
                this.userProfile = {
                    id: uid,
                    email: this.currentUser.email,
                    displayName: this.currentUser.displayName || 'User',
                    role: 'staff',
                    businessId: null
                };
            }
        },

        /**
         * If user exists but has no businessId, assign one
         */
        autoAssignBusiness: async function (uid) {
            try {
                const bizId = await this.findOrCreateDefaultBusiness();
                await window.db.collection('users').doc(uid).update({ businessId: bizId });
                this.userProfile.businessId = bizId;
                console.log('Auto-assigned business to user:', bizId);
            } catch (err) {
                console.error('Auto-assign business failed:', err);
            }
        },

        /**
         * Find the first existing business or create a default one
         */
        findOrCreateDefaultBusiness: async function () {
            // Try to find any existing business
            const snapshot = await window.db.collection('businesses').limit(1).get();
            if (!snapshot.empty) {
                return snapshot.docs[0].id;
            }

            // Create a default business
            const bizRef = await window.db.collection('businesses').add({
                name: 'My Pharmacy',
                address: '',
                phone: '',
                licenseNumber: '',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                isActive: true
            });
            console.log('Created default business:', bizRef.id);
            return bizRef.id;
        },

        /**
         * Called when user is authenticated — redirect to dashboard
         */
        onAuthSuccess: function () {
            if (window.location.pathname.endsWith('login.html') || window.location.pathname === '/') {
                window.location.href = 'index.html';
            }
            // Notify app that auth is ready
            window.dispatchEvent(new CustomEvent('auth-ready', {
                detail: {
                    user: this.currentUser,
                    profile: this.userProfile
                }
            }));
        },

        /**
         * Called when no user is authenticated — redirect to login
         */
        onAuthRequired: function () {
            const isLoginPage = window.location.pathname.endsWith('login.html');
            if (!isLoginPage) {
                window.location.replace('login.html');
            }
        },

        /**
         * Show error on login page (for blocked accounts/franchises)
         */
        showLoginError: function (msg) {
            const errorDiv = document.getElementById('login-error');
            const msgEl = document.getElementById('login-error-text');
            if (msgEl) msgEl.textContent = msg || '';
            if (errorDiv) {
                errorDiv.classList.remove('login-shake');
                void errorDiv.offsetWidth;
                errorDiv.classList.add('login-shake');
                this._setLoginAlertVisible('login-error', true);
            }
            this._setLoginAlertVisible('login-success', false);
            this.setLoginSubmitLoading(false);
        },

        getSuspensionMessage: function (businessData) {
            const reason = businessData && (businessData.suspensionReason || businessData.inactiveReason || businessData.deactivationReason);
            return reason
                ? 'This branch has been suspended. Reason: ' + reason
                : 'This branch has been suspended. Please contact the system administrator.';
        },

        consumeStoredLoginNotice: function () {
            try {
                const msg = localStorage.getItem(this.pendingLoginNoticeKey);
                if (!msg) return;
                localStorage.removeItem(this.pendingLoginNoticeKey);
                this.showLoginError(msg);
            } catch (err) {
                console.warn('Failed to show stored login notice:', err);
            }
        },

        /**
         * Sign in with email/password
         */
        signIn: async function (email, password) {
            try {
                const rememberMe = !!document.getElementById('remember-me')?.checked;
                await window.auth.setPersistence(
                    rememberMe ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION
                );
                await window.auth.signInWithEmailAndPassword(email, password);
            } catch (err) {
                throw this.parseAuthError(err);
            }
        },

        /**
         * Sign out
         */
        signOut: async function () {
            try {
                this.clearCachedSessionState();
                await window.auth.signOut();
                window.location.replace('login.html');
            } catch (err) {
                console.error('Sign out error:', err);
            }
        },

        /**
         * Send password reset email
         */
        resetPassword: async function (email) {
            try {
                await window.auth.sendPasswordResetEmail(email);
            } catch (err) {
                throw this.parseAuthError(err);
            }
        },

        /**
         * Parse Firebase auth errors into user-friendly messages
         */
        parseAuthError: function (err) {
            const errorMap = {
                'auth/user-not-found': 'No account found with this email address.',
                'auth/wrong-password': 'Incorrect password. Please try again.',
                'auth/invalid-email': 'Please enter a valid email address.',
                'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
                'auth/user-disabled': 'This account has been disabled. Contact your administrator.',
                'auth/network-request-failed': 'Network error. Please check your connection.',
                'auth/invalid-credential': 'Invalid email or password. Please try again.'
            };
            return errorMap[err.code] || err.message || 'An unexpected error occurred.';
        },

        /**
         * Check if current user has a specific role
         */
        hasRole: function (role) {
            return this.userProfile && this.userProfile.role === role;
        },

        /**
         * Check if current user is superadmin
         */
        isSuperAdmin: function () {
            return this.hasRole(PharmaFlow.USER_ROLES.SUPERADMIN);
        },

        /**
         * Check if current user is admin or higher
         */
        isAdminOrAbove: function () {
            return this.hasRole(PharmaFlow.USER_ROLES.SUPERADMIN) || this.hasRole(PharmaFlow.USER_ROLES.ADMIN);
        },

        /**
         * Get current business ID — returns selected franchise for superadmins
         */
        getBusinessId: function () {
            // Superadmin franchise selector override
            if (PharmaFlow.selectedBusinessId) {
                return PharmaFlow.selectedBusinessId;
            }
            return this.userProfile ? this.userProfile.businessId : null;
        },

        /**
         * Bind login form events (only on login page)
         */
        bindLoginForm: function () {
            const form = document.getElementById('login-form');
            if (!form) return;

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('login-email').value.trim();
                const password = document.getElementById('login-password').value;
                const errorDiv = document.getElementById('login-error');

                this._setLoginAlertVisible('login-error', false);
                this._setLoginAlertVisible('login-success', false);
                if (errorDiv) errorDiv.classList.remove('login-shake');
                this.setLoginSubmitLoading(true);

                try {
                    await this.signIn(email, password);
                } catch (errMsg) {
                    const msgEl = document.getElementById('login-error-text');
                    const text = typeof errMsg === 'string' ? errMsg : 'Sign in failed. Please try again.';
                    if (msgEl) msgEl.textContent = text;
                    if (errorDiv) {
                        errorDiv.classList.remove('login-shake');
                        void errorDiv.offsetWidth;
                        errorDiv.classList.add('login-shake');
                    }
                    this._setLoginAlertVisible('login-error', true);
                    this.setLoginSubmitLoading(false);
                }
            });
        },

        /**
         * Bind forgot password form events
         */
        bindForgotPasswordForm: function () {
            const forgotLink = document.getElementById('forgot-password-link');
            const backBtn = document.getElementById('back-to-login');
            const loginForm = document.getElementById('login-form');
            const forgotForm = document.getElementById('forgot-password-form');

            if (!forgotLink || !backBtn || !loginForm || !forgotForm) return;

            forgotLink.addEventListener('click', (e) => {
                e.preventDefault();
                loginForm.classList.add('login-hidden');
                forgotForm.classList.remove('login-hidden');
                forgotForm.style.display = '';
                this._setLoginAlertVisible('login-error', false);
                this._setLoginAlertVisible('login-success', false);
            });

            backBtn.addEventListener('click', () => {
                forgotForm.classList.add('login-hidden');
                forgotForm.style.display = 'none';
                loginForm.classList.remove('login-hidden');
                this._setLoginAlertVisible('login-error', false);
                this._setLoginAlertVisible('login-success', false);
            });

            forgotForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('reset-email').value.trim();
                const successDiv = document.getElementById('login-success');
                const btn = document.getElementById('reset-btn');

                this._setLoginAlertVisible('login-error', false);
                this._setLoginAlertVisible('login-success', false);
                btn.disabled = true;

                try {
                    await this.resetPassword(email);
                    successDiv.textContent = 'Password reset email sent. Check your inbox.';
                    this._setLoginAlertVisible('login-success', true);
                } catch (errMsg) {
                    const msgEl = document.getElementById('login-error-text');
                    if (msgEl) msgEl.textContent = errMsg;
                    this._setLoginAlertVisible('login-error', true);
                }

                btn.disabled = false;
            });
        },

        /**
         * Toggle password visibility
         */
        bindPasswordToggle: function () {
            const toggleBtns = document.querySelectorAll('.toggle-password');
            toggleBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const input = btn.parentElement.querySelector('input');
                    const icon = btn.querySelector('i');
                    if (input.type === 'password') {
                        input.type = 'text';
                        icon.classList.replace('fa-eye', 'fa-eye-slash');
                    } else {
                        input.type = 'password';
                        icon.classList.replace('fa-eye-slash', 'fa-eye');
                    }
                });
            });
        }
    };

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => Auth.init());
    } else {
        Auth.init();
    }

    window.PharmaFlow.Auth = Auth;
})();
