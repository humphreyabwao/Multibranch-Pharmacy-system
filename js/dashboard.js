/**
 * PharmaFlow - Dashboard Module
 * Renders the main dashboard with:
 *   1. Stats cards (real-time Firestore onSnapshot listeners)
 *   2. Quick access buttons (6)
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

            // Bind view all activities
            const viewAllBtn = document.getElementById('view-all-activities');
            if (viewAllBtn) {
                viewAllBtn.addEventListener('click', () => {
                    PharmaFlow.Sidebar.setActive('activity-log');
                });
            }

            // Bind refresh button
            this.bindRefreshButton(businessId);

            // Bind search with overlay panel
            this.bindSearch(businessId);

            // Start real-time listeners
            this.startRealtimeListeners(businessId);
        },

        /**
         * Clean up all real-time listeners
         */
        cleanup: function () {
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
        bindRefreshButton: function (businessId) {
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

                // Re-establish listeners
                setTimeout(() => {
                    this.startRealtimeListeners(businessId);
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
                        <input type="text" id="gs-input" placeholder="Search inventory, sales, patients, expenses, orders..." autocomplete="off">
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

            const modules = [
                { icon: 'fas fa-cart-shopping', color: 'green', label: 'Point of Sale', module: 'pharmacy', sub: 'pos' },
                { icon: 'fas fa-boxes-stacked', color: 'blue', label: 'View Inventory', module: 'inventory', sub: 'view-inventory' },
                { icon: 'fas fa-plus-circle', color: 'teal', label: 'Add Inventory', module: 'inventory', sub: 'add-inventory' },
                { icon: 'fas fa-receipt', color: 'purple', label: 'All Sales', module: 'pharmacy', sub: 'all-sales' },
                { icon: 'fas fa-hospital-user', color: 'blue', label: 'Patients / Customers', module: 'patients', sub: 'manage-patients' },
                { icon: 'fas fa-file-invoice-dollar', color: 'red', label: 'Expenses', module: 'expenses', sub: 'manage-expenses' },
                { icon: 'fas fa-boxes-packing', color: 'orange', label: 'Medication Orders', module: 'medication-refill', sub: 'manage-orders' },
                { icon: 'fas fa-store', color: 'indigo', label: 'Wholesale', module: 'wholesale', sub: 'manage-wholesale' },
                { icon: 'fas fa-truck', color: 'teal', label: 'Suppliers', module: 'supplier', sub: null },
                { icon: 'fas fa-prescription', color: 'cyan', label: 'Prescriptions', module: 'pharmacy', sub: 'prescription' },
                { icon: 'fas fa-book', color: 'red', label: 'DDA Register', module: 'dda-register', sub: 'view-register' },
                { icon: 'fas fa-clipboard-list', color: 'green', label: 'Reports', module: 'reports', sub: 'generate-report' },
                { icon: 'fas fa-calculator', color: 'purple', label: 'Accounts', module: 'accounts', sub: null },
                { icon: 'fas fa-cog', color: 'orange', label: 'Settings', module: 'settings', sub: null }
            ];

            body.innerHTML = `
                <div class="gs-section-label">Quick Navigation</div>
                ${modules.map((m, i) => `
                    <div class="search-result-item" data-module="${m.module}" data-sub="${m.sub || ''}" data-idx="${i}">
                        <div class="search-result-icon search-result-icon--${m.color}">
                            <i class="${m.icon}"></i>
                        </div>
                        <div class="search-result-info">
                            <span class="search-result-title">${m.label}</span>
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

                // Run ALL queries in parallel
                const [invSnap, patSnap, salesSnap, supSnap, expSnap, wsSnap, rxSnap] = await Promise.all([
                    ref('inventory').limit(200).get(),
                    ref('patients').limit(100).get(),
                    ref('sales').orderBy('createdAt', 'desc').limit(100).get(),
                    ref('suppliers').limit(100).get(),
                    ref('expenses').orderBy('createdAt', 'desc').limit(80).get(),
                    ref('wholesale_orders').orderBy('createdAt', 'desc').limit(80).get(),
                    ref('prescriptions').orderBy('createdAt', 'desc').limit(80).get()
                ]);

                // Inventory
                invSnap.forEach(doc => {
                    const d = doc.data();
                    const name = (d.name || '').toLowerCase();
                    const sku = (d.sku || '').toLowerCase();
                    const category = (d.category || '').toLowerCase();
                    if (name.includes(q) || sku.includes(q) || category.includes(q)) {
                        results.push({
                            type: 'inventory', icon: 'fas fa-pills', color: 'green',
                            title: d.name || 'Unknown Product',
                            subtitle: `SKU: ${d.sku || 'N/A'} | Qty: ${d.quantity || 0} | ${this.formatCurrency(d.sellingPrice || 0)}`,
                            navigate: { module: 'inventory', sub: 'view-inventory' }
                        });
                    }
                });

                // Patients
                patSnap.forEach(doc => {
                    const d = doc.data();
                    const name = (d.name || d.displayName || '').toLowerCase();
                    const phone = (d.phone || '').toLowerCase();
                    const email = (d.email || '').toLowerCase();
                    if (name.includes(q) || phone.includes(q) || email.includes(q)) {
                        results.push({
                            type: 'customer', icon: 'fas fa-user', color: 'blue',
                            title: d.name || d.displayName || 'Unknown Customer',
                            subtitle: `Phone: ${d.phone || 'N/A'} | ${d.email || ''}`,
                            navigate: { module: 'patients', sub: 'manage-patients' }
                        });
                    }
                });

                // Sales
                salesSnap.forEach(doc => {
                    const d = doc.data();
                    const saleId = (d.saleId || doc.id || '').toLowerCase();
                    const customer = (d.customerName || '').toLowerCase();
                    if (saleId.includes(q) || customer.includes(q)) {
                        results.push({
                            type: 'sale', icon: 'fas fa-receipt', color: 'purple',
                            title: `Sale ${d.saleId || doc.id}`,
                            subtitle: `${d.customerName || 'Walk-in'} | ${this.formatCurrency(d.total || 0)} | ${this.formatDate(d.createdAt)}`,
                            navigate: { module: 'pharmacy', sub: 'all-sales' }
                        });
                    }
                });

                // Suppliers
                supSnap.forEach(doc => {
                    const d = doc.data();
                    const name = (d.name || '').toLowerCase();
                    const contact = (d.contactPerson || '').toLowerCase();
                    if (name.includes(q) || contact.includes(q)) {
                        results.push({
                            type: 'supplier', icon: 'fas fa-truck', color: 'teal',
                            title: d.name || 'Unknown Supplier',
                            subtitle: `Contact: ${d.contactPerson || 'N/A'} | ${d.phone || ''}`,
                            navigate: { module: 'supplier', sub: null }
                        });
                    }
                });

                // Expenses
                expSnap.forEach(doc => {
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
                wsSnap.forEach(doc => {
                    const d = doc.data();
                    const orderId = (d.orderId || doc.id || '').toLowerCase();
                    const client = (d.clientName || d.customerName || '').toLowerCase();
                    if (orderId.includes(q) || client.includes(q)) {
                        results.push({
                            type: 'wholesale', icon: 'fas fa-store', color: 'indigo',
                            title: `Order ${d.orderId || doc.id}`,
                            subtitle: `${d.clientName || d.customerName || 'Client'} | ${this.formatCurrency(d.total || d.grandTotal || 0)}`,
                            navigate: { module: 'wholesale', sub: 'manage-wholesale' }
                        });
                    }
                });

                // Prescriptions
                rxSnap.forEach(doc => {
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
            } catch (err) {
                console.error('Search error:', err);
            }

            // Also match module keywords for quick navigation
            const moduleMatches = this._matchModuleKeywords(q);

            // Render results
            this._gsActiveIndex = -1;
            if (results.length === 0 && moduleMatches.length === 0) {
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
            results.forEach(r => {
                if (!grouped[r.type]) grouped[r.type] = [];
                grouped[r.type].push(r);
            });

            const typeLabels = {
                inventory: 'Inventory', customer: 'Customers', sale: 'Sales',
                supplier: 'Suppliers', expense: 'Expenses', wholesale: 'Wholesale',
                prescription: 'Prescriptions'
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

            const totalResults = results.length + moduleMatches.length;
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
            const all = [
                { keywords: ['inventory', 'stock', 'product', 'medicine', 'drug'], icon: 'fas fa-boxes-stacked', color: 'blue', label: 'View Inventory', module: 'inventory', sub: 'view-inventory' },
                { keywords: ['sale', 'pos', 'transaction', 'checkout', 'sell'], icon: 'fas fa-cart-shopping', color: 'green', label: 'Point of Sale', module: 'pharmacy', sub: 'pos' },
                { keywords: ['sale', 'all sale', 'history'], icon: 'fas fa-receipt', color: 'purple', label: 'All Sales', module: 'pharmacy', sub: 'all-sales' },
                { keywords: ['patient', 'customer', 'client', 'buyer'], icon: 'fas fa-hospital-user', color: 'blue', label: 'Patients / Customers', module: 'patients', sub: 'manage-patients' },
                { keywords: ['expense', 'cost', 'spend', 'bill'], icon: 'fas fa-file-invoice-dollar', color: 'red', label: 'Expenses', module: 'expenses', sub: 'manage-expenses' },
                { keywords: ['order', 'refill', 'medication', 'restock'], icon: 'fas fa-boxes-packing', color: 'orange', label: 'Medication Orders', module: 'medication-refill', sub: 'manage-orders' },
                { keywords: ['wholesale', 'bulk'], icon: 'fas fa-store', color: 'indigo', label: 'Wholesale', module: 'wholesale', sub: 'manage-wholesale' },
                { keywords: ['supplier', 'vendor'], icon: 'fas fa-truck', color: 'teal', label: 'Suppliers', module: 'supplier', sub: null },
                { keywords: ['prescription', 'rx'], icon: 'fas fa-prescription', color: 'cyan', label: 'Prescriptions', module: 'pharmacy', sub: 'prescription' },
                { keywords: ['dda', 'register', 'controlled'], icon: 'fas fa-book', color: 'red', label: 'DDA Register', module: 'dda-register', sub: 'view-register' },
                { keywords: ['report', 'analytics', 'summary'], icon: 'fas fa-clipboard-list', color: 'green', label: 'Reports', module: 'reports', sub: 'generate-report' },
                { keywords: ['account', 'p&l', 'profit', 'loss', 'finance'], icon: 'fas fa-calculator', color: 'purple', label: 'Accounts', module: 'accounts', sub: null },
                { keywords: ['setting', 'config', 'preference'], icon: 'fas fa-cog', color: 'orange', label: 'Settings', module: 'settings', sub: null },
                { keywords: ['admin', 'panel', 'user', 'staff'], icon: 'fas fa-user-shield', color: 'red', label: 'Admin Panel', module: 'admin-panel', sub: null },
                { keywords: ['activity', 'log', 'audit'], icon: 'fas fa-list-check', color: 'teal', label: 'Activity Logs', module: 'activity-log', sub: null },
                { keywords: ['dashboard', 'home', 'overview'], icon: 'fas fa-tachometer-alt', color: 'green', label: 'Dashboard', module: 'dashboard', sub: null }
            ];
            return all.filter(m => m.keywords.some(kw => kw.includes(q) || q.includes(kw)));
        },

        /**
         * Handle module-level navigation from Enter key in search
         */
        handleModuleSearch: function (query) {
            const q = query.toLowerCase();
            if (q.includes('inventory') || q.includes('stock') || q.includes('product')) {
                PharmaFlow.Sidebar.setActive('inventory', 'view-inventory');
            } else if (q.includes('sale') || q.includes('pos') || q.includes('transaction')) {
                PharmaFlow.Sidebar.setActive('pharmacy', 'all-sales');
            } else if (q.includes('patient') || q.includes('customer')) {
                PharmaFlow.Sidebar.setActive('patients', 'manage-patients');
            } else if (q.includes('expense')) {
                PharmaFlow.Sidebar.setActive('expenses', 'manage-expenses');
            } else if (q.includes('order') || q.includes('refill')) {
                PharmaFlow.Sidebar.setActive('medication-refill', 'manage-orders');
            } else if (q.includes('report')) {
                PharmaFlow.Sidebar.setActive('reports', 'generate-report');
            } else if (q.includes('supplier')) {
                PharmaFlow.Sidebar.setActive('supplier', null);
            } else if (q.includes('wholesale')) {
                PharmaFlow.Sidebar.setActive('wholesale', 'manage-wholesale');
            } else if (q.includes('dda') || q.includes('register')) {
                PharmaFlow.Sidebar.setActive('dda-register', 'view-register');
            } else if (q.includes('prescription')) {
                PharmaFlow.Sidebar.setActive('pharmacy', 'prescription');
            }
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
            this._listenInventory(businessId, today);

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
                    const getCurrency = () => PharmaFlow.Settings ? PharmaFlow.Settings.getCurrency() : 'KSH';
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
                        const amountStr = a.amount ? ` — <strong>${getCurrency()} ${Number(a.amount).toLocaleString()}</strong>` : '';
                        const dueStr = a.dueDate ? ` (Due: ${a.dueDate})` : '';
                        const payBtn = (a.showPayButton && a.type === 'payment_due')
                            ? `<button class="dash-alert-paynow" data-alert-id="${this.escapeHtml(a.id)}"><i class="fas fa-credit-card"></i> Pay Now</button>`
                            : '';
                        return `
                            <div class="dash-alert-banner-item">
                                <div class="dash-alert-banner-msg">
                                    <i class="${icon}"></i>
                                    <span>${this.escapeHtml(a.message || 'You have a pending alert.')}${amountStr}${dueStr}</span>
                                </div>
                                <div style="display:flex;gap:8px;align-items:center">
                                    ${payBtn}
                                    <button class="dash-alert-dismiss" data-alert-id="${this.escapeHtml(a.id)}" title="Dismiss"><i class="fas fa-times"></i></button>
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
                            const amount = alertData && alertData.amount ? Number(alertData.amount).toLocaleString() : '';
                            const currency = getCurrency();
                            if (window.Swal) {
                                window.Swal.fire({
                                    icon: 'info',
                                    title: 'Payment Required',
                                    html: `<p>Please contact the system administrator to complete your payment.</p>`
                                        + (amount ? `<p style="margin-top:10px;font-size:1.2rem;font-weight:700">${currency} ${amount}</p>` : ''),
                                    confirmButtonText: 'OK'
                                });
                            } else {
                                window.alert('Please contact the system administrator to complete your payment.' + (amount ? '\nAmount: ' + currency + ' ' + amount : ''));
                            }
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
         * Inventory real-time listener
         */
        _listenInventory: function (businessId, today) {
            const invRef = getBusinessCollection(businessId, 'inventory');
            if (!invRef) return;

            const thirtyDaysFromNow = new Date();
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

            const unsub = invRef.onSnapshot(snap => {
                if (!this._isActive) return;
                let outOfStock = 0;
                let expiringSoon = 0;
                let inventoryValue = 0;

                snap.forEach(doc => {
                    const data = doc.data();
                    const qty = parseFloat(data.quantity || 0);
                    const price = parseFloat(data.buyingPrice || data.sellingPrice || 0);
                    inventoryValue += qty * price;
                    if (qty <= 0) outOfStock++;
                    if (data.expiryDate) {
                        const exp = new Date(data.expiryDate);
                        if (exp <= thirtyDaysFromNow && exp >= today) expiringSoon++;
                    }
                });

                this.setStat('stat-total-products', snap.size);
                this.setStat('stat-out-of-stock', outOfStock);
                this.setStat('stat-expiring-soon', expiringSoon);
                this.setStat('stat-inventory-value', this.formatCurrency(inventoryValue));
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
            return 'KSH ' + new Intl.NumberFormat('en-KE', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(amount);
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
