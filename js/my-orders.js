/**
 * PharmaFlow - My Orders Module
 * Create and manage purchase orders to suppliers.
 * Sub-modules:
 *   - Create Order: Build a new order selecting supplier + inventory items
 *   - Manage Orders: View, approve, receive, and manage all orders
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let ordersListener = null;
    let orderItems = [];          // items in the create-order form
    let inventoryCache = [];      // cached inventory for item picker
    let suppliersCache = [];      // cached suppliers
    let editingOrderId = null;

    // Cursor-based pagination state
    let ordPage = 1;
    let ordPageSize = 25;
    let ordPageData = [];         // current page orders
    let ordFirstDoc = null;       // first doc snapshot of current page
    let ordLastDoc = null;        // last doc snapshot of current page
    let ordPageStack = [];        // stack of startAt cursors for prev pages
    let ordHasNext = false;
    let ordIsLoading = false;
    const SH_PAGE_SIZE = 25;    // stock history page size

    const MyOrders = {

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
            const old = document.querySelector('.ord-toast');
            if (old) old.remove();
            const t = document.createElement('div');
            t.className = 'ord-toast' + (type === 'error' ? ' ord-toast--error' : '');
            t.innerHTML = '<i class="fas ' + (type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle') + '"></i> ' + msg;
            document.body.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
        },

        cleanup: function () {
            if (ordersListener) { ordersListener(); ordersListener = null; }
            ordPageData = [];
            ordFirstDoc = null;
            ordLastDoc = null;
            ordPageStack = [];
            ordPage = 1;
            ordHasNext = false;
            orderItems = [];
            editingOrderId = null;
        },

        generateOrderId: function () {
            const now = new Date();
            const y = String(now.getFullYear()).slice(-2);
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const r = Math.random().toString(36).substring(2, 7).toUpperCase();
            return 'PO-' + y + m + d + '-' + r;
        },

        getLoanStatusFromValues: function (paymentStatus, loanDueDate, outstandingAmount) {
            const outstanding = parseFloat(outstandingAmount) || 0;
            if (paymentStatus === 'paid' || outstanding <= 0) {
                return { key: 'cleared', label: 'Cleared' };
            }

            if (!loanDueDate) {
                return { key: 'no-due-date', label: 'Due date missing' };
            }

            const today = new Date().toISOString().split('T')[0];
            if (loanDueDate < today) {
                return { key: 'overdue', label: 'Overdue (' + loanDueDate + ')' };
            }
            if (loanDueDate === today) {
                return { key: 'due-today', label: 'Due today' };
            }
            return { key: 'upcoming', label: 'Due ' + loanDueDate };
        },

        getPaymentBadge: function (order) {
            const paymentStatus = order.paymentStatus || (order.paymentMode === 'on-loan' ? 'on-loan' : 'paid');
            if (paymentStatus === 'paid') {
                return '<span class="ord-payment-badge ord-payment--paid"><i class="fas fa-check-circle"></i> Paid in Full</span>';
            }
            if (paymentStatus === 'partial') {
                return '<span class="ord-payment-badge ord-payment--partial"><i class="fas fa-circle-half-stroke"></i> Partial Payment</span>';
            }
            return '<span class="ord-payment-badge ord-payment--loan"><i class="fas fa-hand-holding-dollar"></i> On Loan</span>';
        },

        getLoanStatusBadge: function (order) {
            const info = this.getLoanStatusFromValues(order.paymentStatus, order.loanDueDate, order.outstandingAmount);
            const cls = {
                'cleared': 'ord-loan--cleared',
                'upcoming': 'ord-loan--upcoming',
                'due-today': 'ord-loan--due-today',
                'overdue': 'ord-loan--overdue',
                'no-due-date': 'ord-loan--missing'
            }[info.key] || 'ord-loan--upcoming';
            const icon = {
                'cleared': 'fa-circle-check',
                'upcoming': 'fa-calendar-days',
                'due-today': 'fa-hourglass-half',
                'overdue': 'fa-triangle-exclamation',
                'no-due-date': 'fa-circle-question'
            }[info.key] || 'fa-calendar-days';
            return '<span class="ord-loan-badge ' + cls + '"><i class="fas ' + icon + '"></i> ' + info.label + '</span>';
        },

        updatePaymentUi: function () {
            const modeEl = document.getElementById('ord-payment-mode');
            const amountEl = document.getElementById('ord-amount-paid');
            const dueGroup = document.getElementById('ord-loan-due-group');
            const dueEl = document.getElementById('ord-loan-due');
            const summaryEl = document.getElementById('ord-payment-summary');
            if (!modeEl || !amountEl || !dueGroup || !dueEl || !summaryEl) return;

            const mode = modeEl.value || 'fully-paid';
            const total = orderItems.reduce((s, item) => s + (item.unitCost * item.orderQty), 0);

            if (mode === 'fully-paid') {
                amountEl.value = total.toFixed(2);
                amountEl.disabled = true;
                dueGroup.style.display = 'none';
                dueEl.required = false;
                summaryEl.innerHTML = '<span class="ord-pay-summary ord-pay-summary--paid"><i class="fas fa-check-circle"></i> This order will be marked as paid in full.</span>';
            } else {
                amountEl.disabled = false;
                dueGroup.style.display = '';
                dueEl.required = true;
                const paidVal = Math.max(0, parseFloat(amountEl.value) || 0);
                const outstanding = Math.max(0, total - paidVal);
                summaryEl.innerHTML = '<span class="ord-pay-summary ord-pay-summary--loan"><i class="fas fa-wallet"></i> Outstanding: ' + this.formatCurrency(outstanding) + '</span>';
            }
        },

        getItemVatAmount: function (item) {
            if (!item || !item.vatEnabled) return 0;
            const vatValue = parseFloat(item.vatValue) || 0;
            if (vatValue <= 0) return 0;
            if ((item.vatType || 'percent') === 'amount') return vatValue * (item.orderQty || 0);
            const subtotal = (item.unitCost || 0) * (item.orderQty || 0);
            return subtotal * (vatValue / 100);
        },

        getItemLineTotal: function (item) {
            const subtotal = (item.unitCost || 0) * (item.orderQty || 0);
            return subtotal + this.getItemVatAmount(item);
        },

        // ═══════════════════════════════════════════════
        //  CREATE ORDER
        // ═══════════════════════════════════════════════

        renderCreate: function (container) {
            if (ordersListener) { ordersListener(); ordersListener = null; }
            orderItems = [];
            editingOrderId = null;

            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-plus"></i> Create Order</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>My Orders</span>
                                <span>/</span><span>Create Order</span>
                            </div>
                        </div>
                    </div>

                    <div class="ord-create-layout">
                        <!-- Order Details Card -->
                        <div class="ord-card">
                            <div class="ord-card-header"><i class="fas fa-info-circle"></i> Order Details</div>
                            <div class="ord-card-body">
                                <div class="dda-form-row">
                                    <div class="dda-form-group">
                                        <label>Order / Invoice Number</label>
                                        <div class="ord-id-row">
                                            <input type="text" id="ord-order-id" placeholder="Auto-generated if left empty" value="${this.generateOrderId()}">
                                            <button type="button" class="dda-btn dda-btn--export" id="ord-generate-id" title="Generate order number">
                                                <i class="fas fa-wand-magic-sparkles"></i> Auto
                                            </button>
                                        </div>
                                    </div>
                                    <div class="dda-form-group">
                                        <label>Supplier <span class="required">*</span></label>
                                        <select id="ord-supplier">
                                            <option value="">Loading suppliers...</option>
                                        </select>
                                    </div>
                                    <div class="dda-form-group">
                                        <label>Order Date</label>
                                        <input type="date" id="ord-date" value="${new Date().toISOString().split('T')[0]}">
                                    </div>
                                </div>
                                <div class="dda-form-row">
                                    <div class="dda-form-group">
                                        <label>Expected Delivery</label>
                                        <input type="date" id="ord-delivery-date">
                                    </div>
                                    <div class="dda-form-group">
                                        <label>Priority</label>
                                        <select id="ord-priority">
                                            <option value="normal">Normal</option>
                                            <option value="urgent">Urgent</option>
                                            <option value="low">Low</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="dda-form-row">
                                    <div class="dda-form-group">
                                        <label>Payment Type</label>
                                        <select id="ord-payment-mode">
                                            <option value="fully-paid" selected>Paid in Full</option>
                                            <option value="on-loan">On Loan / Credit</option>
                                        </select>
                                    </div>
                                    <div class="dda-form-group">
                                        <label>Amount Paid (KSH)</label>
                                        <input type="number" id="ord-amount-paid" min="0" step="0.01" value="0">
                                    </div>
                                </div>
                                <div class="dda-form-row" id="ord-loan-due-group" style="display:none">
                                    <div class="dda-form-group">
                                        <label>Loan Due Date <span class="required">*</span></label>
                                        <input type="date" id="ord-loan-due">
                                    </div>
                                    <div class="dda-form-group" id="ord-payment-summary"></div>
                                </div>
                                <div class="dda-form-group">
                                    <label>Notes</label>
                                    <textarea id="ord-notes" rows="2" placeholder="Order notes..."></textarea>
                                </div>
                            </div>
                        </div>

                        <!-- Add Items Card -->
                        <div class="ord-card">
                            <div class="ord-card-header"><i class="fas fa-boxes-stacked"></i> Order Items</div>
                            <div class="ord-card-body">
                                <div class="ord-item-picker">
                                    <div class="dda-search-box">
                                        <i class="fas fa-search"></i>
                                        <input type="text" id="ord-item-search" placeholder="Search inventory to add items..." autocomplete="off">
                                    </div>
                                    <div class="ord-search-results" id="ord-search-results" style="display:none"></div>
                                </div>

                                <!-- Items Table -->
                                <div class="dda-table-wrap" style="margin-top:12px">
                                    <table class="dda-table">
                                        <thead>
                                            <tr>
                                                <th>#</th>
                                                <th>Item Name</th>
                                                <th>SKU</th>
                                                <th>Current Stock</th>
                                                <th>Unit Cost</th>
                                                <th>Order Qty</th>
                                                <th>VAT</th>
                                                <th>Line Total</th>
                                                <th></th>
                                            </tr>
                                        </thead>
                                        <tbody id="ord-items-tbody">
                                            <tr><td colspan="9" class="dda-loading"><i class="fas fa-inbox"></i> No items added yet</td></tr>
                                        </tbody>
                                        <tfoot id="ord-items-tfoot" style="display:none">
                                            <tr>
                                                <td colspan="6"></td>
                                                <td><strong>Total:</strong></td>
                                                <td><strong id="ord-items-total">KSH 0.00</strong></td>
                                                <td></td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <!-- Submit -->
                        <div class="ord-submit-bar">
                            <button class="dda-btn dda-btn--cancel" id="ord-clear-btn">
                                <i class="fas fa-times"></i> Clear
                            </button>
                            <button class="dda-btn dda-btn--primary" id="ord-submit-btn">
                                <i class="fas fa-paper-plane"></i> Submit Order
                            </button>
                        </div>

                        <!-- Low / Out of Stock Alert Panel -->
                        <div class="ord-card ord-lowstock-card">
                            <div class="ord-card-header ord-lowstock-header">
                                <span><i class="fas fa-exclamation-triangle"></i> Low & Out of Stock Items</span>
                                <button class="ord-lowstock-toggle" id="ord-lowstock-toggle"><i class="fas fa-chevron-down"></i></button>
                            </div>
                            <div class="ord-card-body ord-lowstock-body" id="ord-lowstock-body">
                                <div class="ord-lowstock-tabs">
                                    <button class="ord-ls-tab active" data-ls="out">Out of Stock</button>
                                    <button class="ord-ls-tab" data-ls="low">Low Stock (&le;10)</button>
                                </div>
                                <div id="ord-lowstock-list" class="ord-lowstock-list">
                                    <div class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading...</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            this.bindCreateEvents(container);
            this.loadSuppliers();
            this.loadInventory();
            this.loadLowStockItems();
        },

        bindCreateEvents: function (container) {
            const searchInput = document.getElementById('ord-item-search');
            if (searchInput) {
                searchInput.addEventListener('input', () => this.searchInventory(searchInput.value));
                searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) this.searchInventory(searchInput.value); });
                document.addEventListener('click', (e) => {
                    const results = document.getElementById('ord-search-results');
                    if (results && !results.contains(e.target) && e.target !== searchInput) {
                        results.style.display = 'none';
                    }
                });
            }

            document.getElementById('ord-submit-btn')?.addEventListener('click', () => this.submitOrder());
            document.getElementById('ord-generate-id')?.addEventListener('click', () => {
                const idEl = document.getElementById('ord-order-id');
                if (idEl) idEl.value = this.generateOrderId();
            });

            document.getElementById('ord-payment-mode')?.addEventListener('change', () => this.updatePaymentUi());
            document.getElementById('ord-amount-paid')?.addEventListener('input', () => this.updatePaymentUi());
            document.getElementById('ord-clear-btn')?.addEventListener('click', () => {
                orderItems = [];
                this.renderOrderItems();
                document.getElementById('ord-notes').value = '';
                const idEl = document.getElementById('ord-order-id');
                if (idEl) idEl.value = this.generateOrderId();
                const modeEl = document.getElementById('ord-payment-mode');
                if (modeEl) modeEl.value = 'fully-paid';
                const dueEl = document.getElementById('ord-loan-due');
                if (dueEl) dueEl.value = '';
                this.updatePaymentUi();
            });

            // Low-stock panel toggle
            document.getElementById('ord-lowstock-toggle')?.addEventListener('click', () => {
                const body = document.getElementById('ord-lowstock-body');
                const icon = document.querySelector('#ord-lowstock-toggle i');
                if (body) {
                    const open = body.style.display !== 'none';
                    body.style.display = open ? 'none' : 'block';
                    if (icon) icon.className = open ? 'fas fa-chevron-right' : 'fas fa-chevron-down';
                }
            });

            // Low-stock tabs
            container.querySelectorAll('.ord-ls-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    container.querySelectorAll('.ord-ls-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    this.renderLowStockList(tab.dataset.ls);
                });
            });

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });

            this.updatePaymentUi();
        },

        loadSuppliers: async function () {
            const businessId = this.getBusinessId();
            if (!businessId) return;

            try {
                suppliersCache = await PharmaFlow.Supplier.fetchSuppliers(businessId);
                const sel = document.getElementById('ord-supplier');
                if (!sel) return;

                if (suppliersCache.length === 0) {
                    sel.innerHTML = '<option value="">No suppliers found — add one first</option>';
                    return;
                }

                sel.innerHTML = '<option value="">Select a supplier</option>' +
                    suppliersCache.map(s => '<option value="' + s.id + '">' + this.escapeHtml(s.name) + (s.category ? ' (' + this.escapeHtml(s.category) + ')' : '') + '</option>').join('');
            } catch (err) {
                console.error('Load suppliers error:', err);
                const sel = document.getElementById('ord-supplier');
                if (sel) sel.innerHTML = '<option value="">Failed to load suppliers</option>';
            }
        },

        loadInventory: async function () {
            const businessId = this.getBusinessId();
            if (!businessId) return;

            try {
                const snap = await getBusinessCollection(businessId, 'inventory').get();
                inventoryCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                inventoryCache.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            } catch (err) {
                console.error('Load inventory error:', err);
            }
        },

        // ═══════════════════════════════════════════════
        //  LOW / OUT OF STOCK
        // ═══════════════════════════════════════════════

        lowStockActiveTab: 'out',

        loadLowStockItems: function () {
            // Wait until inventoryCache is loaded
            const check = () => {
                if (inventoryCache.length > 0 || document.getElementById('ord-lowstock-list') === null) {
                    this.renderLowStockList('out');
                    return;
                }
                setTimeout(check, 300);
            };
            setTimeout(check, 500);
        },

        renderLowStockList: function (tab) {
            this.lowStockActiveTab = tab || 'out';
            const listEl = document.getElementById('ord-lowstock-list');
            if (!listEl) return;

            let items;
            if (this.lowStockActiveTab === 'out') {
                items = inventoryCache.filter(p => (p.quantity || 0) === 0);
            } else {
                items = inventoryCache.filter(p => (p.quantity || 0) > 0 && (p.quantity || 0) <= 10);
            }

            items.sort((a, b) => (a.quantity || 0) - (b.quantity || 0));

            if (items.length === 0) {
                listEl.innerHTML = '<div class="ord-ls-empty"><i class="fas fa-check-circle"></i> No ' + (this.lowStockActiveTab === 'out' ? 'out-of-stock' : 'low-stock') + ' items.</div>';
                return;
            }

            listEl.innerHTML = items.slice(0, 20).map(p => `
                <div class="ord-ls-item">
                    <div class="ord-ls-item-info">
                        <strong>${this.escapeHtml(p.name)}</strong>
                        <small>${this.escapeHtml(p.sku || '')} · ${this.escapeHtml(p.category || '')}</small>
                    </div>
                    <span class="ord-ls-qty ${(p.quantity || 0) === 0 ? 'ord-ls-qty--zero' : 'ord-ls-qty--low'}">${p.quantity || 0}</span>
                    <button class="ord-ls-add-btn" data-id="${p.id}" title="Add to order"><i class="fas fa-plus"></i></button>
                </div>
            `).join('') + (items.length > 20 ? '<div class="ord-ls-empty">+' + (items.length - 20) + ' more items...</div>' : '');

            // Bind quick-add buttons
            listEl.querySelectorAll('.ord-ls-add-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const product = inventoryCache.find(p => p.id === btn.dataset.id);
                    if (product) {
                        const already = orderItems.find(oi => oi.productId === product.id);
                        if (!already) {
                            this.addOrderItem(product);
                            this.showToast(product.name + ' added to order');
                        } else {
                            this.showToast('Already in order', 'error');
                        }
                    }
                });
            });
        },

        searchInventory: function (query) {
            const resultsEl = document.getElementById('ord-search-results');
            if (!resultsEl) return;

            const q = (query || '').toLowerCase().trim();
            if (!q) { resultsEl.style.display = 'none'; return; }

            const addedIds = new Set(orderItems.map(item => item.productId));
            const matches = inventoryCache.filter(p => {
                if (addedIds.has(p.id)) return false;
                const haystack = ((p.name || '') + ' ' + (p.sku || '') + ' ' + (p.category || '')).toLowerCase();
                return haystack.includes(q);
            }).slice(0, 10);

            if (matches.length === 0) {
                resultsEl.innerHTML = '<div class="ord-search-empty">No matching items</div>';
                resultsEl.style.display = 'block';
                return;
            }

            resultsEl.innerHTML = matches.map(p => `
                <div class="ord-search-item" data-id="${p.id}">
                    <div class="ord-search-item-info">
                        <strong>${this.escapeHtml(p.name)}</strong>
                        <small>${this.escapeHtml(p.sku || '')} · Stock: ${p.quantity || 0} · ${this.escapeHtml(p.category || '')}</small>
                    </div>
                    <span class="ord-search-item-price">${this.formatCurrency(p.buyingPrice)}</span>
                </div>
            `).join('');

            resultsEl.style.display = 'block';

            resultsEl.querySelectorAll('.ord-search-item').forEach(el => {
                el.addEventListener('click', () => {
                    const product = inventoryCache.find(p => p.id === el.dataset.id);
                    if (product) this.addOrderItem(product);
                    resultsEl.style.display = 'none';
                    document.getElementById('ord-item-search').value = '';
                });
            });
        },

        addOrderItem: function (product) {
            orderItems.push({
                productId: product.id,
                name: product.name || '',
                sku: product.sku || '',
                category: product.category || '',
                currentStock: product.quantity || 0,
                unitCost: product.buyingPrice || 0,
                orderQty: 1,
                vatEnabled: !!product.vatEnabled,
                vatType: product.vatType || 'percent',
                vatValue: parseFloat(product.vatValue) || 0
            });
            this.renderOrderItems();
        },

        renderOrderItems: function () {
            const tbody = document.getElementById('ord-items-tbody');
            const tfoot = document.getElementById('ord-items-tfoot');
            if (!tbody) return;

            if (orderItems.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" class="dda-loading"><i class="fas fa-inbox"></i> No items added yet</td></tr>';
                if (tfoot) tfoot.style.display = 'none';
                return;
            }

            tbody.innerHTML = orderItems.map((item, i) => {
                const subtotal = (item.unitCost || 0) * (item.orderQty || 0);
                const lineVat = this.getItemVatAmount(item);
                const lineTotal = this.getItemLineTotal(item);
                return `<tr>
                    <td>${i + 1}</td>
                    <td><strong>${this.escapeHtml(item.name)}</strong></td>
                    <td><code>${this.escapeHtml(item.sku)}</code></td>
                    <td>${item.currentStock}</td>
                    <td>
                        <input type="number" class="ord-inline-input ord-cost-input" data-idx="${i}" value="${item.unitCost}" min="0" step="0.01">
                    </td>
                    <td>
                        <input type="number" class="ord-inline-input ord-qty-input" data-idx="${i}" value="${item.orderQty}" min="1">
                    </td>
                    <td>
                        <div class="ord-vat-cell">
                            <select class="ord-inline-input ord-vat-enabled" data-idx="${i}">
                                <option value="false" ${item.vatEnabled ? '' : 'selected'}>No VAT</option>
                                <option value="true" ${item.vatEnabled ? 'selected' : ''}>VAT</option>
                            </select>
                            <input type="number" class="ord-inline-input ord-vat-value" data-idx="${i}" value="${item.vatValue || 0}" min="0" step="0.01" ${item.vatEnabled ? '' : 'disabled'}>
                            <select class="ord-inline-input ord-vat-type" data-idx="${i}" ${item.vatEnabled ? '' : 'disabled'}>
                                <option value="percent" ${(item.vatType || 'percent') === 'percent' ? 'selected' : ''}>%</option>
                                <option value="amount" ${item.vatType === 'amount' ? 'selected' : ''}>KSH</option>
                            </select>
                            <small class="ord-vat-meta">${lineVat > 0 ? ('VAT: ' + this.formatCurrency(lineVat)) : 'VAT: —'}</small>
                        </div>
                    </td>
                    <td class="ord-line-total-cell">
                        <strong class="ord-line-total-main">${this.formatCurrency(lineTotal)}</strong>
                        <small class="ord-line-total-base">Base: ${this.formatCurrency(subtotal)}</small>
                    </td>
                    <td>
                        <button class="sales-action-btn sup-delete ord-remove-item" data-idx="${i}" style="background:#fee2e2;color:#dc2626" title="Remove">
                            <i class="fas fa-times"></i>
                        </button>
                    </td>
                </tr>`;
            }).join('');

            // Bind qty/cost changes
            tbody.querySelectorAll('.ord-qty-input').forEach(input => {
                input.addEventListener('change', () => {
                    const idx = parseInt(input.dataset.idx);
                    orderItems[idx].orderQty = Math.max(1, parseInt(input.value) || 1);
                    this.renderOrderItems();
                });
            });
            tbody.querySelectorAll('.ord-cost-input').forEach(input => {
                input.addEventListener('change', () => {
                    const idx = parseInt(input.dataset.idx);
                    orderItems[idx].unitCost = Math.max(0, parseFloat(input.value) || 0);
                    this.renderOrderItems();
                });
            });
            tbody.querySelectorAll('.ord-vat-enabled').forEach(input => {
                input.addEventListener('change', () => {
                    const idx = parseInt(input.dataset.idx);
                    orderItems[idx].vatEnabled = input.value === 'true';
                    if (!orderItems[idx].vatEnabled) {
                        orderItems[idx].vatValue = 0;
                    }
                    this.renderOrderItems();
                });
            });
            tbody.querySelectorAll('.ord-vat-value').forEach(input => {
                input.addEventListener('change', () => {
                    const idx = parseInt(input.dataset.idx);
                    orderItems[idx].vatValue = Math.max(0, parseFloat(input.value) || 0);
                    this.renderOrderItems();
                });
            });
            tbody.querySelectorAll('.ord-vat-type').forEach(input => {
                input.addEventListener('change', () => {
                    const idx = parseInt(input.dataset.idx);
                    orderItems[idx].vatType = input.value || 'percent';
                    this.renderOrderItems();
                });
            });
            tbody.querySelectorAll('.ord-remove-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    orderItems.splice(parseInt(btn.dataset.idx), 1);
                    this.renderOrderItems();
                });
            });

            // Update total
            const total = orderItems.reduce((s, item) => s + this.getItemLineTotal(item), 0);
            const totalEl = document.getElementById('ord-items-total');
            if (totalEl) totalEl.textContent = this.formatCurrency(total);
            if (tfoot) tfoot.style.display = '';
            this.updatePaymentUi();
        },

        submitOrder: async function () {
            const supplierId = document.getElementById('ord-supplier')?.value;
            if (!supplierId) { this.showToast('Please select a supplier.', 'error'); return; }
            if (orderItems.length === 0) { this.showToast('Add at least one item.', 'error'); return; }

            const businessId = this.getBusinessId();
            if (!businessId) { this.showToast('No business assigned.', 'error'); return; }

            const btn = document.getElementById('ord-submit-btn');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...'; }

            try {
                const supplier = suppliersCache.find(s => s.id === supplierId);
                const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
                const typedOrderId = document.getElementById('ord-order-id')?.value?.trim() || '';
                const orderId = typedOrderId || this.generateOrderId();
                const totalAmount = orderItems.reduce((s, item) => s + this.getItemLineTotal(item), 0);
                const totalQty = orderItems.reduce((s, item) => s + item.orderQty, 0);
                const paymentMode = document.getElementById('ord-payment-mode')?.value || 'fully-paid';
                const paidInput = parseFloat(document.getElementById('ord-amount-paid')?.value) || 0;
                const amountPaid = paymentMode === 'fully-paid' ? totalAmount : Math.min(Math.max(paidInput, 0), totalAmount);
                const outstandingAmount = Math.max(0, totalAmount - amountPaid);
                const loanDueDate = paymentMode === 'on-loan' ? (document.getElementById('ord-loan-due')?.value || '') : '';
                const paymentStatus = outstandingAmount <= 0 ? 'paid' : 'on-loan';
                const loanInfo = this.getLoanStatusFromValues(paymentStatus, loanDueDate, outstandingAmount);

                if (orderId.indexOf('/') !== -1) {
                    this.showToast('Order number cannot contain "/".', 'error');
                    return;
                }

                if (paymentMode === 'on-loan' && outstandingAmount > 0 && !loanDueDate) {
                    this.showToast('Please set a loan due date for loan orders.', 'error');
                    return;
                }

                const orderRef = getBusinessCollection(businessId, 'orders').doc(orderId);
                const existing = await orderRef.get();
                if (existing.exists) {
                    this.showToast('Order number already exists. Use another or auto-generate.', 'error');
                    return;
                }

                const orderData = {
                    orderId: orderId,
                    supplierId: supplierId,
                    supplierName: supplier ? supplier.name : 'Unknown',
                    orderDate: document.getElementById('ord-date')?.value || new Date().toISOString().split('T')[0],
                    expectedDelivery: document.getElementById('ord-delivery-date')?.value || '',
                    priority: document.getElementById('ord-priority')?.value || 'normal',
                    notes: document.getElementById('ord-notes')?.value?.trim() || '',
                    items: orderItems.map(item => ({
                        productId: item.productId,
                        name: item.name,
                        sku: item.sku,
                        category: item.category,
                        unitCost: item.unitCost,
                        orderQty: item.orderQty,
                        vatEnabled: !!item.vatEnabled,
                        vatType: item.vatType || 'percent',
                        vatValue: parseFloat(item.vatValue) || 0,
                        lineVat: this.getItemVatAmount(item),
                        lineSubtotal: (item.unitCost || 0) * (item.orderQty || 0),
                        lineTotal: this.getItemLineTotal(item)
                    })),
                    totalAmount: totalAmount,
                    totalItems: orderItems.length,
                    totalQty: totalQty,
                    paymentMode: paymentMode,
                    paymentStatus: paymentStatus,
                    amountPaid: amountPaid,
                    outstandingAmount: outstandingAmount,
                    loanDueDate: loanDueDate,
                    loanStatus: loanInfo.key,
                    status: 'pending',
                    createdBy: profile ? (profile.displayName || profile.email) : 'Unknown',
                    createdByUid: firebase.auth().currentUser ? firebase.auth().currentUser.uid : null,
                    createdAt: new Date().toISOString(),
                    orderTimestamp: firebase.firestore.Timestamp.fromDate(new Date())
                };

                await orderRef.set(orderData);
                this.showToast('Order ' + orderId + ' submitted successfully!');

                // Clear form
                orderItems = [];
                this.renderOrderItems();
                document.getElementById('ord-notes').value = '';
                document.getElementById('ord-supplier').value = '';
                const idEl = document.getElementById('ord-order-id');
                if (idEl) idEl.value = this.generateOrderId();
                const modeEl = document.getElementById('ord-payment-mode');
                if (modeEl) modeEl.value = 'fully-paid';
                const dueEl = document.getElementById('ord-loan-due');
                if (dueEl) dueEl.value = '';
                this.updatePaymentUi();

            } catch (err) {
                console.error('Submit order error:', err);
                this.showToast('Failed to submit order: ' + err.message, 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Order'; }
            }
        },

        // ═══════════════════════════════════════════════
        //  MANAGE ORDERS
        // ═══════════════════════════════════════════════

        renderManage: function (container) {
            orderItems = [];
            editingOrderId = null;

            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-tasks"></i> Manage Orders</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>My Orders</span>
                                <span>/</span><span>Manage Orders</span>
                            </div>
                        </div>
                    </div>

                    <!-- Low Stock Alert Banner -->
                    <div class="ord-lowstock-banner" id="ord-manage-lowstock-banner" style="display:none">
                        <i class="fas fa-exclamation-triangle"></i>
                        <span id="ord-manage-ls-text">0 items are out of stock or running low.</span>
                        <button class="ord-ls-banner-btn" id="ord-manage-ls-btn">Create Order <i class="fas fa-arrow-right"></i></button>
                    </div>

                    <!-- Stats -->
                    <div class="dda-stats">
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon"><i class="fas fa-clipboard-list"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="ord-total">0</span>
                                <span class="dda-stat-label">Total Orders</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--pending"><i class="fas fa-clock"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="ord-pending">0</span>
                                <span class="dda-stat-label">Pending</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-check-circle"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="ord-approved">0</span>
                                <span class="dda-stat-label">Approved</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--revenue"><i class="fas fa-box-open"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="ord-received">0</span>
                                <span class="dda-stat-label">Received</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--danger"><i class="fas fa-times-circle"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="ord-cancelled">0</span>
                                <span class="dda-stat-label">Cancelled</span>
                            </div>
                        </div>
                    </div>

                    <!-- Toolbar -->
                    <div class="dda-toolbar">
                        <div class="dda-search-box">
                            <i class="fas fa-search"></i>
                            <input type="text" id="ord-manage-search" placeholder="Search order ID, supplier...">
                        </div>
                        <div class="dda-toolbar-actions">
                            <select id="ord-status-filter">
                                <option value="">All Status</option>
                                <option value="pending">Pending</option>
                                <option value="approved">Approved</option>
                                <option value="received">Received</option>
                                <option value="cancelled">Cancelled</option>
                            </select>
                            <select id="ord-priority-filter">
                                <option value="">All Priority</option>
                                <option value="urgent">Urgent</option>
                                <option value="normal">Normal</option>
                                <option value="low">Low</option>
                            </select>
                            <select id="ord-page-size" title="Rows per page">
                                <option value="25">25 rows</option>
                                <option value="50">50 rows</option>
                                <option value="100">100 rows</option>
                            </select>
                            <button class="dda-btn dda-btn--export" id="ord-export-pdf">
                                <i class="fas fa-file-pdf"></i> Export PDF
                            </button>
                        </div>
                    </div>

                    <!-- Quick Filters -->
                    <div class="dda-quick-filters">
                        <button class="dda-pill active" data-range="all">All Time</button>
                        <button class="dda-pill" data-range="today">Today</button>
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
                                    <th>Order ID</th>
                                    <th>Date</th>
                                    <th>Supplier</th>
                                    <th>Items</th>
                                    <th>Total Amount</th>
                                    <th>Priority</th>
                                    <th>Status</th>
                                    <th>Payment</th>
                                    <th>Loan Status</th>
                                    <th>Created By</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="ord-manage-tbody">
                                <tr><td colspan="12" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading orders...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="dda-pagination" id="ord-manage-pagination"></div>
                </div>

                <!-- View Order Modal -->
                <div class="dda-modal-overlay" id="ord-view-modal" style="display:none">
                    <div class="dda-modal" style="max-width:680px">
                        <div class="dda-modal-header">
                            <h3><i class="fas fa-clipboard-list"></i> Order Details</h3>
                            <button class="dda-modal-close" id="ord-view-close">&times;</button>
                        </div>
                        <div class="dda-modal-body" id="ord-view-body"></div>
                        <div class="dda-modal-footer">
                            <button class="dda-btn dda-btn--cancel" id="ord-view-close-btn">Close</button>
                        </div>
                    </div>
                </div>
            `;

            this.bindManageEvents(container);
            this._resetOrdersPagination();
            this._loadOrdersPage();
            this._loadOrderStats();
            this.loadManageLowStockBanner();
        },

        bindManageEvents: function (container) {
            let searchTimer = null;
            document.getElementById('ord-manage-search')?.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => { this._resetOrdersPagination(); this._loadOrdersPage(); }, 350);
            });
            document.getElementById('ord-status-filter')?.addEventListener('change', () => { this._resetOrdersPagination(); this._loadOrdersPage(); this._loadOrderStats(); });
            document.getElementById('ord-priority-filter')?.addEventListener('change', () => { this._resetOrdersPagination(); this._loadOrdersPage(); this._loadOrderStats(); });
            document.getElementById('ord-page-size')?.addEventListener('change', (e) => { ordPageSize = parseInt(e.target.value) || 25; this._resetOrdersPagination(); this._loadOrdersPage(); });
            document.getElementById('ord-export-pdf')?.addEventListener('click', () => this.exportOrdersPdf());

            // Quick filters
            container.querySelectorAll('.dda-pill').forEach(pill => {
                pill.addEventListener('click', () => {
                    container.querySelectorAll('.dda-pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                    this.applyQuickRange(pill.dataset.range);
                });
            });

            document.getElementById('ord-view-close')?.addEventListener('click', () => { document.getElementById('ord-view-modal').style.display = 'none'; });
            document.getElementById('ord-view-close-btn')?.addEventListener('click', () => { document.getElementById('ord-view-modal').style.display = 'none'; });

            // Low-stock banner "Create Order" button
            document.getElementById('ord-manage-ls-btn')?.addEventListener('click', () => {
                PharmaFlow.Sidebar.setActive('my-orders', 'create-order');
            });

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });
        },

        quickRange: 'all',

        applyQuickRange: function (range) {
            this.quickRange = range;
            this._resetOrdersPagination();
            this._loadOrdersPage();
            this._loadOrderStats();
        },

        _resetOrdersPagination: function () {
            ordPage = 1;
            ordPageData = [];
            ordFirstDoc = null;
            ordLastDoc = null;
            ordPageStack = [];
            ordHasNext = false;
        },

        _getDateRange: function () {
            const today = new Date();
            const fmt = d => d.toISOString().split('T')[0];
            switch (this.quickRange) {
                case 'today': return { from: fmt(today), to: fmt(today) };
                case 'week': { const ws = new Date(today); ws.setDate(ws.getDate() - ws.getDay()); return { from: fmt(ws), to: fmt(today) }; }
                case 'month': { const ms = new Date(today.getFullYear(), today.getMonth(), 1); return { from: fmt(ms), to: fmt(today) }; }
                case '30': { const d30 = new Date(today); d30.setDate(d30.getDate() - 30); return { from: fmt(d30), to: fmt(today) }; }
                default: return { from: null, to: null };
            }
        },

        _buildOrderQuery: function () {
            const businessId = this.getBusinessId();
            if (!businessId) return null;
            let q = getBusinessCollection(businessId, 'orders');

            const statusFilter = document.getElementById('ord-status-filter')?.value || '';
            const priorityFilter = document.getElementById('ord-priority-filter')?.value || '';
            const range = this._getDateRange();

            if (statusFilter) q = q.where('status', '==', statusFilter);
            if (priorityFilter) q = q.where('priority', '==', priorityFilter);
            if (range.from) q = q.where('orderDate', '>=', range.from);
            if (range.to) q = q.where('orderDate', '<=', range.to);

            q = q.orderBy('orderDate', 'desc');
            return q;
        },

        _loadOrdersPage: async function (direction) {
            if (ordIsLoading) return;
            ordIsLoading = true;

            const tbody = document.getElementById('ord-manage-tbody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="12" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading orders...</td></tr>';

            try {
                let q = this._buildOrderQuery();
                if (!q) { ordIsLoading = false; return; }

                if (direction === 'next' && ordLastDoc) {
                    q = q.startAfter(ordLastDoc);
                } else if (direction === 'prev' && ordPageStack.length > 0) {
                    const prevCursor = ordPageStack.pop();
                    q = q.startAt(prevCursor);
                    ordPage--;
                }

                // Fetch one extra to detect hasNext
                const snap = await q.limit(ordPageSize + 1).get();
                const docs = snap.docs;

                ordHasNext = docs.length > ordPageSize;
                const pageDocs = ordHasNext ? docs.slice(0, ordPageSize) : docs;

                ordPageData = pageDocs.map(d => ({ id: d.id, ...d.data() }));

                // Apply client-side search filter (search text can't be indexed server-side)
                const searchQuery = (document.getElementById('ord-manage-search')?.value || '').toLowerCase().trim();
                if (searchQuery) {
                    ordPageData = ordPageData.filter(o => {
                        const haystack = ((o.orderId || '') + ' ' + (o.supplierName || '') + ' ' + (o.createdBy || '')).toLowerCase();
                        return haystack.includes(searchQuery);
                    });
                }

                if (pageDocs.length > 0) {
                    if (direction === 'next' && ordFirstDoc) {
                        ordPageStack.push(ordFirstDoc);
                        ordPage++;
                    }
                    ordFirstDoc = pageDocs[0];
                    ordLastDoc = pageDocs[pageDocs.length - 1];
                } else {
                    ordFirstDoc = null;
                    ordLastDoc = null;
                }

                this.renderOrdersPage();
            } catch (err) {
                console.error('Load orders page error:', err);
                if (tbody) tbody.innerHTML = '<tr><td colspan="12" class="dda-loading"><i class="fas fa-exclamation-circle"></i> Failed to load orders</td></tr>';
            } finally {
                ordIsLoading = false;
            }
        },

        _loadOrderStats: async function () {
            const businessId = this.getBusinessId();
            if (!businessId) return;
            const el = id => document.getElementById(id);
            const coll = getBusinessCollection(businessId, 'orders');

            try {
                // Use Firestore count() if available (Firebase v9.22+)
                if (typeof coll.count === 'function') {
                    const [total, pending, approved, received, cancelled] = await Promise.all([
                        coll.count().get(),
                        coll.where('status', '==', 'pending').count().get(),
                        coll.where('status', '==', 'approved').count().get(),
                        coll.where('status', '==', 'received').count().get(),
                        coll.where('status', '==', 'cancelled').count().get()
                    ]);
                    if (el('ord-total')) el('ord-total').textContent = total.data().count;
                    if (el('ord-pending')) el('ord-pending').textContent = pending.data().count;
                    if (el('ord-approved')) el('ord-approved').textContent = approved.data().count;
                    if (el('ord-received')) el('ord-received').textContent = received.data().count;
                    if (el('ord-cancelled')) el('ord-cancelled').textContent = cancelled.data().count;
                } else {
                    // Fallback: lightweight status-only fetch with reasonable limit
                    const snap = await coll.orderBy('orderDate', 'desc').limit(10000).get();
                    const orders = snap.docs.map(d => d.data());
                    const suffix = orders.length >= 10000 ? '+' : '';
                    if (el('ord-total')) el('ord-total').textContent = orders.length + suffix;
                    if (el('ord-pending')) el('ord-pending').textContent = orders.filter(o => o.status === 'pending').length;
                    if (el('ord-approved')) el('ord-approved').textContent = orders.filter(o => o.status === 'approved').length;
                    if (el('ord-received')) el('ord-received').textContent = orders.filter(o => o.status === 'received').length;
                    if (el('ord-cancelled')) el('ord-cancelled').textContent = orders.filter(o => o.status === 'cancelled').length;
                }
            } catch (err) {
                console.error('Load order stats error:', err);
            }
        },

        getStatusBadge: function (status) {
            const map = {
                'pending': { cls: 'ord-status--pending', icon: 'fa-clock', label: 'Pending' },
                'approved': { cls: 'ord-status--approved', icon: 'fa-check', label: 'Approved' },
                'received': { cls: 'ord-status--received', icon: 'fa-box-open', label: 'Received' },
                'cancelled': { cls: 'ord-status--cancelled', icon: 'fa-times', label: 'Cancelled' }
            };
            const info = map[status] || map['pending'];
            return '<span class="ord-status-badge ' + info.cls + '"><i class="fas ' + info.icon + '"></i> ' + info.label + '</span>';
        },

        getPriorityBadge: function (priority) {
            const map = {
                'urgent': { cls: 'ord-priority--urgent', label: 'Urgent' },
                'normal': { cls: 'ord-priority--normal', label: 'Normal' },
                'low': { cls: 'ord-priority--low', label: 'Low' }
            };
            const info = map[priority] || map['normal'];
            return '<span class="ord-priority-badge ' + info.cls + '">' + info.label + '</span>';
        },

        renderOrdersPage: function () {
            const tbody = document.getElementById('ord-manage-tbody');
            if (!tbody) return;

            const start = (ordPage - 1) * ordPageSize;

            if (ordPageData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="12" class="dda-loading"><i class="fas fa-inbox"></i> No orders found</td></tr>';
                this.renderPagination();
                return;
            }

            tbody.innerHTML = ordPageData.map((o, i) => {
                const date = o.orderDate || '—';
                const showAddToInv = o.status === 'received' && !o.inventoryAdded;
                return `<tr>
                    <td>${start + i + 1}</td>
                    <td><code class="sales-receipt-code">${this.escapeHtml(o.orderId)}</code></td>
                    <td>${date}</td>
                    <td><strong>${this.escapeHtml(o.supplierName)}</strong></td>
                    <td>${o.totalItems || 0} items (${o.totalQty || 0} units)</td>
                    <td><strong>${this.formatCurrency(o.totalAmount)}</strong></td>
                    <td>${this.getPriorityBadge(o.priority)}</td>
                    <td>${this.getStatusBadge(o.status)}${o.inventoryAdded ? ' <span class="ord-inv-tag"><i class="fas fa-check"></i> Stocked</span>' : ''}</td>
                    <td>${this.getPaymentBadge(o)}</td>
                    <td>${this.getLoanStatusBadge(o)}</td>
                    <td>${this.escapeHtml(o.createdBy || '—')}</td>
                    <td>
                        <button class="sales-action-btn sales-action--view ord-view" data-id="${o.id}" title="View"><i class="fas fa-eye"></i></button>
                        <button class="sales-action-btn ord-print" data-id="${o.id}" title="Print Invoice" style="background:#f0fdf4;color:#16a34a"><i class="fas fa-print"></i></button>
                        ${o.status === 'pending' ? '<button class="sales-action-btn sales-action--approve ord-approve" data-id="' + o.id + '" title="Approve"><i class="fas fa-check"></i></button>' : ''}
                        ${o.status === 'approved' ? '<button class="sales-action-btn ord-receive" data-id="' + o.id + '" title="Mark Received" style="background:#dbeafe;color:#2563eb"><i class="fas fa-box-open"></i></button>' : ''}
                        ${showAddToInv ? '<button class="sales-action-btn ord-add-inv" data-id="' + o.id + '" title="Add to Inventory" style="background:#ecfdf5;color:#059669"><i class="fas fa-warehouse"></i></button>' : ''}
                        ${o.status === 'pending' ? '<button class="sales-action-btn sup-delete ord-cancel" data-id="' + o.id + '" title="Cancel" style="background:#fee2e2;color:#dc2626"><i class="fas fa-times"></i></button>' : ''}
                    </td>
                </tr>`;
            }).join('');

            // Bind actions
            tbody.querySelectorAll('.ord-view').forEach(btn => {
                btn.addEventListener('click', () => {
                    const order = ordPageData.find(o => o.id === btn.dataset.id);
                    if (order) this.viewOrder(order);
                });
            });
            tbody.querySelectorAll('.ord-print').forEach(btn => {
                btn.addEventListener('click', () => {
                    const order = ordPageData.find(o => o.id === btn.dataset.id);
                    if (order) this.printInvoice(order);
                });
            });
            tbody.querySelectorAll('.ord-approve').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await this.updateOrderStatus(btn.dataset.id, 'approved');
                    this._loadOrdersPage();
                    this._loadOrderStats();
                });
            });
            tbody.querySelectorAll('.ord-receive').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await this.receiveOrder(btn.dataset.id);
                    this._loadOrdersPage();
                    this._loadOrderStats();
                });
            });
            tbody.querySelectorAll('.ord-add-inv').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await this.addToInventory(btn.dataset.id);
                    this._loadOrdersPage();
                });
            });
            tbody.querySelectorAll('.ord-cancel').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await this.updateOrderStatus(btn.dataset.id, 'cancelled');
                    this._loadOrdersPage();
                    this._loadOrderStats();
                });
            });

            this.renderPagination();
        },

        updateOrderStatus: async function (docId, newStatus) {
            if (newStatus === 'cancelled' && !(await PharmaFlow.confirm('Cancel this order?', { title: 'Cancel Order', confirmText: 'Yes, Cancel', danger: true }))) return;

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
                await getBusinessCollection(businessId, 'orders').doc(docId).update(updateData);
                this.showToast('Order ' + newStatus + '!');
            } catch (err) {
                console.error('Update order error:', err);
                this.showToast('Failed to update order.', 'error');
            }
        },

        receiveOrder: async function (docId) {
            if (!(await PharmaFlow.confirm('Mark this order as received?', { title: 'Receive Order', confirmText: 'Yes, Received' }))) return;

            const businessId = this.getBusinessId();
            if (!businessId) return;

            try {
                const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
                await getBusinessCollection(businessId, 'orders').doc(docId).update({
                    status: 'received',
                    receivedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    receivedBy: profile ? (profile.displayName || profile.email) : 'Unknown',
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.showToast('Order marked as received. Click \"Add to Inventory\" to update stock.');
            } catch (err) {
                console.error('Receive order error:', err);
                this.showToast('Failed to update order.', 'error');
            }
        },

        markOrderAsPaid: async function (order, paymentMeta) {
            if (!order || !order.id) return;

            const paymentType = String(paymentMeta?.paymentType || 'full').trim().toLowerCase();
            const paidBy = String(paymentMeta?.paidBy || '').trim() || 'Unknown';
            const paymentReference = String(paymentMeta?.paymentReference || '').trim();
            const enteredAmount = Math.max(0, parseFloat(paymentMeta?.amountPaid) || 0);
            if (!paymentReference) {
                this.showToast('Payment reference is required.', 'error');
                return;
            }

            const totalAmount = parseFloat(order.totalAmount) || 0;
            const currentPaid = Math.max(0, parseFloat(order.amountPaid) || 0);
            const currentOutstanding = Math.max(0, parseFloat(order.outstandingAmount) || (totalAmount - currentPaid));

            let paymentThisTime = currentOutstanding;
            let updatedPaid = totalAmount;
            let updatedOutstanding = 0;
            let updatedPaymentStatus = 'paid';
            let updatedLoanStatus = 'cleared';

            if (paymentType === 'partial') {
                if (enteredAmount <= 0) {
                    this.showToast('Enter a valid partial payment amount.', 'error');
                    return;
                }
                paymentThisTime = Math.min(enteredAmount, currentOutstanding);
                updatedPaid = Math.min(totalAmount, currentPaid + paymentThisTime);
                updatedOutstanding = Math.max(totalAmount - updatedPaid, 0);
                updatedPaymentStatus = updatedOutstanding <= 0 ? 'paid' : 'partial';
                updatedLoanStatus = updatedOutstanding <= 0 ? 'cleared' : 'partial';
            }

            if (paymentType === 'full' && currentOutstanding <= 0) {
                this.showToast('This order is already fully paid.', 'error');
                return;
            }

            const confirmText = paymentType === 'partial' ? 'Record this partial payment?' : 'Mark this loan order as paid in full?';
            if (!(await PharmaFlow.confirm(confirmText, { title: 'Mark as Paid', confirmText: 'Yes, Mark Paid' }))) return;

            const businessId = this.getBusinessId();
            if (!businessId) return;

            try {
                const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
                const paymentEntry = {
                    paidAt: new Date().toISOString(),
                    paidBy: paidBy,
                    paymentReference: paymentReference,
                    amount: paymentThisTime,
                    balanceAfter: updatedOutstanding,
                    paymentType: paymentType,
                    status: updatedPaymentStatus,
                    note: paymentType === 'partial' ? 'Partial payment recorded' : 'Loan settled before due date'
                };
                const updateData = {
                    paymentStatus: updatedPaymentStatus,
                    paymentMode: updatedPaymentStatus === 'paid' ? 'fully-paid' : 'on-loan',
                    amountPaid: updatedPaid,
                    outstandingAmount: updatedOutstanding,
                    loanStatus: updatedLoanStatus,
                    paymentReference: paymentReference,
                    paymentHistory: firebase.firestore.FieldValue.arrayUnion(paymentEntry),
                    lastPaymentAt: firebase.firestore.FieldValue.serverTimestamp(),
                    lastPaymentBy: paidBy,
                    lastPaymentReference: paymentReference,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: profile ? (profile.displayName || profile.email) : 'Unknown'
                };

                if (updatedPaymentStatus === 'paid') {
                    updateData.loanClearedAt = firebase.firestore.FieldValue.serverTimestamp();
                    updateData.loanClearedBy = paidBy;
                }

                await getBusinessCollection(businessId, 'orders').doc(order.id).update(updateData);

                order.paymentStatus = updatedPaymentStatus;
                order.paymentMode = updatedPaymentStatus === 'paid' ? 'fully-paid' : 'on-loan';
                order.amountPaid = updatedPaid;
                order.outstandingAmount = updatedOutstanding;
                order.loanStatus = updatedLoanStatus;
                order.paymentReference = paymentReference;
                order.paymentHistory = Array.isArray(order.paymentHistory) ? [...order.paymentHistory, paymentEntry] : [paymentEntry];
                this.showToast(paymentType === 'partial' ? 'Partial payment recorded.' : 'Loan marked as paid in full.');

                const refreshed = ordPageData.find(o => o.id === order.id) || order;
                if (refreshed) {
                    refreshed.paymentStatus = updatedPaymentStatus;
                    refreshed.paymentMode = updatedPaymentStatus === 'paid' ? 'fully-paid' : 'on-loan';
                    refreshed.amountPaid = updatedPaid;
                    refreshed.outstandingAmount = updatedOutstanding;
                    refreshed.loanStatus = updatedLoanStatus;
                    refreshed.paymentReference = paymentReference;
                    refreshed.paymentHistory = order.paymentHistory;
                    this.viewOrder(refreshed);
                }

                this._loadOrdersPage();
                this._loadOrderStats();
            } catch (err) {
                console.error('Mark order as paid error:', err);
                this.showToast('Failed to mark order as paid: ' + err.message, 'error');
            }
        },

        // ═══════════════════════════════════════════════
        //  ADD TO INVENTORY (sorted preview + batch)
        // ═══════════════════════════════════════════════

        addToInventory: async function (docId) {
            let order = ordPageData.find(o => o.id === docId);
            if (!order) {
                // Fetch from Firestore if not on current page
                const businessId = this.getBusinessId();
                if (!businessId) return;
                const snap = await getBusinessCollection(businessId, 'orders').doc(docId).get();
                if (!snap.exists) { this.showToast('Order not found.', 'error'); return; }
                order = { id: snap.id, ...snap.data() };
            }
            if (order.inventoryAdded) { this.showToast('Already added to inventory.', 'error'); return; }

            // Sort items alphabetically by name
            const sortedItems = [...(order.items || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            // Build confirmation preview
            const itemsPreview = sortedItems.map((item, i) =>
                (i + 1) + '. ' + item.name + ' (SKU: ' + item.sku + ') — Qty: ' + item.orderQty + ' × ' + this.formatCurrency(item.unitCost)
            ).join('<br>');

            if (!(await PharmaFlow.confirm('Add these ' + sortedItems.length + ' items to inventory?<br><br>' + itemsPreview + '<br><br>This will increase stock quantities.', { title: 'Add to Inventory', confirmText: 'Yes, Add All' }))) return;

            const businessId = this.getBusinessId();
            if (!businessId) return;

            try {
                const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
                const addedBy = profile ? (profile.displayName || profile.email) : 'Unknown';
                const now = new Date().toISOString();
                let successCount = 0;
                let failCount = 0;

                for (const item of sortedItems) {
                    if (!item.productId) { failCount++; continue; }
                    try {
                        const ref = getBusinessCollection(businessId, 'inventory').doc(item.productId);
                        const invDoc = await ref.get();
                        const qty = parseInt(item.orderQty) || 0;
                        if (qty <= 0) { failCount++; continue; }

                        if (invDoc.exists) {
                            const prevQty = invDoc.data().quantity || 0;
                            await ref.update({
                                quantity: prevQty + qty,
                                buyingPrice: item.unitCost || 0,
                                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                            });

                            // Record stock history
                            await getBusinessCollection(businessId, 'stock_history').add({
                                productId: item.productId,
                                productName: item.name || '',
                                sku: item.sku || '',
                                category: item.category || '',
                                orderId: order.orderId || order.id,
                                supplierName: order.supplierName || '',
                                type: 'order_received',
                                previousQty: prevQty,
                                addedQty: qty,
                                newQty: prevQty + qty,
                                unitCost: item.unitCost || 0,
                                addedBy: addedBy,
                                createdAt: now
                            });
                        } else {
                            // Product was deleted — skip
                            failCount++;
                            continue;
                        }
                        successCount++;
                    } catch (itemErr) {
                        console.error('Add to inventory item error:', item.name, itemErr);
                        failCount++;
                    }
                }

                // Mark order as inventory-added
                await getBusinessCollection(businessId, 'orders').doc(docId).update({
                    inventoryAdded: true,
                    inventoryAddedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    inventoryAddedBy: addedBy,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Order Stock Added to Inventory',
                        description: successCount + ' items from order ' + (order.orderId || '') + ' added to inventory',
                        category: 'Inventory',
                        status: 'COMPLETED',
                        metadata: { orderId: order.orderId, successCount: successCount, failCount: failCount }
                    });
                }

                if (failCount > 0) {
                    this.showToast(successCount + ' items added, ' + failCount + ' failed (product may have been deleted).', 'error');
                } else {
                    this.showToast('All ' + successCount + ' items added to inventory!');
                }
            } catch (err) {
                console.error('Add to inventory error:', err);
                this.showToast('Failed to update inventory: ' + err.message, 'error');
            }
        },

        // ═══════════════════════════════════════════════
        //  MANAGE — LOW STOCK BANNER
        // ═══════════════════════════════════════════════

        loadManageLowStockBanner: async function () {
            const businessId = this.getBusinessId();
            if (!businessId) return;

            try {
                const snap = await getBusinessCollection(businessId, 'inventory').get();
                const allInv = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                const outOfStock = allInv.filter(p => (p.quantity || 0) === 0).length;
                const lowStock = allInv.filter(p => (p.quantity || 0) > 0 && (p.quantity || 0) <= 10).length;
                const total = outOfStock + lowStock;

                const banner = document.getElementById('ord-manage-lowstock-banner');
                const text = document.getElementById('ord-manage-ls-text');
                if (total > 0 && banner && text) {
                    text.textContent = outOfStock + ' out of stock, ' + lowStock + ' low stock items need attention.';
                    banner.style.display = 'flex';
                }
            } catch (err) {
                console.error('Low stock banner error:', err);
            }
        },

        viewOrder: function (order) {
            const modal = document.getElementById('ord-view-modal');
            const body = document.getElementById('ord-view-body');
            if (!modal || !body) return;

            const sortedViewItems = [...(order.items || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            const itemsHtml = sortedViewItems.map((item, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td>${this.escapeHtml(item.name)}</td>
                    <td><code>${this.escapeHtml(item.sku)}</code></td>
                    <td>${item.orderQty}</td>
                    <td>${this.formatCurrency(item.unitCost)}</td>
                    <td><strong>${this.formatCurrency(item.lineTotal)}</strong></td>
                </tr>
            `).join('');

            const showAddBtn = order.status === 'received' && !order.inventoryAdded;
            const showMarkPaidBtn = (order.paymentStatus || (order.paymentMode === 'on-loan' ? 'on-loan' : 'paid')) !== 'paid' && (parseFloat(order.outstandingAmount) || 0) > 0;
            const paymentHistory = Array.isArray(order.paymentHistory) ? [...order.paymentHistory].sort((a, b) => {
                const at = Date.parse(a.paidAt || a.createdAt || 0) || 0;
                const bt = Date.parse(b.paidAt || b.createdAt || 0) || 0;
                return bt - at;
            }) : [];
            const paymentHistoryHtml = paymentHistory.length ? `
                <div class="ord-payment-history-card">
                    <div class="ord-payment-history-title"><i class="fas fa-clock-rotate-left"></i> Payment History</div>
                    <div class="ord-payment-history-list">
                        ${paymentHistory.map(entry => `
                            <div class="ord-payment-history-item">
                                <div class="ord-payment-history-main">
                                    <strong>${this.escapeHtml(entry.paymentReference || 'No reference')}</strong>
                                    <span>${this.escapeHtml(entry.paidBy || 'Unknown')} · ${this.escapeHtml((entry.paymentType || 'full').toUpperCase())} · ${this.escapeHtml(entry.paidAt || '—')}</span>
                                </div>
                                <div class="ord-payment-history-amount">${this.formatCurrency(entry.amount || 0)}${typeof entry.balanceAfter === 'number' ? ' <small style="display:block;font-weight:500;color:var(--text-tertiary)">Balance: ' + this.formatCurrency(entry.balanceAfter) + '</small>' : ''}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>` : '';
            const outstandingAmount = Math.max(0, parseFloat(order.outstandingAmount) || 0);
            const settleLoanHtml = showMarkPaidBtn ? `
                <div class="ord-settle-card">
                    <div class="ord-settle-title"><i class="fas fa-wallet"></i> Settle Loan Early</div>
                    <div class="ord-settle-grid">
                        <div class="dda-form-group">
                            <label>Paid By</label>
                            <input type="text" id="ord-paid-by" value="${this.escapeHtml((PharmaFlow.Auth && PharmaFlow.Auth.userProfile && (PharmaFlow.Auth.userProfile.displayName || PharmaFlow.Auth.userProfile.email)) || 'Unknown')}" placeholder="Name of person who paid">
                        </div>
                        <div class="dda-form-group">
                            <label>Payment Reference <span class="required">*</span></label>
                            <input type="text" id="ord-payment-ref" placeholder="Enter manual payment reference">
                        </div>
                        <div class="dda-form-group">
                            <label>Payment Type</label>
                            <select id="ord-payment-settle-mode">
                                <option value="full" selected>Pay Full Balance</option>
                                <option value="partial">Partial Payment</option>
                            </select>
                        </div>
                        <div class="dda-form-group">
                            <label>Amount Paid (KSH)</label>
                            <input type="number" id="ord-payment-amount" min="0" step="0.01" value="${outstandingAmount.toFixed(2)}">
                        </div>
                    </div>
                    <div class="ord-settle-note" id="ord-settle-note">Outstanding balance: <strong>${this.formatCurrency(outstandingAmount)}</strong></div>
                    <div class="ord-settle-actions">
                        <button class="dda-btn btn-success" id="ord-modal-mark-paid"><i class="fas fa-circle-check"></i> Mark as Paid</button>
                    </div>
                </div>` : '';

            body.innerHTML = `
                <div class="dda-view-details">
                    <div class="dda-view-row"><span class="dda-view-label">Order ID</span><span class="dda-view-value"><code class="sales-receipt-code">${this.escapeHtml(order.orderId)}</code></span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Supplier</span><span class="dda-view-value"><strong>${this.escapeHtml(order.supplierName)}</strong></span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Order Date</span><span class="dda-view-value">${order.orderDate || '—'}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Expected Delivery</span><span class="dda-view-value">${order.expectedDelivery || '—'}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Priority</span><span class="dda-view-value">${this.getPriorityBadge(order.priority)}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Status</span><span class="dda-view-value">${this.getStatusBadge(order.status)}${order.inventoryAdded ? ' <span class="ord-inv-tag"><i class="fas fa-check"></i> Added to Inventory</span>' : ''}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Payment</span><span class="dda-view-value">${this.getPaymentBadge(order)}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Loan Status</span><span class="dda-view-value">${this.getLoanStatusBadge(order)}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Amount Paid</span><span class="dda-view-value">${this.formatCurrency(order.amountPaid || 0)}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Outstanding</span><span class="dda-view-value"><strong>${this.formatCurrency(order.outstandingAmount || 0)}</strong></span></div>
                    ${order.loanDueDate ? '<div class="dda-view-row"><span class="dda-view-label">Loan Due Date</span><span class="dda-view-value">' + order.loanDueDate + '</span></div>' : ''}
                    <div class="dda-view-row"><span class="dda-view-label">Created By</span><span class="dda-view-value">${this.escapeHtml(order.createdBy || '—')}</span></div>
                    ${order.approvedBy ? '<div class="dda-view-row"><span class="dda-view-label">Approved By</span><span class="dda-view-value">' + this.escapeHtml(order.approvedBy) + '</span></div>' : ''}
                    ${order.receivedBy ? '<div class="dda-view-row"><span class="dda-view-label">Received By</span><span class="dda-view-value">' + this.escapeHtml(order.receivedBy) + '</span></div>' : ''}
                    ${order.inventoryAddedBy ? '<div class="dda-view-row"><span class="dda-view-label">Stocked By</span><span class="dda-view-value">' + this.escapeHtml(order.inventoryAddedBy) + '</span></div>' : ''}
                    ${order.notes ? '<div class="dda-view-row"><span class="dda-view-label">Notes</span><span class="dda-view-value">' + this.escapeHtml(order.notes) + '</span></div>' : ''}
                    <div class="dda-view-row"><span class="dda-view-label">Total Amount</span><span class="dda-view-value"><strong>${this.formatCurrency(order.totalAmount)}</strong></span></div>
                </div>
                ${settleLoanHtml}
                ${paymentHistoryHtml}
                <h4 style="margin:18px 0 10px;font-size:0.88rem;color:var(--text-secondary)"><i class="fas fa-list"></i> Order Items (sorted A-Z)</h4>
                <div class="dda-table-wrap">
                    <table class="dda-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Item</th>
                                <th>SKU</th>
                                <th>Qty</th>
                                <th>Unit Cost</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>
                </div>
            `;

            // Update modal footer with action buttons
            const footer = modal.querySelector('.dda-modal-footer');
            if (footer) {
                footer.innerHTML = `
                    <button class="dda-btn dda-btn--cancel" id="ord-view-close-btn">Close</button>
                    <button class="dda-btn dda-btn--export" id="ord-modal-print"><i class="fas fa-print"></i> Print Invoice</button>
                    ${showAddBtn ? '<button class="dda-btn dda-btn--primary" id="ord-modal-add-inv"><i class="fas fa-warehouse"></i> Add to Inventory</button>' : ''}
                `;
                footer.querySelector('#ord-view-close-btn')?.addEventListener('click', () => { modal.style.display = 'none'; });
                footer.querySelector('#ord-modal-print')?.addEventListener('click', () => this.printInvoice(order));
                footer.querySelector('#ord-modal-add-inv')?.addEventListener('click', () => {
                    modal.style.display = 'none';
                    this.addToInventory(order.id);
                });
            }

            if (showMarkPaidBtn) {
                const settleModeEl = document.getElementById('ord-payment-settle-mode');
                const settleAmountEl = document.getElementById('ord-payment-amount');
                const settleNoteEl = document.getElementById('ord-settle-note');

                const syncSettleUi = () => {
                    if (!settleModeEl || !settleAmountEl || !settleNoteEl) return;
                    const isPartial = settleModeEl.value === 'partial';
                    settleAmountEl.disabled = !isPartial;
                    if (!isPartial) {
                        settleAmountEl.value = outstandingAmount.toFixed(2);
                        settleNoteEl.innerHTML = 'Outstanding balance: <strong>' + this.formatCurrency(outstandingAmount) + '</strong>';
                    } else {
                        settleNoteEl.innerHTML = 'Enter the amount paid now. Remaining balance will stay on loan.';
                    }
                };

                settleModeEl?.addEventListener('change', syncSettleUi);
                syncSettleUi();

                document.getElementById('ord-modal-mark-paid')?.addEventListener('click', () => {
                    const paidBy = document.getElementById('ord-paid-by')?.value || '';
                    const paymentReference = document.getElementById('ord-payment-ref')?.value || '';
                    const paymentType = document.getElementById('ord-payment-settle-mode')?.value || 'full';
                    const amountPaid = document.getElementById('ord-payment-amount')?.value || '';
                    this.markOrderAsPaid(order, { paidBy, paymentReference, paymentType, amountPaid });
                });
            }

            modal.style.display = 'flex';
        },

        // ═══════════════════════════════════════════════
        //  PAGINATION
        // ═══════════════════════════════════════════════

        renderPagination: function () {
            const container = document.getElementById('ord-manage-pagination');
            if (!container) return;

            const hasPrev = ordPage > 1;
            const hasNext = ordHasNext;
            const count = ordPageData.length;
            const start = (ordPage - 1) * ordPageSize + 1;
            const end = start + count - 1;

            if (!hasPrev && !hasNext && count <= ordPageSize) {
                container.innerHTML = count > 0 ? `<span class="dda-page-info">Showing ${count} order${count !== 1 ? 's' : ''} &mdash; Page ${ordPage}</span>` : '';
                return;
            }

            container.innerHTML = `
                <span class="dda-page-info">Page ${ordPage} &middot; Showing ${count > 0 ? start + '-' + end : '0'} orders</span>
                <div class="dda-page-controls">
                    <button class="dda-page-btn" id="ord-prev-page" ${!hasPrev ? 'disabled' : ''}><i class="fas fa-chevron-left"></i> Prev</button>
                    <span class="dda-page-btn active" style="cursor:default">${ordPage}</span>
                    <button class="dda-page-btn" id="ord-next-page" ${!hasNext ? 'disabled' : ''}>Next <i class="fas fa-chevron-right"></i></button>
                </div>
            `;

            document.getElementById('ord-prev-page')?.addEventListener('click', () => {
                if (hasPrev) this._loadOrdersPage('prev');
            });
            document.getElementById('ord-next-page')?.addEventListener('click', () => {
                if (hasNext) this._loadOrdersPage('next');
            });
        },

        // ═══════════════════════════════════════════════
        //  EXPORT
        // ═══════════════════════════════════════════════

        // ═══════════════════════════════════════════════
        //  PRINT INVOICE
        // ═══════════════════════════════════════════════

        printInvoice: function (order) {
            // Fetch supplier details for the invoice
            const businessId = this.getBusinessId();
            const self = this;

            const doPrint = function (supplierData) {
                const sortedItems = [...(order.items || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

                const itemsRows = sortedItems.map((item, i) =>
                    '<tr>' +
                    '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">' + (i + 1) + '</td>' +
                    '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">' + self.escapeHtml(item.name) + '</td>' +
                    '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-family:monospace">' + self.escapeHtml(item.sku) + '</td>' +
                    '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center">' + item.orderQty + '</td>' +
                    '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">' + self.formatCurrency(item.unitCost) + '</td>' +
                    '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">' +
                    (item.vatEnabled ? ((item.vatType === 'amount' ? self.formatCurrency(item.vatValue || 0) : ((item.vatValue || 0) + '%')) + ' (' + self.formatCurrency(item.lineVat || 0) + ')') : '—') +
                    '</td>' +
                    '<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">' + self.formatCurrency(item.lineTotal) + '</td>' +
                    '</tr>'
                ).join('');

                const supplierBlock = supplierData ?
                    '<div style="margin-bottom:20px;padding:12px 16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">' +
                    '<h3 style="margin:0 0 8px;font-size:14px;color:#4f46e5">Supplier Details</h3>' +
                    '<table style="font-size:13px;color:#374151">' +
                    '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Name:</td><td>' + self.escapeHtml(supplierData.name) + '</td></tr>' +
                    (supplierData.contactPerson ? '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Contact:</td><td>' + self.escapeHtml(supplierData.contactPerson) + '</td></tr>' : '') +
                    (supplierData.phone ? '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Phone:</td><td>' + self.escapeHtml(supplierData.phone) + '</td></tr>' : '') +
                    (supplierData.email ? '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Email:</td><td>' + self.escapeHtml(supplierData.email) + '</td></tr>' : '') +
                    (supplierData.location ? '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Location:</td><td>' + self.escapeHtml(supplierData.location) + '</td></tr>' : '') +
                    (supplierData.category ? '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Category:</td><td>' + self.escapeHtml(supplierData.category) + '</td></tr>' : '') +
                    '</table></div>' :
                    '<p style="color:#6b7280">Supplier: <strong>' + self.escapeHtml(order.supplierName) + '</strong></p>';

                const statusColor = { pending: '#92400e', approved: '#065f46', received: '#1e40af', cancelled: '#991b1b' };
                const printHtml = '<!DOCTYPE html><html><head><title>Invoice - ' + self.escapeHtml(order.orderId) + '</title>' +
                    '<style>@media print { body { margin: 0; } .no-print { display: none !important; } }</style></head><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:800px;margin:0 auto;padding:30px;color:#1f2937">' +
                    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;border-bottom:3px solid #4f46e5;padding-bottom:16px">' +
                    '<div><h1 style="margin:0;font-size:24px;color:#4f46e5">' + (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + '</h1><p style="margin:4px 0 0;color:#6b7280;font-size:13px">Purchase Order Invoice</p></div>' +
                    '<div style="text-align:right"><h2 style="margin:0;font-size:18px">' + self.escapeHtml(order.orderId) + '</h2>' +
                    '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;background:' + (statusColor[order.status] || '#6b7280') + '22;color:' + (statusColor[order.status] || '#6b7280') + '">' + (order.status || 'pending').toUpperCase() + '</span></div></div>' +
                    '<div style="display:flex;gap:20px;margin-bottom:20px">' +
                    '<div style="flex:1">' + supplierBlock + '</div>' +
                    '<div style="flex:1;padding:12px 16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">' +
                    '<h3 style="margin:0 0 8px;font-size:14px;color:#4f46e5">Order Info</h3>' +
                    '<table style="font-size:13px;color:#374151">' +
                    '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Date:</td><td>' + (order.orderDate || '—') + '</td></tr>' +
                    '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Expected Delivery:</td><td>' + (order.expectedDelivery || '—') + '</td></tr>' +
                    '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Priority:</td><td>' + (order.priority || 'normal').toUpperCase() + '</td></tr>' +
                    '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Payment:</td><td>' + ((order.paymentStatus || (order.paymentMode === 'on-loan' ? 'on-loan' : 'paid')) === 'paid' ? 'PAID IN FULL' : 'ON LOAN') + '</td></tr>' +
                    (order.loanDueDate ? '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Loan Due:</td><td>' + order.loanDueDate + '</td></tr>' : '') +
                    '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Amount Paid:</td><td>' + self.formatCurrency(order.amountPaid || 0) + '</td></tr>' +
                    '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Outstanding:</td><td>' + self.formatCurrency(order.outstandingAmount || 0) + '</td></tr>' +
                    '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Created By:</td><td>' + self.escapeHtml(order.createdBy || '—') + '</td></tr>' +
                    (order.approvedBy ? '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Approved By:</td><td>' + self.escapeHtml(order.approvedBy) + '</td></tr>' : '') +
                    (order.receivedBy ? '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Received By:</td><td>' + self.escapeHtml(order.receivedBy) + '</td></tr>' : '') +
                    (order.notes ? '<tr><td style="padding:2px 12px 2px 0;font-weight:600">Notes:</td><td>' + self.escapeHtml(order.notes) + '</td></tr>' : '') +
                    '</table></div></div>' +
                    '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:4px">' +
                    '<thead><tr style="background:#4f46e5;color:#fff">' +
                    '<th style="padding:8px 10px;text-align:left">#</th>' +
                    '<th style="padding:8px 10px;text-align:left">Item</th>' +
                    '<th style="padding:8px 10px;text-align:left">SKU</th>' +
                    '<th style="padding:8px 10px;text-align:center">Qty</th>' +
                    '<th style="padding:8px 10px;text-align:right">Unit Cost</th>' +
                    '<th style="padding:8px 10px;text-align:right">VAT</th>' +
                    '<th style="padding:8px 10px;text-align:right">Total</th>' +
                    '</tr></thead>' +
                    '<tbody>' + itemsRows + '</tbody>' +
                    '<tfoot><tr style="background:#f1f5f9"><td colspan="4"></td><td style="padding:10px;text-align:right;font-weight:700;font-size:14px">Grand Total:</td><td style="padding:10px;text-align:right;font-weight:700;font-size:14px;color:#4f46e5">' + self.formatCurrency(order.totalAmount) + '</td></tr></tfoot>' +
                    '</table>' +
                    '<div style="margin-top:30px;text-align:center;color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:12px">' +
                    'Generated by ' + (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + ' on ' + new Date().toLocaleString('en-KE') + '</div>' +
                    '<div class="no-print" style="text-align:center;margin-top:20px"><button onclick="window.print()" style="padding:10px 28px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">Print Invoice</button></div>' +
                    '</body></html>';

                const printWin = window.open('', '_blank', 'width=850,height=700');
                if (printWin) {
                    printWin.document.write(printHtml);
                    printWin.document.close();
                }
            };

            // Try to fetch full supplier data
            if (businessId && order.supplierId) {
                getBusinessCollection(businessId, 'suppliers').doc(order.supplierId).get()
                    .then(doc => doPrint(doc.exists ? doc.data() : null))
                    .catch(() => doPrint(null));
            } else {
                doPrint(null);
            }
        },

        // ═══════════════════════════════════════════════
        //  EXPORT
        // ═══════════════════════════════════════════════

        exportOrdersPdf: function () {
            const { jsPDF } = window.jspdf;
            if (!jsPDF) { this.showToast('PDF library not loaded.', 'error'); return; }
            const doc = new jsPDF('l', 'mm', 'a4');

            doc.setFontSize(16);
            doc.text('Purchase Orders Report', 14, 18);
            doc.setFontSize(9);
            doc.text('Generated: ' + new Date().toLocaleString('en-KE'), 14, 24);
            doc.text('Total Orders: ' + ordPageData.length + ' (current page)', 14, 29);

            const rows = ordPageData.map((o, i) => [
                i + 1,
                o.orderId || '',
                o.orderDate || '',
                o.supplierName || '',
                (o.totalItems || 0) + ' items',
                this.formatCurrency(o.totalAmount),
                o.priority || 'normal',
                o.status || 'pending',
                (o.paymentStatus || (o.paymentMode === 'on-loan' ? 'on-loan' : 'paid')) === 'paid' ? 'Paid in Full' : 'On Loan',
                this.getLoanStatusFromValues(o.paymentStatus || (o.paymentMode === 'on-loan' ? 'on-loan' : 'paid'), o.loanDueDate, o.outstandingAmount).label,
                o.createdBy || ''
            ]);

            doc.autoTable({
                startY: 34,
                head: [['#', 'Order ID', 'Date', 'Supplier', 'Items', 'Amount', 'Priority', 'Status', 'Payment', 'Loan Status', 'Created By']],
                body: rows,
                styles: { fontSize: 8, cellPadding: 2 },
                headStyles: { fillColor: [79, 70, 229], textColor: 255 }
            });

            doc.save('Orders_' + new Date().toISOString().split('T')[0] + '.pdf');
            this.showToast('Orders PDF exported!');
        },

        // ═══════════════════════════════════════════════
        //  ORDER HISTORY
        // ═══════════════════════════════════════════════

        renderOrderHistory: function (container) {
            orderItems = [];
            editingOrderId = null;

            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-history"></i> Order History</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>My Orders</span>
                                <span>/</span><span>Order History</span>
                            </div>
                        </div>
                    </div>

                    <div class="dda-toolbar">
                        <div class="dda-search-box">
                            <i class="fas fa-search"></i>
                            <input type="text" id="ord-hist-search" placeholder="Search order ID, supplier...">
                        </div>
                    </div>

                    <div id="ord-hist-timeline" class="ord-history-timeline">
                        <div class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading order history...</div>
                    </div>
                </div>
            `;

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });

            this._loadOrderHistory();

            const search = document.getElementById('ord-hist-search');
            if (search) search.addEventListener('input', () => this._renderOrderTimeline(search.value.toLowerCase().trim()));
        },

        _orderHistoryData: [],

        _loadOrderHistory: function () {
            var self = this;
            var businessId = this.getBusinessId();
            if (!businessId) return;

            getBusinessCollection(businessId, 'orders')
                .where('status', 'in', ['received', 'approved', 'cancelled'])
                .get()
                .then(function (snap) {
                    self._orderHistoryData = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
                    self._orderHistoryData.sort(function (a, b) {
                        var ta = a.orderTimestamp && a.orderTimestamp.toDate ? a.orderTimestamp.toDate().getTime() : 0;
                        var tb = b.orderTimestamp && b.orderTimestamp.toDate ? b.orderTimestamp.toDate().getTime() : 0;
                        return tb - ta;
                    });
                    self._renderOrderTimeline('');
                })
                .catch(function (err) {
                    console.error('Order history load error:', err);
                    var el = document.getElementById('ord-hist-timeline');
                    if (el) el.innerHTML = '<div class="dda-loading"><i class="fas fa-exclamation-circle"></i> Failed to load order history</div>';
                });
        },

        _renderOrderTimeline: function (query) {
            var el = document.getElementById('ord-hist-timeline');
            if (!el) return;
            var self = this;

            var data = this._orderHistoryData;
            if (query) {
                data = data.filter(function (o) {
                    var h = ((o.orderId || '') + ' ' + (o.supplierName || '') + ' ' + (o.createdBy || '')).toLowerCase();
                    return h.indexOf(query) !== -1;
                });
            }

            if (data.length === 0) {
                el.innerHTML = '<div class="dda-loading"><i class="fas fa-inbox"></i> No order history found</div>';
                return;
            }

            // Group by month
            var groups = {};
            data.forEach(function (o) {
                var d = o.orderTimestamp && o.orderTimestamp.toDate ? o.orderTimestamp.toDate() : new Date(o.createdAt || 0);
                var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                var label = d.toLocaleDateString('en-KE', { year: 'numeric', month: 'long' });
                if (!groups[key]) groups[key] = { label: label, orders: [] };
                groups[key].orders.push(o);
            });

            var html = '';
            Object.keys(groups).sort().reverse().forEach(function (key) {
                var g = groups[key];
                html += '<div class="ord-hist-month">';
                html += '<div class="ord-hist-month-header"><i class="fas fa-calendar-alt"></i> ' + g.label + ' <span class="ord-hist-count">(' + g.orders.length + ' orders)</span></div>';
                g.orders.forEach(function (o) {
                    var d = o.orderTimestamp && o.orderTimestamp.toDate ? o.orderTimestamp.toDate() : new Date(o.createdAt || 0);
                    var dateStr = d.toLocaleDateString('en-KE', { month: 'short', day: 'numeric' });
                    var statusCls = o.status === 'received' ? 'ord-hist--received' : o.status === 'cancelled' ? 'ord-hist--cancelled' : 'ord-hist--approved';
                    var invTag = o.inventoryAdded ? '<span class="ord-inv-tag"><i class="fas fa-check"></i> Stocked</span>' : '';

                    var itemsList = (o.items || []).map(function (it) {
                        return '<span class="ord-hist-drug">' + self.escapeHtml(it.name) + ' ×' + (it.orderQty || 0) + '</span>';
                    }).join('');

                    html += '<div class="ord-hist-item ' + statusCls + '">';
                    html += '  <div class="ord-hist-dot"></div>';
                    html += '  <div class="ord-hist-card">';
                    html += '    <div class="ord-hist-card-header">';
                    html += '      <div><code class="sales-receipt-code">' + self.escapeHtml(o.orderId || '') + '</code> ' + invTag + '</div>';
                    html += '      <span class="ord-hist-date">' + dateStr + '</span>';
                    html += '    </div>';
                    html += '    <div class="ord-hist-card-body">';
                    html += '      <div class="ord-hist-supplier"><i class="fas fa-truck"></i> ' + self.escapeHtml(o.supplierName || 'Unknown') + '</div>';
                    html += '      <div class="ord-hist-drugs">' + itemsList + '</div>';
                    html += '    </div>';
                    html += '    <div class="ord-hist-card-footer">';
                    html += '      <span><i class="fas fa-boxes-stacked"></i> ' + (o.totalItems || 0) + ' items · ' + (o.totalQty || 0) + ' units</span>';
                    html += '      <strong>' + self.formatCurrency(o.totalAmount) + '</strong>';
                    html += '    </div>';
                    html += '  </div>';
                    html += '</div>';
                });
                html += '</div>';
            });

            el.innerHTML = html;
        },

        // ═══════════════════════════════════════════════
        //  STOCK HISTORY (Inventory additions over time)
        // ═══════════════════════════════════════════════

        renderStockHistory: function (container) {
            orderItems = [];

            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-layer-group"></i> Stock History</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>My Orders</span>
                                <span>/</span><span>Stock History</span>
                            </div>
                        </div>
                    </div>

                    <div class="dda-stats">
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon"><i class="fas fa-layer-group"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="sh-total-entries">0</span>
                                <span class="dda-stat-label">Total Entries</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-cubes"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="sh-total-units">0</span>
                                <span class="dda-stat-label">Total Units Added</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--revenue"><i class="fas fa-box-open"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="sh-products-restocked">0</span>
                                <span class="dda-stat-label">Products Restocked</span>
                            </div>
                        </div>
                    </div>

                    <div class="dda-toolbar">
                        <div class="dda-search-box">
                            <i class="fas fa-search"></i>
                            <input type="text" id="sh-search" placeholder="Search product, order, supplier...">
                        </div>
                    </div>

                    <div class="dda-table-wrap">
                        <table class="dda-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Date</th>
                                    <th>Product</th>
                                    <th>SKU</th>
                                    <th>Order</th>
                                    <th>Supplier</th>
                                    <th>Previous Qty</th>
                                    <th>Added</th>
                                    <th>New Qty</th>
                                    <th>Unit Cost</th>
                                    <th>Added By</th>
                                </tr>
                            </thead>
                            <tbody id="sh-tbody">
                                <tr><td colspan="11" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading stock history...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <div class="dda-pagination" id="sh-pagination"></div>
                </div>
            `;

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });

            this._loadStockHistory();

            const search = document.getElementById('sh-search');
            if (search) search.addEventListener('input', () => {
                this._shCurrentPage = 1;
                this._filterStockHistory(search.value.toLowerCase().trim());
            });
        },

        _shAllData: [],
        _shFilteredData: [],
        _shCurrentPage: 1,

        _loadStockHistory: function () {
            var self = this;
            var businessId = this.getBusinessId();
            if (!businessId) return;

            getBusinessCollection(businessId, 'stock_history')
                .get()
                .then(function (snap) {
                    self._shAllData = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
                    self._shAllData.sort(function (a, b) {
                        return (b.createdAt || '').localeCompare(a.createdAt || '');
                    });
                    self._updateStockHistoryStats();
                    self._filterStockHistory('');
                })
                .catch(function (err) {
                    console.error('Stock history load error:', err);
                    var tbody = document.getElementById('sh-tbody');
                    if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="dda-loading"><i class="fas fa-exclamation-circle"></i> Failed to load stock history</td></tr>';
                });
        },

        _updateStockHistoryStats: function () {
            var data = this._shAllData;
            var el = function (id) { return document.getElementById(id); };
            if (el('sh-total-entries')) el('sh-total-entries').textContent = data.length;
            if (el('sh-total-units')) el('sh-total-units').textContent = data.reduce(function (s, d) { return s + (d.addedQty || 0); }, 0);
            var products = new Set();
            data.forEach(function (d) { if (d.productId) products.add(d.productId); });
            if (el('sh-products-restocked')) el('sh-products-restocked').textContent = products.size;
        },

        _filterStockHistory: function (query) {
            if (query) {
                this._shFilteredData = this._shAllData.filter(function (d) {
                    var h = ((d.productName || '') + ' ' + (d.sku || '') + ' ' + (d.orderId || '') + ' ' + (d.supplierName || '') + ' ' + (d.addedBy || '')).toLowerCase();
                    return h.indexOf(query) !== -1;
                });
            } else {
                this._shFilteredData = this._shAllData.slice();
            }
            this._renderStockHistoryPage();
        },

        _renderStockHistoryPage: function () {
            var tbody = document.getElementById('sh-tbody');
            if (!tbody) return;
            var self = this;
            var data = this._shFilteredData;
            var start = (this._shCurrentPage - 1) * SH_PAGE_SIZE;
            var page = data.slice(start, start + SH_PAGE_SIZE);

            if (page.length === 0) {
                tbody.innerHTML = '<tr><td colspan="11" class="dda-loading"><i class="fas fa-inbox"></i> No stock history found</td></tr>';
                this._renderShPagination();
                return;
            }

            tbody.innerHTML = page.map(function (d, i) {
                var dt = d.createdAt ? new Date(d.createdAt) : null;
                var dateStr = dt ? dt.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
                var timeStr = dt ? dt.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '';
                return '<tr>' +
                    '<td>' + (start + i + 1) + '</td>' +
                    '<td>' + dateStr + (timeStr ? '<br><small style="color:#94a3b8">' + timeStr + '</small>' : '') + '</td>' +
                    '<td><strong>' + self.escapeHtml(d.productName) + '</strong></td>' +
                    '<td><code>' + self.escapeHtml(d.sku || '') + '</code></td>' +
                    '<td><code class="sales-receipt-code">' + self.escapeHtml(d.orderId || '') + '</code></td>' +
                    '<td>' + self.escapeHtml(d.supplierName || '—') + '</td>' +
                    '<td>' + (d.previousQty != null ? d.previousQty : '—') + '</td>' +
                    '<td><span class="ord-sh-added">+' + (d.addedQty || 0) + '</span></td>' +
                    '<td><strong>' + (d.newQty != null ? d.newQty : '—') + '</strong></td>' +
                    '<td>' + self.formatCurrency(d.unitCost) + '</td>' +
                    '<td>' + self.escapeHtml(d.addedBy || '—') + '</td>' +
                    '</tr>';
            }).join('');

            this._renderShPagination();
        },

        _renderShPagination: function () {
            var container = document.getElementById('sh-pagination');
            if (!container) return;
            var totalItems = this._shFilteredData.length;
            var totalPages = Math.ceil(totalItems / SH_PAGE_SIZE) || 1;
            if (totalPages <= 1) { container.innerHTML = ''; return; }

            var self = this;
            var cp = this._shCurrentPage;
            var start = (cp - 1) * SH_PAGE_SIZE + 1;
            var end = Math.min(cp * SH_PAGE_SIZE, totalItems);

            var pagesHtml = '';
            var maxV = 5;
            var sp = Math.max(1, cp - Math.floor(maxV / 2));
            var ep = Math.min(totalPages, sp + maxV - 1);
            if (ep - sp < maxV - 1) sp = Math.max(1, ep - maxV + 1);

            if (sp > 1) pagesHtml += '<button class="dda-page-btn" data-page="1">1</button>';
            if (sp > 2) pagesHtml += '<span class="dda-page-dots">...</span>';
            for (var p = sp; p <= ep; p++) {
                pagesHtml += '<button class="dda-page-btn' + (p === cp ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
            }
            if (ep < totalPages - 1) pagesHtml += '<span class="dda-page-dots">...</span>';
            if (ep < totalPages) pagesHtml += '<button class="dda-page-btn" data-page="' + totalPages + '">' + totalPages + '</button>';

            container.innerHTML =
                '<span class="dda-page-info">Showing ' + start + '-' + end + ' of ' + totalItems + '</span>' +
                '<div class="dda-page-controls">' +
                '<button class="dda-page-btn" data-page="' + (cp - 1) + '"' + (cp === 1 ? ' disabled' : '') + '><i class="fas fa-chevron-left"></i></button>' +
                pagesHtml +
                '<button class="dda-page-btn" data-page="' + (cp + 1) + '"' + (cp === totalPages ? ' disabled' : '') + '><i class="fas fa-chevron-right"></i></button>' +
                '</div>';

            container.querySelectorAll('.dda-page-btn[data-page]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var page = parseInt(btn.dataset.page);
                    if (page >= 1 && page <= totalPages) { self._shCurrentPage = page; self._renderStockHistoryPage(); }
                });
            });
        }
    };

    window.PharmaFlow.MyOrders = MyOrders;
})();
