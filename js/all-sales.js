/**
 * PharmaFlow - All Sales Module
 * Shows all historical sales with date range filter, search, pagination, and export.
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let allSalesData = [];
    let filteredSales = [];
    let unsubAllSales = null;
    let currentPage = 1;
    let pageSize = 50;

    const AllSales = {

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
            const existing = document.querySelector('.as-toast');
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.className = 'as-toast as-toast--' + (type || 'success');
            toast.innerHTML = '<i class="fas fa-' + (type === 'error' ? 'exclamation-circle' : 'check-circle') + '"></i> ' + message;
            document.body.appendChild(toast);
            setTimeout(() => toast.classList.add('show'), 10);
            setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
        },

        formatDate: function (ts) {
            if (!ts) return '—';
            const d = ts.toDate ? ts.toDate() : new Date(ts);
            return d.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
        },

        formatTime: function (ts) {
            if (!ts) return '—';
            const d = ts.toDate ? ts.toDate() : new Date(ts);
            return d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
        },

        // ─── RENDER ──────────────────────────────────────────

        render: function (container) {
            currentPage = 1;
            const businessId = this.getBusinessId();

            // Default date range: last 30 days
            const now = new Date();
            const thirtyAgo = new Date(now);
            thirtyAgo.setDate(thirtyAgo.getDate() - 30);
            const fromStr = thirtyAgo.toISOString().split('T')[0];
            const toStr = now.toISOString().split('T')[0];

            container.innerHTML = `
                <div class="sales-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-receipt"></i> All Sales</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Pharmacy</span><span>/</span>
                                <span>All Sales</span>
                            </div>
                        </div>
                        <div class="page-header-right">
                            <button class="btn btn-sm btn-outline" id="as-export-btn">
                                <i class="fas fa-file-export"></i> Export
                            </button>
                            <div class="as-export-menu" id="as-export-menu" style="display:none;">
                                <button class="as-export-option" data-type="excel"><i class="fas fa-file-excel"></i> Export Excel</button>
                                <button class="as-export-option" data-type="pdf"><i class="fas fa-file-pdf"></i> Export PDF</button>
                            </div>
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="sales-stats-row" id="as-stats-row">
                        <div class="sales-stat-card sales-stat--revenue">
                            <i class="fas fa-coins"></i>
                            <div><span class="sales-stat-value" id="as-revenue">KSH 0.00</span><small>Total Revenue</small></div>
                        </div>
                        <div class="sales-stat-card sales-stat--profit">
                            <i class="fas fa-chart-line"></i>
                            <div><span class="sales-stat-value" id="as-profit">KSH 0.00</span><small>Total Profit</small></div>
                        </div>
                        <div class="sales-stat-card sales-stat--count">
                            <i class="fas fa-receipt"></i>
                            <div><span class="sales-stat-value" id="as-count">0</span><small>Total Sales</small></div>
                        </div>
                        <div class="sales-stat-card sales-stat--items">
                            <i class="fas fa-pills"></i>
                            <div><span class="sales-stat-value" id="as-items">0</span><small>Items Sold</small></div>
                        </div>
                    </div>

                    <!-- Quick Date Filters -->
                    <div class="sales-quick-filters" id="as-quick-filters">
                        <button class="sales-qf-btn" data-range="today"><i class="fas fa-calendar-day"></i> Today</button>
                        <button class="sales-qf-btn" data-range="yesterday"><i class="fas fa-calendar-minus"></i> Yesterday</button>
                        <button class="sales-qf-btn" data-range="this-week"><i class="fas fa-calendar-week"></i> This Week</button>
                        <button class="sales-qf-btn" data-range="this-month"><i class="fas fa-calendar"></i> This Month</button>
                        <button class="sales-qf-btn active" data-range="last-30"><i class="fas fa-calendar-alt"></i> Last 30 Days</button>
                        <button class="sales-qf-btn" data-range="all"><i class="fas fa-infinity"></i> All Time</button>
                    </div>

                    <!-- Toolbar -->
                    <div class="sales-toolbar">
                        <div class="sales-search">
                            <i class="fas fa-search"></i>
                            <input type="text" id="as-search" placeholder="Search by receipt #, cashier, customer, phone, or item...">
                        </div>
                        <div class="sales-filters">
                            <div class="sales-date-range">
                                <label>From:</label>
                                <input type="date" id="as-date-from" value="${fromStr}">
                                <label>To:</label>
                                <input type="date" id="as-date-to" value="${toStr}">
                            </div>
                            <select id="as-status-filter">
                                <option value="">All Status</option>
                                <option value="completed">Completed</option>
                                <option value="approved">Approved</option>
                                <option value="cancelled">Cancelled</option>
                            </select>
                            <select id="as-payment-filter">
                                <option value="">All Payments</option>
                                <option value="cash">Cash</option>
                                <option value="mpesa">M-Pesa</option>
                                <option value="card">Card</option>
                            </select>
                            <select id="as-page-size">
                                <option value="25">25 per page</option>
                                <option value="50" selected>50 per page</option>
                                <option value="100">100 per page</option>
                                <option value="250">250 per page</option>
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
                                    <th>Date</th>
                                    <th>Time</th>
                                    <th>Items</th>
                                    <th>Subtotal</th>
                                    <th>Discount</th>
                                    <th>VAT</th>
                                    <th>Total</th>
                                    <th>Profit</th>
                                    <th>Payment</th>
                                    <th>Status</th>
                                    <th>Cashier</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="as-tbody">
                                <tr><td colspan="14" class="sales-loading"><i class="fas fa-spinner fa-spin"></i> Loading sales...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="sales-pagination" id="as-pagination"></div>
                </div>
            `;

            this.bindEvents(container);
            this.loadSales(businessId);
        },

        bindEvents: function (container) {
            const self = this;

            const search = document.getElementById('as-search');
            if (search) {
                let debounce;
                search.addEventListener('input', function () {
                    clearTimeout(debounce);
                    debounce = setTimeout(() => { currentPage = 1; self.applyFilters(); }, 150);
                });
            }

            const payFilter = document.getElementById('as-payment-filter');
            if (payFilter) payFilter.addEventListener('change', () => { currentPage = 1; this.applyFilters(); });

            const statusFilter = document.getElementById('as-status-filter');
            if (statusFilter) statusFilter.addEventListener('change', () => { currentPage = 1; this.applyFilters(); });

            const dateFrom = document.getElementById('as-date-from');
            const dateTo = document.getElementById('as-date-to');
            if (dateFrom) dateFrom.addEventListener('change', () => { currentPage = 1; this.applyFilters(); });
            if (dateTo) dateTo.addEventListener('change', () => { currentPage = 1; this.applyFilters(); });

            const pageSizeSelect = document.getElementById('as-page-size');
            if (pageSizeSelect) pageSizeSelect.addEventListener('change', function () {
                pageSize = parseInt(this.value) || 50;
                currentPage = 1;
                self.renderCurrentPage();
            });

            // Export button
            const exportBtn = document.getElementById('as-export-btn');
            const exportMenu = document.getElementById('as-export-menu');
            if (exportBtn && exportMenu) {
                exportBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    exportMenu.style.display = exportMenu.style.display === 'none' ? 'block' : 'none';
                });
                document.addEventListener('click', () => { exportMenu.style.display = 'none'; });

                exportMenu.querySelectorAll('.as-export-option').forEach(opt => {
                    opt.addEventListener('click', () => {
                        exportMenu.style.display = 'none';
                        if (opt.dataset.type === 'excel') this.exportExcel();
                        else if (opt.dataset.type === 'pdf') this.exportPDF();
                    });
                });
            }

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) {
                dashLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    PharmaFlow.Sidebar.setActive('dashboard', null);
                });
            }

            // Quick date filter buttons
            container.querySelectorAll('.sales-qf-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    container.querySelectorAll('.sales-qf-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.applyQuickDateFilter(btn.dataset.range);
                });
            });
        },

        // ─── QUICK DATE FILTERS ──────────────────────────────

        applyQuickDateFilter: function (range) {
            const now = new Date();
            const dateFrom = document.getElementById('as-date-from');
            const dateTo = document.getElementById('as-date-to');
            if (!dateFrom || !dateTo) return;

            let from, to;
            const fmt = (d) => d.toISOString().split('T')[0];

            switch (range) {
                case 'today':
                    from = to = fmt(now);
                    break;
                case 'yesterday': {
                    const y = new Date(now);
                    y.setDate(y.getDate() - 1);
                    from = to = fmt(y);
                    break;
                }
                case 'this-week': {
                    const day = now.getDay();
                    const mon = new Date(now);
                    mon.setDate(mon.getDate() - (day === 0 ? 6 : day - 1));
                    from = fmt(mon);
                    to = fmt(now);
                    break;
                }
                case 'this-month': {
                    const first = new Date(now.getFullYear(), now.getMonth(), 1);
                    from = fmt(first);
                    to = fmt(now);
                    break;
                }
                case 'last-30': {
                    const ago = new Date(now);
                    ago.setDate(ago.getDate() - 30);
                    from = fmt(ago);
                    to = fmt(now);
                    break;
                }
                case 'all':
                    from = '';
                    to = '';
                    break;
                default:
                    return;
            }

            dateFrom.value = from;
            dateTo.value = to;
            currentPage = 1;
            this.applyFilters();
        },

        // ─── LOAD SALES ──────────────────────────────────────

        loadSales: function (businessId) {
            if (unsubAllSales) { unsubAllSales(); unsubAllSales = null; }
            if (!businessId) return;

            const col = getBusinessCollection(businessId, 'sales');
            if (!col) return;

            unsubAllSales = col.orderBy('createdAt', 'desc').onSnapshot(snapshot => {
                allSalesData = [];
                snapshot.forEach(doc => allSalesData.push({ id: doc.id, ...doc.data() }));
                this.applyFilters();
            }, err => {
                console.error('All sales subscription error:', err);
            });
        },

        // ─── FILTER ──────────────────────────────────────────

        applyFilters: function () {
            const query = (document.getElementById('as-search')?.value || '').toLowerCase().trim();
            const payFilter = document.getElementById('as-payment-filter')?.value || '';
            const dateFrom = document.getElementById('as-date-from')?.value || '';
            const dateTo = document.getElementById('as-date-to')?.value || '';

            const statusFilter = document.getElementById('as-status-filter')?.value || '';

            filteredSales = allSalesData.filter(sale => {
                // Payment filter
                if (payFilter && sale.paymentMethod !== payFilter) return false;

                // Status filter
                if (statusFilter && (sale.status || 'completed') !== statusFilter) return false;

                // Date range
                const saleDate = sale.saleDateStr || '';
                if (dateFrom && saleDate < dateFrom) return false;
                if (dateTo && saleDate > dateTo) return false;

                // Search
                if (query) {
                    const customerName = (sale.customer?.name || '').toLowerCase();
                    const customerPhone = (sale.customer?.phone || '').toLowerCase();
                    const match = (sale.saleId || '').toLowerCase().includes(query)
                        || (sale.soldBy || '').toLowerCase().includes(query)
                        || customerName.includes(query)
                        || customerPhone.includes(query)
                        || (sale.items || []).some(item => (item.name || '').toLowerCase().includes(query));
                    if (!match) return false;
                }

                return true;
            });

            this.updateStats();
            this.renderCurrentPage();
        },

        // ─── STATS ───────────────────────────────────────────

        updateStats: function () {
            const activeSales = filteredSales.filter(s => s.status !== 'cancelled');
            const revenue = activeSales.reduce((s, sale) => s + (sale.total || 0), 0);
            const profit = activeSales.reduce((s, sale) => s + (sale.totalProfit || 0), 0);
            const itemCount = activeSales.reduce((s, sale) => s + (sale.itemCount || 0), 0);

            const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
            el('as-revenue', this.formatCurrency(revenue));
            el('as-profit', this.formatCurrency(profit));
            el('as-count', filteredSales.length);
            el('as-items', itemCount);
        },

        // ─── TABLE ───────────────────────────────────────────

        renderCurrentPage: function () {
            const tbody = document.getElementById('as-tbody');
            if (!tbody) return;

            const totalPages = Math.max(1, Math.ceil(filteredSales.length / pageSize));
            if (currentPage > totalPages) currentPage = totalPages;

            const start = (currentPage - 1) * pageSize;
            const pageData = filteredSales.slice(start, start + pageSize);

            if (pageData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="14" class="sales-loading"><i class="fas fa-inbox"></i> No sales found</td></tr>';
                this.renderPagination(0, 0);
                return;
            }

            tbody.innerHTML = pageData.map((sale, i) => {
                const payBadge = this.getPaymentBadge(sale.paymentMethod);
                const status = sale.status || 'completed';
                const statusBadge = this.getStatusBadge(status);
                const isCompleted = status === 'completed';
                return `<tr>
                    <td>${start + i + 1}</td>
                    <td><code class="sales-receipt-code">${this.escapeHtml(sale.saleId)}</code></td>
                    <td>${this.formatDate(sale.saleDate)}</td>
                    <td>${this.formatTime(sale.saleDate)}</td>
                    <td>${sale.itemCount || 0}</td>
                    <td>${this.formatCurrency(sale.subtotal)}</td>
                    <td>${sale.discountAmount > 0 ? '- ' + this.formatCurrency(sale.discountAmount) : '—'}</td>
                    <td>${this.formatCurrency(sale.vatAmount || 0)}</td>
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

            // View receipt
            tbody.querySelectorAll('.sales-action--view').forEach(btn => {
                btn.addEventListener('click', () => {
                    const sale = allSalesData.find(s => s.id === btn.dataset.id);
                    if (sale && PharmaFlow.POS) {
                        PharmaFlow.POS.showReceipt(sale, sale.changeDue || 0);
                    }
                });
            });

            // Approve buttons
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

            this.renderPagination(totalPages, filteredSales.length);
        },

        renderPagination: function (totalPages, totalItems) {
            const container = document.getElementById('as-pagination');
            if (!container) return;

            if (totalPages <= 1) { container.innerHTML = ''; return; }

            let html = '<div class="sales-page-info">Page ' + currentPage + ' of ' + totalPages + ' (' + totalItems + ' sales)</div><div class="sales-page-btns">';

            html += '<button class="sales-page-btn" data-page="1" ' + (currentPage === 1 ? 'disabled' : '') + '><i class="fas fa-angles-left"></i></button>';
            html += '<button class="sales-page-btn" data-page="' + (currentPage - 1) + '" ' + (currentPage === 1 ? 'disabled' : '') + '><i class="fas fa-angle-left"></i></button>';

            const startPage = Math.max(1, currentPage - 2);
            const endPage = Math.min(totalPages, currentPage + 2);
            for (let p = startPage; p <= endPage; p++) {
                html += '<button class="sales-page-btn ' + (p === currentPage ? 'active' : '') + '" data-page="' + p + '">' + p + '</button>';
            }

            html += '<button class="sales-page-btn" data-page="' + (currentPage + 1) + '" ' + (currentPage === totalPages ? 'disabled' : '') + '><i class="fas fa-angle-right"></i></button>';
            html += '<button class="sales-page-btn" data-page="' + totalPages + '" ' + (currentPage === totalPages ? 'disabled' : '') + '><i class="fas fa-angles-right"></i></button>';
            html += '</div>';

            container.innerHTML = html;

            container.querySelectorAll('.sales-page-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const p = parseInt(btn.dataset.page);
                    if (p >= 1 && p <= totalPages && p !== currentPage) {
                        currentPage = p;
                        this.renderCurrentPage();
                    }
                });
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

        cancelSale: async function (saleId) {
            if (!(await PharmaFlow.confirm('Cancel this sale? This will mark it as cancelled and exclude it from revenue calculations.', { title: 'Cancel Sale', confirmText: 'Yes, Cancel', danger: true }))) return;
            const businessId = this.getBusinessId();
            if (!businessId) return;
            try {
                const saleDoc = allSalesData.find(s => s.id === saleId);
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
                const saleDoc = allSalesData.find(s => s.id === saleId);
                const restoreTo = saleDoc?.previousStatus || 'completed';
                await getBusinessCollection(businessId, 'sales').doc(saleId).update({
                    status: restoreTo,
                    restoredBy: PharmaFlow.Auth?.userProfile?.displayName || PharmaFlow.Auth?.userProfile?.email || 'Unknown',
                    restoredAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.showToast('Sale restored to ' + restoreTo + '.');
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

        // ─── EXPORT ──────────────────────────────────────────

        exportExcel: function () {
            if (filteredSales.length === 0) { this.showToast('No sales to export', 'error'); return; }

            const rows = filteredSales.map(sale => ({
                'Receipt #': sale.saleId,
                'Date': sale.saleDateStr || '',
                'Items': sale.itemCount || 0,
                'Subtotal': sale.subtotal || 0,
                'Discount': sale.discountAmount || 0,
                'VAT': sale.vatAmount || 0,
                'Total': sale.total || 0,
                'Profit': sale.totalProfit || 0,
                'Payment': (sale.paymentMethod || '').toUpperCase(),
                'Cashier': sale.soldBy || ''
            }));

            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'All Sales');
            XLSX.writeFile(wb, (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow').replace(/\s+/g, '') + '_AllSales_' + new Date().toISOString().split('T')[0] + '.xlsx');
            this.showToast('Excel exported!');
        },

        exportPDF: function () {
            if (filteredSales.length === 0) { this.showToast('No sales to export', 'error'); return; }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('landscape');
            doc.setFontSize(16);
            doc.text((PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + ' - All Sales Report', 14, 18);
            doc.setFontSize(10);
            doc.text('Generated: ' + new Date().toLocaleString('en-KE'), 14, 26);

            const rows = filteredSales.map((sale, i) => [
                i + 1,
                sale.saleId,
                sale.saleDateStr || '',
                sale.itemCount || 0,
                this.formatCurrency(sale.subtotal),
                this.formatCurrency(sale.vatAmount || 0),
                this.formatCurrency(sale.total),
                this.formatCurrency(sale.totalProfit),
                (sale.paymentMethod || '').toUpperCase(),
                sale.soldBy || ''
            ]);

            doc.autoTable({
                startY: 32,
                head: [['#', 'Receipt #', 'Date', 'Items', 'Subtotal', 'VAT', 'Total', 'Profit', 'Payment', 'Cashier']],
                body: rows,
                styles: { fontSize: 8 },
                headStyles: { fillColor: [37, 99, 235] }
            });

            doc.save((PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow').replace(/\s+/g, '') + '_AllSales_' + new Date().toISOString().split('T')[0] + '.pdf');
            this.showToast('PDF exported!');
        },

        // ─── CLEANUP ─────────────────────────────────────────

        cleanup: function () {
            if (unsubAllSales) { unsubAllSales(); unsubAllSales = null; }
            allSalesData = [];
            filteredSales = [];
        }
    };

    window.PharmaFlow.AllSales = AllSales;
})();
