/**
 * PharmaFlow - Dashboard Module
 * Renders the main dashboard with:
 *   1. Stats cards (real-time Firestore onSnapshot listeners)
 *   2. Quick access buttons
 *   3. Today's activities feed (real-time Firestore onSnapshot listeners)
 *   4. Global search with live Firestore results
 *   5. Refresh button to re-establish all listeners
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    const Dashboard = {

        // Store unsubscribe functions for all real-time listeners
        _listeners: [],
        _searchDebounce: null,
        _isActive: false,
        /** Coalesce rapid Firestore inventory writes into one DOM update */
        _invStatsRaf: null,

        /**
         * Render the full dashboard into the content body
         */
        render: function (container) {
            // Cleanup any previous listeners
            this.cleanup();
            this._isActive = true;

            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="dashboard">
                    <!-- Page Header with Search + Refresh -->
                    <div class="page-header">
                        <div>
                            <h2>Dashboard</h2>
                            <div class="breadcrumb">
                                <span>Home</span><span>/</span><span>Dashboard</span>
                            </div>
                        </div>
                        <div class="page-header-right">
                            <div class="dashboard-search">
                                <i class="fas fa-search"></i>
                                <input type="text" id="dashboard-search-input" placeholder="Search anything... (Ctrl+K)" autocomplete="off" readonly>
                            </div>
                            <button class="btn btn-sm btn-primary dashboard-ticket-btn" id="dashboard-raise-ticket-btn">
                                <i class="fas fa-ticket"></i> Raise Ticket
                            </button>
                            <button class="btn btn-sm btn-outline" id="dashboard-refresh-btn">
                                <i class="fas fa-arrows-rotate"></i> Refresh All
                            </button>
                        </div>
                    </div>

                    <!-- Franchise Alert Banner (payment due notices) -->
                    <div id="dash-franchise-alerts" style="display:none"></div>

                    <!-- Stats Cards Row 1 (5 cards) -->
                    <div class="stats-row" id="stats-grid">
                        <div class="stat-card stat-card--green">
                            <div class="stat-card__icon"><i class="fas fa-receipt"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__value" id="stat-todays-sales">--</span>
                                <span class="stat-card__label">Total Sales Today</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--blue">
                            <div class="stat-card__icon"><i class="fas fa-chart-line"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__value" id="stat-overall-sales">--</span>
                                <span class="stat-card__label">Overall Sales</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--red">
                            <div class="stat-card__icon"><i class="fas fa-file-invoice-dollar"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__value" id="stat-todays-expenses">--</span>
                                <span class="stat-card__label">Total Expenses Today</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--orange">
                            <div class="stat-card__icon"><i class="fas fa-triangle-exclamation"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__value" id="stat-out-of-stock">--</span>
                                <span class="stat-card__label">Out of Stock Items</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--redalt">
                            <div class="stat-card__icon"><i class="fas fa-calendar-xmark"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__value" id="stat-expiring-soon">--</span>
                                <span class="stat-card__label">Items Expiring Soon</span>
                            </div>
                        </div>
                    </div>

                    <!-- Stats Cards Row 2 (5 cards) -->
                    <div class="stats-row">
                        <div class="stat-card stat-card--purple">
                            <div class="stat-card__icon"><i class="fas fa-store"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__value" id="stat-bulk-sales">--</span>
                                <span class="stat-card__label">Bulk Sales Today</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--teal">
                            <div class="stat-card__icon"><i class="fas fa-hospital-user"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__value" id="stat-total-customers">--</span>
                                <span class="stat-card__label">Total Customers</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--green">
                            <div class="stat-card__icon"><i class="fas fa-boxes-stacked"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__value" id="stat-inventory-value">--</span>
                                <span class="stat-card__label">Total Inventory Value</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--blue">
                            <div class="stat-card__icon"><i class="fas fa-prescription"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__value" id="stat-prescriptions-today">--</span>
                                <span class="stat-card__label">Prescriptions Today</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--orange">
                            <div class="stat-card__icon"><i class="fas fa-boxes-stacked"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__value" id="stat-total-products">--</span>
                                <span class="stat-card__label">Total Products</span>
                            </div>
                        </div>
                    </div>

                    <!-- Quick Access Buttons -->
                    <div class="quick-access-grid" id="quick-access-grid">
                        <button class="quick-access-btn quick-access-btn--green" data-navigate="pharmacy" data-sub="pos">
                            <i class="fas fa-cart-shopping"></i>
                            <span>New Sale</span>
                        </button>
                        <button class="quick-access-btn quick-access-btn--blue" data-navigate="inventory" data-sub="add-inventory">
                            <i class="fas fa-plus-circle"></i>
                            <span>Add Item</span>
                        </button>
                        <button class="quick-access-btn quick-access-btn--red" data-navigate="medication-refill" data-sub="create-order">
                            <i class="fas fa-boxes-packing"></i>
                            <span>Create Order</span>
                        </button>
                        <button class="quick-access-btn quick-access-btn--purple" data-navigate="patients" data-sub="add-patient">
                            <i class="fas fa-user-plus"></i>
                            <span>Add Customer</span>
                        </button>
                        <button class="quick-access-btn quick-access-btn--orange" data-navigate="expenses" data-sub="add-expense">
                            <i class="fas fa-file-invoice-dollar"></i>
                            <span>Add Expense</span>
                        </button>
                        <button class="quick-access-btn quick-access-btn--teal" data-navigate="reports" data-sub="generate-report">
                            <i class="fas fa-clipboard-list"></i>
                            <span>Generate Report</span>
                        </button>
                        <button class="quick-access-btn quick-access-btn--indigo" data-navigate="support-tickets" data-sub="raise-ticket">
                            <i class="fas fa-ticket"></i>
                            <span>Raise Ticket</span>
                        </button>
                    </div>

                    <!-- Today's Activities -->
                    <div class="dashboard-section">
                        <div class="dashboard-section__header">
                            <h3>Today's Activities</h3>
                            <span class="activities-live-badge"><i class="fas fa-circle"></i> Live</span>
                            <button class="btn btn-sm btn-outline" id="view-all-activities">
                                View All <i class="fas fa-arrow-right"></i>
                            </button>
                        </div>
                        <div class="activities-card" id="activities-card">
                            <div class="activities-table-wrap">
                                <table class="activities-table">
                                    <thead>
                                        <tr>
                                            <th>TIME</th>
                                            <th>ACTIVITY</th>
                                            <th>USER</th>
                                            <th>AMOUNT</th>
                                            <th>STATUS</th>
                                        </tr>
                                    </thead>
                                    <tbody id="activities-list">
                                        <tr><td colspan="5" class="activities-loading-cell"><div class="spinner"></div> Loading activities...</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Bind quick access buttons
            this.bindQuickAccess(container);

            // Bind header support ticket button
            const raiseTicketBtn = document.getElementById('dashboard-raise-ticket-btn');
            if (raiseTicketBtn) {
                raiseTicketBtn.addEventListener('click', () => {
                    if (PharmaFlow.Sidebar) {
                        PharmaFlow.Sidebar.setActive('support-tickets', 'raise-ticket');
                    }
                });
            }

            // Bind view all activities
            const viewAllBtn = document.getElementById('view-all-activities');
            if (viewAllBtn) {
                viewAllBtn.addEventListener('click', () => {
                    PharmaFlow.Sidebar.setActive('activity-log');
                });
            }

            // Bind refresh button
            this.bindRefreshButton();

            // Bind search with overlay panel
            this.bindSearch(businessId);

            // Start real-time listeners
            this.startRealtimeListeners(businessId);
        },

        /**
         * Clean up all real-time listeners
         */
        cleanup: function () {
            if (this._invStatsRaf != null) {
                cancelAnimationFrame(this._invStatsRaf);
                this._invStatsRaf = null;
            }
            this._isActive = false;
            this._listeners.forEach(unsub => {
                try { unsub(); } catch (e) { /* ignore */ }
            });
            this._listeners = [];
            if (this._searchDebounce) {
                clearTimeout(this._searchDebounce);
                this._searchDebounce = null;
            }
            if (this._gsKeyHandler) {
                document.removeEventListener('keydown', this._gsKeyHandler);
                this._gsKeyHandler = null;
            }
            this._closeSearch();
            // Remove overlay DOM so it's recreated fresh next render
            const overlay = document.getElementById('global-search-overlay');
            if (overlay) overlay.remove();
            this._gsInputBound = false;
        },

        /**
         * Get current business ID from auth
         */
        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        /**
         * Bind quick access button clicks to sidebar navigation
         */
        bindQuickAccess: function (container) {
            container.querySelectorAll('.quick-access-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const moduleId = btn.dataset.navigate;
                    const subId = btn.dataset.sub || null;
                    if (moduleId && PharmaFlow.Sidebar) {
                        PharmaFlow.Sidebar.setActive(moduleId, subId);
                    }
                });
            });
        },

        /**
         * Bind refresh button — tears down and re-establishes all listeners
         */
        bindRefreshButton: function () {
            const refreshBtn = document.getElementById('dashboard-refresh-btn');
            if (!refreshBtn) return;

            refreshBtn.addEventListener('click', () => {
                const icon = refreshBtn.querySelector('i');
                if (icon) icon.classList.add('fa-spin');
                refreshBtn.disabled = true;

                // Tear down existing listeners
                this._listeners.forEach(unsub => {
                    try { unsub(); } catch (e) { /* ignore */ }
                });
                this._listeners = [];

                // Reset all stats to loading
                this.setAllStats('--');

                const listEl = document.getElementById('activities-list');
                if (listEl) {
                    listEl.innerHTML = '<tr><td colspan="5" class="activities-loading-cell"><div class="spinner"></div> Refreshing...</td></tr>';
                }

                // Re-establish listeners (always use current franchise / branch)
                setTimeout(() => {
                    const bid = this.getBusinessId();
                    if (bid) this.startRealtimeListeners(bid);
                    if (icon) icon.classList.remove('fa-spin');
                    refreshBtn.disabled = false;
                }, 100);
            });
        },

        /**
         * Bind global search — opens a centered overlay panel (command-palette style)
         */
        bindSearch: function (businessId) {
            const trigger = document.getElementById('dashboard-search-input');
            if (!trigger) return;

            // Build the overlay once
            this._ensureSearchOverlay();

            trigger.addEventListener('click', () => this._openSearch(businessId));
            trigger.addEventListener('focus', () => this._openSearch(businessId));

            // Global Ctrl+K / Cmd+K shortcut
            this._gsKeyHandler = (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                    e.preventDefault();
                    this._openSearch(businessId);
                }
            };
            document.addEventListener('keydown', this._gsKeyHandler);
        },

        /**
         * Ensure the search overlay DOM exists (created once, reused)
         */
        _ensureSearchOverlay: function () {
            if (document.getElementById('global-search-overlay')) return;
            const overlay = document.createElement('div');
            overlay.id = 'global-search-overlay';
            overlay.className = 'global-search-overlay';
            overlay.innerHTML = `
                <div class="global-search-panel" id="global-search-panel">
                    <div class="global-search-header">
                        <i class="fas fa-search"></i>
                        <input type="text" id="gs-input" placeholder="Search modules, customers, sales, stock, orders, tickets..." autocomplete="off">
                        <button class="gs-close-btn" id="gs-close-btn">ESC</button>
                    </div>
                    <div class="global-search-body" id="gs-body">
                        <div class="gs-section-label">Quick Navigation</div>
                        <div id="gs-quick-links"></div>
                    </div>
                    <div class="gs-footer">
                        <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> Navigate</span>
                        <span><kbd>Enter</kbd> Open</span>
                        <span><kbd>Esc</kbd> Close</span>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            // Close on overlay background click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this._closeSearch();
            });
            document.getElementById('gs-close-btn').addEventListener('click', () => this._closeSearch());
        },

        /**
         * Open the search overlay
         */
        _openSearch: function (businessId) {
            const overlay = document.getElementById('global-search-overlay');
            const input = document.getElementById('gs-input');
            if (!overlay) return;
            overlay.classList.add('show');
            input.value = '';
            this._gsActiveIndex = -1;
            this._gsBusinessId = businessId;
            this._renderQuickLinks();

            // Focus after animation
            requestAnimationFrame(() => input.focus());

            // Bind input & keyboard
            if (!this._gsInputBound) {
                this._gsInputBound = true;

                input.addEventListener('input', () => {
                    const q = input.value.trim();
                    if (this._searchDebounce) clearTimeout(this._searchDebounce);
                    if (q.length < 2) {
                        this._renderQuickLinks();
                        return;
                    }
                    this._searchDebounce = setTimeout(() => {
                        this.performSearch(q, this._gsBusinessId);
                    }, 280);
                });

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        this._closeSearch();
                        return;
                    }
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        this._navigateResults(e.key === 'ArrowDown' ? 1 : -1);
                        return;
                    }
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this._selectActiveResult(input.value.trim());
                    }
                });
            }
        },

        /**
         * Close the search overlay
         */
        _closeSearch: function () {
            const overlay = document.getElementById('global-search-overlay');
            if (overlay) overlay.classList.remove('show');
        },

        /**
         * Render quick-navigation module links (shown when search is empty)
         */
        _renderQuickLinks: function () {
            const body = document.getElementById('gs-body');
            if (!body) return;

            const modules = this._getSearchableModules();

            body.innerHTML = `
                <div class="gs-section-label">Quick Navigation</div>
                ${modules.map((m, i) => `
                    <div class="search-result-item" data-module="${m.module}" data-sub="${m.sub || ''}" data-idx="${i}">
                        <div class="search-result-icon search-result-icon--${m.color}">
                            <i class="${m.icon}"></i>
                        </div>
                        <div class="search-result-info">
                            <span class="search-result-title">${this.escapeHtml(m.label)}</span>
                            ${m.subtitle ? `<span class="search-result-subtitle">${this.escapeHtml(m.subtitle)}</span>` : ''}
                        </div>
                        <span class="search-result-type">module</span>
                    </div>
                `).join('')}
            `;
            this._gsActiveIndex = -1;
            this._bindResultClicks(body);
        },

        /**
         * Keyboard navigation through results
         */
        _navigateResults: function (direction) {
            const body = document.getElementById('gs-body');
            if (!body) return;
            const items = body.querySelectorAll('.search-result-item');
            if (!items.length) return;

            items.forEach(el => el.classList.remove('gs-active'));
            this._gsActiveIndex += direction;
            if (this._gsActiveIndex < 0) this._gsActiveIndex = items.length - 1;
            if (this._gsActiveIndex >= items.length) this._gsActiveIndex = 0;

            items[this._gsActiveIndex].classList.add('gs-active');
            items[this._gsActiveIndex].scrollIntoView({ block: 'nearest' });
        },

        /**
         * Select the active result (Enter key)
         */
        _selectActiveResult: function (query) {
            const body = document.getElementById('gs-body');
            if (!body) return;

            const active = body.querySelector('.search-result-item.gs-active');
            if (active) {
                const mod = active.dataset.module;
                const sub = active.dataset.sub || null;
                if (mod && PharmaFlow.Sidebar) PharmaFlow.Sidebar.setActive(mod, sub);
                this._closeSearch();
                return;
            }
            // Fallback: module keyword navigation
            if (query) {
                this.handleModuleSearch(query);
                this._closeSearch();
            }
        },

        /**
         * Bind click handlers on search result items
         */
        _bindResultClicks: function (container) {
            container.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const mod = item.dataset.module;
                    const sub = item.dataset.sub || null;
                    if (mod && PharmaFlow.Sidebar) PharmaFlow.Sidebar.setActive(mod, sub);
                    this._closeSearch();
                });
            });
        },

        _getSearchableModules: function () {
            const colors = ['green', 'blue', 'purple', 'teal', 'orange', 'indigo', 'red', 'cyan'];
            const configs = [];
            if (PharmaFlow.Sidebar && PharmaFlow.Sidebar.getNavConfig) {
                configs.push(...PharmaFlow.Sidebar.getNavConfig());
            } else if (PharmaFlow.NAV_CONFIG) {
                configs.push(...PharmaFlow.NAV_CONFIG);
            }
            if (PharmaFlow.SETTINGS_NAV) configs.push(PharmaFlow.SETTINGS_NAV);

            const targets = [];
            configs.forEach((mod, index) => {
                const color = colors[index % colors.length];
                const canAccess = !PharmaFlow.Sidebar || !PharmaFlow.Sidebar.canAccess || PharmaFlow.Sidebar.canAccess(mod.id);
                if (!canAccess) return;

                const children = PharmaFlow.Sidebar && PharmaFlow.Sidebar.getVisibleChildren
                    ? PharmaFlow.Sidebar.getVisibleChildren(mod)
                    : (mod.children || []);

                if (children && children.length > 0) {
                    children.forEach(child => {
                        if (PharmaFlow.Sidebar && PharmaFlow.Sidebar.canAccess && !PharmaFlow.Sidebar.canAccess(mod.id, child.id)) return;
                        targets.push({
                            icon: child.icon || mod.icon || 'fas fa-circle',
                            color,
                            label: child.label,
                            subtitle: mod.label,
                            module: mod.id,
                            sub: child.id,
                            keywords: this._buildModuleKeywords(mod, child)
                        });
                    });
                } else {
                    targets.push({
                        icon: mod.icon || 'fas fa-circle',
                        color,
                        label: mod.label,
                        subtitle: '',
                        module: mod.id,
                        sub: null,
                        keywords: this._buildModuleKeywords(mod, null)
                    });
                }
            });
            return targets;
        },

        _buildModuleKeywords: function (mod, child) {
            const aliases = {
                pharmacy: ['pharmacy', 'customer', 'customers', 'client', 'clients', 'pos', 'sale', 'sales', 'receipt', 'prescription', 'rx'],
                inventory: ['inventory', 'stock', 'product', 'medicine', 'drug', 'batch', 'reconciliation'],
                disposals: ['disposal', 'dispose', 'expired', 'damage', 'damaged', 'loss'],
                'dda-register': ['dda', 'controlled', 'dangerous drugs', 'register'],
                'medication-refill': ['refill', 'medication', 'reminder', 'chronic'],
                'my-orders': ['order', 'orders', 'purchase', 'po', 'restock', 'supplier order'],
                supplier: ['supplier', 'vendor'],
                wholesale: ['wholesale', 'bulk', 'client lead', 'rider', 'delivery'],
                patients: ['patient', 'patients', 'customer', 'customers', 'billing', 'medical record'],
                expenses: ['expense', 'expenses', 'cost', 'spend', 'bill'],
                reports: ['report', 'reports', 'analytics', 'summary', 'export'],
                'human-resource': ['human resource', 'hr', 'staff', 'employee', 'employees', 'payroll', 'salary', 'salaries', 'payslip', 'payslips', 'advance', 'deduction', 'statutory'],
                accounts: ['account', 'accounts', 'finance', 'p&l', 'profit', 'loss', 'reconciliation'],
                'activity-log': ['activity', 'log', 'audit', 'alert'],
                'support-tickets': ['ticket', 'support', 'help', 'issue'],
                'branch-portal': ['branch', 'portal', 'invoice', 'receipt', 'communication', 'contract', 'certificate'],
                'admin-panel': ['admin', 'user', 'staff', 'franchise', 'billing', 'pricing'],
                settings: ['setting', 'settings', 'config', 'profile', 'business', 'notification', 'version'],
                dashboard: ['dashboard', 'home', 'overview']
            };
            const tokenize = (value) => String(value || '')
                .replace(/[-_/]+/g, ' ')
                .split(/\s+/)
                .filter(Boolean);
            const terms = [
                mod.id,
                mod.label,
                mod.section,
                child && child.id,
                child && child.label,
                child && child.section,
                ...(mod.children || []).map(c => c.label).join(' '),
                ...(mod.children || []).map(c => c.id).join(' '),
                ...(aliases[mod.id] || []),
                ...tokenize(mod.id),
                ...tokenize(mod.label),
                ...(child ? tokenize(child.id).concat(tokenize(child.label)) : [])
            ];
            return Array.from(new Set(terms.filter(Boolean).map(term => String(term).toLowerCase()))).join(' ');
        },

        _safeSearchGet: async function (query, label) {
            if (!query) return null;
            try {
                return await query.get();
            } catch (err) {
                console.warn('Global search skipped ' + label + ':', err);
                return null;
            }
        },

        _docMatches: function (data, q, fields) {
            return fields.some(field => this._fieldText(data, field).includes(q));
        },

        _fieldText: function (data, path) {
            const value = path.split('.').reduce((obj, key) => (obj == null ? '' : obj[key]), data);
            if (Array.isArray(value)) {
                return value.map(item => {
                    if (item && typeof item === 'object') return Object.values(item).join(' ');
                    return item;
                }).join(' ').toLowerCase();
            }
            if (value && typeof value === 'object') return Object.values(value).join(' ').toLowerCase();
            return String(value || '').toLowerCase();
        },

        _dedupeSearchResults: function (results) {
            const seen = new Set();
            return results.filter(result => {
                const nav = result.navigate || {};
                const key = [
                    result.type,
                    result.title,
                    result.subtitle,
                    nav.module,
                    nav.sub
                ].map(value => String(value || '').toLowerCase()).join('|');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        },

        /**
         * Perform live search across ALL Firestore collections (parallel)
         */
        performSearch: async function (query, businessId) {
            if (!window.db || !businessId) return;

            const body = document.getElementById('gs-body');
            if (!body) return;

            const q = query.toLowerCase();
            body.innerHTML = '<div class="search-loading"><div class="spinner spinner--sm"></div> Searching...</div>';

            const results = [];

            try {
                const ref = (col) => getBusinessCollection(businessId, col);

                const [
                    invSnap, patSnap, salesSnap, supSnap, expSnap, wsSnap, rxSnap,
                    orderSnap, refillSnap, ddaSnap, disposalSnap, billSnap, recordSnap,
                    riderSnap, leadSnap, ticketSnap, logSnap, stockSnap, messageSnap,
                    branchFinanceSnap, branchCommSnap, branchContractSnap, branchCertSnap,
                    hrStaffSnap, hrProfileSnap, hrPayrollSnap, hrAdvanceSnap
                ] = await Promise.all([
                    this._safeSearchGet(ref('inventory').limit(250), 'inventory'),
                    this._safeSearchGet(ref('patients').limit(200), 'patients'),
                    this._safeSearchGet(ref('sales').orderBy('createdAt', 'desc').limit(150), 'sales'),
                    this._safeSearchGet(ref('suppliers').limit(150), 'suppliers'),
                    this._safeSearchGet(ref('expenses').orderBy('createdAt', 'desc').limit(120), 'expenses'),
                    this._safeSearchGet(ref('wholesale_orders').orderBy('createdAt', 'desc').limit(120), 'wholesale_orders'),
                    this._safeSearchGet(ref('prescriptions').orderBy('createdAt', 'desc').limit(120), 'prescriptions'),
                    this._safeSearchGet(ref('orders').orderBy('createdAt', 'desc').limit(120), 'orders'),
                    this._safeSearchGet(ref('medication_refills').limit(150), 'medication_refills'),
                    this._safeSearchGet(ref('dda_register').limit(150), 'dda_register'),
                    this._safeSearchGet(ref('disposals').limit(150), 'disposals'),
                    this._safeSearchGet(ref('patient_bills').orderBy('createdAt', 'desc').limit(120), 'patient_bills'),
                    this._safeSearchGet(ref('patient_records').orderBy('createdAt', 'desc').limit(120), 'patient_records'),
                    this._safeSearchGet(ref('riders').limit(120), 'riders'),
                    this._safeSearchGet(ref('client_leads').limit(150), 'client_leads'),
                    this._safeSearchGet(ref('tickets').orderBy('createdAt', 'desc').limit(120), 'tickets'),
                    this._safeSearchGet(ref('activity_log').orderBy('createdAt', 'desc').limit(120), 'activity_log'),
                    this._safeSearchGet(ref('stock_history').orderBy('createdAt', 'desc').limit(120), 'stock_history'),
                    this._safeSearchGet(ref('message_history').orderBy('createdAt', 'desc').limit(120), 'message_history'),
                    this._safeSearchGet(window.db.collection('branch_finance_docs').where('businessId', '==', businessId).limit(120), 'branch_finance_docs'),
                    this._safeSearchGet(window.db.collection('branch_communications').where('businessId', '==', businessId).limit(120), 'branch_communications'),
                    this._safeSearchGet(window.db.collection('branch_contracts').where('businessId', '==', businessId).limit(120), 'branch_contracts'),
                    this._safeSearchGet(window.db.collection('branch_certificates').where('businessId', '==', businessId).limit(120), 'branch_certificates'),
                    this._safeSearchGet(ref('hr_staff').limit(180), 'hr_staff'),
                    this._safeSearchGet(ref('hr_staff_profiles').limit(180), 'hr_staff_profiles'),
                    this._safeSearchGet(ref('hr_payroll').orderBy('createdAt', 'desc').limit(160), 'hr_payroll'),
                    this._safeSearchGet(ref('hr_advances').orderBy('createdAt', 'desc').limit(160), 'hr_advances')
                ]);

                // Inventory
                invSnap && invSnap.forEach(doc => {
                    const d = doc.data();
                    const name = (d.name || '').toLowerCase();
                    const generic = (d.genericName || '').toLowerCase();
                    const sku = (d.sku || '').toLowerCase();
                    const category = (d.category || '').toLowerCase();
                    if (name.includes(q) || generic.includes(q) || sku.includes(q) || category.includes(q)) {
                        const subExtra = d.genericName ? ` | Generic: ${d.genericName}` : '';
                        results.push({
                            type: 'inventory', icon: 'fas fa-pills', color: 'green',
                            title: d.name || 'Unknown Product',
                            subtitle: `SKU: ${d.sku || 'N/A'} | Sellable: ${PharmaFlow.InventoryBatchEngine ? PharmaFlow.InventoryBatchEngine.sellableQuantity(d) : (d.quantity || 0)} | ${this.formatCurrency(d.sellingPrice || 0)}${subExtra}`,
                            navigate: { module: 'inventory', sub: 'view-inventory' }
                        });
                    }
                });

                // Patients
                patSnap && patSnap.forEach(doc => {
                    const d = doc.data();
                    const name = (d.name || d.displayName || d.fullName || '').toLowerCase();
                    const phone = (d.phone || '').toLowerCase();
                    const email = (d.email || '').toLowerCase();
                    const id = (d.patientId || d.idNumber || doc.id || '').toLowerCase();
                    if (name.includes(q) || phone.includes(q) || email.includes(q) || id.includes(q)) {
                        results.push({
                            type: 'customer', icon: 'fas fa-user', color: 'blue',
                            title: d.name || d.displayName || d.fullName || 'Unknown Customer',
                            subtitle: `ID: ${d.patientId || doc.id} | Phone: ${d.phone || 'N/A'} | ${d.email || ''}`,
                            navigate: { module: 'patients', sub: 'manage-patients' }
                        });
                    }
                });

                // Sales
                salesSnap && salesSnap.forEach(doc => {
                    const d = doc.data();
                    const saleId = (d.saleId || doc.id || '').toLowerCase();
                    const customer = (d.customerName || d.customer?.name || '').toLowerCase();
                    const customerPhone = (d.customerPhone || d.customer?.phone || '').toLowerCase();
                    const customerEmail = (d.customerEmail || d.customer?.email || '').toLowerCase();
                    if (saleId.includes(q) || customer.includes(q) || this._docMatches(d, q, ['items'])) {
                        results.push({
                            type: 'sale', icon: 'fas fa-receipt', color: 'purple',
                            title: `Sale ${d.saleId || doc.id}`,
                            subtitle: `${d.customerName || d.customer?.name || 'Walk-in'} | ${this.formatCurrency(d.total || 0)} | ${this.formatDate(d.createdAt)}`,
                            navigate: { module: 'pharmacy', sub: 'all-sales' }
                        });
                    }
                    if (customer && (customer.includes(q) || customerPhone.includes(q) || customerEmail.includes(q))) {
                        results.push({
                            type: 'pharmacy customer', icon: 'fas fa-users', color: 'blue',
                            title: d.customerName || d.customer?.name || 'Pharmacy Customer',
                            subtitle: `${d.customerPhone || d.customer?.phone || 'No phone'} | Last sale: ${this.formatDate(d.createdAt)}`,
                            navigate: { module: 'pharmacy', sub: 'customers' }
                        });
                    }
                });

                // Suppliers
                supSnap && supSnap.forEach(doc => {
                    const d = doc.data();
                    const name = (d.name || '').toLowerCase();
                    const contact = (d.contactPerson || '').toLowerCase();
                    const phone = (d.phone || '').toLowerCase();
                    if (name.includes(q) || contact.includes(q) || phone.includes(q)) {
                        results.push({
                            type: 'supplier', icon: 'fas fa-truck', color: 'teal',
                            title: d.name || 'Unknown Supplier',
                            subtitle: `Contact: ${d.contactPerson || 'N/A'} | ${d.phone || ''}`,
                            navigate: { module: 'supplier', sub: null }
                        });
                    }
                });

                // Expenses
                expSnap && expSnap.forEach(doc => {
                    const d = doc.data();
                    const desc = (d.description || '').toLowerCase();
                    const cat = (d.category || '').toLowerCase();
                    const vendor = (d.vendor || d.paidTo || '').toLowerCase();
                    if (desc.includes(q) || cat.includes(q) || vendor.includes(q)) {
                        results.push({
                            type: 'expense', icon: 'fas fa-file-invoice-dollar', color: 'red',
                            title: d.description || d.category || 'Expense',
                            subtitle: `${d.category || ''} | ${this.formatCurrency(d.amount || 0)} | ${this.formatDate(d.createdAt)}`,
                            navigate: { module: 'expenses', sub: 'manage-expenses' }
                        });
                    }
                });

                // Wholesale Orders
                wsSnap && wsSnap.forEach(doc => {
                    const d = doc.data();
                    const orderId = (d.orderId || doc.id || '').toLowerCase();
                    const client = (d.clientName || d.customerName || d.customer?.name || '').toLowerCase();
                    if (orderId.includes(q) || client.includes(q) || this._docMatches(d, q, ['customer.phone', 'customer.email', 'items'])) {
                        results.push({
                            type: 'wholesale', icon: 'fas fa-store', color: 'indigo',
                            title: `Order ${d.orderId || doc.id}`,
                            subtitle: `${d.clientName || d.customerName || d.customer?.name || 'Client'} | ${this.formatCurrency(d.total || d.grandTotal || 0)}`,
                            navigate: { module: 'wholesale', sub: 'manage-wholesale' }
                        });
                    }
                });

                // Prescriptions
                rxSnap && rxSnap.forEach(doc => {
                    const d = doc.data();
                    const patient = (d.patientName || '').toLowerCase();
                    const rxId = (d.prescriptionId || doc.id || '').toLowerCase();
                    const drug = (d.drugName || d.medication || '').toLowerCase();
                    if (patient.includes(q) || rxId.includes(q) || drug.includes(q)) {
                        results.push({
                            type: 'prescription', icon: 'fas fa-prescription', color: 'cyan',
                            title: d.patientName || 'Prescription',
                            subtitle: `${d.drugName || d.medication || ''} | ${d.prescriptionId || doc.id}`,
                            navigate: { module: 'pharmacy', sub: 'prescription' }
                        });
                    }
                });

                // Purchase Orders
                orderSnap && orderSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['orderId', 'id', 'supplierName', 'createdBy', 'status', 'items'])) {
                        results.push({
                            type: 'order', icon: 'fas fa-clipboard-list', color: 'orange',
                            title: `Purchase Order ${d.orderId || doc.id}`,
                            subtitle: `${d.supplierName || 'Supplier'} | ${this.formatCurrency(d.totalAmount || 0)} | ${d.status || 'pending'}`,
                            navigate: { module: 'my-orders', sub: 'manage-orders' }
                        });
                    }
                });

                // Medication Refills
                refillSnap && refillSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['refillId', 'id', 'patientName', 'patientPhone', 'medication', 'dosage', 'doctor', 'status'])) {
                        results.push({
                            type: 'refill', icon: 'fas fa-pills', color: 'orange',
                            title: d.patientName || 'Medication Refill',
                            subtitle: `${d.medication || ''} | Next: ${this.formatDate(d.nextRefillDate)} | ${d.status || 'Active'}`,
                            navigate: { module: 'medication-refill', sub: 'manage-refills' }
                        });
                    }
                });

                // DDA Register
                ddaSnap && ddaSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['id', 'patientName', 'customerName', 'drugName', 'medication', 'prescriptionNumber', 'batchNumber', 'doctorName'])) {
                        results.push({
                            type: 'dda', icon: 'fas fa-book-medical', color: 'red',
                            title: d.drugName || d.medication || 'DDA Entry',
                            subtitle: `${d.patientName || d.customerName || 'Patient'} | ${d.prescriptionNumber || doc.id}`,
                            navigate: { module: 'dda-register', sub: 'view-register' }
                        });
                    }
                });

                // Disposals
                disposalSnap && disposalSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['id', 'productName', 'sku', 'batchNumber', 'category', 'reason', 'status'])) {
                        results.push({
                            type: 'disposal', icon: 'fas fa-trash-can-arrow-up', color: 'red',
                            title: d.productName || 'Disposal Entry',
                            subtitle: `${d.reason || 'disposal'} | Batch: ${d.batchNumber || 'N/A'} | ${d.status || 'pending'}`,
                            navigate: { module: 'disposals', sub: 'expired-stock' }
                        });
                    }
                });

                // Patient Bills
                billSnap && billSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['billId', 'invoiceNumber', 'id', 'patient.name', 'patient.fullName', 'patient.phone', 'status', 'services'])) {
                        results.push({
                            type: 'patient bill', icon: 'fas fa-file-invoice-dollar', color: 'blue',
                            title: d.billId || d.invoiceNumber || `Bill ${doc.id}`,
                            subtitle: `${d.patient?.name || d.patient?.fullName || 'Patient'} | ${this.formatCurrency(d.grandTotal || d.totalAmount || 0)} | ${d.status || ''}`,
                            navigate: { module: 'patients', sub: 'manage-billing' }
                        });
                    }
                });

                // Patient Records
                recordSnap && recordSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['recordId', 'id', 'patientName', 'patientPhone', 'diagnosis', 'notes', 'doctorName', 'services'])) {
                        results.push({
                            type: 'medical record', icon: 'fas fa-notes-medical', color: 'blue',
                            title: d.patientName || 'Patient Record',
                            subtitle: `${d.diagnosis || d.notes || ''} | ${this.formatDate(d.createdAt)}`,
                            navigate: { module: 'patients', sub: 'manage-patients' }
                        });
                    }
                });

                // Riders
                riderSnap && riderSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['name', 'phone', 'agentType', 'vehicleReg', 'status'])) {
                        results.push({
                            type: 'rider', icon: 'fas fa-motorcycle', color: 'indigo',
                            title: d.name || 'Rider',
                            subtitle: `${d.phone || ''} | ${d.agentType || ''} | ${d.status || ''}`,
                            navigate: { module: 'wholesale', sub: 'riders' }
                        });
                    }
                });

                // Client Leads
                leadSnap && leadSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['name', 'businessName', 'phone', 'email', 'address', 'notes'])) {
                        results.push({
                            type: 'client lead', icon: 'fas fa-users-gear', color: 'indigo',
                            title: d.name || d.businessName || 'Client Lead',
                            subtitle: `${d.businessName || ''} | ${d.phone || ''} | ${d.email || ''}`,
                            navigate: { module: 'wholesale', sub: 'client-leads' }
                        });
                    }
                });

                // Support Tickets
                ticketSnap && ticketSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['ticketId', 'id', 'subject', 'description', 'category', 'status', 'raisedBy'])) {
                        results.push({
                            type: 'ticket', icon: 'fas fa-ticket', color: 'teal',
                            title: d.subject || d.ticketId || `Ticket ${doc.id}`,
                            subtitle: `${d.category || 'Support'} | ${d.status || 'open'} | ${this.formatDate(d.createdAt)}`,
                            navigate: { module: 'support-tickets', sub: 'my-tickets' }
                        });
                    }
                });

                // Activity Logs
                logSnap && logSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['title', 'description', 'category', 'severity', 'createdBy', 'status', 'metadata'])) {
                        results.push({
                            type: 'activity', icon: 'fas fa-clock-rotate-left', color: 'teal',
                            title: d.title || 'Activity Log',
                            subtitle: `${d.description || ''} | ${this.formatDate(d.createdAt)}`,
                            navigate: { module: 'activity-log', sub: 'all-activities' }
                        });
                    }
                });

                // Stock History
                stockSnap && stockSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['productName', 'sku', 'batchNumber', 'batchNumbers', 'type', 'reason', 'createdBy'])) {
                        results.push({
                            type: 'stock history', icon: 'fas fa-layer-group', color: 'green',
                            title: d.productName || 'Stock Movement',
                            subtitle: `${d.type || d.reason || 'movement'} | ${this.formatDate(d.createdAt)}`,
                            navigate: { module: 'my-orders', sub: 'stock-history' }
                        });
                    }
                });

                // Pharmacy Customer Messages
                messageSnap && messageSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['customerName', 'customerPhone', 'phone', 'message', 'channel', 'status'])) {
                        results.push({
                            type: 'customer message', icon: 'fas fa-message', color: 'blue',
                            title: d.customerName || d.customerPhone || 'Customer Message',
                            subtitle: `${d.channel || 'message'} | ${d.status || ''} | ${this.formatDate(d.createdAt)}`,
                            navigate: { module: 'pharmacy', sub: 'customers' }
                        });
                    }
                });

                // Branch Portal Documents
                branchFinanceSnap && branchFinanceSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['docNumber', 'businessName', 'billingMonth', 'note', 'type', 'status', 'paymentMode'])) {
                        results.push({
                            type: 'branch document', icon: 'fas fa-file-invoice-dollar', color: 'purple',
                            title: d.docNumber || `Branch Document ${doc.id}`,
                            subtitle: `${d.billingMonth || d.type || ''} | ${this.formatCurrency(d.amount || d.totalAmount || 0)} | ${d.status || ''}`,
                            navigate: { module: 'branch-portal', sub: 'billing-documents' }
                        });
                    }
                });

                branchCommSnap && branchCommSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['subject', 'message', 'category', 'status', 'businessName'])) {
                        results.push({
                            type: 'branch communication', icon: 'fas fa-comments', color: 'purple',
                            title: d.subject || 'Branch Communication',
                            subtitle: `${d.category || ''} | ${this.formatDate(d.createdAt)}`,
                            navigate: { module: 'branch-portal', sub: 'branch-communications' }
                        });
                    }
                });

                branchContractSnap && branchContractSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['title', 'contractNumber', 'businessName', 'status', 'notes'])) {
                        results.push({
                            type: 'branch contract', icon: 'fas fa-file-signature', color: 'purple',
                            title: d.title || d.contractNumber || 'Branch Contract',
                            subtitle: `${d.status || ''} | ${this.formatDate(d.createdAt)}`,
                            navigate: { module: 'branch-portal', sub: 'branch-contracts' }
                        });
                    }
                });

                branchCertSnap && branchCertSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, ['title', 'certificateNumber', 'authority', 'businessName', 'status'])) {
                        results.push({
                            type: 'branch certificate', icon: 'fas fa-certificate', color: 'purple',
                            title: d.title || d.certificateNumber || 'Branch Certificate',
                            subtitle: `${d.authority || ''} | ${d.status || ''}`,
                            navigate: { module: 'branch-portal', sub: 'branch-certificates' }
                        });
                    }
                });

                // Human Resource staff
                const pushHrStaff = (doc, data, sourceLabel) => {
                    if (this._docMatches({ ...data, id: doc.id }, q, [
                        'id', 'staffId', 'staffCode', 'employeeId', 'displayName', 'name', 'fullName',
                        'email', 'phone', 'jobTitle', 'hrRole', 'staffType', 'department', 'status'
                    ])) {
                        const name = data.displayName || data.name || data.fullName || data.staffName || 'Staff Member';
                        const code = data.staffCode || data.staffId || data.employeeId || doc.id;
                        results.push({
                            type: 'hr staff', icon: 'fas fa-users-gear', color: 'teal',
                            title: name,
                            subtitle: `${code} | ${data.jobTitle || data.hrRole || data.staffType || sourceLabel || 'Staff'} | ${data.phone || data.email || ''}`,
                            navigate: { module: 'human-resource', sub: 'hr-staff' }
                        });
                    }
                };
                hrStaffSnap && hrStaffSnap.forEach(doc => pushHrStaff(doc, doc.data(), 'Staff'));
                hrProfileSnap && hrProfileSnap.forEach(doc => pushHrStaff(doc, doc.data(), 'Profile'));

                // Human Resource payroll / payslips
                hrPayrollSnap && hrPayrollSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, [
                        'id', 'payrollId', 'staffId', 'staffCode', 'staffName', 'jobTitle',
                        'hrRole', 'staffType', 'period', 'status', 'paymentMethod', 'reference'
                    ])) {
                        results.push({
                            type: 'hr payroll', icon: 'fas fa-money-check-dollar', color: 'green',
                            title: d.staffName || d.staffCode || 'Payroll Record',
                            subtitle: `${d.period || 'Period'} | ${this.formatCurrency(d.totalMonthPay || d.grossPay || 0)} | ${d.status || 'pending'}`,
                            navigate: { module: 'human-resource', sub: d.status === 'paid' || d.paymentConfirmed ? 'hr-payslips' : 'hr-payroll' }
                        });
                    }
                });

                // Human Resource advances
                hrAdvanceSnap && hrAdvanceSnap.forEach(doc => {
                    const d = doc.data();
                    if (this._docMatches({ ...d, id: doc.id }, q, [
                        'id', 'staffId', 'staffCode', 'staffName', 'staffType', 'period',
                        'reference', 'paymentMethod', 'status', 'note'
                    ])) {
                        results.push({
                            type: 'hr advance', icon: 'fas fa-hand-holding-dollar', color: 'orange',
                            title: d.staffName || d.staffCode || 'Advance Payment',
                            subtitle: `${this.formatCurrency(d.amount || 0)} | ${d.reference || d.period || ''} | ${d.status || 'recorded'}`,
                            navigate: { module: 'human-resource', sub: 'hr-payroll' }
                        });
                    }
                });
            } catch (err) {
                console.error('Search error:', err);
            }

            // Also match module keywords for quick navigation
            const moduleMatches = this._matchModuleKeywords(q);
            const visibleResults = this._dedupeSearchResults(results).filter(r => {
                if (!r.navigate || !r.navigate.module) return false;
                if (!PharmaFlow.Sidebar || !PharmaFlow.Sidebar.canAccess) return true;
                return PharmaFlow.Sidebar.canAccess(r.navigate.module, r.navigate.sub || null);
            });

            // Render results
            this._gsActiveIndex = -1;
            if (visibleResults.length === 0 && moduleMatches.length === 0) {
                body.innerHTML = `
                    <div class="search-empty">
                        <i class="fas fa-search"></i>
                        <span>No results for "${this.escapeHtml(query)}"</span>
                        <span style="font-size:0.75rem;margin-top:4px;">Try searching by name, ID, SKU, phone, or keyword</span>
                    </div>`;
                return;
            }

            let html = '';

            // Module quick-links first
            if (moduleMatches.length > 0) {
                html += '<div class="gs-section-label">Modules</div>';
                html += moduleMatches.map((m, i) => `
                    <div class="search-result-item" data-module="${m.module}" data-sub="${m.sub || ''}" data-idx="${i}">
                        <div class="search-result-icon search-result-icon--${m.color}">
                            <i class="${m.icon}"></i>
                        </div>
                        <div class="search-result-info">
                            <span class="search-result-title">${this.escapeHtml(m.label)}</span>
                        </div>
                        <span class="search-result-type">module</span>
                    </div>
                `).join('');
            }

            // Data results grouped by type
            const grouped = {};
            visibleResults.forEach(r => {
                if (!grouped[r.type]) grouped[r.type] = [];
                grouped[r.type].push(r);
            });
            const typeLabels = {
                inventory: 'Inventory', customer: 'Customers', sale: 'Sales',
                supplier: 'Suppliers', expense: 'Expenses', wholesale: 'Wholesale',
                prescription: 'Prescriptions', order: 'Purchase Orders', refill: 'Medication Refills',
                dda: 'DDA Register', disposal: 'Disposals', 'patient bill': 'Patient Bills',
                'medical record': 'Medical Records', rider: 'Riders', 'client lead': 'Client Leads',
                ticket: 'Support Tickets', activity: 'Activity Logs', 'stock history': 'Stock History',
                'customer message': 'Customer Messages', 'pharmacy customer': 'Pharmacy Customers',
                'branch document': 'Branch Documents', 'branch communication': 'Branch Communications',
                'branch contract': 'Branch Contracts', 'branch certificate': 'Branch Certificates',
                'hr staff': 'Human Resource Staff', 'hr payroll': 'Human Resource Payroll',
                'hr advance': 'Human Resource Advances'
            };

            let totalShown = moduleMatches.length;
            for (const [type, items] of Object.entries(grouped)) {
                const showing = items.slice(0, 5);
                html += `<div class="gs-section-label">${typeLabels[type] || type} (${items.length})</div>`;
                html += showing.map(r => `
                    <div class="search-result-item" data-module="${r.navigate.module}" data-sub="${r.navigate.sub || ''}">
                        <div class="search-result-icon search-result-icon--${r.color}">
                            <i class="${r.icon}"></i>
                        </div>
                        <div class="search-result-info">
                            <span class="search-result-title">${this.escapeHtml(r.title)}</span>
                            <span class="search-result-subtitle">${this.escapeHtml(r.subtitle)}</span>
                        </div>
                        <span class="search-result-type">${this.escapeHtml(r.type)}</span>
                    </div>
                `).join('');
                totalShown += showing.length;
            }

            const totalResults = visibleResults.length + moduleMatches.length;
            if (totalResults > totalShown) {
                html += `<div class="search-more">${totalResults - totalShown} more results hidden &mdash; refine your search</div>`;
            }

            body.innerHTML = html;
            this._bindResultClicks(body);
        },

        /**
         * Match module keywords for quick navigation
         */
        _matchModuleKeywords: function (q) {
            return this._getSearchableModules().filter(m => {
                const haystack = `${m.label || ''} ${m.subtitle || ''} ${m.module || ''} ${m.sub || ''} ${m.keywords || ''}`.toLowerCase();
                return haystack.includes(q) || q.split(/\s+/).some(term => term && haystack.includes(term));
            });
        },

        /**
         * Handle module-level navigation from Enter key in search
         */
        handleModuleSearch: function (query) {
            const q = query.toLowerCase();
            const match = this._matchModuleKeywords(q)[0];
            if (match && PharmaFlow.Sidebar) PharmaFlow.Sidebar.setActive(match.module, match.sub || null);
        },

        /* ==============================================================
         * REAL-TIME LISTENERS — all stat cards & activities use onSnapshot
         * ============================================================== */

        /**
         * Start all real-time Firestore listeners for stats and activities
         */
        startRealtimeListeners: function (businessId) {
            if (!window.db || !businessId) {
                this.setStatsPlaceholder();
                const listEl = document.getElementById('activities-list');
                if (listEl) listEl.innerHTML = this.renderEmptyActivities();
                return;
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayISO = today.toISOString();

            // 1. Sales listener (today's sales, bulk sales, overall sales)
            this._listenSales(businessId, todayISO);

            // 2. Expenses listener (today's expenses)
            this._listenExpenses(businessId, todayISO);

            // 3. Inventory listener (total products, out of stock, expiring soon, inventory value)
            this._listenInventory(businessId);

            // 4. Patients listener (total customers)
            this._listenPatients(businessId);

            // 5. Prescriptions listener (prescriptions today)
            this._listenPrescriptions(businessId, todayISO);

            // 6. Activity feed listeners (sales, prescriptions, patients, activity_log)
            this._listenActivities(businessId, todayISO);

            // 7. Franchise alerts listener (payment due banners)
            this._listenFranchiseAlerts(businessId);
        },

        /**
         * Franchise alerts real-time listener — shows payment-due banners on dashboard
         */
        _listenFranchiseAlerts: function (businessId) {
            if (!window.db || !businessId) return;

            // Simple query — client-side filter avoids needing a composite index
            const unsub = window.db.collection('franchise_alerts')
                .where('businessId', '==', businessId)
                .onSnapshot(snap => {
                    if (!this._isActive) return;
                    const container = document.getElementById('dash-franchise-alerts');
                    if (!container) return;

                    // Client-side filter for active alerts, sorted newest first
                    const alerts = snap.docs
                        .map(d => ({ id: d.id, ...d.data() }))
                        .filter(a => a.status === 'active')
                        .sort((a, b) => {
                            const tA = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : 0;
                            const tB = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : 0;
                            return tB - tA;
                        });

                    if (alerts.length === 0) {
                        container.style.display = 'none';
                        container.innerHTML = '';
                        return;
                    }
                    const formatCurrency = (amount) => PharmaFlow.Settings && PharmaFlow.Settings.formatCurrency ? PharmaFlow.Settings.formatCurrency(amount) : 'KSH ' + Number(amount || 0).toLocaleString();
                    const typeIcons = {
                        payment_due: 'fas fa-money-bill-wave',
                        warning: 'fas fa-exclamation-triangle',
                        general: 'fas fa-bell',
                        info: 'fas fa-info-circle',
                        downtime: 'fas fa-power-off',
                        security: 'fas fa-shield-halved',
                        maintenance: 'fas fa-wrench'
                    };

                    container.innerHTML = alerts.map(a => {
                        const icon = typeIcons[a.type] || 'fas fa-bell';
                        const amountStr = a.amount ? ` — <strong>${formatCurrency(a.amount)}</strong>` : '';
                        const dueStr = a.dueDate ? ` (Due: ${a.dueDate})` : '';
                        const payBtn = (a.showPayButton && a.type === 'payment_due')
                            ? `<button class="dash-alert-paynow" data-alert-id="${this.escapeHtml(a.id)}"><i class="fas fa-credit-card"></i> Pay Now</button>`
                            : '';
                        const canUserDismiss = a.allowUserDismiss !== false;
                        const dismissControl = canUserDismiss
                            ? `<button class="dash-alert-dismiss" data-alert-id="${this.escapeHtml(a.id)}" title="Dismiss"><i class="fas fa-times"></i></button>`
                            : `<span class="dash-alert-locked" title="Only an admin can dismiss this alert"><i class="fas fa-lock"></i> Admin only</span>`;
                        return `
                            <div class="dash-alert-banner-item">
                                <div class="dash-alert-banner-msg">
                                    <i class="${icon}"></i>
                                    <span>${this.escapeHtml(a.message || 'You have a pending alert.')}${amountStr}${dueStr}</span>
                                </div>
                                <div style="display:flex;gap:8px;align-items:center">
                                    ${payBtn}
                                    ${dismissControl}
                                </div>
                            </div>
                        `;
                    }).join('');

                    container.className = 'dash-alert-banner';
                    container.style.display = '';

                    // Bind dismiss buttons
                    container.querySelectorAll('.dash-alert-dismiss').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            const alertId = btn.dataset.alertId;
                            if (!alertId) return;
                            try {
                                await window.db.collection('franchise_alerts').doc(alertId).update({
                                    status: 'dismissed',
                                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                                });
                            } catch (err) {
                                console.error('Dismiss alert error:', err);
                            }
                        });
                    });

                    // Bind pay-now buttons — navigate to a payment flow or show contact
                    container.querySelectorAll('.dash-alert-paynow').forEach(btn => {
                        btn.addEventListener('click', () => {
                            const alertId = btn.dataset.alertId;
                            const alertData = alerts.find(a => a.id === alertId);
                            const amount = alertData && alertData.amount ? formatCurrency(alertData.amount) : '';
                            PharmaFlow.alert(
                                'Please contact the system administrator to complete your payment.'
                                + (amount ? '<br><br><span style="font-size:1.2rem;font-weight:700">' + amount + '</span>' : ''),
                                { title: 'Payment Required' }
                            );
                        });
                    });
                }, err => {
                    console.error('Franchise alerts listener error:', err);
                });

            this._listeners.push(unsub);
        },

        /**
         * Sales real-time listener
         */
        _listenSales: function (businessId, todayISO) {
            const salesRef = getBusinessCollection(businessId, 'sales');
            if (!salesRef) return;

            // Overall sales (all-time) listener
            const unsubAll = salesRef.onSnapshot(snap => {
                if (!this._isActive) return;
                let overallSales = 0;
                snap.forEach(doc => {
                    const data = doc.data();
                    if (data.status === 'cancelled') return;
                    overallSales += parseFloat(data.total || 0);
                });
                this.setStat('stat-overall-sales', this.formatCurrency(overallSales));
            }, err => console.error('Sales all-time listener error:', err));
            this._listeners.push(unsubAll);

            // Today's sales listener
            const unsubToday = salesRef.where('createdAt', '>=', todayISO)
                .onSnapshot(snap => {
                    if (!this._isActive) return;
                    let todaysRevenue = 0;
                    let bulkSales = 0;
                    snap.forEach(doc => {
                        const data = doc.data();
                        if (data.status === 'cancelled') return;
                        todaysRevenue += parseFloat(data.total || 0);
                        if (data.type === 'bulk' || data.type === 'wholesale') {
                            bulkSales += parseFloat(data.total || 0);
                        }
                    });
                    this.setStat('stat-todays-sales', this.formatCurrency(todaysRevenue));
                    this.setStat('stat-bulk-sales', this.formatCurrency(bulkSales));
                }, err => console.error('Sales today listener error:', err));
            this._listeners.push(unsubToday);
        },

        /**
         * Expenses real-time listener
         */
        _listenExpenses: function (businessId, todayISO) {
            const expRef = getBusinessCollection(businessId, 'expenses');
            if (!expRef) return;

            const unsub = expRef.where('createdAt', '>=', todayISO)
                .onSnapshot(snap => {
                    if (!this._isActive) return;
                    let todaysExpenses = 0;
                    snap.forEach(doc => {
                        todaysExpenses += parseFloat(doc.data().amount || 0);
                    });
                    this.setStat('stat-todays-expenses', this.formatCurrency(todaysExpenses));
                }, err => console.error('Expenses listener error:', err));
            this._listeners.push(unsub);
        },

        /**
         * Apply inventory KPIs to dashboard stat cards (same math as Inventory module).
         */
        _applyInventoryStatsFromProducts: function (products, listenerBusinessId) {
            if (!this._isActive) return;
            if (listenerBusinessId && this.getBusinessId() !== listenerBusinessId) return;

            const s = PharmaFlow.computeInventoryStats
                ? PharmaFlow.computeInventoryStats(products)
                : { totalProducts: 0, totalValue: 0, outOfStock: 0, lowStock: 0, expiringSoon: 0 };

            this.setStat('stat-total-products', s.totalProducts);
            this.setStat('stat-out-of-stock', s.outOfStock);
            this.setStat('stat-expiring-soon', s.expiringSoon);
            this.setStat('stat-inventory-value', this.formatCurrency(s.totalValue));
        },

        /** Batch multiple inventory snapshot events in the same frame */
        _scheduleInventoryStatsApply: function (products, listenerBusinessId) {
            const self = this;
            if (self._invStatsRaf != null) cancelAnimationFrame(self._invStatsRaf);
            self._invStatsRaf = requestAnimationFrame(function () {
                self._invStatsRaf = null;
                self._applyInventoryStatsFromProducts(products, listenerBusinessId);
            });
        },

        /**
         * Inventory real-time listener — KPIs from PharmaFlow.computeInventoryStats (same as Inventory module).
         */
        _listenInventory: function (businessId) {
            const invRef = getBusinessCollection(businessId, 'inventory');
            if (!invRef) return;

            const listenerBiz = businessId;
            const unsub = invRef.onSnapshot(snap => {
                if (!this._isActive) return;
                const products = [];
                snap.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
                this._scheduleInventoryStatsApply(products, listenerBiz);
            }, err => console.error('Inventory listener error:', err));
            this._listeners.push(unsub);
        },

        /**
         * Patients real-time listener
         */
        _listenPatients: function (businessId) {
            const patRef = getBusinessCollection(businessId, 'patients');
            if (!patRef) return;

            const unsub = patRef.onSnapshot(snap => {
                if (!this._isActive) return;
                this.setStat('stat-total-customers', snap.size);
            }, err => console.error('Patients listener error:', err));
            this._listeners.push(unsub);
        },

        /**
         * Prescriptions real-time listener
         */
        _listenPrescriptions: function (businessId, todayISO) {
            const rxRef = getBusinessCollection(businessId, 'prescriptions');
            if (!rxRef) return;

            const unsub = rxRef.where('createdAt', '>=', todayISO)
                .onSnapshot(snap => {
                    if (!this._isActive) return;
                    this.setStat('stat-prescriptions-today', snap.size);
                }, err => console.error('Prescriptions listener error:', err));
            this._listeners.push(unsub);
        },

        /**
         * Activities real-time listeners — combines sales, prescriptions, patients, activity_log
         */
        _listenActivities: function (businessId, todayISO) {
            // Shared activity data store — rebuilt when any source changes
            const activityData = {
                sales: [],
                prescriptions: [],
                patients: [],
                logs: []
            };

            const self = this;
            const renderAll = () => {
                if (!self._isActive) return;
                const listEl = document.getElementById('activities-list');
                if (!listEl) return;

                const all = [
                    ...activityData.sales,
                    ...activityData.prescriptions,
                    ...activityData.patients,
                    ...activityData.logs
                ];

                all.sort((a, b) => {
                    if (!a.time) return 1;
                    if (!b.time) return -1;
                    return new Date(b.time) - new Date(a.time);
                });

                if (all.length === 0) {
                    listEl.innerHTML = self.renderEmptyActivities();
                } else {
                    listEl.innerHTML = all.slice(0, 15).map(a => self.renderActivityItem(a)).join('');
                }
            };

            // Sales activities
            const salesRef = getBusinessCollection(businessId, 'sales');
            if (salesRef) {
                const unsub = salesRef.where('createdAt', '>=', todayISO)
                    .orderBy('createdAt', 'desc').limit(20)
                    .onSnapshot(snap => {
                        activityData.sales = [];
                        snap.forEach(doc => {
                            const data = doc.data();
                            activityData.sales.push({
                                type: 'sale', icon: 'fas fa-receipt', color: 'green',
                                title: 'Sale Completed',
                                description: `New sale to ${data.customerName || 'Walk-in Customer'} - ${data.itemCount || 1} items`,
                                time: data.createdAt || '', user: data.createdBy || 'Admin',
                                amount: self.formatCurrency(data.total || 0), status: 'COMPLETED'
                            });
                        });
                        renderAll();
                    }, err => console.error('Activity sales listener error:', err));
                this._listeners.push(unsub);
            }

            // Prescriptions activities
            const rxRef = getBusinessCollection(businessId, 'prescriptions');
            if (rxRef) {
                const unsub = rxRef.where('createdAt', '>=', todayISO)
                    .orderBy('createdAt', 'desc').limit(10)
                    .onSnapshot(snap => {
                        activityData.prescriptions = [];
                        snap.forEach(doc => {
                            const data = doc.data();
                            activityData.prescriptions.push({
                                type: 'prescription', icon: 'fas fa-prescription', color: 'purple',
                                title: 'Prescription Filled',
                                description: `Patient: ${data.patientName || 'N/A'} — ${data.medication || ''}`,
                                time: data.createdAt || '', user: data.createdBy || 'Admin',
                                amount: self.formatCurrency(data.total || 0), status: 'COMPLETED'
                            });
                        });
                        renderAll();
                    }, err => console.error('Activity rx listener error:', err));
                this._listeners.push(unsub);
            }

            // Patient activities
            const patRef = getBusinessCollection(businessId, 'patients');
            if (patRef) {
                const unsub = patRef.where('createdAt', '>=', todayISO)
                    .orderBy('createdAt', 'desc').limit(10)
                    .onSnapshot(snap => {
                        activityData.patients = [];
                        snap.forEach(doc => {
                            const data = doc.data();
                            activityData.patients.push({
                                type: 'patient', icon: 'fas fa-user-plus', color: 'blue',
                                title: 'New Customer Registered',
                                description: data.name || data.displayName || 'N/A',
                                time: data.createdAt || '', user: data.createdBy || 'Admin',
                                amount: '-', status: 'COMPLETED'
                            });
                        });
                        renderAll();
                    }, err => console.error('Activity patients listener error:', err));
                this._listeners.push(unsub);
            }

            // Activity log entries
            const logRef = getBusinessCollection(businessId, 'activity_log');
            if (logRef) {
                const unsub = logRef.where('createdAt', '>=', todayISO)
                    .orderBy('createdAt', 'desc').limit(10)
                    .onSnapshot(snap => {
                        activityData.logs = [];
                        snap.forEach(doc => {
                            const data = doc.data();
                            activityData.logs.push({
                                type: 'stock', icon: 'fas fa-boxes-stacked', color: 'teal',
                                title: data.title || 'Stock Updated',
                                description: data.description || '',
                                time: data.createdAt || '', user: data.createdBy || 'Admin',
                                amount: data.amount || '-', status: data.status || 'COMPLETED'
                            });
                        });
                        renderAll();
                    }, err => console.error('Activity log listener error:', err));
                this._listeners.push(unsub);
            }
        },

        /* ==============================================================
         * STAT HELPERS
         * ============================================================== */

        setStat: function (id, value) {
            const el = document.getElementById(id);
            if (el) {
                // Animate value change
                el.classList.add('stat-flash');
                el.textContent = value;
                setTimeout(() => el.classList.remove('stat-flash'), 600);
            }
        },

        setAllStats: function (value) {
            ['stat-todays-sales', 'stat-overall-sales', 'stat-todays-expenses',
             'stat-out-of-stock', 'stat-expiring-soon', 'stat-bulk-sales',
             'stat-total-customers', 'stat-inventory-value', 'stat-prescriptions-today',
             'stat-total-products'].forEach(id => this.setStat(id, value));
        },

        setStatsPlaceholder: function () {
            this.setStat('stat-todays-sales', this.formatCurrency(0));
            this.setStat('stat-overall-sales', this.formatCurrency(0));
            this.setStat('stat-todays-expenses', this.formatCurrency(0));
            this.setStat('stat-out-of-stock', '0');
            this.setStat('stat-expiring-soon', '0');
            this.setStat('stat-bulk-sales', this.formatCurrency(0));
            this.setStat('stat-total-customers', '0');
            this.setStat('stat-inventory-value', this.formatCurrency(0));
            this.setStat('stat-prescriptions-today', '0');
            this.setStat('stat-total-products', '0');
        },

        /* ==============================================================
         * RENDERING HELPERS
         * ============================================================== */

        renderActivityItem: function (activity) {
            const timeStr = activity.time ? this.formatTime(activity.time) : '';
            const statusClass = activity.status === 'COMPLETED' ? 'status--completed' : (activity.status === 'PENDING' ? 'status--pending' : 'status--completed');
            return `
                <tr>
                    <td class="activity-cell-time">${this.escapeHtml(timeStr)}</td>
                    <td class="activity-cell-info">
                        <div class="activity-cell-info__wrap">
                            <div class="activity-item__icon activity-item__icon--${activity.color}">
                                <i class="${activity.icon}"></i>
                            </div>
                            <div>
                                <span class="activity-item__title">${this.escapeHtml(activity.title)}</span>
                                <span class="activity-item__desc">${this.escapeHtml(activity.description)}</span>
                            </div>
                        </div>
                    </td>
                    <td>${this.escapeHtml(activity.user || 'Staff')}</td>
                    <td>${this.escapeHtml(activity.amount || '-')}</td>
                    <td><span class="status-badge ${statusClass}">${this.escapeHtml(activity.status || 'COMPLETED')}</span></td>
                </tr>
            `;
        },

        renderEmptyActivities: function () {
            return `<tr><td colspan="5" class="activities-empty-cell">
                <div class="activities-empty">
                    <i class="fas fa-clipboard-list"></i>
                    <p>No activities recorded today</p>
                    <span>Activities will appear here in real-time as transactions are performed.</span>
                </div>
            </td></tr>`;
        },

        /* ==============================================================
         * FORMAT HELPERS
         * ============================================================== */

        formatCurrency: function (amount) {
            return PharmaFlow.Settings && PharmaFlow.Settings.formatCurrency ? PharmaFlow.Settings.formatCurrency(amount) : 'KSH ' + new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
        },

        formatTime: function (isoString) {
            try {
                const date = new Date(isoString);
                return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            } catch {
                return '';
            }
        },

        formatDate: function (isoString) {
            if (PharmaFlow.Settings && PharmaFlow.Settings.formatDate) return PharmaFlow.Settings.formatDate(isoString);
            try {
                const date = new Date(isoString);
                return date.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
            } catch {
                return '';
            }
        },

        escapeHtml: function (str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }
    };

    window.PharmaFlow.Dashboard = Dashboard;
})();
