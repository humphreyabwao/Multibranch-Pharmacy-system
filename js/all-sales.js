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
    let exportMenuState = null;

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

        formatSalePaymentLabel: function (sale) {
            if (sale.paymentMethod === 'split' && Array.isArray(sale.paymentSplits) && sale.paymentSplits.length) {
                return 'SPLIT ' + sale.paymentSplits.filter(p => (p.amount || 0) > 0)
                    .map(p => String(p.method || '').toUpperCase() + ':' + (p.amount || 0)).join(', ');
            }
            return (sale.paymentMethod || '').toUpperCase();
        },

        roundMoney: function (amount) {
            return PharmaFlow.roundMoney ? PharmaFlow.roundMoney(amount) : Math.round((parseFloat(amount) || 0) * 100) / 100;
        },

        getBatchDateValue: function (value) {
            if (!value) return Number.POSITIVE_INFINITY;
            const date = value.toDate ? value.toDate() : new Date(value);
            return date && !isNaN(date.getTime()) ? date.getTime() : Number.POSITIVE_INFINITY;
        },

        getSaleItemQuantity: function (item) {
            return Math.max(0, parseInt(item?.quantity ?? item?.qty, 10) || 0);
        },

        getAdjustableSaleItems: function (sale) {
            return (Array.isArray(sale?.items) ? sale.items : [])
                .filter(item => item && item.productId && this.getSaleItemQuantity(item) > 0);
        },

        getProductStockBatches: function (product) {
            if (!product) return [];
            const productQty = Math.max(0, parseInt(product.quantity, 10) || 0);
            let batches = [];

            if (Array.isArray(product.stockBatches) && product.stockBatches.length) {
                batches = product.stockBatches
                    .map(batch => ({ ...batch, quantity: Math.max(0, parseInt(batch.quantity, 10) || 0) }))
                    .filter(batch => batch.quantity > 0);
            } else if (productQty > 0 || product.expiryDate || product.batchNumber) {
                batches = [{
                    batchNumber: product.batchNumber || '',
                    quantity: productQty,
                    expiryDate: product.expiryDate || null,
                    addedAt: product.createdAt || product.updatedAt || null,
                    legacy: true
                }];
            }

            if (!productQty) return [];

            batches.sort((a, b) => this.getBatchDateValue(a.expiryDate) - this.getBatchDateValue(b.expiryDate));

            const normalized = [];
            let assigned = 0;
            batches.forEach(batch => {
                if (assigned >= productQty) return;
                const available = Math.max(0, parseInt(batch.quantity, 10) || 0);
                const qty = Math.min(available, productQty - assigned);
                if (qty > 0) {
                    normalized.push({ ...batch, quantity: qty });
                    assigned += qty;
                }
            });

            if (assigned < productQty) {
                normalized.push({
                    batchNumber: product.batchNumber || '',
                    quantity: productQty - assigned,
                    expiryDate: product.expiryDate || null,
                    addedAt: product.updatedAt || product.createdAt || null,
                    reconciled: true
                });
            }

            return normalized;
        },

        getPrimaryBatchAfterAdjustment: function (batches) {
            const sorted = (batches || [])
                .filter(batch => (parseInt(batch.quantity, 10) || 0) > 0)
                .sort((a, b) => this.getBatchDateValue(a.expiryDate) - this.getBatchDateValue(b.expiryDate));
            if (!sorted.length) return { batchNumber: '', expiryDate: null };
            return {
                batchNumber: sorted[0].batchNumber || '',
                expiryDate: sorted[0].expiryDate || null
            };
        },

        reduceStockBatches: function (product, qty, itemName) {
            let remaining = Math.max(0, parseInt(qty, 10) || 0);
            const sortedBatches = this.getProductStockBatches(product)
                .sort((a, b) => this.getBatchDateValue(a.expiryDate) - this.getBatchDateValue(b.expiryDate));

            const updatedBatches = sortedBatches.map(batch => {
                const available = Math.max(0, parseInt(batch.quantity, 10) || 0);
                const used = Math.min(available, remaining);
                remaining -= used;
                return { ...batch, quantity: available - used };
            }).filter(batch => (parseInt(batch.quantity, 10) || 0) > 0);

            if (remaining > 0) {
                throw new Error('Insufficient stock for ' + (product?.name || itemName || 'selected product'));
            }

            return updatedBatches;
        },

        addBackToStockBatches: function (product, qty, saleItem, saleId) {
            const addQty = Math.max(0, parseInt(qty, 10) || 0);
            const batches = this.getProductStockBatches(product);
            const preferredBatch = saleItem?.batchNumber || saleItem?.stockBatchNumber || product?.batchNumber || '';
            const batchIndex = preferredBatch
                ? batches.findIndex(batch => (batch.batchNumber || '') === preferredBatch)
                : -1;

            if (batchIndex >= 0) {
                batches[batchIndex] = {
                    ...batches[batchIndex],
                    quantity: (parseInt(batches[batchIndex].quantity, 10) || 0) + addQty
                };
            } else if (batches.length) {
                batches[0] = {
                    ...batches[0],
                    quantity: (parseInt(batches[0].quantity, 10) || 0) + addQty
                };
            } else {
                batches.push({
                    batchNumber: preferredBatch || product?.sku || saleItem?.sku || saleItem?.productId || '',
                    quantity: addQty,
                    expiryDate: product?.expiryDate || null,
                    addedAt: new Date().toISOString(),
                    source: 'sale_cancel',
                    saleId: saleId
                });
            }

            return batches.sort((a, b) => this.getBatchDateValue(a.expiryDate) - this.getBatchDateValue(b.expiryDate));
        },

        updateSaleInventoryStatus: async function (businessId, saleId, mode, restoreTo) {
            const inventoryCol = getBusinessCollection(businessId, 'inventory');
            const salesCol = getBusinessCollection(businessId, 'sales');
            const saleRef = salesCol.doc(saleId);
            const actor = PharmaFlow.Auth?.userProfile?.displayName || PharmaFlow.Auth?.userProfile?.email || 'Unknown';

            return window.db.runTransaction(async (transaction) => {
                const saleSnapshot = await transaction.get(saleRef);
                if (!saleSnapshot.exists) {
                    throw new Error('Sale not found.');
                }

                const sale = saleSnapshot.data() || {};
                const saleStatus = sale.status || 'completed';
                const saleItems = this.getAdjustableSaleItems(sale);
                const stockUpdates = [];
                let resultingStatus = saleStatus;
                let inventoryAdjusted = false;

                if (mode === 'cancel') {
                    if (saleStatus === 'cancelled') {
                        throw new Error('This sale is already cancelled.');
                    }

                    for (const item of saleItems) {
                        const itemQty = this.getSaleItemQuantity(item);
                        const ref = inventoryCol.doc(item.productId);
                        const snapshot = await transaction.get(ref);
                        if (!snapshot.exists) {
                            throw new Error('Inventory item not found: ' + (item.name || item.productId));
                        }

                        const product = snapshot.data() || {};
                        const currentQty = Math.max(0, parseInt(product.quantity, 10) || 0);
                        const nextQty = currentQty + itemQty;
                        const nextBatches = this.addBackToStockBatches(product, itemQty, item, saleId);
                        const primaryBatch = this.getPrimaryBatchAfterAdjustment(nextBatches);

                        stockUpdates.push({
                            ref: ref,
                            data: {
                                quantity: nextQty,
                                stockBatches: nextBatches,
                                batchNumber: primaryBatch.batchNumber || '',
                                expiryDate: primaryBatch.expiryDate || null,
                                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                            }
                        });
                    }

                    inventoryAdjusted = saleItems.length > 0;
                    transaction.update(saleRef, {
                        status: 'cancelled',
                        previousStatus: saleStatus,
                        cancelledBy: actor,
                        cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
                        inventoryAdjustedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        inventoryAdjusted: inventoryAdjusted,
                        inventoryAdjustment: inventoryAdjusted ? 'returned_to_inventory' : 'no_inventory_items'
                    });
                    resultingStatus = 'cancelled';
                } else if (mode === 'restore') {
                    if (saleStatus !== 'cancelled') {
                        throw new Error('Only cancelled sales can be restored.');
                    }

                    const shouldAdjustInventory = sale.inventoryAdjustment === 'returned_to_inventory' || sale.inventoryAdjusted === true;
                    if (shouldAdjustInventory) {
                        for (const item of saleItems) {
                            const itemQty = this.getSaleItemQuantity(item);
                            const ref = inventoryCol.doc(item.productId);
                            const snapshot = await transaction.get(ref);
                            if (!snapshot.exists) {
                                throw new Error('Inventory item not found: ' + (item.name || item.productId));
                            }

                            const product = snapshot.data() || {};
                            const currentQty = Math.max(0, parseInt(product.quantity, 10) || 0);
                            if (currentQty < itemQty) {
                                throw new Error('Only ' + currentQty + ' left in stock for ' + (product.name || item.name || 'selected product'));
                            }

                            const nextQty = currentQty - itemQty;
                            const nextBatches = this.reduceStockBatches(product, itemQty, item.name);
                            const primaryBatch = this.getPrimaryBatchAfterAdjustment(nextBatches);

                            stockUpdates.push({
                                ref: ref,
                                data: {
                                    quantity: nextQty,
                                    stockBatches: nextBatches,
                                    batchNumber: primaryBatch.batchNumber || '',
                                    expiryDate: primaryBatch.expiryDate || null,
                                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                                }
                            });
                        }
                    }

                    const nextStatus = sale.previousStatus || restoreTo || 'completed';
                    transaction.update(saleRef, {
                        status: nextStatus,
                        restoredBy: actor,
                        restoredAt: firebase.firestore.FieldValue.serverTimestamp(),
                        inventoryAdjustedAt: shouldAdjustInventory ? firebase.firestore.FieldValue.serverTimestamp() : (sale.inventoryAdjustedAt || null),
                        inventoryAdjusted: false,
                        inventoryAdjustment: shouldAdjustInventory ? 'removed_from_inventory' : 'not_adjusted_on_restore'
                    });
                    resultingStatus = nextStatus;
                    inventoryAdjusted = shouldAdjustInventory;
                }

                stockUpdates.forEach(update => transaction.update(update.ref, update.data));
                return { status: resultingStatus, inventoryAdjusted: inventoryAdjusted };
            });
        },

        getProductVatTotal: function (sale) {
            return PharmaFlow.getProductVatTotal ? PharmaFlow.getProductVatTotal(sale) : 0;
        },

        getCartVatTotal: function (sale) {
            return PharmaFlow.getCartVatTotal ? PharmaFlow.getCartVatTotal(sale) : 0;
        },

        getTotalVat: function (sale) {
            return PharmaFlow.getTotalVat ? PharmaFlow.getTotalVat(sale) : 0;
        },

        formatVatCell: function (sale, kind) {
            if (PharmaFlow.formatSaleVatDisplay) {
                return PharmaFlow.formatSaleVatDisplay(sale, kind || 'total');
            }
            const total = this.getTotalVat(sale);
            if (total <= 0) return '—';
            return this.formatCurrency(total);
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
                        <div class="page-header-right as-header-actions">
                            ${PharmaFlow.vatFormatSelectHtml ? PharmaFlow.vatFormatSelectHtml('as-vat-format', 'VAT view', 'compact') : ''}
                            <button type="button" class="btn btn-sm btn-outline" id="as-export-btn" aria-haspopup="true" aria-expanded="false">
                                <i class="fas fa-file-export"></i> Export
                            </button>
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
                                <option value="split">Split</option>
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
                                    <th>Product VAT</th>
                                    <th>Sale VAT</th>
                                    <th>Total VAT</th>
                                    <th>Total</th>
                                    <th>Profit</th>
                                    <th>Payment</th>
                                    <th>Status</th>
                                    <th>Cashier</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="as-tbody">
                                <tr><td colspan="16" class="sales-loading"><i class="fas fa-spinner fa-spin"></i> Loading sales...</td></tr>
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

            if (PharmaFlow.bindVatFormatSelect) {
                PharmaFlow.bindVatFormatSelect(document.getElementById('as-vat-format'), function () {
                    self.renderCurrentPage();
                });
            }

            const exportBtn = document.getElementById('as-export-btn');
            if (exportBtn) {
                exportBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    self.showExportMenu(exportBtn);
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
                if (payFilter && !PharmaFlow.saleMatchesPaymentFilter(sale, payFilter)) return false;

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
                tbody.innerHTML = '<tr><td colspan="16" class="sales-loading"><i class="fas fa-inbox"></i> No sales found</td></tr>';
                this.renderPagination(0, 0);
                return;
            }

            tbody.innerHTML = pageData.map((sale, i) => {
                const payBadge = this.getPaymentBadge(sale);
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
                    <td class="sales-vat-cell">${this.formatVatCell(sale, 'product')}</td>
                    <td class="sales-vat-cell">${this.formatVatCell(sale, 'cart')}</td>
                    <td class="sales-vat-cell">${this.formatVatCell(sale, 'total')}</td>
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
            if (!(await PharmaFlow.confirm('Cancel this sale? Sold item quantities will be returned to inventory and the sale will be excluded from revenue calculations.', { title: 'Cancel Sale', confirmText: 'Yes, Cancel', danger: true }))) return;
            const businessId = this.getBusinessId();
            if (!businessId) return;
            try {
                const result = await this.updateSaleInventoryStatus(businessId, saleId, 'cancel');
                this.showToast(result?.inventoryAdjusted ? 'Sale cancelled and items returned to inventory.' : 'Sale cancelled.');
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Sale Cancelled',
                        description: 'Sale ' + saleId + (result?.inventoryAdjusted ? ' cancelled and inventory restored' : ' cancelled'),
                        category: 'Pharmacy',
                        status: 'WARNING'
                    });
                }
            } catch (err) {
                console.error('Cancel sale error:', err);
                this.showToast(err?.message || 'Failed to cancel sale.', 'error');
            }
        },

        restoreSale: async function (saleId) {
            if (!(await PharmaFlow.confirm('Restore this cancelled sale? Item quantities will be removed from inventory again and the sale will be added back to revenue calculations.', { title: 'Restore Sale', confirmText: 'Yes, Restore' }))) return;
            const businessId = this.getBusinessId();
            if (!businessId) return;
            try {
                const saleDoc = allSalesData.find(s => s.id === saleId);
                const result = await this.updateSaleInventoryStatus(businessId, saleId, 'restore', saleDoc?.previousStatus);
                const restoredStatus = result?.status || saleDoc?.previousStatus || 'completed';
                this.showToast('Sale restored to ' + restoredStatus + (result?.inventoryAdjusted ? ' and inventory updated.' : '.'));
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Sale Restored',
                        description: 'Sale ' + saleId + ' restored to ' + restoredStatus + (result?.inventoryAdjusted ? ' and inventory reduced' : ''),
                        category: 'Pharmacy',
                        status: 'INFO'
                    });
                }
            } catch (err) {
                console.error('Restore sale error:', err);
                this.showToast(err?.message || 'Failed to restore sale.', 'error');
            }
        },

        getPaymentBadge: function (sale) {
            const method = sale && sale.paymentMethod ? sale.paymentMethod : 'cash';
            if (method === 'split') {
                return '<span class="sales-pay-badge pay--split"><i class="fas fa-columns"></i> Split</span>';
            }
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

        closeExportMenu: function () {
            if (!exportMenuState) return;
            const state = exportMenuState;
            exportMenuState = null;
            if (state.closeHandler) document.removeEventListener('click', state.closeHandler);
            if (state.keyHandler) document.removeEventListener('keydown', state.keyHandler);
            if (state.repositionHandler) {
                window.removeEventListener('resize', state.repositionHandler);
                window.removeEventListener('scroll', state.repositionHandler, true);
            }
            if (state.menu && state.menu.parentNode) state.menu.remove();
            if (state.anchorBtn) state.anchorBtn.setAttribute('aria-expanded', 'false');
        },

        positionExportMenu: function (anchorBtn, menu) {
            if (!anchorBtn || !menu) return;
            const rect = anchorBtn.getBoundingClientRect();
            const menuWidth = menu.offsetWidth || 200;
            const left = Math.min(
                Math.max(8, rect.right - menuWidth),
                window.innerWidth - menuWidth - 8
            );
            menu.style.top = (rect.bottom + 6) + 'px';
            menu.style.left = left + 'px';
            menu.style.right = 'auto';
        },

        showExportMenu: function (anchorBtn) {
            if (!anchorBtn) return;

            if (exportMenuState && exportMenuState.anchorBtn === anchorBtn) {
                this.closeExportMenu();
                return;
            }
            this.closeExportMenu();

            const menuId = 'as-export-menu-portal';
            const menu = document.createElement('div');
            menu.className = 'inv-export-menu';
            menu.id = menuId;
            menu.setAttribute('role', 'menu');
            menu.innerHTML = `
                <button type="button" role="menuitem" data-type="excel"><i class="fas fa-file-excel"></i> Export as Excel</button>
                <button type="button" role="menuitem" data-type="pdf"><i class="fas fa-file-pdf"></i> Export as PDF</button>
            `;
            document.body.appendChild(menu);
            this.positionExportMenu(anchorBtn, menu);
            anchorBtn.setAttribute('aria-expanded', 'true');
            requestAnimationFrame(() => menu.classList.add('show'));

            const self = this;
            const repositionHandler = () => self.positionExportMenu(anchorBtn, menu);
            const closeHandler = (e) => {
                if (!menu.contains(e.target) && e.target !== anchorBtn && !anchorBtn.contains(e.target)) {
                    self.closeExportMenu();
                }
            };
            const keyHandler = (e) => {
                if (e.key === 'Escape') self.closeExportMenu();
            };

            exportMenuState = { menu, anchorBtn, closeHandler, keyHandler, repositionHandler };

            menu.querySelector('[data-type="excel"]').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                self.closeExportMenu();
                self.exportExcel();
            });
            menu.querySelector('[data-type="pdf"]').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                self.closeExportMenu();
                self.exportPDF();
            });

            setTimeout(() => document.addEventListener('click', closeHandler), 0);
            document.addEventListener('keydown', keyHandler);
            window.addEventListener('resize', repositionHandler);
            window.addEventListener('scroll', repositionHandler, true);
        },

        buildExportRow: function (sale) {
            const vat = PharmaFlow.getSaleVatBreakdown ? PharmaFlow.getSaleVatBreakdown(sale) : {
                productVat: this.getProductVatTotal(sale),
                cartVat: this.getCartVatTotal(sale),
                totalVat: this.getTotalVat(sale)
            };
            return {
                productVat: vat.productVat,
                cartVat: vat.cartVat,
                totalVat: vat.totalVat,
                status: sale.status || 'completed'
            };
        },

        getExportFileBase: function () {
            const name = (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow').replace(/\s+/g, '');
            return name + '_AllSales_' + new Date().toISOString().split('T')[0];
        },

        exportExcel: function () {
            if (filteredSales.length === 0) {
                this.showToast('No sales to export', 'error');
                return;
            }
            if (typeof XLSX === 'undefined') {
                this.showToast('Excel export is not available. Please refresh the page.', 'error');
                return;
            }

            try {
                const headers = PharmaFlow.SALE_REPORT_HEADERS;
                const vatFormat = PharmaFlow.getVatDisplayFormat ? PharmaFlow.getVatDisplayFormat() : 'ksh_percent';
                const rows = filteredSales.map(sale => {
                    const row = PharmaFlow.buildSaleReportRow(sale, () => sale.saleDateStr || '', { vatFormat: vatFormat });
                    const obj = {};
                    headers.forEach((h, i) => { obj[h] = row[i]; });
                    return obj;
                });

                const ws = XLSX.utils.json_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'All Sales');
                XLSX.writeFile(wb, this.getExportFileBase() + '.xlsx');
                this.showToast('Excel exported!');
            } catch (err) {
                console.error('Excel export error:', err);
                this.showToast('Failed to export Excel.', 'error');
            }
        },

        exportPDF: function () {
            if (filteredSales.length === 0) {
                this.showToast('No sales to export', 'error');
                return;
            }
            if (!window.jspdf || !window.jspdf.jsPDF) {
                this.showToast('PDF export is not available. Please refresh the page.', 'error');
                return;
            }

            try {
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF('landscape');
                const businessName = PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow';
                doc.setFontSize(16);
                doc.text(businessName + ' - All Sales Report', 14, 18);
                doc.setFontSize(10);
                doc.text('Generated: ' + new Date().toLocaleString('en-KE'), 14, 26);
                const vatFormat = PharmaFlow.getVatDisplayFormat ? PharmaFlow.getVatDisplayFormat() : 'ksh_percent';
                const fmtVatNote = vatFormat === 'percent' ? 'VAT shown as %'
                    : (vatFormat === 'ksh' ? 'VAT shown as KSH' : 'VAT shown as KSH with rate in brackets');
                doc.text(fmtVatNote + '. Product VAT = VAT-enabled items. Sale VAT = checkout VAT.', 14, 32);

                const rows = filteredSales.map((sale, i) => {
                    const row = PharmaFlow.buildSaleReportRow
                        ? PharmaFlow.buildSaleReportRow(sale, () => sale.saleDateStr || '', { vatFormat: vatFormat })
                        : null;
                    if (row) {
                        return [i + 1, row[0], row[1], row[2], row[3], this.formatCurrency(row[4]), this.formatCurrency(row[5]), row[6], row[7], row[8], this.formatCurrency(row[9]), this.formatCurrency(row[10]), row[11], row[12]];
                    }
                    const built = this.buildExportRow(sale);
                    return [
                        i + 1,
                        sale.saleId || '',
                        sale.saleDateStr || '',
                        built.status,
                        sale.itemCount || 0,
                        this.formatCurrency(sale.subtotal),
                        this.formatCurrency(sale.discountAmount || 0),
                        PharmaFlow.formatSaleVatDisplay(sale, 'product', vatFormat),
                        PharmaFlow.formatSaleVatDisplay(sale, 'cart', vatFormat),
                        PharmaFlow.formatSaleVatDisplay(sale, 'total', vatFormat),
                        this.formatCurrency(sale.total),
                        this.formatCurrency(sale.totalProfit),
                        this.formatSalePaymentLabel(sale),
                        sale.soldBy || ''
                    ];
                });

                doc.autoTable({
                    startY: 38,
                    head: [[
                        '#', 'Receipt #', 'Date', 'Status', 'Items', 'Subtotal', 'Discount',
                        'Product VAT', 'Sale VAT', 'Total VAT', 'Total', 'Profit', 'Payment', 'Sold By'
                    ]],
                    body: rows,
                    styles: { fontSize: 7, cellPadding: 2 },
                    headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
                    columnStyles: {
                        0: { cellWidth: 8 },
                        7: { halign: 'right' },
                        8: { halign: 'right' },
                        9: { halign: 'right' }
                    }
                });

                doc.save(this.getExportFileBase() + '.pdf');
                this.showToast('PDF exported!');
            } catch (err) {
                console.error('PDF export error:', err);
                this.showToast('Failed to export PDF.', 'error');
            }
        },

        // ─── CLEANUP ─────────────────────────────────────────

        cleanup: function () {
            this.closeExportMenu();
            if (unsubAllSales) { unsubAllSales(); unsubAllSales = null; }
            allSalesData = [];
            filteredSales = [];
        }
    };

    window.PharmaFlow.AllSales = AllSales;
})();
