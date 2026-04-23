/**
 * PharmaFlow - POS (Point of Sale) Module
 * Search inventory, add to cart, sell, generate receipt,
 * and record sales to Firestore.
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let inventoryCache = [];
    let cart = [];
    let unsubPosInventory = null;

    const POS = {

        // ─── HELPERS ─────────────────────────────────────────

        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
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
            const existing = document.querySelector('.pos-toast');
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.className = 'pos-toast pos-toast--' + (type || 'success');
            toast.innerHTML = '<i class="fas fa-' + (type === 'error' ? 'exclamation-circle' : 'check-circle') + '"></i> ' + message;
            document.body.appendChild(toast);
            setTimeout(() => toast.classList.add('show'), 10);
            setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
        },

        generateSaleId: function () {
            const now = new Date();
            const y = now.getFullYear().toString().slice(-2);
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
            return 'SL-' + y + m + d + '-' + rand;
        },

        // ─── RENDER POS ─────────────────────────────────────

        render: function (container) {
            cart = [];
            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="pos-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-cash-register"></i> Point of Sale</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Pharmacy</span><span>/</span>
                                <span>POS</span>
                            </div>
                        </div>
                    </div>

                    <div class="pos-layout">
                        <!-- LEFT: Product Search & Results -->
                        <div class="pos-products">
                            <div class="pos-search-bar">
                                <i class="fas fa-search"></i>
                                <input type="text" id="pos-search" placeholder="Search by product name, SKU, or category..." autocomplete="off">
                                <kbd>Ctrl+K</kbd>
                            </div>
                            <div class="pos-results-header">
                                <span id="pos-results-count">0 products</span>
                                <div class="pos-filter-pills">
                                    <button class="pos-pill active" data-filter="all">All</button>
                                    <button class="pos-pill" data-filter="in-stock">In Stock</button>
                                    <button class="pos-pill" data-filter="otc">OTC</button>
                                    <button class="pos-pill" data-filter="pom">POM</button>
                                </div>
                            </div>
                            <div class="pos-product-grid" id="pos-product-grid">
                                <div class="pos-loading">
                                    <i class="fas fa-spinner fa-spin"></i>
                                    <span>Loading inventory...</span>
                                </div>
                            </div>
                        </div>

                        <!-- RIGHT: Cart & Checkout -->
                        <div class="pos-cart-panel">
                            <div class="pos-cart-header">
                                <h3><i class="fas fa-shopping-cart"></i> Cart</h3>
                                <button class="pos-clear-cart" id="pos-clear-cart" title="Clear cart">
                                    <i class="fas fa-trash-alt"></i> Clear
                                </button>
                            </div>

                            <div class="pos-cart-items" id="pos-cart-items">
                                <div class="pos-cart-empty">
                                    <i class="fas fa-shopping-basket"></i>
                                    <p>Cart is empty</p>
                                    <small>Search and add products to begin</small>
                                </div>
                            </div>

                            <div class="pos-cart-summary" id="pos-cart-summary">
                                <div class="pos-summary-row">
                                    <span>Subtotal</span>
                                    <span id="pos-subtotal">KSH 0.00</span>
                                </div>
                                <div class="pos-summary-row">
                                    <span>Discount</span>
                                    <div class="pos-discount-input">
                                        <input type="number" id="pos-discount" min="0" value="0" placeholder="0">
                                        <select id="pos-discount-type">
                                            <option value="amount">KSH</option>
                                            <option value="percent">%</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="pos-summary-row">
                                    <span>Net Total</span>
                                    <span id="pos-net-total">KSH 0.00</span>
                                </div>
                                <div class="pos-summary-row">
                                    <label class="checkbox-wrapper" style="margin:0;">
                                        <input type="checkbox" id="pos-apply-vat">
                                        <span>Apply VAT</span>
                                    </label>
                                    <div class="pos-discount-input">
                                        <input type="number" id="pos-vat" min="0" value="0" placeholder="0">
                                        <select id="pos-vat-type">
                                            <option value="percent">%</option>
                                            <option value="amount">KSH</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="pos-summary-row">
                                    <span>VAT</span>
                                    <span id="pos-vat-amount">KSH 0.00</span>
                                </div>
                                <div class="pos-summary-total">
                                    <span>Total</span>
                                    <span id="pos-total">KSH 0.00</span>
                                </div>
                            </div>

                            <div class="pos-payment-section">
                                <label>Customer (Optional)</label>
                                <div class="pos-customer-fields">
                                    <input type="text" id="pos-customer-name" placeholder="Customer name (optional)" autocomplete="off">
                                    <input type="tel" id="pos-customer-phone" placeholder="Phone number (optional)" autocomplete="tel">
                                </div>

                                <label>Payment Method</label>
                                <div class="pos-payment-methods">
                                    <button class="pos-pay-method active" data-method="cash">
                                        <i class="fas fa-money-bill-wave"></i> Cash
                                    </button>
                                    <button class="pos-pay-method" data-method="mpesa">
                                        <i class="fas fa-mobile-alt"></i> M-Pesa
                                    </button>
                                    <button class="pos-pay-method" data-method="card">
                                        <i class="fas fa-credit-card"></i> Card
                                    </button>
                                </div>

                                <div class="pos-cash-tender" id="pos-cash-tender" style="display:none;">
                                    <label for="pos-amount-paid">Amount Paid</label>
                                    <input type="number" id="pos-amount-paid" min="0" placeholder="0.00">
                                    <div class="pos-change-due" id="pos-change-due" style="display:none;">
                                        Change: <strong id="pos-change-amount">KSH 0.00</strong>
                                    </div>
                                </div>
                            </div>

                            <div class="pos-checkout-actions">
                                <button class="btn btn-primary btn-lg pos-checkout-btn" id="pos-checkout-btn" disabled>
                                    <i class="fas fa-check-circle"></i> Complete Sale
                                </button>
                                <button class="btn btn-outline btn-sm" id="pos-hold-btn">
                                    <i class="fas fa-pause-circle"></i> Hold
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            this.bindEvents(container);
            this.subscribeToInventory(businessId);
        },

        // ─── EVENTS ─────────────────────────────────────────

        bindEvents: function (container) {
            const self = this;

            // Search
            const searchInput = document.getElementById('pos-search');
            if (searchInput) {
                let debounce;
                searchInput.addEventListener('input', function () {
                    clearTimeout(debounce);
                    debounce = setTimeout(() => self.filterProducts(this.value), 150);
                });
            }

            // Keyboard shortcut: Ctrl+K focuses search
            document.addEventListener('keydown', function posKeyboard(e) {
                if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                    e.preventDefault();
                    const si = document.getElementById('pos-search');
                    if (si) si.focus();
                }
                self._keyboardHandler = posKeyboard;
            });

            // Filter pills
            container.querySelectorAll('.pos-pill').forEach(pill => {
                pill.addEventListener('click', function () {
                    container.querySelectorAll('.pos-pill').forEach(p => p.classList.remove('active'));
                    this.classList.add('active');
                    self.filterProducts(document.getElementById('pos-search')?.value || '');
                });
            });

            // Clear cart
            document.getElementById('pos-clear-cart')?.addEventListener('click', () => {
                if (cart.length === 0) return;
                cart = [];
                this.renderCart();
                this.showToast('Cart cleared');
            });

            // Payment method
            container.querySelectorAll('.pos-pay-method').forEach(btn => {
                btn.addEventListener('click', function () {
                    container.querySelectorAll('.pos-pay-method').forEach(b => b.classList.remove('active'));
                    this.classList.add('active');
                    const cashTender = document.getElementById('pos-cash-tender');
                    if (cashTender) {
                        cashTender.style.display = this.dataset.method === 'cash' ? 'block' : 'none';
                    }
                });
            });

            // Cash amount paid → compute change
            const amountPaid = document.getElementById('pos-amount-paid');
            if (amountPaid) {
                amountPaid.addEventListener('input', () => this.computeChange());
            }

            // Discount input
            const discountInput = document.getElementById('pos-discount');
            const discountType = document.getElementById('pos-discount-type');
            if (discountInput) discountInput.addEventListener('input', () => this.updateTotals());
            if (discountType) discountType.addEventListener('change', () => this.updateTotals());

            // VAT input
            const vatInput = document.getElementById('pos-vat');
            const vatType = document.getElementById('pos-vat-type');
            const applyVat = document.getElementById('pos-apply-vat');
            if (vatInput) vatInput.addEventListener('input', () => this.updateTotals());
            if (vatType) vatType.addEventListener('change', () => this.updateTotals());
            if (applyVat) {
                applyVat.addEventListener('change', () => this.updateTotals());
            }

            // Checkout
            document.getElementById('pos-checkout-btn')?.addEventListener('click', () => this.completeSale());

            // Breadcrumb nav
            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) {
                dashLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    PharmaFlow.Sidebar.setActive('dashboard', null);
                });
            }

            // Show cash tender if Cash is active by default
            const cashTender = document.getElementById('pos-cash-tender');
            if (cashTender) cashTender.style.display = 'block';

            this.applyCustomerPrefill();
            this.updateTotals();
        },

        applyCustomerPrefill: function () {
            try {
                const raw = localStorage.getItem('pf_pos_customer_prefill');
                if (!raw) return;
                const data = JSON.parse(raw);

                const nameInput = document.getElementById('pos-customer-name');
                const phoneInput = document.getElementById('pos-customer-phone');

                if (nameInput) nameInput.value = data && data.name ? data.name : '';
                if (phoneInput) phoneInput.value = data && data.phone ? data.phone : '';

                localStorage.removeItem('pf_pos_customer_prefill');
            } catch (e) {
                localStorage.removeItem('pf_pos_customer_prefill');
            }
        },

        // ─── INVENTORY SUBSCRIPTION ─────────────────────────

        subscribeToInventory: function (businessId) {
            if (unsubPosInventory) { unsubPosInventory(); unsubPosInventory = null; }
            if (!businessId) return;

            const col = getBusinessCollection(businessId, 'inventory');
            if (!col) return;

            unsubPosInventory = col.onSnapshot(snapshot => {
                inventoryCache = [];
                snapshot.forEach(doc => {
                    inventoryCache.push({ id: doc.id, ...doc.data() });
                });
                this.filterProducts(document.getElementById('pos-search')?.value || '');
            }, err => {
                console.error('POS inventory subscription error:', err);
            });
        },

        // ─── FILTER & RENDER PRODUCTS ────────────────────────

        filterProducts: function (query) {
            const activePill = document.querySelector('.pos-pill.active');
            const filter = activePill ? activePill.dataset.filter : 'all';
            const q = (query || '').toLowerCase().trim();

            let results = inventoryCache.filter(p => {
                // Text search
                if (q) {
                    const matchName = (p.name || '').toLowerCase().includes(q);
                    const matchSku = (p.sku || '').toLowerCase().includes(q);
                    const matchCat = (p.category || '').toLowerCase().includes(q);
                    if (!matchName && !matchSku && !matchCat) return false;
                }
                // Filter pills
                if (filter === 'in-stock') return (p.quantity || 0) > 0;
                if (filter === 'otc') return p.drugType === 'OTC';
                if (filter === 'pom') return p.drugType === 'POM';
                return true;
            });

            this.renderProducts(results);
        },

        renderProducts: function (products) {
            const grid = document.getElementById('pos-product-grid');
            const countEl = document.getElementById('pos-results-count');
            if (!grid) return;

            if (countEl) countEl.textContent = products.length + ' product' + (products.length !== 1 ? 's' : '');

            if (products.length === 0) {
                grid.innerHTML = `
                    <div class="pos-no-results">
                        <i class="fas fa-search"></i>
                        <p>No products found</p>
                    </div>`;
                return;
            }

            grid.innerHTML = products.map(p => {
                const inCart = cart.find(c => c.id === p.id);
                const stock = p.quantity || 0;
                const outOfStock = stock <= 0;
                const lowStock = stock > 0 && stock <= 10;
                const drugBadge = this.getDrugTypeBadge(p.drugType);

                return `
                    <div class="pos-product-card ${outOfStock ? 'pos-product--oos' : ''} ${inCart ? 'pos-product--in-cart' : ''}" 
                         data-id="${p.id}" ${outOfStock ? '' : 'tabindex="0"'}>
                        <div class="pos-product-top">
                            <span class="pos-product-name">${this.escapeHtml(p.name)}</span>
                            ${drugBadge}
                        </div>
                        <div class="pos-product-meta">
                            <span class="pos-product-sku">${this.escapeHtml(p.sku || '—')}</span>
                            <span class="pos-product-cat">${this.escapeHtml(p.category || '')}</span>
                        </div>
                        <div class="pos-product-bottom">
                            <span class="pos-product-price">${this.formatCurrency(p.sellingPrice)}</span>
                            <span class="pos-product-stock ${outOfStock ? 'oos' : ''} ${lowStock ? 'low' : ''}">
                                ${outOfStock ? 'Out of Stock' : stock + ' in stock'}
                            </span>
                        </div>
                        ${inCart ? '<div class="pos-in-cart-badge"><i class="fas fa-check"></i> In Cart (' + inCart.qty + ')</div>' : ''}
                    </div>`;
            }).join('');

            // Click to add to cart
            grid.querySelectorAll('.pos-product-card:not(.pos-product--oos)').forEach(card => {
                card.addEventListener('click', () => this.addToCart(card.dataset.id));
                card.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.addToCart(card.dataset.id); });
            });
        },

        getDrugTypeBadge: function (type) {
            const map = {
                'OTC': { label: 'OTC', cls: 'otc' },
                'POM': { label: 'POM', cls: 'pom' },
                'PO':  { label: 'P', cls: 'po' },
                'DDA': { label: 'DDA', cls: 'dda' }
            };
            const info = map[type];
            if (!info) return '';
            return '<span class="pos-drug-badge pos-drug--' + info.cls + '">' + info.label + '</span>';
        },

        // ─── CART ────────────────────────────────────────────

        addToCart: function (productId) {
            const product = inventoryCache.find(p => p.id === productId);
            if (!product) return;

            const existing = cart.find(c => c.id === productId);
            if (existing) {
                if (existing.qty >= (product.quantity || 0)) {
                    this.showToast('Maximum stock reached for ' + product.name, 'error');
                    return;
                }
                existing.qty++;
            } else {
                if ((product.quantity || 0) <= 0) {
                    this.showToast(product.name + ' is out of stock', 'error');
                    return;
                }
                cart.push({
                    id: product.id,
                    name: product.name,
                    sku: product.sku || '',
                    price: product.sellingPrice || 0,
                    buyingPrice: product.buyingPrice || 0,
                    qty: 1,
                    maxQty: product.quantity || 0,
                    drugType: product.drugType || '',
                    category: product.category || ''
                });
            }

            this.renderCart();
            this.filterProducts(document.getElementById('pos-search')?.value || '');
        },

        removeFromCart: function (productId) {
            cart = cart.filter(c => c.id !== productId);
            this.renderCart();
            this.filterProducts(document.getElementById('pos-search')?.value || '');
        },

        updateCartQty: function (productId, newQty) {
            const item = cart.find(c => c.id === productId);
            if (!item) return;

            const product = inventoryCache.find(p => p.id === productId);
            const max = product ? (product.quantity || 0) : item.maxQty;

            if (newQty < 1) {
                this.removeFromCart(productId);
                return;
            }
            if (newQty > max) {
                this.showToast('Only ' + max + ' available in stock', 'error');
                item.qty = max;
            } else {
                item.qty = newQty;
            }

            this.renderCart();
            this.filterProducts(document.getElementById('pos-search')?.value || '');
        },

        renderCart: function () {
            const cartContainer = document.getElementById('pos-cart-items');
            const checkoutBtn = document.getElementById('pos-checkout-btn');
            if (!cartContainer) return;

            if (cart.length === 0) {
                cartContainer.innerHTML = `
                    <div class="pos-cart-empty">
                        <i class="fas fa-shopping-basket"></i>
                        <p>Cart is empty</p>
                        <small>Search and add products to begin</small>
                    </div>`;
                if (checkoutBtn) checkoutBtn.disabled = true;
                this.updateTotals();
                return;
            }

            if (checkoutBtn) checkoutBtn.disabled = false;

            cartContainer.innerHTML = cart.map((item, i) => `
                <div class="pos-cart-item">
                    <div class="pos-cart-item-info">
                        <span class="pos-cart-item-num">${i + 1}</span>
                        <div>
                            <strong>${this.escapeHtml(item.name)}</strong>
                            <small>${this.formatCurrency(item.price)} each</small>
                        </div>
                    </div>
                    <div class="pos-cart-item-controls">
                        <button class="pos-qty-btn" data-action="dec" data-id="${item.id}">
                            <i class="fas fa-minus"></i>
                        </button>
                        <input type="number" class="pos-qty-input" value="${item.qty}" min="1" max="${item.maxQty}" data-id="${item.id}">
                        <button class="pos-qty-btn" data-action="inc" data-id="${item.id}">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                    <div class="pos-cart-item-price">
                        ${this.formatCurrency(item.price * item.qty)}
                    </div>
                    <button class="pos-cart-remove" data-id="${item.id}" title="Remove">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `).join('');

            // Bind quantity controls
            cartContainer.querySelectorAll('.pos-qty-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    const item = cart.find(c => c.id === id);
                    if (!item) return;
                    if (btn.dataset.action === 'inc') this.updateCartQty(id, item.qty + 1);
                    else this.updateCartQty(id, item.qty - 1);
                });
            });

            cartContainer.querySelectorAll('.pos-qty-input').forEach(input => {
                input.addEventListener('change', () => {
                    this.updateCartQty(input.dataset.id, parseInt(input.value) || 1);
                });
            });

            cartContainer.querySelectorAll('.pos-cart-remove').forEach(btn => {
                btn.addEventListener('click', () => this.removeFromCart(btn.dataset.id));
            });

            this.updateTotals();
        },

        // ─── TOTALS ─────────────────────────────────────────

        getCurrentTotals: function () {
            const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
            const discountInput = document.getElementById('pos-discount');
            const discountType = document.getElementById('pos-discount-type');
            const vatInput = document.getElementById('pos-vat');
            const vatType = document.getElementById('pos-vat-type');
            const applyVat = document.getElementById('pos-apply-vat');

            let discount = 0;
            const discountValue = parseFloat(discountInput?.value) || 0;
            if (discountValue > 0) {
                if (discountType?.value === 'percent') {
                    discount = subtotal * (Math.min(discountValue, 100) / 100);
                } else {
                    discount = Math.min(discountValue, subtotal);
                }
            }

            const netTotal = Math.max(subtotal - discount, 0);

            let vatAmount = 0;
            const vatValue = parseFloat(vatInput?.value) || 0;
            const vatEnabled = !!applyVat?.checked;
            if (vatEnabled && vatValue > 0) {
                if (vatType?.value === 'percent') {
                    vatAmount = netTotal * (Math.min(vatValue, 100) / 100);
                } else {
                    vatAmount = Math.min(vatValue, netTotal);
                }
            }

            const total = netTotal + vatAmount;

            return {
                subtotal,
                discountValue,
                discountType: discountType?.value || 'amount',
                discountAmount: discount,
                netTotal,
                vatEnabled,
                vatValue,
                vatType: vatType?.value || 'percent',
                vatAmount,
                total
            };
        },

        updateTotals: function () {
            const totals = this.getCurrentTotals();

            const subtotalEl = document.getElementById('pos-subtotal');
            const netTotalEl = document.getElementById('pos-net-total');
            const vatAmountEl = document.getElementById('pos-vat-amount');
            const totalEl = document.getElementById('pos-total');
            if (subtotalEl) subtotalEl.textContent = this.formatCurrency(totals.subtotal);
            if (netTotalEl) netTotalEl.textContent = this.formatCurrency(totals.netTotal);
            if (vatAmountEl) vatAmountEl.textContent = this.formatCurrency(totals.vatAmount);
            if (totalEl) totalEl.textContent = this.formatCurrency(totals.total);

            this.computeChange();
        },

        computeChange: function () {
            const total = this.getCurrentTotals().total;
            const paid = parseFloat(document.getElementById('pos-amount-paid')?.value) || 0;
            const changeEl = document.getElementById('pos-change-due');
            const changeAmt = document.getElementById('pos-change-amount');

            if (paid > 0 && changeEl && changeAmt) {
                changeEl.style.display = 'block';
                const change = paid - total;
                changeAmt.textContent = this.formatCurrency(Math.max(change, 0));
                changeAmt.style.color = change >= 0 ? 'var(--success)' : 'var(--danger)';
            } else if (changeEl) {
                changeEl.style.display = 'none';
            }
        },

        // ─── COMPLETE SALE ───────────────────────────────────

        completeSale: async function () {
            if (cart.length === 0) return;

            const businessId = this.getBusinessId();
            if (!businessId) {
                this.showToast('No business assigned. Cannot complete sale.', 'error');
                return;
            }

            const btn = document.getElementById('pos-checkout-btn');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...'; }

            try {
                const totals = this.getCurrentTotals();
                const totalProfit = cart.reduce((sum, item) => sum + ((item.price - item.buyingPrice) * item.qty), 0) - totals.discountAmount;

                const paymentMethod = document.querySelector('.pos-pay-method.active')?.dataset.method || 'cash';
                const amountPaid = paymentMethod === 'cash' ? (parseFloat(document.getElementById('pos-amount-paid')?.value) || totals.total) : totals.total;
                const changeDue = Math.max(amountPaid - totals.total, 0);

                const saleId = this.generateSaleId();
                const now = new Date();
                const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;

                const saleData = {
                    saleId: saleId,
                    customer: {
                        name: (document.getElementById('pos-customer-name')?.value || '').trim(),
                        phone: (document.getElementById('pos-customer-phone')?.value || '').trim()
                    },
                    items: cart.map(item => ({
                        productId: item.id,
                        name: item.name,
                        sku: item.sku,
                        category: item.category,
                        drugType: item.drugType,
                        unitPrice: item.price,
                        buyingPrice: item.buyingPrice,
                        quantity: item.qty,
                        lineTotal: item.price * item.qty,
                        profit: (item.price - item.buyingPrice) * item.qty
                    })),
                    subtotal: totals.subtotal,
                    discountValue: totals.discountValue,
                    discountType: totals.discountType,
                    discountAmount: totals.discountAmount,
                    netTotal: totals.netTotal,
                    vatEnabled: totals.vatEnabled,
                    vatValue: totals.vatValue,
                    vatType: totals.vatType,
                    vatAmount: totals.vatAmount,
                    total: totals.total,
                    totalProfit: totalProfit,
                    paymentMethod: paymentMethod,
                    amountPaid: amountPaid,
                    changeDue: changeDue,
                    itemCount: cart.reduce((sum, item) => sum + item.qty, 0),
                    soldBy: profile ? (profile.displayName || profile.email) : 'Unknown',
                    soldByUid: firebase.auth().currentUser ? firebase.auth().currentUser.uid : null,
                    status: 'completed',
                    createdAt: new Date().toISOString(),
                    saleDate: now.toISOString(),
                    saleDateStr: now.toISOString().split('T')[0]
                };

                // Write sale to Firestore
                await getBusinessCollection(businessId, 'sales').doc(saleId).set(saleData);

                // Record DDA sales in DDA register
                const ddaItems = saleData.items.filter(item => item.drugType === 'DDA');
                if (ddaItems.length > 0 && PharmaFlow.DdaRegister) {
                    const soldBy = saleData.soldBy;
                    const soldByUid = saleData.soldByUid;
                    const sDate = saleData.saleDate;
                    const sDateStr = saleData.saleDateStr;
                    for (const ddaItem of ddaItems) {
                        await PharmaFlow.DdaRegister.recordDdaSale(businessId, saleId, ddaItem, soldBy, soldByUid, sDate, sDateStr);
                    }
                }

                // Update inventory quantities (decrement)
                const batch = window.db.batch();
                cart.forEach(item => {
                    const ref = getBusinessCollection(businessId, 'inventory').doc(item.id);
                    batch.update(ref, {
                        quantity: firebase.firestore.FieldValue.increment(-item.qty),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                });
                await batch.commit();

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Sale Completed',
                        description: 'Sale ' + saleId + ' — ' + cart.length + ' item(s) totaling ' + this.formatCurrency(totals.total) + ' via ' + paymentMethod,
                        category: 'Sale',
                        status: 'COMPLETED',
                        amount: totals.total,
                        metadata: { saleId: saleId, itemCount: saleData.itemCount, paymentMethod: paymentMethod, profit: totalProfit }
                    });
                }

                // Show receipt
                this.showReceipt(saleData, changeDue);

                // Clear cart
                cart = [];
                this.renderCart();
                this.filterProducts(document.getElementById('pos-search')?.value || '');

                // Reset discount & payment
                const di = document.getElementById('pos-discount');
                if (di) di.value = '0';
                const ap = document.getElementById('pos-amount-paid');
                if (ap) ap.value = '';
                const cn = document.getElementById('pos-customer-name');
                const cp = document.getElementById('pos-customer-phone');
                if (cn) cn.value = '';
                if (cp) cp.value = '';

                this.showToast('Sale completed! Receipt generated.');

            } catch (err) {
                console.error('Sale error:', err);
                this.showToast('Failed to complete sale: ' + err.message, 'error');
            } finally {
                if (btn) { btn.disabled = cart.length === 0; btn.innerHTML = '<i class="fas fa-check-circle"></i> Complete Sale'; }
            }
        },

        // ─── RECEIPT ─────────────────────────────────────────

        showReceipt: function (sale, changeDue) {
            const existing = document.getElementById('pos-receipt-modal');
            if (existing) existing.remove();

            const now = sale.saleDate?.toDate ? sale.saleDate.toDate() : new Date();
            const dateStr = now.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
            const timeStr = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

            const itemsHtml = sale.items.map((item, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td>${this.escapeHtml(item.name)}</td>
                    <td style="text-align:center">${item.quantity}</td>
                    <td style="text-align:right">${this.formatCurrency(item.unitPrice)}</td>
                    <td style="text-align:right">${this.formatCurrency(item.lineTotal)}</td>
                </tr>
            `).join('');

            const modal = document.createElement('div');
            modal.className = 'pos-modal-overlay';
            modal.id = 'pos-receipt-modal';
            modal.innerHTML = `
                <div class="pos-receipt-container">
                    <div class="pos-receipt" id="pos-receipt-content">
                        <div class="pos-receipt-header">
                            <div class="pos-receipt-logo">
                                <i class="${PharmaFlow.Settings ? PharmaFlow.Settings.getLogoIcon() : 'fas fa-capsules'}"></i>
                                <h2>${PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow'}</h2>
                            </div>
                            <p class="pos-receipt-subtitle">Sales Receipt</p>
                            <div class="pos-receipt-info">
                                <span><strong>Receipt #:</strong> ${sale.saleId}</span>
                                <span><strong>Date:</strong> ${dateStr}</span>
                                <span><strong>Time:</strong> ${timeStr}</span>
                                <span><strong>Cashier:</strong> ${this.escapeHtml(sale.soldBy)}</span>
                                ${sale.customer && sale.customer.name ? '<span class="pos-receipt-customer"><strong>Customer:</strong> ' + this.escapeHtml(sale.customer.name) + '</span>' : ''}
                                ${sale.customer && sale.customer.phone ? '<span class="pos-receipt-customer"><strong>Phone:</strong> ' + this.escapeHtml(sale.customer.phone) + '</span>' : ''}
                            </div>
                        </div>

                        <table class="pos-receipt-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Item</th>
                                    <th style="text-align:center">Qty</th>
                                    <th style="text-align:right">Price</th>
                                    <th style="text-align:right">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${itemsHtml}
                            </tbody>
                        </table>

                        <div class="pos-receipt-totals">
                            <div class="pos-receipt-row">
                                <span>Subtotal</span>
                                <span>${this.formatCurrency(sale.subtotal)}</span>
                            </div>
                            ${sale.discountAmount > 0 ? `
                            <div class="pos-receipt-row">
                                <span>Discount ${sale.discountType === 'percent' ? '(' + sale.discountValue + '%)' : ''}</span>
                                <span>- ${this.formatCurrency(sale.discountAmount)}</span>
                            </div>` : ''}
                            <div class="pos-receipt-row">
                                <span>Net Total</span>
                                <span>${this.formatCurrency(sale.netTotal != null ? sale.netTotal : (sale.subtotal - (sale.discountAmount || 0)))}</span>
                            </div>
                            ${(sale.vatAmount || 0) > 0 ? `
                            <div class="pos-receipt-row">
                                <span>VAT ${sale.vatType === 'percent' ? '(' + sale.vatValue + '%)' : ''}</span>
                                <span>${this.formatCurrency(sale.vatAmount)}</span>
                            </div>` : ''}
                            <div class="pos-receipt-row pos-receipt-grand-total">
                                <span>TOTAL</span>
                                <span>${this.formatCurrency(sale.total)}</span>
                            </div>
                            <div class="pos-receipt-row">
                                <span>Payment (${sale.paymentMethod.toUpperCase()})</span>
                                <span>${this.formatCurrency(sale.amountPaid)}</span>
                            </div>
                            ${changeDue > 0 ? `
                            <div class="pos-receipt-row">
                                <span>Change</span>
                                <span>${this.formatCurrency(changeDue)}</span>
                            </div>` : ''}
                        </div>

                        <div class="pos-receipt-footer">
                            <p>${PharmaFlow.Settings ? PharmaFlow.Settings.getReceiptFooter() : 'Thank you for your purchase!'}</p>
                            <p><small>Items: ${sale.itemCount} | ${sale.paymentMethod.toUpperCase()}</small></p>
                        </div>
                    </div>

                    <div class="pos-receipt-actions">
                        <button class="btn btn-primary" id="pos-print-receipt">
                            <i class="fas fa-print"></i> Print Receipt
                        </button>
                        <button class="btn btn-outline" id="pos-close-receipt">
                            <i class="fas fa-times"></i> Close
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            const closeModal = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };

            document.getElementById('pos-close-receipt').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

            document.getElementById('pos-print-receipt').addEventListener('click', () => {
                const content = document.getElementById('pos-receipt-content');
                const printWin = window.open('', '_blank', 'width=400,height=600');
                printWin.document.write(`
                    <html><head><title>Receipt - ${sale.saleId}</title>
                    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body { font-family: 'Courier New', monospace; padding: 20px; max-width: 400px; margin: 0 auto; }
                        .pos-receipt-header { text-align: center; margin-bottom: 15px; }
                        .pos-receipt-logo h2 { font-size: 1.3rem; }
                        .pos-receipt-subtitle { font-size: 0.85rem; margin: 4px 0; }
                        .pos-receipt-info { font-size: 0.75rem; display: flex; flex-direction: column; gap: 2px; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 8px 0; margin-top: 8px; }
                        .pos-receipt-customer { font-weight: 700; }
                        table { width: 100%; border-collapse: collapse; font-size: 0.78rem; margin: 10px 0; }
                        th, td { padding: 4px 2px; text-align: left; }
                        th { border-bottom: 1px solid #000; }
                        .pos-receipt-totals { border-top: 1px dashed #000; padding-top: 8px; font-size: 0.82rem; }
                        .pos-receipt-row { display: flex; justify-content: space-between; padding: 3px 0; }
                        .pos-receipt-grand-total { font-weight: bold; font-size: 1rem; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 6px 0; margin: 4px 0; }
                        .pos-receipt-footer { text-align: center; margin-top: 15px; padding-top: 10px; border-top: 1px dashed #000; font-size: 0.75rem; }
                        .pos-receipt-logo i { display: none; }
                        @media print { body { padding: 0; } }
                    </style>
                    </head><body>${content.innerHTML}</body></html>
                `);
                printWin.document.close();
                printWin.focus();
                setTimeout(() => { printWin.print(); }, 300);
            });
        },

        // ─── CLEANUP ─────────────────────────────────────────

        cleanup: function () {
            if (unsubPosInventory) { unsubPosInventory(); unsubPosInventory = null; }
            if (this._keyboardHandler) {
                document.removeEventListener('keydown', this._keyboardHandler);
                this._keyboardHandler = null;
            }
            cart = [];
            inventoryCache = [];
        }
    };

    window.PharmaFlow.POS = POS;
})();
