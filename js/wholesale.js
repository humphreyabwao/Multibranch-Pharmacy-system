/**
 * PharmaFlow - Wholesale Module
 * Full wholesale order management with:
 *   1. Create wholesale orders (search inventory + manual items)
 *   2. Manage wholesale orders (view, edit, cancel, mark delivered)
 *   3. Professional invoice generation with print support
 *   4. Multi-item support with quantity, price, discount
 *   5. Real-time Firestore integration
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let wsInventoryCache = [];
    let wsOrderItems = [];
    let wsUnsubInventory = null;
    let wsUnsubOrders = null;
    let wsClientLeadsCache = [];
    let wsUnsubClientLeads = null;
    let wsClPage = 1;
    let wsClPageSize = 50;
    let wsClFilteredCache = [];

    // Pagination state for manage orders
    let wsOrdPage = 1;
    let wsOrdPageSize = 25;
    let wsOrdFirstDoc = null;   // first doc on current page (for prev)
    let wsOrdLastDoc = null;    // last doc on current page (for next)
    let wsOrdPageStack = [];    // stack of firstDoc cursors for going back
    let wsOrdHasNext = false;
    let wsOrdTotalEstimate = 0; // estimated total from stats
    let wsOrdIsLoading = false;

    const Wholesale = {

        /* ══════════════════════════════════════════════════════
         * HELPERS
         * ══════════════════════════════════════════════════════ */

        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        getCurrentUser: function () {
            const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
            return profile ? (profile.displayName || profile.email || 'User') : 'Unknown';
        },

        formatCurrency: function (amount) {
            return 'KSH ' + new Intl.NumberFormat('en-KE', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(amount || 0);
        },

        escapeHtml: function (str) {
            const div = document.createElement('div');
            div.textContent = str || '';
            return div.innerHTML;
        },

        showToast: function (message, type) {
            const existing = document.querySelector('.ws-toast');
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.className = 'ws-toast ws-toast--' + (type || 'success');
            toast.innerHTML = '<i class="fas fa-' + (type === 'error' ? 'exclamation-circle' : 'check-circle') + '"></i> ' + this.escapeHtml(message);
            document.body.appendChild(toast);
            setTimeout(() => toast.classList.add('show'), 10);
            setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3500);
        },

        generateOrderId: function () {
            const now = new Date();
            const y = now.getFullYear().toString().slice(-2);
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
            return 'WS-' + y + m + d + '-' + rand;
        },

        generateInvoiceNo: function () {
            const now = new Date();
            const y = now.getFullYear();
            const seq = Math.floor(Math.random() * 90000) + 10000;
            return 'INV-' + y + '-' + seq;
        },

        cleanup: function () {
            if (wsUnsubInventory) { wsUnsubInventory(); wsUnsubInventory = null; }
            if (wsUnsubOrders) { wsUnsubOrders(); wsUnsubOrders = null; }
            if (wsUnsubClientLeads) { wsUnsubClientLeads(); wsUnsubClientLeads = null; }
            if (this._ridersUnsub) { this._ridersUnsub(); this._ridersUnsub = null; }
            if (this._keyHandler) { document.removeEventListener('keydown', this._keyHandler); this._keyHandler = null; }
            wsInventoryCache = [];
            wsOrderItems = [];
            wsClientLeadsCache = [];
        },

        /* ══════════════════════════════════════════════════════
         * CREATE WHOLESALE ORDER
         * ══════════════════════════════════════════════════════ */

        renderCreate: function (container) {
            this.cleanup();
            wsOrderItems = [];
            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="ws-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-store"></i> Create Wholesale Order</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Wholesale</span><span>/</span>
                                <span>Create Order</span>
                            </div>
                        </div>
                    </div>

                    <div class="ws-create-layout">
                        <!-- LEFT: Customer & Items -->
                        <div class="ws-form-section">
                            <!-- Customer Info -->
                            <div class="card ws-card">
                                <div class="card-header">
                                    <span class="card-title"><i class="fas fa-user-tie"></i> Customer Details</span>
                                </div>
                                <div class="ws-customer-grid">
                                    <div class="form-group" style="position:relative">
                                        <label for="ws-customer-name">Customer / Business Name <span class="required">*</span></label>
                                        <input type="text" id="ws-customer-name" placeholder="Search client leads or type a name..." required autocomplete="off">
                                        <div class="ws-search-results" id="ws-cl-search-results" style="position:absolute;top:100%;left:0;right:0;z-index:50"></div>
                                    </div>
                                    <div class="form-group">
                                        <label for="ws-customer-phone">Phone Number</label>
                                        <input type="tel" id="ws-customer-phone" placeholder="e.g. 0712345678">
                                    </div>
                                    <div class="form-group">
                                        <label for="ws-customer-email">Email</label>
                                        <input type="email" id="ws-customer-email" placeholder="customer@email.com">
                                    </div>
                                    <div class="form-group">
                                        <label for="ws-customer-address">Address</label>
                                        <input type="text" id="ws-customer-address" placeholder="Delivery address">
                                    </div>
                                </div>
                            </div>

                            <!-- Add Items -->
                            <div class="card ws-card">
                                <div class="card-header">
                                    <span class="card-title"><i class="fas fa-boxes-stacked"></i> Order Items</span>
                                    <button class="btn btn-sm btn-outline" id="ws-add-manual-btn">
                                        <i class="fas fa-pen"></i> Add Manual Item
                                    </button>
                                </div>

                                <!-- Search from inventory -->
                                <div class="ws-item-search">
                                    <div class="ws-search-bar">
                                        <i class="fas fa-search"></i>
                                        <input type="text" id="ws-item-search" placeholder="Search inventory by name, SKU..." autocomplete="off">
                                    </div>
                                    <div class="ws-search-results" id="ws-search-results"></div>
                                </div>

                                <!-- Manual item form (hidden by default) -->
                                <div class="ws-manual-form" id="ws-manual-form" style="display:none;">
                                    <h4><i class="fas fa-pen-to-square"></i> Manual Item Entry</h4>
                                    <div class="ws-manual-grid">
                                        <div class="form-group">
                                            <label>Item Name <span class="required">*</span></label>
                                            <input type="text" id="ws-manual-name" placeholder="Product name">
                                        </div>
                                        <div class="form-group">
                                            <label>Unit Price <span class="required">*</span></label>
                                            <input type="number" id="ws-manual-price" min="0" step="0.01" placeholder="0.00">
                                        </div>
                                        <div class="form-group">
                                            <label>Quantity <span class="required">*</span></label>
                                            <input type="number" id="ws-manual-qty" min="1" value="1" placeholder="1">
                                        </div>
                                        <div class="form-group">
                                            <label>Description / Notes</label>
                                            <input type="text" id="ws-manual-desc" placeholder="Optional notes">
                                        </div>
                                    </div>
                                    <div class="ws-manual-actions">
                                        <button class="btn btn-sm btn-primary" id="ws-manual-add-btn">
                                            <i class="fas fa-plus"></i> Add to Order
                                        </button>
                                        <button class="btn btn-sm btn-outline" id="ws-manual-cancel-btn">Cancel</button>
                                    </div>
                                </div>

                                <!-- Items table -->
                                <div class="ws-items-table-wrap">
                                    <table class="ws-items-table">
                                        <thead>
                                            <tr>
                                                <th>#</th>
                                                <th>Item</th>
                                                <th>Source</th>
                                                <th style="text-align:center">Qty</th>
                                                <th style="text-align:right">Unit Price</th>
                                                <th style="text-align:right">Total</th>
                                                <th style="text-align:center">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody id="ws-items-list">
                                            <tr><td colspan="7" class="ws-empty-row">
                                                <div class="ws-empty-items">
                                                    <i class="fas fa-box-open"></i>
                                                    <p>No items added yet</p>
                                                    <span>Search inventory or add items manually</span>
                                                </div>
                                            </td></tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <!-- RIGHT: Order Summary -->
                        <div class="ws-summary-section">
                            <div class="card ws-card ws-summary-card">
                                <div class="card-header">
                                    <span class="card-title"><i class="fas fa-calculator"></i> Order Summary</span>
                                </div>

                                <div class="ws-summary-body">
                                    <div class="ws-summary-row">
                                        <span>Items</span>
                                        <span id="ws-summary-count">0</span>
                                    </div>
                                    <div class="ws-summary-row">
                                        <span>Subtotal</span>
                                        <span id="ws-summary-subtotal">KSH 0.00</span>
                                    </div>
                                    <div class="ws-summary-row">
                                        <span>Discount</span>
                                        <div class="ws-discount-wrap">
                                            <input type="number" id="ws-discount" min="0" value="0" placeholder="0">
                                            <select id="ws-discount-type">
                                                <option value="amount">KSH</option>
                                                <option value="percent">%</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div class="ws-summary-row">
                                        <span>Tax (16% VAT)</span>
                                        <div class="ws-tax-wrap">
                                            <label class="ws-toggle-label">
                                                <input type="checkbox" id="ws-apply-tax"> Apply
                                            </label>
                                            <span id="ws-summary-tax">KSH 0.00</span>
                                        </div>
                                    </div>
                                    <div class="ws-summary-total">
                                        <span>Grand Total</span>
                                        <span id="ws-summary-total">KSH 0.00</span>
                                    </div>
                                </div>

                                <div class="ws-payment-section">
                                    <div class="form-group">
                                        <label>Payment Method</label>
                                        <select id="ws-payment-method" class="ws-select">
                                            <option value="cash">Cash</option>
                                            <option value="mpesa">M-Pesa</option>
                                            <option value="bank_transfer">Bank Transfer</option>
                                            <option value="cheque">Cheque</option>
                                            <option value="credit">Credit (Invoice)</option>
                                            <option value="card">Card</option>
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label>Payment Status</label>
                                        <select id="ws-payment-status" class="ws-select">
                                            <option value="paid">Paid</option>
                                            <option value="partial">Partially Paid</option>
                                            <option value="unpaid" selected>Unpaid (Invoice)</option>
                                        </select>
                                    </div>
                                    <div class="form-group" id="ws-amount-paid-group" style="display:none;">
                                        <label>Amount Paid</label>
                                        <input type="number" id="ws-amount-paid" min="0" step="0.01" placeholder="0.00">
                                    </div>
                                    <div class="form-group">
                                        <label>Due Date</label>
                                        <input type="date" id="ws-due-date" value="">
                                    </div>
                                    <div class="form-group">
                                        <label>Notes</label>
                                        <textarea id="ws-notes" class="ws-textarea" rows="2" placeholder="Additional notes for this order..."></textarea>
                                    </div>
                                </div>

                                <div class="ws-action-buttons">
                                    <button class="btn btn-primary btn-lg ws-submit-btn" id="ws-submit-order" disabled>
                                        <i class="fas fa-check-circle"></i> Submit Order
                                    </button>
                                    <button class="btn btn-outline" id="ws-save-draft">
                                        <i class="fas fa-save"></i> Save as Draft
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            this._bindCreateEvents(container, businessId);
            this._subscribeInventory(businessId);
            this._subscribeClientLeads(businessId);

            // Set default due date (30 days from now)
            const dueDateEl = document.getElementById('ws-due-date');
            if (dueDateEl) {
                const d = new Date();
                d.setDate(d.getDate() + 30);
                dueDateEl.value = d.toISOString().split('T')[0];
            }
        },

        _bindCreateEvents: function (container, businessId) {
            const self = this;

            // Breadcrumb
            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });

            // Item search
            const searchInput = document.getElementById('ws-item-search');
            const searchResults = document.getElementById('ws-search-results');
            if (searchInput && searchResults) {
                let debounce;
                searchInput.addEventListener('input', function () {
                    clearTimeout(debounce);
                    debounce = setTimeout(() => self._searchInventory(this.value, searchResults), 180);
                });
                searchInput.addEventListener('focus', function () {
                    if (this.value.trim().length >= 1) self._searchInventory(this.value, searchResults);
                });
                document.addEventListener('click', (e) => {
                    if (!searchResults.contains(e.target) && e.target !== searchInput) {
                        searchResults.classList.remove('show');
                    }
                });
            }

            // Client lead search on customer name
            const custNameInput = document.getElementById('ws-customer-name');
            const clResults = document.getElementById('ws-cl-search-results');
            if (custNameInput && clResults) {
                let clDebounce;
                custNameInput.addEventListener('input', function () {
                    clearTimeout(clDebounce);
                    clDebounce = setTimeout(() => {
                        const matches = self._searchClientLeads(this.value);
                        if (matches.length === 0) { clResults.classList.remove('show'); return; }
                        clResults.innerHTML = matches.map(c =>
                            '<div class="ws-search-item" data-cl-id="' + c.id + '" style="cursor:pointer">' +
                            '<div class="ws-search-item-info">' +
                            '<strong>' + self.escapeHtml(c.name) + '</strong>' +
                            '<small>' + (c.businessName ? self.escapeHtml(c.businessName) + ' · ' : '') +
                            self.escapeHtml(c.phone || '') + (c.email ? ' · ' + self.escapeHtml(c.email) : '') +
                            ' · ' + self._clientStatusBadge(c.status) +
                            ' · <b>' + (c.orderCount || 0) + ' orders</b></small></div></div>'
                        ).join('');
                        clResults.classList.add('show');

                        // Bind click
                        clResults.querySelectorAll('[data-cl-id]').forEach(item => {
                            item.addEventListener('click', () => {
                                const client = wsClientLeadsCache.find(cl => cl.id === item.dataset.clId);
                                if (!client) return;
                                document.getElementById('ws-customer-name').value = client.name;
                                document.getElementById('ws-customer-phone').value = client.phone || '';
                                document.getElementById('ws-customer-email').value = client.email || '';
                                document.getElementById('ws-customer-address').value = client.address || '';
                                clResults.classList.remove('show');
                                self.showToast('Client loaded: ' + client.name);
                            });
                        });
                    }, 200);
                });
                document.addEventListener('click', (e) => {
                    if (!clResults.contains(e.target) && e.target !== custNameInput) {
                        clResults.classList.remove('show');
                    }
                });
            }

            // Manual item toggle
            const manualBtn = document.getElementById('ws-add-manual-btn');
            const manualForm = document.getElementById('ws-manual-form');
            if (manualBtn && manualForm) {
                manualBtn.addEventListener('click', () => {
                    manualForm.style.display = manualForm.style.display === 'none' ? 'block' : 'none';
                });
            }

            // Manual cancel
            document.getElementById('ws-manual-cancel-btn')?.addEventListener('click', () => {
                if (manualForm) manualForm.style.display = 'none';
            });

            // Manual add
            document.getElementById('ws-manual-add-btn')?.addEventListener('click', () => this._addManualItem());

            // Discount & tax change
            document.getElementById('ws-discount')?.addEventListener('input', () => this._updateSummary());
            document.getElementById('ws-discount-type')?.addEventListener('change', () => this._updateSummary());
            document.getElementById('ws-apply-tax')?.addEventListener('change', () => this._updateSummary());

            // Payment status
            document.getElementById('ws-payment-status')?.addEventListener('change', function () {
                const amtGroup = document.getElementById('ws-amount-paid-group');
                if (amtGroup) amtGroup.style.display = this.value === 'partial' ? 'block' : 'none';
            });

            // Submit order
            document.getElementById('ws-submit-order')?.addEventListener('click', () => this._submitOrder(businessId, 'confirmed'));

            // Save draft
            document.getElementById('ws-save-draft')?.addEventListener('click', () => this._submitOrder(businessId, 'draft'));
        },

        _subscribeInventory: function (businessId) {
            if (wsUnsubInventory) { wsUnsubInventory(); wsUnsubInventory = null; }
            if (!businessId) return;
            const col = getBusinessCollection(businessId, 'inventory');
            if (!col) return;

            wsUnsubInventory = col.onSnapshot(snap => {
                wsInventoryCache = [];
                snap.forEach(doc => wsInventoryCache.push({ id: doc.id, ...doc.data() }));
            }, err => console.error('Wholesale inventory listener error:', err));
        },

        _searchInventory: function (query, container) {
            const q = (query || '').toLowerCase().trim();
            if (q.length < 1) { container.classList.remove('show'); return; }

            const results = wsInventoryCache.filter(p => {
                const n = (p.name || '').toLowerCase();
                const s = (p.sku || '').toLowerCase();
                const c = (p.category || '').toLowerCase();
                return n.includes(q) || s.includes(q) || c.includes(q);
            }).slice(0, 10);

            if (results.length === 0) {
                container.innerHTML = '<div class="ws-search-empty"><i class="fas fa-search"></i> No products found</div>';
                container.classList.add('show');
                return;
            }

            container.innerHTML = results.map(p => {
                const stock = p.quantity || 0;
                const already = wsOrderItems.find(i => i.inventoryId === p.id);
                return `
                    <div class="ws-search-item ${stock <= 0 ? 'ws-search-item--oos' : ''}" data-id="${p.id}">
                        <div class="ws-search-item-info">
                            <strong>${this.escapeHtml(p.name)}</strong>
                            <small>SKU: ${this.escapeHtml(p.sku || 'N/A')} | Stock: ${stock} | ${this.formatCurrency(p.sellingPrice || 0)}</small>
                        </div>
                        ${already ? '<span class="ws-in-order-badge"><i class="fas fa-check"></i></span>' : ''}
                        <button class="btn btn-sm btn-primary ws-add-from-inv" data-id="${p.id}" ${stock <= 0 ? 'disabled' : ''}>
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                `;
            }).join('');

            container.classList.add('show');

            // Bind add buttons
            container.querySelectorAll('.ws-add-from-inv').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._addInventoryItem(btn.dataset.id);
                    container.classList.remove('show');
                    const si = document.getElementById('ws-item-search');
                    if (si) si.value = '';
                });
            });
        },

        _addInventoryItem: function (productId) {
            const product = wsInventoryCache.find(p => p.id === productId);
            if (!product) return;

            const existing = wsOrderItems.find(i => i.inventoryId === productId);
            if (existing) {
                existing.qty++;
                this.showToast('Increased quantity for ' + product.name);
            } else {
                wsOrderItems.push({
                    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
                    inventoryId: productId,
                    name: product.name || 'Unknown',
                    sku: product.sku || '',
                    category: product.category || '',
                    unitPrice: product.sellingPrice || product.price || 0,
                    costPrice: product.costPrice || product.buyingPrice || 0,
                    qty: 1,
                    maxStock: product.quantity || 0,
                    source: 'inventory',
                    notes: ''
                });
                this.showToast(product.name + ' added to order');
            }

            this._renderItems();
            this._updateSummary();
        },

        _addManualItem: function () {
            const nameEl = document.getElementById('ws-manual-name');
            const priceEl = document.getElementById('ws-manual-price');
            const qtyEl = document.getElementById('ws-manual-qty');
            const descEl = document.getElementById('ws-manual-desc');

            const name = (nameEl?.value || '').trim();
            const price = parseFloat(priceEl?.value) || 0;
            const qty = parseInt(qtyEl?.value) || 1;
            const desc = (descEl?.value || '').trim();

            if (!name) { this.showToast('Item name is required', 'error'); return; }
            if (price <= 0) { this.showToast('Price must be greater than 0', 'error'); return; }

            wsOrderItems.push({
                id: Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
                inventoryId: null,
                name: name,
                sku: '',
                category: '',
                unitPrice: price,
                costPrice: 0,
                qty: qty,
                maxStock: Infinity,
                source: 'manual',
                notes: desc
            });

            // Clear form
            if (nameEl) nameEl.value = '';
            if (priceEl) priceEl.value = '';
            if (qtyEl) qtyEl.value = '1';
            if (descEl) descEl.value = '';

            const form = document.getElementById('ws-manual-form');
            if (form) form.style.display = 'none';

            this.showToast(name + ' added manually');
            this._renderItems();
            this._updateSummary();
        },

        _renderItems: function () {
            const tbody = document.getElementById('ws-items-list');
            const submitBtn = document.getElementById('ws-submit-order');
            if (!tbody) return;

            if (wsOrderItems.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="ws-empty-row">
                    <div class="ws-empty-items">
                        <i class="fas fa-box-open"></i>
                        <p>No items added yet</p>
                        <span>Search inventory or add items manually</span>
                    </div>
                </td></tr>`;
                if (submitBtn) submitBtn.disabled = true;
                return;
            }

            if (submitBtn) submitBtn.disabled = false;

            tbody.innerHTML = wsOrderItems.map((item, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td>
                        <div class="ws-item-name-cell">
                            <strong>${this.escapeHtml(item.name)}</strong>
                            ${item.sku ? '<small>SKU: ' + this.escapeHtml(item.sku) + '</small>' : ''}
                            ${item.notes ? '<small class="ws-item-note"><i class="fas fa-sticky-note"></i> ' + this.escapeHtml(item.notes) + '</small>' : ''}
                        </div>
                    </td>
                    <td>
                        <span class="ws-source-badge ws-source--${item.source}">
                            <i class="fas fa-${item.source === 'inventory' ? 'warehouse' : 'pen'}"></i> ${item.source === 'inventory' ? 'Inventory' : 'Manual'}
                        </span>
                    </td>
                    <td style="text-align:center">
                        <div class="ws-qty-controls">
                            <button class="ws-qty-btn" data-action="dec" data-id="${item.id}"><i class="fas fa-minus"></i></button>
                            <input type="number" class="ws-qty-input" value="${item.qty}" min="1" data-id="${item.id}">
                            <button class="ws-qty-btn" data-action="inc" data-id="${item.id}"><i class="fas fa-plus"></i></button>
                        </div>
                    </td>
                    <td style="text-align:right">
                        <input type="number" class="ws-price-input" value="${item.unitPrice.toFixed(2)}" min="0" step="0.01" data-id="${item.id}">
                    </td>
                    <td style="text-align:right" class="ws-line-total">
                        ${this.formatCurrency(item.unitPrice * item.qty)}
                    </td>
                    <td style="text-align:center">
                        <button class="ws-remove-btn" data-id="${item.id}" title="Remove item">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </td>
                </tr>
            `).join('');

            // Bind qty buttons
            tbody.querySelectorAll('.ws-qty-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const item = wsOrderItems.find(i => i.id === btn.dataset.id);
                    if (!item) return;
                    const newQ = btn.dataset.action === 'inc' ? item.qty + 1 : item.qty - 1;
                    if (newQ < 1) { this._removeItem(btn.dataset.id); return; }
                    if (item.source === 'inventory' && newQ > item.maxStock) {
                        this.showToast('Only ' + item.maxStock + ' available in stock', 'error');
                        return;
                    }
                    item.qty = newQ;
                    this._renderItems();
                    this._updateSummary();
                });
            });

            // Bind qty inputs
            tbody.querySelectorAll('.ws-qty-input').forEach(input => {
                input.addEventListener('change', () => {
                    const item = wsOrderItems.find(i => i.id === input.dataset.id);
                    if (!item) return;
                    const val = parseInt(input.value) || 1;
                    if (item.source === 'inventory' && val > item.maxStock) {
                        this.showToast('Only ' + item.maxStock + ' available', 'error');
                        item.qty = item.maxStock;
                    } else {
                        item.qty = Math.max(1, val);
                    }
                    this._renderItems();
                    this._updateSummary();
                });
            });

            // Bind price inputs
            tbody.querySelectorAll('.ws-price-input').forEach(input => {
                input.addEventListener('change', () => {
                    const item = wsOrderItems.find(i => i.id === input.dataset.id);
                    if (!item) return;
                    item.unitPrice = Math.max(0, parseFloat(input.value) || 0);
                    this._renderItems();
                    this._updateSummary();
                });
            });

            // Bind remove
            tbody.querySelectorAll('.ws-remove-btn').forEach(btn => {
                btn.addEventListener('click', () => this._removeItem(btn.dataset.id));
            });
        },

        _removeItem: function (itemId) {
            wsOrderItems = wsOrderItems.filter(i => i.id !== itemId);
            this._renderItems();
            this._updateSummary();
        },

        _updateSummary: function () {
            const subtotal = wsOrderItems.reduce((sum, i) => sum + (i.unitPrice * i.qty), 0);
            const totalQty = wsOrderItems.reduce((sum, i) => sum + i.qty, 0);

            const discInput = document.getElementById('ws-discount');
            const discType = document.getElementById('ws-discount-type');
            const applyTax = document.getElementById('ws-apply-tax');

            const discVal = parseFloat(discInput?.value) || 0;
            let discount = 0;
            if (discVal > 0) {
                if (discType?.value === 'percent') {
                    discount = subtotal * (Math.min(discVal, 100) / 100);
                } else {
                    discount = Math.min(discVal, subtotal);
                }
            }

            const afterDiscount = Math.max(subtotal - discount, 0);
            const taxRate = applyTax?.checked ? 0.16 : 0;
            const tax = afterDiscount * taxRate;
            const grandTotal = afterDiscount + tax;

            const countEl = document.getElementById('ws-summary-count');
            const subEl = document.getElementById('ws-summary-subtotal');
            const taxEl = document.getElementById('ws-summary-tax');
            const totalEl = document.getElementById('ws-summary-total');

            if (countEl) countEl.textContent = totalQty + ' item' + (totalQty !== 1 ? 's' : '');
            if (subEl) subEl.textContent = this.formatCurrency(subtotal);
            if (taxEl) taxEl.textContent = this.formatCurrency(tax);
            if (totalEl) totalEl.textContent = this.formatCurrency(grandTotal);
        },

        _submitOrder: async function (businessId, status) {
            if (!businessId) { this.showToast('No business assigned', 'error'); return; }

            const customerName = (document.getElementById('ws-customer-name')?.value || '').trim();
            if (!customerName) { this.showToast('Customer name is required', 'error'); return; }
            if (wsOrderItems.length === 0 && status !== 'draft') { this.showToast('Add at least one item', 'error'); return; }

            const submitBtn = document.getElementById('ws-submit-order');
            const draftBtn = document.getElementById('ws-save-draft');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...'; }
            if (draftBtn) draftBtn.disabled = true;

            try {
                const subtotal = wsOrderItems.reduce((sum, i) => sum + (i.unitPrice * i.qty), 0);
                const discVal = parseFloat(document.getElementById('ws-discount')?.value) || 0;
                const discTypeVal = document.getElementById('ws-discount-type')?.value || 'amount';
                let discount = 0;
                if (discVal > 0) {
                    discount = discTypeVal === 'percent' ? subtotal * (Math.min(discVal, 100) / 100) : Math.min(discVal, subtotal);
                }
                const afterDiscount = Math.max(subtotal - discount, 0);
                const applyTax = document.getElementById('ws-apply-tax')?.checked || false;
                const tax = applyTax ? afterDiscount * 0.16 : 0;
                const grandTotal = afterDiscount + tax;

                const paymentMethod = document.getElementById('ws-payment-method')?.value || 'cash';
                const paymentStatus = document.getElementById('ws-payment-status')?.value || 'unpaid';
                const amountPaid = paymentStatus === 'paid' ? grandTotal : (paymentStatus === 'partial' ? (parseFloat(document.getElementById('ws-amount-paid')?.value) || 0) : 0);
                const balanceDue = Math.max(grandTotal - amountPaid, 0);

                const orderId = this.generateOrderId();
                const invoiceNo = this.generateInvoiceNo();
                const now = new Date();

                const orderData = {
                    orderId: orderId,
                    invoiceNo: invoiceNo,
                    customer: {
                        name: customerName,
                        phone: (document.getElementById('ws-customer-phone')?.value || '').trim(),
                        email: (document.getElementById('ws-customer-email')?.value || '').trim(),
                        address: (document.getElementById('ws-customer-address')?.value || '').trim()
                    },
                    items: wsOrderItems.map(item => ({
                        inventoryId: item.inventoryId || null,
                        name: item.name,
                        sku: item.sku,
                        category: item.category,
                        unitPrice: item.unitPrice,
                        costPrice: item.costPrice,
                        quantity: item.qty,
                        lineTotal: item.unitPrice * item.qty,
                        source: item.source,
                        notes: item.notes || ''
                    })),
                    subtotal: subtotal,
                    discountValue: discVal,
                    discountType: discTypeVal,
                    discountAmount: discount,
                    applyTax: applyTax,
                    taxAmount: tax,
                    grandTotal: grandTotal,
                    paymentMethod: paymentMethod,
                    paymentStatus: paymentStatus,
                    amountPaid: amountPaid,
                    balanceDue: balanceDue,
                    dueDate: (document.getElementById('ws-due-date')?.value || ''),
                    notes: (document.getElementById('ws-notes')?.value || '').trim(),
                    itemCount: wsOrderItems.reduce((sum, i) => sum + i.qty, 0),
                    status: status,
                    type: 'wholesale',
                    createdBy: this.getCurrentUser(),
                    createdByUid: firebase.auth().currentUser ? firebase.auth().currentUser.uid : null,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                // Save to Firestore
                await getBusinessCollection(businessId, 'wholesale_orders').doc(orderId).set(orderData);

                // Also record as a sale if status is confirmed and paymentStatus is paid
                if (status === 'confirmed' && paymentStatus === 'paid') {
                    const saleData = {
                        saleId: orderId,
                        items: orderData.items,
                        subtotal: subtotal,
                        discountValue: discVal,
                        discountType: discTypeVal,
                        discountAmount: discount,
                        total: grandTotal,
                        paymentMethod: paymentMethod,
                        amountPaid: amountPaid,
                        changeDue: 0,
                        itemCount: orderData.itemCount,
                        customerName: customerName,
                        type: 'wholesale',
                        soldBy: orderData.createdBy,
                        soldByUid: orderData.createdByUid,
                        status: 'completed',
                        createdAt: new Date().toISOString()
                    };
                    await getBusinessCollection(businessId, 'sales').doc(orderId).set(saleData);

                    // Decrement inventory for inventory-sourced items
                    const invItems = wsOrderItems.filter(i => i.inventoryId);
                    if (invItems.length > 0) {
                        const batch = window.db.batch();
                        invItems.forEach(item => {
                            const ref = getBusinessCollection(businessId, 'inventory').doc(item.inventoryId);
                            batch.update(ref, {
                                quantity: firebase.firestore.FieldValue.increment(-item.qty),
                                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                            });
                        });
                        await batch.commit();
                    }
                }

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: status === 'draft' ? 'Wholesale Draft Saved' : 'Wholesale Order Created',
                        description: 'Order ' + orderId + ' for ' + customerName + ' — ' + this.formatCurrency(grandTotal) + ' (' + wsOrderItems.length + ' items)',
                        category: 'Wholesale',
                        status: 'COMPLETED',
                        amount: grandTotal,
                        metadata: { orderId: orderId, customer: customerName, itemCount: orderData.itemCount, grandTotal: grandTotal }
                    });
                }

                this.showToast(status === 'draft' ? 'Draft saved!' : 'Wholesale order submitted!');

                // Update client lead stats
                if (status === 'confirmed') {
                    const custPhone = (document.getElementById('ws-customer-phone')?.value || '').trim();
                    this._updateClientOrderStats(businessId, customerName, custPhone, grandTotal);
                }

                // Show invoice
                if (status === 'confirmed') {
                    this._showInvoice(orderData);
                }

                // Reset
                wsOrderItems = [];
                this._renderItems();
                this._updateSummary();
                document.getElementById('ws-customer-name').value = '';
                document.getElementById('ws-customer-phone').value = '';
                document.getElementById('ws-customer-email').value = '';
                document.getElementById('ws-customer-address').value = '';
                document.getElementById('ws-discount').value = '0';
                document.getElementById('ws-notes').value = '';

            } catch (err) {
                console.error('Wholesale order error:', err);
                this.showToast('Failed: ' + err.message, 'error');
            } finally {
                if (submitBtn) { submitBtn.disabled = wsOrderItems.length === 0; submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> Submit Order'; }
                if (draftBtn) draftBtn.disabled = false;
            }
        },

        /* ══════════════════════════════════════════════════════
         * MANAGE WHOLESALE ORDERS
         * ══════════════════════════════════════════════════════ */

        renderManage: function (container) {
            this.cleanup();
            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="ws-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-list-check"></i> Manage Wholesale Orders</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Wholesale</span><span>/</span>
                                <span>Manage Orders</span>
                            </div>
                        </div>
                        <div class="page-header-right">
                            <button class="btn btn-sm btn-primary" id="ws-new-order-btn">
                                <i class="fas fa-plus"></i> New Order
                            </button>
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="ws-manage-stats" id="ws-manage-stats">
                        <div class="ws-stat-mini ws-stat--blue">
                            <i class="fas fa-clipboard-list"></i>
                            <div>
                                <span class="ws-stat-num" id="ws-stat-total">0</span>
                                <span class="ws-stat-label">Total Orders</span>
                            </div>
                        </div>
                        <div class="ws-stat-mini ws-stat--green">
                            <i class="fas fa-check-circle"></i>
                            <div>
                                <span class="ws-stat-num" id="ws-stat-confirmed">0</span>
                                <span class="ws-stat-label">Confirmed</span>
                            </div>
                        </div>
                        <div class="ws-stat-mini ws-stat--orange">
                            <i class="fas fa-clock"></i>
                            <div>
                                <span class="ws-stat-num" id="ws-stat-draft">0</span>
                                <span class="ws-stat-label">Drafts</span>
                            </div>
                        </div>
                        <div class="ws-stat-mini ws-stat--purple">
                            <i class="fas fa-money-bill-wave"></i>
                            <div>
                                <span class="ws-stat-num" id="ws-stat-revenue">KSH 0</span>
                                <span class="ws-stat-label">Total Revenue</span>
                            </div>
                        </div>
                        <div class="ws-stat-mini ws-stat--red">
                            <i class="fas fa-exclamation-circle"></i>
                            <div>
                                <span class="ws-stat-num" id="ws-stat-unpaid">0</span>
                                <span class="ws-stat-label">Unpaid</span>
                            </div>
                        </div>
                    </div>

                    <!-- Filters -->
                    <div class="card ws-card">
                        <div class="ws-filter-row">
                            <div class="ws-search-bar ws-manage-search">
                                <i class="fas fa-search"></i>
                                <input type="text" id="ws-manage-search" placeholder="Search by order ID, customer, invoice..." autocomplete="off">
                            </div>
                            <select id="ws-filter-status" class="ws-select ws-filter-select">
                                <option value="all">All Statuses</option>
                                <option value="confirmed">Confirmed</option>
                                <option value="draft">Draft</option>
                                <option value="delivered">Delivered</option>
                                <option value="cancelled">Cancelled</option>
                            </select>
                            <select id="ws-filter-payment" class="ws-select ws-filter-select">
                                <option value="all">All Payments</option>
                                <option value="paid">Paid</option>
                                <option value="partial">Partial</option>
                                <option value="unpaid">Unpaid</option>
                            </select>
                        </div>

                        <!-- Orders table -->
                        <div class="ws-orders-table-wrap">
                            <table class="ws-orders-table">
                                <thead>
                                    <tr>
                                        <th>Order ID</th>
                                        <th>Invoice</th>
                                        <th>Customer</th>
                                        <th>Items</th>
                                        <th style="text-align:right">Total</th>
                                        <th>Payment</th>
                                        <th>Status</th>
                                        <th>Dispatch</th>
                                        <th>Date</th>
                                        <th style="text-align:center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="ws-orders-list">
                                    <tr><td colspan="10" class="ws-loading-cell"><div class="spinner"></div> Loading orders...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;

            // Bind events
            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });

            document.getElementById('ws-new-order-btn')?.addEventListener('click', () => {
                PharmaFlow.Sidebar.setActive('wholesale', 'create-wholesale');
            });

            // Search/filter
            const self = this;
            let searchDebounce;
            document.getElementById('ws-manage-search')?.addEventListener('input', function () {
                clearTimeout(searchDebounce);
                searchDebounce = setTimeout(() => self._applyClientSearch(), 200);
            });
            document.getElementById('ws-filter-status')?.addEventListener('change', () => {
                wsOrdPage = 1; wsOrdPageStack = []; wsOrdFirstDoc = null; wsOrdLastDoc = null;
                this._loadOrdersPage(businessId, 'first');
            });
            document.getElementById('ws-filter-payment')?.addEventListener('change', () => {
                wsOrdPage = 1; wsOrdPageStack = []; wsOrdFirstDoc = null; wsOrdLastDoc = null;
                this._loadOrdersPage(businessId, 'first');
            });

            // Subscribe to orders
            this._subscribeOrders(businessId);
        },

        _allOrders: [],

        _subscribeOrders: function (businessId) {
            if (wsUnsubOrders) { wsUnsubOrders(); wsUnsubOrders = null; }
            if (!businessId) return;
            // Reset pagination state
            wsOrdPage = 1;
            wsOrdFirstDoc = null;
            wsOrdLastDoc = null;
            wsOrdPageStack = [];
            wsOrdHasNext = false;
            // Load first page
            this._loadOrdersPage(businessId, 'first');
        },

        _buildOrderQuery: function (businessId) {
            const col = getBusinessCollection(businessId, 'wholesale_orders');
            if (!col) return null;
            let q = col.orderBy('createdAt', 'desc');

            // Apply server-side status filter if set
            const statusFilter = document.getElementById('ws-filter-status')?.value || 'all';
            if (statusFilter !== 'all') {
                q = col.where('status', '==', statusFilter).orderBy('createdAt', 'desc');
            }
            const paymentFilter = document.getElementById('ws-filter-payment')?.value || 'all';
            if (paymentFilter !== 'all') {
                if (statusFilter !== 'all') {
                    q = col.where('status', '==', statusFilter)
                           .where('paymentStatus', '==', paymentFilter)
                           .orderBy('createdAt', 'desc');
                } else {
                    q = col.where('paymentStatus', '==', paymentFilter).orderBy('createdAt', 'desc');
                }
            }
            return q;
        },

        _loadOrdersPage: async function (businessId, direction) {
            if (wsOrdIsLoading) return;
            wsOrdIsLoading = true;

            const tbody = document.getElementById('ws-orders-list');
            if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="ws-loading-cell"><div class="spinner"></div> Loading orders...</td></tr>';

            try {
                const baseQ = this._buildOrderQuery(businessId);
                if (!baseQ) { wsOrdIsLoading = false; return; }

                // Fetch pageSize + 1 to know if there's a next page
                let query;
                if (direction === 'next' && wsOrdLastDoc) {
                    query = baseQ.startAfter(wsOrdLastDoc).limit(wsOrdPageSize + 1);
                } else if (direction === 'prev' && wsOrdPageStack.length > 0) {
                    const prevCursor = wsOrdPageStack.pop();
                    wsOrdPage--;
                    if (prevCursor === null) {
                        query = baseQ.limit(wsOrdPageSize + 1);
                    } else {
                        query = baseQ.startAt(prevCursor).limit(wsOrdPageSize + 1);
                    }
                } else {
                    // First page
                    query = baseQ.limit(wsOrdPageSize + 1);
                    wsOrdPage = 1;
                    wsOrdPageStack = [];
                }

                const snap = await query.get();
                const docs = snap.docs;

                // Check if there are more
                wsOrdHasNext = docs.length > wsOrdPageSize;
                const pageDocs = wsOrdHasNext ? docs.slice(0, wsOrdPageSize) : docs;

                this._allOrders = pageDocs.map(doc => ({ id: doc.id, ...doc.data() }));
                wsOrdFirstDoc = pageDocs.length > 0 ? pageDocs[0] : null;
                wsOrdLastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;

                // Get total count for stats (cached, refresh only on first load or filter change)
                if (direction === 'first' || wsOrdTotalEstimate === 0) {
                    this._loadOrderStats(businessId);
                }

                this._applyClientSearch();
                this._renderPagination();
            } catch (err) {
                console.error('Wholesale orders load error:', err);
                if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="ws-empty-row"><div class="ws-empty-items"><i class="fas fa-exclamation-triangle"></i><p>Failed to load orders</p></div></td></tr>';
            } finally {
                wsOrdIsLoading = false;
            }
        },

        _loadOrderStats: async function (businessId) {
            try {
                const col = getBusinessCollection(businessId, 'wholesale_orders');
                if (!col) return;
                // Use a lightweight aggregation - count docs
                const snap = await col.get();
                const allDocs = [];
                snap.forEach(doc => allDocs.push(doc.data()));
                wsOrdTotalEstimate = allDocs.length;

                const totalEl = document.getElementById('ws-stat-total');
                const confirmedEl = document.getElementById('ws-stat-confirmed');
                const draftEl = document.getElementById('ws-stat-draft');
                const revenueEl = document.getElementById('ws-stat-revenue');
                const unpaidEl = document.getElementById('ws-stat-unpaid');

                if (totalEl) totalEl.textContent = allDocs.length.toLocaleString();
                if (confirmedEl) confirmedEl.textContent = allDocs.filter(o => o.status === 'confirmed' || o.status === 'delivered').length.toLocaleString();
                if (draftEl) draftEl.textContent = allDocs.filter(o => o.status === 'draft').length.toLocaleString();
                if (unpaidEl) unpaidEl.textContent = allDocs.filter(o => o.paymentStatus === 'unpaid').length.toLocaleString();

                const revenue = allDocs.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + (o.grandTotal || 0), 0);
                if (revenueEl) revenueEl.textContent = this.formatCurrency(revenue);
            } catch (err) {
                console.error('Order stats error:', err);
            }
        },

        _applyClientSearch: function () {
            // Apply client-side text search on already-fetched page
            const query = (document.getElementById('ws-manage-search')?.value || '').toLowerCase().trim();
            let filtered = this._allOrders;
            if (query) {
                filtered = filtered.filter(o => {
                    const id = (o.orderId || '').toLowerCase();
                    const inv = (o.invoiceNo || '').toLowerCase();
                    const cust = (o.customer?.name || '').toLowerCase();
                    return id.includes(query) || inv.includes(query) || cust.includes(query);
                });
            }
            this._renderOrders(filtered);
        },

        _renderPagination: function () {
            let pager = document.getElementById('ws-orders-pagination');
            if (!pager) {
                const tableWrap = document.querySelector('.ws-orders-table-wrap');
                if (!tableWrap) return;
                pager = document.createElement('div');
                pager.id = 'ws-orders-pagination';
                pager.className = 'ws-pagination';
                tableWrap.after(pager);
            }

            const totalPages = wsOrdTotalEstimate > 0 ? Math.ceil(wsOrdTotalEstimate / wsOrdPageSize) : '?';
            const hasPrev = wsOrdPage > 1;

            pager.innerHTML = `
                <div class="ws-pagination-info">
                    Showing page <strong>${wsOrdPage}</strong>${totalPages !== '?' ? ' of <strong>' + totalPages.toLocaleString() + '</strong>' : ''}
                    &nbsp;·&nbsp; ${wsOrdTotalEstimate.toLocaleString()} total orders
                </div>
                <div class="ws-pagination-controls">
                    <select id="ws-page-size" class="ws-select ws-page-size-select">
                        <option value="10" ${wsOrdPageSize === 10 ? 'selected' : ''}>10 / page</option>
                        <option value="25" ${wsOrdPageSize === 25 ? 'selected' : ''}>25 / page</option>
                        <option value="50" ${wsOrdPageSize === 50 ? 'selected' : ''}>50 / page</option>
                        <option value="100" ${wsOrdPageSize === 100 ? 'selected' : ''}>100 / page</option>
                    </select>
                    <button class="btn btn-sm btn-outline ws-page-btn" id="ws-page-prev" ${!hasPrev ? 'disabled' : ''}>
                        <i class="fas fa-chevron-left"></i> Prev
                    </button>
                    <button class="btn btn-sm btn-outline ws-page-btn" id="ws-page-next" ${!wsOrdHasNext ? 'disabled' : ''}>
                        Next <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            `;

            const self = this;
            const businessId = this.getBusinessId();

            document.getElementById('ws-page-prev')?.addEventListener('click', () => {
                if (hasPrev) self._loadOrdersPage(businessId, 'prev');
            });
            document.getElementById('ws-page-next')?.addEventListener('click', () => {
                if (wsOrdHasNext) {
                    wsOrdPageStack.push(wsOrdFirstDoc);
                    wsOrdPage++;
                    self._loadOrdersPage(businessId, 'next');
                }
            });
            document.getElementById('ws-page-size')?.addEventListener('change', function () {
                wsOrdPageSize = parseInt(this.value) || 25;
                wsOrdPage = 1;
                wsOrdPageStack = [];
                wsOrdFirstDoc = null;
                wsOrdLastDoc = null;
                self._loadOrdersPage(businessId, 'first');
            });
        },

        _renderOrders: function (orders) {
            const tbody = document.getElementById('ws-orders-list');
            if (!tbody) return;

            if (orders.length === 0) {
                tbody.innerHTML = `<tr><td colspan="10" class="ws-empty-row">
                    <div class="ws-empty-items">
                        <i class="fas fa-folder-open"></i>
                        <p>No orders found</p>
                    </div>
                </td></tr>`;
                return;
            }

            tbody.innerHTML = orders.map(o => {
                const statusBadge = this._statusBadge(o.status);
                const paymentBadge = this._paymentBadge(o.paymentStatus);
                const dateStr = o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

                return `
                    <tr>
                        <td><strong class="ws-order-id">${this.escapeHtml(o.orderId || o.id)}</strong></td>
                        <td>${this.escapeHtml(o.invoiceNo || 'N/A')}</td>
                        <td>${this.escapeHtml(o.customer?.name || 'N/A')}</td>
                        <td>${o.itemCount || (o.items ? o.items.length : 0)}</td>
                        <td style="text-align:right"><strong>${this.formatCurrency(o.grandTotal)}</strong></td>
                        <td>${paymentBadge}</td>
                        <td>${statusBadge}</td>
                        <td>${this._dispatchBadge(o.dispatch)}</td>
                        <td><small>${dateStr}</small></td>
                        <td style="text-align:center">
                            <div class="ws-action-group">
                                <button class="ws-action-btn ws-action--view" data-id="${o.orderId || o.id}" title="View Invoice">
                                    <i class="fas fa-file-invoice"></i>
                                </button>
                                ${o.status === 'draft' ? `
                                <button class="ws-action-btn ws-action--confirm" data-id="${o.orderId || o.id}" title="Confirm Order">
                                    <i class="fas fa-check"></i>
                                </button>` : ''}
                                ${o.status === 'confirmed' ? `
                                <button class="ws-action-btn ws-action--deliver" data-id="${o.orderId || o.id}" title="Mark Delivered">
                                    <i class="fas fa-truck"></i>
                                </button>` : ''}
                                ${o.paymentStatus !== 'paid' && o.status !== 'cancelled' ? `
                                <button class="ws-action-btn ws-action--paid" data-id="${o.orderId || o.id}" title="Mark as Paid">
                                    <i class="fas fa-money-check-alt"></i>
                                </button>` : ''}
                                ${o.status !== 'cancelled' && o.status !== 'delivered' ? `
                                <button class="ws-action-btn ws-action--cancel" data-id="${o.orderId || o.id}" title="Cancel Order">
                                    <i class="fas fa-ban"></i>
                                </button>` : ''}
                                ${o.status !== 'cancelled' ? `
                                <button class="ws-action-btn ws-action--dispatch" data-id="${o.orderId || o.id}" title="Assign Rider">
                                    <i class="fas fa-motorcycle"></i>
                                </button>` : ''}
                                ${o.dispatch?.riderId ? `
                                <button class="ws-action-btn ws-action--track" data-id="${o.orderId || o.id}" title="Track Delivery">
                                    <i class="fas fa-map-marker-alt"></i>
                                </button>` : ''}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            // Bind action buttons
            const self = this;
            tbody.querySelectorAll('.ws-action--view').forEach(btn => {
                btn.addEventListener('click', () => {
                    const order = self._allOrders.find(o => (o.orderId || o.id) === btn.dataset.id);
                    if (order) self._showInvoice(order);
                });
            });
            tbody.querySelectorAll('.ws-action--confirm').forEach(btn => {
                btn.addEventListener('click', () => self._updateOrderStatus(btn.dataset.id, 'confirmed'));
            });
            tbody.querySelectorAll('.ws-action--deliver').forEach(btn => {
                btn.addEventListener('click', () => self._updateOrderStatus(btn.dataset.id, 'delivered'));
            });
            tbody.querySelectorAll('.ws-action--cancel').forEach(btn => {
                btn.addEventListener('click', () => self._updateOrderStatus(btn.dataset.id, 'cancelled'));
            });
            tbody.querySelectorAll('.ws-action--paid').forEach(btn => {
                btn.addEventListener('click', () => self._markAsPaid(btn.dataset.id));
            });
            tbody.querySelectorAll('.ws-action--dispatch').forEach(btn => {
                btn.addEventListener('click', () => self._showAssignRiderModal(btn.dataset.id));
            });
            tbody.querySelectorAll('.ws-action--track').forEach(btn => {
                btn.addEventListener('click', () => self._showTrackModal(btn.dataset.id));
            });
        },

        _statusBadge: function (status) {
            const map = {
                'draft': { cls: 'ws-badge--orange', label: 'Draft' },
                'confirmed': { cls: 'ws-badge--blue', label: 'Confirmed' },
                'delivered': { cls: 'ws-badge--green', label: 'Delivered' },
                'cancelled': { cls: 'ws-badge--red', label: 'Cancelled' }
            };
            const info = map[status] || { cls: 'ws-badge--blue', label: status || 'Unknown' };
            return '<span class="ws-badge ' + info.cls + '">' + info.label + '</span>';
        },

        _paymentBadge: function (status) {
            const map = {
                'paid': { cls: 'ws-badge--green', label: 'Paid' },
                'partial': { cls: 'ws-badge--orange', label: 'Partial' },
                'unpaid': { cls: 'ws-badge--red', label: 'Unpaid' }
            };
            const info = map[status] || { cls: 'ws-badge--red', label: status || 'Unknown' };
            return '<span class="ws-badge ' + info.cls + '">' + info.label + '</span>';
        },

        _markAsPaid: async function (orderId) {
            const businessId = this.getBusinessId();
            if (!businessId) return;

            const confirmed = await PharmaFlow.confirm({
                title: 'Mark as Paid',
                message: 'Mark order <strong>' + this.escapeHtml(orderId) + '</strong> as fully paid?',
                confirmText: 'Mark Paid',
                type: 'info'
            });
            if (!confirmed) return;

            try {
                await getBusinessCollection(businessId, 'wholesale_orders').doc(orderId).update({
                    paymentStatus: 'paid',
                    paidAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });

                // Also update linked sale record if it exists
                const saleRef = getBusinessCollection(businessId, 'sales').doc(orderId);
                const saleSnap = await saleRef.get();
                if (saleSnap.exists) {
                    await saleRef.update({ paymentStatus: 'paid', updatedAt: new Date().toISOString() });
                }

                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Wholesale Order Marked Paid',
                        description: 'Order ' + orderId + ' payment marked as paid',
                        category: 'Wholesale',
                        status: 'COMPLETED',
                        metadata: { orderId: orderId }
                    });
                }

                this.showToast('Order marked as paid');
            } catch (err) {
                console.error('Mark paid error:', err);
                this.showToast('Failed to mark as paid: ' + err.message, 'error');
            }
        },

        _updateOrderStatus: async function (orderId, newStatus) {
            const businessId = this.getBusinessId();
            if (!businessId) return;

            try {
                await getBusinessCollection(businessId, 'wholesale_orders').doc(orderId).update({
                    status: newStatus,
                    updatedAt: new Date().toISOString()
                });

                // If confirming, decrement inventory for inventory-sourced items
                if (newStatus === 'confirmed') {
                    const order = this._allOrders.find(o => (o.orderId || o.id) === orderId);
                    if (order && order.items) {
                        const invItems = order.items.filter(i => i.inventoryId);
                        if (invItems.length > 0) {
                            const batch = window.db.batch();
                            invItems.forEach(item => {
                                const ref = getBusinessCollection(businessId, 'inventory').doc(item.inventoryId);
                                batch.update(ref, {
                                    quantity: firebase.firestore.FieldValue.increment(-item.quantity),
                                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                                });
                            });
                            await batch.commit();
                        }

                        // Also create a sale record
                        const saleData = {
                            saleId: orderId,
                            items: order.items,
                            subtotal: order.subtotal || 0,
                            total: order.grandTotal || 0,
                            paymentMethod: order.paymentMethod || 'cash',
                            amountPaid: order.amountPaid || 0,
                            changeDue: 0,
                            itemCount: order.itemCount || order.items.length,
                            customerName: order.customer?.name || 'Wholesale Customer',
                            type: 'wholesale',
                            soldBy: this.getCurrentUser(),
                            status: 'completed',
                            createdAt: new Date().toISOString()
                        };
                        await getBusinessCollection(businessId, 'sales').doc(orderId).set(saleData);
                    }
                }

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Wholesale Order ' + (newStatus === 'confirmed' ? 'Confirmed' : newStatus === 'delivered' ? 'Delivered' : 'Cancelled'),
                        description: 'Order ' + orderId + ' status changed to ' + newStatus,
                        category: 'Wholesale',
                        status: 'COMPLETED',
                        metadata: { orderId: orderId, newStatus: newStatus }
                    });
                }

                const labels = { confirmed: 'confirmed', delivered: 'marked as delivered', cancelled: 'cancelled' };
                this.showToast('Order ' + (labels[newStatus] || newStatus));
            } catch (err) {
                console.error('Order status update error:', err);
                this.showToast('Failed to update: ' + err.message, 'error');
            }
        },

        /* ══════════════════════════════════════════════════════
         * INVOICE VIEWER + PRINT
         * ══════════════════════════════════════════════════════ */

        _showInvoice: function (order) {
            const existing = document.getElementById('ws-invoice-modal');
            if (existing) existing.remove();

            const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
            const timeStr = order.createdAt ? new Date(order.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '';
            const dueStr = order.dueDate ? new Date(order.dueDate).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';
            const bizName = PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow';
            const bizTagline = PharmaFlow.Settings ? PharmaFlow.Settings.getTagline() : 'Pharmacy Management System';
            const invFooter = PharmaFlow.Settings ? PharmaFlow.Settings.getInvoiceFooter() : 'Thank you for your business!';
            const invGenerated = PharmaFlow.Settings ? PharmaFlow.Settings.getInvoiceGenerated() : 'This invoice was generated by PharmaFlow Pharmacy Management System';
            const totalQty = (order.items || []).reduce((s, i) => s + (i.quantity || 0), 0);

            const itemsHtml = (order.items || []).map((item, i) => `
                <tr class="rcpt-row">
                    <td class="rcpt-cell-num">${i + 1}</td>
                    <td class="rcpt-cell-desc">
                        ${this.escapeHtml(item.name)}${item.sku ? '  <span class="rcpt-sku">[' + this.escapeHtml(item.sku) + ']</span>' : ''}${item.notes ? '<br><span class="rcpt-note">Note: ' + this.escapeHtml(item.notes) + '</span>' : ''}
                    </td>
                    <td class="rcpt-cell-qty">${item.quantity}</td>
                    <td class="rcpt-cell-price">${this.formatCurrency(item.unitPrice)}</td>
                    <td class="rcpt-cell-amount">${this.formatCurrency(item.lineTotal)}</td>
                </tr>
            `).join('');

            const modal = document.createElement('div');
            modal.className = 'ws-modal-overlay';
            modal.id = 'ws-invoice-modal';
            modal.innerHTML = `
                <div class="ws-invoice-container">
                    <div class="ws-invoice rcpt-invoice" id="ws-invoice-content">

                        <div class="rcpt-header">
                            <div class="rcpt-biz-name">${this.escapeHtml(bizName.toUpperCase())}</div>
                            <div class="rcpt-biz-tagline">${this.escapeHtml(bizTagline)}</div>
                            <div class="rcpt-divider-double"></div>
                            <div class="rcpt-doc-title">WHOLESALE INVOICE</div>
                            <div class="rcpt-divider"></div>
                        </div>

                        <div class="rcpt-meta">
                            <div class="rcpt-meta-row"><span class="rcpt-label">Invoice No.:</span><span class="rcpt-value">${this.escapeHtml(order.invoiceNo || 'N/A')}</span></div>
                            <div class="rcpt-meta-row"><span class="rcpt-label">Order ID:</span><span class="rcpt-value">${this.escapeHtml(order.orderId || 'N/A')}</span></div>
                            <div class="rcpt-meta-row"><span class="rcpt-label">Date:</span><span class="rcpt-value">${dateStr}  ${timeStr}</span></div>
                            <div class="rcpt-meta-row"><span class="rcpt-label">Due Date:</span><span class="rcpt-value">${dueStr}</span></div>
                            <div class="rcpt-meta-row"><span class="rcpt-label">Status:</span><span class="rcpt-value">${(order.status || 'N/A').toUpperCase()}</span></div>
                            <div class="rcpt-meta-row"><span class="rcpt-label">Payment:</span><span class="rcpt-value">${(order.paymentStatus || 'N/A').toUpperCase()}</span></div>
                            <div class="rcpt-meta-row"><span class="rcpt-label">Served By:</span><span class="rcpt-value">${this.escapeHtml(order.createdBy || 'Staff')}</span></div>
                        </div>

                        <div class="rcpt-divider"></div>

                        <div class="rcpt-section">
                            <div class="rcpt-section-title">BILL TO</div>
                            <div class="rcpt-meta-row"><span class="rcpt-label">Name:</span><span class="rcpt-value">${this.escapeHtml(order.customer?.name || 'N/A')}</span></div>
                            ${order.customer?.phone ? '<div class="rcpt-meta-row"><span class="rcpt-label">Phone:</span><span class="rcpt-value">' + this.escapeHtml(order.customer.phone) + '</span></div>' : ''}
                            ${order.customer?.email ? '<div class="rcpt-meta-row"><span class="rcpt-label">Email:</span><span class="rcpt-value">' + this.escapeHtml(order.customer.email) + '</span></div>' : ''}
                            ${order.customer?.address ? '<div class="rcpt-meta-row"><span class="rcpt-label">Address:</span><span class="rcpt-value">' + this.escapeHtml(order.customer.address) + '</span></div>' : ''}
                        </div>

                        <div class="rcpt-divider-double"></div>

                        <table class="rcpt-table">
                            <thead>
                                <tr>
                                    <th class="rcpt-th-num">#</th>
                                    <th class="rcpt-th-desc">ITEM DESCRIPTION</th>
                                    <th class="rcpt-th-qty">QTY</th>
                                    <th class="rcpt-th-price">PRICE</th>
                                    <th class="rcpt-th-amount">AMOUNT</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${itemsHtml}
                            </tbody>
                        </table>

                        <div class="rcpt-divider"></div>

                        <div class="rcpt-totals">
                            <div class="rcpt-total-line"><span>Total Items:</span><span>${totalQty}</span></div>
                            <div class="rcpt-total-line"><span>Subtotal:</span><span>${this.formatCurrency(order.subtotal)}</span></div>
                            ${order.discountAmount > 0 ? '<div class="rcpt-total-line"><span>Discount' + (order.discountType === 'percent' ? ' (' + order.discountValue + '%)' : '') + ':</span><span>-' + this.formatCurrency(order.discountAmount) + '</span></div>' : ''}
                            ${order.applyTax ? '<div class="rcpt-total-line"><span>VAT (16%):</span><span>' + this.formatCurrency(order.taxAmount) + '</span></div>' : ''}
                            <div class="rcpt-divider"></div>
                            <div class="rcpt-total-line rcpt-grand-total"><span>TOTAL DUE:</span><span>${this.formatCurrency(order.grandTotal)}</span></div>
                            <div class="rcpt-divider-double"></div>
                            <div class="rcpt-total-line"><span>Amount Paid:</span><span>${this.formatCurrency(order.amountPaid || 0)}</span></div>
                            ${(order.balanceDue || 0) > 0 ? '<div class="rcpt-total-line rcpt-balance-due"><span>BALANCE DUE:</span><span>' + this.formatCurrency(order.balanceDue) + '</span></div>' : '<div class="rcpt-total-line"><span>Balance:</span><span>KSH 0.00</span></div>'}
                        </div>

                        <div class="rcpt-divider"></div>

                        <div class="rcpt-section">
                            <div class="rcpt-meta-row"><span class="rcpt-label">Pay Method:</span><span class="rcpt-value">${this.escapeHtml((order.paymentMethod || 'N/A').replace(/_/g, ' ').toUpperCase())}</span></div>
                        </div>

                        ${order.notes ? '<div class="rcpt-divider"></div><div class="rcpt-section"><div class="rcpt-section-title">NOTES</div><div class="rcpt-notes-text">' + this.escapeHtml(order.notes) + '</div></div>' : ''}

                        <div class="rcpt-divider-double"></div>

                        <div class="rcpt-footer">
                            <div class="rcpt-footer-msg">${this.escapeHtml(invFooter)}</div>
                            <div class="rcpt-footer-gen">${this.escapeHtml(invGenerated)}</div>
                        </div>

                    </div>

                    <div class="ws-invoice-actions">
                        <button class="btn btn-primary" id="ws-print-invoice">
                            <i class="fas fa-print"></i> Print
                        </button>
                        <button class="btn btn-outline" id="ws-download-pdf">
                            <i class="fas fa-file-pdf"></i> PDF
                        </button>
                        <button class="btn btn-outline" id="ws-close-invoice">
                            <i class="fas fa-times"></i> Close
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            const closeModal = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };

            document.getElementById('ws-close-invoice').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

            document.getElementById('ws-print-invoice').addEventListener('click', () => {
                this._printInvoice(order);
            });

            document.getElementById('ws-download-pdf').addEventListener('click', () => {
                this._downloadInvoicePdf(order);
            });
        },

        _getInvoicePrintCSS: function () {
            return `
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Courier New', Courier, 'Lucida Console', monospace; color: #000; background: #fff; font-size: 12px; line-height: 1.4; }
                .rcpt-invoice { max-width: 760px; margin: 0 auto; padding: 32px 40px; }
                .rcpt-header { text-align: center; margin-bottom: 4px; }
                .rcpt-biz-name { font-size: 20px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; }
                .rcpt-biz-tagline { font-size: 11px; margin-top: 2px; }
                .rcpt-doc-title { font-size: 16px; font-weight: 700; letter-spacing: 4px; text-align: center; padding: 6px 0; }
                .rcpt-divider { border: none; border-top: 1px dashed #000; margin: 8px 0; height: 0; }
                .rcpt-divider-double { border: none; border-top: 3px double #000; margin: 8px 0; height: 0; }
                .rcpt-meta { padding: 4px 0; }
                .rcpt-meta-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 12px; }
                .rcpt-label { font-weight: 700; min-width: 120px; }
                .rcpt-value { text-align: right; }
                .rcpt-section { padding: 4px 0; }
                .rcpt-section-title { font-weight: 700; font-size: 12px; letter-spacing: 1px; border-bottom: 1px solid #000; padding-bottom: 2px; margin-bottom: 4px; }
                .rcpt-table { width: 100%; border-collapse: collapse; font-size: 12px; }
                .rcpt-table th { text-align: left; font-weight: 700; padding: 6px 4px; border-bottom: 2px solid #000; border-top: 2px solid #000; font-size: 11px; letter-spacing: 0.5px; }
                .rcpt-th-num { width: 30px; text-align: center; }
                .rcpt-th-desc { text-align: left; }
                .rcpt-th-qty { width: 45px; text-align: center; }
                .rcpt-th-price { width: 100px; text-align: right; }
                .rcpt-th-amount { width: 100px; text-align: right; }
                .rcpt-table td { padding: 5px 4px; border-bottom: 1px dotted #999; vertical-align: top; }
                .rcpt-cell-num { text-align: center; }
                .rcpt-cell-desc { text-align: left; }
                .rcpt-cell-qty { text-align: center; font-weight: 700; }
                .rcpt-cell-price { text-align: right; }
                .rcpt-cell-amount { text-align: right; font-weight: 700; }
                .rcpt-sku { font-size: 10px; }
                .rcpt-note { font-size: 10px; font-style: italic; }
                .rcpt-totals { padding: 4px 0; }
                .rcpt-total-line { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; }
                .rcpt-grand-total { font-size: 15px; font-weight: 700; padding: 6px 0; }
                .rcpt-balance-due { font-weight: 700; font-size: 13px; }
                .rcpt-notes-text { font-size: 11px; padding: 4px 0; font-style: italic; }
                .rcpt-footer { text-align: center; padding: 10px 0 4px; }
                .rcpt-footer-msg { font-size: 12px; font-weight: 700; }
                .rcpt-footer-gen { font-size: 9px; margin-top: 4px; }
                @media print { body { padding: 10px; } }
            `;
        },

        _printInvoice: function (order) {
            const content = document.getElementById('ws-invoice-content');
            if (!content) return;

            const printWin = window.open('', '_blank', 'width=820,height=1050');
            printWin.document.write(`
                <html><head><title>Invoice - ${this.escapeHtml(order.invoiceNo || order.orderId)}</title>
                <style>${this._getInvoicePrintCSS()}</style>
                </head><body>${content.innerHTML}</body></html>
            `);
            printWin.document.close();
            printWin.focus();
            setTimeout(() => { printWin.print(); }, 400);
        },

        _downloadInvoicePdf: function (order) {
            if (typeof window.jspdf === 'undefined' && typeof jspdf === 'undefined') {
                this.showToast('PDF library not loaded', 'error');
                return;
            }

            const { jsPDF } = window.jspdf || jspdf;
            const doc = new jsPDF();
            const bizName = PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow';
            const bizTagline = PharmaFlow.Settings ? PharmaFlow.Settings.getTagline() : 'Pharmacy Management System';
            const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
            const timeStr = order.createdAt ? new Date(order.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '';
            const dueStr = order.dueDate ? new Date(order.dueDate).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A';
            const totalQty = (order.items || []).reduce((s, i) => s + (i.quantity || 0), 0);

            doc.setFont('courier', 'normal');
            const L = 14;
            const R = 196;

            // Header
            doc.setFontSize(16);
            doc.text(bizName.toUpperCase(), 105, 16, { align: 'center' });
            doc.setFontSize(9);
            doc.text(bizTagline, 105, 22, { align: 'center' });

            // Double line
            doc.setLineWidth(0.8);
            doc.setDrawColor(0);
            doc.line(L, 26, R, 26);
            doc.line(L, 27.5, R, 27.5);

            doc.setFontSize(13);
            doc.text('WHOLESALE INVOICE', 105, 34, { align: 'center' });

            // Dashed line
            doc.setLineWidth(0.3);
            doc.setLineDashPattern([2, 2], 0);
            doc.line(L, 37, R, 37);
            doc.setLineDashPattern([], 0);

            // Meta details
            let y = 44;
            doc.setFontSize(9);
            const metaLines = [
                ['Invoice No.:', order.invoiceNo || 'N/A'],
                ['Order ID:', order.orderId || 'N/A'],
                ['Date:', dateStr + '  ' + timeStr],
                ['Due Date:', dueStr],
                ['Status:', (order.status || 'N/A').toUpperCase()],
                ['Payment:', (order.paymentStatus || 'N/A').toUpperCase()],
                ['Served By:', order.createdBy || 'Staff']
            ];
            metaLines.forEach(([label, value]) => {
                doc.setFont('courier', 'bold');
                doc.text(label, L, y);
                doc.setFont('courier', 'normal');
                doc.text(value, R, y, { align: 'right' });
                y += 5;
            });

            // Dashed line
            doc.setLineDashPattern([2, 2], 0);
            doc.line(L, y, R, y);
            doc.setLineDashPattern([], 0);
            y += 6;

            // Bill To
            doc.setFont('courier', 'bold');
            doc.text('BILL TO', L, y);
            doc.setLineWidth(0.3);
            doc.line(L, y + 1, L + 25, y + 1);
            y += 6;
            doc.setFont('courier', 'normal');
            const custLines = [
                ['Name:', order.customer?.name || 'N/A'],
                order.customer?.phone ? ['Phone:', order.customer.phone] : null,
                order.customer?.email ? ['Email:', order.customer.email] : null,
                order.customer?.address ? ['Address:', order.customer.address] : null
            ].filter(Boolean);
            custLines.forEach(([label, value]) => {
                doc.setFont('courier', 'bold');
                doc.text(label, L, y);
                doc.setFont('courier', 'normal');
                doc.text(value, R, y, { align: 'right' });
                y += 5;
            });

            // Double line
            y += 2;
            doc.setLineWidth(0.8);
            doc.setLineDashPattern([], 0);
            doc.line(L, y, R, y);
            doc.line(L, y + 1.5, R, y + 1.5);
            y += 5;

            // Items table
            const tableData = (order.items || []).map((item, i) => [
                String(i + 1),
                item.name + (item.sku ? ' [' + item.sku + ']' : ''),
                String(item.quantity),
                this.formatCurrency(item.unitPrice),
                this.formatCurrency(item.lineTotal)
            ]);

            doc.autoTable({
                startY: y,
                head: [['#', 'ITEM DESCRIPTION', 'QTY', 'PRICE', 'AMOUNT']],
                body: tableData,
                theme: 'plain',
                styles: { font: 'courier', fontSize: 8.5, cellPadding: 3, textColor: [0, 0, 0], lineColor: [0, 0, 0] },
                headStyles: { fontStyle: 'bold', fontSize: 8, lineWidth: { top: 0.5, bottom: 0.5 } },
                bodyStyles: { lineWidth: { bottom: 0.15 } },
                columnStyles: {
                    0: { cellWidth: 12, halign: 'center' },
                    2: { halign: 'center', cellWidth: 16, fontStyle: 'bold' },
                    3: { halign: 'right', cellWidth: 30 },
                    4: { halign: 'right', cellWidth: 30, fontStyle: 'bold' }
                }
            });

            // Totals
            let fY = doc.lastAutoTable.finalY + 4;
            doc.setLineDashPattern([2, 2], 0);
            doc.setLineWidth(0.3);
            doc.line(L, fY, R, fY);
            doc.setLineDashPattern([], 0);
            fY += 6;

            const totRow = (label, value, big) => {
                doc.setFont('courier', big ? 'bold' : 'normal');
                doc.setFontSize(big ? 11 : 9);
                doc.text(label, 120, fY);
                doc.text(value, R, fY, { align: 'right' });
                fY += big ? 7 : 5;
            };

            totRow('Total Items:', String(totalQty));
            totRow('Subtotal:', this.formatCurrency(order.subtotal));
            if (order.discountAmount > 0) totRow('Discount' + (order.discountType === 'percent' ? ' (' + order.discountValue + '%)' : '') + ':', '-' + this.formatCurrency(order.discountAmount));
            if (order.applyTax) totRow('VAT (16%):', this.formatCurrency(order.taxAmount));

            // Grand total with lines
            doc.setLineWidth(0.3);
            doc.setLineDashPattern([2, 2], 0);
            doc.line(120, fY - 2, R, fY - 2);
            doc.setLineDashPattern([], 0);
            fY += 2;
            totRow('TOTAL DUE:', this.formatCurrency(order.grandTotal), true);
            doc.setLineWidth(0.8);
            doc.line(120, fY - 3, R, fY - 3);
            doc.line(120, fY - 1.5, R, fY - 1.5);
            fY += 3;

            totRow('Amount Paid:', this.formatCurrency(order.amountPaid || 0));
            if ((order.balanceDue || 0) > 0) {
                totRow('BALANCE DUE:', this.formatCurrency(order.balanceDue), true);
            } else {
                totRow('Balance:', 'KSH 0.00');
            }

            // Payment method
            fY += 2;
            doc.setLineDashPattern([2, 2], 0);
            doc.setLineWidth(0.3);
            doc.line(L, fY, R, fY);
            doc.setLineDashPattern([], 0);
            fY += 6;
            doc.setFont('courier', 'bold');
            doc.setFontSize(9);
            doc.text('Pay Method:', L, fY);
            doc.setFont('courier', 'normal');
            doc.text((order.paymentMethod || 'N/A').replace(/_/g, ' ').toUpperCase(), R, fY, { align: 'right' });
            fY += 6;

            if (order.notes) {
                doc.setLineDashPattern([2, 2], 0);
                doc.line(L, fY, R, fY);
                doc.setLineDashPattern([], 0);
                fY += 6;
                doc.setFont('courier', 'bold');
                doc.text('NOTES', L, fY);
                fY += 5;
                doc.setFont('courier', 'normal');
                doc.setFontSize(8);
                doc.text(order.notes, L, fY, { maxWidth: R - L });
                fY += 8;
            }

            // Footer
            doc.setLineWidth(0.8);
            doc.setLineDashPattern([], 0);
            doc.line(L, fY, R, fY);
            doc.line(L, fY + 1.5, R, fY + 1.5);
            fY += 8;
            doc.setFont('courier', 'bold');
            doc.setFontSize(9);
            doc.text(PharmaFlow.Settings ? PharmaFlow.Settings.getInvoiceFooter() : 'Thank you for your business!', 105, fY, { align: 'center' });
            doc.setFont('courier', 'normal');
            doc.setFontSize(7);
            doc.text(PharmaFlow.Settings ? PharmaFlow.Settings.getInvoiceGenerated() : 'Generated by PharmaFlow', 105, fY + 5, { align: 'center' });

            doc.save('Invoice-' + (order.invoiceNo || order.orderId) + '.pdf');
            this.showToast('PDF downloaded!');
        },

        /* ══════════════════════════════════════════════════════
         * RIDERS MANAGEMENT
         * ══════════════════════════════════════════════════════ */

        _ridersCache: [],
        _ridersUnsub: null,

        renderRiders: function (container) {
            this.cleanup();
            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="ws-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-motorcycle"></i> Delivery Riders</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Wholesale</span><span>/</span>
                                <span>Riders</span>
                            </div>
                        </div>
                        <div class="page-header-right">
                            <button class="btn btn-sm btn-primary" id="ws-add-rider-btn">
                                <i class="fas fa-plus"></i> Add Rider
                            </button>
                        </div>
                    </div>

                    <div class="ws-manage-stats" id="ws-rider-stats">
                        <div class="ws-stat-mini ws-stat--blue">
                            <i class="fas fa-users"></i>
                            <div>
                                <span class="ws-stat-num" id="ws-rider-total">0</span>
                                <span class="ws-stat-label">Total Riders</span>
                            </div>
                        </div>
                        <div class="ws-stat-mini ws-stat--green">
                            <i class="fas fa-circle-check"></i>
                            <div>
                                <span class="ws-stat-num" id="ws-rider-available">0</span>
                                <span class="ws-stat-label">Available</span>
                            </div>
                        </div>
                        <div class="ws-stat-mini ws-stat--orange">
                            <i class="fas fa-road"></i>
                            <div>
                                <span class="ws-stat-num" id="ws-rider-dispatched">0</span>
                                <span class="ws-stat-label">On Delivery</span>
                            </div>
                        </div>
                    </div>

                    <div class="card ws-card">
                        <div class="ws-filter-row">
                            <div class="ws-search-bar ws-manage-search">
                                <i class="fas fa-search"></i>
                                <input type="text" id="ws-rider-search" placeholder="Search rider name, phone..." autocomplete="off">
                            </div>
                            <select id="ws-rider-type-filter" class="ws-select ws-filter-select">
                                <option value="all">All Types</option>
                                <option value="motorbike">Motorbike</option>
                                <option value="van">Van</option>
                                <option value="truck">Truck</option>
                                <option value="plane">Plane</option>
                                <option value="cargo">Cargo</option>
                                <option value="overseas">Overseas</option>
                            </select>
                        </div>

                        <div class="ws-orders-table-wrap">
                            <table class="ws-orders-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Name</th>
                                        <th>Phone</th>
                                        <th>Agent Type</th>
                                        <th>Vehicle / Reg</th>
                                        <th>Status</th>
                                        <th>Deliveries</th>
                                        <th style="text-align:center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="ws-riders-tbody">
                                    <tr><td colspan="8" class="ws-loading-cell"><div class="spinner"></div> Loading riders...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });

            document.getElementById('ws-add-rider-btn')?.addEventListener('click', () => this._showRiderModal());

            const self = this;
            let riderDebounce;
            document.getElementById('ws-rider-search')?.addEventListener('input', function () {
                clearTimeout(riderDebounce);
                riderDebounce = setTimeout(() => self._filterRiders(), 200);
            });
            document.getElementById('ws-rider-type-filter')?.addEventListener('change', () => this._filterRiders());

            this._subscribeRiders(businessId);
        },

        _subscribeRiders: function (businessId) {
            if (this._ridersUnsub) { this._ridersUnsub(); this._ridersUnsub = null; }
            if (!businessId) return;

            const col = getBusinessCollection(businessId, 'riders');
            if (!col) return;

            this._ridersUnsub = col.onSnapshot(snap => {
                this._ridersCache = [];
                snap.forEach(doc => this._ridersCache.push({ id: doc.id, ...doc.data() }));
                this._ridersCache.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                this._updateRiderStats();
                this._filterRiders();
            }, err => console.error('Riders listener error:', err));
        },

        _updateRiderStats: function () {
            const riders = this._ridersCache;
            const el = id => document.getElementById(id);
            if (el('ws-rider-total')) el('ws-rider-total').textContent = riders.length;
            if (el('ws-rider-available')) el('ws-rider-available').textContent = riders.filter(r => r.status === 'available').length;
            if (el('ws-rider-dispatched')) el('ws-rider-dispatched').textContent = riders.filter(r => r.status === 'dispatched').length;
        },

        _filterRiders: function () {
            const query = (document.getElementById('ws-rider-search')?.value || '').toLowerCase().trim();
            const typeFilter = document.getElementById('ws-rider-type-filter')?.value || 'all';

            let filtered = this._ridersCache.filter(r => {
                if (typeFilter !== 'all' && r.agentType !== typeFilter) return false;
                if (query) {
                    const h = ((r.name || '') + ' ' + (r.phone || '') + ' ' + (r.vehicleReg || '')).toLowerCase();
                    if (!h.includes(query)) return false;
                }
                return true;
            });

            this._renderRidersList(filtered);
        },

        _renderRidersList: function (riders) {
            const tbody = document.getElementById('ws-riders-tbody');
            if (!tbody) return;

            if (riders.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="ws-empty-row"><div class="ws-empty-items"><i class="fas fa-motorcycle"></i><p>No riders found</p></div></td></tr>';
                return;
            }

            const typeIcons = {
                motorbike: 'fa-motorcycle', van: 'fa-van-shuttle', truck: 'fa-truck',
                plane: 'fa-plane', cargo: 'fa-ship', overseas: 'fa-globe'
            };

            const self = this;
            tbody.innerHTML = riders.map((r, i) => {
                const icon = typeIcons[r.agentType] || 'fa-truck';
                const statusCls = r.status === 'available' ? 'ws-badge--green' : r.status === 'dispatched' ? 'ws-badge--orange' : 'ws-badge--red';
                const statusLabel = (r.status || 'available').charAt(0).toUpperCase() + (r.status || 'available').slice(1);
                return `<tr>
                    <td>${i + 1}</td>
                    <td><strong>${self.escapeHtml(r.name)}</strong></td>
                    <td>${self.escapeHtml(r.phone || '—')}</td>
                    <td><i class="fas ${icon}" style="margin-right:4px;color:var(--primary)"></i> ${self.escapeHtml((r.agentType || '').charAt(0).toUpperCase() + (r.agentType || '').slice(1))}</td>
                    <td>${self.escapeHtml(r.vehicleReg || '—')}</td>
                    <td><span class="ws-badge ${statusCls}">${statusLabel}</span></td>
                    <td>${r.deliveryCount || 0}</td>
                    <td style="text-align:center">
                        <div class="ws-action-group">
                            <button class="ws-action-btn ws-action--view" data-rider-id="${r.id}" title="Edit"><i class="fas fa-pen"></i></button>
                            <button class="ws-action-btn ws-action--cancel" data-rider-id="${r.id}" title="Delete"><i class="fas fa-trash"></i></button>
                        </div>
                    </td>
                </tr>`;
            }).join('');

            tbody.querySelectorAll('.ws-action--view[data-rider-id]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const rider = self._ridersCache.find(r => r.id === btn.dataset.riderId);
                    if (rider) self._showRiderModal(rider);
                });
            });
            tbody.querySelectorAll('.ws-action--cancel[data-rider-id]').forEach(btn => {
                btn.addEventListener('click', () => self._deleteRider(btn.dataset.riderId));
            });
        },

        _showRiderModal: function (rider) {
            const existing = document.getElementById('ws-rider-modal');
            if (existing) existing.remove();

            const isEdit = !!rider;
            const self = this;

            const modal = document.createElement('div');
            modal.id = 'ws-rider-modal';
            modal.className = 'ws-modal-overlay';
            modal.innerHTML = `
                <div class="ws-modal-box" style="max-width:460px">
                    <div class="modal-header">
                        <h3><i class="fas fa-motorcycle"></i> ${isEdit ? 'Edit' : 'Add'} Rider</h3>
                        <button class="modal-close" id="ws-rider-modal-close">&times;</button>
                    </div>
                    <div class="modal-body" style="padding:20px">
                        <div class="dda-form-row">
                            <div class="dda-form-group" style="flex:1">
                                <label>Full Name *</label>
                                <input type="text" id="ws-rider-name" class="dda-input" value="${self.escapeHtml(rider?.name || '')}" placeholder="Rider name">
                            </div>
                            <div class="dda-form-group" style="flex:1">
                                <label>Phone *</label>
                                <input type="tel" id="ws-rider-phone" class="dda-input" value="${self.escapeHtml(rider?.phone || '')}" placeholder="0712 345 678">
                            </div>
                        </div>
                        <div class="dda-form-row">
                            <div class="dda-form-group" style="flex:1">
                                <label>Agent Type *</label>
                                <select id="ws-rider-type" class="dda-input">
                                    <option value="">Select type...</option>
                                    <option value="motorbike" ${rider?.agentType === 'motorbike' ? 'selected' : ''}>Motorbike</option>
                                    <option value="van" ${rider?.agentType === 'van' ? 'selected' : ''}>Van</option>
                                    <option value="truck" ${rider?.agentType === 'truck' ? 'selected' : ''}>Truck</option>
                                    <option value="plane" ${rider?.agentType === 'plane' ? 'selected' : ''}>Plane</option>
                                    <option value="cargo" ${rider?.agentType === 'cargo' ? 'selected' : ''}>Cargo</option>
                                    <option value="overseas" ${rider?.agentType === 'overseas' ? 'selected' : ''}>Overseas</option>
                                </select>
                            </div>
                            <div class="dda-form-group" style="flex:1">
                                <label>Vehicle / Reg No</label>
                                <input type="text" id="ws-rider-vehicle" class="dda-input" value="${self.escapeHtml(rider?.vehicleReg || '')}" placeholder="e.g. KBZ 123A">
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer" style="padding:12px 20px;display:flex;gap:10px;justify-content:flex-end">
                        <button class="btn btn-sm btn-secondary" id="ws-rider-cancel-btn">Cancel</button>
                        <button class="btn btn-sm btn-primary" id="ws-rider-save-btn">
                            <i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Save'} Rider
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            const close = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            modal.querySelector('#ws-rider-modal-close').addEventListener('click', close);
            modal.querySelector('#ws-rider-cancel-btn').addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            modal.querySelector('#ws-rider-save-btn').addEventListener('click', async () => {
                const name = document.getElementById('ws-rider-name').value.trim();
                const phone = document.getElementById('ws-rider-phone').value.trim();
                const agentType = document.getElementById('ws-rider-type').value;
                const vehicleReg = document.getElementById('ws-rider-vehicle').value.trim();

                if (!name || !phone || !agentType) {
                    self.showToast('Please fill in name, phone and agent type', 'error');
                    return;
                }

                const businessId = self.getBusinessId();
                if (!businessId) return;

                try {
                    const data = {
                        name, phone, agentType, vehicleReg,
                        updatedAt: new Date().toISOString()
                    };
                    if (isEdit) {
                        await getBusinessCollection(businessId, 'riders').doc(rider.id).update(data);
                        self.showToast('Rider updated');
                    } else {
                        data.status = 'available';
                        data.deliveryCount = 0;
                        data.createdAt = new Date().toISOString();
                        await getBusinessCollection(businessId, 'riders').add(data);
                        self.showToast('Rider added');
                    }
                    close();
                } catch (err) {
                    console.error('Save rider error:', err);
                    self.showToast('Failed to save rider: ' + err.message, 'error');
                }
            });
        },

        _deleteRider: async function (riderId) {
            const confirmed = await PharmaFlow.confirm({
                title: 'Delete Rider',
                message: 'Are you sure you want to remove this rider?',
                confirmText: 'Delete',
                type: 'danger'
            });
            if (!confirmed) return;

            const businessId = this.getBusinessId();
            if (!businessId) return;

            try {
                await getBusinessCollection(businessId, 'riders').doc(riderId).delete();
                this.showToast('Rider deleted');
            } catch (err) {
                console.error('Delete rider error:', err);
                this.showToast('Failed to delete: ' + err.message, 'error');
            }
        },

        /* ══════════════════════════════════════════════════════
         * DISPATCH / ASSIGN RIDER TO ORDER
         * ══════════════════════════════════════════════════════ */

        _showAssignRiderModal: function (orderId) {
            const existing = document.getElementById('ws-dispatch-modal');
            if (existing) existing.remove();

            const order = this._allOrders.find(o => (o.orderId || o.id) === orderId);
            if (!order) return;

            const self = this;
            const businessId = this.getBusinessId();
            if (!businessId) return;

            // Fetch latest riders
            getBusinessCollection(businessId, 'riders').get().then(snap => {
                const riders = [];
                snap.forEach(doc => riders.push({ id: doc.id, ...doc.data() }));

                const availableRiders = riders.slice();

                const modal = document.createElement('div');
                modal.id = 'ws-dispatch-modal';
                modal.className = 'ws-modal-overlay';
                modal.innerHTML = `
                    <div class="ws-modal-box" style="max-width:480px">
                        <div class="modal-header">
                            <h3><i class="fas fa-shipping-fast"></i> Assign Rider — ${self.escapeHtml(orderId)}</h3>
                            <button class="modal-close" id="ws-dispatch-close">&times;</button>
                        </div>
                        <div class="modal-body" style="padding:20px">
                            ${order.dispatch?.riderId ? `
                            <div class="ws-dispatch-current">
                                <strong>Current Rider:</strong> ${self.escapeHtml(order.dispatch.riderName || '—')}
                                <span class="ws-badge ws-badge--orange">${self.escapeHtml(order.dispatch.status || 'dispatched')}</span>
                            </div>` : ''}
                            <div class="dda-form-group">
                                <label>Select Rider</label>
                                <select id="ws-dispatch-rider" class="dda-input">
                                    <option value="">Choose rider...</option>
                                    ${availableRiders.map(r => {
                                        const typeIcons = { motorbike: '🏍️', van: '🚐', truck: '🚛', plane: '✈️', cargo: '🚢', overseas: '🌍' };
                                        const sel = (order.dispatch?.riderId === r.id) ? 'selected' : '';
                                        const statusTag = r.status === 'available' ? '✅' : r.status === 'dispatched' ? '📦' : '🚀';
                                        return '<option value="' + r.id + '" ' + sel + '>' + (typeIcons[r.agentType] || '🚚') + ' ' + self.escapeHtml(r.name) + ' ' + statusTag + ' (' + self.escapeHtml(r.agentType || '') + ' · ' + self.escapeHtml(r.phone || '') + ')</option>';
                                    }).join('')}
                                </select>
                            </div>
                            <div class="dda-form-group">
                                <label>Dispatch Notes (optional)</label>
                                <textarea id="ws-dispatch-notes" class="dda-input" rows="2" placeholder="Special instructions...">${self.escapeHtml(order.dispatch?.notes || '')}</textarea>
                            </div>
                            <div id="ws-dispatch-link-box" style="display:none;margin-top:12px">
                                <label style="font-weight:600;font-size:0.82rem;margin-bottom:4px;display:block">
                                    <i class="fas fa-link" style="color:var(--primary)"></i> Rider Link
                                </label>
                                <div style="display:flex;gap:6px">
                                    <input type="text" id="ws-dispatch-link" class="dda-input" readonly style="flex:1;font-size:0.78rem;background:#f8fafc">
                                    <button class="btn btn-sm btn-primary" id="ws-dispatch-copy-btn" style="white-space:nowrap" title="Copy link">
                                        <i class="fas fa-copy"></i> Copy
                                    </button>
                                </div>
                                <div style="display:flex;gap:6px;margin-top:6px">
                                    <button class="btn btn-sm" id="ws-dispatch-share-wa" style="background:#25D366;color:#fff;flex:1;font-size:0.76rem" title="Send via WhatsApp">
                                        <i class="fab fa-whatsapp"></i> WhatsApp
                                    </button>
                                    <button class="btn btn-sm" id="ws-dispatch-share-email" style="background:#4285F4;color:#fff;flex:1;font-size:0.76rem" title="Send via Email">
                                        <i class="fas fa-envelope"></i> Email
                                    </button>
                                    <button class="btn btn-sm" id="ws-dispatch-share-sms" style="background:#6366f1;color:#fff;flex:1;font-size:0.76rem" title="Send via SMS">
                                        <i class="fas fa-sms"></i> SMS
                                    </button>
                                </div>
                                <small style="color:var(--text-tertiary,#64748b);font-size:0.74rem">Share this link with the rider. It's valid for today only.</small>
                            </div>
                        </div>
                        <div class="modal-footer" style="padding:12px 20px;display:flex;gap:10px;justify-content:flex-end">
                            <button class="btn btn-sm btn-secondary" id="ws-dispatch-cancel-btn">Cancel</button>
                            ${order.dispatch?.riderId ? '<button class="btn btn-sm btn-danger" id="ws-dispatch-unassign-btn"><i class="fas fa-user-minus"></i> Unassign</button>' : ''}
                            <button class="btn btn-sm btn-primary" id="ws-dispatch-save-btn"><i class="fas fa-shipping-fast"></i> Dispatch</button>
                        </div>
                    </div>
                `;

                document.body.appendChild(modal);
                setTimeout(() => modal.classList.add('show'), 10);

                const close = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
                modal.querySelector('#ws-dispatch-close').addEventListener('click', close);
                modal.querySelector('#ws-dispatch-cancel-btn').addEventListener('click', close);
                modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

                // Copy link button
                modal.querySelector('#ws-dispatch-copy-btn').addEventListener('click', () => {
                    const linkInput = document.getElementById('ws-dispatch-link');
                    if (linkInput && linkInput.value) {
                        navigator.clipboard.writeText(linkInput.value).then(() => {
                            self.showToast('Rider link copied!');
                        }).catch(() => {
                            linkInput.select();
                            document.execCommand('copy');
                            self.showToast('Rider link copied!');
                        });
                    }
                });

                // Share via WhatsApp
                modal.querySelector('#ws-dispatch-share-wa').addEventListener('click', () => {
                    const link = document.getElementById('ws-dispatch-link')?.value;
                    if (!link) return;
                    const riderSelect = document.getElementById('ws-dispatch-rider');
                    const riderName = riderSelect?.selectedOptions[0]?.text || 'Rider';
                    const phone = (order.dispatch?.riderPhone || '').replace(/^0/, '254').replace(/[^0-9]/g, '');
                    const msg = encodeURIComponent('Hi ' + riderName + ', here is your delivery link for today:\n' + link + '\n\nOpen it to view and update your assigned orders.');
                    window.open('https://wa.me/' + (phone || '') + '?text=' + msg, '_blank');
                });

                // Share via Email
                modal.querySelector('#ws-dispatch-share-email').addEventListener('click', () => {
                    const link = document.getElementById('ws-dispatch-link')?.value;
                    if (!link) return;
                    const subject = encodeURIComponent('Your Delivery Orders for Today');
                    const body = encodeURIComponent('Hi,\n\nHere is your delivery link for today:\n' + link + '\n\nOpen the link to view and update the status of your assigned orders.\n\nThank you.');
                    window.open('mailto:?subject=' + subject + '&body=' + body);
                });

                // Share via SMS
                modal.querySelector('#ws-dispatch-share-sms').addEventListener('click', () => {
                    const link = document.getElementById('ws-dispatch-link')?.value;
                    if (!link) return;
                    const phone = (order.dispatch?.riderPhone || '').replace(/^0/, '254').replace(/[^0-9]/g, '');
                    const msg = encodeURIComponent('Delivery orders link: ' + link);
                    window.open('sms:' + (phone || '') + '?body=' + msg);
                });

                // Show existing rider link if order already has riderToken
                if (order.dispatch?.riderToken) {
                    const existingLink = window.location.origin + '/rider.html?token=' + order.dispatch.riderToken;
                    const linkBox = document.getElementById('ws-dispatch-link-box');
                    const linkInput = document.getElementById('ws-dispatch-link');
                    if (linkBox && linkInput) {
                        linkInput.value = existingLink;
                        linkBox.style.display = 'block';
                    }
                }

                // Dispatch
                modal.querySelector('#ws-dispatch-save-btn').addEventListener('click', async () => {
                    const riderId = document.getElementById('ws-dispatch-rider').value;
                    const notes = document.getElementById('ws-dispatch-notes').value.trim();
                    if (!riderId) { self.showToast('Please select a rider', 'error'); return; }

                    const rider = riders.find(r => r.id === riderId);
                    if (!rider) return;

                    try {
                        const prevRiderId = order.dispatch?.riderId;
                        const today = new Date().toISOString().split('T')[0];

                        // Generate or reuse daily rider token
                        let riderToken = rider.currentSessionToken || '';
                        const tokenDate = rider.currentSessionDate || '';

                        if (!riderToken || tokenDate !== today) {
                            // Generate new daily token
                            const rand = Array.from(crypto.getRandomValues(new Uint8Array(12)))
                                .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
                            riderToken = 'RT' + today.replace(/-/g, '') + rand;
                        }

                        // Update order with dispatch + riderToken
                        await getBusinessCollection(businessId, 'wholesale_orders').doc(orderId).update({
                            dispatch: {
                                riderId: riderId,
                                riderName: rider.name,
                                riderPhone: rider.phone || '',
                                agentType: rider.agentType || '',
                                status: 'dispatched',
                                notes: notes,
                                riderToken: riderToken,
                                dispatchedAt: new Date().toISOString(),
                                dispatchedBy: self.getCurrentUser()
                            },
                            updatedAt: new Date().toISOString()
                        });

                        // Create/update rider session (root-level, public readable)
                        const sessionRef = window.db.collection('rider_sessions').doc(riderToken);
                        const sessionSnap = await sessionRef.get();
                        const bizName = (PharmaFlow.Settings && PharmaFlow.Settings.getBusinessName) ? PharmaFlow.Settings.getBusinessName() : 'Business';
                        const deliveryEntry = { businessId: businessId, orderId: orderId };

                        if (sessionSnap.exists) {
                            const existingDeliveries = sessionSnap.data().deliveries || [];
                            const existingOrderIds = sessionSnap.data().orderIds || [];
                            // Backwards compat: keep orderIds array + new deliveries array
                            const alreadyExists = existingDeliveries.some(d => d.orderId === orderId && d.businessId === businessId);
                            if (!alreadyExists) {
                                await sessionRef.update({
                                    orderIds: firebase.firestore.FieldValue.arrayUnion(orderId),
                                    deliveries: firebase.firestore.FieldValue.arrayUnion(deliveryEntry),
                                    businessIds: firebase.firestore.FieldValue.arrayUnion(businessId),
                                    [`businessNames.${businessId}`]: bizName,
                                    updatedAt: new Date().toISOString()
                                });
                            }
                        } else {
                            await sessionRef.set({
                                businessId: businessId,
                                businessIds: [businessId],
                                businessNames: { [businessId]: bizName },
                                riderId: riderId,
                                riderName: rider.name,
                                riderPhone: rider.phone || '',
                                agentType: rider.agentType || '',
                                date: today,
                                orderIds: [orderId],
                                deliveries: [deliveryEntry],
                                createdAt: new Date().toISOString()
                            });
                        }

                        // Save token + date on rider doc
                        await getBusinessCollection(businessId, 'riders').doc(riderId).update({
                            status: 'dispatched',
                            currentSessionToken: riderToken,
                            currentSessionDate: today,
                            updatedAt: new Date().toISOString()
                        });

                        // Free previous rider if different
                        if (prevRiderId && prevRiderId !== riderId) {
                            await getBusinessCollection(businessId, 'riders').doc(prevRiderId).update({
                                status: 'available',
                                updatedAt: new Date().toISOString()
                            });
                        }

                        if (PharmaFlow.ActivityLog) {
                            PharmaFlow.ActivityLog.log({
                                title: 'Rider Dispatched',
                                description: 'Rider ' + rider.name + ' assigned to order ' + orderId,
                                category: 'Wholesale',
                                status: 'COMPLETED',
                                metadata: { orderId, riderId, riderName: rider.name, riderToken }
                            });
                        }

                        // Show rider link
                        const riderLink = window.location.origin + '/rider.html?token=' + riderToken;
                        const linkBox = document.getElementById('ws-dispatch-link-box');
                        const linkInput = document.getElementById('ws-dispatch-link');
                        if (linkBox && linkInput) {
                            linkInput.value = riderLink;
                            linkBox.style.display = 'block';
                        }

                        self.showToast('Rider dispatched! Copy the link to share.');
                    } catch (err) {
                        console.error('Dispatch error:', err);
                        self.showToast('Failed to dispatch: ' + err.message, 'error');
                    }
                });

                // Unassign
                const unassignBtn = modal.querySelector('#ws-dispatch-unassign-btn');
                if (unassignBtn) {
                    unassignBtn.addEventListener('click', async () => {
                        try {
                            const prevRiderId = order.dispatch?.riderId;
                            await getBusinessCollection(businessId, 'wholesale_orders').doc(orderId).update({
                                dispatch: firebase.firestore.FieldValue.delete(),
                                updatedAt: new Date().toISOString()
                            });
                            if (prevRiderId) {
                                await getBusinessCollection(businessId, 'riders').doc(prevRiderId).update({
                                    status: 'available',
                                    updatedAt: new Date().toISOString()
                                });
                            }
                            self.showToast('Rider unassigned');
                            close();
                        } catch (err) {
                            console.error('Unassign error:', err);
                            self.showToast('Failed to unassign: ' + err.message, 'error');
                        }
                    });
                }
            }).catch(err => {
                console.error('Load riders error:', err);
                self.showToast('Failed to load riders', 'error');
            });
        },

        _showTrackModal: function (orderId) {
            const order = this._allOrders.find(o => (o.orderId || o.id) === orderId);
            if (!order) return;

            const existing = document.getElementById('ws-track-modal');
            if (existing) existing.remove();

            const self = this;
            const d = order.dispatch || {};
            const businessId = this.getBusinessId();

            const typeIcons = { motorbike: '🏍️', van: '🚐', truck: '🚛', plane: '✈️', cargo: '🚢', overseas: '🌍' };
            const typeIcon = typeIcons[d.agentType] || '🚚';

            const steps = [
                { key: 'dispatched', label: 'Dispatched', icon: 'fa-box', done: !!d.dispatchedAt },
                { key: 'in-transit', label: 'In Transit', icon: 'fa-shipping-fast', done: d.status === 'in-transit' || d.status === 'delivered' },
                { key: 'delivered', label: 'Delivered', icon: 'fa-check-circle', done: d.status === 'delivered' }
            ];

            const modal = document.createElement('div');
            modal.id = 'ws-track-modal';
            modal.className = 'ws-modal-overlay';
            modal.innerHTML = `
                <div class="ws-modal-box" style="max-width:500px">
                    <div class="modal-header">
                        <h3><i class="fas fa-map-marker-alt"></i> Track Order — ${self.escapeHtml(orderId)}</h3>
                        <button class="modal-close" id="ws-track-close">&times;</button>
                    </div>
                    <div class="modal-body" style="padding:20px">
                        ${d.riderId ? `
                        <div class="ws-track-rider-card">
                            <div class="ws-track-rider-icon">${typeIcon}</div>
                            <div class="ws-track-rider-info">
                                <strong>${self.escapeHtml(d.riderName || '—')}</strong>
                                <small>${self.escapeHtml(d.riderPhone || '')} · ${self.escapeHtml((d.agentType || '').charAt(0).toUpperCase() + (d.agentType || '').slice(1))}</small>
                            </div>
                            <span class="ws-badge ${d.status === 'delivered' ? 'ws-badge--green' : 'ws-badge--orange'}">${self.escapeHtml((d.status || 'dispatched').charAt(0).toUpperCase() + (d.status || 'dispatched').slice(1))}</span>
                        </div>
                        <div class="ws-track-timeline">
                            ${steps.map(s => `
                                <div class="ws-track-step ${s.done ? 'ws-track-step--done' : ''}">
                                    <div class="ws-track-step-dot"><i class="fas ${s.icon}"></i></div>
                                    <div class="ws-track-step-label">${s.label}</div>
                                </div>
                            `).join('<div class="ws-track-step-line"></div>')}
                        </div>
                        ${d.notes ? '<div class="ws-track-notes"><i class="fas fa-sticky-note"></i> ' + self.escapeHtml(d.notes) + '</div>' : ''}
                        ${d.dispatchedAt ? '<div class="ws-track-meta"><small>Dispatched: ' + new Date(d.dispatchedAt).toLocaleString('en-KE') + ' by ' + self.escapeHtml(d.dispatchedBy || '—') + '</small></div>' : ''}
                        ${d.deliveredAt ? '<div class="ws-track-meta"><small>Delivered: ' + new Date(d.deliveredAt).toLocaleString('en-KE') + '</small></div>' : ''}
                        ` : '<div class="ws-empty-items" style="padding:30px"><i class="fas fa-route"></i><p>No rider assigned yet</p></div>'}
                    </div>
                    ${d.riderId && d.status !== 'delivered' ? `
                    <div class="modal-footer" style="padding:12px 20px;display:flex;gap:10px;justify-content:flex-end">
                        ${d.status === 'dispatched' ? '<button class="btn btn-sm btn-warning" id="ws-track-transit-btn"><i class="fas fa-shipping-fast"></i> Mark In Transit</button>' : ''}
                        <button class="btn btn-sm btn-success" id="ws-track-deliver-btn"><i class="fas fa-check-circle"></i> Mark Delivered</button>
                    </div>` : ''}
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            const close = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            modal.querySelector('#ws-track-close').addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            const transitBtn = modal.querySelector('#ws-track-transit-btn');
            if (transitBtn) {
                transitBtn.addEventListener('click', async () => {
                    try {
                        await getBusinessCollection(businessId, 'wholesale_orders').doc(orderId).update({
                            'dispatch.status': 'in-transit',
                            updatedAt: new Date().toISOString()
                        });
                        self.showToast('Marked as in transit');
                        close();
                    } catch (err) {
                        self.showToast('Failed: ' + err.message, 'error');
                    }
                });
            }

            const deliverBtn = modal.querySelector('#ws-track-deliver-btn');
            if (deliverBtn) {
                deliverBtn.addEventListener('click', async () => {
                    try {
                        await getBusinessCollection(businessId, 'wholesale_orders').doc(orderId).update({
                            'dispatch.status': 'delivered',
                            'dispatch.deliveredAt': new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        });

                        // Free up rider & increment delivery count
                        if (d.riderId) {
                            await getBusinessCollection(businessId, 'riders').doc(d.riderId).update({
                                status: 'available',
                                deliveryCount: firebase.firestore.FieldValue.increment(1),
                                updatedAt: new Date().toISOString()
                            });
                        }

                        if (PharmaFlow.ActivityLog) {
                            PharmaFlow.ActivityLog.log({
                                title: 'Delivery Completed',
                                description: 'Order ' + orderId + ' delivered by ' + (d.riderName || 'rider'),
                                category: 'Wholesale',
                                status: 'COMPLETED',
                                metadata: { orderId, riderId: d.riderId }
                            });
                        }

                        self.showToast('Order marked as delivered');
                        close();
                    } catch (err) {
                        self.showToast('Failed: ' + err.message, 'error');
                    }
                });
            }
        },

        _dispatchBadge: function (dispatch) {
            if (!dispatch || !dispatch.riderId) return '<span class="ws-badge ws-badge--gray">Not Dispatched</span>';
            const map = {
                'dispatched': { cls: 'ws-badge--orange', label: 'Dispatched' },
                'in-transit': { cls: 'ws-badge--blue', label: 'In Transit' },
                'delivered': { cls: 'ws-badge--green', label: 'Delivered' }
            };
            const info = map[dispatch.status] || { cls: 'ws-badge--orange', label: dispatch.status || 'Dispatched' };
            return '<span class="ws-badge ' + info.cls + '">' + info.label + '</span>';
        },

        /* ══════════════════════════════════════════════════════
         * CLIENT LEADS MODULE
         * ══════════════════════════════════════════════════════ */

        renderClientLeads: function (container) {
            const self = this;
            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="ws-module">
                    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
                        <div>
                            <h2><i class="fas fa-users-gear"></i> Client Leads</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Wholesale</span><span>/</span>
                                <span>Client Leads</span>
                            </div>
                        </div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap">
                            <button class="btn btn-sm" id="ws-cl-export-excel" style="background:#107c41;color:#fff"><i class="fas fa-file-excel"></i> Excel</button>
                            <button class="btn btn-sm" id="ws-cl-export-pdf" style="background:#dc2626;color:#fff"><i class="fas fa-file-pdf"></i> PDF</button>
                            <button class="btn btn-sm btn-primary" id="ws-cl-add-btn"><i class="fas fa-plus"></i> Add Client</button>
                            <button class="btn btn-sm" id="ws-cl-msg-btn" style="background:#25D366;color:#fff"><i class="fas fa-paper-plane"></i> Send Message</button>
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="ws-manage-stats" id="ws-cl-stats">
                        <div class="ws-stat-mini ws-stat--blue">
                            <i class="fas fa-users"></i>
                            <div>
                                <span class="ws-stat-num" id="ws-cl-stat-total">0</span>
                                <span class="ws-stat-label">Total Clients</span>
                            </div>
                        </div>
                        <div class="ws-stat-mini ws-stat--orange">
                            <i class="fas fa-crosshairs"></i>
                            <div>
                                <span class="ws-stat-num" id="ws-cl-stat-lead">0</span>
                                <span class="ws-stat-label">New Leads</span>
                            </div>
                        </div>
                        <div class="ws-stat-mini ws-stat--purple">
                            <i class="fas fa-star"></i>
                            <div>
                                <span class="ws-stat-num" id="ws-cl-stat-potential">0</span>
                                <span class="ws-stat-label">Potential</span>
                            </div>
                        </div>
                        <div class="ws-stat-mini ws-stat--green">
                            <i class="fas fa-handshake"></i>
                            <div>
                                <span class="ws-stat-num" id="ws-cl-stat-regular">0</span>
                                <span class="ws-stat-label">Regular</span>
                            </div>
                        </div>
                        <div class="ws-stat-mini ws-stat--red">
                            <i class="fas fa-crown"></i>
                            <div>
                                <span class="ws-stat-num" id="ws-cl-stat-vip">0</span>
                                <span class="ws-stat-label">VIP</span>
                            </div>
                        </div>
                    </div>

                    <!-- Filters + Table Card -->
                    <div class="card ws-card" style="margin-top:16px">
                        <div class="ws-filter-row">
                            <div class="ws-search-bar ws-manage-search">
                                <i class="fas fa-search"></i>
                                <input type="text" id="ws-cl-search" placeholder="Search clients by name, phone, email..." autocomplete="off">
                            </div>
                            <select id="ws-cl-status-filter" class="ws-select ws-filter-select">
                                <option value="">All Status</option>
                                <option value="lead">New Lead</option>
                                <option value="potential">Potential Regular</option>
                                <option value="regular">Regular</option>
                                <option value="vip">VIP</option>
                                <option value="inactive">Inactive</option>
                            </select>
                        </div>

                        <!-- Clients Table -->
                        <div class="ws-orders-table-wrap">
                            <table class="ws-orders-table">
                                <thead>
                                    <tr>
                                        <th>Client</th>
                                        <th>Contact</th>
                                        <th>Status</th>
                                        <th style="text-align:center">Orders</th>
                                        <th style="text-align:right">Total Spent</th>
                                        <th>Last Order</th>
                                        <th style="text-align:center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="ws-cl-list"></tbody>
                            </table>
                        </div>

                        <!-- Pagination -->
                        <div class="ws-cl-pagination" id="ws-cl-pagination" style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-top:1px solid var(--border-color);font-size:0.82rem;flex-wrap:wrap;gap:8px">
                            <span id="ws-cl-page-info" style="color:var(--text-tertiary)">Showing 0 of 0</span>
                            <div style="display:flex;align-items:center;gap:8px">
                                <select id="ws-cl-page-size" class="ws-select" style="padding:5px 8px;font-size:0.78rem;min-width:auto">
                                    <option value="25">25 / page</option>
                                    <option value="50" selected>50 / page</option>
                                    <option value="100">100 / page</option>
                                    <option value="250">250 / page</option>
                                </select>
                                <button class="btn btn-sm btn-outline" id="ws-cl-prev" style="padding:4px 10px;font-size:0.78rem"><i class="fas fa-chevron-left"></i> Prev</button>
                                <span id="ws-cl-page-num" style="font-weight:600;min-width:60px;text-align:center">Page 1</span>
                                <button class="btn btn-sm btn-outline" id="ws-cl-next" style="padding:4px 10px;font-size:0.78rem">Next <i class="fas fa-chevron-right"></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Breadcrumb
            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });

            document.getElementById('ws-cl-add-btn')?.addEventListener('click', () => self._showClientModal(null));
            document.getElementById('ws-cl-msg-btn')?.addEventListener('click', () => self._showMessageModal());
            document.getElementById('ws-cl-export-excel')?.addEventListener('click', () => self._exportClientLeadsExcel());
            document.getElementById('ws-cl-export-pdf')?.addEventListener('click', () => self._exportClientLeadsPdf());

            document.getElementById('ws-cl-search')?.addEventListener('input', () => { wsClPage = 1; self._filterClientLeads(); });
            document.getElementById('ws-cl-status-filter')?.addEventListener('change', () => { wsClPage = 1; self._filterClientLeads(); });

            // Pagination
            document.getElementById('ws-cl-page-size')?.addEventListener('change', function () {
                wsClPageSize = parseInt(this.value) || 50;
                wsClPage = 1;
                self._renderPaginatedClients();
            });
            document.getElementById('ws-cl-prev')?.addEventListener('click', () => {
                if (wsClPage > 1) { wsClPage--; self._renderPaginatedClients(); }
            });
            document.getElementById('ws-cl-next')?.addEventListener('click', () => {
                const totalPages = Math.ceil(wsClFilteredCache.length / wsClPageSize);
                if (wsClPage < totalPages) { wsClPage++; self._renderPaginatedClients(); }
            });

            this._subscribeClientLeads(businessId);
        },

        _subscribeClientLeads: function (businessId) {
            if (wsUnsubClientLeads) { wsUnsubClientLeads(); wsUnsubClientLeads = null; }
            if (!businessId) return;
            const col = getBusinessCollection(businessId, 'client_leads');
            if (!col) return;

            wsUnsubClientLeads = col.orderBy('createdAt', 'desc').onSnapshot(snap => {
                wsClientLeadsCache = [];
                snap.forEach(doc => wsClientLeadsCache.push({ id: doc.id, ...doc.data() }));
                this._updateClientLeadStats();
                this._filterClientLeads();
            }, err => console.error('Client leads listener error:', err));
        },

        _updateClientLeadStats: function () {
            const el = (id) => document.getElementById(id);
            if (!el('ws-cl-stat-total')) return;
            el('ws-cl-stat-total').textContent = wsClientLeadsCache.length;
            el('ws-cl-stat-lead').textContent = wsClientLeadsCache.filter(c => c.status === 'lead').length;
            el('ws-cl-stat-potential').textContent = wsClientLeadsCache.filter(c => c.status === 'potential').length;
            el('ws-cl-stat-regular').textContent = wsClientLeadsCache.filter(c => c.status === 'regular').length;
            el('ws-cl-stat-vip').textContent = wsClientLeadsCache.filter(c => c.status === 'vip').length;
        },

        _filterClientLeads: function () {
            const q = (document.getElementById('ws-cl-search')?.value || '').toLowerCase().trim();
            const statusFilter = document.getElementById('ws-cl-status-filter')?.value || '';
            let filtered = wsClientLeadsCache;
            if (q) {
                filtered = filtered.filter(c => {
                    return (c.name || '').toLowerCase().includes(q) ||
                           (c.businessName || '').toLowerCase().includes(q) ||
                           (c.phone || '').includes(q) ||
                           (c.email || '').toLowerCase().includes(q);
                });
            }
            if (statusFilter) {
                filtered = filtered.filter(c => c.status === statusFilter);
            }
            wsClFilteredCache = filtered;
            this._renderPaginatedClients();
        },

        _renderPaginatedClients: function () {
            const total = wsClFilteredCache.length;
            const totalPages = Math.max(1, Math.ceil(total / wsClPageSize));
            if (wsClPage > totalPages) wsClPage = totalPages;

            const start = (wsClPage - 1) * wsClPageSize;
            const end = Math.min(start + wsClPageSize, total);
            const pageClients = wsClFilteredCache.slice(start, end);

            this._renderClientLeadsList(pageClients);

            // Update pagination UI
            const info = document.getElementById('ws-cl-page-info');
            const pageNum = document.getElementById('ws-cl-page-num');
            const prevBtn = document.getElementById('ws-cl-prev');
            const nextBtn = document.getElementById('ws-cl-next');

            if (info) info.textContent = total === 0 ? 'No clients' : 'Showing ' + (start + 1) + '–' + end + ' of ' + total;
            if (pageNum) pageNum.textContent = 'Page ' + wsClPage + ' of ' + totalPages;
            if (prevBtn) prevBtn.disabled = wsClPage <= 1;
            if (nextBtn) nextBtn.disabled = wsClPage >= totalPages;
        },

        _clientStatusBadge: function (status) {
            const map = {
                'lead': { cls: 'ws-badge--orange', label: 'New Lead', icon: 'fa-crosshairs' },
                'potential': { cls: 'ws-badge--blue', label: 'Potential', icon: 'fa-star' },
                'regular': { cls: 'ws-badge--green', label: 'Regular', icon: 'fa-handshake' },
                'vip': { cls: 'ws-badge--purple', label: 'VIP', icon: 'fa-crown' },
                'inactive': { cls: 'ws-badge--gray', label: 'Inactive', icon: 'fa-pause-circle' }
            };
            const info = map[status] || map['lead'];
            return '<span class="ws-badge ' + info.cls + '"><i class="fas ' + info.icon + '"></i> ' + info.label + '</span>';
        },

        _renderClientLeadsList: function (clients) {
            const self = this;
            const tbody = document.getElementById('ws-cl-list');
            if (!tbody) return;

            if (clients.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-secondary)"><i class="fas fa-users" style="font-size:2rem;opacity:0.3;display:block;margin-bottom:8px"></i>No clients found</td></tr>';
                return;
            }

            tbody.innerHTML = clients.map(c => {
                const lastOrder = c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString() : '—';
                return '<tr>' +
                    '<td><div style="font-weight:600">' + self.escapeHtml(c.name) + '</div>' +
                    (c.businessName ? '<small style="color:var(--text-secondary)">' + self.escapeHtml(c.businessName) + '</small>' : '') +
                    '</td>' +
                    '<td><div style="font-size:0.82rem">' + (c.phone ? '<i class="fas fa-phone" style="width:14px;color:var(--text-tertiary)"></i> ' + self.escapeHtml(c.phone) : '') + '</div>' +
                    '<div style="font-size:0.82rem">' + (c.email ? '<i class="fas fa-envelope" style="width:14px;color:var(--text-tertiary)"></i> ' + self.escapeHtml(c.email) : '') + '</div></td>' +
                    '<td>' + self._clientStatusBadge(c.status) + '</td>' +
                    '<td style="text-align:center;font-weight:600">' + (c.orderCount || 0) + '</td>' +
                    '<td style="text-align:right;font-weight:600">' + self.formatCurrency(c.totalSpent || 0) + '</td>' +
                    '<td style="font-size:0.82rem">' + lastOrder + '</td>' +
                    '<td style="text-align:center"><div class="ws-action-group">' +
                        '<button class="ws-action-btn ws-action--view" title="Edit" data-edit="' + c.id + '"><i class="fas fa-pen"></i></button>' +
                        '<button class="ws-action-btn ws-cl-status-btn" title="Change Status" data-status="' + c.id + '" style="color:#6366f1"><i class="fas fa-exchange-alt"></i></button>' +
                        '<button class="ws-action-btn ws-action--cancel" title="Delete" data-delete="' + c.id + '"><i class="fas fa-trash"></i></button>' +
                    '</div></td></tr>';
            }).join('');

            // Bind actions
            tbody.querySelectorAll('[data-edit]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const client = wsClientLeadsCache.find(c => c.id === btn.dataset.edit);
                    if (client) self._showClientModal(client);
                });
            });
            tbody.querySelectorAll('[data-status]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const client = wsClientLeadsCache.find(c => c.id === btn.dataset.status);
                    if (client) self._showStatusModal(client);
                });
            });
            tbody.querySelectorAll('[data-delete]').forEach(btn => {
                btn.addEventListener('click', () => self._deleteClient(btn.dataset.delete));
            });
        },

        _showClientModal: function (client) {
            const self = this;
            const businessId = this.getBusinessId();
            const isEdit = !!client;

            const modal = document.createElement('div');
            modal.className = 'ws-modal-overlay';
            modal.innerHTML = `
                <div class="ws-modal-box" style="max-width:520px">
                    <div class="modal-header" style="padding:14px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">
                        <h3 style="margin:0;font-size:1rem"><i class="fas fa-${isEdit ? 'pen' : 'plus'}"></i> ${isEdit ? 'Edit Client' : 'Add Client'}</h3>
                        <button class="btn btn-sm" id="ws-cl-modal-close" style="background:none;border:none;font-size:1.1rem;cursor:pointer"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="modal-body" style="padding:16px 20px">
                        <div class="dda-form-group">
                            <label>Client Name <span class="required">*</span></label>
                            <input type="text" id="ws-cl-name" class="dda-input" placeholder="Full name or contact person" value="${self.escapeHtml(client?.name || '')}">
                        </div>
                        <div class="dda-form-group">
                            <label>Business Name</label>
                            <input type="text" id="ws-cl-business" class="dda-input" placeholder="Business / Company" value="${self.escapeHtml(client?.businessName || '')}">
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                            <div class="dda-form-group">
                                <label>Phone</label>
                                <input type="tel" id="ws-cl-phone" class="dda-input" placeholder="0712345678" value="${self.escapeHtml(client?.phone || '')}">
                            </div>
                            <div class="dda-form-group">
                                <label>Email</label>
                                <input type="email" id="ws-cl-email" class="dda-input" placeholder="email@example.com" value="${self.escapeHtml(client?.email || '')}">
                            </div>
                        </div>
                        <div class="dda-form-group">
                            <label>Address</label>
                            <input type="text" id="ws-cl-address" class="dda-input" placeholder="Physical address" value="${self.escapeHtml(client?.address || '')}">
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                            <div class="dda-form-group">
                                <label>Status</label>
                                <select id="ws-cl-status" class="dda-input">
                                    <option value="lead" ${(client?.status || 'lead') === 'lead' ? 'selected' : ''}>New Lead</option>
                                    <option value="potential" ${client?.status === 'potential' ? 'selected' : ''}>Potential Regular</option>
                                    <option value="regular" ${client?.status === 'regular' ? 'selected' : ''}>Regular</option>
                                    <option value="vip" ${client?.status === 'vip' ? 'selected' : ''}>VIP</option>
                                    <option value="inactive" ${client?.status === 'inactive' ? 'selected' : ''}>Inactive</option>
                                </select>
                            </div>
                            <div class="dda-form-group">
                                <label>Source</label>
                                <select id="ws-cl-source" class="dda-input">
                                    <option value="walk-in" ${(client?.source || 'walk-in') === 'walk-in' ? 'selected' : ''}>Walk-in</option>
                                    <option value="referral" ${client?.source === 'referral' ? 'selected' : ''}>Referral</option>
                                    <option value="online" ${client?.source === 'online' ? 'selected' : ''}>Online</option>
                                    <option value="phone" ${client?.source === 'phone' ? 'selected' : ''}>Phone Call</option>
                                    <option value="other" ${client?.source === 'other' ? 'selected' : ''}>Other</option>
                                </select>
                            </div>
                        </div>
                        <div class="dda-form-group">
                            <label>Notes</label>
                            <textarea id="ws-cl-notes" class="dda-input" rows="2" placeholder="Internal notes...">${self.escapeHtml(client?.notes || '')}</textarea>
                        </div>
                    </div>
                    <div class="modal-footer" style="padding:12px 20px;display:flex;gap:10px;justify-content:flex-end">
                        <button class="btn btn-sm btn-secondary" id="ws-cl-modal-cancel">Cancel</button>
                        <button class="btn btn-sm btn-primary" id="ws-cl-modal-save"><i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Save'}</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            const close = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            modal.querySelector('#ws-cl-modal-close').addEventListener('click', close);
            modal.querySelector('#ws-cl-modal-cancel').addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            modal.querySelector('#ws-cl-modal-save').addEventListener('click', async () => {
                const name = document.getElementById('ws-cl-name')?.value.trim();
                if (!name) { self.showToast('Client name is required', 'error'); return; }

                const data = {
                    name: name,
                    businessName: document.getElementById('ws-cl-business')?.value.trim() || '',
                    phone: document.getElementById('ws-cl-phone')?.value.trim() || '',
                    email: document.getElementById('ws-cl-email')?.value.trim() || '',
                    address: document.getElementById('ws-cl-address')?.value.trim() || '',
                    status: document.getElementById('ws-cl-status')?.value || 'lead',
                    source: document.getElementById('ws-cl-source')?.value || 'walk-in',
                    notes: document.getElementById('ws-cl-notes')?.value.trim() || '',
                    updatedAt: new Date().toISOString()
                };

                try {
                    if (isEdit) {
                        await getBusinessCollection(businessId, 'client_leads').doc(client.id).update(data);
                        self.showToast('Client updated');
                    } else {
                        data.orderCount = 0;
                        data.totalSpent = 0;
                        data.lastOrderDate = null;
                        data.createdAt = new Date().toISOString();
                        data.createdBy = self.getCurrentUser();
                        await getBusinessCollection(businessId, 'client_leads').add(data);
                        self.showToast('Client added');
                    }
                    close();
                } catch (err) {
                    console.error('Client save error:', err);
                    self.showToast('Failed: ' + err.message, 'error');
                }
            });
        },

        _showStatusModal: function (client) {
            const self = this;
            const businessId = this.getBusinessId();
            const statuses = [
                { value: 'lead', label: 'New Lead', icon: 'fa-crosshairs', color: '#d97706' },
                { value: 'potential', label: 'Potential Regular', icon: 'fa-star', color: '#2563eb' },
                { value: 'regular', label: 'Regular', icon: 'fa-handshake', color: '#059669' },
                { value: 'vip', label: 'VIP', icon: 'fa-crown', color: '#db2777' },
                { value: 'inactive', label: 'Inactive', icon: 'fa-pause-circle', color: '#6b7280' }
            ];

            const modal = document.createElement('div');
            modal.className = 'ws-modal-overlay';
            modal.innerHTML = `
                <div class="ws-modal-box" style="max-width:360px">
                    <div class="modal-header" style="padding:14px 20px;border-bottom:1px solid var(--border)">
                        <h3 style="margin:0;font-size:1rem"><i class="fas fa-exchange-alt"></i> Change Status — ${self.escapeHtml(client.name)}</h3>
                    </div>
                    <div class="modal-body" style="padding:16px 20px;display:flex;flex-direction:column;gap:8px">
                        ${statuses.map(s => `
                            <button class="btn ws-cl-status-option ${client.status === s.value ? 'active' : ''}" data-val="${s.value}"
                                style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid ${client.status === s.value ? s.color : 'var(--border)'};border-radius:8px;background:${client.status === s.value ? s.color + '10' : 'transparent'};cursor:pointer;text-align:left;width:100%">
                                <i class="fas ${s.icon}" style="color:${s.color};font-size:1rem;width:20px"></i>
                                <span style="font-weight:${client.status === s.value ? '600' : '400'}">${s.label}</span>
                                ${client.status === s.value ? '<i class="fas fa-check" style="margin-left:auto;color:' + s.color + '"></i>' : ''}
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            const close = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            modal.querySelectorAll('.ws-cl-status-option').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const newStatus = btn.dataset.val;
                    if (newStatus === client.status) { close(); return; }
                    try {
                        await getBusinessCollection(businessId, 'client_leads').doc(client.id).update({
                            status: newStatus,
                            updatedAt: new Date().toISOString()
                        });
                        self.showToast('Status updated to ' + newStatus);
                        close();
                    } catch (err) {
                        self.showToast('Failed: ' + err.message, 'error');
                    }
                });
            });
        },

        _deleteClient: async function (clientId) {
            const self = this;
            const businessId = this.getBusinessId();
            if (!(await PharmaFlow.confirm('Are you sure you want to delete this client lead? This action cannot be undone.', { title: 'Delete Client', confirmText: 'Delete', danger: true }))) return;
            try {
                await getBusinessCollection(businessId, 'client_leads').doc(clientId).delete();
                self.showToast('Client deleted');
            } catch (err) {
                self.showToast('Failed: ' + err.message, 'error');
            }
        },

        /* ── Send Message Modal ── */
        _showMessageModal: function () {
            const self = this;
            const clients = wsClientLeadsCache.filter(c => c.status !== 'inactive');

            const modal = document.createElement('div');
            modal.className = 'ws-modal-overlay';
            modal.innerHTML = `
                <div class="ws-modal-box" style="max-width:560px">
                    <div class="modal-header" style="padding:14px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">
                        <h3 style="margin:0;font-size:1rem"><i class="fas fa-paper-plane"></i> Send Message</h3>
                        <button class="btn btn-sm" id="ws-msg-close" style="background:none;border:none;font-size:1.1rem;cursor:pointer"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="modal-body" style="padding:16px 20px">
                        <div class="dda-form-group">
                            <label style="font-weight:600">Recipients</label>
                            <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
                                <button class="btn btn-sm btn-outline ws-msg-select-toggle" data-select="all" style="font-size:0.76rem"><i class="fas fa-users"></i> Select All</button>
                                <button class="btn btn-sm btn-outline ws-msg-select-toggle" data-select="lead" style="font-size:0.76rem">Leads</button>
                                <button class="btn btn-sm btn-outline ws-msg-select-toggle" data-select="potential" style="font-size:0.76rem">Potential</button>
                                <button class="btn btn-sm btn-outline ws-msg-select-toggle" data-select="regular" style="font-size:0.76rem">Regular</button>
                                <button class="btn btn-sm btn-outline ws-msg-select-toggle" data-select="vip" style="font-size:0.76rem">VIP</button>
                            </div>
                            <div id="ws-msg-recipients" style="max-height:140px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px">
                                ${clients.map(c => `
                                    <label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:0.82rem">
                                        <input type="checkbox" class="ws-msg-cb" data-id="${c.id}" data-phone="${self.escapeHtml(c.phone || '')}" data-email="${self.escapeHtml(c.email || '')}" data-name="${self.escapeHtml(c.name)}" data-status="${c.status}">
                                        <span>${self.escapeHtml(c.name)}</span>
                                        ${c.phone ? '<small style="color:var(--text-tertiary)">' + self.escapeHtml(c.phone) + '</small>' : ''}
                                    </label>
                                `).join('')}
                                ${clients.length === 0 ? '<p style="color:var(--text-secondary);text-align:center;padding:10px">No active clients</p>' : ''}
                            </div>
                            <small id="ws-msg-count" style="color:var(--text-tertiary);font-size:0.74rem">0 selected</small>
                        </div>
                        <div class="dda-form-group">
                            <label style="font-weight:600">Message</label>
                            <textarea id="ws-msg-text" class="dda-input" rows="4" placeholder="Type your promotional message here..."></textarea>
                        </div>
                        <div class="dda-form-group">
                            <label style="font-weight:600">Send via</label>
                            <div style="display:flex;gap:8px;flex-wrap:wrap">
                                <button class="btn btn-sm" id="ws-msg-send-wa" style="background:#25D366;color:#fff;flex:1"><i class="fab fa-whatsapp"></i> WhatsApp</button>
                                <button class="btn btn-sm" id="ws-msg-send-email" style="background:#4285F4;color:#fff;flex:1"><i class="fas fa-envelope"></i> Email</button>
                                <button class="btn btn-sm" id="ws-msg-send-sms" style="background:#6366f1;color:#fff;flex:1"><i class="fas fa-sms"></i> SMS</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            const close = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            modal.querySelector('#ws-msg-close').addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            // Select toggle buttons
            const updateCount = () => {
                const count = modal.querySelectorAll('.ws-msg-cb:checked').length;
                const el = document.getElementById('ws-msg-count');
                if (el) el.textContent = count + ' selected';
            };

            modal.querySelectorAll('.ws-msg-cb').forEach(cb => cb.addEventListener('change', updateCount));

            modal.querySelectorAll('.ws-msg-select-toggle').forEach(btn => {
                btn.addEventListener('click', () => {
                    const sel = btn.dataset.select;
                    modal.querySelectorAll('.ws-msg-cb').forEach(cb => {
                        if (sel === 'all') {
                            cb.checked = true;
                        } else {
                            cb.checked = cb.dataset.status === sel;
                        }
                    });
                    updateCount();
                });
            });

            // Get selected recipients
            const getSelected = () => {
                const selected = [];
                modal.querySelectorAll('.ws-msg-cb:checked').forEach(cb => {
                    selected.push({ id: cb.dataset.id, name: cb.dataset.name, phone: cb.dataset.phone, email: cb.dataset.email });
                });
                return selected;
            };

            // WhatsApp — opens one per recipient
            modal.querySelector('#ws-msg-send-wa').addEventListener('click', () => {
                const msg = document.getElementById('ws-msg-text')?.value.trim();
                if (!msg) { self.showToast('Please type a message', 'error'); return; }
                const recipients = getSelected().filter(r => r.phone);
                if (recipients.length === 0) { self.showToast('No recipients with phone numbers', 'error'); return; }
                const encoded = encodeURIComponent(msg);
                recipients.forEach((r, i) => {
                    const phone = r.phone.replace(/^0/, '254').replace(/[^0-9]/g, '');
                    setTimeout(() => window.open('https://wa.me/' + phone + '?text=' + encoded, '_blank'), i * 600);
                });
                self.showToast('Opening WhatsApp for ' + recipients.length + ' clients...');
            });

            // Email — opens one mailto with BCC
            modal.querySelector('#ws-msg-send-email').addEventListener('click', () => {
                const msg = document.getElementById('ws-msg-text')?.value.trim();
                if (!msg) { self.showToast('Please type a message', 'error'); return; }
                const recipients = getSelected().filter(r => r.email);
                if (recipients.length === 0) { self.showToast('No recipients with email addresses', 'error'); return; }
                const emails = recipients.map(r => r.email).join(',');
                const subject = encodeURIComponent('Promotional Message');
                const body = encodeURIComponent(msg);
                window.open('mailto:?bcc=' + encodeURIComponent(emails) + '&subject=' + subject + '&body=' + body);
                self.showToast('Opening email client for ' + recipients.length + ' clients');
            });

            // SMS — opens one per recipient
            modal.querySelector('#ws-msg-send-sms').addEventListener('click', () => {
                const msg = document.getElementById('ws-msg-text')?.value.trim();
                if (!msg) { self.showToast('Please type a message', 'error'); return; }
                const recipients = getSelected().filter(r => r.phone);
                if (recipients.length === 0) { self.showToast('No recipients with phone numbers', 'error'); return; }
                const encoded = encodeURIComponent(msg);
                recipients.forEach((r, i) => {
                    const phone = r.phone.replace(/^0/, '254').replace(/[^0-9]/g, '');
                    setTimeout(() => window.open('sms:' + phone + '?body=' + encoded), i * 600);
                });
                self.showToast('Opening SMS for ' + recipients.length + ' clients...');
            });
        },

        /* ── Auto-link client from Create module search ── */
        _searchClientLeads: function (query) {
            const q = (query || '').toLowerCase().trim();
            if (q.length < 2) return [];
            return wsClientLeadsCache.filter(c => {
                return (c.name || '').toLowerCase().includes(q) ||
                       (c.businessName || '').toLowerCase().includes(q) ||
                       (c.phone || '').includes(q);
            }).slice(0, 5);
        },

        /* ── Export Client Leads to Excel ── */
        _exportClientLeadsExcel: function () {
            if (typeof XLSX === 'undefined') { this.showToast('XLSX library not loaded', 'error'); return; }
            const data = (wsClFilteredCache.length ? wsClFilteredCache : wsClientLeadsCache);
            if (data.length === 0) { this.showToast('No clients to export', 'error'); return; }

            const rows = data.map(c => ({
                'Client Name': c.name || '',
                'Business': c.businessName || '',
                'Phone': c.phone || '',
                'Email': c.email || '',
                'Address': c.address || '',
                'Status': (c.status || 'lead').toUpperCase(),
                'Source': c.source || '',
                'Orders': c.orderCount || 0,
                'Total Spent': c.totalSpent || 0,
                'Last Order': c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString() : '',
                'Notes': c.notes || ''
            }));

            const ws = XLSX.utils.json_to_sheet(rows);
            ws['!cols'] = [
                { wch: 22 }, { wch: 20 }, { wch: 15 }, { wch: 24 }, { wch: 25 },
                { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 28 }
            ];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Client Leads');
            XLSX.writeFile(wb, (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + '_ClientLeads_' + new Date().toISOString().split('T')[0] + '.xlsx');
            this.showToast('Excel exported (' + rows.length + ' clients)');
        },

        /* ── Export Client Leads to PDF ── */
        _exportClientLeadsPdf: function () {
            if (typeof window.jspdf === 'undefined' && typeof jspdf === 'undefined') { this.showToast('jsPDF library not loaded', 'error'); return; }
            const data = (wsClFilteredCache.length ? wsClFilteredCache : wsClientLeadsCache);
            if (data.length === 0) { this.showToast('No clients to export', 'error'); return; }

            const { jsPDF } = window.jspdf || jspdf;
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.text('Client Leads Report', 14, 16);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100);
            doc.text('Generated: ' + new Date().toLocaleString() + '  |  Total: ' + data.length + ' clients', 14, 22);

            const headers = [['#', 'Client Name', 'Business', 'Phone', 'Email', 'Status', 'Orders', 'Total Spent', 'Last Order']];
            const rows = data.map((c, i) => [
                i + 1,
                c.name || '',
                c.businessName || '',
                c.phone || '',
                c.email || '',
                (c.status || 'lead').toUpperCase(),
                c.orderCount || 0,
                this.formatCurrency(c.totalSpent || 0),
                c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString() : '—'
            ]);

            doc.autoTable({
                head: headers,
                body: rows,
                startY: 26,
                styles: { fontSize: 7.5, cellPadding: 2.5 },
                headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
                alternateRowStyles: { fillColor: [248, 250, 252] },
                columnStyles: {
                    0: { cellWidth: 10 },
                    6: { halign: 'center' },
                    7: { halign: 'right' }
                },
                margin: { left: 14, right: 14 }
            });

            doc.save((PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + '_ClientLeads_' + new Date().toISOString().split('T')[0] + '.pdf');
            this.showToast('PDF exported (' + rows.length + ' clients)');
        },

        /* ── Update client order stats after a wholesale order is created ── */
        _updateClientOrderStats: function (businessId, customerName, customerPhone, grandTotal) {
            if (!businessId || !customerName) return;

            // Find matching client by name or phone
            const q = customerName.toLowerCase().trim();
            const ph = (customerPhone || '').trim();
            const match = wsClientLeadsCache.find(c => {
                return (c.name || '').toLowerCase().trim() === q ||
                       (ph && c.phone === ph);
            });

            if (match) {
                getBusinessCollection(businessId, 'client_leads').doc(match.id).update({
                    orderCount: firebase.firestore.FieldValue.increment(1),
                    totalSpent: firebase.firestore.FieldValue.increment(grandTotal || 0),
                    lastOrderDate: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }).catch(err => console.error('Client stats update error:', err));
            }
        }
    };

    window.PharmaFlow.Wholesale = Wholesale;
})();
