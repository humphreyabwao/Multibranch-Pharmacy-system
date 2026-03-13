/**
 * PharmaFlow - Today's Sales Module
 * Shows all completed sales for the current day with stats and table.
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let unsubTodaySales = null;
    let todaySalesData = [];

    const TodaysSales = {

        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        formatCurrency: function (amount) {
            return 'KSH ' + new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
        },

        escapeHtml: function (str) {
            const div = document.createElement('div');
            div.textContent = str || '';
            return div.innerHTML;
        },

        showToast: function (message, type) {
            const existing = document.querySelector('.ts-toast');
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.className = 'ts-toast ts-toast--' + (type || 'success');
            toast.innerHTML = '<i class="fas fa-' + (type === 'error' ? 'exclamation-circle' : 'check-circle') + '"></i> ' + message;
            document.body.appendChild(toast);
            setTimeout(() => toast.classList.add('show'), 10);
            setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
        },

        // ─── RENDER ──────────────────────────────────────────

        render: function (container) {
            const businessId = this.getBusinessId();
            const today = new Date();
            const dateStr = today.toLocaleDateString('en-KE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

            container.innerHTML = `
                <div class="sales-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-chart-line"></i> Today's Sales</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Pharmacy</span><span>/</span>
                                <span>Today's Sales</span>
                            </div>
                        </div>
                        <div class="page-header-right">
                            <span class="sales-date-badge"><i class="fas fa-calendar-day"></i> ${dateStr}</span>
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="sales-stats-row" id="ts-stats-row">
                        <div class="sales-stat-card sales-stat--revenue">
                            <i class="fas fa-coins"></i>
                            <div><span class="sales-stat-value" id="ts-revenue">KSH 0.00</span><small>Total Revenue</small></div>
                        </div>
                        <div class="sales-stat-card sales-stat--profit">
                            <i class="fas fa-chart-line"></i>
                            <div><span class="sales-stat-value" id="ts-profit">KSH 0.00</span><small>Total Profit</small></div>
                        </div>
                        <div class="sales-stat-card sales-stat--count">
                            <i class="fas fa-receipt"></i>
                            <div><span class="sales-stat-value" id="ts-count">0</span><small>Transactions</small></div>
                        </div>
                        <div class="sales-stat-card sales-stat--items">
                            <i class="fas fa-pills"></i>
                            <div><span class="sales-stat-value" id="ts-items">0</span><small>Items Sold</small></div>
                        </div>
                        <div class="sales-stat-card sales-stat--avg">
                            <i class="fas fa-calculator"></i>
                            <div><span class="sales-stat-value" id="ts-avg">KSH 0.00</span><small>Avg. Sale</small></div>
                        </div>
                    </div>

                    <!-- Toolbar -->
                    <div class="sales-toolbar">
                        <div class="sales-search">
                            <i class="fas fa-search"></i>
                            <input type="text" id="ts-search" placeholder="Search by receipt #, cashier, or item...">
                        </div>
                        <div class="sales-filters">
                            <select id="ts-status-filter">
                                <option value="">All Status</option>
                                <option value="completed">Completed</option>
                                <option value="approved">Approved</option>
                                <option value="cancelled">Cancelled</option>
                            </select>
                            <select id="ts-payment-filter">
                                <option value="">All Payments</option>
                                <option value="cash">Cash</option>
                                <option value="mpesa">M-Pesa</option>
                                <option value="card">Card</option>
                            </select>
                        </div>
                    </div>

                    <!-- Table -->
                    <div class="sales-table-wrapper">
                        <table class="sales-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Receipt #</th>
                                    <th>Time</th>
                                    <th>Items</th>
                                    <th>Subtotal</th>
                                    <th>Discount</th>
                                    <th>Total</th>
                                    <th>Profit</th>
                                    <th>Payment</th>
                                    <th>Status</th>
                                    <th>Cashier</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="ts-tbody">
                                <tr><td colspan="13" class="sales-loading"><i class="fas fa-spinner fa-spin"></i> Loading today's sales...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            this.bindEvents(container);
            this.subscribeToTodaySales(businessId);
        },

        bindEvents: function (container) {
            const self = this;

            const search = document.getElementById('ts-search');
            if (search) {
                let debounce;
                search.addEventListener('input', function () {
                    clearTimeout(debounce);
                    debounce = setTimeout(() => self.renderTable(), 150);
                });
            }

            const payFilter = document.getElementById('ts-payment-filter');
            if (payFilter) payFilter.addEventListener('change', () => this.renderTable());

            const statusFilter = document.getElementById('ts-status-filter');
            if (statusFilter) statusFilter.addEventListener('change', () => this.renderTable());

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) {
                dashLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    PharmaFlow.Sidebar.setActive('dashboard', null);
                });
            }
        },

        // ─── SUBSCRIPTION ────────────────────────────────────

        subscribeToTodaySales: function (businessId) {
            if (unsubTodaySales) { unsubTodaySales(); unsubTodaySales = null; }
            if (!businessId) return;

            const col = getBusinessCollection(businessId, 'sales');
            if (!col) return;

            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];

            unsubTodaySales = col
                .where('saleDateStr', '==', todayStr)
                .onSnapshot(snapshot => {
                    todaySalesData = [];
                    snapshot.forEach(doc => todaySalesData.push({ id: doc.id, ...doc.data() }));
                    // Sort client-side by createdAt desc (avoids composite index)
                    todaySalesData.sort((a, b) => {
                        const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
                        const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
                        return tb - ta;
                    });
                    this.updateStats();
                    this.renderTable();
                }, err => {
                    console.error('Today sales subscription error:', err);
                    const tbody = document.getElementById('ts-tbody');
                    if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="sales-loading">Error loading sales</td></tr>';
                });
        },

        // ─── STATS ───────────────────────────────────────────

        updateStats: function () {
            const activeSales = todaySalesData.filter(s => s.status !== 'cancelled');
            const revenue = activeSales.reduce((s, sale) => s + (sale.total || 0), 0);
            const profit = activeSales.reduce((s, sale) => s + (sale.totalProfit || 0), 0);
            const itemCount = activeSales.reduce((s, sale) => s + (sale.itemCount || 0), 0);
            const avg = activeSales.length > 0 ? revenue / activeSales.length : 0;

            const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
            el('ts-revenue', this.formatCurrency(revenue));
            el('ts-profit', this.formatCurrency(profit));
            el('ts-count', todaySalesData.length);
            el('ts-items', itemCount);
            el('ts-avg', this.formatCurrency(avg));
        },

        // ─── TABLE ───────────────────────────────────────────

        renderTable: function () {
            const tbody = document.getElementById('ts-tbody');
            if (!tbody) return;

            const query = (document.getElementById('ts-search')?.value || '').toLowerCase().trim();
            const payFilter = document.getElementById('ts-payment-filter')?.value || '';

            const statusFilter = document.getElementById('ts-status-filter')?.value || '';

            let filtered = todaySalesData.filter(sale => {
                if (payFilter && sale.paymentMethod !== payFilter) return false;
                if (statusFilter && (sale.status || 'completed') !== statusFilter) return false;
                if (query) {
                    const match = (sale.saleId || '').toLowerCase().includes(query)
                        || (sale.soldBy || '').toLowerCase().includes(query)
                        || (sale.items || []).some(item => (item.name || '').toLowerCase().includes(query));
                    if (!match) return false;
                }
                return true;
            });

            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="13" class="sales-loading"><i class="fas fa-inbox"></i> No sales found today</td></tr>';
                return;
            }

            tbody.innerHTML = filtered.map((sale, i) => {
                const time = sale.saleDate?.toDate ? sale.saleDate.toDate().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '—';
                const payBadge = this.getPaymentBadge(sale.paymentMethod);
                const status = sale.status || 'completed';
                const statusBadge = this.getStatusBadge(status);
                const isCompleted = status === 'completed';

                return `<tr>
                    <td>${i + 1}</td>
                    <td><code class="sales-receipt-code">${this.escapeHtml(sale.saleId)}</code></td>
                    <td>${time}</td>
                    <td>${sale.itemCount || 0}</td>
                    <td>${this.formatCurrency(sale.subtotal)}</td>
                    <td>${sale.discountAmount > 0 ? '- ' + this.formatCurrency(sale.discountAmount) : '—'}</td>
                    <td><strong>${this.formatCurrency(sale.total)}</strong></td>
                    <td class="${(sale.totalProfit || 0) >= 0 ? 'sales-profit-pos' : 'sales-profit-neg'}">${this.formatCurrency(sale.totalProfit)}</td>
                    <td>${payBadge}</td>
                    <td>${statusBadge}</td>
                    <td>${this.escapeHtml(sale.soldBy)}</td>
                    <td>
                        <button class="sales-action-btn sales-action--view" data-id="${sale.id}" title="View Receipt">
                            <i class="fas fa-eye"></i>
                        </button>
                        ${isCompleted ? '<button class="sales-action-btn sales-action--approve" data-id="' + sale.id + '" title="Approve Sale"><i class="fas fa-check-double"></i></button>' : ''}
                        ${status !== 'cancelled' ? '<button class="sales-action-btn sales-action--cancel" data-id="' + sale.id + '" title="Cancel Sale"><i class="fas fa-ban"></i></button>' : '<button class="sales-action-btn sales-action--restore" data-id="' + sale.id + '" title="Restore Sale"><i class="fas fa-rotate-left"></i></button>'}
                    </td>
                </tr>`;
            }).join('');

            // Bind view receipt buttons
            tbody.querySelectorAll('.sales-action--view').forEach(btn => {
                btn.addEventListener('click', () => {
                    const sale = todaySalesData.find(s => s.id === btn.dataset.id);
                    if (sale && PharmaFlow.POS) {
                        PharmaFlow.POS.showReceipt(sale, sale.changeDue || 0);
                    }
                });
            });

            // Bind approve buttons
            tbody.querySelectorAll('.sales-action--approve').forEach(btn => {
                btn.addEventListener('click', () => this.approveSale(btn.dataset.id));
            });

            // Cancel buttons
            tbody.querySelectorAll('.sales-action--cancel').forEach(btn => {
                btn.addEventListener('click', () => this.cancelSale(btn.dataset.id));
            });

            // Restore buttons
            tbody.querySelectorAll('.sales-action--restore').forEach(btn => {
                btn.addEventListener('click', () => this.restoreSale(btn.dataset.id));
            });
        },

        approveSale: async function (saleId) {
            const businessId = this.getBusinessId();
            if (!businessId) return;
            try {
                await getBusinessCollection(businessId, 'sales').doc(saleId).update({
                    status: 'approved',
                    approvedBy: PharmaFlow.Auth?.userProfile?.displayName || PharmaFlow.Auth?.userProfile?.email || 'Manager',
                    approvedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.showToast('Sale approved successfully!');
            } catch (err) {
                console.error('Approve error:', err);
                this.showToast('Failed to approve sale.', 'error');
            }
        },

        getPaymentBadge: function (method) {
            const map = {
                'cash': { icon: 'fa-money-bill-wave', label: 'Cash', cls: 'pay--cash' },
                'mpesa': { icon: 'fa-mobile-alt', label: 'M-Pesa', cls: 'pay--mpesa' },
                'card': { icon: 'fa-credit-card', label: 'Card', cls: 'pay--card' }
            };
            const info = map[method] || map['cash'];
            return '<span class="sales-pay-badge ' + info.cls + '"><i class="fas ' + info.icon + '"></i> ' + info.label + '</span>';
        },

        getStatusBadge: function (status) {
            if (status === 'approved') {
                return '<span class="sales-status-badge status--approved"><i class="fas fa-check-double"></i> Approved</span>';
            }
            if (status === 'cancelled') {
                return '<span class="sales-status-badge status--cancelled"><i class="fas fa-ban"></i> Cancelled</span>';
            }
            return '<span class="sales-status-badge status--completed"><i class="fas fa-check"></i> Completed</span>';
        },

        cancelSale: async function (saleId) {
            if (!(await PharmaFlow.confirm('Cancel this sale? It will be excluded from revenue calculations.', { title: 'Cancel Sale', confirmText: 'Yes, Cancel', danger: true }))) return;
            const businessId = this.getBusinessId();
            if (!businessId) return;
            try {
                const saleDoc = todaySalesData.find(s => s.id === saleId);
                await getBusinessCollection(businessId, 'sales').doc(saleId).update({
                    status: 'cancelled',
                    previousStatus: saleDoc?.status || 'completed',
                    cancelledBy: PharmaFlow.Auth?.userProfile?.displayName || PharmaFlow.Auth?.userProfile?.email || 'Unknown',
                    cancelledAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.showToast('Sale cancelled.');
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Sale Cancelled',
                        description: 'Sale ' + saleId + ' cancelled',
                        category: 'Pharmacy',
                        status: 'WARNING'
                    });
                }
            } catch (err) {
                console.error('Cancel sale error:', err);
                this.showToast('Failed to cancel sale.', 'error');
            }
        },

        restoreSale: async function (saleId) {
            if (!(await PharmaFlow.confirm('Restore this cancelled sale? It will be added back to revenue calculations.', { title: 'Restore Sale', confirmText: 'Yes, Restore' }))) return;
            const businessId = this.getBusinessId();
            if (!businessId) return;
            try {
                const saleDoc = todaySalesData.find(s => s.id === saleId);
                const restoreTo = saleDoc?.previousStatus || 'completed';
                await getBusinessCollection(businessId, 'sales').doc(saleId).update({
                    status: restoreTo,
                    restoredBy: PharmaFlow.Auth?.userProfile?.displayName || PharmaFlow.Auth?.userProfile?.email || 'Unknown',
                    restoredAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.showToast('Sale restored.');
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Sale Restored',
                        description: 'Sale ' + saleId + ' restored to ' + restoreTo,
                        category: 'Pharmacy',
                        status: 'INFO'
                    });
                }
            } catch (err) {
                console.error('Restore sale error:', err);
                this.showToast('Failed to restore sale.', 'error');
            }
        },

        // ─── CLEANUP ─────────────────────────────────────────

        cleanup: function () {
            if (unsubTodaySales) { unsubTodaySales(); unsubTodaySales = null; }
            todaySalesData = [];
        }
    };

    window.PharmaFlow.TodaysSales = TodaysSales;
})();
