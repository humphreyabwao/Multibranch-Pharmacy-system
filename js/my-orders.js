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
    let allOrders = [];
    let filteredOrders = [];
    let orderItems = [];          // items in the create-order form
    let inventoryCache = [];      // cached inventory for item picker
    let suppliersCache = [];      // cached suppliers
    let ordersCurrentPage = 1;
    const PAGE_SIZE = 25;
    let editingOrderId = null;

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
            allOrders = [];
            filteredOrders = [];
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
                                                <th>Line Total</th>
                                                <th></th>
                                            </tr>
                                        </thead>
                                        <tbody id="ord-items-tbody">
                                            <tr><td colspan="8" class="dda-loading"><i class="fas fa-inbox"></i> No items added yet</td></tr>
                                        </tbody>
                                        <tfoot id="ord-items-tfoot" style="display:none">
                                            <tr>
                                                <td colspan="5"></td>
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
            document.getElementById('ord-clear-btn')?.addEventListener('click', () => {
                orderItems = [];
                this.renderOrderItems();
                document.getElementById('ord-notes').value = '';
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
                orderQty: 1
            });
            this.renderOrderItems();
        },

        renderOrderItems: function () {
            const tbody = document.getElementById('ord-items-tbody');
            const tfoot = document.getElementById('ord-items-tfoot');
            if (!tbody) return;

            if (orderItems.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="dda-loading"><i class="fas fa-inbox"></i> No items added yet</td></tr>';
                if (tfoot) tfoot.style.display = 'none';
                return;
            }

            tbody.innerHTML = orderItems.map((item, i) => {
                const lineTotal = item.unitCost * item.orderQty;
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
                    <td><strong>${this.formatCurrency(lineTotal)}</strong></td>
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
            tbody.querySelectorAll('.ord-remove-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    orderItems.splice(parseInt(btn.dataset.idx), 1);
                    this.renderOrderItems();
                });
            });

            // Update total
            const total = orderItems.reduce((s, item) => s + (item.unitCost * item.orderQty), 0);
            const totalEl = document.getElementById('ord-items-total');
            if (totalEl) totalEl.textContent = this.formatCurrency(total);
            if (tfoot) tfoot.style.display = '';
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
                const orderId = this.generateOrderId();
                const totalAmount = orderItems.reduce((s, item) => s + (item.unitCost * item.orderQty), 0);
                const totalQty = orderItems.reduce((s, item) => s + item.orderQty, 0);

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
                        lineTotal: item.unitCost * item.orderQty
                    })),
                    totalAmount: totalAmount,
                    totalItems: orderItems.length,
                    totalQty: totalQty,
                    status: 'pending',
                    createdBy: profile ? (profile.displayName || profile.email) : 'Unknown',
                    createdByUid: firebase.auth().currentUser ? firebase.auth().currentUser.uid : null,
                    createdAt: new Date().toISOString(),
                    orderTimestamp: firebase.firestore.Timestamp.fromDate(new Date())
                };

                await getBusinessCollection(businessId, 'orders').doc(orderId).set(orderData);
                this.showToast('Order ' + orderId + ' submitted successfully!');

                // Clear form
                orderItems = [];
                this.renderOrderItems();
                document.getElementById('ord-notes').value = '';
                document.getElementById('ord-supplier').value = '';

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
                                    <th>Created By</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="ord-manage-tbody">
                                <tr><td colspan="10" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading orders...</td></tr>
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
            this.subscribeOrders();
            this.loadManageLowStockBanner();
        },

        bindManageEvents: function (container) {
            document.getElementById('ord-manage-search')?.addEventListener('input', () => { ordersCurrentPage = 1; this.filterOrders(); });
            document.getElementById('ord-status-filter')?.addEventListener('change', () => { ordersCurrentPage = 1; this.filterOrders(); });
            document.getElementById('ord-priority-filter')?.addEventListener('change', () => { ordersCurrentPage = 1; this.filterOrders(); });
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
            ordersCurrentPage = 1;
            this.filterOrders();
        },

        subscribeOrders: function () {
            const businessId = this.getBusinessId();
            if (!businessId) return;
            if (ordersListener) ordersListener();

            ordersListener = getBusinessCollection(businessId, 'orders')
                .onSnapshot(snap => {
                    allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    allOrders.sort((a, b) => {
                        const ta = a.orderTimestamp?.toDate ? a.orderTimestamp.toDate().getTime() : 0;
                        const tb = b.orderTimestamp?.toDate ? b.orderTimestamp.toDate().getTime() : 0;
                        return tb - ta;
                    });
                    this.updateOrderStats();
                    this.filterOrders();
                }, err => {
                    console.error('Orders subscribe error:', err);
                });
        },

        updateOrderStats: function () {
            const el = id => document.getElementById(id);
            if (el('ord-total')) el('ord-total').textContent = allOrders.length;
            if (el('ord-pending')) el('ord-pending').textContent = allOrders.filter(o => o.status === 'pending').length;
            if (el('ord-approved')) el('ord-approved').textContent = allOrders.filter(o => o.status === 'approved').length;
            if (el('ord-received')) el('ord-received').textContent = allOrders.filter(o => o.status === 'received').length;
            if (el('ord-cancelled')) el('ord-cancelled').textContent = allOrders.filter(o => o.status === 'cancelled').length;
        },

        filterOrders: function () {
            const query = (document.getElementById('ord-manage-search')?.value || '').toLowerCase();
            const statusFilter = document.getElementById('ord-status-filter')?.value || '';
            const priorityFilter = document.getElementById('ord-priority-filter')?.value || '';

            // Date range from quick filter
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
            }

            filteredOrders = allOrders.filter(o => {
                if (statusFilter && o.status !== statusFilter) return false;
                if (priorityFilter && o.priority !== priorityFilter) return false;
                if (fromDate || toDate) {
                    const oDate = o.orderDate || '';
                    if (fromDate && oDate < fromDate) return false;
                    if (toDate && oDate > toDate) return false;
                }
                if (query) {
                    const haystack = ((o.orderId || '') + ' ' + (o.supplierName || '') + ' ' + (o.createdBy || '')).toLowerCase();
                    return haystack.includes(query);
                }
                return true;
            });

            this.renderOrdersPage();
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

            const start = (ordersCurrentPage - 1) * PAGE_SIZE;
            const pageData = filteredOrders.slice(start, start + PAGE_SIZE);

            if (pageData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10" class="dda-loading"><i class="fas fa-inbox"></i> No orders found</td></tr>';
                this.renderPagination();
                return;
            }

            tbody.innerHTML = pageData.map((o, i) => {
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
                    const order = allOrders.find(o => o.id === btn.dataset.id);
                    if (order) this.viewOrder(order);
                });
            });
            tbody.querySelectorAll('.ord-print').forEach(btn => {
                btn.addEventListener('click', () => {
                    const order = allOrders.find(o => o.id === btn.dataset.id);
                    if (order) this.printInvoice(order);
                });
            });
            tbody.querySelectorAll('.ord-approve').forEach(btn => {
                btn.addEventListener('click', () => this.updateOrderStatus(btn.dataset.id, 'approved'));
            });
            tbody.querySelectorAll('.ord-receive').forEach(btn => {
                btn.addEventListener('click', () => this.receiveOrder(btn.dataset.id));
            });
            tbody.querySelectorAll('.ord-add-inv').forEach(btn => {
                btn.addEventListener('click', () => this.addToInventory(btn.dataset.id));
            });
            tbody.querySelectorAll('.ord-cancel').forEach(btn => {
                btn.addEventListener('click', () => this.updateOrderStatus(btn.dataset.id, 'cancelled'));
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

        // ═══════════════════════════════════════════════
        //  ADD TO INVENTORY (sorted preview + batch)
        // ═══════════════════════════════════════════════

        addToInventory: async function (docId) {
            const order = allOrders.find(o => o.id === docId);
            if (!order) return;
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

            body.innerHTML = `
                <div class="dda-view-details">
                    <div class="dda-view-row"><span class="dda-view-label">Order ID</span><span class="dda-view-value"><code class="sales-receipt-code">${this.escapeHtml(order.orderId)}</code></span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Supplier</span><span class="dda-view-value"><strong>${this.escapeHtml(order.supplierName)}</strong></span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Order Date</span><span class="dda-view-value">${order.orderDate || '—'}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Expected Delivery</span><span class="dda-view-value">${order.expectedDelivery || '—'}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Priority</span><span class="dda-view-value">${this.getPriorityBadge(order.priority)}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Status</span><span class="dda-view-value">${this.getStatusBadge(order.status)}${order.inventoryAdded ? ' <span class="ord-inv-tag"><i class="fas fa-check"></i> Added to Inventory</span>' : ''}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Created By</span><span class="dda-view-value">${this.escapeHtml(order.createdBy || '—')}</span></div>
                    ${order.approvedBy ? '<div class="dda-view-row"><span class="dda-view-label">Approved By</span><span class="dda-view-value">' + this.escapeHtml(order.approvedBy) + '</span></div>' : ''}
                    ${order.receivedBy ? '<div class="dda-view-row"><span class="dda-view-label">Received By</span><span class="dda-view-value">' + this.escapeHtml(order.receivedBy) + '</span></div>' : ''}
                    ${order.inventoryAddedBy ? '<div class="dda-view-row"><span class="dda-view-label">Stocked By</span><span class="dda-view-value">' + this.escapeHtml(order.inventoryAddedBy) + '</span></div>' : ''}
                    ${order.notes ? '<div class="dda-view-row"><span class="dda-view-label">Notes</span><span class="dda-view-value">' + this.escapeHtml(order.notes) + '</span></div>' : ''}
                    <div class="dda-view-row"><span class="dda-view-label">Total Amount</span><span class="dda-view-value"><strong>${this.formatCurrency(order.totalAmount)}</strong></span></div>
                </div>
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

            modal.style.display = 'flex';
        },

        // ═══════════════════════════════════════════════
        //  PAGINATION
        // ═══════════════════════════════════════════════

        renderPagination: function () {
            const container = document.getElementById('ord-manage-pagination');
            if (!container) return;
            const totalItems = filteredOrders.length;
            const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
            if (totalPages <= 1) { container.innerHTML = ''; return; }

            const start = (ordersCurrentPage - 1) * PAGE_SIZE + 1;
            const end = Math.min(ordersCurrentPage * PAGE_SIZE, totalItems);

            let pagesHtml = '';
            const maxV = 5;
            let sp = Math.max(1, ordersCurrentPage - Math.floor(maxV / 2));
            let ep = Math.min(totalPages, sp + maxV - 1);
            if (ep - sp < maxV - 1) sp = Math.max(1, ep - maxV + 1);

            if (sp > 1) pagesHtml += '<button class="dda-page-btn" data-page="1">1</button>';
            if (sp > 2) pagesHtml += '<span class="dda-page-dots">...</span>';
            for (let p = sp; p <= ep; p++) {
                pagesHtml += '<button class="dda-page-btn' + (p === ordersCurrentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
            }
            if (ep < totalPages - 1) pagesHtml += '<span class="dda-page-dots">...</span>';
            if (ep < totalPages) pagesHtml += '<button class="dda-page-btn" data-page="' + totalPages + '">' + totalPages + '</button>';

            container.innerHTML = `
                <span class="dda-page-info">Showing ${start}-${end} of ${totalItems}</span>
                <div class="dda-page-controls">
                    <button class="dda-page-btn" data-page="${ordersCurrentPage - 1}" ${ordersCurrentPage === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
                    ${pagesHtml}
                    <button class="dda-page-btn" data-page="${ordersCurrentPage + 1}" ${ordersCurrentPage === totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>
                </div>
            `;

            container.querySelectorAll('.dda-page-btn[data-page]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const page = parseInt(btn.dataset.page);
                    if (page >= 1 && page <= totalPages) { ordersCurrentPage = page; this.renderOrdersPage(); }
                });
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
            doc.text('Total Orders: ' + filteredOrders.length, 14, 29);

            const rows = filteredOrders.map((o, i) => [
                i + 1,
                o.orderId || '',
                o.orderDate || '',
                o.supplierName || '',
                (o.totalItems || 0) + ' items',
                this.formatCurrency(o.totalAmount),
                o.priority || 'normal',
                o.status || 'pending',
                o.createdBy || ''
            ]);

            doc.autoTable({
                startY: 34,
                head: [['#', 'Order ID', 'Date', 'Supplier', 'Items', 'Amount', 'Priority', 'Status', 'Created By']],
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
            var start = (this._shCurrentPage - 1) * PAGE_SIZE;
            var page = data.slice(start, start + PAGE_SIZE);

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
            var totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
            if (totalPages <= 1) { container.innerHTML = ''; return; }

            var self = this;
            var cp = this._shCurrentPage;
            var start = (cp - 1) * PAGE_SIZE + 1;
            var end = Math.min(cp * PAGE_SIZE, totalItems);

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
