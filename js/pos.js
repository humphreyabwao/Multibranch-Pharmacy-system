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
    let unsubPosCustomers = null;
    let customerDirectory = [];
    /** Full list after search + filter pills (sorted), before pagination slice. */
    let filteredProductsList = [];
    let posProductsPage = 1;

    const POS = {

        /** Product cards per page (grid paginates this set). */
        PRODUCTS_PAGE_SIZE: 12,

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

        /** Money amounts: 2 decimal places, consistent with KES / receipts / Firestore. */
        roundMoney: function (n) {
            const x = Number(n);
            if (!isFinite(x)) return 0;
            return Math.round(x * 100) / 100;
        },

        /** Quantity on cart lines (qty) or stored sale lines (quantity). */
        getLineQuantity: function (item) {
            const q = item.qty != null ? item.qty : item.quantity;
            const n = Number(q);
            return isFinite(n) && n > 0 ? n : 0;
        },

        /** Unit selling price on cart (price) or sale item (unitPrice). */
        getLineUnitPrice: function (item) {
            const p = item.price != null ? item.price : item.unitPrice;
            const n = parseFloat(p);
            return isFinite(n) ? n : 0;
        },

        escapeHtml: function (str) {
            const div = document.createElement('div');
            div.textContent = str || '';
            return div.innerHTML;
        },

        normalizeCustomerName: function (name) {
            return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
        },

        normalizePhone: function (phone) {
            return String(phone || '').replace(/\s+/g, '').replace(/[^0-9+]/g, '');
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
            posProductsPage = 1;
            filteredProductsList = [];
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
                        <!-- LEFT: Product search / grid (~2 rows) + cart underneath -->
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

                            <nav class="pos-pagination is-hidden" id="pos-product-pagination" aria-label="Product pages"></nav>

                            <div class="pos-inline-cart">
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
                            </div>
                        </div>

                        <!-- RIGHT: Totals & checkout (unchanged order) -->
                        <div class="pos-cart-panel">
                            <div class="pos-cart-summary" id="pos-cart-summary">
                                <div class="pos-summary-row">
                                    <span>Subtotal (ex. VAT)</span>
                                    <span id="pos-base-subtotal">KSH 0.00</span>
                                </div>
                                <div class="pos-summary-row" id="pos-product-vat-summary-row" style="display:none;">
                                    <span>Product VAT</span>
                                    <span id="pos-product-vat-total">KSH 0.00</span>
                                </div>
                                <div class="pos-summary-row" style="font-weight:600;">
                                    <span>Subtotal (incl. VAT)</span>
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
                                <datalist id="pos-customer-name-list"></datalist>
                                <datalist id="pos-customer-phone-list"></datalist>
                                <div class="pos-customer-match" id="pos-customer-match" style="display:none;"></div>

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
            this.subscribeToCustomers(businessId);
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

            this.setupCustomerAutoDetect();

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

            // Product grid pagination (delegated)
            container.addEventListener('click', function posPaginationClick(e) {
                const actionBtn = e.target.closest('[data-pos-page-action]');
                if (actionBtn && !actionBtn.disabled) {
                    const act = actionBtn.getAttribute('data-pos-page-action');
                    const pageSize = self.PRODUCTS_PAGE_SIZE;
                    const total = filteredProductsList.length;
                    const totalPages = Math.max(1, Math.ceil(total / pageSize));
                    if (act === 'first') posProductsPage = 1;
                    else if (act === 'prev') posProductsPage = Math.max(1, posProductsPage - 1);
                    else if (act === 'next') posProductsPage = Math.min(totalPages, posProductsPage + 1);
                    else if (act === 'last') posProductsPage = totalPages;
                    self.renderProductsPage();
                    return;
                }
                const numBtn = e.target.closest('[data-pos-page-num]');
                if (numBtn && !numBtn.disabled) {
                    const p = parseInt(numBtn.getAttribute('data-pos-page-num'), 10);
                    if (isFinite(p) && p >= 1) {
                        const pageSize = self.PRODUCTS_PAGE_SIZE;
                        const totalPages = Math.max(1, Math.ceil(filteredProductsList.length / pageSize));
                        posProductsPage = Math.min(Math.max(1, p), totalPages);
                        self.renderProductsPage();
                    }
                }
            });

            // Show cash tender if Cash is active by default
            const cashTender = document.getElementById('pos-cash-tender');
            if (cashTender) cashTender.style.display = 'block';

            this.applyCustomerPrefill();
            this.updateTotals();
        },

        setupCustomerAutoDetect: function () {
            const nameInput = document.getElementById('pos-customer-name');
            const phoneInput = document.getElementById('pos-customer-phone');
            if (!nameInput || !phoneInput) return;

            nameInput.setAttribute('list', 'pos-customer-name-list');
            phoneInput.setAttribute('list', 'pos-customer-phone-list');

            nameInput.addEventListener('input', () => this.detectExistingCustomer('name'));
            phoneInput.addEventListener('input', () => this.detectExistingCustomer('phone'));
            nameInput.addEventListener('blur', () => this.detectExistingCustomer('name'));
            phoneInput.addEventListener('blur', () => this.detectExistingCustomer('phone'));

            this.renderCustomerDatalists();
            this.detectExistingCustomer();
        },

        renderCustomerDatalists: function () {
            const nameList = document.getElementById('pos-customer-name-list');
            const phoneList = document.getElementById('pos-customer-phone-list');
            if (!nameList || !phoneList) return;

            const nameOptions = customerDirectory
                .filter(c => c.name)
                .sort((a, b) => (b.transactions || 0) - (a.transactions || 0))
                .slice(0, 200)
                .map(c => '<option value="' + this.escapeHtml(c.name) + '"></option>')
                .join('');

            const phoneOptions = customerDirectory
                .filter(c => c.phone)
                .sort((a, b) => (b.transactions || 0) - (a.transactions || 0))
                .slice(0, 200)
                .map(c => '<option value="' + this.escapeHtml(c.phone) + '"></option>')
                .join('');

            nameList.innerHTML = nameOptions;
            phoneList.innerHTML = phoneOptions;
        },

        setCustomerMatchUi: function (customer, mode) {
            const nameInput = document.getElementById('pos-customer-name');
            const phoneInput = document.getElementById('pos-customer-phone');
            const matchEl = document.getElementById('pos-customer-match');
            if (!nameInput || !phoneInput || !matchEl) return;

            nameInput.classList.remove('pos-customer-input--matched');
            phoneInput.classList.remove('pos-customer-input--matched');

            if (!customer) {
                matchEl.style.display = 'none';
                matchEl.textContent = '';
                return;
            }

            if (mode === 'name' || mode === 'both') nameInput.classList.add('pos-customer-input--matched');
            if (mode === 'phone' || mode === 'both') phoneInput.classList.add('pos-customer-input--matched');

            matchEl.style.display = 'block';
            matchEl.innerHTML = '<i class="fas fa-user-check"></i> Existing customer detected: <strong>'
                + this.escapeHtml(customer.name || 'Unnamed Customer') + '</strong>'
                + (customer.phone ? ' (' + this.escapeHtml(customer.phone) + ')' : '');
        },

        detectExistingCustomer: function (source) {
            const nameInput = document.getElementById('pos-customer-name');
            const phoneInput = document.getElementById('pos-customer-phone');
            if (!nameInput || !phoneInput) return;

            const nameNorm = this.normalizeCustomerName(nameInput.value);
            const phoneNorm = this.normalizePhone(phoneInput.value);

            if (!nameNorm && !phoneNorm) {
                this.setCustomerMatchUi(null);
                return;
            }

            const phoneExact = phoneNorm
                ? customerDirectory.find(c => c.phoneNorm && c.phoneNorm === phoneNorm)
                : null;
            const nameExact = nameNorm
                ? customerDirectory.find(c => c.nameNorm && c.nameNorm === nameNorm)
                : null;

            const matched = phoneExact || nameExact || null;
            if (!matched) {
                this.setCustomerMatchUi(null);
                return;
            }

            if (source === 'name' && !phoneNorm && matched.phone) phoneInput.value = matched.phone;
            if (source === 'phone' && !nameNorm && matched.name) nameInput.value = matched.name;

            const hasName = !!this.normalizeCustomerName(nameInput.value);
            const hasPhone = !!this.normalizePhone(phoneInput.value);
            const mode = hasName && hasPhone ? 'both' : (hasPhone ? 'phone' : 'name');
            this.setCustomerMatchUi(matched, mode);
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

                this.detectExistingCustomer();

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
                this.filterProducts(document.getElementById('pos-search')?.value || '', { resetPage: false });
            }, err => {
                console.error('POS inventory subscription error:', err);
            });
        },

        subscribeToCustomers: function (businessId) {
            if (unsubPosCustomers) { unsubPosCustomers(); unsubPosCustomers = null; }
            customerDirectory = [];
            if (!businessId) return;

            const col = getBusinessCollection(businessId, 'sales');
            if (!col) return;

            unsubPosCustomers = col.onSnapshot(snapshot => {
                const byName = new Map();
                const byPhone = new Map();

                snapshot.forEach(doc => {
                    const sale = doc.data() || {};
                    const customer = sale.customer || {};
                    const name = String(customer.name || '').trim();
                    const phone = String(customer.phone || '').trim();
                    const nameNorm = this.normalizeCustomerName(name);
                    const phoneNorm = this.normalizePhone(phone);
                    if (!nameNorm && !phoneNorm) return;

                    const existing = byPhone.get(phoneNorm) || byName.get(nameNorm);
                    const next = existing || {
                        key: phoneNorm || nameNorm,
                        name: name,
                        phone: phone,
                        nameNorm: nameNorm,
                        phoneNorm: phoneNorm,
                        transactions: 0
                    };

                    if (!next.name && name) next.name = name;
                    if (!next.phone && phone) next.phone = phone;
                    next.transactions += 1;

                    if (next.nameNorm) byName.set(next.nameNorm, next);
                    if (next.phoneNorm) byPhone.set(next.phoneNorm, next);
                });

                customerDirectory = Array.from(new Set([...byPhone.values(), ...byName.values()]));
                this.renderCustomerDatalists();
                this.detectExistingCustomer();
            }, err => {
                console.error('POS customer subscription error:', err);
            });
        },

        // ─── FILTER & RENDER PRODUCTS ────────────────────────

        computeFilteredProducts: function (query) {
            const activePill = document.querySelector('.pos-pill.active');
            const filter = activePill ? activePill.dataset.filter : 'all';
            const q = (query || '').toLowerCase().trim();

            const results = inventoryCache.filter(p => {
                if (q) {
                    const matchName = (p.name || '').toLowerCase().includes(q);
                    const matchGeneric = (p.genericName || '').toLowerCase().includes(q);
                    const matchSku = (p.sku || '').toLowerCase().includes(q);
                    const matchCat = (p.category || '').toLowerCase().includes(q);
                    if (!matchName && !matchGeneric && !matchSku && !matchCat) return false;
                }
                if (filter === 'in-stock') return (p.quantity || 0) > 0;
                if (filter === 'otc') return p.drugType === 'OTC';
                if (filter === 'pom') return p.drugType === 'POM';
                return true;
            });

            results.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
            return results;
        },

        /**
         * @param {string} query - search text
         * @param {{ resetPage?: boolean }} [opts] - default resetPage true; set false when refreshing badges (cart) only
         */
        filterProducts: function (query, opts) {
            const resetPage = !opts || opts.resetPage !== false;
            filteredProductsList = this.computeFilteredProducts(query);
            const pageSize = this.PRODUCTS_PAGE_SIZE;
            const totalPages = Math.max(1, Math.ceil(filteredProductsList.length / pageSize));

            if (resetPage) posProductsPage = 1;
            else posProductsPage = Math.min(Math.max(1, posProductsPage), totalPages);

            this.renderProductsPage();
        },

        /** Page number strip with ellipses for many pages. */
        buildPaginationSlots: function (totalPages, currentPage) {
            if (totalPages <= 7) {
                const a = [];
                for (let i = 1; i <= totalPages; i++) a.push(i);
                return a;
            }
            const edge = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
            const sorted = [...edge].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
            const out = [];
            for (let i = 0; i < sorted.length; i++) {
                if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('…');
                out.push(sorted[i]);
            }
            return out;
        },

        renderPaginationBar: function (total, pageSize, currentPage, totalPages) {
            const nav = document.getElementById('pos-product-pagination');
            if (!nav) return;

            if (total === 0 || totalPages <= 1) {
                nav.classList.add('is-hidden');
                nav.innerHTML = '';
                return;
            }

            nav.classList.remove('is-hidden');
            const startIdx = (currentPage - 1) * pageSize + 1;
            const endIdx = Math.min(currentPage * pageSize, total);
            const slots = this.buildPaginationSlots(totalPages, currentPage);

            let pagesHtml = '';
            slots.forEach(s => {
                if (s === '…') {
                    pagesHtml += '<span class="pos-page-ellipsis" aria-hidden="true">…</span>';
                    return;
                }
                const active = s === currentPage ? ' pos-page-num--active' : '';
                pagesHtml += '<button type="button" class="pos-page-num' + active + '" data-pos-page-num="' + s + '" aria-label="Page ' + s + '"' + (s === currentPage ? ' aria-current="page"' : '') + '>' + s + '</button>';
            });

            const disFirst = currentPage <= 1;
            const disLast = currentPage >= totalPages;

            nav.innerHTML = ''
                + '<div class="pos-pagination-meta"><span class="pos-pagination-range">' + startIdx + '–' + endIdx + '</span>'
                + '<span class="pos-pagination-of"> of </span><span>' + total + '</span>'
                + '<span class="pos-pagination-page"> · Page ' + currentPage + ' / ' + totalPages + '</span></div>'
                + '<div class="pos-pagination-controls" role="group">'
                + '<button type="button" class="pos-page-btn" data-pos-page-action="first" aria-label="First page"' + (disFirst ? ' disabled' : '') + '><i class="fas fa-angles-left"></i></button>'
                + '<button type="button" class="pos-page-btn" data-pos-page-action="prev" aria-label="Previous page"' + (disFirst ? ' disabled' : '') + '><i class="fas fa-angle-left"></i></button>'
                + '<div class="pos-page-nums">' + pagesHtml + '</div>'
                + '<button type="button" class="pos-page-btn" data-pos-page-action="next" aria-label="Next page"' + (disLast ? ' disabled' : '') + '><i class="fas fa-angle-right"></i></button>'
                + '<button type="button" class="pos-page-btn" data-pos-page-action="last" aria-label="Last page"' + (disLast ? ' disabled' : '') + '><i class="fas fa-angles-right"></i></button>'
                + '</div>';
        },

        renderProductsPage: function () {
            const grid = document.getElementById('pos-product-grid');
            const countEl = document.getElementById('pos-results-count');
            if (!grid) return;

            const pageSize = this.PRODUCTS_PAGE_SIZE;
            const total = filteredProductsList.length;
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            posProductsPage = Math.min(Math.max(1, posProductsPage), totalPages);

            if (countEl) {
                if (total === 0) {
                    countEl.textContent = 'No matches';
                } else if (totalPages <= 1) {
                    countEl.textContent = total + ' product' + (total !== 1 ? 's' : '');
                } else {
                    const startIdx = (posProductsPage - 1) * pageSize + 1;
                    const endIdx = Math.min(posProductsPage * pageSize, total);
                    countEl.textContent = startIdx + '–' + endIdx + ' of ' + total + ' products';
                }
            }

            this.renderPaginationBar(total, pageSize, posProductsPage, totalPages);

            if (total === 0) {
                grid.innerHTML = `
                    <div class="pos-no-results">
                        <i class="fas fa-search"></i>
                        <p>No products found</p>
                    </div>`;
                return;
            }

            const start = (posProductsPage - 1) * pageSize;
            const products = filteredProductsList.slice(start, start + pageSize);

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
                            <span class="pos-product-name-wrap">
                                <span class="pos-product-name">${this.escapeHtml(p.name)}</span>
                                ${p.genericName ? '<span class="pos-product-generic">' + this.escapeHtml(p.genericName) + '</span>' : ''}
                            </span>
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

        /**
         * Product VAT from inventory (same rules as add/edit product):
         * - percent: % of (unit selling price × qty), rate capped 0–100; VAT is exclusive of that line subtotal.
         * - amount: fixed KSH VAT per unit × qty (matches inventory “KSH” VAT type).
         * Rounded per line so receipts and stored productVatAmount stay consistent.
         */
        getPosLineProductVat: function (item) {
            if (!item || !item.vatEnabled) return 0;
            const raw = parseFloat(item.vatValue);
            if (!isFinite(raw) || raw <= 0) return 0;
            const qty = this.getLineQuantity(item);
            if (qty <= 0) return 0;
            const unitPrice = this.getLineUnitPrice(item);
            const lineSubtotal = this.roundMoney(unitPrice * qty);
            const vatType = (item.vatType || 'percent') === 'amount' ? 'amount' : 'percent';

            if (vatType === 'amount') {
                return this.roundMoney(raw * qty);
            }
            const pct = Math.min(Math.max(raw, 0), 100);
            return this.roundMoney(lineSubtotal * (pct / 100));
        },

        /** Resolve per-line product VAT on a stored sale item (for receipt / reprint). */
        getProductVatForReceiptItem: function (item) {
            if (item && item.productVatAmount != null && item.productVatAmount !== '') {
                return this.roundMoney(parseFloat(item.productVatAmount));
            }
            return this.getPosLineProductVat({
                price: item.unitPrice,
                qty: item.quantity,
                quantity: item.quantity,
                vatEnabled: item.vatEnabled,
                vatType: item.vatType,
                vatValue: item.vatValue
            });
        },

        /** Line merchandise total (unit × qty), excl. product VAT. */
        getLineBaseTotal: function (item) {
            return this.roundMoney(this.getLineUnitPrice(item) * this.getLineQuantity(item));
        },

        /** Line amount incl. inventory product VAT (what the customer pays for that line before cart discount). */
        getLineGrossTotal: function (item) {
            return this.roundMoney(this.getLineBaseTotal(item) + this.getPosLineProductVat(item));
        },

        /**
         * Gross line amount for receipt (stored new sales use lineGrossTotal; legacy: lineTotal + product VAT).
         */
        getReceiptLineGross: function (item) {
            if (item && item.lineGrossTotal != null && item.lineGrossTotal !== '') {
                return this.roundMoney(parseFloat(item.lineGrossTotal));
            }
            const pv = this.getProductVatForReceiptItem(item);
            const legacyBase = this.roundMoney(parseFloat(item.lineTotal) || 0);
            if (pv > 0) {
                return this.roundMoney(legacyBase + pv);
            }
            return legacyBase;
        },

        /**
         * Receipt VAT cell text: inventory % → "16%"; inventory KSH (amount) → "KSH x.xx" for that line's VAT.
         */
        formatReceiptLineVatDisplay: function (item) {
            const lineVat = this.getProductVatForReceiptItem(item);
            if (lineVat <= 0) return '—';
            const vatType = (item.vatType || 'percent') === 'amount' ? 'amount' : 'percent';
            if (vatType === 'amount') {
                return this.formatCurrency(lineVat);
            }
            const vr = parseFloat(item.vatValue);
            if (vr > 0 || item.vatEnabled) {
                const v = Math.min(Math.max(0, vr || 0), 100);
                const pctStr = Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(2)));
                return pctStr + '%';
            }
            return this.formatCurrency(lineVat);
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
                    category: product.category || '',
                    vatEnabled: !!product.vatEnabled,
                    vatType: product.vatType || 'percent',
                    vatValue: parseFloat(product.vatValue) || 0
                });
            }

            this.renderCart();
            this.filterProducts(document.getElementById('pos-search')?.value || '', { resetPage: false });
        },

        removeFromCart: function (productId) {
            cart = cart.filter(c => c.id !== productId);
            this.renderCart();
            this.filterProducts(document.getElementById('pos-search')?.value || '', { resetPage: false });
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
            this.filterProducts(document.getElementById('pos-search')?.value || '', { resetPage: false });
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
                        ${this.formatCurrency(this.getLineGrossTotal(item))}
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
            const baseSubtotal = this.roundMoney(
                cart.reduce((sum, item) => sum + this.getLineBaseTotal(item), 0)
            );
            const productVatTotal = this.roundMoney(
                cart.reduce((sum, item) => sum + this.getPosLineProductVat(item), 0)
            );
            const grossSubtotal = this.roundMoney(
                cart.reduce((sum, item) => sum + this.getLineGrossTotal(item), 0)
            );

            const discountInput = document.getElementById('pos-discount');
            const discountType = document.getElementById('pos-discount-type');
            const vatInput = document.getElementById('pos-vat');
            const vatType = document.getElementById('pos-vat-type');
            const applyVat = document.getElementById('pos-apply-vat');

            let discount = 0;
            const discountValue = parseFloat(discountInput?.value) || 0;
            if (discountValue > 0) {
                if (discountType?.value === 'percent') {
                    discount = this.roundMoney(grossSubtotal * (Math.min(discountValue, 100) / 100));
                } else {
                    discount = this.roundMoney(Math.min(discountValue, grossSubtotal));
                }
            }

            const netTotal = this.roundMoney(Math.max(grossSubtotal - discount, 0));

            let vatAmount = 0;
            const posVatValue = parseFloat(vatInput?.value) || 0;
            const vatEnabled = !!applyVat?.checked;
            if (vatEnabled && posVatValue > 0) {
                if (vatType?.value === 'percent') {
                    vatAmount = this.roundMoney(netTotal * (Math.min(posVatValue, 100) / 100));
                } else {
                    vatAmount = this.roundMoney(Math.min(posVatValue, netTotal));
                }
            }

            const total = this.roundMoney(netTotal + vatAmount);

            return {
                baseSubtotal,
                productVatTotal,
                grossSubtotal,
                subtotal: baseSubtotal,
                discountValue,
                discountType: discountType?.value || 'amount',
                discountAmount: discount,
                netTotal,
                vatEnabled,
                vatValue: posVatValue,
                vatType: vatType?.value || 'percent',
                vatAmount,
                total
            };
        },

        updateTotals: function () {
            const totals = this.getCurrentTotals();

            const baseSubEl = document.getElementById('pos-base-subtotal');
            const prodVatRow = document.getElementById('pos-product-vat-summary-row');
            const prodVatEl = document.getElementById('pos-product-vat-total');
            const subtotalEl = document.getElementById('pos-subtotal');
            const netTotalEl = document.getElementById('pos-net-total');
            const vatAmountEl = document.getElementById('pos-vat-amount');
            const totalEl = document.getElementById('pos-total');
            if (baseSubEl) baseSubEl.textContent = this.formatCurrency(totals.baseSubtotal);
            if (prodVatRow && prodVatEl) {
                if (totals.productVatTotal > 0) {
                    prodVatRow.style.display = '';
                    prodVatEl.textContent = this.formatCurrency(totals.productVatTotal);
                } else {
                    prodVatRow.style.display = 'none';
                }
            }
            if (subtotalEl) subtotalEl.textContent = this.formatCurrency(totals.grossSubtotal);
            if (netTotalEl) netTotalEl.textContent = this.formatCurrency(totals.netTotal);
            if (vatAmountEl) vatAmountEl.textContent = this.formatCurrency(totals.vatAmount);
            if (totalEl) totalEl.textContent = this.formatCurrency(totals.total);

            this.computeChange();
        },

        computeChange: function () {
            const total = this.getCurrentTotals().total;
            const paid = this.roundMoney(parseFloat(document.getElementById('pos-amount-paid')?.value) || 0);
            const changeEl = document.getElementById('pos-change-due');
            const changeAmt = document.getElementById('pos-change-amount');

            if (paid > 0 && changeEl && changeAmt) {
                changeEl.style.display = 'block';
                const change = this.roundMoney(paid - total);
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
                const totalProfit = this.roundMoney(
                    cart.reduce((sum, item) => sum + this.roundMoney((this.getLineUnitPrice(item) - (parseFloat(item.buyingPrice) || 0)) * this.getLineQuantity(item)), 0) - totals.discountAmount
                );

                const paymentMethod = document.querySelector('.pos-pay-method.active')?.dataset.method || 'cash';
                const amountPaidRaw = paymentMethod === 'cash' ? (parseFloat(document.getElementById('pos-amount-paid')?.value) || totals.total) : totals.total;
                const amountPaid = this.roundMoney(amountPaidRaw);
                const changeDue = this.roundMoney(Math.max(amountPaid - totals.total, 0));

                const saleId = this.generateSaleId();
                const now = new Date();
                const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;

                const saleData = {
                    saleId: saleId,
                    customer: {
                        name: (document.getElementById('pos-customer-name')?.value || '').trim(),
                        phone: (document.getElementById('pos-customer-phone')?.value || '').trim()
                    },
                    items: cart.map(item => {
                        const qty = this.getLineQuantity(item);
                        const unitPrice = this.getLineUnitPrice(item);
                        const lineBaseTotal = this.getLineBaseTotal(item);
                        const productVatAmount = this.getPosLineProductVat(item);
                        const lineGrossTotal = this.getLineGrossTotal(item);
                        return {
                            productId: item.id,
                            name: item.name,
                            sku: item.sku,
                            category: item.category,
                            drugType: item.drugType,
                            unitPrice: unitPrice,
                            buyingPrice: parseFloat(item.buyingPrice) || 0,
                            quantity: qty,
                            lineBaseTotal: lineBaseTotal,
                            productVatAmount: productVatAmount,
                            lineGrossTotal: lineGrossTotal,
                            lineTotal: lineGrossTotal,
                            profit: this.roundMoney((unitPrice - (parseFloat(item.buyingPrice) || 0)) * qty),
                            vatEnabled: !!item.vatEnabled,
                            vatType: item.vatType || 'percent',
                            vatValue: parseFloat(item.vatValue) || 0
                        };
                    }),
                    subtotal: totals.baseSubtotal,
                    productVatTotal: totals.productVatTotal,
                    grossSubtotal: totals.grossSubtotal,
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
                this.filterProducts(document.getElementById('pos-search')?.value || '', { resetPage: false });

                // Reset discount & payment
                const di = document.getElementById('pos-discount');
                if (di) di.value = '0';
                const ap = document.getElementById('pos-amount-paid');
                if (ap) ap.value = '';
                const cn = document.getElementById('pos-customer-name');
                const cp = document.getElementById('pos-customer-phone');
                if (cn) cn.value = '';
                if (cp) cp.value = '';
                this.detectExistingCustomer();

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

            const hasLineProductVat = sale.items.some(it => this.getProductVatForReceiptItem(it) > 0);

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
                                    ${hasLineProductVat ? '<th style="text-align:right">VAT</th>' : ''}
                                    <th style="text-align:right">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${sale.items.map((item, i) => {
                                    const vatCell = this.formatReceiptLineVatDisplay(item);
                                    const vatCol = hasLineProductVat
                                        ? `<td style="text-align:right">${vatCell}</td>`
                                        : '';
                                    return `
                <tr>
                    <td>${i + 1}</td>
                    <td>${this.escapeHtml(item.name)}</td>
                    <td style="text-align:center">${item.quantity}</td>
                    <td style="text-align:right">${this.formatCurrency(item.unitPrice)}</td>
                    ${vatCol}
                    <td style="text-align:right">${this.formatCurrency(this.getReceiptLineGross(item))}</td>
                </tr>`;
                                }).join('')}
                            </tbody>
                        </table>

                        <div class="pos-receipt-totals">
                            ${(sale.productVatTotal || 0) > 0 ? `
                            <div class="pos-receipt-row">
                                <span>Subtotal (ex. VAT)</span>
                                <span>${this.formatCurrency(sale.subtotal)}</span>
                            </div>
                            <div class="pos-receipt-row">
                                <span>Product VAT</span>
                                <span>${this.formatCurrency(sale.productVatTotal)}</span>
                            </div>
                            <div class="pos-receipt-row">
                                <span>Subtotal (incl. VAT)</span>
                                <span>${this.formatCurrency(sale.grossSubtotal != null ? sale.grossSubtotal : this.roundMoney((sale.subtotal || 0) + (sale.productVatTotal || 0)))}</span>
                            </div>` : `
                            <div class="pos-receipt-row">
                                <span>Subtotal</span>
                                <span>${this.formatCurrency(sale.subtotal)}</span>
                            </div>`}
                            ${sale.discountAmount > 0 ? `
                            <div class="pos-receipt-row">
                                <span>Discount ${sale.discountType === 'percent' ? '(' + sale.discountValue + '%)' : ''}</span>
                                <span>- ${this.formatCurrency(sale.discountAmount)}</span>
                            </div>` : ''}
                            <div class="pos-receipt-row">
                                <span>Net Total</span>
                                <span>${this.formatCurrency(sale.netTotal != null ? sale.netTotal : (this.roundMoney((sale.subtotal || 0) + (sale.productVatTotal || 0)) - (sale.discountAmount || 0)))}</span>
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
            if (unsubPosCustomers) { unsubPosCustomers(); unsubPosCustomers = null; }
            if (this._keyboardHandler) {
                document.removeEventListener('keydown', this._keyboardHandler);
                this._keyboardHandler = null;
            }
            cart = [];
            inventoryCache = [];
            customerDirectory = [];
            filteredProductsList = [];
            posProductsPage = 1;
        }
    };

    window.PharmaFlow.POS = POS;
})();
