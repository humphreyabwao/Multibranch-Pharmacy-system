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
        authorizationReady: false,
        _profileListener: null,
        _authorizationFingerprint: null,
        pendingLoginNoticeKey: 'pf_login_error',
        pendingLoginNoticeDetailKey: 'pf_login_error_detail',

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
                this.authorizationReady = false;
                if (user) {
                    this.currentUser = user;
                    try {
                        await this.loadUserProfile(user.uid);
                        this.authorizationReady = true;
                        this.onAuthSuccess();
                    } catch (err) {
                        let message = 'We could not verify your access. Please sign in again.';
                        if (err.message === 'ACCOUNT_SUSPENDED') {
                            message = this.getAccountSuspensionMessage(this.userProfile);
                        } else if (err.message === 'FRANCHISE_INACTIVE') {
                            message = localStorage.getItem(this.pendingLoginNoticeKey)
                                || this.getFranchiseDeactivationMessage(this._lastInactiveBusinessData || {});
                        } else if (err.message === 'ACCOUNT_NOT_CONFIGURED') {
                            message = 'Your login exists, but no authorized user profile is assigned. Contact the system administrator.';
                        } else if (err.message === 'FRANCHISE_NOT_ASSIGNED') {
                            message = 'Your account is not assigned to a franchise. Contact the system administrator.';
                        } else {
                            console.error('Profile load error:', err);
                        }
                        await this.denyAccess(message);
                    }
                } else {
                    this.stopAuthorizationWatcher();
                    this.currentUser = null;
                    this.userProfile = null;
                    this.authorizationReady = false;
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
                    if (key === 'pf_last_active_business_id' || key === this.pendingLoginNoticeKey || key === this.pendingLoginNoticeDetailKey) continue;
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
            // Authorization must come from the server, never a stale offline profile.
            const doc = await window.db.collection('users').doc(uid).get({ source: 'server' });
            if (!doc.exists) throw new Error('ACCOUNT_NOT_CONFIGURED');

            this.userProfile = { id: doc.id, ...doc.data() };

            if (!['superadmin', 'admin', 'staff'].includes(this.userProfile.role)) {
                throw new Error('ACCOUNT_NOT_CONFIGURED');
            }
            if (this.userProfile.permissionsConfigured === true && !Array.isArray(this.userProfile.permissions)) {
                throw new Error('ACCOUNT_NOT_CONFIGURED');
            }

            if (this.isProfileSuspended(this.userProfile)) {
                throw new Error('ACCOUNT_SUSPENDED');
            }

            // Enforce franchise isolation: check franchise active state
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
                if (!this.userProfile.businessId) {
                    throw new Error('FRANCHISE_NOT_ASSIGNED');
                }

                // Check if franchise is active
                if (this.userProfile.businessId) {
                    try {
                        const bizDoc = await window.db.collection('businesses').doc(this.userProfile.businessId).get({ source: 'server' });
                        if (!bizDoc.exists) {
                            throw new Error('FRANCHISE_NOT_ASSIGNED');
                        }
                        if (bizDoc.exists && bizDoc.data().isActive === false) {
                            this._lastInactiveBusinessData = bizDoc.data();
                            this.storeFranchiseDeactivationNotice(bizDoc.data());
                            throw new Error('FRANCHISE_INACTIVE');
                        }
                    } catch (bizErr) {
                        if (bizErr.message === 'FRANCHISE_INACTIVE' || bizErr.message === 'FRANCHISE_NOT_ASSIGNED') {
                            throw bizErr;
                        }
                        console.error('Error checking franchise status:', bizErr);
                        throw new Error('PROFILE_VERIFICATION_FAILED');
                    }
                }
            }
        },

        denyAccess: async function (message) {
            this.stopAuthorizationWatcher();
            this.authorizationReady = false;
            this.userProfile = null;
            try {
                localStorage.setItem(this.pendingLoginNoticeKey, message);
            } catch (e) { /* ignore */ }
            try {
                await window.auth.signOut();
            } catch (err) {
                console.error('Failed to close unauthorized session:', err);
            }
            this.currentUser = null;
            if (window.location.pathname.endsWith('login.html')) {
                this.showLoginError(message);
            }
            this.onAuthRequired();
        },

        /**
         * Called when user is authenticated — redirect to dashboard
         */
        onAuthSuccess: function () {
            this.startAuthorizationWatcher();
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

        authorizationFingerprint: function (profile) {
            const permissions = Array.isArray(profile && profile.permissions)
                ? profile.permissions.slice().sort()
                : [];
            return JSON.stringify({
                role: profile && profile.role,
                businessId: profile && profile.businessId,
                status: profile && profile.status,
                permissionsConfigured: profile && profile.permissionsConfigured === true,
                permissions: permissions
            });
        },

        startAuthorizationWatcher: function () {
            this.stopAuthorizationWatcher();
            if (!window.db || !this.currentUser || !this.userProfile) return;

            const uid = this.currentUser.uid;
            this._authorizationFingerprint = this.authorizationFingerprint(this.userProfile);
            this._profileListener = window.db.collection('users').doc(uid).onSnapshot(doc => {
                if (!doc.exists) {
                    this.denyAccess('Your authorized user profile was removed. Contact the system administrator.');
                    return;
                }

                const nextProfile = { id: doc.id, ...doc.data() };
                const nextFingerprint = this.authorizationFingerprint(nextProfile);
                if (nextFingerprint === this._authorizationFingerprint) return;

                this._authorizationFingerprint = nextFingerprint;
                if (this.isProfileSuspended(nextProfile)) {
                    this.denyAccess(this.getAccountSuspensionMessage(nextProfile));
                    return;
                }

                // Rebuild every listener and route from the newly issued tenant/permissions.
                window.location.reload();
            }, err => {
                console.error('Authorization watcher error:', err);
                this.denyAccess('We could not continuously verify your access. Please sign in again.');
            });
        },

        stopAuthorizationWatcher: function () {
            if (this._profileListener) {
                try { this._profileListener(); } catch (e) { /* ignore */ }
            }
            this._profileListener = null;
            this._authorizationFingerprint = null;
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
            const actionsEl = document.getElementById('login-error-actions');
            if (msgEl) msgEl.textContent = msg || '';
            this.renderLoginErrorActions(actionsEl, this.getStoredLoginNoticeDetail());
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
            return this.getFranchiseDeactivationMessage(businessData);
        },

        getFranchiseDeactivationMessage: function (businessData) {
            const reason = businessData && (businessData.suspensionReason || businessData.inactiveReason || businessData.deactivationReason);
            const status = businessData && (businessData.deactivationStatus || businessData.billingStatus || businessData.paymentStatus);
            const amount = businessData && (businessData.deactivationAmount || businessData.amountDue || businessData.planAmount);
            const currency = businessData && (businessData.deactivationCurrency || businessData.currency || 'KES');
            const parts = ['This franchise has been deactivated.'];
            if (status) parts.push('Status: ' + this.humanizeStatus(status) + '.');
            if (reason) parts.push('Reason: ' + reason + '.');
            if (amount) parts.push('Amount due: ' + this.formatNoticeMoney(amount, currency) + '.');
            if (businessData && businessData.deactivationTillNumber) parts.push('Till: ' + businessData.deactivationTillNumber + '.');
            if (businessData && businessData.deactivationPaybillNumber) {
                parts.push('Paybill: ' + businessData.deactivationPaybillNumber + (businessData.deactivationAccountNumber ? ', Account: ' + businessData.deactivationAccountNumber : '') + '.');
            }
            if (businessData && businessData.deactivationPaymentNumber) parts.push('Payment number: ' + businessData.deactivationPaymentNumber + '.');
            parts.push('Please contact the system administrator.');
            return parts.join(' ');
        },

        buildFranchiseDeactivationDetail: function (businessData) {
            businessData = businessData || {};
            return {
                showPayNow: businessData.deactivationShowPayNow === true || businessData.showPayNow === true || businessData.billingStatus === 'overdue' || businessData.deactivationStatus === 'overdue',
                paymentUrl: businessData.deactivationPaymentUrl || businessData.paymentUrl || '',
                status: businessData.deactivationStatus || businessData.billingStatus || businessData.paymentStatus || '',
                amount: businessData.deactivationAmount || businessData.amountDue || businessData.planAmount || '',
                currency: businessData.deactivationCurrency || businessData.currency || 'KES',
                tillNumber: businessData.deactivationTillNumber || businessData.tillNumber || '',
                paybillNumber: businessData.deactivationPaybillNumber || businessData.paybillNumber || '',
                accountNumber: businessData.deactivationAccountNumber || businessData.accountNumber || '',
                paymentNumber: businessData.deactivationPaymentNumber || businessData.paymentNumber || '',
                instructions: businessData.deactivationPaymentInstructions || businessData.paymentInstructions || ''
            };
        },

        storeFranchiseDeactivationNotice: function (businessData) {
            const message = this.getFranchiseDeactivationMessage(businessData);
            const detail = this.buildFranchiseDeactivationDetail(businessData);
            try {
                localStorage.setItem(this.pendingLoginNoticeKey, message);
                localStorage.setItem(this.pendingLoginNoticeDetailKey, JSON.stringify(detail));
            } catch (e) { /* ignore */ }
            return message;
        },

        getStoredLoginNoticeDetail: function () {
            try {
                const raw = localStorage.getItem(this.pendingLoginNoticeDetailKey);
                return raw ? JSON.parse(raw) : null;
            } catch (err) {
                return null;
            }
        },

        renderLoginErrorActions: function (actionsEl, detail) {
            if (!actionsEl) return;
            actionsEl.innerHTML = '';
            this._setLoginAlertVisible('login-error-actions', false);
            if (!detail || !detail.showPayNow) return;

            const lines = [];
            if (detail.status) lines.push('Status: ' + this.humanizeStatus(detail.status));
            if (detail.amount) lines.push('Amount: ' + this.formatNoticeMoney(detail.amount, detail.currency || 'KES'));
            if (detail.tillNumber) lines.push('Till: ' + detail.tillNumber);
            if (detail.paybillNumber) lines.push('Paybill: ' + detail.paybillNumber + (detail.accountNumber ? ' / Account: ' + detail.accountNumber : ''));
            if (detail.paymentNumber) lines.push('Payment number: ' + detail.paymentNumber);
            if (detail.instructions) lines.push(detail.instructions);

            const details = document.createElement('small');
            details.textContent = lines.join(' | ');
            actionsEl.appendChild(details);

            const payBtn = document.createElement('button');
            payBtn.type = 'button';
            payBtn.className = 'login-pay-now-btn';
            payBtn.textContent = 'Pay Now';
            payBtn.addEventListener('click', () => {
                if (detail.paymentUrl && window.open) {
                    window.open(detail.paymentUrl, '_blank', 'noopener');
                } else if (window.alert) {
                    window.alert(lines.join('\n') || 'Please contact the system administrator for payment instructions.');
                }
            });
            actionsEl.appendChild(payBtn);
            this._setLoginAlertVisible('login-error-actions', true);
        },

        humanizeStatus: function (status) {
            return String(status || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        },

        formatNoticeMoney: function (amount, currency) {
            const num = parseFloat(amount);
            if (!isFinite(num)) return String(amount || '');
            return (currency || 'KES') + ' ' + new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
        },

        isProfileSuspended: function (profile) {
            if (!profile) return false;
            const status = String(profile.status || '').toLowerCase();
            return status === 'disabled'
                || status === 'suspended'
                || profile.active === false
                || profile.isActive === false;
        },

        getAccountSuspensionMessage: function (profile) {
            const reason = profile && (profile.suspensionReason || profile.disabledReason || profile.inactiveReason);
            return reason
                ? 'Your account has been suspended. Reason: ' + reason
                : 'Your account has been suspended. Please contact your administrator.';
        },

        consumeStoredLoginNotice: function () {
            try {
                const msg = localStorage.getItem(this.pendingLoginNoticeKey);
                if (!msg) return;
                const detail = this.getStoredLoginNoticeDetail();
                localStorage.removeItem(this.pendingLoginNoticeKey);
                localStorage.removeItem(this.pendingLoginNoticeDetailKey);
                this.showLoginError(msg);
                if (detail) this.renderLoginErrorActions(document.getElementById('login-error-actions'), detail);
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
                this.stopAuthorizationWatcher();
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
                'auth/user-disabled': 'This account has been suspended. Contact your administrator.',
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
         * Fail-closed module permission check used by both sidebar and router.
         */
        canAccess: function (moduleId, subModuleId) {
            const profile = this.userProfile;
            if (!this.authorizationReady || !profile || !moduleId) return false;
            if (profile.role === 'superadmin') return true;

            const permissions = Array.isArray(profile.permissions) ? profile.permissions : [];
            const isExplicit = profile.permissionsConfigured === true || permissions.length > 0;

            // Legacy profiles without an explicit permission configuration retain full access.
            if (!isExplicit) return true;

            if (subModuleId) {
                return permissions.includes(moduleId + ':' + subModuleId);
            }

            return permissions.includes(moduleId)
                || permissions.some(permission => permission.startsWith(moduleId + ':'));
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
            const profile = this.userProfile;
            if (!this.authorizationReady || !profile) return null;

            // Only a verified superadmin may switch tenant context.
            if (profile.role === 'superadmin') {
                return PharmaFlow.selectedBusinessId || profile.businessId || null;
            }

            // Franchise users are permanently pinned to their assigned workspace.
            return profile.businessId || null;
        },

        setActiveBusinessId: function (businessId) {
            const profile = this.userProfile;
            if (!this.authorizationReady || !profile) return false;

            if (profile.role !== 'superadmin') {
                PharmaFlow.selectedBusinessId = null;
                return businessId === profile.businessId;
            }

            if (businessId != null && businessId !== '' && !this.isValidBusinessId(businessId)) {
                return false;
            }
            PharmaFlow.selectedBusinessId = businessId || null;
            return true;
        },

        isValidBusinessId: function (businessId) {
            return typeof businessId === 'string'
                && businessId.length > 0
                && businessId.length <= 128
                && businessId.indexOf('/') === -1;
        },

        canAccessBusiness: function (businessId) {
            if (!this.authorizationReady || !this.userProfile || !this.isValidBusinessId(businessId)) return false;
            return this.userProfile.role === 'superadmin' || this.userProfile.businessId === businessId;
        },

        assertBusinessAccess: function (businessId) {
            if (!this.canAccessBusiness(businessId)) {
                throw new Error('TENANT_ACCESS_DENIED');
            }
            return businessId;
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
