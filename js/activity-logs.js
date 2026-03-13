/**
 * PharmaFlow - Activity Log Module
 *   1. All Activities   – Full log table with search, filter, pagination
 *   2. User Activities  – Filtered by specific user
 *   3. System Alerts    – Important system events
 *
 * Also exposes a global PharmaFlow.ActivityLog.log() method for other modules
 * to write entries into the activity_log Firestore collection.
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    /* ─── module-level state ─── */
    let alUnsubAll = null;
    let alAllLogs = [];
    let alFilteredLogs = [];
    let alCurrentPage = 1;
    const AL_PAGE_SIZE = 25;
    const AL_MAX_FETCH = 500;

    /* category → {icon, color} */
    const AL_CATEGORIES = {
        'Sale':         { icon: 'fas fa-cash-register',      color: '#0ea5e9' },
        'Inventory':    { icon: 'fas fa-boxes-stacked',       color: '#8b5cf6' },
        'Expense':      { icon: 'fas fa-money-bill-wave',     color: '#ef4444' },
        'Patient':      { icon: 'fas fa-hospital-user',       color: '#10b981' },
        'Wholesale':    { icon: 'fas fa-store',               color: '#f59e0b' },
        'Supplier':     { icon: 'fas fa-truck-field',         color: '#6366f1' },
        'Order':        { icon: 'fas fa-clipboard-list',      color: '#14b8a6' },
        'DDA':          { icon: 'fas fa-book-medical',        color: '#ec4899' },
        'User':         { icon: 'fas fa-user-cog',            color: '#64748b' },
        'System':       { icon: 'fas fa-server',              color: '#475569' },
        'Billing':      { icon: 'fas fa-file-invoice-dollar', color: '#0284c7' },
        'Refill':       { icon: 'fas fa-pills',               color: '#22c55e' },
        'Report':       { icon: 'fas fa-chart-bar',           color: '#a855f7' },
        'Account':      { icon: 'fas fa-calculator',          color: '#0891b2' },
        'Auth':         { icon: 'fas fa-shield-halved',       color: '#dc2626' },
        'Other':        { icon: 'fas fa-circle-info',         color: '#94a3b8' }
    };

    const STATUS_MAP = {
        'COMPLETED':  { badge: 'al-badge--success',  label: 'Completed' },
        'PENDING':    { badge: 'al-badge--warning',  label: 'Pending' },
        'FAILED':     { badge: 'al-badge--danger',   label: 'Failed' },
        'INFO':       { badge: 'al-badge--info',     label: 'Info' },
        'WARNING':    { badge: 'al-badge--warning',  label: 'Warning' },
        'CRITICAL':   { badge: 'al-badge--danger',   label: 'Critical' }
    };

    const ActivityLog = {

        /* ══════════════════════════════════
         * HELPERS
         * ══════════════════════════════════ */

        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        getCurrentUser: function () {
            const p = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
            return p ? (p.displayName || p.email || 'User') : 'Unknown';
        },

        getCurrentUid: function () {
            return window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null;
        },

        escapeHtml: function (str) {
            const div = document.createElement('div');
            div.textContent = str || '';
            return div.innerHTML;
        },

        showToast: function (msg, type) {
            const old = document.querySelector('.al-toast');
            if (old) old.remove();
            const t = document.createElement('div');
            t.className = 'al-toast al-toast--' + (type || 'success');
            t.innerHTML = '<i class="fas fa-' + (type === 'error' ? 'exclamation-circle' : 'check-circle') + '"></i> ' + this.escapeHtml(msg);
            document.body.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
        },

        formatDate: function (val) {
            if (!val) return '—';
            let d;
            if (val.toDate) d = val.toDate();
            else if (val.seconds) d = new Date(val.seconds * 1000);
            else d = new Date(val);
            if (isNaN(d.getTime())) return '—';
            return d.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
        },

        formatTime: function (val) {
            if (!val) return '';
            let d;
            if (val.toDate) d = val.toDate();
            else if (val.seconds) d = new Date(val.seconds * 1000);
            else d = new Date(val);
            if (isNaN(d.getTime())) return '';
            return d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
        },

        formatDateTime: function (val) {
            const dt = this.formatDate(val);
            const tm = this.formatTime(val);
            return tm ? dt + ' ' + tm : dt;
        },

        formatCurrency: function (amount) {
            if (amount == null || amount === '' || amount === '-') return '—';
            return 'KSH ' + new Intl.NumberFormat('en-KE', {
                minimumFractionDigits: 2, maximumFractionDigits: 2
            }).format(amount || 0);
        },

        toISODate: function (d) {
            return d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
        },

        getCatMeta: function (cat) {
            return AL_CATEGORIES[cat] || AL_CATEGORIES['Other'];
        },

        getStatusMeta: function (status) {
            return STATUS_MAP[status] || STATUS_MAP['COMPLETED'];
        },

        cleanup: function () {
            if (alUnsubAll) { alUnsubAll(); alUnsubAll = null; }
            alAllLogs = [];
            alFilteredLogs = [];
            alCurrentPage = 1;
        },

        /* ══════════════════════════════════
         * GLOBAL LOG WRITER
         * Call from any module:
         *   PharmaFlow.ActivityLog.log({
         *       title: 'Sale Completed',
         *       description: 'Sold 3 items totaling KSH 1500',
         *       category: 'Sale',
         *       status: 'COMPLETED',
         *       amount: 1500,
         *       metadata: { saleId: '...', items: 3 }
         *   });
         * ══════════════════════════════════ */

        log: function (opts) {
            try {
                const businessId = this.getBusinessId();
                if (!businessId) return;
                const ref = PharmaFlow.getBusinessCollection(businessId, 'activity_log');
                if (!ref) return;

                const entry = {
                    title: opts.title || 'Activity',
                    description: opts.description || '',
                    category: opts.category || 'Other',
                    action: opts.action || opts.title || 'action',
                    status: opts.status || 'COMPLETED',
                    amount: opts.amount != null ? opts.amount : null,
                    createdAt: new Date().toISOString(),
                    createdBy: this.getCurrentUser(),
                    createdByUid: this.getCurrentUid(),
                    metadata: opts.metadata || null
                };

                ref.add(entry).catch(function (err) {
                    console.error('ActivityLog write failed:', err);
                });
            } catch (e) {
                console.error('ActivityLog.log error:', e);
            }
        },

        /* ══════════════════════════════════════════
         * 1) ALL ACTIVITIES
         * ══════════════════════════════════════════ */

        renderAll: function (container) {
            this.cleanup();
            const businessId = this.getBusinessId();
            const today = new Date();
            const weekAgo = new Date(today);
            weekAgo.setDate(weekAgo.getDate() - 7);

            container.innerHTML = `
                <div class="al-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-clock-rotate-left"></i> All Activities</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Activity Log</span><span>/</span><span>All Activities</span>
                            </div>
                        </div>
                    </div>

                    <!-- Stats row -->
                    <div class="al-stats-row">
                        <div class="al-stat-card">
                            <div class="al-stat-icon" style="background:#dbeafe;color:#2563eb;"><i class="fas fa-list"></i></div>
                            <div class="al-stat-info"><span class="al-stat-value" id="al-stat-total">0</span><span class="al-stat-label">Total Logs</span></div>
                        </div>
                        <div class="al-stat-card">
                            <div class="al-stat-icon" style="background:#dcfce7;color:#16a34a;"><i class="fas fa-calendar-day"></i></div>
                            <div class="al-stat-info"><span class="al-stat-value" id="al-stat-today">0</span><span class="al-stat-label">Today</span></div>
                        </div>
                        <div class="al-stat-card">
                            <div class="al-stat-icon" style="background:#fef3c7;color:#d97706;"><i class="fas fa-users"></i></div>
                            <div class="al-stat-info"><span class="al-stat-value" id="al-stat-users">0</span><span class="al-stat-label">Active Users</span></div>
                        </div>
                        <div class="al-stat-card">
                            <div class="al-stat-icon" style="background:#fce7f3;color:#db2777;"><i class="fas fa-exclamation-triangle"></i></div>
                            <div class="al-stat-info"><span class="al-stat-value" id="al-stat-alerts">0</span><span class="al-stat-label">Alerts</span></div>
                        </div>
                    </div>

                    <!-- Filters bar -->
                    <div class="al-filters-bar">
                        <div class="al-filter-group">
                            <label>Search</label>
                            <input type="text" id="al-search" class="al-input" placeholder="Search logs...">
                        </div>
                        <div class="al-filter-group">
                            <label>Category</label>
                            <select id="al-filter-category" class="al-select">
                                <option value="">All Categories</option>
                                ${Object.keys(AL_CATEGORIES).map(c => '<option value="' + c + '">' + c + '</option>').join('')}
                            </select>
                        </div>
                        <div class="al-filter-group">
                            <label>Status</label>
                            <select id="al-filter-status" class="al-select">
                                <option value="">All Statuses</option>
                                ${Object.keys(STATUS_MAP).map(s => '<option value="' + s + '">' + STATUS_MAP[s].label + '</option>').join('')}
                            </select>
                        </div>
                        <div class="al-filter-group">
                            <label>From</label>
                            <input type="date" id="al-filter-from" class="al-input" value="${this.toISODate(weekAgo)}">
                        </div>
                        <div class="al-filter-group">
                            <label>To</label>
                            <input type="date" id="al-filter-to" class="al-input" value="${this.toISODate(today)}">
                        </div>
                        <div class="al-filter-group al-filter-actions">
                            <label>&nbsp;</label>
                            <button class="al-btn al-btn--primary" id="al-btn-apply"><i class="fas fa-search"></i> Filter</button>
                            <button class="al-btn al-btn--secondary" id="al-btn-reset"><i class="fas fa-rotate-left"></i> Reset</button>
                        </div>
                    </div>

                    <!-- Toolbar -->
                    <div class="al-toolbar">
                        <div class="al-toolbar-left">
                            <span class="al-results-count" id="al-results-count">0 results</span>
                        </div>
                        <div class="al-toolbar-right">
                            <button class="al-btn al-btn--outline" id="al-btn-export-csv" title="Export CSV"><i class="fas fa-file-csv"></i></button>
                            <button class="al-btn al-btn--outline" id="al-btn-print" title="Print"><i class="fas fa-print"></i></button>
                            <button class="al-btn al-btn--outline" id="al-btn-refresh" title="Refresh"><i class="fas fa-sync-alt"></i></button>
                            <button class="al-btn al-btn--outline" id="al-btn-retention" title="Auto-Cleanup Settings"><i class="fas fa-gear"></i></button>
                        </div>
                    </div>

                    <!-- Retention Settings Panel -->
                    <div class="al-retention-panel" id="al-retention-panel" style="display:none;">
                        <div class="al-retention-header">
                            <div class="al-retention-title"><i class="fas fa-broom"></i> Auto-Cleanup Settings</div>
                            <button class="al-retention-close" id="al-retention-close" title="Close"><i class="fas fa-times"></i></button>
                        </div>
                        <p class="al-retention-desc">Automatically delete old activity logs and system alerts from the database. Once deleted, records cannot be recovered.</p>
                        <div class="al-retention-body">
                            <div class="al-retention-option">
                                <label class="al-retention-label">
                                    <input type="radio" name="al-retention" value="off" checked>
                                    <span><strong>Off</strong> — No automatic cleanup</span>
                                </label>
                            </div>
                            <div class="al-retention-option">
                                <label class="al-retention-label">
                                    <input type="radio" name="al-retention" value="7">
                                    <span><strong>7 Days</strong> — Delete logs older than 7 days</span>
                                </label>
                            </div>
                            <div class="al-retention-option">
                                <label class="al-retention-label">
                                    <input type="radio" name="al-retention" value="30">
                                    <span><strong>30 Days</strong> — Delete logs older than 30 days</span>
                                </label>
                            </div>
                        </div>
                        <div class="al-retention-footer">
                            <span class="al-retention-status" id="al-retention-status"></span>
                            <button class="al-btn al-btn--primary" id="al-btn-save-retention"><i class="fas fa-save"></i> Save Settings</button>
                        </div>
                    </div>

                    <!-- Log table -->
                    <div class="al-table-wrap">
                        <table class="al-table">
                            <thead>
                                <tr>
                                    <th style="width:40px;">#</th>
                                    <th>Activity</th>
                                    <th>Category</th>
                                    <th>User</th>
                                    <th>Amount</th>
                                    <th>Status</th>
                                    <th>Date / Time</th>
                                </tr>
                            </thead>
                            <tbody id="al-table-body">
                                <tr><td colspan="7" class="al-empty"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="al-pagination" id="al-pagination"></div>
                </div>
            `;

            // Bind breadcrumb
            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', function (e) {
                e.preventDefault();
                PharmaFlow.Sidebar.setActive('dashboard', null);
            });

            this._bindAllFilters();
            this._loadLogs(businessId);
        },

        _bindAllFilters: function () {
            const self = this;

            const applyBtn = document.getElementById('al-btn-apply');
            const resetBtn = document.getElementById('al-btn-reset');
            const searchInput = document.getElementById('al-search');
            const exportBtn = document.getElementById('al-btn-export-csv');
            const printBtn = document.getElementById('al-btn-print');
            const refreshBtn = document.getElementById('al-btn-refresh');

            if (applyBtn) applyBtn.addEventListener('click', function () { self._applyFilters(); });
            if (resetBtn) resetBtn.addEventListener('click', function () { self._resetFilters(); });
            if (searchInput) {
                let debounce;
                searchInput.addEventListener('input', function () {
                    clearTimeout(debounce);
                    debounce = setTimeout(function () { self._applyFilters(); }, 300);
                });
            }
            if (exportBtn) exportBtn.addEventListener('click', function () { self._exportCSV(); });
            if (printBtn) printBtn.addEventListener('click', function () { self._printLogs(); });
            if (refreshBtn) refreshBtn.addEventListener('click', function () {
                self.cleanup();
                self._loadLogs(self.getBusinessId());
            });

            // Retention settings toggle
            var retentionBtn = document.getElementById('al-btn-retention');
            var retentionPanel = document.getElementById('al-retention-panel');
            var retentionClose = document.getElementById('al-retention-close');
            var saveRetentionBtn = document.getElementById('al-btn-save-retention');

            if (retentionBtn && retentionPanel) {
                retentionBtn.addEventListener('click', function () {
                    var isOpen = retentionPanel.style.display !== 'none';
                    retentionPanel.style.display = isOpen ? 'none' : 'block';
                    if (!isOpen) self._loadRetentionSetting();
                });
            }
            if (retentionClose && retentionPanel) {
                retentionClose.addEventListener('click', function () { retentionPanel.style.display = 'none'; });
            }
            if (saveRetentionBtn) {
                saveRetentionBtn.addEventListener('click', function () { self._saveRetentionSetting(); });
            }
        },

        /* ══════════════════════════════════════════
         * RETENTION / AUTO-CLEANUP
         * ══════════════════════════════════════════ */

        _loadRetentionSetting: function () {
            var businessId = this.getBusinessId();
            if (!businessId) return;
            var statusEl = document.getElementById('al-retention-status');
            if (statusEl) statusEl.textContent = 'Loading…';

            window.db.collection('businesses').doc(businessId).collection('settings').doc('retention').get()
                .then(function (doc) {
                    var data = doc.exists ? doc.data() : {};
                    var val = data.retentionDays ? String(data.retentionDays) : 'off';
                    var radios = document.querySelectorAll('input[name="al-retention"]');
                    radios.forEach(function (r) { r.checked = (r.value === val); });
                    if (statusEl) {
                        if (data.lastCleanup) {
                            statusEl.textContent = 'Last cleanup: ' + new Date(data.lastCleanup).toLocaleString('en-KE');
                        } else {
                            statusEl.textContent = val === 'off' ? 'Auto-cleanup is off' : 'No cleanup has run yet';
                        }
                    }
                })
                .catch(function () {
                    if (statusEl) statusEl.textContent = 'Failed to load settings';
                });
        },

        _saveRetentionSetting: function () {
            var businessId = this.getBusinessId();
            if (!businessId) return;
            var self = this;
            var selected = document.querySelector('input[name="al-retention"]:checked');
            if (!selected) return;
            var val = selected.value;
            var days = val === 'off' ? null : parseInt(val, 10);
            var statusEl = document.getElementById('al-retention-status');
            var saveBtn = document.getElementById('al-btn-save-retention');

            if (saveBtn) saveBtn.disabled = true;
            if (statusEl) statusEl.textContent = 'Saving…';

            var settingData = {
                retentionDays: days,
                updatedAt: new Date().toISOString(),
                updatedBy: this.getCurrentUser()
            };

            window.db.collection('businesses').doc(businessId).collection('settings').doc('retention')
                .set(settingData, { merge: true })
                .then(function () {
                    if (statusEl) statusEl.textContent = 'Settings saved!';
                    self.showToast('Retention settings saved');
                    if (saveBtn) saveBtn.disabled = false;
                    // Run cleanup immediately if enabled
                    if (days) self._runAutoCleanup(businessId, days);
                })
                .catch(function (err) {
                    console.error('Save retention error:', err);
                    if (statusEl) statusEl.textContent = 'Failed to save';
                    self.showToast('Failed to save retention settings', 'error');
                    if (saveBtn) saveBtn.disabled = false;
                });
        },

        _runAutoCleanup: function (businessId, retentionDays) {
            if (!businessId || !retentionDays) return;
            var self = this;
            var cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - retentionDays);
            var cutoffStr = cutoff.toISOString();

            var ref = PharmaFlow.getBusinessCollection(businessId, 'activity_log');
            if (!ref) return;

            ref.where('createdAt', '<', cutoffStr).get()
                .then(function (snap) {
                    if (snap.empty) {
                        self.showToast('No old records to clean up');
                        return;
                    }
                    // Firestore batch limit is 500 — split into chunks
                    var docs = [];
                    snap.forEach(function (doc) { docs.push(doc.ref); });
                    var totalCount = docs.length;
                    var batches = [];
                    for (var i = 0; i < docs.length; i += 499) {
                        var batch = window.db.batch();
                        docs.slice(i, i + 499).forEach(function (docRef) { batch.delete(docRef); });
                        batches.push(batch.commit());
                    }
                    return Promise.all(batches).then(function () {
                        // Update last cleanup time
                        window.db.collection('businesses').doc(businessId).collection('settings').doc('retention')
                            .set({ lastCleanup: new Date().toISOString() }, { merge: true });
                        self.showToast(totalCount + ' old record(s) cleaned up');
                        var statusEl = document.getElementById('al-retention-status');
                        if (statusEl) statusEl.textContent = 'Cleaned up ' + totalCount + ' record(s) just now';
                    });
                })
                .catch(function (err) {
                    console.error('Auto-cleanup error:', err);
                    self.showToast('Cleanup failed', 'error');
                });
        },

        /**
         * Called on app load / auth-ready to purge old logs automatically.
         * Reads the retention setting, and if enabled and the last cleanup was
         * more than 24 hours ago, runs the batch delete.
         */
        runScheduledCleanup: function () {
            var self = this;
            var businessId = this.getBusinessId();
            if (!businessId) return;

            window.db.collection('businesses').doc(businessId).collection('settings').doc('retention').get()
                .then(function (doc) {
                    if (!doc.exists) return;
                    var data = doc.data();
                    if (!data.retentionDays) return;

                    // Only run once per 24h
                    if (data.lastCleanup) {
                        var last = new Date(data.lastCleanup).getTime();
                        if (Date.now() - last < 24 * 60 * 60 * 1000) return;
                    }

                    self._runAutoCleanup(businessId, data.retentionDays);
                })
                .catch(function (err) {
                    console.error('Scheduled cleanup check error:', err);
                });
        },

        _loadLogs: function (businessId) {
            if (!businessId) {
                this._renderEmpty('No business context');
                return;
            }

            const self = this;
            const fromEl = document.getElementById('al-filter-from');
            const toEl = document.getElementById('al-filter-to');

            let fromDate = fromEl ? fromEl.value : null;
            let toDate = toEl ? toEl.value : null;

            if (!fromDate) {
                const d = new Date(); d.setDate(d.getDate() - 7);
                fromDate = this.toISODate(d);
            }
            if (!toDate) {
                toDate = this.toISODate(new Date());
            }

            // toDate end of day
            const toDateEnd = toDate + 'T23:59:59.999Z';
            const fromDateStart = fromDate + 'T00:00:00.000Z';

            const ref = PharmaFlow.getBusinessCollection(businessId, 'activity_log');
            if (!ref) { this._renderEmpty('Collection unavailable'); return; }

            if (alUnsubAll) { alUnsubAll(); alUnsubAll = null; }

            alUnsubAll = ref
                .where('createdAt', '>=', fromDateStart)
                .where('createdAt', '<=', toDateEnd)
                .orderBy('createdAt', 'desc')
                .limit(AL_MAX_FETCH)
                .onSnapshot(function (snap) {
                    alAllLogs = [];
                    snap.forEach(function (doc) {
                        alAllLogs.push(Object.assign({ id: doc.id }, doc.data()));
                    });
                    self._applyFilters();
                    self._updateStats();
                }, function (err) {
                    console.error('Activity log listener error:', err);
                    self._renderEmpty('Failed to load logs');
                });
        },

        _applyFilters: function () {
            const search = (document.getElementById('al-search') || {}).value || '';
            const catFilter = (document.getElementById('al-filter-category') || {}).value || '';
            const statusFilter = (document.getElementById('al-filter-status') || {}).value || '';
            const q = search.toLowerCase().trim();

            alFilteredLogs = alAllLogs.filter(function (log) {
                if (catFilter && log.category !== catFilter) return false;
                if (statusFilter && log.status !== statusFilter) return false;
                if (q) {
                    const haystack = [
                        log.title, log.description, log.createdBy, log.category, log.status
                    ].join(' ').toLowerCase();
                    if (haystack.indexOf(q) === -1) return false;
                }
                return true;
            });

            alCurrentPage = 1;
            this._renderTable();
            this._renderPagination();

            const countEl = document.getElementById('al-results-count');
            if (countEl) countEl.textContent = alFilteredLogs.length + ' result' + (alFilteredLogs.length !== 1 ? 's' : '');
        },

        _resetFilters: function () {
            var s = document.getElementById('al-search'); if (s) s.value = '';
            var c = document.getElementById('al-filter-category'); if (c) c.value = '';
            var st = document.getElementById('al-filter-status'); if (st) st.value = '';

            var today = new Date();
            var weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
            var f = document.getElementById('al-filter-from'); if (f) f.value = this.toISODate(weekAgo);
            var t = document.getElementById('al-filter-to'); if (t) t.value = this.toISODate(today);

            this.cleanup();
            this._loadLogs(this.getBusinessId());
        },

        _updateStats: function () {
            const todayStr = this.toISODate(new Date());
            let todayCount = 0;
            const userSet = new Set();
            let alertCount = 0;

            alAllLogs.forEach(function (log) {
                if (log.createdAt && log.createdAt.substring(0, 10) === todayStr) todayCount++;
                if (log.createdBy) userSet.add(log.createdBy);
                if (log.status === 'FAILED' || log.status === 'CRITICAL' || log.status === 'WARNING') alertCount++;
            });

            var el;
            el = document.getElementById('al-stat-total'); if (el) el.textContent = alAllLogs.length;
            el = document.getElementById('al-stat-today'); if (el) el.textContent = todayCount;
            el = document.getElementById('al-stat-users'); if (el) el.textContent = userSet.size;
            el = document.getElementById('al-stat-alerts'); if (el) el.textContent = alertCount;
        },

        _renderTable: function () {
            const tbody = document.getElementById('al-table-body');
            if (!tbody) return;

            if (alFilteredLogs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="al-empty"><i class="fas fa-inbox"></i> No activity logs found</td></tr>';
                return;
            }

            const start = (alCurrentPage - 1) * AL_PAGE_SIZE;
            const page = alFilteredLogs.slice(start, start + AL_PAGE_SIZE);
            const self = this;

            tbody.innerHTML = page.map(function (log, i) {
                const cat = self.getCatMeta(log.category);
                const st = self.getStatusMeta(log.status);
                const amountStr = log.amount != null && log.amount !== '' ? self.formatCurrency(log.amount) : '—';

                return '<tr>' +
                    '<td class="al-cell-num">' + (start + i + 1) + '</td>' +
                    '<td class="al-cell-activity">' +
                        '<div class="al-activity-wrap">' +
                            '<div class="al-activity-icon" style="background:' + cat.color + '20;color:' + cat.color + ';"><i class="' + cat.icon + '"></i></div>' +
                            '<div class="al-activity-text">' +
                                '<strong>' + self.escapeHtml(log.title) + '</strong>' +
                                (log.description ? '<span class="al-desc">' + self.escapeHtml(log.description) + '</span>' : '') +
                            '</div>' +
                        '</div>' +
                    '</td>' +
                    '<td><span class="al-cat-badge" style="background:' + cat.color + '18;color:' + cat.color + ';border:1px solid ' + cat.color + '40;"><i class="' + cat.icon + '"></i> ' + self.escapeHtml(log.category || 'Other') + '</span></td>' +
                    '<td class="al-cell-user">' + self.escapeHtml(log.createdBy || 'System') + '</td>' +
                    '<td class="al-cell-amount">' + amountStr + '</td>' +
                    '<td><span class="al-badge ' + st.badge + '">' + st.label + '</span></td>' +
                    '<td class="al-cell-date">' + self.formatDateTime(log.createdAt) + '</td>' +
                '</tr>';
            }).join('');
        },

        _renderPagination: function () {
            const container = document.getElementById('al-pagination');
            if (!container) return;

            const totalPages = Math.ceil(alFilteredLogs.length / AL_PAGE_SIZE);
            if (totalPages <= 1) { container.innerHTML = ''; return; }

            const self = this;
            let html = '';
            html += '<button class="al-page-btn" data-page="prev" ' + (alCurrentPage === 1 ? 'disabled' : '') + '><i class="fas fa-chevron-left"></i></button>';

            const delta = 2;
            for (let p = 1; p <= totalPages; p++) {
                if (p === 1 || p === totalPages || (p >= alCurrentPage - delta && p <= alCurrentPage + delta)) {
                    html += '<button class="al-page-btn' + (p === alCurrentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
                } else if (p === alCurrentPage - delta - 1 || p === alCurrentPage + delta + 1) {
                    html += '<span class="al-page-dots">...</span>';
                }
            }

            html += '<button class="al-page-btn" data-page="next" ' + (alCurrentPage === totalPages ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i></button>';
            container.innerHTML = html;

            container.querySelectorAll('.al-page-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    const val = btn.dataset.page;
                    if (val === 'prev') { if (alCurrentPage > 1) alCurrentPage--; }
                    else if (val === 'next') { if (alCurrentPage < totalPages) alCurrentPage++; }
                    else alCurrentPage = parseInt(val);
                    self._renderTable();
                    self._renderPagination();
                    var wrap = document.querySelector('.al-table-wrap');
                    if (wrap) wrap.scrollTop = 0;
                });
            });
        },

        _renderEmpty: function (msg) {
            const tbody = document.getElementById('al-table-body');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="al-empty"><i class="fas fa-exclamation-circle"></i> ' + (msg || 'No data') + '</td></tr>';
        },

        /* ══════════════════════════════════════════
         * 2) USER ACTIVITIES
         * ══════════════════════════════════════════ */

        renderUserActivities: function (container) {
            this.cleanup();
            const businessId = this.getBusinessId();
            const today = new Date();
            const monthAgo = new Date(today);
            monthAgo.setDate(monthAgo.getDate() - 30);

            container.innerHTML = `
                <div class="al-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-user-clock"></i> User Activities</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Activity Log</span><span>/</span><span>User Activities</span>
                            </div>
                        </div>
                    </div>

                    <!-- User filter -->
                    <div class="al-filters-bar">
                        <div class="al-filter-group">
                            <label>Select User</label>
                            <select id="al-user-select" class="al-select">
                                <option value="">All Users</option>
                            </select>
                        </div>
                        <div class="al-filter-group">
                            <label>From</label>
                            <input type="date" id="al-user-from" class="al-input" value="${this.toISODate(monthAgo)}">
                        </div>
                        <div class="al-filter-group">
                            <label>To</label>
                            <input type="date" id="al-user-to" class="al-input" value="${this.toISODate(today)}">
                        </div>
                        <div class="al-filter-group al-filter-actions">
                            <label>&nbsp;</label>
                            <button class="al-btn al-btn--primary" id="al-user-apply"><i class="fas fa-search"></i> Filter</button>
                        </div>
                    </div>

                    <!-- User stats -->
                    <div class="al-user-summary" id="al-user-summary" style="display:none;">
                        <div class="al-user-card">
                            <div class="al-user-card-header">
                                <i class="fas fa-user-circle"></i>
                                <span id="al-user-name">—</span>
                            </div>
                            <div class="al-user-card-stats">
                                <div><strong id="al-user-total-actions">0</strong><span>Actions</span></div>
                                <div><strong id="al-user-categories">0</strong><span>Categories</span></div>
                                <div><strong id="al-user-last-active">—</strong><span>Last Active</span></div>
                            </div>
                        </div>
                    </div>

                    <!-- Timeline -->
                    <div class="al-timeline" id="al-user-timeline">
                        <div class="al-empty-state"><i class="fas fa-user-clock"></i><p>Select a user or press Filter to view activities</p></div>
                    </div>
                </div>
            `;

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', function (e) {
                e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null);
            });

            this._loadUserActivities(businessId);
        },

        _loadUserActivities: function (businessId) {
            if (!businessId) return;
            const self = this;
            const fromEl = document.getElementById('al-user-from');
            const toEl = document.getElementById('al-user-to');
            const fromDate = (fromEl ? fromEl.value : this.toISODate(new Date(Date.now() - 30 * 86400000))) + 'T00:00:00.000Z';
            const toDate = (toEl ? toEl.value : this.toISODate(new Date())) + 'T23:59:59.999Z';

            const ref = PharmaFlow.getBusinessCollection(businessId, 'activity_log');
            if (!ref) return;

            if (alUnsubAll) { alUnsubAll(); alUnsubAll = null; }

            alUnsubAll = ref
                .where('createdAt', '>=', fromDate)
                .where('createdAt', '<=', toDate)
                .orderBy('createdAt', 'desc')
                .limit(AL_MAX_FETCH)
                .onSnapshot(function (snap) {
                    alAllLogs = [];
                    snap.forEach(function (doc) {
                        alAllLogs.push(Object.assign({ id: doc.id }, doc.data()));
                    });
                    self._populateUserDropdown();
                    self._renderUserTimeline();
                }, function (err) {
                    console.error('User activities listener error:', err);
                });

            var applyBtn = document.getElementById('al-user-apply');
            if (applyBtn) applyBtn.addEventListener('click', function () {
                self.cleanup();
                self._loadUserActivities(businessId);
            });
        },

        _populateUserDropdown: function () {
            const sel = document.getElementById('al-user-select');
            if (!sel) return;
            const users = new Set();
            alAllLogs.forEach(function (log) { if (log.createdBy) users.add(log.createdBy); });
            const current = sel.value;
            sel.innerHTML = '<option value="">All Users</option>' +
                Array.from(users).sort().map(function (u) { return '<option value="' + u + '"' + (u === current ? ' selected' : '') + '>' + u + '</option>'; }).join('');

            const self = this;
            sel.onchange = function () { self._renderUserTimeline(); };
        },

        _renderUserTimeline: function () {
            const selectedUser = (document.getElementById('al-user-select') || {}).value || '';
            const timeline = document.getElementById('al-user-timeline');
            const summary = document.getElementById('al-user-summary');
            if (!timeline) return;

            const logs = selectedUser ? alAllLogs.filter(function (l) { return l.createdBy === selectedUser; }) : alAllLogs;

            if (selectedUser && summary) {
                summary.style.display = 'block';
                var nameEl = document.getElementById('al-user-name');
                if (nameEl) nameEl.textContent = selectedUser;
                var totalEl = document.getElementById('al-user-total-actions');
                if (totalEl) totalEl.textContent = logs.length;
                var cats = new Set(); logs.forEach(function (l) { if (l.category) cats.add(l.category); });
                var catsEl = document.getElementById('al-user-categories');
                if (catsEl) catsEl.textContent = cats.size;
                var lastEl = document.getElementById('al-user-last-active');
                if (lastEl) lastEl.textContent = logs.length > 0 ? this.formatDateTime(logs[0].createdAt) : '—';
            } else if (summary) {
                summary.style.display = 'none';
            }

            if (logs.length === 0) {
                timeline.innerHTML = '<div class="al-empty-state"><i class="fas fa-inbox"></i><p>No activities found</p></div>';
                return;
            }

            // Group by date
            const self = this;
            const groups = {};
            logs.forEach(function (log) {
                const dateKey = log.createdAt ? log.createdAt.substring(0, 10) : 'unknown';
                if (!groups[dateKey]) groups[dateKey] = [];
                groups[dateKey].push(log);
            });

            let html = '';
            Object.keys(groups).sort().reverse().forEach(function (dateKey) {
                const dayLogs = groups[dateKey];
                const displayDate = self.formatDate(dateKey);
                html += '<div class="al-timeline-group">';
                html += '<div class="al-timeline-date"><i class="fas fa-calendar"></i> ' + displayDate + ' <span class="al-timeline-count">(' + dayLogs.length + ')</span></div>';
                dayLogs.forEach(function (log) {
                    const cat = self.getCatMeta(log.category);
                    const st = self.getStatusMeta(log.status);
                    html += '<div class="al-timeline-item">';
                    html += '  <div class="al-timeline-dot" style="background:' + cat.color + ';"></div>';
                    html += '  <div class="al-timeline-content">';
                    html += '    <div class="al-timeline-header">';
                    html += '      <strong>' + self.escapeHtml(log.title) + '</strong>';
                    html += '      <span class="al-badge ' + st.badge + '">' + st.label + '</span>';
                    html += '    </div>';
                    if (log.description) html += '    <p class="al-timeline-desc">' + self.escapeHtml(log.description) + '</p>';
                    html += '    <div class="al-timeline-meta">';
                    html += '      <span><i class="' + cat.icon + '"></i> ' + self.escapeHtml(log.category || 'Other') + '</span>';
                    html += '      <span><i class="fas fa-user"></i> ' + self.escapeHtml(log.createdBy || 'System') + '</span>';
                    html += '      <span><i class="fas fa-clock"></i> ' + self.formatTime(log.createdAt) + '</span>';
                    if (log.amount != null && log.amount !== '') html += '      <span><i class="fas fa-coins"></i> ' + self.formatCurrency(log.amount) + '</span>';
                    html += '    </div>';
                    html += '  </div>';
                    html += '</div>';
                });
                html += '</div>';
            });
            timeline.innerHTML = html;
        },

        /* ══════════════════════════════════════════
         * 3) SYSTEM ALERTS
         * ══════════════════════════════════════════ */

        renderAlerts: function (container) {
            this.cleanup();
            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="al-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-exclamation-triangle"></i> System Alerts</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Activity Log</span><span>/</span><span>System Alerts</span>
                            </div>
                        </div>
                    </div>

                    <!-- Alert stat cards -->
                    <div class="al-stats-row">
                        <div class="al-stat-card al-stat-card--danger">
                            <div class="al-stat-icon" style="background:#fee2e2;color:#dc2626;"><i class="fas fa-times-circle"></i></div>
                            <div class="al-stat-info"><span class="al-stat-value" id="al-alert-failed">0</span><span class="al-stat-label">Failed</span></div>
                        </div>
                        <div class="al-stat-card al-stat-card--warning">
                            <div class="al-stat-icon" style="background:#fef3c7;color:#d97706;"><i class="fas fa-exclamation-circle"></i></div>
                            <div class="al-stat-info"><span class="al-stat-value" id="al-alert-warning">0</span><span class="al-stat-label">Warnings</span></div>
                        </div>
                        <div class="al-stat-card al-stat-card--critical">
                            <div class="al-stat-icon" style="background:#fce7f3;color:#be185d;"><i class="fas fa-skull-crossbones"></i></div>
                            <div class="al-stat-info"><span class="al-stat-value" id="al-alert-critical">0</span><span class="al-stat-label">Critical</span></div>
                        </div>
                    </div>

                    <!-- Alert list -->
                    <div class="al-alerts-list" id="al-alerts-list">
                        <div class="al-empty-state"><i class="fas fa-spinner fa-spin"></i><p>Loading alerts...</p></div>
                    </div>
                </div>
            `;

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', function (e) {
                e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null);
            });

            this._loadAlerts(businessId);
        },

        _loadAlerts: function (businessId) {
            if (!businessId) return;
            const self = this;
            const ref = PharmaFlow.getBusinessCollection(businessId, 'activity_log');
            if (!ref) return;

            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const fromStr = this.toISODate(thirtyDaysAgo) + 'T00:00:00.000Z';

            if (alUnsubAll) { alUnsubAll(); alUnsubAll = null; }

            alUnsubAll = ref
                .where('createdAt', '>=', fromStr)
                .orderBy('createdAt', 'desc')
                .limit(AL_MAX_FETCH)
                .onSnapshot(function (snap) {
                    alAllLogs = [];
                    snap.forEach(function (doc) {
                        alAllLogs.push(Object.assign({ id: doc.id }, doc.data()));
                    });
                    self._renderAlertsList();
                }, function (err) {
                    console.error('Alerts listener error:', err);
                });
        },

        _renderAlertsList: function () {
            const alerts = alAllLogs.filter(function (l) {
                return l.status === 'FAILED' || l.status === 'WARNING' || l.status === 'CRITICAL';
            });

            var fEl = document.getElementById('al-alert-failed');
            var wEl = document.getElementById('al-alert-warning');
            var cEl = document.getElementById('al-alert-critical');
            if (fEl) fEl.textContent = alerts.filter(function (a) { return a.status === 'FAILED'; }).length;
            if (wEl) wEl.textContent = alerts.filter(function (a) { return a.status === 'WARNING'; }).length;
            if (cEl) cEl.textContent = alerts.filter(function (a) { return a.status === 'CRITICAL'; }).length;

            var list = document.getElementById('al-alerts-list');
            if (!list) return;

            if (alerts.length === 0) {
                list.innerHTML = '<div class="al-empty-state"><i class="fas fa-check-circle" style="color:#16a34a;"></i><p>No alerts — everything is running smoothly!</p></div>';
                return;
            }

            var self = this;
            list.innerHTML = alerts.map(function (log) {
                var cat = self.getCatMeta(log.category);
                var st = self.getStatusMeta(log.status);
                var iconClass = log.status === 'CRITICAL' ? 'fas fa-skull-crossbones' : log.status === 'FAILED' ? 'fas fa-times-circle' : 'fas fa-exclamation-circle';
                var borderColor = log.status === 'CRITICAL' ? '#be185d' : log.status === 'FAILED' ? '#dc2626' : '#d97706';

                return '<div class="al-alert-item" style="border-left:4px solid ' + borderColor + ';">' +
                    '<div class="al-alert-icon" style="color:' + borderColor + ';"><i class="' + iconClass + '"></i></div>' +
                    '<div class="al-alert-body">' +
                        '<div class="al-alert-header">' +
                            '<strong>' + self.escapeHtml(log.title) + '</strong>' +
                            '<span class="al-badge ' + st.badge + '">' + st.label + '</span>' +
                        '</div>' +
                        (log.description ? '<p>' + self.escapeHtml(log.description) + '</p>' : '') +
                        '<div class="al-alert-meta">' +
                            '<span><i class="' + cat.icon + '"></i> ' + self.escapeHtml(log.category || 'Other') + '</span>' +
                            '<span><i class="fas fa-user"></i> ' + self.escapeHtml(log.createdBy || 'System') + '</span>' +
                            '<span><i class="fas fa-clock"></i> ' + self.formatDateTime(log.createdAt) + '</span>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            }).join('');
        },

        /* ══════════════════════════════════════════
         * EXPORT CSV
         * ══════════════════════════════════════════ */

        _exportCSV: function () {
            if (alFilteredLogs.length === 0) { this.showToast('No data to export', 'error'); return; }

            var self = this;
            var headers = ['#', 'Title', 'Description', 'Category', 'User', 'Amount', 'Status', 'Date/Time'];
            var rows = alFilteredLogs.map(function (log, i) {
                return [
                    i + 1,
                    '"' + (log.title || '').replace(/"/g, '""') + '"',
                    '"' + (log.description || '').replace(/"/g, '""') + '"',
                    log.category || 'Other',
                    log.createdBy || 'System',
                    log.amount != null ? log.amount : '',
                    log.status || 'COMPLETED',
                    self.formatDateTime(log.createdAt)
                ].join(',');
            });

            var csv = headers.join(',') + '\n' + rows.join('\n');
            var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            var link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'activity_logs_' + this.toISODate(new Date()) + '.csv';
            link.click();
            URL.revokeObjectURL(link.href);
            this.showToast('CSV exported successfully');
        },

        /* ══════════════════════════════════════════
         * PRINT
         * ══════════════════════════════════════════ */

        _printLogs: function () {
            if (alFilteredLogs.length === 0) { this.showToast('No data to print', 'error'); return; }

            var self = this;
            var printContent = '<html><head><title>Activity Logs</title><style>' +
                'body{font-family:Arial,sans-serif;padding:20px;}' +
                'h2{color:#1e293b;margin-bottom:4px;}' +
                'p.sub{color:#64748b;font-size:13px;margin-bottom:16px;}' +
                'table{width:100%;border-collapse:collapse;font-size:12px;}' +
                'th{background:#f1f5f9;padding:8px 6px;text-align:left;border-bottom:2px solid #cbd5e1;font-weight:600;}' +
                'td{padding:6px;border-bottom:1px solid #e2e8f0;}' +
                'tr:nth-child(even){background:#f8fafc;}' +
                '</style></head><body>' +
                '<h2>Activity Logs Report</h2>' +
                '<p class="sub">Generated: ' + new Date().toLocaleString('en-KE') + ' | Total: ' + alFilteredLogs.length + ' entries</p>' +
                '<table><thead><tr><th>#</th><th>Activity</th><th>Category</th><th>User</th><th>Amount</th><th>Status</th><th>Date/Time</th></tr></thead><tbody>';

            alFilteredLogs.forEach(function (log, i) {
                printContent += '<tr>' +
                    '<td>' + (i + 1) + '</td>' +
                    '<td>' + self.escapeHtml(log.title) + '</td>' +
                    '<td>' + self.escapeHtml(log.category || 'Other') + '</td>' +
                    '<td>' + self.escapeHtml(log.createdBy || 'System') + '</td>' +
                    '<td>' + (log.amount != null ? self.formatCurrency(log.amount) : '—') + '</td>' +
                    '<td>' + (log.status || 'COMPLETED') + '</td>' +
                    '<td>' + self.formatDateTime(log.createdAt) + '</td>' +
                '</tr>';
            });

            printContent += '</tbody></table></body></html>';
            var win = window.open('', '_blank');
            win.document.write(printContent);
            win.document.close();
            win.print();
        }
    };

    window.PharmaFlow.ActivityLog = ActivityLog;
})();
