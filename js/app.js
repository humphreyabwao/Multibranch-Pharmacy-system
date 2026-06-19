/**
 * PharmaFlow - Main Application Controller
 * Initializes all modules, manages theme, profile dropdown, panels, overlays,
 * and real-time notifications & messages across all modules.
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};
    // Global selected business ID for franchise selector (superadmin switching)
    PharmaFlow.selectedBusinessId = PharmaFlow.selectedBusinessId || null;

    const App = {
        // Real-time listener unsubscribers for notifications & messages
        _notifListeners: [],
        _msgListeners: [],
        _authInitialized: false,
        _franchiseListenerBound: false,
        _messagePreviewItems: [],
        _businessStatusListener: null,
        _regionalRefreshTimer: null,
        _expiryScanTimer: null,

        /**
         * Initialize the application
         */
        init: function () {
            this.initTheme();
            this.initProfileDropdown();
            this.initPanels();
            this.initOverlay();
            this.initRouter();
            this.initSidebar();
            this.listenAuthReady();
            this.listenRegionalSettingsUpdates();
        },

        /**
         * Initialize sidebar module
         */
        initSidebar: function () {
            if (PharmaFlow.Sidebar) {
                PharmaFlow.Sidebar.init();
            }
        },

        /**
         * Initialize router module
         */
        initRouter: function () {
            if (PharmaFlow.Router) {
                PharmaFlow.Router.init();
            }
        },

        /**
         * Listen for auth ready event to update UI with user info
         */
        listenAuthReady: function () {
            window.addEventListener('auth-ready', (e) => {
                const { user, profile } = e.detail;
                this.updateUserUI(user, profile);

                // Re-render sidebar with role-based filtering
                if (profile && PharmaFlow.Sidebar) {
                    PharmaFlow.Sidebar.updateForRole(profile.role);
                }

                // Manage franchise selector visibility based on role
                if (profile && profile.role === PharmaFlow.USER_ROLES.SUPERADMIN) {
                    this.showFranchiseSelector();
                    this.loadBusinesses();
                } else {
                    this.hideFranchiseSelector();
                }

                // Start real-time notifications & messages
                const activeBizId = PharmaFlow.Auth ? PharmaFlow.Auth.getBusinessId() : (profile ? profile.businessId : null);
                if (activeBizId) {
                    this.startNotifications(activeBizId, user.uid);
                    this.startMessages(activeBizId, user.uid);
                    this.startBusinessStatusWatcher(activeBizId);
                    this.startExpiryMonitor(activeBizId);

                    // Run scheduled activity log cleanup
                    if (PharmaFlow.ActivityLog) PharmaFlow.ActivityLog.runScheduledCleanup();
                }

                this._authInitialized = true;
            });

            // Re-establish listeners when business changes (superadmin switching)
            window.addEventListener('business-changed', (e) => {
                const { businessId } = e.detail;
                if (businessId) {
                    const uid = PharmaFlow.Auth && PharmaFlow.Auth.currentUser ? PharmaFlow.Auth.currentUser.uid : null;
                    this.startNotifications(businessId, uid);
                    this.startMessages(businessId, uid);
                    this.startBusinessStatusWatcher(businessId);
                    this.startExpiryMonitor(businessId);
                }
            });
        },

        startExpiryMonitor: function (businessId) {
            if (this._expiryScanTimer) {
                clearInterval(this._expiryScanTimer);
                this._expiryScanTimer = null;
            }
            if (!businessId || !PharmaFlow.Disposals) return;
            const scan = (force) => {
                PharmaFlow.Disposals.syncExpiredInventory(businessId, force ? { force: true } : undefined).catch(err => {
                    console.error('Automatic expired stock sync failed:', err);
                });
            };
            scan(true);
            this._expiryScanTimer = setInterval(() => scan(true), 15 * 60 * 1000);
        },

        startBusinessStatusWatcher: function (businessId) {
            const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
            if (!window.db || !businessId || !profile || profile.role === 'superadmin') return;
            if (this._businessStatusListener) {
                try { this._businessStatusListener(); } catch (e) { /* ignore */ }
                this._businessStatusListener = null;
            }

            this._businessStatusListener = window.db.collection('businesses').doc(businessId)
                .onSnapshot(doc => {
                    if (!doc.exists) return;
                    const data = doc.data() || {};
                    if (data.isActive === false) {
                        const reason = data.suspensionReason || data.inactiveReason || data.deactivationReason || 'Please contact the system administrator.';
                        try {
                            localStorage.setItem('pf_login_error', 'This branch has been suspended. Reason: ' + reason);
                        } catch (e) { /* ignore */ }
                        if (PharmaFlow.Auth) {
                            PharmaFlow.Auth.signOut();
                        } else if (window.auth) {
                            window.auth.signOut().finally(() => window.location.replace('login.html'));
                        }
                    }
                }, err => console.error('Business status listener error:', err));
        },

        listenRegionalSettingsUpdates: function () {
            window.addEventListener('regional-settings-updated', () => {
                clearTimeout(this._regionalRefreshTimer);
                this._regionalRefreshTimer = setTimeout(() => {
                    if (!PharmaFlow.Router || !PharmaFlow.Router.currentModuleId) return;
                    if (PharmaFlow.Router.currentModuleId === 'settings' && PharmaFlow.Router.currentSubModuleId === 'system-settings') {
                        return;
                    }
                    PharmaFlow.Router.navigateTo(
                        PharmaFlow.Router.currentModuleId,
                        PharmaFlow.Router.currentSubModuleId
                    );
                }, 120);
            });
        },

        /**
         * Update UI elements with user info
         */
        updateUserUI: function (user, profile) {
            const displayName = profile ? (profile.displayName || profile.email) : (user.displayName || user.email);
            const role = profile ? profile.role : 'staff';

            const profileName = document.getElementById('profile-name');
            if (profileName) profileName.textContent = displayName;

            const dropdownName = document.getElementById('dropdown-user-name');
            if (dropdownName) dropdownName.textContent = displayName;

            const dropdownRole = document.getElementById('dropdown-user-role');
            if (dropdownRole) {
                dropdownRole.textContent = role.charAt(0).toUpperCase() + role.slice(1);
            }

            // Set avatar — use photo if available, otherwise initials
            const avatar = document.getElementById('profile-avatar');
            if (avatar && displayName) {
                const photoURL = profile ? profile.photoURL : null;
                if (photoURL) {
                    avatar.innerHTML = `<img src="${photoURL}" alt="Profile" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
                } else {
                    const initials = displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                    avatar.innerHTML = `<span>${initials}</span>`;
                }
            }
        },

        /**
         * Show franchise selector dropdown
         */
        showFranchiseSelector: function () {
            const selector = document.getElementById('franchise-selector');
            if (selector) selector.style.display = 'block';
        },

        /**
         * Hide franchise selector dropdown
         */
        hideFranchiseSelector: function () {
            const selector = document.getElementById('franchise-selector');
            if (selector) selector.style.display = 'none';
        },

        /**
         * Load businesses for franchise selector (superadmin)
         */
        loadBusinesses: async function () {
            if (!window.db) return;
            const select = document.getElementById('franchise-select');
            if (!select) return;

            try {
                const snapshot = await window.db.collection('businesses').get();
                // Clear except default option
                select.innerHTML = '<option value="">All Businesses</option>';
                snapshot.forEach(doc => {
                    const data = doc.data();
                    const option = document.createElement('option');
                    option.value = doc.id;
                    option.textContent = data.name || doc.id;
                    select.appendChild(option);
                });

                // If user has a businessId, pre-select it
                const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
                if (profile && profile.businessId) {
                    select.value = profile.businessId;
                    PharmaFlow.selectedBusinessId = profile.businessId;
                }

                // Only bind the change listener once
                if (!this._franchiseListenerBound) {
                    this._franchiseListenerBound = true;
                    select.addEventListener('change', () => {
                        const selectedBusinessId = select.value;
                        // Store selected business globally so all modules pick it up
                        PharmaFlow.selectedBusinessId = selectedBusinessId || null;
                        window.dispatchEvent(new CustomEvent('business-changed', {
                            detail: { businessId: selectedBusinessId }
                        }));
                        // Re-render the current active module with the new business data
                        if (PharmaFlow.Router && PharmaFlow.Router.currentModuleId) {
                            PharmaFlow.Router.navigateTo(
                                PharmaFlow.Router.currentModuleId,
                                PharmaFlow.Router.currentSubModuleId
                            );
                        }
                    });
                }
            } catch (err) {
                console.error('Error loading businesses:', err);
            }
        },

        /* ===========================
         * THEME (Dark/Light Mode)
         * =========================== */
        initTheme: function () {
            const themeToggle = document.getElementById('theme-toggle');
            const themeIcon = document.getElementById('theme-icon');
            if (!themeToggle || !themeIcon) return;

            // Load saved theme
            const savedTheme = localStorage.getItem('pf_theme') || 'light';
            document.documentElement.setAttribute('data-theme', savedTheme);
            this.updateThemeIcon(savedTheme, themeIcon);

            themeToggle.addEventListener('click', () => {
                const current = document.documentElement.getAttribute('data-theme');
                const next = current === 'light' ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', next);
                localStorage.setItem('pf_theme', next);
                this.updateThemeIcon(next, themeIcon);
            });
        },

        updateThemeIcon: function (theme, iconEl) {
            if (theme === 'dark') {
                iconEl.classList.replace('fa-moon', 'fa-sun');
            } else {
                iconEl.classList.replace('fa-sun', 'fa-moon');
            }
        },

        /* ===========================
         * PROFILE DROPDOWN
         * =========================== */
        initProfileDropdown: function () {
            const profileBtn = document.getElementById('profile-btn');
            const profileMenu = document.getElementById('profile-menu');
            if (!profileBtn || !profileMenu) return;

            profileBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                profileMenu.classList.toggle('show');
            });

            // Close on outside click
            document.addEventListener('click', (e) => {
                if (!profileMenu.contains(e.target) && !profileBtn.contains(e.target)) {
                    profileMenu.classList.remove('show');
                }
            });

            // Handle dropdown actions
            profileMenu.querySelectorAll('.dropdown-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    const action = item.dataset.action;
                    profileMenu.classList.remove('show');

                    switch (action) {
                        case 'logout':
                            if (PharmaFlow.Auth) PharmaFlow.Auth.signOut();
                            break;
                        case 'profile':
                            if (PharmaFlow.Sidebar) PharmaFlow.Sidebar.setActive('settings', 'my-profile');
                            break;
                        case 'settings':
                            if (PharmaFlow.Sidebar) PharmaFlow.Sidebar.setActive('settings', 'business-profile');
                            break;
                    }
                });
            });
        },

        /* ===========================
         * SLIDE PANELS (Messages / Notifications)
         * =========================== */
        initPanels: function () {
            const messagesBtn = document.getElementById('messages-btn');
            const notificationsBtn = document.getElementById('notifications-btn');
            const messagesPanel = document.getElementById('messages-panel');
            const notificationsPanel = document.getElementById('notifications-panel');
            const overlay = document.getElementById('overlay');

            if (messagesBtn && messagesPanel) {
                messagesBtn.addEventListener('click', () => {
                    this.closeAllPanels();
                    messagesPanel.classList.add('open');
                    if (overlay) overlay.classList.add('show');
                    // Mark messages as read when panel is opened
                    this.markMessagesRead();
                });
            }

            if (notificationsBtn && notificationsPanel) {
                notificationsBtn.addEventListener('click', () => {
                    this.closeAllPanels();
                    notificationsPanel.classList.add('open');
                    if (overlay) overlay.classList.add('show');
                    // Mark notifications as read when panel is opened
                    this.markNotificationsRead();
                });
            }

            // Close buttons on panels
            document.querySelectorAll('.slide-panel-close').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.closeAllPanels();
                });
            });
        },

        closeAllPanels: function () {
            document.querySelectorAll('.slide-panel').forEach(p => p.classList.remove('open'));
            const overlay = document.getElementById('overlay');
            if (overlay) overlay.classList.remove('show');
        },

        /* ===========================
         * OVERLAY
         * =========================== */
        initOverlay: function () {
            const overlay = document.getElementById('overlay');
            if (!overlay) return;

            overlay.addEventListener('click', () => {
                this.closeAllPanels();
                overlay.classList.remove('show');

                // Close mobile sidebar
                const sidebar = document.getElementById('sidebar');
                if (sidebar) sidebar.classList.remove('mobile-open');
            });
        },

        /* ===================================================================
         * REAL-TIME NOTIFICATIONS SYSTEM
         * Listens to businesses/{businessId}/notifications collection
         * Auto-generates system notifications from inventory & sales events
         * =================================================================== */

        startNotifications: function (businessId, uid) {
            // Cleanup previous listeners
            this._notifListeners.forEach(unsub => { try { unsub(); } catch (e) { /* */ } });
            this._notifListeners = [];

            if (!window.db || !businessId) return;

            // Listen to business notifications collection (real-time)
            const notifRef = getBusinessCollection(businessId, 'notifications');
            if (!notifRef) return;

            const unsub = notifRef
                .orderBy('createdAt', 'desc')
                .limit(50)
                .onSnapshot(snap => {
                    this.renderNotifications(snap);
                }, err => console.error('Notifications listener error:', err));
            this._notifListeners.push(unsub);

            // Listen for inventory alerts (low stock, expiring)
            this._listenInventoryAlerts(businessId);

            // Listen for franchise alerts (payment due, downtime, security, etc.)
            this._listenFranchiseAlertsNotif(businessId);
        },

        /**
         * Listen for franchise alerts and feed into notifications + messages panels
         */
        _listenFranchiseAlertsNotif: function (businessId) {
            const unsub = window.db.collection('franchise_alerts')
                .where('businessId', '==', businessId)
                .onSnapshot(snap => {
                    const typeIcons = {
                        payment_due: 'fas fa-money-bill-wave',
                        warning: 'fas fa-exclamation-triangle',
                        general: 'fas fa-bell',
                        info: 'fas fa-info-circle',
                        downtime: 'fas fa-power-off',
                        security: 'fas fa-shield-halved',
                        maintenance: 'fas fa-wrench'
                    };
                    const typeColors = {
                        payment_due: 'red', warning: 'orange', general: 'blue',
                        info: 'teal', downtime: 'purple', security: 'red', maintenance: 'teal'
                    };
                    const typeLabels = {
                        payment_due: 'Payment Due', warning: 'Warning', general: 'Notice',
                        info: 'Information', downtime: 'Scheduled Downtime', security: 'Security Update', maintenance: 'Maintenance'
                    };

                    this._franchiseAlerts = snap.docs.map(doc => {
                        const data = doc.data();
                        const time = data.createdAt
                            ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt)
                            : new Date().toISOString();
                        return {
                            id: 'fa-' + doc.id,
                            _alertId: doc.id,
                            type: 'franchise-alert',
                            alertType: data.type || 'general',
                            icon: typeIcons[data.type] || 'fas fa-bell',
                            color: typeColors[data.type] || 'blue',
                            title: typeLabels[data.type] || 'Franchise Alert',
                            message: data.message || '',
                            amount: data.amount || 0,
                            dueDate: data.dueDate || '',
                            time: time,
                            read: data.status !== 'active',
                            priority: data.type === 'payment_due' || data.type === 'security' ? 'high' : 'normal',
                            source: 'franchise',
                            status: data.status || 'active',
                            createdBy: data.createdBy || 'System'
                        };
                    });

                    this._renderCombinedNotifications();
                    this._renderCombinedMessages();
                }, err => console.error('Franchise alerts (notif) listener error:', err));
            this._notifListeners.push(unsub);
        },

        /**
         * Listen for inventory changes and auto-create notifications for critical events
         */
        _listenInventoryAlerts: function (businessId) {
            const invRef = getBusinessCollection(businessId, 'inventory');
            if (!invRef) return;

            const unsub = invRef.onSnapshot(snap => {
                const thirtyDaysFromNow = new Date();
                thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const alerts = [];

                snap.forEach(doc => {
                    const data = doc.data();
                    const qty = parseFloat(data.quantity || 0);

                    // Out of stock alert
                    if (qty <= 0) {
                        alerts.push({
                            id: 'oos-' + doc.id,
                            type: 'stock-alert',
                            icon: 'fas fa-exclamation-triangle',
                            color: 'red',
                            title: 'Out of Stock',
                            message: `${data.name || 'Item'} is out of stock. Reorder now.`,
                            time: new Date().toISOString(),
                            priority: 'high'
                        });
                    }
                    // Low stock alert (1-5)
                    else if (qty > 0 && qty <= 5) {
                        alerts.push({
                            id: 'low-' + doc.id,
                            type: 'stock-alert',
                            icon: 'fas fa-box-open',
                            color: 'orange',
                            title: 'Low Stock Warning',
                            message: `${data.name || 'Item'} has only ${qty} units remaining.`,
                            time: new Date().toISOString(),
                            priority: 'medium'
                        });
                    }

                    // Expiring soon alert
                    if (data.expiryDate) {
                        const exp = new Date(data.expiryDate);
                        if (exp <= thirtyDaysFromNow && exp >= today) {
                            const daysLeft = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
                            alerts.push({
                                id: 'exp-' + doc.id,
                                type: 'expiry-alert',
                                icon: 'fas fa-calendar-xmark',
                                color: 'red',
                                title: 'Expiring Soon',
                                message: `${data.name || 'Item'} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.`,
                                time: new Date().toISOString(),
                                priority: daysLeft <= 7 ? 'high' : 'medium'
                            });
                        }
                        // Already expired
                        if (exp < today) {
                            alerts.push({
                                id: 'expired-' + doc.id,
                                type: 'expiry-alert',
                                icon: 'fas fa-skull-crossbones',
                                color: 'red',
                                title: 'EXPIRED',
                                message: `${data.name || 'Item'} has expired! Remove from shelves.`,
                                time: new Date().toISOString(),
                                priority: 'critical'
                            });
                        }
                    }
                });

                // Store system-generated alerts for rendering alongside Firestore notifications
                this._systemAlerts = alerts;
                this._renderCombinedNotifications();
            }, err => console.error('Inventory alerts listener error:', err));
            this._notifListeners.push(unsub);
        },

        _firestoreNotifSnap: null,
        _systemAlerts: [],
        _franchiseAlerts: [],

        renderNotifications: function (snap) {
            this._firestoreNotifSnap = snap;
            this._renderCombinedNotifications();
        },

        _renderCombinedNotifications: function () {
            const listEl = document.getElementById('notifications-list');
            const badge = document.getElementById('notifications-badge');
            if (!listEl) return;

            const items = [];

            // Add Firestore notifications
            if (this._firestoreNotifSnap) {
                this._firestoreNotifSnap.forEach(doc => {
                    const data = doc.data();
                    items.push({
                        id: doc.id,
                        type: data.type || 'general',
                        icon: data.icon || 'fas fa-bell',
                        color: data.color || 'blue',
                        title: data.title || 'Notification',
                        message: data.message || '',
                        time: data.createdAt || '',
                        read: data.read || false,
                        priority: data.priority || 'normal',
                        source: 'firestore'
                    });
                });
            }

            // Add system-generated alerts (inventory)
            if (this._systemAlerts && this._systemAlerts.length > 0) {
                const fsIds = new Set(items.map(i => i.id));
                this._systemAlerts.forEach(alert => {
                    if (!fsIds.has(alert.id)) {
                        items.push({ ...alert, read: false, source: 'system' });
                    }
                });
            }

            // Add franchise alerts
            if (this._franchiseAlerts && this._franchiseAlerts.length > 0) {
                const existingIds = new Set(items.map(i => i.id));
                this._franchiseAlerts.forEach(alert => {
                    if (!existingIds.has(alert.id)) {
                        items.push(alert);
                    }
                });
            }

            // Sort: unread first, then by time
            items.sort((a, b) => {
                if (a.read !== b.read) return a.read ? 1 : -1;
                if (!a.time) return 1;
                if (!b.time) return -1;
                return new Date(b.time) - new Date(a.time);
            });

            // Update badge count (unread)
            const unreadCount = items.filter(i => !i.read).length;
            if (badge) {
                if (unreadCount > 0) {
                    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                    badge.style.display = 'flex';
                } else {
                    badge.style.display = 'none';
                }
            }

            // Render notifications list
            if (items.length === 0) {
                listEl.innerHTML = `
                    <div class="empty-state-small">
                        <i class="fas fa-bell-slash"></i>
                        <p>No notifications</p>
                    </div>`;
                return;
            }

            let html = '<div class="panel-actions">';
            if (unreadCount > 0) {
                html += '<button class="btn btn-sm btn-outline" id="mark-all-notif-read"><i class="fas fa-check-double"></i> Mark All Read</button>';
            }
            html += '<button class="btn btn-sm btn-outline btn-danger-outline" id="clear-all-notif"><i class="fas fa-trash"></i> Clear All</button>';
            html += '</div>';

            html += '<div class="panel-items-list">';
            items.slice(0, 40).forEach(item => {
                const timeStr = item.time ? this._formatNotifTime(item.time) : '';
                const readClass = item.read ? 'panel-item--read' : 'panel-item--unread';
                const priorityClass = item.priority === 'critical' || item.priority === 'high' ? 'panel-item--high' : '';
                html += `
                    <div class="panel-item ${readClass} ${priorityClass}" data-notif-id="${this._escapeAttr(item.id)}" data-source="${item.source}">
                        <div class="panel-item__icon panel-item__icon--${item.color}">
                            <i class="${item.icon}"></i>
                        </div>
                        <div class="panel-item__content">
                            <span class="panel-item__title">${this._escapeHtml(item.title)}</span>
                            <span class="panel-item__msg">${this._escapeHtml(item.message)}</span>
                            <span class="panel-item__time"><i class="fas fa-clock"></i> ${this._escapeHtml(timeStr)}</span>
                        </div>
                    </div>`;
            });
            html += '</div>';

            listEl.innerHTML = html;

            // Bind mark all read
            const markAllBtn = document.getElementById('mark-all-notif-read');
            if (markAllBtn) {
                markAllBtn.addEventListener('click', () => this.markNotificationsRead());
            }

            // Bind clear all
            const clearAllBtn = document.getElementById('clear-all-notif');
            if (clearAllBtn) {
                clearAllBtn.addEventListener('click', () => this.clearAllNotifications());
            }
        },

        markNotificationsRead: function () {
            if (!window.db || !this._firestoreNotifSnap) return;
            const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
            if (!profile || !profile.businessId) return;

            const batch = window.db.batch();
            this._firestoreNotifSnap.forEach(doc => {
                if (!doc.data().read) {
                    batch.update(doc.ref, { read: true });
                }
            });
            batch.commit().catch(err => console.error('Error marking notifications read:', err));

            // Clear system alert unread state visually
            this._systemAlerts = this._systemAlerts.map(a => ({ ...a, read: true }));
            this._renderCombinedNotifications();
        },

        clearAllNotifications: function () {
            if (!window.db || !this._firestoreNotifSnap) return;
            const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
            if (!profile || !profile.businessId) return;

            const batch = window.db.batch();
            this._firestoreNotifSnap.forEach(doc => {
                batch.delete(doc.ref);
            });
            batch.commit().catch(err => console.error('Error clearing notifications:', err));
            this._systemAlerts = [];
        },

        /* ===================================================================
         * REAL-TIME MESSAGES SYSTEM
         * Listens to businesses/{businessId}/messages collection
         * Supports user-to-user and admin broadcast messages
         * =================================================================== */

        _firestoreMsgSnap: null,
        _msgUid: null,

        startMessages: function (businessId, uid) {
            // Cleanup previous listeners
            this._msgListeners.forEach(unsub => { try { unsub(); } catch (e) { /* */ } });
            this._msgListeners = [];
            this._msgUid = uid;

            if (!window.db || !businessId) return;

            // Listen to business messages (all staff can see broadcast messages)
            const msgRef = getBusinessCollection(businessId, 'messages');
            if (!msgRef) return;

            const unsub = msgRef
                .orderBy('createdAt', 'desc')
                .limit(50)
                .onSnapshot(snap => {
                    this._firestoreMsgSnap = snap;
                    this._renderCombinedMessages();
                }, err => console.error('Messages listener error:', err));
            this._msgListeners.push(unsub);
        },

        _renderCombinedMessages: function () {
            const uid = this._msgUid;
            const listEl = document.getElementById('messages-list');
            const badge = document.getElementById('messages-badge');
            if (!listEl) return;

            const items = [];

            // Add Firestore messages
            if (this._firestoreMsgSnap) {
                this._firestoreMsgSnap.forEach(doc => {
                    const data = doc.data();
                    if (!data.recipientId || data.recipientId === uid || data.recipientId === 'all') {
                        items.push({
                            id: doc.id,
                            senderName: data.senderName || 'Admin',
                            senderAvatar: data.senderAvatar || '',
                            subject: data.subject || '',
                            message: data.message || data.body || '',
                            time: data.createdAt || '',
                            read: data.read || false,
                            readBy: data.readBy || [],
                            type: data.type || 'general',
                            priority: data.priority || 'normal',
                            source: 'firestore'
                        });
                    }
                });
            }

            // Add franchise alerts as messages
            if (this._franchiseAlerts && this._franchiseAlerts.length > 0) {
                const typeLabels = {
                    payment_due: 'Payment Due', warning: 'Warning', general: 'Notice',
                    info: 'Information', downtime: 'Scheduled Downtime',
                    security: 'Security Update', maintenance: 'Maintenance'
                };
                const existingIds = new Set(items.map(i => i.id));
                this._franchiseAlerts.forEach(fa => {
                    if (!existingIds.has(fa._alertId)) {
                        items.push({
                            id: fa._alertId,
                            senderName: fa.createdBy || 'System Admin',
                            senderAvatar: '',
                            subject: typeLabels[fa.alertType] || 'Franchise Alert',
                            message: fa.message,
                            time: fa.time,
                            read: fa.status !== 'active',
                            readBy: [],
                            type: 'franchise-alert',
                            priority: fa.priority || 'normal',
                            source: 'franchise'
                        });
                    }
                });
            }

            // Update badge (unread count)
            const unreadCount = items.filter(i =>
                !i.read && !(i.readBy && i.readBy.includes(uid))
            ).length;

            if (badge) {
                if (unreadCount > 0) {
                    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                    badge.style.display = 'flex';
                } else {
                    badge.style.display = 'none';
                }
            }

            // Sort: unread first, then newest first
            items.sort((a, b) => {
                const aUnread = !a.read && !(a.readBy && a.readBy.includes(uid));
                const bUnread = !b.read && !(b.readBy && b.readBy.includes(uid));
                if (aUnread !== bUnread) return aUnread ? -1 : 1;
                if (!a.time) return 1;
                if (!b.time) return -1;
                return new Date(b.time) - new Date(a.time);
            });
            this._messagePreviewItems = items;

            // Render messages list
            if (items.length === 0) {
                listEl.innerHTML = `
                    <div class="empty-state-small">
                        <i class="fas fa-envelope-open"></i>
                        <p>No messages</p>
                    </div>`;
                return;
            }

            // Compose button + actions
            let html = '<div class="panel-actions">';
            html += '<button class="btn btn-sm btn-primary" id="compose-msg-btn"><i class="fas fa-pen"></i> Compose</button>';
            if (unreadCount > 0) {
                html += '<button class="btn btn-sm btn-outline" id="mark-all-msg-read"><i class="fas fa-check-double"></i> Mark All Read</button>';
            }
            html += '</div>';

            // Compose form (hidden by default)
            html += `
                <div class="compose-form" id="compose-form" style="display:none;">
                    <input type="text" id="compose-subject" placeholder="Subject" class="compose-input">
                    <textarea id="compose-body" placeholder="Type your message..." class="compose-textarea" rows="3"></textarea>
                    <div class="compose-actions">
                        <button class="btn btn-sm btn-primary" id="send-msg-btn"><i class="fas fa-paper-plane"></i> Send</button>
                        <button class="btn btn-sm btn-outline" id="cancel-compose-btn">Cancel</button>
                    </div>
                </div>`;

            html += '<div class="panel-items-list">';
            items.forEach(item => {
                const timeStr = item.time ? this._formatNotifTime(item.time) : '';
                const isUnread = !item.read && !(item.readBy && item.readBy.includes(uid));
                const readClass = isUnread ? 'panel-item--unread' : 'panel-item--read';
                const initials = item.senderName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                const priorityClass = item.priority === 'urgent' || item.priority === 'high' ? ' panel-item--high' : '';

                html += `
                    <button class="panel-item message-preview-trigger ${readClass}${priorityClass}" data-msg-id="${this._escapeAttr(item.id)}" type="button">
                        <div class="panel-item__avatar">${this._escapeHtml(initials)}</div>
                        <div class="panel-item__content">
                            <div class="panel-item__header-row">
                                <span class="panel-item__sender">${this._escapeHtml(item.senderName)}</span>
                                <span class="panel-item__time">${this._escapeHtml(timeStr)}</span>
                            </div>
                            <span class="panel-item__subject">${this._escapeHtml(item.subject || 'No Subject')}</span>
                            <span class="panel-item__msg">${this._escapeHtml(item.message).substring(0, 100)}${item.message.length > 100 ? '...' : ''}</span>
                        </div>
                    </button>`;
            });
            html += '</div>';
            html += '<div class="message-preview-window" id="message-preview-window" aria-live="polite"></div>';

            listEl.innerHTML = html;

            // Bind compose toggle
            const composeBtn = document.getElementById('compose-msg-btn');
            const composeForm = document.getElementById('compose-form');
            const cancelBtn = document.getElementById('cancel-compose-btn');
            if (composeBtn && composeForm) {
                composeBtn.addEventListener('click', () => {
                    composeForm.style.display = composeForm.style.display === 'none' ? 'block' : 'none';
                });
            }
            if (cancelBtn && composeForm) {
                cancelBtn.addEventListener('click', () => {
                    composeForm.style.display = 'none';
                });
            }

            // Bind send message
            const sendBtn = document.getElementById('send-msg-btn');
            if (sendBtn) {
                sendBtn.addEventListener('click', () => this._sendMessage());
            }

            // Bind mark all read
            const markAllBtn = document.getElementById('mark-all-msg-read');
            if (markAllBtn) {
                markAllBtn.addEventListener('click', () => this.markMessagesRead());
            }

            listEl.querySelectorAll('.message-preview-trigger').forEach(item => {
                item.addEventListener('click', () => this.openMessagePreview(item.dataset.msgId));
            });
        },

        openMessagePreview: function (messageId) {
            const item = (this._messagePreviewItems || []).find(msg => msg.id === messageId);
            const previewEl = document.getElementById('message-preview-window');
            if (!item || !previewEl) return;

            const timeStr = item.time ? this._formatNotifTime(item.time) : '';
            const priority = item.priority || 'normal';
            previewEl.innerHTML = `
                <div class="message-preview-card">
                    <div class="message-preview-card__top">
                        <div>
                            <small>Message Preview</small>
                            <h4>${this._escapeHtml(item.subject || 'No Subject')}</h4>
                        </div>
                        <button class="message-preview-card__close" id="message-preview-close" type="button" title="Close preview">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="message-preview-card__meta">
                        <span><i class="fas fa-user"></i> ${this._escapeHtml(item.senderName || 'Unknown')}</span>
                        <span><i class="fas fa-clock"></i> ${this._escapeHtml(timeStr)}</span>
                        <span class="message-preview-card__priority message-preview-card__priority--${this._escapeAttr(priority)}">${this._escapeHtml(priority)}</span>
                    </div>
                    <div class="message-preview-card__body">${this._escapeHtml(item.message || 'No message body.')}</div>
                </div>
            `;
            previewEl.classList.add('show');
            previewEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

            const closeBtn = document.getElementById('message-preview-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    previewEl.classList.remove('show');
                    previewEl.innerHTML = '';
                });
            }
        },

        _sendMessage: async function () {
            const subjectEl = document.getElementById('compose-subject');
            const bodyEl = document.getElementById('compose-body');
            if (!subjectEl || !bodyEl) return;

            const subject = subjectEl.value.trim();
            const body = bodyEl.value.trim();
            if (!body) return;

            const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
            const bizId = PharmaFlow.Auth ? PharmaFlow.Auth.getBusinessId() : null;
            if (!profile || !bizId) return;

            const msgRef = getBusinessCollection(bizId, 'messages');
            if (!msgRef) return;

            try {
                await msgRef.add({
                    subject: subject,
                    message: body,
                    senderName: profile.displayName || profile.email || 'User',
                    senderId: profile.id,
                    recipientId: 'all', // Broadcast
                    type: 'broadcast',
                    read: false,
                    readBy: [],
                    createdAt: new Date().toISOString()
                });

                subjectEl.value = '';
                bodyEl.value = '';
                const composeForm = document.getElementById('compose-form');
                if (composeForm) composeForm.style.display = 'none';
            } catch (err) {
                console.error('Error sending message:', err);
            }
        },

        markMessagesRead: function () {
            if (!window.db) return;
            const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
            const uid = PharmaFlow.Auth && PharmaFlow.Auth.currentUser ? PharmaFlow.Auth.currentUser.uid : null;
            const bizId = PharmaFlow.Auth ? PharmaFlow.Auth.getBusinessId() : null;
            if (!profile || !bizId || !uid) return;

            const msgRef = getBusinessCollection(bizId, 'messages');
            if (!msgRef) return;

            msgRef.where('read', '==', false).get().then(snap => {
                const batch = window.db.batch();
                snap.forEach(doc => {
                    const data = doc.data();
                    // For broadcast messages, use readBy array
                    if (data.recipientId === 'all') {
                        const readBy = data.readBy || [];
                        if (!readBy.includes(uid)) {
                            readBy.push(uid);
                            batch.update(doc.ref, { readBy: readBy });
                        }
                    } else if (!data.recipientId || data.recipientId === uid) {
                        batch.update(doc.ref, { read: true });
                    }
                });
                return batch.commit();
            }).catch(err => console.error('Error marking messages read:', err));
        },

        /* ===========================
         * HELPER METHODS
         * =========================== */

        _formatNotifTime: function (isoString) {
            try {
                const date = new Date(isoString);
                const now = new Date();
                const diffMs = now - date;
                const diffMin = Math.floor(diffMs / 60000);
                const diffHr = Math.floor(diffMs / 3600000);
                const diffDay = Math.floor(diffMs / 86400000);

                if (diffMin < 1) return 'Just now';
                if (diffMin < 60) return diffMin + 'm ago';
                if (diffHr < 24) return diffHr + 'h ago';
                if (diffDay < 7) return diffDay + 'd ago';
                return date.toLocaleDateString('en-KE', { day: '2-digit', month: 'short' });
            } catch {
                return '';
            }
        },

        _escapeHtml: function (str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },

        _escapeAttr: function (str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
    };

    // Boot the app on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => App.init());
    } else {
        App.init();
    }

    window.PharmaFlow.App = App;

    // ═══════════════════════════════════════════════════
    //  GLOBAL CONFIRM / ALERT MODAL (replaces native dialogs)
    // ═══════════════════════════════════════════════════

    /**
     * PharmaFlow.confirm(message, options?) → Promise<boolean>
     * Usage:  if (!(await PharmaFlow.confirm('Delete?'))) return;
     *
     *  options.title       – modal title (default: 'Confirm')
     *  options.confirmText – confirm button label (default: 'Confirm')
     *  options.cancelText  – cancel button label  (default: 'Cancel')
     *  options.danger       – if true, confirm btn is red
     */
    window.PharmaFlow.confirm = function (message, options) {
        options = options || {};
        return new Promise(function (resolve) {
            var existing = document.getElementById('pf-confirm-overlay');
            if (existing) existing.remove();

            var title = options.title || 'Confirm';
            var confirmText = options.confirmText || 'Confirm';
            var cancelText = options.cancelText || 'Cancel';
            var danger = options.danger || false;

            var overlay = document.createElement('div');
            overlay.id = 'pf-confirm-overlay';
            overlay.className = 'pf-confirm-overlay';
            overlay.innerHTML =
                '<div class="pf-confirm-box">' +
                    '<div class="pf-confirm-header">' +
                        '<div class="pf-confirm-icon' + (danger ? ' pf-confirm-icon--danger' : '') + '">' +
                            '<i class="fas fa-' + (danger ? 'exclamation-triangle' : 'question-circle') + '"></i>' +
                        '</div>' +
                        '<h3>' + title + '</h3>' +
                    '</div>' +
                    '<div class="pf-confirm-body"><p>' + message + '</p></div>' +
                    '<div class="pf-confirm-actions">' +
                        '<button class="pf-confirm-btn pf-confirm-btn--cancel" id="pf-confirm-no">' + cancelText + '</button>' +
                        '<button class="pf-confirm-btn ' + (danger ? 'pf-confirm-btn--danger' : 'pf-confirm-btn--primary') + '" id="pf-confirm-yes">' + confirmText + '</button>' +
                    '</div>' +
                '</div>';

            document.body.appendChild(overlay);
            requestAnimationFrame(function () { overlay.classList.add('open'); });

            function close(val) {
                overlay.classList.remove('open');
                setTimeout(function () { overlay.remove(); }, 200);
                resolve(val);
            }

            overlay.querySelector('#pf-confirm-yes').addEventListener('click', function () { close(true); });
            overlay.querySelector('#pf-confirm-no').addEventListener('click', function () { close(false); });
            overlay.addEventListener('click', function (e) { if (e.target === overlay) close(false); });
        });
    };

    /** Warning buzzer for danger alerts (Web Audio). */
    function playPfDangerAlertSound() {
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            var ctx = new AC();
            var o = ctx.createOscillator();
            var g = ctx.createGain();
            o.connect(g);
            g.connect(ctx.destination);
            o.type = 'sawtooth';
            o.frequency.setValueAtTime(320, ctx.currentTime);
            o.frequency.setValueAtTime(280, ctx.currentTime + 0.08);
            g.gain.setValueAtTime(0.0001, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
            o.start(ctx.currentTime);
            o.stop(ctx.currentTime + 0.36);
            setTimeout(function () { ctx.close(); }, 450);
        } catch (e) { /* ignore */ }
    }

    /**
     * PharmaFlow.alert(message, options?) → Promise<void>
     * Usage:  await PharmaFlow.alert('Done!');
     *
     *  options.variant  — 'info' (default) | 'danger' (red modal + warning sound)
     *  options.sound    — set false to skip sound when variant is danger
     */
    window.PharmaFlow.alert = function (message, options) {
        options = options || {};
        return new Promise(function (resolve) {
            var existing = document.getElementById('pf-confirm-overlay');
            if (existing) existing.remove();

            var title = options.title || 'Notice';
            var danger = options.variant === 'danger';
            if (danger && options.sound !== false) {
                playPfDangerAlertSound();
            }

            var boxClass = 'pf-confirm-box' + (danger ? ' pf-confirm-box--danger' : '');
            var iconClass = 'pf-confirm-icon' + (danger ? ' pf-confirm-icon--danger' : ' pf-confirm-icon--info');
            var iconName = danger ? 'exclamation-triangle' : 'info-circle';
            var btnClass = danger ? 'pf-confirm-btn pf-confirm-btn--danger pf-confirm-btn--danger-alert-ok' : 'pf-confirm-btn pf-confirm-btn--primary';

            var overlay = document.createElement('div');
            overlay.id = 'pf-confirm-overlay';
            overlay.className = 'pf-confirm-overlay';
            overlay.innerHTML =
                '<div class="' + boxClass + '">' +
                    '<div class="pf-confirm-header">' +
                        '<div class="' + iconClass + '">' +
                            '<i class="fas fa-' + iconName + '"></i>' +
                        '</div>' +
                        '<h3 class="' + (danger ? 'pf-confirm-title--danger' : '') + '">' + title + '</h3>' +
                    '</div>' +
                    '<div class="pf-confirm-body"><p class="' + (danger ? 'pf-confirm-text--danger' : '') + '">' + message + '</p></div>' +
                    '<div class="pf-confirm-actions' + (danger ? ' pf-confirm-actions--danger' : '') + '">' +
                        '<button class="' + btnClass + '" id="pf-confirm-ok">OK</button>' +
                    '</div>' +
                '</div>';

            document.body.appendChild(overlay);
            requestAnimationFrame(function () { overlay.classList.add('open'); });

            function close() {
                overlay.classList.remove('open');
                setTimeout(function () { overlay.remove(); }, 200);
                resolve();
            }

            overlay.querySelector('#pf-confirm-ok').addEventListener('click', close);
            overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        });
    };

    /**
     * Iterate each payment slice on a sale (split legs or single method).
     * @param {{ paymentMethod?: string, paymentSplits?: Array<{method:string,amount:number}>, total?: number }} sale
     * @param {(method: string, amount: number) => void} fn
     */
    window.PharmaFlow.forEachSalePaymentPart = function (sale, fn) {
        if (!sale || typeof fn !== 'function') return;
        if (sale.paymentMethod === 'split' && Array.isArray(sale.paymentSplits) && sale.paymentSplits.length) {
            sale.paymentSplits.forEach(function (p) {
                fn(String(p.method || 'other').toLowerCase(), Number(p.amount) || 0);
            });
        } else {
            fn(String(sale.paymentMethod || 'other').toLowerCase(), Number(sale.total) || 0);
        }
    };

    /**
     * POS / sales list filter: cash | mpesa | card | split (card filter includes bank splits).
     */
    window.PharmaFlow.saleMatchesPaymentFilter = function (sale, payFilter) {
        if (!payFilter) return true;
        if (payFilter === 'split') return sale.paymentMethod === 'split';
        var ok = false;
        PharmaFlow.forEachSalePaymentPart(sale, function (m, amt) {
            if (amt <= 0) return;
            if (payFilter === 'card' && (m === 'card' || m === 'bank')) ok = true;
            else if (m === payFilter) ok = true;
        });
        return ok;
    };

    window.PharmaFlow.roundMoney = function (amount) {
        return Math.round((parseFloat(amount) || 0) * 100) / 100;
    };

    /** VAT on inventory lines where vatEnabled (productVatTotal or per-line productVatAmount). */
    window.PharmaFlow.getProductVatTotal = function (sale) {
        if (!sale) return 0;
        if (sale.productVatTotal != null && sale.productVatTotal !== '') {
            return PharmaFlow.roundMoney(sale.productVatTotal);
        }
        if (!Array.isArray(sale.items) || !sale.items.length) return 0;
        return PharmaFlow.roundMoney(sale.items.reduce(function (sum, item) {
            var lineVat = parseFloat(item.productVatAmount);
            if (!isNaN(lineVat) && lineVat > 0) return sum + lineVat;
            if (item.vatEnabled) return sum + (parseFloat(item.productVatAmount) || 0);
            return sum;
        }, 0));
    };

    /** Optional cart-level VAT at checkout (POS apply VAT). */
    window.PharmaFlow.getCartVatTotal = function (sale) {
        return PharmaFlow.roundMoney(sale && sale.vatAmount);
    };

    window.PharmaFlow.getTotalVat = function (sale) {
        return PharmaFlow.roundMoney(PharmaFlow.getProductVatTotal(sale) + PharmaFlow.getCartVatTotal(sale));
    };

    window.PharmaFlow.getSaleVatBreakdown = function (sale) {
        var productVat = PharmaFlow.getProductVatTotal(sale);
        var cartVat = PharmaFlow.getCartVatTotal(sale);
        return {
            productVat: productVat,
            cartVat: cartVat,
            totalVat: PharmaFlow.roundMoney(productVat + cartVat)
        };
    };

    window.PharmaFlow.VAT_DISPLAY_FORMAT_KEY = 'pf_vat_display_format';

    window.PharmaFlow.getVatDisplayFormat = function () {
        var v = localStorage.getItem(PharmaFlow.VAT_DISPLAY_FORMAT_KEY);
        return (v === 'ksh' || v === 'percent' || v === 'ksh_percent') ? v : 'ksh_percent';
    };

    window.PharmaFlow.setVatDisplayFormat = function (format) {
        if (format === 'ksh' || format === 'percent' || format === 'ksh_percent') {
            localStorage.setItem(PharmaFlow.VAT_DISPLAY_FORMAT_KEY, format);
        }
    };

    window.PharmaFlow.formatKshAmount = function (amount) {
        return PharmaFlow.Settings && PharmaFlow.Settings.formatCurrency
            ? PharmaFlow.Settings.formatCurrency(amount)
            : 'KSH ' + new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
    };

    window.PharmaFlow.getProductVatTaxableBase = function (sale) {
        if (!sale || !Array.isArray(sale.items)) return 0;
        return PharmaFlow.roundMoney(sale.items.reduce(function (sum, item) {
            var lineVat = parseFloat(item.productVatAmount) || 0;
            if (!(lineVat > 0 || item.vatEnabled)) return sum;
            if (item.lineBaseTotal != null && item.lineBaseTotal !== '') {
                return sum + (parseFloat(item.lineBaseTotal) || 0);
            }
            var gross = parseFloat(item.lineGrossTotal) || parseFloat(item.lineTotal) || 0;
            return sum + Math.max(0, gross - lineVat);
        }, 0));
    };

    /** Effective or configured VAT rate (%) for product / cart / total VAT on a sale. */
    window.PharmaFlow.getSaleVatRatePercent = function (sale, kind) {
        if (!sale) return null;
        kind = kind || 'total';
        var productVat = PharmaFlow.getProductVatTotal(sale);
        var cartVat = PharmaFlow.getCartVatTotal(sale);
        var totalVat = PharmaFlow.getTotalVat(sale);
        var amount = kind === 'product' ? productVat : (kind === 'cart' ? cartVat : totalVat);
        if (amount <= 0) return null;

        if (kind === 'product') {
            var rates = [];
            if (Array.isArray(sale.items)) {
                sale.items.forEach(function (item) {
                    if (!item.vatEnabled && !(parseFloat(item.productVatAmount) > 0)) return;
                    if ((item.vatType || 'percent') === 'percent') {
                        var r = parseFloat(item.vatValue);
                        if (!isNaN(r) && r > 0) rates.push(PharmaFlow.roundMoney(r));
                    }
                });
            }
            if (rates.length && rates.every(function (r) { return r === rates[0]; })) return rates[0];
            var base = PharmaFlow.getProductVatTaxableBase(sale);
            if (base > 0) return PharmaFlow.roundMoney((productVat / base) * 100);
            return null;
        }

        if (kind === 'cart') {
            if (sale.vatEnabled && (sale.vatType || 'percent') === 'percent') {
                var cv = parseFloat(sale.vatValue);
                if (!isNaN(cv) && cv > 0) return PharmaFlow.roundMoney(cv);
            }
            var net = parseFloat(sale.netTotal);
            if (isNaN(net) || net <= 0) {
                net = PharmaFlow.roundMoney((parseFloat(sale.subtotal) || 0) - (parseFloat(sale.discountAmount) || 0) + productVat);
            }
            if (net > 0 && cartVat > 0) return PharmaFlow.roundMoney((cartVat / net) * 100);
            return null;
        }

        var beforeVat = PharmaFlow.roundMoney((parseFloat(sale.total) || 0) - totalVat);
        if (beforeVat > 0) return PharmaFlow.roundMoney((totalVat / beforeVat) * 100);
        return null;
    };

    window.PharmaFlow.formatPercentLabel = function (percent) {
        if (percent == null || isNaN(percent) || percent <= 0) return null;
        var n = PharmaFlow.roundMoney(percent);
        return (n % 1 === 0 ? String(Math.round(n)) : String(n)) + '%';
    };

    /**
     * @param {number} amount VAT amount in KSH
     * @param {number|null} percent Rate label e.g. 16
     * @param {'ksh'|'percent'|'ksh_percent'} [format]
     */
    window.PharmaFlow.formatVatAmount = function (amount, percent, format) {
        amount = PharmaFlow.roundMoney(amount);
        format = format || PharmaFlow.getVatDisplayFormat();
        if (amount <= 0) return '—';
        var ksh = PharmaFlow.formatKshAmount(amount);
        var pct = PharmaFlow.formatPercentLabel(percent);
        if (format === 'percent') return pct || ksh;
        if (format === 'ksh') return ksh;
        if (format === 'ksh_percent') return pct ? (ksh + ' (' + pct + ')') : ksh;
        return ksh;
    };

    /** @param {'product'|'cart'|'total'} kind */
    window.PharmaFlow.formatSaleVatDisplay = function (sale, kind, format) {
        kind = kind || 'total';
        format = format || PharmaFlow.getVatDisplayFormat();
        var vat = PharmaFlow.getSaleVatBreakdown(sale);
        var amount = kind === 'product' ? vat.productVat : (kind === 'cart' ? vat.cartVat : vat.totalVat);
        return PharmaFlow.formatVatAmount(amount, PharmaFlow.getSaleVatRatePercent(sale, kind), format);
    };

    window.PharmaFlow.vatFormatSelectHtml = function (selectId, labelText, variant) {
        var cur = PharmaFlow.getVatDisplayFormat();
        var label = labelText || 'VAT display';
        if (variant === 'compact') {
            return '<div class="as-vat-display" role="group" aria-label="VAT column format">' +
                '<label class="as-vat-display__label" for="' + selectId + '">' +
                '<span class="as-vat-display__icon" aria-hidden="true"><i class="fas fa-percent"></i></span>' +
                '<span class="as-vat-display__text">' + label + '</span></label>' +
                '<div class="as-vat-display__control">' +
                '<select id="' + selectId + '" class="as-vat-display__select" title="How VAT columns are shown in the table and exports">' +
                '<option value="ksh"' + (cur === 'ksh' ? ' selected' : '') + '>KSH only</option>' +
                '<option value="percent"' + (cur === 'percent' ? ' selected' : '') + '>% only</option>' +
                '<option value="ksh_percent"' + (cur === 'ksh_percent' ? ' selected' : '') + '>KSH + (rate %)</option>' +
                '</select><span class="as-vat-display__chevron" aria-hidden="true"><i class="fas fa-chevron-down"></i></span>' +
                '</div></div>';
        }
        return '<div class="sales-vat-format">' +
            '<label for="' + selectId + '">' + label + '</label>' +
            '<select id="' + selectId + '" class="form-control sales-vat-format-select" title="How to show VAT amounts">' +
            '<option value="ksh"' + (cur === 'ksh' ? ' selected' : '') + '>KSH amount</option>' +
            '<option value="percent"' + (cur === 'percent' ? ' selected' : '') + '>Percentage (%)</option>' +
            '<option value="ksh_percent"' + (cur === 'ksh_percent' ? ' selected' : '') + '>KSH + % (e.g. KSH 100 (16%))</option>' +
            '</select></div>';
    };

    window.PharmaFlow.bindVatFormatSelect = function (selectEl, onChange) {
        if (!selectEl) return;
        selectEl.value = PharmaFlow.getVatDisplayFormat();
        selectEl.addEventListener('change', function () {
            PharmaFlow.setVatDisplayFormat(selectEl.value);
            if (typeof onChange === 'function') onChange(selectEl.value);
        });
    };

    /** Column headers shared by All Sales export and Reports → Sales Report. */
    window.PharmaFlow.SALE_REPORT_HEADERS = [
        'Receipt #', 'Date', 'Status', 'Items', 'Subtotal', 'Discount',
        'Product VAT', 'Sale VAT', 'Total VAT', 'Total', 'Profit', 'Payment', 'Sold By'
    ];

    window.PharmaFlow.buildSaleReportRow = function (sale, formatDateFn, opts) {
        opts = opts || {};
        var vatFormat = opts.vatFormat || PharmaFlow.getVatDisplayFormat();
        var dateStr = '-';
        if (typeof formatDateFn === 'function') {
            dateStr = formatDateFn(sale) || sale.saleDateStr || '-';
        } else if (sale.saleDateStr) {
            dateStr = sale.saleDateStr;
        }
        var payment = (sale.paymentMethod === 'split' && Array.isArray(sale.paymentSplits) && sale.paymentSplits.length)
            ? 'SPLIT ' + sale.paymentSplits.filter(function (p) { return (p.amount || 0) > 0; })
                .map(function (p) { return String(p.method || '').toUpperCase() + ':' + (p.amount || 0); }).join(', ')
            : String(sale.paymentMethod || '').toUpperCase();
        return [
            sale.saleId || sale.id || '',
            dateStr,
            sale.status || 'completed',
            sale.itemCount || 0,
            sale.subtotal || 0,
            sale.discountAmount || 0,
            PharmaFlow.formatSaleVatDisplay(sale, 'product', vatFormat),
            PharmaFlow.formatSaleVatDisplay(sale, 'cart', vatFormat),
            PharmaFlow.formatSaleVatDisplay(sale, 'total', vatFormat),
            sale.total || 0,
            sale.totalProfit || 0,
            payment,
            sale.soldBy || '-'
        ];
    };
})();
