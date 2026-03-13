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
                            this.showLoginError('Your franchise has been deactivated. Please contact the system administrator.');
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
                window.location.href = 'login.html';
            }
        },

        /**
         * Show error on login page (for blocked accounts/franchises)
         */
        showLoginError: function (msg) {
            const errorDiv = document.getElementById('login-error');
            if (errorDiv) {
                errorDiv.textContent = msg;
                errorDiv.style.display = 'flex';
            }
            // Reset login button state
            const btn = document.getElementById('login-btn');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span>Sign In</span><i class="fas fa-arrow-right"></i>';
            }
        },

        /**
         * Sign in with email/password
         */
        signIn: async function (email, password) {
            try {
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
                await window.auth.signOut();
                window.location.href = 'login.html';
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
                const btn = document.getElementById('login-btn');
                const errorDiv = document.getElementById('login-error');
                const successDiv = document.getElementById('login-success');

                errorDiv.style.display = 'none';
                successDiv.style.display = 'none';
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner"></span><span>Signing in...</span>';

                try {
                    await this.signIn(email, password);
                } catch (errMsg) {
                    errorDiv.textContent = errMsg;
                    errorDiv.style.display = 'flex';
                    btn.disabled = false;
                    btn.innerHTML = '<span>Sign In</span><i class="fas fa-arrow-right"></i>';
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
                document.getElementById('login-error').style.display = 'none';
                document.getElementById('login-success').style.display = 'none';
            });

            backBtn.addEventListener('click', () => {
                forgotForm.classList.add('login-hidden');
                forgotForm.style.display = 'none';
                loginForm.classList.remove('login-hidden');
                document.getElementById('login-error').style.display = 'none';
                document.getElementById('login-success').style.display = 'none';
            });

            forgotForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const email = document.getElementById('reset-email').value.trim();
                const errorDiv = document.getElementById('login-error');
                const successDiv = document.getElementById('login-success');
                const btn = document.getElementById('reset-btn');

                errorDiv.style.display = 'none';
                successDiv.style.display = 'none';
                btn.disabled = true;

                try {
                    await this.resetPassword(email);
                    successDiv.textContent = 'Password reset email sent. Check your inbox.';
                    successDiv.style.display = 'flex';
                } catch (errMsg) {
                    errorDiv.textContent = errMsg;
                    errorDiv.style.display = 'flex';
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
