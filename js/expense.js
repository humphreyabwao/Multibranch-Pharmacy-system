/**
 * PharmaFlow - Expense Module
 * Track and manage business expenses.
 * Sub-modules:
 *   - Add Expense: Create a new expense record
 *   - Manage Expenses: View, edit, delete, approve, filter, export expenses
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let expensesListener = null;
    let allExpenses = [];
    let filteredExpenses = [];
    let expCurrentPage = 1;
    const PAGE_SIZE = 25;

    // Expense categories
    const EXPENSE_CATEGORIES = [
        'Rent & Lease',
        'Utilities (Electric/Water)',
        'Staff Salaries',
        'Staff Allowances',
        'Transport & Delivery',
        'Stationery & Office Supplies',
        'Cleaning & Sanitation',
        'Equipment & Maintenance',
        'Internet & Communication',
        'Marketing & Advertising',
        'Insurance',
        'Licensing & Permits',
        'Bank Charges',
        'Taxes & Levies',
        'Donations & Sponsorships',
        'Miscellaneous'
    ];

    // Payment methods
    const PAYMENT_METHODS = [
        'Cash',
        'M-Pesa',
        'Bank Transfer',
        'Cheque',
        'Credit Card',
        'Other'
    ];

    const Expense = {

        // ═══════════════════════════════════════════════
        //  UTILITIES
        // ═══════════════════════════════════════════════

        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        formatCurrency: function (val) {
            return 'KSH ' + new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val || 0);
        },

        escapeHtml: function (str) {
            if (!str) return '';
            const d = document.createElement('div');
            d.textContent = str;
            return d.innerHTML;
        },

        showToast: function (msg, type) {
            const old = document.querySelector('.exp-toast');
            if (old) old.remove();
            const t = document.createElement('div');
            t.className = 'exp-toast' + (type === 'error' ? ' exp-toast--error' : '');
            t.innerHTML = '<i class="fas ' + (type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle') + '"></i> ' + msg;
            document.body.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
        },

        formatDate: function (ts) {
            if (!ts) return '—';
            const d = ts.toDate ? ts.toDate() : new Date(ts);
            return d.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
        },

        cleanup: function () {
            if (expensesListener) { expensesListener(); expensesListener = null; }
            allExpenses = [];
            filteredExpenses = [];
        },

        // ═══════════════════════════════════════════════
        //  ADD EXPENSE
        // ═══════════════════════════════════════════════

        renderAdd: function (container) {
            if (expensesListener) { expensesListener(); expensesListener = null; }

            const categoryOptions = EXPENSE_CATEGORIES.map(c => '<option value="' + c + '">' + c + '</option>').join('');
            const paymentOptions = PAYMENT_METHODS.map(m => '<option value="' + m + '">' + m + '</option>').join('');

            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-plus"></i> Add Expense</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>Expenses</span>
                                <span>/</span><span>Add Expense</span>
                            </div>
                        </div>
                    </div>

                    <div class="exp-add-layout">
                        <!-- Expense Details Card -->
                        <div class="ord-card">
                            <div class="ord-card-header"><i class="fas fa-receipt"></i> Expense Details</div>
                            <div class="ord-card-body">
                                <div class="dda-form-row">
                                    <div class="dda-form-group">
                                        <label>Expense Title <span class="required">*</span></label>
                                        <input type="text" id="exp-title" placeholder="e.g., Monthly Rent Payment">
                                    </div>
                                    <div class="dda-form-group">
                                        <label>Category <span class="required">*</span></label>
                                        <select id="exp-category">
                                            <option value="">Select category</option>
                                            ${categoryOptions}
                                        </select>
                                    </div>
                                </div>
                                <div class="dda-form-row">
                                    <div class="dda-form-group">
                                        <label>Amount (KSH) <span class="required">*</span></label>
                                        <input type="number" id="exp-amount" placeholder="0.00" min="0" step="0.01">
                                    </div>
                                    <div class="dda-form-group">
                                        <label>Date <span class="required">*</span></label>
                                        <input type="date" id="exp-date" value="${new Date().toISOString().split('T')[0]}">
                                    </div>
                                </div>
                                <div class="dda-form-row">
                                    <div class="dda-form-group">
                                        <label>Payment Method</label>
                                        <select id="exp-payment">
                                            ${paymentOptions}
                                        </select>
                                    </div>
                                    <div class="dda-form-group">
                                        <label>Reference / Receipt No.</label>
                                        <input type="text" id="exp-reference" placeholder="e.g., REC-001">
                                    </div>
                                </div>
                                <div class="dda-form-row">
                                    <div class="dda-form-group">
                                        <label>Paid To / Vendor</label>
                                        <input type="text" id="exp-vendor" placeholder="e.g., ABC Landlord">
                                    </div>
                                    <div class="dda-form-group">
                                        <label>Recurring?</label>
                                        <select id="exp-recurring">
                                            <option value="no">No</option>
                                            <option value="daily">Daily</option>
                                            <option value="weekly">Weekly</option>
                                            <option value="monthly">Monthly</option>
                                            <option value="quarterly">Quarterly</option>
                                            <option value="yearly">Yearly</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="dda-form-group">
                                    <label>Description / Notes</label>
                                    <textarea id="exp-notes" rows="3" placeholder="Additional details about this expense..."></textarea>
                                </div>
                            </div>
                        </div>

                        <!-- Submit -->
                        <div class="ord-submit-bar">
                            <button class="dda-btn dda-btn--cancel" id="exp-clear-btn">
                                <i class="fas fa-times"></i> Clear
                            </button>
                            <button class="dda-btn dda-btn--primary" id="exp-submit-btn">
                                <i class="fas fa-save"></i> Save Expense
                            </button>
                        </div>

                        <!-- Recent Expenses Quick View -->
                        <div class="ord-card">
                            <div class="ord-card-header"><i class="fas fa-history"></i> Recent Expenses (Last 5)</div>
                            <div class="ord-card-body">
                                <div id="exp-recent-list" class="exp-recent-list">
                                    <div class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading...</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            this.bindAddEvents(container);
            this.loadRecentExpenses();
        },

        bindAddEvents: function (container) {
            document.getElementById('exp-submit-btn')?.addEventListener('click', () => this.saveExpense());
            document.getElementById('exp-clear-btn')?.addEventListener('click', () => this.clearAddForm());

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });
        },

        clearAddForm: function () {
            document.getElementById('exp-title').value = '';
            document.getElementById('exp-category').value = '';
            document.getElementById('exp-amount').value = '';
            document.getElementById('exp-date').value = new Date().toISOString().split('T')[0];
            document.getElementById('exp-payment').value = 'Cash';
            document.getElementById('exp-reference').value = '';
            document.getElementById('exp-vendor').value = '';
            document.getElementById('exp-recurring').value = 'no';
            document.getElementById('exp-notes').value = '';
        },

        saveExpense: async function () {
            const title = document.getElementById('exp-title')?.value?.trim();
            const category = document.getElementById('exp-category')?.value;
            const amount = parseFloat(document.getElementById('exp-amount')?.value);
            const date = document.getElementById('exp-date')?.value;

            if (!title) { this.showToast('Please enter an expense title.', 'error'); return; }
            if (!category) { this.showToast('Please select a category.', 'error'); return; }
            if (!amount || amount <= 0) { this.showToast('Please enter a valid amount.', 'error'); return; }
            if (!date) { this.showToast('Please select a date.', 'error'); return; }

            const businessId = this.getBusinessId();
            if (!businessId) { this.showToast('No business assigned.', 'error'); return; }

            const btn = document.getElementById('exp-submit-btn');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

            try {
                const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;

                const expenseData = {
                    title: title,
                    category: category,
                    amount: amount,
                    date: date,
                    paymentMethod: document.getElementById('exp-payment')?.value || 'Cash',
                    reference: document.getElementById('exp-reference')?.value?.trim() || '',
                    vendor: document.getElementById('exp-vendor')?.value?.trim() || '',
                    recurring: document.getElementById('exp-recurring')?.value || 'no',
                    notes: document.getElementById('exp-notes')?.value?.trim() || '',
                    status: 'pending',
                    createdBy: profile ? (profile.displayName || profile.email) : 'Unknown',
                    createdByUid: firebase.auth().currentUser ? firebase.auth().currentUser.uid : null,
                    createdAt: new Date().toISOString(),
                    expenseTimestamp: new Date(date + 'T12:00:00').toISOString()
                };

                await getBusinessCollection(businessId, 'expenses').add(expenseData);

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Expense Added',
                        description: '"' + title + '" — ' + this.formatCurrency(amount) + ' (' + category + ')',
                        category: 'Expense',
                        status: 'COMPLETED',
                        amount: amount,
                        metadata: { title: title, category: category, amount: amount, vendor: expenseData.vendor }
                    });
                }

                this.showToast('Expense saved successfully!');
                this.clearAddForm();
                this.loadRecentExpenses();
            } catch (err) {
                console.error('Save expense error:', err);
                this.showToast('Failed to save expense: ' + err.message, 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Expense'; }
            }
        },

        loadRecentExpenses: async function () {
            const businessId = this.getBusinessId();
            const listEl = document.getElementById('exp-recent-list');
            if (!businessId || !listEl) return;

            try {
                const snap = await getBusinessCollection(businessId, 'expenses')
                    .orderBy('createdAt', 'desc')
                    .limit(5)
                    .get();

                if (snap.empty) {
                    listEl.innerHTML = '<div class="ord-ls-empty"><i class="fas fa-inbox"></i> No expenses recorded yet.</div>';
                    return;
                }

                listEl.innerHTML = snap.docs.map(doc => {
                    const e = doc.data();
                    return `<div class="exp-recent-item">
                        <div class="exp-recent-info">
                            <strong>${this.escapeHtml(e.title)}</strong>
                            <small>${this.escapeHtml(e.category)} · ${e.date || '—'} · ${this.escapeHtml(e.paymentMethod || '')}</small>
                        </div>
                        <span class="exp-recent-amount">${this.formatCurrency(e.amount)}</span>
                        <span class="ord-status-badge ${e.status === 'approved' ? 'ord-status--approved' : 'ord-status--pending'}">${e.status || 'pending'}</span>
                    </div>`;
                }).join('');
            } catch (err) {
                console.error('Load recent expenses error:', err);
                listEl.innerHTML = '<div class="ord-ls-empty"><i class="fas fa-exclamation-circle"></i> Failed to load.</div>';
            }
        },

        // ═══════════════════════════════════════════════
        //  MANAGE EXPENSES
        // ═══════════════════════════════════════════════

        renderManage: function (container) {
            const categoryOptions = EXPENSE_CATEGORIES.map(c => '<option value="' + c + '">' + c + '</option>').join('');
            const paymentOptions = PAYMENT_METHODS.map(m => '<option value="' + m + '">' + m + '</option>').join('');

            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-list"></i> Manage Expenses</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>Expenses</span>
                                <span>/</span><span>Manage Expenses</span>
                            </div>
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="dda-stats" id="exp-stats">
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon"><i class="fas fa-receipt"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="exp-total-count">0</span>
                                <span class="dda-stat-label">Total Expenses</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--danger"><i class="fas fa-money-bill-wave"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="exp-total-amount">KSH 0.00</span>
                                <span class="dda-stat-label">Total Spent</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-clock"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="exp-pending-count">0</span>
                                <span class="dda-stat-label">Pending</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-check-circle"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="exp-approved-count">0</span>
                                <span class="dda-stat-label">Approved</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon" style="background:#dbeafe;color:#2563eb"><i class="fas fa-chart-pie"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="exp-month-amount">KSH 0.00</span>
                                <span class="dda-stat-label">This Month</span>
                            </div>
                        </div>
                    </div>

                    <!-- Toolbar -->
                    <div class="dda-toolbar">
                        <div class="dda-search-box">
                            <i class="fas fa-search"></i>
                            <input type="text" id="exp-search" placeholder="Search title, vendor, reference...">
                        </div>
                        <div class="dda-toolbar-actions">
                            <select id="exp-cat-filter">
                                <option value="">All Categories</option>
                                ${categoryOptions}
                            </select>
                            <select id="exp-status-filter">
                                <option value="">All Status</option>
                                <option value="pending">Pending</option>
                                <option value="approved">Approved</option>
                                <option value="rejected">Rejected</option>
                            </select>
                            <select id="exp-pay-filter">
                                <option value="">All Payments</option>
                                ${paymentOptions}
                            </select>
                            <button class="dda-btn dda-btn--export" id="exp-export-pdf">
                                <i class="fas fa-file-pdf"></i> Export PDF
                            </button>
                        </div>
                    </div>

                    <!-- Quick Date Filters -->
                    <div class="dda-quick-filters">
                        <button class="dda-pill active" data-range="all">All Time</button>
                        <button class="dda-pill" data-range="today">Today</button>
                        <button class="dda-pill" data-range="week">This Week</button>
                        <button class="dda-pill" data-range="month">This Month</button>
                        <button class="dda-pill" data-range="30">Last 30 Days</button>
                        <button class="dda-pill" data-range="90">Last 90 Days</button>
                    </div>

                    <!-- Category Breakdown -->
                    <div class="exp-breakdown" id="exp-breakdown"></div>

                    <!-- Table -->
                    <div class="dda-table-wrap">
                        <table class="dda-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Date</th>
                                    <th>Title</th>
                                    <th>Category</th>
                                    <th>Vendor</th>
                                    <th>Payment</th>
                                    <th>Amount</th>
                                    <th>Status</th>
                                    <th>Created By</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="exp-tbody">
                                <tr><td colspan="10" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading expenses...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="dda-pagination" id="exp-pagination"></div>
                </div>

                <!-- View Expense Modal -->
                <div class="dda-modal-overlay" id="exp-view-modal" style="display:none">
                    <div class="dda-modal" style="max-width:580px">
                        <div class="dda-modal-header">
                            <h3><i class="fas fa-receipt"></i> Expense Details</h3>
                            <button class="dda-modal-close" id="exp-view-close">&times;</button>
                        </div>
                        <div class="dda-modal-body" id="exp-view-body"></div>
                        <div class="dda-modal-footer">
                            <button class="dda-btn dda-btn--cancel" id="exp-view-close-btn">Close</button>
                            <button class="dda-btn dda-btn--export" id="exp-view-print"><i class="fas fa-print"></i> Print</button>
                        </div>
                    </div>
                </div>

                <!-- Edit Expense Modal -->
                <div class="dda-modal-overlay" id="exp-edit-modal" style="display:none">
                    <div class="dda-modal" style="max-width:600px">
                        <div class="dda-modal-header">
                            <h3 id="exp-edit-title"><i class="fas fa-edit"></i> Edit Expense</h3>
                            <button class="dda-modal-close" id="exp-edit-close">&times;</button>
                        </div>
                        <div class="dda-modal-body">
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Title <span class="required">*</span></label>
                                    <input type="text" id="exp-edit-name">
                                </div>
                                <div class="dda-form-group">
                                    <label>Category <span class="required">*</span></label>
                                    <select id="exp-edit-category">
                                        <option value="">Select</option>
                                        ${categoryOptions}
                                    </select>
                                </div>
                            </div>
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Amount (KSH) <span class="required">*</span></label>
                                    <input type="number" id="exp-edit-amount" min="0" step="0.01">
                                </div>
                                <div class="dda-form-group">
                                    <label>Date <span class="required">*</span></label>
                                    <input type="date" id="exp-edit-date">
                                </div>
                            </div>
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Payment Method</label>
                                    <select id="exp-edit-payment">
                                        ${paymentOptions}
                                    </select>
                                </div>
                                <div class="dda-form-group">
                                    <label>Reference / Receipt No.</label>
                                    <input type="text" id="exp-edit-reference">
                                </div>
                            </div>
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Vendor</label>
                                    <input type="text" id="exp-edit-vendor">
                                </div>
                                <div class="dda-form-group">
                                    <label>Recurring?</label>
                                    <select id="exp-edit-recurring">
                                        <option value="no">No</option>
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                        <option value="quarterly">Quarterly</option>
                                        <option value="yearly">Yearly</option>
                                    </select>
                                </div>
                            </div>
                            <div class="dda-form-group">
                                <label>Notes</label>
                                <textarea id="exp-edit-notes" rows="2"></textarea>
                            </div>
                            <input type="hidden" id="exp-edit-id">
                        </div>
                        <div class="dda-modal-footer">
                            <button class="dda-btn dda-btn--cancel" id="exp-edit-cancel">Cancel</button>
                            <button class="dda-btn dda-btn--primary" id="exp-edit-save"><i class="fas fa-save"></i> Update</button>
                        </div>
                    </div>
                </div>
            `;

            this.bindManageEvents(container);
            this.subscribeExpenses();
        },

        bindManageEvents: function (container) {
            document.getElementById('exp-search')?.addEventListener('input', () => { expCurrentPage = 1; this.filterExpenses(); });
            document.getElementById('exp-cat-filter')?.addEventListener('change', () => { expCurrentPage = 1; this.filterExpenses(); });
            document.getElementById('exp-status-filter')?.addEventListener('change', () => { expCurrentPage = 1; this.filterExpenses(); });
            document.getElementById('exp-pay-filter')?.addEventListener('change', () => { expCurrentPage = 1; this.filterExpenses(); });
            document.getElementById('exp-export-pdf')?.addEventListener('click', () => this.exportPdf());

            // Quick date filters
            container.querySelectorAll('.dda-pill').forEach(pill => {
                pill.addEventListener('click', () => {
                    container.querySelectorAll('.dda-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                    this.quickRange = pill.dataset.range;
                    expCurrentPage = 1;
                    this.filterExpenses();
                });
            });

            // View modal
            document.getElementById('exp-view-close')?.addEventListener('click', () => { document.getElementById('exp-view-modal').style.display = 'none'; });
            document.getElementById('exp-view-close-btn')?.addEventListener('click', () => { document.getElementById('exp-view-modal').style.display = 'none'; });

            // Edit modal
            document.getElementById('exp-edit-close')?.addEventListener('click', () => { document.getElementById('exp-edit-modal').style.display = 'none'; });
            document.getElementById('exp-edit-cancel')?.addEventListener('click', () => { document.getElementById('exp-edit-modal').style.display = 'none'; });
            document.getElementById('exp-edit-save')?.addEventListener('click', () => this.updateExpense());

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });
        },

        quickRange: 'all',

        subscribeExpenses: function () {
            const businessId = this.getBusinessId();
            if (!businessId) return;
            if (expensesListener) expensesListener();

            expensesListener = getBusinessCollection(businessId, 'expenses')
                .onSnapshot(snap => {
                    allExpenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    allExpenses.sort((a, b) => {
                        const da = a.date || '';
                        const db = b.date || '';
                        return db.localeCompare(da);
                    });
                    this.updateStats();
                    this.filterExpenses();
                }, err => {
                    console.error('Expenses subscribe error:', err);
                });
        },

        updateStats: function () {
            const el = id => document.getElementById(id);
            const now = new Date();
            const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

            const totalAmount = allExpenses.reduce((s, e) => s + (e.amount || 0), 0);
            const pendingCount = allExpenses.filter(e => e.status === 'pending').length;
            const approvedCount = allExpenses.filter(e => e.status === 'approved').length;
            const monthExpenses = allExpenses.filter(e => (e.date || '').startsWith(monthStr));
            const monthTotal = monthExpenses.reduce((s, e) => s + (e.amount || 0), 0);

            if (el('exp-total-count')) el('exp-total-count').textContent = allExpenses.length;
            if (el('exp-total-amount')) el('exp-total-amount').textContent = this.formatCurrency(totalAmount);
            if (el('exp-pending-count')) el('exp-pending-count').textContent = pendingCount;
            if (el('exp-approved-count')) el('exp-approved-count').textContent = approvedCount;
            if (el('exp-month-amount')) el('exp-month-amount').textContent = this.formatCurrency(monthTotal);
        },

        filterExpenses: function () {
            const query = (document.getElementById('exp-search')?.value || '').toLowerCase();
            const catFilter = document.getElementById('exp-cat-filter')?.value || '';
            const statusFilter = document.getElementById('exp-status-filter')?.value || '';
            const payFilter = document.getElementById('exp-pay-filter')?.value || '';

            let fromDate = null;
            let toDate = null;
            const today = new Date();
            const fmt = d => d.toISOString().split('T')[0];

            switch (this.quickRange) {
                case 'today':
                    fromDate = fmt(today); toDate = fmt(today); break;
                case 'week': {
                    const ws = new Date(today); ws.setDate(ws.getDate() - ws.getDay());
                    fromDate = fmt(ws); toDate = fmt(today); break;
                }
                case 'month': {
                    const ms = new Date(today.getFullYear(), today.getMonth(), 1);
                    fromDate = fmt(ms); toDate = fmt(today); break;
                }
                case '30': {
                    const d30 = new Date(today); d30.setDate(d30.getDate() - 30);
                    fromDate = fmt(d30); toDate = fmt(today); break;
                }
                case '90': {
                    const d90 = new Date(today); d90.setDate(d90.getDate() - 90);
                    fromDate = fmt(d90); toDate = fmt(today); break;
                }
            }

            filteredExpenses = allExpenses.filter(e => {
                if (catFilter && e.category !== catFilter) return false;
                if (statusFilter && e.status !== statusFilter) return false;
                if (payFilter && e.paymentMethod !== payFilter) return false;
                if (fromDate || toDate) {
                    const eDate = e.date || '';
                    if (fromDate && eDate < fromDate) return false;
                    if (toDate && eDate > toDate) return false;
                }
                if (query) {
                    const haystack = ((e.title || '') + ' ' + (e.vendor || '') + ' ' + (e.reference || '') + ' ' + (e.category || '') + ' ' + (e.createdBy || '')).toLowerCase();
                    return haystack.includes(query);
                }
                return true;
            });

            this.renderCategoryBreakdown();
            this.renderPage();
        },

        // ═══════════════════════════════════════════════
        //  CATEGORY BREAKDOWN BAR
        // ═══════════════════════════════════════════════

        renderCategoryBreakdown: function () {
            const container = document.getElementById('exp-breakdown');
            if (!container) return;

            if (filteredExpenses.length === 0) {
                container.innerHTML = '';
                return;
            }

            const catTotals = {};
            filteredExpenses.forEach(e => {
                const cat = e.category || 'Uncategorized';
                catTotals[cat] = (catTotals[cat] || 0) + (e.amount || 0);
            });

            const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
            const grandTotal = sorted.reduce((s, [, v]) => s + v, 0);

            const colors = ['#4f46e5', '#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#8b5cf6', '#f97316', '#14b8a6', '#6366f1', '#d946ef', '#84cc16', '#0ea5e9', '#e11d48', '#a855f7'];

            container.innerHTML = `
                <div class="exp-breakdown-bar">
                    ${sorted.map(([cat, total], i) => {
                        const pct = grandTotal > 0 ? ((total / grandTotal) * 100) : 0;
                        const color = colors[i % colors.length];
                        return pct >= 2 ? '<div class="exp-bar-seg" style="width:' + pct.toFixed(1) + '%;background:' + color + '" title="' + this.escapeHtml(cat) + ': ' + this.formatCurrency(total) + ' (' + pct.toFixed(1) + '%)"></div>' : '';
                    }).join('')}
                </div>
                <div class="exp-breakdown-legend">
                    ${sorted.slice(0, 6).map(([cat, total], i) => {
                        const pct = grandTotal > 0 ? ((total / grandTotal) * 100) : 0;
                        const color = colors[i % colors.length];
                        return '<div class="exp-legend-item"><span class="exp-legend-dot" style="background:' + color + '"></span><span class="exp-legend-label">' + this.escapeHtml(cat) + '</span><span class="exp-legend-val">' + this.formatCurrency(total) + ' (' + pct.toFixed(0) + '%)</span></div>';
                    }).join('')}
                    ${sorted.length > 6 ? '<div class="exp-legend-item"><span class="exp-legend-label" style="color:var(--text-tertiary)">+' + (sorted.length - 6) + ' more categories</span></div>' : ''}
                </div>
            `;
        },

        // ═══════════════════════════════════════════════
        //  TABLE RENDERING
        // ═══════════════════════════════════════════════

        getStatusBadge: function (status) {
            const map = {
                'pending': { cls: 'ord-status--pending', icon: 'fa-clock', label: 'Pending' },
                'approved': { cls: 'ord-status--approved', icon: 'fa-check', label: 'Approved' },
                'rejected': { cls: 'ord-status--cancelled', icon: 'fa-times', label: 'Rejected' }
            };
            const info = map[status] || map['pending'];
            return '<span class="ord-status-badge ' + info.cls + '"><i class="fas ' + info.icon + '"></i> ' + info.label + '</span>';
        },

        renderPage: function () {
            const tbody = document.getElementById('exp-tbody');
            if (!tbody) return;

            const start = (expCurrentPage - 1) * PAGE_SIZE;
            const pageData = filteredExpenses.slice(start, start + PAGE_SIZE);

            if (pageData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10" class="dda-loading"><i class="fas fa-inbox"></i> No expenses found</td></tr>';
                this.renderPagination();
                return;
            }

            const isAdmin = PharmaFlow.Auth && PharmaFlow.Auth.isAdminOrAbove ? PharmaFlow.Auth.isAdminOrAbove() : false;

            tbody.innerHTML = pageData.map((e, i) => {
                return `<tr>
                    <td>${start + i + 1}</td>
                    <td>${e.date || '—'}</td>
                    <td><strong>${this.escapeHtml(e.title)}</strong>${e.recurring && e.recurring !== 'no' ? ' <span class="exp-recurring-tag"><i class="fas fa-sync-alt"></i> ' + e.recurring + '</span>' : ''}</td>
                    <td><span class="exp-cat-badge">${this.escapeHtml(e.category)}</span></td>
                    <td>${this.escapeHtml(e.vendor || '—')}</td>
                    <td>${this.escapeHtml(e.paymentMethod || '—')}</td>
                    <td><strong>${this.formatCurrency(e.amount)}</strong></td>
                    <td>${this.getStatusBadge(e.status)}</td>
                    <td>${this.escapeHtml(e.createdBy || '—')}</td>
                    <td>
                        <button class="sales-action-btn sales-action--view exp-view" data-id="${e.id}" title="View"><i class="fas fa-eye"></i></button>
                        ${isAdmin && e.status === 'pending' ? '<button class="sales-action-btn sales-action--approve exp-approve" data-id="' + e.id + '" title="Approve"><i class="fas fa-check"></i></button>' : ''}
                        ${isAdmin ? '<button class="sales-action-btn exp-edit" data-id="' + e.id + '" title="Edit" style="background:#e0e7ff;color:#4338ca"><i class="fas fa-edit"></i></button>' : ''}
                        ${isAdmin && e.status === 'pending' ? '<button class="sales-action-btn sup-delete exp-reject" data-id="' + e.id + '" title="Reject" style="background:#fee2e2;color:#dc2626"><i class="fas fa-times"></i></button>' : ''}
                        ${isAdmin ? '<button class="sales-action-btn sup-delete exp-delete" data-id="' + e.id + '" title="Delete" style="background:#fee2e2;color:#dc2626"><i class="fas fa-trash"></i></button>' : ''}
                    </td>
                </tr>`;
            }).join('');

            // Bind actions
            tbody.querySelectorAll('.exp-view').forEach(btn => {
                btn.addEventListener('click', () => {
                    const expense = allExpenses.find(e => e.id === btn.dataset.id);
                    if (expense) this.viewExpense(expense);
                });
            });
            tbody.querySelectorAll('.exp-approve').forEach(btn => {
                btn.addEventListener('click', () => this.changeStatus(btn.dataset.id, 'approved'));
            });
            tbody.querySelectorAll('.exp-reject').forEach(btn => {
                btn.addEventListener('click', () => this.changeStatus(btn.dataset.id, 'rejected'));
            });
            tbody.querySelectorAll('.exp-edit').forEach(btn => {
                btn.addEventListener('click', () => {
                    const expense = allExpenses.find(e => e.id === btn.dataset.id);
                    if (expense) this.openEditModal(expense);
                });
            });
            tbody.querySelectorAll('.exp-delete').forEach(btn => {
                btn.addEventListener('click', () => this.deleteExpense(btn.dataset.id));
            });

            this.renderPagination();
        },

        changeStatus: async function (docId, newStatus) {
            if (newStatus === 'rejected' && !(await PharmaFlow.confirm('Reject this expense?', { title: 'Reject Expense', confirmText: 'Reject', danger: true }))) return;

            const businessId = this.getBusinessId();
            if (!businessId) return;

            try {
                const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
                const updateData = {
                    status: newStatus,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: profile ? (profile.displayName || profile.email) : 'Unknown'
                };
                if (newStatus === 'approved') {
                    updateData.approvedAt = firebase.firestore.FieldValue.serverTimestamp();
                    updateData.approvedBy = updateData.updatedBy;
                }
                await getBusinessCollection(businessId, 'expenses').doc(docId).update(updateData);
                this.showToast('Expense ' + newStatus + '!');
            } catch (err) {
                console.error('Update expense status error:', err);
                this.showToast('Failed to update status.', 'error');
            }
        },

        deleteExpense: async function (docId) {
            if (!(await PharmaFlow.confirm('Permanently delete this expense record?', { title: 'Delete Expense', confirmText: 'Delete', danger: true }))) return;

            const businessId = this.getBusinessId();
            if (!businessId) return;

            try {
                await getBusinessCollection(businessId, 'expenses').doc(docId).delete();

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Expense Deleted',
                        description: 'Deleted expense record ' + docId,
                        category: 'Expense',
                        status: 'COMPLETED',
                        metadata: { docId: docId }
                    });
                }

                this.showToast('Expense deleted.');
            } catch (err) {
                console.error('Delete expense error:', err);
                this.showToast('Failed to delete expense.', 'error');
            }
        },

        // ═══════════════════════════════════════════════
        //  VIEW EXPENSE MODAL
        // ═══════════════════════════════════════════════

        viewExpense: function (expense) {
            const modal = document.getElementById('exp-view-modal');
            const body = document.getElementById('exp-view-body');
            if (!modal || !body) return;

            body.innerHTML = `
                <div class="dda-view-details">
                    <div class="dda-view-row"><span class="dda-view-label">Title</span><span class="dda-view-value"><strong>${this.escapeHtml(expense.title)}</strong></span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Category</span><span class="dda-view-value"><span class="exp-cat-badge">${this.escapeHtml(expense.category)}</span></span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Amount</span><span class="dda-view-value"><strong style="font-size:1.1rem;color:#dc2626">${this.formatCurrency(expense.amount)}</strong></span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Date</span><span class="dda-view-value">${expense.date || '—'}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Payment Method</span><span class="dda-view-value">${this.escapeHtml(expense.paymentMethod || '—')}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Reference</span><span class="dda-view-value">${this.escapeHtml(expense.reference || '—')}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Vendor / Paid To</span><span class="dda-view-value">${this.escapeHtml(expense.vendor || '—')}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Recurring</span><span class="dda-view-value">${expense.recurring && expense.recurring !== 'no' ? '<span class="exp-recurring-tag"><i class="fas fa-sync-alt"></i> ' + expense.recurring + '</span>' : 'No'}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Status</span><span class="dda-view-value">${this.getStatusBadge(expense.status)}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Created By</span><span class="dda-view-value">${this.escapeHtml(expense.createdBy || '—')}</span></div>
                    ${expense.approvedBy ? '<div class="dda-view-row"><span class="dda-view-label">Approved By</span><span class="dda-view-value">' + this.escapeHtml(expense.approvedBy) + '</span></div>' : ''}
                    ${expense.notes ? '<div class="dda-view-row"><span class="dda-view-label">Notes</span><span class="dda-view-value">' + this.escapeHtml(expense.notes) + '</span></div>' : ''}
                </div>
            `;

            // Print button
            const printBtn = document.getElementById('exp-view-print');
            if (printBtn) {
                const newPrint = printBtn.cloneNode(true);
                printBtn.replaceWith(newPrint);
                newPrint.addEventListener('click', () => this.printExpense(expense));
            }

            modal.style.display = 'flex';
        },

        // ═══════════════════════════════════════════════
        //  EDIT EXPENSE MODAL
        // ═══════════════════════════════════════════════

        openEditModal: function (expense) {
            document.getElementById('exp-edit-id').value = expense.id;
            document.getElementById('exp-edit-name').value = expense.title || '';
            document.getElementById('exp-edit-category').value = expense.category || '';
            document.getElementById('exp-edit-amount').value = expense.amount || '';
            document.getElementById('exp-edit-date').value = expense.date || '';
            document.getElementById('exp-edit-payment').value = expense.paymentMethod || 'Cash';
            document.getElementById('exp-edit-reference').value = expense.reference || '';
            document.getElementById('exp-edit-vendor').value = expense.vendor || '';
            document.getElementById('exp-edit-recurring').value = expense.recurring || 'no';
            document.getElementById('exp-edit-notes').value = expense.notes || '';
            document.getElementById('exp-edit-modal').style.display = 'flex';
        },

        updateExpense: async function () {
            const docId = document.getElementById('exp-edit-id')?.value;
            const title = document.getElementById('exp-edit-name')?.value?.trim();
            const category = document.getElementById('exp-edit-category')?.value;
            const amount = parseFloat(document.getElementById('exp-edit-amount')?.value);
            const date = document.getElementById('exp-edit-date')?.value;

            if (!title) { this.showToast('Title is required.', 'error'); return; }
            if (!category) { this.showToast('Category is required.', 'error'); return; }
            if (!amount || amount <= 0) { this.showToast('Valid amount is required.', 'error'); return; }
            if (!date) { this.showToast('Date is required.', 'error'); return; }

            const businessId = this.getBusinessId();
            if (!businessId || !docId) return;

            const btn = document.getElementById('exp-edit-save');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...'; }

            try {
                const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
                await getBusinessCollection(businessId, 'expenses').doc(docId).update({
                    title: title,
                    category: category,
                    amount: amount,
                    date: date,
                    paymentMethod: document.getElementById('exp-edit-payment')?.value || 'Cash',
                    reference: document.getElementById('exp-edit-reference')?.value?.trim() || '',
                    vendor: document.getElementById('exp-edit-vendor')?.value?.trim() || '',
                    recurring: document.getElementById('exp-edit-recurring')?.value || 'no',
                    notes: document.getElementById('exp-edit-notes')?.value?.trim() || '',
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: profile ? (profile.displayName || profile.email) : 'Unknown',
                    expenseTimestamp: firebase.firestore.Timestamp.fromDate(new Date(date + 'T12:00:00'))
                });

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Expense Updated',
                        description: 'Updated "' + title + '" — ' + this.formatCurrency(amount),
                        category: 'Expense',
                        status: 'COMPLETED',
                        amount: amount,
                        metadata: { docId: docId, title: title, amount: amount }
                    });
                }

                this.showToast('Expense updated!');
                document.getElementById('exp-edit-modal').style.display = 'none';
            } catch (err) {
                console.error('Update expense error:', err);
                this.showToast('Failed to update: ' + err.message, 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Update'; }
            }
        },

        // ═══════════════════════════════════════════════
        //  PRINT EXPENSE
        // ═══════════════════════════════════════════════

        printExpense: function (expense) {
            const printHtml = '<!DOCTYPE html><html><head><title>Expense - ' + this.escapeHtml(expense.title) + '</title>' +
                '<style>@media print { body { margin: 0; } .no-print { display: none !important; } }</style></head>' +
                '<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:30px;color:#1f2937">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #4f46e5;padding-bottom:16px;margin-bottom:24px">' +
                '<div><h1 style="margin:0;font-size:22px;color:#4f46e5">' + (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + '</h1><p style="margin:4px 0 0;color:#6b7280;font-size:13px">Expense Receipt</p></div>' +
                '<div style="text-align:right">' + this.getStatusBadge(expense.status) + '</div></div>' +
                '<table style="width:100%;font-size:14px;border-collapse:collapse">' +
                '<tr><td style="padding:8px 0;font-weight:600;width:40%;color:#6b7280">Title</td><td style="padding:8px 0;font-weight:700">' + this.escapeHtml(expense.title) + '</td></tr>' +
                '<tr><td style="padding:8px 0;font-weight:600;color:#6b7280">Category</td><td style="padding:8px 0">' + this.escapeHtml(expense.category) + '</td></tr>' +
                '<tr style="background:#fef2f2"><td style="padding:10px 0 10px 8px;font-weight:600;color:#6b7280">Amount</td><td style="padding:10px 0;font-weight:700;font-size:18px;color:#dc2626">' + this.formatCurrency(expense.amount) + '</td></tr>' +
                '<tr><td style="padding:8px 0;font-weight:600;color:#6b7280">Date</td><td style="padding:8px 0">' + (expense.date || '—') + '</td></tr>' +
                '<tr><td style="padding:8px 0;font-weight:600;color:#6b7280">Payment Method</td><td style="padding:8px 0">' + this.escapeHtml(expense.paymentMethod || '—') + '</td></tr>' +
                '<tr><td style="padding:8px 0;font-weight:600;color:#6b7280">Reference</td><td style="padding:8px 0">' + this.escapeHtml(expense.reference || '—') + '</td></tr>' +
                '<tr><td style="padding:8px 0;font-weight:600;color:#6b7280">Vendor / Paid To</td><td style="padding:8px 0">' + this.escapeHtml(expense.vendor || '—') + '</td></tr>' +
                (expense.recurring && expense.recurring !== 'no' ? '<tr><td style="padding:8px 0;font-weight:600;color:#6b7280">Recurring</td><td style="padding:8px 0">' + expense.recurring + '</td></tr>' : '') +
                '<tr><td style="padding:8px 0;font-weight:600;color:#6b7280">Created By</td><td style="padding:8px 0">' + this.escapeHtml(expense.createdBy || '—') + '</td></tr>' +
                (expense.approvedBy ? '<tr><td style="padding:8px 0;font-weight:600;color:#6b7280">Approved By</td><td style="padding:8px 0">' + this.escapeHtml(expense.approvedBy) + '</td></tr>' : '') +
                (expense.notes ? '<tr><td style="padding:8px 0;font-weight:600;color:#6b7280">Notes</td><td style="padding:8px 0">' + this.escapeHtml(expense.notes) + '</td></tr>' : '') +
                '</table>' +
                '<div style="margin-top:30px;text-align:center;color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:12px">' +
                'Generated by ' + (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + ' on ' + new Date().toLocaleString('en-KE') + '</div>' +
                '<div class="no-print" style="text-align:center;margin-top:20px"><button onclick="window.print()" style="padding:10px 28px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">Print</button></div>' +
                '</body></html>';

            const printWin = window.open('', '_blank', 'width=700,height=600');
            if (printWin) {
                printWin.document.write(printHtml);
                printWin.document.close();
            }
        },

        // ═══════════════════════════════════════════════
        //  PAGINATION
        // ═══════════════════════════════════════════════

        renderPagination: function () {
            const container = document.getElementById('exp-pagination');
            if (!container) return;
            const totalItems = filteredExpenses.length;
            const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
            if (totalPages <= 1) { container.innerHTML = ''; return; }

            const start = (expCurrentPage - 1) * PAGE_SIZE + 1;
            const end = Math.min(expCurrentPage * PAGE_SIZE, totalItems);

            let pagesHtml = '';
            const maxV = 5;
            let sp = Math.max(1, expCurrentPage - Math.floor(maxV / 2));
            let ep = Math.min(totalPages, sp + maxV - 1);
            if (ep - sp < maxV - 1) sp = Math.max(1, ep - maxV + 1);

            if (sp > 1) pagesHtml += '<button class="dda-page-btn" data-page="1">1</button>';
            if (sp > 2) pagesHtml += '<span class="dda-page-dots">...</span>';
            for (let p = sp; p <= ep; p++) {
                pagesHtml += '<button class="dda-page-btn' + (p === expCurrentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
            }
            if (ep < totalPages - 1) pagesHtml += '<span class="dda-page-dots">...</span>';
            if (ep < totalPages) pagesHtml += '<button class="dda-page-btn" data-page="' + totalPages + '">' + totalPages + '</button>';

            container.innerHTML = `
                <span class="dda-page-info">Showing ${start}-${end} of ${totalItems}</span>
                <div class="dda-page-controls">
                    <button class="dda-page-btn" data-page="${expCurrentPage - 1}" ${expCurrentPage === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
                    ${pagesHtml}
                    <button class="dda-page-btn" data-page="${expCurrentPage + 1}" ${expCurrentPage === totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>
                </div>
            `;

            container.querySelectorAll('.dda-page-btn[data-page]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const page = parseInt(btn.dataset.page);
                    if (page >= 1 && page <= totalPages) { expCurrentPage = page; this.renderPage(); }
                });
            });
        },

        // ═══════════════════════════════════════════════
        //  EXPORT PDF
        // ═══════════════════════════════════════════════

        exportPdf: function () {
            const { jsPDF } = window.jspdf;
            if (!jsPDF) { this.showToast('PDF library not loaded.', 'error'); return; }
            const doc = new jsPDF('l', 'mm', 'a4');

            const totalAmount = filteredExpenses.reduce((s, e) => s + (e.amount || 0), 0);

            doc.setFontSize(16);
            doc.text('Expenses Report', 14, 18);
            doc.setFontSize(9);
            doc.text('Generated: ' + new Date().toLocaleString('en-KE'), 14, 24);
            doc.text('Total Expenses: ' + filteredExpenses.length + '  |  Total Amount: ' + this.formatCurrency(totalAmount), 14, 29);

            const rows = filteredExpenses.map((e, i) => [
                i + 1,
                e.date || '',
                e.title || '',
                e.category || '',
                e.vendor || '',
                e.paymentMethod || '',
                this.formatCurrency(e.amount),
                e.status || 'pending',
                e.createdBy || ''
            ]);

            doc.autoTable({
                startY: 34,
                head: [['#', 'Date', 'Title', 'Category', 'Vendor', 'Payment', 'Amount', 'Status', 'Created By']],
                body: rows,
                styles: { fontSize: 8, cellPadding: 2 },
                headStyles: { fillColor: [79, 70, 229], textColor: 255 }
            });

            doc.save('Expenses_' + new Date().toISOString().split('T')[0] + '.pdf');
            this.showToast('Expenses PDF exported!');
        }
    };

    window.PharmaFlow.Expense = Expense;
})();
