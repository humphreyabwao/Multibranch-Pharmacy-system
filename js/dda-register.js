/**
 * PharmaFlow - DDA Register Module
 * Manages Dangerous Drugs Act (DDA) register:
 *   - View Register: All DDA-classified drugs from inventory auto-registered
 *   - DDA Sales: Every POS sale of a DDA drug is logged here
 *   - DDA Prescriptions: Upload/view prescriptions for DDA drugs
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let registerListener = null;
    let salesListener = null;
    let prescriptionListener = null;
    let ddaInventory = [];
    let ddaSalesData = [];
    let ddaPrescriptions = [];
    let filteredRegister = [];
    let filteredSales = [];
    let filteredPrescriptions = [];
    let regCurrentPage = 1;
    let salesCurrentPage = 1;
    let prescCurrentPage = 1;
    const PAGE_SIZE = 25;

    const DdaRegister = {

        // ═══════════════════════════════════════════════
        //  UTILITY HELPERS
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
            const old = document.querySelector('.dda-toast');
            if (old) old.remove();
            const t = document.createElement('div');
            t.className = 'dda-toast' + (type === 'error' ? ' dda-toast--error' : '');
            t.innerHTML = '<i class="fas ' + (type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle') + '"></i> ' + msg;
            document.body.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
        },

        cleanup: function () {
            if (registerListener) { registerListener(); registerListener = null; }
            if (salesListener) { salesListener(); salesListener = null; }
            if (prescriptionListener) { prescriptionListener(); prescriptionListener = null; }
            ddaInventory = [];
            ddaSalesData = [];
            ddaPrescriptions = [];
        },

        // ═══════════════════════════════════════════════
        //  VIEW REGISTER (DDA Inventory)
        // ═══════════════════════════════════════════════

        renderView: function (container) {
            if (salesListener) { salesListener(); salesListener = null; }
            if (prescriptionListener) { prescriptionListener(); prescriptionListener = null; }

            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-book-medical"></i> DDA Register</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>DDA Register</span>
                                <span>/</span><span>View Register</span>
                            </div>
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="dda-stats">
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon"><i class="fas fa-pills"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="dda-total-drugs">0</span>
                                <span class="dda-stat-label">DDA Drugs</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-exclamation-triangle"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="dda-low-stock">0</span>
                                <span class="dda-stat-label">Low Stock (&le;10)</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--danger"><i class="fas fa-ban"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="dda-out-stock">0</span>
                                <span class="dda-stat-label">Out of Stock</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-coins"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="dda-total-value">KSH 0</span>
                                <span class="dda-stat-label">Total Value</span>
                            </div>
                        </div>
                    </div>

                    <!-- Toolbar -->
                    <div class="dda-toolbar">
                        <div class="dda-search-box">
                            <i class="fas fa-search"></i>
                            <input type="text" id="dda-reg-search" placeholder="Search DDA drugs...">
                        </div>
                        <div class="dda-toolbar-actions">
                            <select id="dda-reg-category">
                                <option value="">All Categories</option>
                            </select>
                            <button class="dda-btn dda-btn--export" id="dda-reg-export-pdf">
                                <i class="fas fa-file-pdf"></i> Export PDF
                            </button>
                        </div>
                    </div>

                    <!-- Table -->
                    <div class="dda-table-wrap">
                        <table class="dda-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Drug Name</th>
                                    <th>SKU</th>
                                    <th>Category</th>
                                    <th>Buying Price</th>
                                    <th>Selling Price</th>
                                    <th>Current Stock</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody id="dda-reg-tbody">
                                <tr><td colspan="8" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading DDA register...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="dda-pagination" id="dda-reg-pagination"></div>
                </div>
            `;

            this.bindRegisterEvents(container);
            this.subscribeRegister();
        },

        bindRegisterEvents: function (container) {
            const search = document.getElementById('dda-reg-search');
            if (search) search.addEventListener('input', () => { regCurrentPage = 1; this.filterRegister(); });

            const cat = document.getElementById('dda-reg-category');
            if (cat) cat.addEventListener('change', () => { regCurrentPage = 1; this.filterRegister(); });

            const exportBtn = document.getElementById('dda-reg-export-pdf');
            if (exportBtn) exportBtn.addEventListener('click', () => this.exportRegisterPdf());

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });
        },

        subscribeRegister: function () {
            const businessId = this.getBusinessId();
            if (!businessId) return;
            if (registerListener) registerListener();

            registerListener = getBusinessCollection(businessId, 'inventory')
                .where('drugType', '==', 'DDA')
                .onSnapshot(snap => {
                    ddaInventory = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    ddaInventory.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                    this.updateRegisterStats();
                    this.populateRegCategories();
                    this.filterRegister();
                }, err => {
                    console.error('DDA register subscribe error:', err);
                    const tbody = document.getElementById('dda-reg-tbody');
                    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="dda-loading"><i class="fas fa-exclamation-circle"></i> Failed to load register</td></tr>';
                });
        },

        updateRegisterStats: function () {
            const el = id => document.getElementById(id);
            const total = ddaInventory.length;
            const low = ddaInventory.filter(d => d.quantity > 0 && d.quantity <= 10).length;
            const out = ddaInventory.filter(d => (d.quantity || 0) <= 0).length;
            const value = ddaInventory.reduce((s, d) => s + ((d.sellingPrice || 0) * (d.quantity || 0)), 0);

            if (el('dda-total-drugs')) el('dda-total-drugs').textContent = total;
            if (el('dda-low-stock')) el('dda-low-stock').textContent = low;
            if (el('dda-out-stock')) el('dda-out-stock').textContent = out;
            if (el('dda-total-value')) el('dda-total-value').textContent = this.formatCurrency(value);
        },

        populateRegCategories: function () {
            const sel = document.getElementById('dda-reg-category');
            if (!sel) return;
            const cats = [...new Set(ddaInventory.map(d => d.category).filter(Boolean))].sort();
            const current = sel.value;
            sel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => '<option value="' + c + '">' + c + '</option>').join('');
            sel.value = current;
        },

        filterRegister: function () {
            const query = (document.getElementById('dda-reg-search')?.value || '').toLowerCase();
            const cat = document.getElementById('dda-reg-category')?.value || '';

            filteredRegister = ddaInventory.filter(d => {
                if (cat && d.category !== cat) return false;
                if (query) {
                    const haystack = ((d.name || '') + ' ' + (d.sku || '') + ' ' + (d.category || '')).toLowerCase();
                    return haystack.includes(query);
                }
                return true;
            });

            this.renderRegisterPage();
        },

        renderRegisterPage: function () {
            const tbody = document.getElementById('dda-reg-tbody');
            if (!tbody) return;

            const start = (regCurrentPage - 1) * PAGE_SIZE;
            const pageData = filteredRegister.slice(start, start + PAGE_SIZE);

            if (pageData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="dda-loading"><i class="fas fa-inbox"></i> No DDA drugs found</td></tr>';
                this.renderPagination('dda-reg-pagination', filteredRegister.length, regCurrentPage, p => { regCurrentPage = p; this.renderRegisterPage(); });
                return;
            }

            tbody.innerHTML = pageData.map((d, i) => {
                const qty = d.quantity || 0;
                let statusCls = 'dda-stock--ok';
                let statusLabel = 'In Stock';
                if (qty <= 0) { statusCls = 'dda-stock--out'; statusLabel = 'Out of Stock'; }
                else if (qty <= 10) { statusCls = 'dda-stock--low'; statusLabel = 'Low Stock'; }

                return `<tr>
                    <td>${start + i + 1}</td>
                    <td><strong>${this.escapeHtml(d.name)}</strong></td>
                    <td><code>${this.escapeHtml(d.sku)}</code></td>
                    <td>${this.escapeHtml(d.category)}</td>
                    <td>${this.formatCurrency(d.buyingPrice)}</td>
                    <td>${this.formatCurrency(d.sellingPrice)}</td>
                    <td><strong>${qty}</strong></td>
                    <td><span class="dda-stock-badge ${statusCls}">${statusLabel}</span></td>
                </tr>`;
            }).join('');

            this.renderPagination('dda-reg-pagination', filteredRegister.length, regCurrentPage, p => { regCurrentPage = p; this.renderRegisterPage(); });
        },

        exportRegisterPdf: function () {
            const { jsPDF } = window.jspdf;
            if (!jsPDF) { this.showToast('PDF library not loaded.', 'error'); return; }
            const doc = new jsPDF('l', 'mm', 'a4');

            doc.setFontSize(16);
            doc.text('DDA Register — Drug Inventory', 14, 18);
            doc.setFontSize(9);
            doc.text('Generated: ' + new Date().toLocaleString('en-KE'), 14, 24);
            doc.text('Total DDA Drugs: ' + filteredRegister.length, 14, 29);

            const rows = filteredRegister.map((d, i) => [
                i + 1,
                d.name || '',
                d.sku || '',
                d.category || '',
                this.formatCurrency(d.buyingPrice),
                this.formatCurrency(d.sellingPrice),
                d.quantity || 0,
                (d.quantity || 0) <= 0 ? 'Out of Stock' : (d.quantity <= 10 ? 'Low Stock' : 'In Stock')
            ]);

            doc.autoTable({
                startY: 34,
                head: [['#', 'Drug Name', 'SKU', 'Category', 'Buying Price', 'Selling Price', 'Stock', 'Status']],
                body: rows,
                styles: { fontSize: 8, cellPadding: 2 },
                headStyles: { fillColor: [79, 70, 229], textColor: 255 }
            });

            doc.save('DDA_Register_' + new Date().toISOString().split('T')[0] + '.pdf');
            this.showToast('PDF exported successfully!');
        },

        // ═══════════════════════════════════════════════
        //  DDA SALES
        // ═══════════════════════════════════════════════

        renderSales: function (container) {
            if (registerListener) { registerListener(); registerListener = null; }
            if (prescriptionListener) { prescriptionListener(); prescriptionListener = null; }

            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-file-invoice-dollar"></i> DDA Sales</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>DDA Register</span>
                                <span>/</span><span>DDA Sales</span>
                            </div>
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="dda-stats">
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon"><i class="fas fa-shopping-cart"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="dda-sales-count">0</span>
                                <span class="dda-stat-label">DDA Sales</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--revenue"><i class="fas fa-coins"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="dda-sales-revenue">KSH 0</span>
                                <span class="dda-stat-label">Revenue</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--qty"><i class="fas fa-cubes"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="dda-sales-qty">0</span>
                                <span class="dda-stat-label">Units Sold</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--profit"><i class="fas fa-chart-line"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="dda-sales-profit">KSH 0</span>
                                <span class="dda-stat-label">Profit</span>
                            </div>
                        </div>
                    </div>

                    <!-- Toolbar -->
                    <div class="dda-toolbar">
                        <div class="dda-search-box">
                            <i class="fas fa-search"></i>
                            <input type="text" id="dda-sales-search" placeholder="Search drug, receipt, cashier...">
                        </div>
                        <div class="dda-toolbar-actions">
                            <input type="date" id="dda-sales-from" title="From date">
                            <input type="date" id="dda-sales-to" title="To date">
                            <button class="dda-btn dda-btn--export" id="dda-sales-export-pdf">
                                <i class="fas fa-file-pdf"></i> Export PDF
                            </button>
                        </div>
                    </div>

                    <!-- Quick Filters -->
                    <div class="dda-quick-filters">
                        <button class="dda-pill active" data-range="all">All Time</button>
                        <button class="dda-pill" data-range="today">Today</button>
                        <button class="dda-pill" data-range="yesterday">Yesterday</button>
                        <button class="dda-pill" data-range="week">This Week</button>
                        <button class="dda-pill" data-range="month">This Month</button>
                        <button class="dda-pill" data-range="30">Last 30 Days</button>
                    </div>

                    <!-- Table -->
                    <div class="dda-table-wrap">
                        <table class="dda-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Date</th>
                                    <th>Receipt #</th>
                                    <th>Drug Name</th>
                                    <th>Qty Sold</th>
                                    <th>Unit Price</th>
                                    <th>Total</th>
                                    <th>Profit</th>
                                    <th>Cashier</th>
                                    <th>Balance After</th>
                                </tr>
                            </thead>
                            <tbody id="dda-sales-tbody">
                                <tr><td colspan="10" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading DDA sales...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="dda-pagination" id="dda-sales-pagination"></div>
                </div>
            `;

            this.bindSalesEvents(container);
            this.subscribeSales();
        },

        bindSalesEvents: function (container) {
            const search = document.getElementById('dda-sales-search');
            if (search) search.addEventListener('input', () => { salesCurrentPage = 1; this.filterSales(); });

            const from = document.getElementById('dda-sales-from');
            const to = document.getElementById('dda-sales-to');
            if (from) from.addEventListener('change', () => { salesCurrentPage = 1; this.filterSales(); });
            if (to) to.addEventListener('change', () => { salesCurrentPage = 1; this.filterSales(); });

            const exportBtn = document.getElementById('dda-sales-export-pdf');
            if (exportBtn) exportBtn.addEventListener('click', () => this.exportSalesPdf());

            // Quick filter pills
            container.querySelectorAll('.dda-pill').forEach(pill => {
                pill.addEventListener('click', () => {
                    container.querySelectorAll('.dda-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                    this.applyQuickDateFilter(pill.dataset.range);
                });
            });

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });
        },

        applyQuickDateFilter: function (range) {
            const fromEl = document.getElementById('dda-sales-from');
            const toEl = document.getElementById('dda-sales-to');
            if (!fromEl || !toEl) return;

            const today = new Date();
            const fmt = d => d.toISOString().split('T')[0];

            switch (range) {
                case 'today':
                    fromEl.value = fmt(today); toEl.value = fmt(today); break;
                case 'yesterday': {
                    const y = new Date(today); y.setDate(y.getDate() - 1);
                    fromEl.value = fmt(y); toEl.value = fmt(y); break;
                }
                case 'week': {
                    const ws = new Date(today); ws.setDate(ws.getDate() - ws.getDay());
                    fromEl.value = fmt(ws); toEl.value = fmt(today); break;
                }
                case 'month': {
                    const ms = new Date(today.getFullYear(), today.getMonth(), 1);
                    fromEl.value = fmt(ms); toEl.value = fmt(today); break;
                }
                case '30': {
                    const d30 = new Date(today); d30.setDate(d30.getDate() - 30);
                    fromEl.value = fmt(d30); toEl.value = fmt(today); break;
                }
                default:
                    fromEl.value = ''; toEl.value = ''; break;
            }
            salesCurrentPage = 1;
            this.filterSales();
        },

        subscribeSales: function () {
            const businessId = this.getBusinessId();
            if (!businessId) return;
            if (salesListener) salesListener();

            salesListener = getBusinessCollection(businessId, 'dda_register')
                .where('type', '==', 'sale')
                .onSnapshot(snap => {
                    ddaSalesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    ddaSalesData.sort((a, b) => {
                        const ta = a.saleDate?.toDate ? a.saleDate.toDate().getTime() : 0;
                        const tb = b.saleDate?.toDate ? b.saleDate.toDate().getTime() : 0;
                        return tb - ta;
                    });
                    this.updateSalesStats();
                    this.filterSales();
                }, err => {
                    console.error('DDA sales subscribe error:', err);
                    const tbody = document.getElementById('dda-sales-tbody');
                    if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="dda-loading"><i class="fas fa-exclamation-circle"></i> Failed to load DDA sales</td></tr>';
                });
        },

        updateSalesStats: function () {
            const el = id => document.getElementById(id);
            const count = ddaSalesData.length;
            const revenue = ddaSalesData.reduce((s, d) => s + (d.lineTotal || 0), 0);
            const qty = ddaSalesData.reduce((s, d) => s + (d.quantitySold || 0), 0);
            const profit = ddaSalesData.reduce((s, d) => s + (d.profit || 0), 0);

            if (el('dda-sales-count')) el('dda-sales-count').textContent = count;
            if (el('dda-sales-revenue')) el('dda-sales-revenue').textContent = this.formatCurrency(revenue);
            if (el('dda-sales-qty')) el('dda-sales-qty').textContent = qty;
            if (el('dda-sales-profit')) el('dda-sales-profit').textContent = this.formatCurrency(profit);
        },

        filterSales: function () {
            const query = (document.getElementById('dda-sales-search')?.value || '').toLowerCase();
            const fromStr = document.getElementById('dda-sales-from')?.value || '';
            const toStr = document.getElementById('dda-sales-to')?.value || '';

            filteredSales = ddaSalesData.filter(s => {
                // Date filtering
                if (fromStr || toStr) {
                    const saleDate = s.saleDateStr || '';
                    if (fromStr && saleDate < fromStr) return false;
                    if (toStr && saleDate > toStr) return false;
                }
                // Search
                if (query) {
                    const haystack = ((s.drugName || '') + ' ' + (s.saleId || '') + ' ' + (s.soldBy || '')).toLowerCase();
                    return haystack.includes(query);
                }
                return true;
            });

            this.renderSalesPage();
        },

        renderSalesPage: function () {
            const tbody = document.getElementById('dda-sales-tbody');
            if (!tbody) return;

            const start = (salesCurrentPage - 1) * PAGE_SIZE;
            const pageData = filteredSales.slice(start, start + PAGE_SIZE);

            if (pageData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10" class="dda-loading"><i class="fas fa-inbox"></i> No DDA sales found</td></tr>';
                this.renderPagination('dda-sales-pagination', filteredSales.length, salesCurrentPage, p => { salesCurrentPage = p; this.renderSalesPage(); });
                return;
            }

            tbody.innerHTML = pageData.map((s, i) => {
                const date = s.saleDate?.toDate ? s.saleDate.toDate().toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
                const profitCls = (s.profit || 0) >= 0 ? 'sales-profit-pos' : 'sales-profit-neg';
                return `<tr>
                    <td>${start + i + 1}</td>
                    <td>${date}</td>
                    <td><code class="sales-receipt-code">${this.escapeHtml(s.saleId)}</code></td>
                    <td><strong>${this.escapeHtml(s.drugName)}</strong></td>
                    <td>${s.quantitySold || 0}</td>
                    <td>${this.formatCurrency(s.unitPrice)}</td>
                    <td><strong>${this.formatCurrency(s.lineTotal)}</strong></td>
                    <td class="${profitCls}">${this.formatCurrency(s.profit)}</td>
                    <td>${this.escapeHtml(s.soldBy)}</td>
                    <td>${s.balanceAfterSale != null ? s.balanceAfterSale : '—'}</td>
                </tr>`;
            }).join('');

            this.renderPagination('dda-sales-pagination', filteredSales.length, salesCurrentPage, p => { salesCurrentPage = p; this.renderSalesPage(); });
        },

        exportSalesPdf: function () {
            const { jsPDF } = window.jspdf;
            if (!jsPDF) { this.showToast('PDF library not loaded.', 'error'); return; }
            const doc = new jsPDF('l', 'mm', 'a4');

            doc.setFontSize(16);
            doc.text('DDA Sales Register', 14, 18);
            doc.setFontSize(9);
            doc.text('Generated: ' + new Date().toLocaleString('en-KE'), 14, 24);
            const from = document.getElementById('dda-sales-from')?.value || 'All';
            const to = document.getElementById('dda-sales-to')?.value || 'All';
            doc.text('Period: ' + from + ' to ' + to + '   |   Total Records: ' + filteredSales.length, 14, 29);

            const rows = filteredSales.map((s, i) => {
                const date = s.saleDate?.toDate ? s.saleDate.toDate().toLocaleDateString('en-KE') : '';
                return [i + 1, date, s.saleId || '', s.drugName || '', s.quantitySold || 0, this.formatCurrency(s.unitPrice), this.formatCurrency(s.lineTotal), this.formatCurrency(s.profit), s.soldBy || '', s.balanceAfterSale != null ? s.balanceAfterSale : ''];
            });

            doc.autoTable({
                startY: 34,
                head: [['#', 'Date', 'Receipt #', 'Drug Name', 'Qty', 'Unit Price', 'Total', 'Profit', 'Cashier', 'Balance']],
                body: rows,
                styles: { fontSize: 7, cellPadding: 2 },
                headStyles: { fillColor: [220, 38, 38], textColor: 255 }
            });

            doc.save('DDA_Sales_' + new Date().toISOString().split('T')[0] + '.pdf');
            this.showToast('DDA Sales PDF exported!');
        },

        // ═══════════════════════════════════════════════
        //  DDA PRESCRIPTIONS
        // ═══════════════════════════════════════════════

        renderPrescriptions: function (container) {
            if (registerListener) { registerListener(); registerListener = null; }
            if (salesListener) { salesListener(); salesListener = null; }

            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-file-prescription"></i> DDA Prescriptions</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>DDA Register</span>
                                <span>/</span><span>Prescriptions</span>
                            </div>
                        </div>
                        <button class="dda-btn dda-btn--primary" id="dda-upload-presc-btn">
                            <i class="fas fa-upload"></i> Upload Prescription
                        </button>
                    </div>

                    <!-- Stats -->
                    <div class="dda-stats">
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon"><i class="fas fa-file-medical"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="dda-presc-total">0</span>
                                <span class="dda-stat-label">Total Prescriptions</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--pending"><i class="fas fa-clock"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="dda-presc-pending">0</span>
                                <span class="dda-stat-label">Pending</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--dispensed"><i class="fas fa-check-circle"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="dda-presc-dispensed">0</span>
                                <span class="dda-stat-label">Dispensed</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--today"><i class="fas fa-calendar-day"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="dda-presc-today">0</span>
                                <span class="dda-stat-label">Today</span>
                            </div>
                        </div>
                    </div>

                    <!-- Toolbar -->
                    <div class="dda-toolbar">
                        <div class="dda-search-box">
                            <i class="fas fa-search"></i>
                            <input type="text" id="dda-presc-search" placeholder="Search patient, doctor, drug...">
                        </div>
                        <div class="dda-toolbar-actions">
                            <select id="dda-presc-status-filter">
                                <option value="">All Status</option>
                                <option value="pending">Pending</option>
                                <option value="dispensed">Dispensed</option>
                            </select>
                            <button class="dda-btn dda-btn--export" id="dda-presc-export-pdf">
                                <i class="fas fa-file-pdf"></i> Export PDF
                            </button>
                        </div>
                    </div>

                    <!-- Table -->
                    <div class="dda-table-wrap">
                        <table class="dda-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Date</th>
                                    <th>Patient Name</th>
                                    <th>Doctor / Prescriber</th>
                                    <th>Drug(s)</th>
                                    <th>Qty</th>
                                    <th>Status</th>
                                    <th>Prescription</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="dda-presc-tbody">
                                <tr><td colspan="9" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading prescriptions...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="dda-pagination" id="dda-presc-pagination"></div>
                </div>

                <!-- Upload Prescription Modal -->
                <div class="dda-modal-overlay" id="dda-presc-modal" style="display:none">
                    <div class="dda-modal">
                        <div class="dda-modal-header">
                            <h3><i class="fas fa-upload"></i> Upload DDA Prescription</h3>
                            <button class="dda-modal-close" id="dda-presc-modal-close">&times;</button>
                        </div>
                        <div class="dda-modal-body">
                            <div class="dda-form-group">
                                <label>Link to DDA Sale</label>
                                <select id="dda-presc-sale-link" class="dda-select">
                                    <option value="">— None (manual entry) —</option>
                                </select>
                                <small class="dda-form-hint">Select a sale to auto-fill drug details</small>
                            </div>
                            <div class="dda-form-group">
                                <label>Patient Name <span class="required">*</span></label>
                                <input type="text" id="dda-presc-patient" placeholder="Enter patient name" required>
                            </div>
                            <div class="dda-form-group">
                                <label>Doctor / Prescriber <span class="required">*</span></label>
                                <input type="text" id="dda-presc-doctor" placeholder="Dr. Name" required>
                            </div>
                            <div class="dda-form-group">
                                <label>Drug Name(s) <span class="required">*</span></label>
                                <input type="text" id="dda-presc-drug" placeholder="e.g., Morphine 10mg, Pethidine 50mg">
                            </div>
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Quantity</label>
                                    <input type="number" id="dda-presc-qty" min="1" value="1">
                                </div>
                                <div class="dda-form-group">
                                    <label>Prescription Date</label>
                                    <input type="date" id="dda-presc-date">
                                </div>
                            </div>
                            <div class="dda-form-group">
                                <label>Notes</label>
                                <textarea id="dda-presc-notes" rows="2" placeholder="Additional notes..."></textarea>
                            </div>
                            <div class="dda-form-group">
                                <label>Upload Prescription Image / PDF</label>
                                <div class="dda-file-upload" id="dda-file-drop-zone">
                                    <i class="fas fa-cloud-upload-alt"></i>
                                    <p>Drag & drop or <span class="dda-file-browse">browse</span></p>
                                    <small>Accepted: JPG, PNG, PDF (Max 5MB)</small>
                                    <input type="file" id="dda-presc-file" accept=".jpg,.jpeg,.png,.pdf" style="display:none">
                                </div>
                                <div class="dda-file-preview" id="dda-file-preview" style="display:none">
                                    <span id="dda-file-name"></span>
                                    <button class="dda-file-remove" id="dda-file-remove">&times;</button>
                                </div>
                            </div>
                        </div>
                        <div class="dda-modal-footer">
                            <button class="dda-btn dda-btn--cancel" id="dda-presc-cancel">Cancel</button>
                            <button class="dda-btn dda-btn--primary" id="dda-presc-save">
                                <i class="fas fa-save"></i> Save Prescription
                            </button>
                        </div>
                    </div>
                </div>

                <!-- View Prescription Modal -->
                <div class="dda-modal-overlay" id="dda-view-modal" style="display:none">
                    <div class="dda-modal dda-modal--view">
                        <div class="dda-modal-header">
                            <h3><i class="fas fa-file-medical"></i> Prescription Details</h3>
                            <button class="dda-modal-close" id="dda-view-modal-close">&times;</button>
                        </div>
                        <div class="dda-modal-body" id="dda-view-body"></div>
                        <div class="dda-modal-footer">
                            <button class="dda-btn dda-btn--cancel" id="dda-view-close-btn">Close</button>
                        </div>
                    </div>
                </div>
            `;

            this.bindPrescriptionEvents(container);
            this.subscribePrescriptions();
        },

        bindPrescriptionEvents: function (container) {
            const search = document.getElementById('dda-presc-search');
            if (search) search.addEventListener('input', () => { prescCurrentPage = 1; this.filterPrescriptions(); });

            const statusFilter = document.getElementById('dda-presc-status-filter');
            if (statusFilter) statusFilter.addEventListener('change', () => { prescCurrentPage = 1; this.filterPrescriptions(); });

            const exportBtn = document.getElementById('dda-presc-export-pdf');
            if (exportBtn) exportBtn.addEventListener('click', () => this.exportPrescriptionsPdf());

            // Upload modal
            const uploadBtn = document.getElementById('dda-upload-presc-btn');
            if (uploadBtn) uploadBtn.addEventListener('click', () => this.openPrescriptionModal());

            const closeBtn = document.getElementById('dda-presc-modal-close');
            if (closeBtn) closeBtn.addEventListener('click', () => this.closePrescriptionModal());

            const cancelBtn = document.getElementById('dda-presc-cancel');
            if (cancelBtn) cancelBtn.addEventListener('click', () => this.closePrescriptionModal());

            const saveBtn = document.getElementById('dda-presc-save');
            if (saveBtn) saveBtn.addEventListener('click', () => this.savePrescription());

            // File upload
            const dropZone = document.getElementById('dda-file-drop-zone');
            const fileInput = document.getElementById('dda-presc-file');
            if (dropZone && fileInput) {
                dropZone.addEventListener('click', () => fileInput.click());
                dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
                dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
                dropZone.addEventListener('drop', (e) => {
                    e.preventDefault();
                    dropZone.classList.remove('dragover');
                    if (e.dataTransfer.files.length) {
                        fileInput.files = e.dataTransfer.files;
                        this.handleFileSelect(fileInput.files[0]);
                    }
                });
                fileInput.addEventListener('change', () => {
                    if (fileInput.files.length) this.handleFileSelect(fileInput.files[0]);
                });
            }

            const removeFile = document.getElementById('dda-file-remove');
            if (removeFile) removeFile.addEventListener('click', () => this.clearFileSelection());

            // Set default prescription date
            const dateInput = document.getElementById('dda-presc-date');
            if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

            // View modal close
            const viewClose = document.getElementById('dda-view-modal-close');
            if (viewClose) viewClose.addEventListener('click', () => { document.getElementById('dda-view-modal').style.display = 'none'; });
            const viewCloseBtn = document.getElementById('dda-view-close-btn');
            if (viewCloseBtn) viewCloseBtn.addEventListener('click', () => { document.getElementById('dda-view-modal').style.display = 'none'; });

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });
        },

        handleFileSelect: function (file) {
            const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
            if (!allowed.includes(file.type)) {
                this.showToast('Only JPG, PNG, or PDF files allowed.', 'error');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                this.showToast('File must be under 5MB.', 'error');
                return;
            }
            document.getElementById('dda-file-drop-zone').style.display = 'none';
            const preview = document.getElementById('dda-file-preview');
            preview.style.display = 'flex';
            document.getElementById('dda-file-name').textContent = file.name;
        },

        clearFileSelection: function () {
            const fileInput = document.getElementById('dda-presc-file');
            if (fileInput) fileInput.value = '';
            document.getElementById('dda-file-drop-zone').style.display = 'flex';
            document.getElementById('dda-file-preview').style.display = 'none';
        },

        openPrescriptionModal: function () {
            const modal = document.getElementById('dda-presc-modal');
            if (modal) modal.style.display = 'flex';
            // Reset form
            ['dda-presc-patient', 'dda-presc-doctor', 'dda-presc-drug', 'dda-presc-notes'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            const qty = document.getElementById('dda-presc-qty');
            if (qty) qty.value = '1';
            const date = document.getElementById('dda-presc-date');
            if (date) date.value = new Date().toISOString().split('T')[0];
            this.clearFileSelection();
            this._loadSalesForPrescription();
        },

        _loadSalesForPrescription: function () {
            var self = this;
            var businessId = this.getBusinessId();
            if (!businessId) return;
            var sel = document.getElementById('dda-presc-sale-link');
            if (!sel) return;

            sel.innerHTML = '<option value="">— None (manual entry) —</option><option disabled>Loading sales…</option>';

            getBusinessCollection(businessId, 'dda_register')
                .where('type', '==', 'sale')
                .limit(200)
                .get()
                .then(function (snap) {
                    var sales = [];
                    snap.forEach(function (doc) { sales.push(Object.assign({ id: doc.id }, doc.data())); });
                    // Sort by saleDate descending (client-side, no composite index needed)
                    sales.sort(function (a, b) {
                        var ta = a.saleDate && a.saleDate.toDate ? a.saleDate.toDate().getTime() : 0;
                        var tb = b.saleDate && b.saleDate.toDate ? b.saleDate.toDate().getTime() : 0;
                        return tb - ta;
                    });

                    sel.innerHTML = '<option value="">— None (manual entry) —</option>';
                    if (sales.length === 0) {
                        sel.innerHTML += '<option disabled>No DDA sales found</option>';
                        return;
                    }

                    // Group sales by saleId (receipt)
                    var grouped = {};
                    sales.forEach(function (s) {
                        var key = s.saleId || s.id;
                        if (!grouped[key]) grouped[key] = { saleId: key, drugs: [], date: s.saleDateStr || '', totalQty: 0 };
                        grouped[key].drugs.push(s.drugName || 'Unknown');
                        grouped[key].totalQty += (s.quantitySold || 0);
                        if (!grouped[key].date && s.saleDate && s.saleDate.toDate) {
                            grouped[key].date = s.saleDate.toDate().toLocaleDateString('en-KE');
                        }
                    });

                    Object.keys(grouped).forEach(function (key) {
                        var g = grouped[key];
                        var label = g.saleId + ' — ' + g.drugs.join(', ') + ' (Qty: ' + g.totalQty + ')' + (g.date ? ' [' + g.date + ']' : '');
                        var opt = document.createElement('option');
                        opt.value = key;
                        opt.textContent = label;
                        opt.dataset.drugs = g.drugs.join(', ');
                        opt.dataset.qty = g.totalQty;
                        sel.appendChild(opt);
                    });
                })
                .catch(function (err) {
                    console.error('Load DDA sales for prescription error:', err);
                    sel.innerHTML = '<option value="">— None (manual entry) —</option>';
                });

            // Bind change to auto-fill
            sel.onchange = function () {
                var opt = sel.options[sel.selectedIndex];
                if (sel.value && opt && opt.dataset.drugs) {
                    var drugInput = document.getElementById('dda-presc-drug');
                    var qtyInput = document.getElementById('dda-presc-qty');
                    if (drugInput) drugInput.value = opt.dataset.drugs;
                    if (qtyInput) qtyInput.value = opt.dataset.qty || '1';
                }
            };
        },

        closePrescriptionModal: function () {
            const modal = document.getElementById('dda-presc-modal');
            if (modal) modal.style.display = 'none';
        },

        savePrescription: async function () {
            const patient = document.getElementById('dda-presc-patient')?.value?.trim();
            const doctor = document.getElementById('dda-presc-doctor')?.value?.trim();
            const drug = document.getElementById('dda-presc-drug')?.value?.trim();
            const qty = parseInt(document.getElementById('dda-presc-qty')?.value) || 1;
            const prescDate = document.getElementById('dda-presc-date')?.value || new Date().toISOString().split('T')[0];
            const notes = document.getElementById('dda-presc-notes')?.value?.trim() || '';
            const linkedSaleId = document.getElementById('dda-presc-sale-link')?.value || null;

            if (!patient || !doctor || !drug) {
                this.showToast('Patient, Doctor, and Drug fields are required.', 'error');
                return;
            }

            const businessId = this.getBusinessId();
            if (!businessId) { this.showToast('No business assigned.', 'error'); return; }

            const saveBtn = document.getElementById('dda-presc-save');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

            try {
                const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
                const fileInput = document.getElementById('dda-presc-file');
                let fileUrl = '';
                let fileName = '';

                // Upload file to Firebase Storage if selected
                if (fileInput && fileInput.files.length > 0) {
                    const file = fileInput.files[0];
                    fileName = file.name;
                    const safeName = Date.now() + '_' + fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
                    const storageRef = window.storage.ref('businesses/' + businessId + '/dda_prescriptions/' + safeName);
                    const snap = await storageRef.put(file);
                    fileUrl = await snap.ref.getDownloadURL();
                }

                const prescData = {
                    type: 'prescription',
                    patientName: patient,
                    doctorName: doctor,
                    drugNames: drug,
                    quantity: qty,
                    linkedSaleId: linkedSaleId,
                    prescriptionDate: prescDate,
                    notes: notes,
                    fileUrl: fileUrl,
                    fileName: fileName,
                    status: 'pending',
                    createdBy: profile ? (profile.displayName || profile.email) : 'Unknown',
                    createdByUid: firebase.auth().currentUser ? firebase.auth().currentUser.uid : null,
                    createdAt: new Date().toISOString(),
                    recordDate: firebase.firestore.Timestamp.fromDate(new Date(prescDate)),
                    dateSortStr: prescDate
                };

                await getBusinessCollection(businessId, 'dda_register').add(prescData);
                this.showToast('Prescription saved successfully!');
                this.closePrescriptionModal();
            } catch (err) {
                console.error('Save prescription error:', err);
                this.showToast('Failed to save prescription: ' + err.message, 'error');
            } finally {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Prescription'; }
            }
        },

        subscribePrescriptions: function () {
            const businessId = this.getBusinessId();
            if (!businessId) return;
            if (prescriptionListener) prescriptionListener();

            prescriptionListener = getBusinessCollection(businessId, 'dda_register')
                .where('type', '==', 'prescription')
                .onSnapshot(snap => {
                    ddaPrescriptions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    ddaPrescriptions.sort((a, b) => {
                        const ta = a.recordDate?.toDate ? a.recordDate.toDate().getTime() : 0;
                        const tb = b.recordDate?.toDate ? b.recordDate.toDate().getTime() : 0;
                        return tb - ta;
                    });
                    this.updatePrescriptionStats();
                    this.filterPrescriptions();
                }, err => {
                    console.error('DDA prescriptions subscribe error:', err);
                    const tbody = document.getElementById('dda-presc-tbody');
                    if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="dda-loading"><i class="fas fa-exclamation-circle"></i> Failed to load prescriptions</td></tr>';
                });
        },

        updatePrescriptionStats: function () {
            const el = id => document.getElementById(id);
            const today = new Date().toISOString().split('T')[0];
            const total = ddaPrescriptions.length;
            const pending = ddaPrescriptions.filter(p => p.status === 'pending').length;
            const dispensed = ddaPrescriptions.filter(p => p.status === 'dispensed').length;
            const todayCount = ddaPrescriptions.filter(p => p.dateSortStr === today).length;

            if (el('dda-presc-total')) el('dda-presc-total').textContent = total;
            if (el('dda-presc-pending')) el('dda-presc-pending').textContent = pending;
            if (el('dda-presc-dispensed')) el('dda-presc-dispensed').textContent = dispensed;
            if (el('dda-presc-today')) el('dda-presc-today').textContent = todayCount;
        },

        filterPrescriptions: function () {
            const query = (document.getElementById('dda-presc-search')?.value || '').toLowerCase();
            const statusFilter = document.getElementById('dda-presc-status-filter')?.value || '';

            filteredPrescriptions = ddaPrescriptions.filter(p => {
                if (statusFilter && p.status !== statusFilter) return false;
                if (query) {
                    const haystack = ((p.patientName || '') + ' ' + (p.doctorName || '') + ' ' + (p.drugNames || '')).toLowerCase();
                    return haystack.includes(query);
                }
                return true;
            });

            this.renderPrescriptionsPage();
        },

        renderPrescriptionsPage: function () {
            const tbody = document.getElementById('dda-presc-tbody');
            if (!tbody) return;

            const start = (prescCurrentPage - 1) * PAGE_SIZE;
            const pageData = filteredPrescriptions.slice(start, start + PAGE_SIZE);

            if (pageData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" class="dda-loading"><i class="fas fa-inbox"></i> No prescriptions found</td></tr>';
                this.renderPagination('dda-presc-pagination', filteredPrescriptions.length, prescCurrentPage, p => { prescCurrentPage = p; this.renderPrescriptionsPage(); });
                return;
            }

            tbody.innerHTML = pageData.map((p, i) => {
                const date = p.recordDate?.toDate ? p.recordDate.toDate().toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
                const statusBadge = p.status === 'dispensed'
                    ? '<span class="dda-presc-badge dda-presc--dispensed"><i class="fas fa-check-circle"></i> Dispensed</span>'
                    : '<span class="dda-presc-badge dda-presc--pending"><i class="fas fa-clock"></i> Pending</span>';
                const fileLink = p.fileUrl
                    ? '<a href="' + this.escapeHtml(p.fileUrl) + '" target="_blank" rel="noopener noreferrer" class="dda-file-link"><i class="fas fa-paperclip"></i> View</a>'
                    : '<span class="dda-no-file">No file</span>';

                return `<tr>
                    <td>${start + i + 1}</td>
                    <td>${date}</td>
                    <td><strong>${this.escapeHtml(p.patientName)}</strong></td>
                    <td>${this.escapeHtml(p.doctorName)}</td>
                    <td>${this.escapeHtml(p.drugNames)}</td>
                    <td>${p.quantity || 0}</td>
                    <td>${statusBadge}</td>
                    <td>${fileLink}</td>
                    <td>
                        <button class="sales-action-btn sales-action--view dda-action--view" data-id="${p.id}" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        ${p.status === 'pending' ? '<button class="sales-action-btn sales-action--approve dda-action--dispense" data-id="' + p.id + '" title="Mark Dispensed"><i class="fas fa-check-double"></i></button>' : ''}
                    </td>
                </tr>`;
            }).join('');

            // Bind view
            tbody.querySelectorAll('.dda-action--view').forEach(btn => {
                btn.addEventListener('click', () => {
                    const presc = ddaPrescriptions.find(p => p.id === btn.dataset.id);
                    if (presc) this.viewPrescription(presc);
                });
            });

            // Bind dispense
            tbody.querySelectorAll('.dda-action--dispense').forEach(btn => {
                btn.addEventListener('click', () => this.dispensePrescription(btn.dataset.id));
            });

            this.renderPagination('dda-presc-pagination', filteredPrescriptions.length, prescCurrentPage, p => { prescCurrentPage = p; this.renderPrescriptionsPage(); });
        },

        viewPrescription: function (presc) {
            const modal = document.getElementById('dda-view-modal');
            const body = document.getElementById('dda-view-body');
            if (!modal || !body) return;

            const date = presc.recordDate?.toDate ? presc.recordDate.toDate().toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
            const statusBadge = presc.status === 'dispensed'
                ? '<span class="dda-presc-badge dda-presc--dispensed"><i class="fas fa-check-circle"></i> Dispensed</span>'
                : '<span class="dda-presc-badge dda-presc--pending"><i class="fas fa-clock"></i> Pending</span>';

            body.innerHTML = `
                <div class="dda-view-details">
                    <div class="dda-view-row">
                        <span class="dda-view-label">Patient Name</span>
                        <span class="dda-view-value">${this.escapeHtml(presc.patientName)}</span>
                    </div>
                    <div class="dda-view-row">
                        <span class="dda-view-label">Doctor / Prescriber</span>
                        <span class="dda-view-value">${this.escapeHtml(presc.doctorName)}</span>
                    </div>
                    <div class="dda-view-row">
                        <span class="dda-view-label">Drug(s)</span>
                        <span class="dda-view-value"><strong>${this.escapeHtml(presc.drugNames)}</strong></span>
                    </div>
                    <div class="dda-view-row">
                        <span class="dda-view-label">Quantity</span>
                        <span class="dda-view-value">${presc.quantity || 0}</span>
                    </div>
                    <div class="dda-view-row">
                        <span class="dda-view-label">Prescription Date</span>
                        <span class="dda-view-value">${date}</span>
                    </div>
                    <div class="dda-view-row">
                        <span class="dda-view-label">Status</span>
                        <span class="dda-view-value">${statusBadge}</span>
                    </div>
                    ${presc.dispensedBy ? '<div class="dda-view-row"><span class="dda-view-label">Dispensed By</span><span class="dda-view-value">' + this.escapeHtml(presc.dispensedBy) + '</span></div>' : ''}
                    ${presc.notes ? '<div class="dda-view-row"><span class="dda-view-label">Notes</span><span class="dda-view-value">' + this.escapeHtml(presc.notes) + '</span></div>' : ''}
                    ${presc.fileUrl ? '<div class="dda-view-row"><span class="dda-view-label">Prescription File</span><span class="dda-view-value"><a href="' + this.escapeHtml(presc.fileUrl) + '" target="_blank" rel="noopener noreferrer" class="dda-btn dda-btn--export"><i class="fas fa-external-link-alt"></i> Open File</a></span></div>' : ''}
                    <div class="dda-view-row">
                        <span class="dda-view-label">Recorded By</span>
                        <span class="dda-view-value">${this.escapeHtml(presc.createdBy)}</span>
                    </div>
                </div>
            `;

            modal.style.display = 'flex';
        },

        dispensePrescription: async function (prescId) {
            const businessId = this.getBusinessId();
            if (!businessId) return;
            try {
                const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
                await getBusinessCollection(businessId, 'dda_register').doc(prescId).update({
                    status: 'dispensed',
                    dispensedBy: profile ? (profile.displayName || profile.email) : 'Unknown',
                    dispensedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.showToast('Prescription marked as dispensed!');
            } catch (err) {
                console.error('Dispense error:', err);
                this.showToast('Failed to update prescription.', 'error');
            }
        },

        exportPrescriptionsPdf: function () {
            const { jsPDF } = window.jspdf;
            if (!jsPDF) { this.showToast('PDF library not loaded.', 'error'); return; }
            const doc = new jsPDF('l', 'mm', 'a4');

            doc.setFontSize(16);
            doc.text('DDA Prescriptions Register', 14, 18);
            doc.setFontSize(9);
            doc.text('Generated: ' + new Date().toLocaleString('en-KE'), 14, 24);
            doc.text('Total Records: ' + filteredPrescriptions.length, 14, 29);

            const rows = filteredPrescriptions.map((p, i) => {
                const date = p.recordDate?.toDate ? p.recordDate.toDate().toLocaleDateString('en-KE') : '';
                return [i + 1, date, p.patientName || '', p.doctorName || '', p.drugNames || '', p.quantity || 0, p.status || '', p.createdBy || ''];
            });

            doc.autoTable({
                startY: 34,
                head: [['#', 'Date', 'Patient', 'Doctor', 'Drug(s)', 'Qty', 'Status', 'Recorded By']],
                body: rows,
                styles: { fontSize: 8, cellPadding: 2 },
                headStyles: { fillColor: [16, 185, 129], textColor: 255 }
            });

            doc.save('DDA_Prescriptions_' + new Date().toISOString().split('T')[0] + '.pdf');
            this.showToast('Prescriptions PDF exported!');
        },

        // ═══════════════════════════════════════════════
        //  SHARED: PAGINATION
        // ═══════════════════════════════════════════════

        renderPagination: function (containerId, totalItems, currentPage, onPageChange) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
            if (totalPages <= 1) { container.innerHTML = ''; return; }

            const start = (currentPage - 1) * PAGE_SIZE + 1;
            const end = Math.min(currentPage * PAGE_SIZE, totalItems);

            let pagesHtml = '';
            const maxVisible = 5;
            let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
            let endPage = Math.min(totalPages, startPage + maxVisible - 1);
            if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

            if (startPage > 1) pagesHtml += '<button class="dda-page-btn" data-page="1">1</button>';
            if (startPage > 2) pagesHtml += '<span class="dda-page-dots">...</span>';
            for (let p = startPage; p <= endPage; p++) {
                pagesHtml += '<button class="dda-page-btn' + (p === currentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
            }
            if (endPage < totalPages - 1) pagesHtml += '<span class="dda-page-dots">...</span>';
            if (endPage < totalPages) pagesHtml += '<button class="dda-page-btn" data-page="' + totalPages + '">' + totalPages + '</button>';

            container.innerHTML = `
                <span class="dda-page-info">Showing ${start}-${end} of ${totalItems}</span>
                <div class="dda-page-controls">
                    <button class="dda-page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
                    ${pagesHtml}
                    <button class="dda-page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>
                </div>
            `;

            container.querySelectorAll('.dda-page-btn[data-page]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const page = parseInt(btn.dataset.page);
                    if (page >= 1 && page <= totalPages) onPageChange(page);
                });
            });
        },

        // ═══════════════════════════════════════════════
        //  STATIC: Record DDA sale (called from POS)
        // ═══════════════════════════════════════════════

        recordDdaSale: async function (businessId, saleId, item, soldBy, soldByUid, saleDate, saleDateStr) {
            try {
                // Get current stock for balance-after-sale
                let balanceAfter = null;
                try {
                    const invDoc = await getBusinessCollection(businessId, 'inventory').doc(item.productId).get();
                    if (invDoc.exists) {
                        balanceAfter = (invDoc.data().quantity || 0) - item.quantity;
                    }
                } catch (e) { /* non-critical */ }

                const ddaEntry = {
                    type: 'sale',
                    saleId: saleId,
                    productId: item.productId,
                    drugName: item.name,
                    sku: item.sku || '',
                    category: item.category || '',
                    quantitySold: item.quantity,
                    unitPrice: item.unitPrice,
                    buyingPrice: item.buyingPrice || 0,
                    lineTotal: item.lineTotal,
                    profit: item.profit || 0,
                    balanceAfterSale: balanceAfter,
                    soldBy: soldBy,
                    soldByUid: soldByUid,
                    saleDate: saleDate,
                    saleDateStr: saleDateStr,
                    createdAt: new Date().toISOString()
                };

                await getBusinessCollection(businessId, 'dda_register').add(ddaEntry);
            } catch (err) {
                console.error('DDA sale record error for ' + item.name + ':', err);
            }
        }
    };

    window.PharmaFlow.DdaRegister = DdaRegister;
})();
