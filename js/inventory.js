/**
 * PharmaFlow - Inventory Module
 * Comprehensive inventory management with:
 *   1. Real-time stats (total products, value, out of stock, low stock, expiring soon, categories)
 *   2. View Inventory — searchable, filterable, sortable product table with real-time updates
 *   3. Add Inventory — full product entry form with validation
 *   4. Edit / Delete products
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    // Active Firestore listener unsubscribers
    let unsubInventory = null;
    let unsubReconciliationSales = null;
    let unsubReconciliationStock = null;
    let unsubInventoryDisposals = null;
    let allProducts = [];
    let quarantinedByProduct = {};
    let reconciliationSales = [];
    let reconciliationStockHistory = [];
    let unsubBatchTracker = null;

    // Pagination state
    let currentPage = 1;
    let pageSize = 50;
    let filteredProducts = [];

    const Inventory = {

        // ─── HELPERS ─────────────────────────────────────────

        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        formatCurrency: function (amount) {
            return PharmaFlow.Settings && PharmaFlow.Settings.formatCurrency ? PharmaFlow.Settings.formatCurrency(amount) : 'KSH ' + new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
        },

        formatDate: function (ts) {
            if (PharmaFlow.Settings && PharmaFlow.Settings.formatDate) return PharmaFlow.Settings.formatDate(ts);
            if (!ts) return '—';
            const d = ts.toDate ? ts.toDate() : new Date(ts);
            return d.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
        },

        formatDateTime: function (val) {
            if (PharmaFlow.Settings && PharmaFlow.Settings.formatDateTime) return PharmaFlow.Settings.formatDateTime(val);
            if (!val) return '—';
            const d = val.toDate ? val.toDate() : (val.seconds ? new Date(val.seconds * 1000) : new Date(val));
            if (isNaN(d.getTime())) return '—';
            return d.toLocaleDateString('en-KE', { month: 'short', day: 'numeric' }) + ' ' +
                d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
        },

        getStockBatches: function (product) {
            if (!product) return [];
            if (Array.isArray(product.stockBatches) && product.stockBatches.length) {
                return product.stockBatches.slice();
            }

            if (product.quantity || product.expiryDate || product.batchNumber) {
                return [{
                    batchNumber: product.batchNumber || '',
                    quantity: product.quantity || 0,
                    expiryDate: product.expiryDate || null,
                    buyingPrice: parseFloat(product.buyingPrice) || 0,
                    sellingPrice: parseFloat(product.sellingPrice) || 0,
                    minimumSellPrice: parseFloat(product.minimumSellPrice) || parseFloat(product.buyingPrice) || 0,
                    addedAt: product.createdAt || product.updatedAt || null,
                    legacy: true
                }];
            }

            return [];
        },

        getPrimaryExpiryFromBatches: function (batches) {
            const dates = (batches || [])
                .map(batch => batch && batch.expiryDate ? (batch.expiryDate.toDate ? batch.expiryDate.toDate() : new Date(batch.expiryDate)) : null)
                .filter(Boolean)
                .sort((a, b) => a - b);

            return dates.length ? firebase.firestore.Timestamp.fromDate(dates[0]) : null;
        },

        getBatchLabel: function (product) {
            const batches = this.getStockBatches(product);
            if (!batches.length) return product && product.batchNumber ? product.batchNumber : '—';
            if (batches.length === 1) return batches[0].batchNumber || product.batchNumber || '—';

            const first = batches[0].batchNumber || product.batchNumber || 'Batch';
            return first + ' +' + (batches.length - 1) + ' more';
        },

        renderStockBatchHistory: function (product) {
            const batches = this.getStockBatches(product);
            if (!batches.length) {
                return '<div class="inv-batch-history-empty">No batch history yet.</div>';
            }

            return '<div class="inv-batch-history">' + batches.map((batch, index) => {
                const expiry = batch.expiryDate ? this.formatDate(batch.expiryDate) : '—';
                const batchNumber = batch.batchNumber || ('Batch ' + (index + 1));
                const quantity = batch.quantity || 0;
                const buyingPrice = batch.buyingPrice != null ? batch.buyingPrice : product.buyingPrice;
                const sellingPrice = batch.sellingPrice != null ? batch.sellingPrice : product.sellingPrice;
                return '<div class="inv-batch-history__item"><strong>' + this.escapeHtml(batchNumber) + '</strong><span>Qty: ' + quantity + '</span><span>Buy: ' + this.formatCurrency(buyingPrice || 0) + '</span><span>Sell: ' + this.formatCurrency(sellingPrice || 0) + '</span><span>Expiry: ' + expiry + '</span></div>';
            }).join('') + '</div>';
        },

        generateSKU: function () {
            const prefix = 'PF';
            const timestamp = Date.now().toString(36).toUpperCase();
            const random = Math.random().toString(36).substring(2, 6).toUpperCase();
            return prefix + '-' + timestamp + random;
        },

        generateBatchNumber: function () {
            const prefix = 'BN';
            const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
            const timePart = Date.now().toString(36).toUpperCase().slice(-5);
            const randomPart = Math.random().toString(36).substring(2, 5).toUpperCase();
            return prefix + '-' + datePart + '-' + timePart + randomPart;
        },

        applyBatchMode: function (modeSelectId, inputId, buttonId) {
            const modeSelect = document.getElementById(modeSelectId);
            const input = document.getElementById(inputId);
            const button = document.getElementById(buttonId);
            if (!modeSelect || !input) return;

            const sync = () => {
                const isAuto = modeSelect.value === 'auto';
                input.readOnly = isAuto;
                input.placeholder = isAuto ? 'Auto-generated batch number' : 'Enter batch number manually';
                if (button) button.disabled = !isAuto;
                if (isAuto && !input.value) input.value = this.generateBatchNumber();
            };

            modeSelect.addEventListener('change', sync);
            if (button) {
                button.addEventListener('click', () => {
                    input.value = this.generateBatchNumber();
                    modeSelect.value = 'auto';
                    sync();
                });
            }

            sync();
        },

        DRUG_CATEGORIES: [
            'Analgesics & Antipyretics',
            'Anti-Inflammatories (NSAIDs)',
            'Antibiotics',
            'Antifungals',
            'Antivirals',
            'Antiparasitics & Antihelminthics',
            'Antimalarials',
            'Antiretrovirals (ARVs)',
            'Antituberculosis',
            'Cardiovascular Drugs',
            'Antihypertensives',
            'Antidiabetics',
            'Antilipemics & Cholesterol Agents',
            'Anticoagulants & Antithrombotics',
            'Respiratory Drugs',
            'Bronchodilators & Antiasthmatics',
            'Antihistamines & Allergy',
            'Cough & Cold Preparations',
            'Gastrointestinal Drugs',
            'Antacids & Antiulcer',
            'Laxatives',
            'Antiemetics',
            'Antidiarrheals',
            'Hormones & Endocrine',
            'Corticosteroids',
            'Thyroid Agents',
            'Contraceptives',
            'Hormone Replacement Therapy',
            'CNS Drugs',
            'Antidepressants',
            'Antipsychotics',
            'Anxiolytics & Sedatives',
            'Anticonvulsants & Antiepileptics',
            'Muscle Relaxants',
            'Anaesthetics',
            'Opioid Analgesics',
            'Immunosuppressants',
            'Vaccines & Immunoglobulins',
            'Antineoplastics (Oncology)',
            'Dermatological Preparations',
            'Ophthalmic Preparations',
            'Otic Preparations',
            'Nasal Preparations',
            'Dental & Oral Care',
            'Nutritional Supplements',
            'Vitamins & Minerals',
            'Iron & Haematinics',
            'Electrolytes & IV Fluids',
            'Diagnostic Agents',
            'Antiseptics & Disinfectants',
            'Surgical Supplies',
            'Medical Devices & Equipment',
            'Wound Care',
            'Urologicals',
            'Herbal & Traditional Medicine',
            'Veterinary Drugs',
            'Baby & Paediatric Products',
            'Personal Care & Cosmetics',
            'Family Planning',
            'First Aid Supplies',
            'Psychotropic Substances',
            'Controlled Substances',
            'Other'
        ],

        DRUG_TYPES: {
            'OTC': 'Over The Counter',
            'POM': 'Prescription Only',
            'PO': 'Pharmacy Only',
            'DDA': 'Dangerous Drug'
        },

        getDrugTypeBadge: function (type) {
            const classes = {
                'OTC': 'drug-type--otc',
                'POM': 'drug-type--pom',
                'PO': 'drug-type--po',
                'DDA': 'drug-type--dda'
            };
            const label = this.DRUG_TYPES[type] || type || '—';
            const cls = classes[type] || '';
            return type ? '<span class="drug-type-badge ' + cls + '">' + type + '</span>' : '—';
        },

        getVatDisplay: function (product) {
            const enabled = !!product.vatEnabled;
            const value = parseFloat(product.vatValue) || 0;
            const type = product.vatType || 'percent';
            if (!enabled || value <= 0) return '—';
            if (type === 'amount') return this.formatCurrency(value);
            return value + '%';
        },

        /** Unit selling price + product VAT (same rules as POS for qty 1). Used for add-form preview. */
        getUnitSellingInclProductVat: function (sellingPrice, vatEnabled, vatType, vatValue) {
            const sell = parseFloat(sellingPrice) || 0;
            const raw = parseFloat(vatValue) || 0;
            if (!vatEnabled || raw <= 0 || sell <= 0) return Math.round(sell * 100) / 100;
            const base = Math.round(sell * 100) / 100;
            const type = (vatType || 'percent') === 'amount' ? 'amount' : 'percent';
            if (type === 'amount') {
                return Math.round((base + raw) * 100) / 100;
            }
            const pct = Math.min(Math.max(raw, 0), 100);
            const vatAmt = Math.round(base * (pct / 100) * 100) / 100;
            return Math.round((base + vatAmt) * 100) / 100;
        },

        updateAddFormVatTotalPreview: function () {
            const sell = parseFloat(document.getElementById('inv-selling-price')?.value) || 0;
            const vatEn = (document.getElementById('inv-vat-enabled')?.value || 'false') === 'true';
            const vatRaw = parseFloat(document.getElementById('inv-vat-value')?.value) || 0;
            const vatType = document.getElementById('inv-vat-type')?.value || 'percent';
            const row = document.getElementById('inv-row-total-with-vat');
            const out = document.getElementById('inv-total-with-vat');
            if (!row || !out) return;
            if (!vatEn || vatRaw <= 0 || sell <= 0) {
                row.style.display = 'none';
                out.textContent = '—';
                return;
            }
            const total = this.getUnitSellingInclProductVat(sell, vatEn, vatType, vatRaw);
            row.style.display = '';
            out.textContent = this.formatCurrency(total);
        },

        updateEditFormVatTotalPreview: function () {
            const sell = parseFloat(document.getElementById('edit-selling-price')?.value) || 0;
            const vatEn = (document.getElementById('edit-vat-enabled')?.value || 'false') === 'true';
            const vatRaw = parseFloat(document.getElementById('edit-vat-value')?.value) || 0;
            const vatType = document.getElementById('edit-vat-type')?.value || 'percent';
            const row = document.getElementById('edit-row-total-with-vat');
            const out = document.getElementById('edit-total-with-vat');
            if (!row || !out) return;
            if (!vatEn || vatRaw <= 0 || sell <= 0) {
                row.style.display = 'none';
                out.textContent = '—';
                return;
            }
            const total = this.getUnitSellingInclProductVat(sell, vatEn, vatType, vatRaw);
            row.style.display = '';
            out.textContent = this.formatCurrency(total);
        },

        showToast: function (message, type) {
            const existing = document.querySelector('.inv-toast');
            if (existing) existing.remove();

            const toast = document.createElement('div');
            toast.className = 'inv-toast inv-toast--' + (type || 'success');
            toast.innerHTML = '<i class="fas fa-' + (type === 'error' ? 'exclamation-circle' : 'check-circle') + '"></i> ' + message;
            document.body.appendChild(toast);
            setTimeout(() => toast.classList.add('show'), 10);
            setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
        },

        // ─── VIEW INVENTORY ──────────────────────────────────

        renderView: function (container) {
            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="inv-module">
                    <!-- Page Header -->
                    <div class="page-header">
                        <div>
                            <h2>View Inventory</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Inventory</span><span>/</span>
                                <span>View Inventory</span>
                            </div>
                        </div>
                        <div class="page-header-right">
                            <button class="btn btn-sm btn-outline inv-refresh-btn" id="inv-refresh-btn" title="Force refresh inventory from server">
                                <i class="fas fa-arrows-rotate"></i> Refresh
                            </button>
                            <button class="btn btn-sm btn-outline" id="inv-export-btn">
                                <i class="fas fa-file-export"></i> Export
                            </button>
                            <button class="btn btn-sm btn-outline" id="inv-import-btn">
                                <i class="fas fa-file-import"></i> Bulk Import
                            </button>
                            <button class="btn btn-sm btn-primary" id="inv-add-new-btn">
                                <i class="fas fa-plus"></i> Add Product
                            </button>
                        </div>
                    </div>

                    <div class="inv-live-sync" id="inv-live-sync">
                        <span class="inv-live-dot"></span>
                        <span id="inv-live-sync-text">Live inventory sync active</span>
                    </div>

                    <!-- Stats Row -->
                    <div class="stats-row" id="inv-stats-row">
                        <div class="stat-card stat-card--blue">
                            <div class="stat-card__icon"><i class="fas fa-boxes-stacked"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__label">Total Products</span>
                                <span class="stat-card__value" id="inv-stat-total">0</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--green">
                            <div class="stat-card__icon"><i class="fas fa-coins"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__label">Total Value</span>
                                <span class="stat-card__value" id="inv-stat-value">KSH 0.00</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--red">
                            <div class="stat-card__icon"><i class="fas fa-box-open"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__label">Out of Stock</span>
                                <span class="stat-card__value" id="inv-stat-outofstock">0</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--orange">
                            <div class="stat-card__icon"><i class="fas fa-triangle-exclamation"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__label">Low Stock</span>
                                <span class="stat-card__value" id="inv-stat-lowstock">0</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--purple">
                            <div class="stat-card__icon"><i class="fas fa-clock"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__label">Expiring Soon</span>
                                <span class="stat-card__value" id="inv-stat-expiring">0</span>
                            </div>
                        </div>
                    </div>

                    <!-- Filters Bar -->
                    <div class="inv-toolbar">
                        <div class="inv-search">
                            <i class="fas fa-search"></i>
                            <input type="text" id="inv-search-input" placeholder="Search by brand name, generic name, batch, or category...">
                        </div>
                        <div class="inv-filters">
                            <select id="inv-filter-category">
                                <option value="">All Categories</option>
                                ${this.DRUG_CATEGORIES.map(c => '<option value="' + c + '">' + c + '</option>').join('')}
                            </select>
                            <select id="inv-filter-drug-type">
                                <option value="">All Drug Types</option>
                                <option value="OTC">OTC</option>
                                <option value="POM">Prescription Only</option>
                                <option value="PO">Pharmacy Only</option>
                                <option value="DDA">DDA</option>
                            </select>
                            <select id="inv-filter-status">
                                <option value="">All Status</option>
                                <option value="in-stock">In Stock</option>
                                <option value="low-stock">Low Stock</option>
                                <option value="out-of-stock">Out of Stock</option>
                                <option value="expiring">Expiring Soon</option>
                                <option value="expired">Expired</option>
                            </select>
                            <select id="inv-sort-by">
                                <option value="name-asc">Name (A–Z)</option>
                                <option value="name-desc">Name (Z–A)</option>
                                <option value="qty-asc">Qty (Low–High)</option>
                                <option value="qty-desc">Qty (High–Low)</option>
                                <option value="price-asc">Price (Low–High)</option>
                                <option value="price-desc">Price (High–Low)</option>
                                <option value="expiry-asc">Expiry (Soonest)</option>
                            </select>
                        </div>
                    </div>

                    <!-- Products Table -->
                    <div class="inv-table-card">
                        <div class="inv-table-wrap">
                            <table class="inv-table" id="inv-table">
                                <thead>
                                    <tr>
                                        <th>SKU</th>
                                        <th>Brand / trade name</th>
                                        <th>Category</th>
                                        <th>Drug Type</th>
                                        <th>Batch No.</th>
                                        <th>Clean Qty</th>
                                        <th>Broken / Quarantined</th>
                                        <th>Buying Price</th>
                                        <th>Selling Price</th>
                                        <th>VAT</th>
                                        <th>Expiry Date</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="inv-table-body">
                                    <tr>
                                        <td colspan="13" class="inv-loading-cell">
                                            <i class="fas fa-spinner fa-spin"></i> Loading inventory...
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div class="inv-table-footer" id="inv-table-footer">
                            <div class="inv-pagination-info">
                                <span id="inv-showing-count">Showing 0 products</span>
                                <select id="inv-page-size" class="inv-page-size-select">
                                    <option value="25">25 / page</option>
                                    <option value="50" selected>50 / page</option>
                                    <option value="100">100 / page</option>
                                    <option value="200">200 / page</option>
                                    <option value="500">500 / page</option>
                                </select>
                            </div>
                            <div class="inv-pagination" id="inv-pagination"></div>
                        </div>
                    </div>
                </div>
            `;

            this.bindViewEvents(container, businessId);

            if (businessId) {
                this.subscribeToInventory(businessId);
                this.subscribeToDisposalSummary(businessId);
            }
        },

        bindViewEvents: function (container, businessId) {
            // Dashboard link
            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) {
                dashLink.addEventListener('click', function (e) {
                    e.preventDefault();
                    PharmaFlow.Sidebar.setActive('dashboard', null);
                });
            }

            // Add new product button — switch to add tab
            const addBtn = document.getElementById('inv-add-new-btn');
            if (addBtn) {
                addBtn.addEventListener('click', function () {
                    PharmaFlow.Sidebar.setActive('inventory', 'add-inventory');
                });
            }

            // Import button — opens import modal
            const importBtn = document.getElementById('inv-import-btn');
            if (importBtn) {
                importBtn.addEventListener('click', () => this.openImportModal(businessId));
            }

            // Export button
            const exportBtn = document.getElementById('inv-export-btn');
            if (exportBtn) {
                exportBtn.addEventListener('click', () => this.showExportMenu(exportBtn));
            }

            const refreshBtn = document.getElementById('inv-refresh-btn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => this.refreshInventoryData(businessId, { forceServer: true }));
            }

            // Page size
            const pageSizeSelect = document.getElementById('inv-page-size');
            if (pageSizeSelect) {
                pageSizeSelect.addEventListener('change', (e) => {
                    pageSize = parseInt(e.target.value) || 50;
                    currentPage = 1;
                    this.renderCurrentPage();
                });
            }

            // Search
            const searchInput = document.getElementById('inv-search-input');
            if (searchInput) {
                searchInput.addEventListener('input', () => this.applyFilters());
            }

            // Filter dropdowns
            const catFilter = document.getElementById('inv-filter-category');
            const drugTypeFilter = document.getElementById('inv-filter-drug-type');
            const statusFilter = document.getElementById('inv-filter-status');
            const sortFilter = document.getElementById('inv-sort-by');
            if (catFilter) catFilter.addEventListener('change', () => this.applyFilters());
            if (drugTypeFilter) drugTypeFilter.addEventListener('change', () => this.applyFilters());
            if (statusFilter) statusFilter.addEventListener('change', () => this.applyFilters());
            if (sortFilter) sortFilter.addEventListener('change', () => this.applyFilters());
        },

        setRefreshState: function (state, message) {
            const btn = document.getElementById('inv-refresh-btn');
            const text = document.getElementById('inv-live-sync-text');
            const icon = btn ? btn.querySelector('i') : null;

            if (text && message) text.textContent = message;

            if (!btn || !icon) return;
            const isLoading = state === 'loading';
            btn.disabled = isLoading;
            btn.classList.toggle('is-loading', isLoading);
            icon.className = isLoading ? 'fas fa-spinner fa-spin' : 'fas fa-arrows-rotate';
        },

        applyInventorySnapshot: function (snapshot) {
            const products = [];
            if (snapshot && typeof snapshot.forEach === 'function') {
                snapshot.forEach(doc => {
                    products.push({ id: doc.id, ...doc.data() });
                });
            } else if (snapshot && Array.isArray(snapshot.docs)) {
                snapshot.docs.forEach(doc => {
                    products.push({ id: doc.id, ...doc.data() });
                });
            }

            allProducts = products;
            this.updateStats();
            this.populateCategories();
            this.applyFilters();
            return products.length;
        },

        refreshInventoryData: async function (businessId, options) {
            if (!businessId) return;
            const colRef = getBusinessCollection(businessId, 'inventory');
            if (!colRef || typeof colRef.get !== 'function') return;

            const forceServer = options && options.forceServer;
            this.setRefreshState('loading', 'Refreshing inventory from server...');

            try {
                let snapshot;
                try {
                    snapshot = forceServer ? await colRef.get({ source: 'server' }) : await colRef.get();
                } catch (err) {
                    if (!forceServer) throw err;
                    snapshot = await colRef.get();
                }

                const count = this.applyInventorySnapshot(snapshot);
                const time = new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
                this.setRefreshState('ready', 'Inventory refreshed at ' + time + ' • ' + count + ' products loaded');
                this.showToast('Inventory refreshed.');
            } catch (err) {
                console.error('Inventory refresh error:', err);
                this.setRefreshState('error', 'Refresh failed. Live sync is still active.');
                this.showToast('Failed to refresh inventory.', 'error');
            }
        },

        subscribeToInventory: function (businessId) {
            // Clean up previous listener
            if (unsubInventory) {
                unsubInventory();
                unsubInventory = null;
            }

            const colRef = getBusinessCollection(businessId, 'inventory');
            if (!colRef) return;

            unsubInventory = colRef.onSnapshot(
                (snapshot) => {
                    // Use docChanges for incremental updates (much faster)
                    if (allProducts.length === 0) {
                        // First load — build array directly
                        this.applyInventorySnapshot(snapshot);
                    } else {
                        // Incremental update
                        snapshot.docChanges().forEach(change => {
                            if (change.type === 'added') {
                                if (!allProducts.find(p => p.id === change.doc.id)) {
                                    allProducts.push({ id: change.doc.id, ...change.doc.data() });
                                }
                            } else if (change.type === 'modified') {
                                const idx = allProducts.findIndex(p => p.id === change.doc.id);
                                if (idx >= 0) allProducts[idx] = { id: change.doc.id, ...change.doc.data() };
                            } else if (change.type === 'removed') {
                                allProducts = allProducts.filter(p => p.id !== change.doc.id);
                            }
                        });
                        this.updateStats();
                        this.populateCategories();
                        this.applyFilters();
                    }
                    const text = document.getElementById('inv-live-sync-text');
                    if (text) {
                        const time = new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
                        text.textContent = 'Live inventory sync active • updated ' + time;
                    }
                    if (PharmaFlow.Disposals) {
                        PharmaFlow.Disposals.syncExpiredInventory(businessId).catch(err => {
                            console.error('Automatic expired stock sync failed:', err);
                        });
                    }
                },
                (err) => {
                    console.error('Inventory listener error:', err);
                    const tbody = document.getElementById('inv-table-body');
                    if (tbody) {
                        tbody.innerHTML = '<tr><td colspan="13" class="inv-loading-cell" style="color:var(--danger)"><i class="fas fa-exclamation-triangle"></i> Failed to load inventory</td></tr>';
                    }
                }
            );
        },

        subscribeToDisposalSummary: function (businessId) {
            if (unsubInventoryDisposals) {
                unsubInventoryDisposals();
                unsubInventoryDisposals = null;
            }
            const ref = getBusinessCollection(businessId, 'disposals');
            if (!ref) return;
            unsubInventoryDisposals = ref.onSnapshot(snapshot => {
                const summary = {};
                snapshot.docs.forEach(doc => {
                    const item = doc.data() || {};
                    if (!item.productId || (item.status || 'pending') !== 'pending') return;
                    if (!summary[item.productId]) summary[item.productId] = { total: 0, broken: 0, expired: 0, other: 0 };
                    const qty = parseInt(item.quantity, 10) || 0;
                    summary[item.productId].total += qty;
                    if (item.reason === 'broken' || item.reason === 'damaged') summary[item.productId].broken += qty;
                    else if (item.reason === 'expired') summary[item.productId].expired += qty;
                    else summary[item.productId].other += qty;
                });
                quarantinedByProduct = summary;
                this.renderCurrentPage();
            }, err => console.error('Inventory disposal summary listener error:', err));
        },

        renderReconciliation: function (container) {
            this.cleanup();
            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="inv-module inv-recon-module">
                    <div class="page-header">
                        <div>
                            <h2>Inventory Reconciliation</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Inventory</span><span>/</span>
                                <span>Reconciliation</span>
                            </div>
                        </div>
                        <div class="page-header-right">
                            <button class="btn btn-sm btn-outline" id="inv-recon-refresh">
                                <i class="fas fa-rotate"></i> Refresh
                            </button>
                        </div>
                    </div>

                    <div class="inv-recon-status">
                        <span class="inv-live-dot"></span>
                        <span>Live reconciliation of inventory stock, sold items, and stock additions</span>
                        <strong id="inv-recon-updated">Waiting for data...</strong>
                    </div>

                    <div class="stats-row inv-recon-stats">
                        <div class="stat-card stat-card--green">
                            <div class="stat-card__icon"><i class="fas fa-circle-check"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__label">Matched Items</span>
                                <span class="stat-card__value" id="recon-stat-matched">0</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--red">
                            <div class="stat-card__icon"><i class="fas fa-triangle-exclamation"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__label">Needs Review</span>
                                <span class="stat-card__value" id="recon-stat-mismatch">0</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--blue">
                            <div class="stat-card__icon"><i class="fas fa-cart-shopping"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__label">Sold Units</span>
                                <span class="stat-card__value" id="recon-stat-sold">0</span>
                            </div>
                        </div>
                        <div class="stat-card stat-card--purple">
                            <div class="stat-card__icon"><i class="fas fa-boxes-stacked"></i></div>
                            <div class="stat-card__body">
                                <span class="stat-card__label">Current Units</span>
                                <span class="stat-card__value" id="recon-stat-current">0</span>
                            </div>
                        </div>
                    </div>

                    <div class="inv-toolbar inv-recon-toolbar">
                        <div class="inv-search">
                            <i class="fas fa-search"></i>
                            <input type="text" id="inv-recon-search" placeholder="Search item, SKU, category, or sale...">
                        </div>
                        <div class="inv-filters">
                            <select id="inv-recon-filter">
                                <option value="">All reconciliation rows</option>
                                <option value="mismatch">Needs review only</option>
                                <option value="matched">Matched only</option>
                                <option value="sold">Sold items only</option>
                                <option value="added">Items with additions</option>
                            </select>
                        </div>
                    </div>

                    <div class="inv-recon-grid">
                        <div class="inv-table-card inv-recon-card">
                            <div class="inv-recon-card-head">
                                <h3><i class="fas fa-scale-balanced"></i> Stock vs Sales Match</h3>
                                <span id="inv-recon-count">0 items</span>
                            </div>
                            <div class="inv-table-wrap">
                                <table class="inv-table inv-recon-table">
                                    <thead>
                                        <tr>
                                            <th>Item</th>
                                            <th>Added</th>
                                            <th>Sold</th>
                                            <th>Expected Left</th>
                                            <th>Current Stock</th>
                                            <th>Batch Check</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody id="inv-recon-body">
                                        <tr><td colspan="7" class="inv-loading-cell"><i class="fas fa-spinner fa-spin"></i> Loading reconciliation...</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div class="inv-recon-activity">
                            <div class="inv-recon-card-head">
                                <h3><i class="fas fa-clock-rotate-left"></i> Live Movements</h3>
                                <span>Latest stock in and sales</span>
                            </div>
                            <div id="inv-recon-movements" class="inv-recon-movements">
                                <div class="inv-empty-cell">Waiting for movements...</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) {
                dashLink.addEventListener('click', function (e) {
                    e.preventDefault();
                    PharmaFlow.Sidebar.setActive('dashboard', null);
                });
            }

            document.getElementById('inv-recon-search')?.addEventListener('input', () => this.renderReconciliationData());
            document.getElementById('inv-recon-filter')?.addEventListener('change', () => this.renderReconciliationData());
            document.getElementById('inv-recon-refresh')?.addEventListener('click', () => this.renderReconciliationData());

            if (businessId) this.subscribeToReconciliation(businessId);
        },

        subscribeToReconciliation: function (businessId) {
            if (unsubInventory) { unsubInventory(); unsubInventory = null; }
            if (unsubReconciliationSales) { unsubReconciliationSales(); unsubReconciliationSales = null; }
            if (unsubReconciliationStock) { unsubReconciliationStock(); unsubReconciliationStock = null; }

            const invRef = getBusinessCollection(businessId, 'inventory');
            const salesRef = getBusinessCollection(businessId, 'sales');
            const stockRef = getBusinessCollection(businessId, 'stock_history');
            if (!invRef || !salesRef || !stockRef) return;

            const render = () => this.renderReconciliationData();

            unsubInventory = invRef.onSnapshot(snap => {
                allProducts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                render();
            }, err => this.showReconciliationError(err));

            unsubReconciliationSales = salesRef.onSnapshot(snap => {
                reconciliationSales = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                render();
            }, err => this.showReconciliationError(err));

            unsubReconciliationStock = stockRef.onSnapshot(snap => {
                reconciliationStockHistory = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                render();
            }, err => this.showReconciliationError(err));
        },

        showReconciliationError: function (err) {
            console.error('Inventory reconciliation listener error:', err);
            const body = document.getElementById('inv-recon-body');
            if (body) {
                body.innerHTML = '<tr><td colspan="7" class="inv-loading-cell" style="color:var(--danger)"><i class="fas fa-exclamation-triangle"></i> Failed to load reconciliation data</td></tr>';
            }
        },

        buildReconciliationRows: function () {
            const rowsById = new Map();

            allProducts.forEach(product => {
                const currentQty = Math.max(0, parseInt(product.quantity, 10) || 0);
                const batchQty = this.getStockBatches(product).reduce((sum, batch) => sum + (parseInt(batch.quantity, 10) || 0), 0);
                rowsById.set(product.id, {
                    productId: product.id,
                    name: product.name || 'Unnamed item',
                    sku: product.sku || '',
                    category: product.category || '',
                    currentQty: currentQty,
                    batchQty: batchQty,
                    soldQty: 0,
                    addedQty: 0,
                    hasStockHistory: false,
                    saleRefs: new Set(),
                    lastMovementAt: product.updatedAt || product.createdAt || ''
                });
            });

            reconciliationStockHistory.forEach(entry => {
                const productId = entry.productId;
                if (!productId) return;
                if (!rowsById.has(productId)) {
                    rowsById.set(productId, {
                        productId: productId,
                        name: entry.productName || 'Deleted / missing inventory item',
                        sku: entry.sku || '',
                        category: entry.category || '',
                        currentQty: 0,
                        batchQty: 0,
                        soldQty: 0,
                        addedQty: 0,
                        hasStockHistory: false,
                        saleRefs: new Set(),
                        lastMovementAt: ''
                    });
                }
                const row = rowsById.get(productId);
                row.addedQty += parseInt(entry.addedQty, 10) || 0;
                row.hasStockHistory = true;
                if (entry.createdAt && String(entry.createdAt) > String(row.lastMovementAt || '')) row.lastMovementAt = entry.createdAt;
            });

            reconciliationSales.forEach(sale => {
                const status = sale.status || 'completed';
                if (status === 'cancelled') return;
                (sale.items || []).forEach(item => {
                    const productId = item.productId;
                    if (!productId) return;
                    if (!rowsById.has(productId)) {
                        rowsById.set(productId, {
                            productId: productId,
                            name: item.name || 'Sold item missing from inventory',
                            sku: item.sku || '',
                            category: item.category || '',
                            currentQty: 0,
                            batchQty: 0,
                            soldQty: 0,
                            addedQty: 0,
                            hasStockHistory: false,
                            saleRefs: new Set(),
                            lastMovementAt: ''
                        });
                    }
                    const row = rowsById.get(productId);
                    row.soldQty += parseInt(item.quantity, 10) || 0;
                    row.saleRefs.add(sale.saleId || sale.id);
                    if (sale.saleDate && String(sale.saleDate) > String(row.lastMovementAt || '')) row.lastMovementAt = sale.saleDate;
                });
            });

            rowsById.forEach(row => {
                row.addedSource = row.hasStockHistory ? 'recorded' : 'inferred';
                if (!row.hasStockHistory) row.addedQty = row.currentQty + row.soldQty;
                row.expectedQty = row.addedQty - row.soldQty;
                row.diffQty = row.currentQty - row.expectedQty;
                row.batchDiff = row.batchQty - row.currentQty;
                row.matched = row.diffQty === 0 && row.batchDiff === 0;
            });

            return Array.from(rowsById.values()).sort((a, b) => {
                if (a.matched !== b.matched) return a.matched ? 1 : -1;
                return (a.name || '').localeCompare(b.name || '');
            });
        },

        renderReconciliationData: function () {
            const body = document.getElementById('inv-recon-body');
            if (!body) return;

            const query = (document.getElementById('inv-recon-search')?.value || '').toLowerCase().trim();
            const filter = document.getElementById('inv-recon-filter')?.value || '';
            let rows = this.buildReconciliationRows();
            const allRows = rows.slice();

            if (query) {
                rows = rows.filter(row => {
                    const haystack = [row.name, row.sku, row.category, Array.from(row.saleRefs || []).join(' ')].join(' ').toLowerCase();
                    return haystack.indexOf(query) !== -1;
                });
            }
            if (filter === 'mismatch') rows = rows.filter(row => !row.matched);
            if (filter === 'matched') rows = rows.filter(row => row.matched);
            if (filter === 'sold') rows = rows.filter(row => row.soldQty > 0);
            if (filter === 'added') rows = rows.filter(row => row.addedQty > 0);

            const matched = allRows.filter(row => row.matched).length;
            const mismatched = allRows.length - matched;
            this.setStat('recon-stat-matched', matched);
            this.setStat('recon-stat-mismatch', mismatched);
            this.setStat('recon-stat-sold', allRows.reduce((sum, row) => sum + row.soldQty, 0));
            this.setStat('recon-stat-current', allRows.reduce((sum, row) => sum + row.currentQty, 0));

            const count = document.getElementById('inv-recon-count');
            if (count) count.textContent = rows.length + ' item' + (rows.length !== 1 ? 's' : '');
            const updated = document.getElementById('inv-recon-updated');
            if (updated) updated.textContent = 'Updated ' + this.formatDateTime(new Date().toISOString());

            if (!rows.length) {
                body.innerHTML = '<tr><td colspan="7" class="inv-empty-cell"><i class="fas fa-inbox"></i> No reconciliation rows found</td></tr>';
            } else {
                body.innerHTML = rows.map(row => {
                    const status = row.matched
                        ? '<span class="inv-recon-badge inv-recon-badge--ok"><i class="fas fa-check"></i> Matched</span>'
                        : '<span class="inv-recon-badge inv-recon-badge--warn"><i class="fas fa-triangle-exclamation"></i> Review ' + (row.diffQty > 0 ? '+' : '') + row.diffQty + '</span>';
                    const batchStatus = row.batchDiff === 0
                        ? '<span class="inv-recon-batch-ok">OK</span>'
                        : '<span class="inv-recon-batch-warn">' + (row.batchDiff > 0 ? '+' : '') + row.batchDiff + '</span>';
                    return '<tr>' +
                        '<td><div class="inv-product-name"><strong>' + this.escapeHtml(row.name) + '</strong><small>' + this.escapeHtml(row.sku || row.category || 'No SKU') + '</small></div></td>' +
                        '<td><strong>' + row.addedQty + '</strong><small class="inv-recon-source">' + row.addedSource + '</small></td>' +
                        '<td>' + row.soldQty + '</td>' +
                        '<td>' + row.expectedQty + '</td>' +
                        '<td><strong>' + row.currentQty + '</strong></td>' +
                        '<td>' + batchStatus + '</td>' +
                        '<td>' + status + '</td>' +
                    '</tr>';
                }).join('');
            }

            this.renderReconciliationMovements();
        },

        renderReconciliationMovements: function () {
            const container = document.getElementById('inv-recon-movements');
            if (!container) return;

            const stockMoves = reconciliationStockHistory.map(entry => ({
                type: 'in',
                date: entry.createdAt || '',
                title: entry.productName || 'Stock added',
                meta: '+' + (entry.addedQty || 0) + ' units' + (entry.orderId ? ' from ' + entry.orderId : ''),
                icon: 'fa-arrow-down'
            }));
            const saleMoves = [];
            reconciliationSales.forEach(sale => {
                if ((sale.status || 'completed') === 'cancelled') return;
                (sale.items || []).forEach(item => {
                    saleMoves.push({
                        type: 'out',
                        date: sale.saleDate || sale.createdAt || '',
                        title: item.name || 'Sold item',
                        meta: '-' + (item.quantity || 0) + ' units on ' + (sale.saleId || sale.id || 'sale'),
                        icon: 'fa-arrow-up'
                    });
                });
            });

            const moves = stockMoves.concat(saleMoves).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 12);
            if (!moves.length) {
                container.innerHTML = '<div class="inv-empty-cell">No stock or sale movements yet.</div>';
                return;
            }

            container.innerHTML = moves.map(move => {
                return '<div class="inv-recon-move inv-recon-move--' + move.type + '">' +
                    '<div class="inv-recon-move-icon"><i class="fas ' + move.icon + '"></i></div>' +
                    '<div><strong>' + this.escapeHtml(move.title) + '</strong><span>' + this.escapeHtml(move.meta) + '</span><small>' + this.formatDateTime(move.date) + '</small></div>' +
                '</div>';
            }).join('');
        },

        /**
         * Delegates to PharmaFlow.computeInventoryStats (inventory-stats-shared.js) — single source for Dashboard + Inventory.
         */
        computeStatsFromProducts: function (products) {
            if (PharmaFlow.computeInventoryStats) {
                return PharmaFlow.computeInventoryStats(products);
            }
            return { totalProducts: 0, totalValue: 0, outOfStock: 0, lowStock: 0, expiringSoon: 0 };
        },

        updateStats: function () {
            const s = this.computeStatsFromProducts(allProducts);
            this.setStat('inv-stat-total', s.totalProducts);
            this.setStat('inv-stat-value', this.formatCurrency(s.totalValue));
            this.setStat('inv-stat-outofstock', s.outOfStock);
            this.setStat('inv-stat-lowstock', s.lowStock);
            this.setStat('inv-stat-expiring', s.expiringSoon);
        },

        setStat: function (id, value) {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        },

        populateCategories: function () {
            const catFilter = document.getElementById('inv-filter-category');
            if (!catFilter) return;

            // Add any custom categories from products that aren't in the standard list
            const standardCats = new Set(this.DRUG_CATEGORIES);
            const customCats = new Set();
            allProducts.forEach(p => {
                if (p.category && !standardCats.has(p.category)) customCats.add(p.category);
            });

            if (customCats.size > 0) {
                const currentVal = catFilter.value;
                Array.from(customCats).sort().forEach(cat => {
                    if (!catFilter.querySelector('option[value="' + CSS.escape(cat) + '"]')) {
                        const opt = document.createElement('option');
                        opt.value = cat;
                        opt.textContent = cat;
                        catFilter.appendChild(opt);
                    }
                });
                catFilter.value = currentVal;
            }
        },

        getProductStatus: function (product) {
            const qty = product.quantity || 0;
            const reorder = product.reorderLevel || 10;
            const now = new Date();

            if (product.expiryDate) {
                const exp = product.expiryDate.toDate ? product.expiryDate.toDate() : new Date(product.expiryDate);
                if (exp <= now) return 'expired';
                const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                if (exp <= thirtyDays) return 'expiring';
            }

            if (qty <= 0) return 'out-of-stock';
            if (qty <= reorder) return 'low-stock';
            return 'in-stock';
        },

        applyFilters: function () {
            const search = (document.getElementById('inv-search-input')?.value || '').toLowerCase();
            const catVal = document.getElementById('inv-filter-category')?.value || '';
            const drugTypeVal = document.getElementById('inv-filter-drug-type')?.value || '';
            const statusVal = document.getElementById('inv-filter-status')?.value || '';
            const sortVal = document.getElementById('inv-sort-by')?.value || 'name-asc';

            let filtered = allProducts.filter(p => {
                // Search
                if (search) {
                    const name = (p.name || '').toLowerCase();
                    const generic = (p.genericName || '').toLowerCase();
                    const batch = (p.batchNumber || '').toLowerCase();
                    const cat = (p.category || '').toLowerCase();
                    const sku = (p.sku || '').toLowerCase();
                    if (!name.includes(search) && !generic.includes(search) && !batch.includes(search) && !cat.includes(search) && !sku.includes(search)) return false;
                }
                // Category
                if (catVal && p.category !== catVal) return false;
                // Drug type
                if (drugTypeVal && p.drugType !== drugTypeVal) return false;
                // Status
                if (statusVal) {
                    const status = this.getProductStatus(p);
                    if (status !== statusVal) return false;
                }
                return true;
            });

            // Sort
            filtered.sort((a, b) => {
                switch (sortVal) {
                    case 'name-asc': return (a.name || '').localeCompare(b.name || '');
                    case 'name-desc': return (b.name || '').localeCompare(a.name || '');
                    case 'qty-asc': return (a.quantity || 0) - (b.quantity || 0);
                    case 'qty-desc': return (b.quantity || 0) - (a.quantity || 0);
                    case 'price-asc': return (a.sellingPrice || 0) - (b.sellingPrice || 0);
                    case 'price-desc': return (b.sellingPrice || 0) - (a.sellingPrice || 0);
                    case 'expiry-asc':
                        const ea = a.expiryDate ? (a.expiryDate.toDate ? a.expiryDate.toDate() : new Date(a.expiryDate)) : new Date('9999-12-31');
                        const eb = b.expiryDate ? (b.expiryDate.toDate ? b.expiryDate.toDate() : new Date(b.expiryDate)) : new Date('9999-12-31');
                        return ea - eb;
                    default: return 0;
                }
            });

            this.renderTable(filtered);
        },

        renderTable: function (products) {
            filteredProducts = products;
            currentPage = 1;
            this.renderCurrentPage();
        },

        renderCurrentPage: function () {
            const tbody = document.getElementById('inv-table-body');
            const countEl = document.getElementById('inv-showing-count');
            if (!tbody) return;

            const totalFiltered = filteredProducts.length;
            const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
            if (currentPage > totalPages) currentPage = totalPages;

            const startIdx = (currentPage - 1) * pageSize;
            const endIdx = Math.min(startIdx + pageSize, totalFiltered);
            const pageProducts = filteredProducts.slice(startIdx, endIdx);

            if (totalFiltered === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="13" class="inv-empty-cell">
                            <div class="inv-empty">
                                <i class="fas fa-box-open"></i>
                                <p>No products found</p>
                                <span>Try adjusting your search or filters</span>
                            </div>
                        </td>
                    </tr>
                `;
                if (countEl) countEl.textContent = 'Showing 0 products';
                this.renderPagination(0, 0);
                return;
            }

            tbody.innerHTML = pageProducts.map(p => {
                const status = this.getProductStatus(p);
                const quarantine = quarantinedByProduct[p.id] || { total: 0, broken: 0, expired: 0, other: 0 };
                const statusLabel = {
                    'in-stock': 'In Stock',
                    'low-stock': 'Low Stock',
                    'out-of-stock': 'Out of Stock',
                    'expiring': 'Expiring Soon',
                    'expired': 'Expired'
                }[status];
                const statusClass = {
                    'in-stock': 'status--completed',
                    'low-stock': 'status--warning',
                    'out-of-stock': 'status--danger',
                    'expiring': 'status--pending',
                    'expired': 'status--danger'
                }[status];

                return `
                    <tr data-id="${p.id}">
                        <td><code class="inv-sku">${this.escapeHtml(p.sku || '—')}</code></td>
                        <td>
                            <div class="inv-product-name">
                                <strong>${this.escapeHtml(p.name || '')}</strong>
                                ${p.genericName ? '<small class="inv-product-generic">' + this.escapeHtml(p.genericName) + '</small>' : ''}
                                ${p.manufacturer ? '<small>' + this.escapeHtml(p.manufacturer) + '</small>' : ''}
                            </div>
                        </td>
                        <td>${this.escapeHtml(p.category || '—')}</td>
                        <td>${this.getDrugTypeBadge(p.drugType)}</td>
                        <td><code>${this.escapeHtml(this.getBatchLabel(p))}</code></td>
                        <td class="inv-clean-qty ${(p.quantity || 0) <= (p.reorderLevel || 10) ? 'inv-qty-warn' : ''}"><strong>${p.quantity || 0}</strong><small>sellable</small></td>
                        <td class="inv-quarantine-qty ${quarantine.total ? 'has-quarantine' : ''}">
                            <strong>${quarantine.total}</strong>
                            <small>${quarantine.broken ? quarantine.broken + ' broken' : ''}${quarantine.broken && quarantine.expired ? ' · ' : ''}${quarantine.expired ? quarantine.expired + ' expired' : ''}${!quarantine.broken && !quarantine.expired && quarantine.other ? quarantine.other + ' other' : (!quarantine.total ? 'none' : '')}</small>
                        </td>
                        <td>${this.formatCurrency(p.buyingPrice || 0)}</td>
                        <td>${this.formatCurrency(p.sellingPrice || 0)}</td>
                        <td>${this.getVatDisplay(p)}</td>
                        <td>${this.formatDate(p.expiryDate)}</td>
                        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                        <td>
                            <div class="inv-actions">
                                <button class="inv-action-btn inv-action-btn--batches" data-id="${p.id}" title="Track Batches">
                                    <i class="fas fa-layer-group"></i>
                                </button>
                                <button class="inv-action-btn inv-action-btn--stock" data-id="${p.id}" title="Add Stock">
                                    <i class="fas fa-boxes-packing"></i>
                                </button>
                                <button class="inv-action-btn inv-action-btn--edit" data-id="${p.id}" title="Edit">
                                    <i class="fas fa-pen-to-square"></i>
                                </button>
                                <button class="inv-action-btn inv-action-btn--delete" data-id="${p.id}" title="Delete">
                                    <i class="fas fa-trash-can"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            if (countEl) countEl.textContent = 'Showing ' + (startIdx + 1) + '-' + endIdx + ' of ' + totalFiltered + ' products' + (totalFiltered !== allProducts.length ? ' (filtered from ' + allProducts.length + ')' : '');

            // Bind action buttons
            tbody.querySelectorAll('.inv-action-btn--batches').forEach(btn => {
                btn.addEventListener('click', () => this.openBatchTrackerModal(btn.dataset.id));
            });
            tbody.querySelectorAll('.inv-action-btn--stock').forEach(btn => {
                btn.addEventListener('click', () => this.openStockModal(btn.dataset.id));
            });
            tbody.querySelectorAll('.inv-action-btn--edit').forEach(btn => {
                btn.addEventListener('click', () => this.openEditModal(btn.dataset.id));
            });
            tbody.querySelectorAll('.inv-action-btn--delete').forEach(btn => {
                btn.addEventListener('click', () => this.confirmDelete(btn.dataset.id));
            });

            this.renderPagination(totalFiltered, totalPages);
        },

        renderPagination: function (total, totalPages) {
            const container = document.getElementById('inv-pagination');
            if (!container) return;

            if (totalPages <= 1) {
                container.innerHTML = '';
                return;
            }

            let html = '';

            // Prev
            html += '<button class="inv-page-btn" data-page="prev" ' + (currentPage <= 1 ? 'disabled' : '') + '><i class="fas fa-chevron-left"></i></button>';

            // Page numbers — show max 7 buttons with ellipsis
            const maxVisible = 7;
            let pages = [];
            if (totalPages <= maxVisible) {
                for (let i = 1; i <= totalPages; i++) pages.push(i);
            } else {
                pages.push(1);
                let start = Math.max(2, currentPage - 2);
                let end = Math.min(totalPages - 1, currentPage + 2);
                if (currentPage <= 3) { start = 2; end = 5; }
                if (currentPage >= totalPages - 2) { start = totalPages - 4; end = totalPages - 1; }
                if (start > 2) pages.push('...');
                for (let i = start; i <= end; i++) pages.push(i);
                if (end < totalPages - 1) pages.push('...');
                pages.push(totalPages);
            }

            pages.forEach(p => {
                if (p === '...') {
                    html += '<span class="inv-page-ellipsis">...</span>';
                } else {
                    html += '<button class="inv-page-btn' + (p === currentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
                }
            });

            // Next
            html += '<button class="inv-page-btn" data-page="next" ' + (currentPage >= totalPages ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i></button>';

            container.innerHTML = html;

            // Bind
            container.querySelectorAll('.inv-page-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const val = btn.dataset.page;
                    if (val === 'prev') currentPage = Math.max(1, currentPage - 1);
                    else if (val === 'next') currentPage = Math.min(totalPages, currentPage + 1);
                    else currentPage = parseInt(val);
                    this.renderCurrentPage();
                });
            });
        },

        // ─── EXPORT ──────────────────────────────────────────

        getBatchTrackerRows: function (product) {
            const batches = this.getStockBatches(product)
                .map((batch, index) => ({
                    ...batch,
                    _index: index,
                    quantity: Math.max(0, parseInt(batch.quantity, 10) || 0),
                    buyingPrice: batch.buyingPrice != null ? parseFloat(batch.buyingPrice) || 0 : parseFloat(product.buyingPrice) || 0,
                    sellingPrice: batch.sellingPrice != null ? parseFloat(batch.sellingPrice) || 0 : parseFloat(product.sellingPrice) || 0,
                    minimumSellPrice: batch.minimumSellPrice != null ? parseFloat(batch.minimumSellPrice) || 0 : parseFloat(product.minimumSellPrice) || parseFloat(product.buyingPrice) || 0
                }))
                .filter(batch => batch.quantity > 0 || batch.expiryDate || batch.batchNumber);

            return batches.sort((a, b) => {
                const da = a.expiryDate ? (a.expiryDate.toDate ? a.expiryDate.toDate() : new Date(a.expiryDate)) : new Date('9999-12-31');
                const db = b.expiryDate ? (b.expiryDate.toDate ? b.expiryDate.toDate() : new Date(b.expiryDate)) : new Date('9999-12-31');
                return da - db;
            });
        },

        getBatchTrackerStats: function (product, batches) {
            const totalQty = batches.reduce((sum, batch) => sum + (parseInt(batch.quantity, 10) || 0), 0);
            const costValue = batches.reduce((sum, batch) => sum + ((parseFloat(batch.buyingPrice) || 0) * (parseInt(batch.quantity, 10) || 0)), 0);
            const retailValue = batches.reduce((sum, batch) => sum + ((parseFloat(batch.sellingPrice) || 0) * (parseInt(batch.quantity, 10) || 0)), 0);
            const productQty = Math.max(0, parseInt(product.quantity, 10) || 0);
            return {
                totalQty: totalQty,
                productQty: productQty,
                batchCount: batches.length,
                costValue: costValue,
                retailValue: retailValue,
                qtyDiff: totalQty - productQty
            };
        },

        renderBatchTrackerContent: function (product) {
            const batches = this.getBatchTrackerRows(product);
            const stats = this.getBatchTrackerStats(product, batches);
            const updated = product.updatedAt || product.createdAt || null;
            const diffClass = stats.qtyDiff === 0 ? 'inv-batch-tracker-ok' : 'inv-batch-tracker-warn';
            const diffText = stats.qtyDiff === 0 ? 'Matches product stock' : (stats.qtyDiff > 0 ? '+' : '') + stats.qtyDiff + ' vs product stock';

            const rows = batches.length ? batches.map((batch, index) => {
                const qty = parseInt(batch.quantity, 10) || 0;
                const costValue = qty * (parseFloat(batch.buyingPrice) || 0);
                const retailValue = qty * (parseFloat(batch.sellingPrice) || 0);
                const margin = retailValue ? ((retailValue - costValue) / retailValue * 100) : 0;
                const source = batch.source || (batch.legacy ? 'legacy' : 'manual');
                return `
                    <tr>
                        <td><strong>${this.escapeHtml(batch.batchNumber || ('Batch ' + (index + 1)))}</strong><small>${this.escapeHtml(source)}</small></td>
                        <td class="inv-batch-qty">${qty}</td>
                        <td>${this.formatCurrency(batch.buyingPrice || 0)}</td>
                        <td>${this.formatCurrency(batch.sellingPrice || 0)}</td>
                        <td>${this.formatCurrency(costValue)}</td>
                        <td>${this.formatCurrency(retailValue)}</td>
                        <td>${Number.isFinite(margin) ? margin.toFixed(1) + '%' : '—'}</td>
                        <td>${this.formatDate(batch.expiryDate)}</td>
                    </tr>
                `;
            }).join('') : `
                <tr>
                    <td colspan="8" class="inv-empty-cell">
                        <div class="inv-empty">
                            <i class="fas fa-layer-group"></i>
                            <p>No batch records found</p>
                            <span>Add stock to start tracking this product by batch.</span>
                        </div>
                    </td>
                </tr>
            `;

            return `
                <div class="inv-batch-tracker-product">
                    <div>
                        <strong>${this.escapeHtml(product.name || 'Unnamed product')}</strong>
                        ${product.genericName ? '<small>' + this.escapeHtml(product.genericName) + '</small>' : ''}
                        <span>SKU: ${this.escapeHtml(product.sku || '—')} · ${this.escapeHtml(product.category || 'Uncategorized')}</span>
                    </div>
                    <span class="${diffClass}">${this.escapeHtml(diffText)}</span>
                </div>
                <div class="inv-batch-tracker-stats">
                    <div><span>${stats.batchCount}</span><small>Batches</small></div>
                    <div><span>${stats.totalQty}</span><small>Batch Qty</small></div>
                    <div><span>${stats.productQty}</span><small>Product Qty</small></div>
                    <div><span>${this.formatCurrency(stats.costValue)}</span><small>Cost Value</small></div>
                    <div><span>${this.formatCurrency(stats.retailValue)}</span><small>Retail Value</small></div>
                </div>
                <div class="inv-batch-tracker-meta">
                    <span><i class="fas fa-signal"></i> Live quantities</span>
                    <span>Last update: ${this.escapeHtml(updated ? this.formatDateTime(updated) : '—')}</span>
                </div>
                <div class="inv-batch-tracker-table-wrap">
                    <table class="data-table inv-batch-tracker-table">
                        <thead>
                            <tr>
                                <th>Batch</th>
                                <th>Qty Left</th>
                                <th>Cost</th>
                                <th>Sell</th>
                                <th>Cost Value</th>
                                <th>Retail Value</th>
                                <th>Margin</th>
                                <th>Expiry</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;
        },

        openBatchTrackerModal: function (productId) {
            const product = allProducts.find(p => p.id === productId);
            if (!product) return;

            if (unsubBatchTracker) {
                try { unsubBatchTracker(); } catch (e) { /* ignore */ }
                unsubBatchTracker = null;
            }

            const existing = document.getElementById('inv-batch-tracker-modal');
            if (existing) existing.remove();

            const modal = document.createElement('div');
            modal.className = 'inv-modal-overlay';
            modal.id = 'inv-batch-tracker-modal';
            modal.innerHTML = `
                <div class="inv-modal inv-batch-tracker-modal">
                    <div class="inv-modal-header">
                        <h3><i class="fas fa-layer-group"></i> Batch Tracker</h3>
                        <button class="inv-modal-close" id="inv-batch-tracker-close">&times;</button>
                    </div>
                    <div class="inv-modal-body" id="inv-batch-tracker-body">
                        ${this.renderBatchTrackerContent(product)}
                    </div>
                    <div class="inv-modal-footer">
                        <button class="btn btn-outline" id="inv-batch-tracker-done">Close</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            const closeModal = () => {
                if (unsubBatchTracker) {
                    try { unsubBatchTracker(); } catch (e) { /* ignore */ }
                    unsubBatchTracker = null;
                }
                modal.classList.remove('show');
                setTimeout(() => modal.remove(), 200);
            };

            document.getElementById('inv-batch-tracker-close').addEventListener('click', closeModal);
            document.getElementById('inv-batch-tracker-done').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

            const businessId = this.getBusinessId();
            if (!businessId || !window.db) return;

            const body = document.getElementById('inv-batch-tracker-body');
            const ref = getBusinessCollection(businessId, 'inventory').doc(productId);
            unsubBatchTracker = ref.onSnapshot(snapshot => {
                if (!body) return;
                if (!snapshot.exists) {
                    body.innerHTML = '<div class="inv-empty-cell">This product no longer exists.</div>';
                    return;
                }
                const liveProduct = { id: snapshot.id, ...snapshot.data() };
                body.innerHTML = this.renderBatchTrackerContent(liveProduct);
            }, err => {
                console.error('Batch tracker listener error:', err);
                if (body) body.innerHTML = '<div class="inv-empty-cell" style="color:var(--danger)">Failed to load live batch data.</div>';
            });
        },

        showExportMenu: function (anchorBtn) {
            const existing = document.getElementById('inv-export-menu');
            if (existing) { existing.remove(); return; }

            const rect = anchorBtn.getBoundingClientRect();
            const menu = document.createElement('div');
            menu.className = 'inv-export-menu';
            menu.id = 'inv-export-menu';
            menu.innerHTML = `
                <button id="inv-export-excel"><i class="fas fa-file-excel"></i> Export as Excel</button>
                <button id="inv-export-pdf"><i class="fas fa-file-pdf"></i> Export as PDF</button>
            `;
            menu.style.top = (rect.bottom + 6) + 'px';
            menu.style.right = (window.innerWidth - rect.right) + 'px';
            document.body.appendChild(menu);
            setTimeout(() => menu.classList.add('show'), 10);

            document.getElementById('inv-export-excel').addEventListener('click', () => { this.exportExcel(); menu.remove(); });
            document.getElementById('inv-export-pdf').addEventListener('click', () => { this.exportPDF(); menu.remove(); });

            // Close on outside click
            const closeHandler = (e) => {
                if (!menu.contains(e.target) && e.target !== anchorBtn) {
                    menu.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            setTimeout(() => document.addEventListener('click', closeHandler), 0);
        },

        exportExcel: function () {
            const data = (filteredProducts.length ? filteredProducts : allProducts).map(p => ({
                'SKU': p.sku || '',
                'Brand / trade name': p.name || '',
                'Generic name': p.genericName || '',
                'Category': p.category || '',
                'Drug Type': p.drugType || '',
                'Batch Number': p.batchNumber || '',
                'Quantity': p.quantity || 0,
                'Buying Price': p.buyingPrice || 0,
                'Selling Price': p.sellingPrice || 0,
                'VAT': p.vatEnabled ? (p.vatType === 'amount' ? (p.vatValue || 0) : ((p.vatValue || 0) + '%')) : '',
                'Expiry Date': p.expiryDate ? (p.expiryDate.toDate ? p.expiryDate.toDate() : new Date(p.expiryDate)).toISOString().split('T')[0] : '',
                'Manufacturer': p.manufacturer || '',
                'Supplier': p.supplier || '',
                'Unit': p.unit || '',
                'Reorder Level': p.reorderLevel || 0,
                'Status': this.getProductStatus(p).replace(/-/g, ' ')
            }));

            if (typeof XLSX === 'undefined') {
                this.showToast('Excel library loading... try again in a moment.', 'error');
                return;
            }

            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Inventory');

            // Auto-size columns
            const colWidths = Object.keys(data[0] || {}).map(key => ({
                wch: Math.max(key.length, ...data.map(r => String(r[key] || '').length).slice(0, 100)) + 2
            }));
            ws['!cols'] = colWidths;

            XLSX.writeFile(wb, (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow').replace(/\s+/g, '') + '_Inventory_' + new Date().toISOString().split('T')[0] + '.xlsx');
            this.showToast('Excel file exported successfully!');
        },

        exportPDF: function () {
            if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
                this.showToast('PDF library loading... try again in a moment.', 'error');
                return;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

            doc.setFontSize(16);
            doc.text((PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + ' — Inventory Report', 14, 15);
            doc.setFontSize(8);
            doc.text('Generated: ' + new Date().toLocaleString('en-KE'), 14, 21);
            doc.text('Total Products: ' + allProducts.length, 14, 25);

            const products = filteredProducts.length ? filteredProducts : allProducts;
            const headers = ['SKU', 'Brand', 'Generic', 'Category', 'Type', 'Batch', 'Qty', 'Buy Price', 'Sell Price', 'VAT', 'Expiry', 'Status'];
            const rows = products.map(p => [
                p.sku || '',
                p.name || '',
                p.genericName || '',
                p.category || '',
                p.drugType || '',
                p.batchNumber || '',
                String(p.quantity || 0),
                this.formatCurrency(p.buyingPrice || 0),
                this.formatCurrency(p.sellingPrice || 0),
                this.getVatDisplay(p),
                p.expiryDate ? (p.expiryDate.toDate ? p.expiryDate.toDate() : new Date(p.expiryDate)).toISOString().split('T')[0] : '',
                this.getProductStatus(p).replace(/-/g, ' ')
            ]);

            doc.autoTable({
                head: [headers],
                body: rows,
                startY: 30,
                styles: { fontSize: 7, cellPadding: 2 },
                headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [245, 247, 250] },
                margin: { left: 10, right: 10 }
            });

            doc.save((PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow').replace(/\s+/g, '') + '_Inventory_' + new Date().toISOString().split('T')[0] + '.pdf');
            this.showToast('PDF file exported successfully!');
        },

        // ─── BULK IMPORT ─────────────────────────────────────

        /** Normalize a single CSV / Excel header (BOM, spaces, case). */
        normalizeImportHeaderCell: function (h) {
            let s = String(h == null ? '' : h).trim();
            if (s.charCodeAt(0) === 0xfeff) {
                s = s.slice(1).trim();
            }
            return s.toLowerCase().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        },

        /**
         * Parse expiry from CSV/Excel: ISO dates, locale strings, Excel serial numbers.
         */
        parseImportExpiry: function (raw) {
            if (raw == null || raw === '') return null;
            if (typeof raw === 'number' && !isNaN(raw)) {
                if (raw > 20000 && raw < 100000) {
                    const utcMs = Math.round((raw - 25569) * 86400 * 1000);
                    const d = new Date(utcMs);
                    if (!isNaN(d.getTime())) return firebase.firestore.Timestamp.fromDate(d);
                }
            }
            const s = String(raw).trim();
            if (!s) return null;
            if (/^\d+(\.\d+)?$/.test(s)) {
                const n = parseFloat(s);
                if (n > 20000 && n < 100000) {
                    const utcMs = Math.round((n - 25569) * 86400 * 1000);
                    const d = new Date(utcMs);
                    if (!isNaN(d.getTime())) return firebase.firestore.Timestamp.fromDate(d);
                }
            }
            let d = new Date(s);
            if (!isNaN(d.getTime())) return firebase.firestore.Timestamp.fromDate(d);
            const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
            if (m) {
                const a = parseInt(m[1], 10);
                const b = parseInt(m[2], 10);
                let y = parseInt(m[3], 10);
                if (y < 100) y += y >= 50 ? 1900 : 2000;
                const tryOrder = [{ day: a, month: b - 1 }, { day: b, month: a - 1 }];
                for (let i = 0; i < tryOrder.length; i++) {
                    const dt = new Date(y, tryOrder[i].month, tryOrder[i].day);
                    if (!isNaN(dt.getTime()) && dt.getFullYear() === y) {
                        return firebase.firestore.Timestamp.fromDate(dt);
                    }
                }
            }
            return null;
        },

        /** Default expiry when column missing (2 years). */
        _defaultImportExpiry: function () {
            return firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 730 * 24 * 60 * 60 * 1000));
        },

        getImportTemplateHeaders: function () {
            return ['Name', 'Generic Name', 'Category', 'Drug Type', 'Batch Number', 'Quantity', 'Buying Price', 'Selling Price', 'Expiry Date', 'Manufacturer', 'Supplier', 'Unit', 'Reorder Level', 'Dosage'];
        },

        getImportSampleRows: function () {
            return [
                ['Panadol 500mg', 'Paracetamol', 'Analgesics & Antipyretics', 'OTC', 'BTN-2026-001', '500', '3.50', '8.00', '2027-06-15', 'GSK', 'MedSupply Ltd', 'Tablets', '50', '500mg'],
                ['Amoxicillin caps 250mg', 'Amoxicillin', 'Antibiotics', 'POM', 'BTN-2026-002', '200', '12.00', '25.00', '2027-03-20', 'Cipla', 'PharmaDist', 'Capsules', '30', '250mg'],
                ['Claritin 10mg', 'Loratadine', 'Antihistamines & Allergy', 'OTC', 'BTN-2026-003', '150', '5.00', '15.00', '2028-01-10', 'Bayer', 'HealthCorp', 'Tablets', '20', '10mg']
            ];
        },

        downloadTemplateCSV: function () {
            const headers = this.getImportTemplateHeaders();
            const samples = this.getImportSampleRows();
            const csvContent = [headers.join(',')].concat(samples.map(r => r.map(c => '"' + c.replace(/"/g, '""') + '"').join(','))).join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow').replace(/\s+/g, '') + '_Import_Template.csv';
            a.click();
            URL.revokeObjectURL(url);
            this.showToast('CSV template downloaded!');
        },

        downloadTemplateExcel: function () {
            if (typeof XLSX === 'undefined') {
                this.showToast('Excel library loading... try again.', 'error');
                return;
            }
            const headers = this.getImportTemplateHeaders();
            const samples = this.getImportSampleRows();
            const data = [headers].concat(samples);
            const ws = XLSX.utils.aoa_to_sheet(data);
            ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 16) }));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Import Template');
            XLSX.writeFile(wb, (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow').replace(/\s+/g, '') + '_Import_Template.xlsx');
            this.showToast('Excel template downloaded!');
        },

        openImportModal: function (businessId) {
            const existing = document.getElementById('inv-import-modal');
            if (existing) existing.remove();

            const modal = document.createElement('div');
            modal.className = 'inv-modal-overlay';
            modal.id = 'inv-import-modal';
            modal.innerHTML = `
                <div class="inv-modal inv-import-modal-content">
                    <div class="inv-modal-header">
                        <h3><i class="fas fa-file-import"></i> Bulk Import Inventory</h3>
                        <button class="inv-modal-close" id="inv-import-close">&times;</button>
                    </div>
                    <div class="inv-modal-body">
                        <!-- Step 1: Download Template -->
                        <div class="inv-import-section">
                            <div class="inv-import-section-title"><span class="inv-import-step">1</span> Download Template</div>
                            <p class="inv-import-hint">Download a pre-formatted template, fill in your products, then upload it below.</p>
                            <div class="inv-import-template-btns">
                                <button class="btn btn-sm btn-outline" id="inv-dl-csv"><i class="fas fa-file-csv"></i> Download CSV Template</button>
                                <button class="btn btn-sm btn-outline" id="inv-dl-excel"><i class="fas fa-file-excel"></i> Download Excel Template</button>
                            </div>
                        </div>

                        <!-- Step 2: Upload File -->
                        <div class="inv-import-section">
                            <div class="inv-import-section-title"><span class="inv-import-step">2</span> Upload Your File</div>
                        <p class="inv-import-hint">Supports <strong>.csv</strong> and <strong>.xlsx / .xls</strong> (Excel). Attach one file (max 50MB). UTF-8 CSV supported.</p>
                            <div class="inv-import-dropzone" id="inv-import-dropzone">
                                <input type="file" id="inv-import-file-input" accept=".csv,.xlsx,.xls" style="display:none">
                                <div class="inv-dropzone-inner" id="inv-dropzone-inner">
                                    <i class="fas fa-cloud-arrow-up"></i>
                                    <p>Drag & drop your file here</p>
                                    <span>or <a href="#" id="inv-browse-link">browse files</a></span>
                                    <small>CSV, XLSX, XLS &bull; Max 50MB</small>
                                </div>
                            </div>
                        </div>

                        <!-- Step 3: Preview (hidden until file loaded) -->
                        <div class="inv-import-section inv-import-preview-section" id="inv-import-preview-section" style="display:none">
                            <div class="inv-import-section-title"><span class="inv-import-step">3</span> Preview &amp; Import</div>
                            <div class="inv-import-file-info" id="inv-import-file-info"></div>
                            <div id="inv-import-warnings" class="inv-import-warnings" style="display:none" aria-live="polite"></div>
                            <div class="inv-import-preview" id="inv-import-preview-table"></div>
                            <div class="inv-import-progress" id="inv-import-progress" style="display:none">
                                <div class="inv-progress-bar"><div class="inv-progress-fill" id="inv-progress-fill"></div></div>
                                <span class="inv-progress-text" id="inv-progress-text">Importing...</span>
                            </div>
                        </div>
                    </div>
                    <div class="inv-modal-footer">
                        <button class="btn btn-outline" id="inv-import-cancel">Cancel</button>
                        <button class="btn btn-primary" id="inv-import-confirm" disabled>
                            <i class="fas fa-upload"></i> Import Products
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            const self = this;
            let parsedProducts = [];

            // Close handlers
            const closeModal = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            document.getElementById('inv-import-close').addEventListener('click', closeModal);
            document.getElementById('inv-import-cancel').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

            // Template download buttons
            document.getElementById('inv-dl-csv').addEventListener('click', () => self.downloadTemplateCSV());
            document.getElementById('inv-dl-excel').addEventListener('click', () => self.downloadTemplateExcel());

            // File input
            const fileInput = document.getElementById('inv-import-file-input');
            const browseLink = document.getElementById('inv-browse-link');
            browseLink.addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });

            fileInput.addEventListener('change', (e) => {
                const f = e.target.files && e.target.files[0];
                if (f) {
                    if (e.target.files.length > 1) {
                        self.showToast('Multiple files selected — importing the first file only.', 'success');
                    }
                    self.processImportFile(f, businessId, (products) => {
                        parsedProducts = products;
                    });
                }
            });

            // Drag and drop
            const dropzone = document.getElementById('inv-import-dropzone');
            dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
            dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('dragover'); });
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                const files = e.dataTransfer && e.dataTransfer.files;
                if (!files || !files.length) return;
                if (files.length > 1) {
                    self.showToast('Multiple files dropped — importing the first file only.', 'success');
                }
                const file = files[0];
                const lower = file.name.toLowerCase();
                if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
                    self.showToast('Please drop a CSV or Excel file (.csv, .xlsx, .xls).', 'error');
                    return;
                }
                self.processImportFile(file, businessId, (products) => {
                    parsedProducts = products;
                });
            });

            // Import button
            document.getElementById('inv-import-confirm').addEventListener('click', async () => {
                if (parsedProducts.length === 0) return;
                const btn = document.getElementById('inv-import-confirm');
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
                await self.executeBulkImport(parsedProducts, businessId, closeModal);
            });
        },

        processImportFile: function (file, businessId, onParsed) {
            const name = file.name.toLowerCase();
            const maxSize = 50 * 1024 * 1024;
            if (file.size > maxSize) {
                this.showToast('File too large. Maximum 50MB.', 'error');
                return;
            }
            if (!name.endsWith('.csv') && !name.endsWith('.xlsx') && !name.endsWith('.xls')) {
                this.showToast('Unsupported format. Use .csv, .xlsx, or .xls', 'error');
                return;
            }

            const fmtSize = file.size >= 1048576
                ? (file.size / 1048576).toFixed(1) + ' MB'
                : (file.size / 1024).toFixed(1) + ' KB';

            const inner = document.getElementById('inv-dropzone-inner');
            const ext = name.split('.').pop();
            const icon = ext === 'csv' ? 'fa-file-csv' : 'fa-file-excel';
            if (inner) {
                inner.innerHTML =
                    '<div class="inv-import-attachment-card">' +
                    '<i class="fas fa-paperclip inv-import-attach-icon"></i>' +
                    '<div class="inv-import-attach-meta">' +
                    '<strong class="inv-import-attach-name">' + this.escapeHtml(file.name) + '</strong>' +
                    '<small class="inv-import-attach-size">' + this.escapeHtml(fmtSize) + ' · ' + String(ext || '').toUpperCase() + '</small>' +
                    '</div></div>' +
                    '<p class="inv-import-attach-hint"><a href="#" id="inv-browse-link-again">Choose a different file</a></p>';

                const again = document.getElementById('inv-browse-link-again');
                const fileInput = document.getElementById('inv-import-file-input');
                if (again && fileInput) {
                    again.addEventListener('click', (ev) => { ev.preventDefault(); fileInput.click(); });
                }
            }

            if (name.endsWith('.csv')) {
                const reader = new FileReader();
                reader.onerror = () => {
                    this.showToast('Could not read the file. Try saving CSV as UTF-8 and upload again.', 'error');
                };
                reader.onload = (e) => {
                    const parsed = this.parseCsvToProducts(e.target.result);
                    if (parsed) {
                        this.showImportPreview(parsed.products, parsed.stats);
                        onParsed(parsed.products);
                    }
                };
                reader.readAsText(file);
            } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
                if (typeof XLSX === 'undefined') {
                    this.showToast('Excel library loading... try again in a moment.', 'error');
                    return;
                }
                const reader = new FileReader();
                reader.onerror = () => {
                    this.showToast('Could not read the Excel file.', 'error');
                };
                reader.onload = (e) => {
                    try {
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                        if (!firstSheet) {
                            this.showToast('The workbook has no data on the first sheet.', 'error');
                            return;
                        }
                        const csvText = XLSX.utils.sheet_to_csv(firstSheet, { FS: ',', RS: '\n' });
                        const parsed = this.parseCsvToProducts(csvText);
                        if (parsed) {
                            this.showImportPreview(parsed.products, parsed.stats);
                            onParsed(parsed.products);
                        }
                    } catch (err) {
                        console.error('Excel import parse error:', err);
                        this.showToast('Could not parse this Excel file. Check the first sheet has headers and data.', 'error');
                    }
                };
                reader.readAsArrayBuffer(file);
            } else {
                this.showToast('Unsupported file format.', 'error');
            }
        },

        parseCsvToProducts: function (csvText) {
            const lines = csvText.split(/\r?\n/).filter(l => String(l).trim());
            if (lines.length < 2) {
                this.showToast('File is empty or has no data rows.', 'error');
                return null;
            }

            const headers = this.parseCsvRow(lines[0]).map(h => this.normalizeImportHeaderCell(h));

            const colMap = {
                name: this.findHeaderIdx(headers, ['name', 'product name', 'brand name', 'trade name', 'product']),
                genericName: this.findHeaderIdx(headers, ['generic name', 'genericname', 'generic', 'inn']),
                category: this.findHeaderIdx(headers, ['category', 'product category']),
                drugType: this.findHeaderIdx(headers, ['drug type', 'drugtype', 'type', 'classification', 'drug classification']),
                batchNumber: this.findHeaderIdx(headers, ['batch number', 'batchnumber', 'batch no', 'batch']),
                quantity: this.findHeaderIdx(headers, ['quantity', 'qty', 'stock']),
                buyingPrice: this.findHeaderIdx(headers, ['buying price', 'buyingprice', 'cost price', 'cost', 'buy price']),
                sellingPrice: this.findHeaderIdx(headers, ['selling price', 'sellingprice', 'sell price', 'sale price', 'price']),
                expiryDate: this.findHeaderIdx(headers, ['expiry date', 'expirydate', 'expiry', 'exp date', 'expiration']),
                manufacturer: this.findHeaderIdx(headers, ['manufacturer', 'mfg']),
                supplier: this.findHeaderIdx(headers, ['supplier']),
                unit: this.findHeaderIdx(headers, ['unit', 'unit of measure', 'uom']),
                reorderLevel: this.findHeaderIdx(headers, ['reorder level', 'reorderlevel', 'reorder']),
                dosage: this.findHeaderIdx(headers, ['dosage', 'strength']),
                sku: this.findHeaderIdx(headers, ['sku', 'barcode'])
            };

            if (colMap.name < 0) {
                this.showToast('File must have a Name or Product Name column.', 'error');
                return null;
            }

            if (colMap.sellingPrice < 0) {
                this.showToast('File must include a selling price column (Selling Price or Price).', 'error');
                return null;
            }

            const products = [];
            let defaultedDrugType = 0;
            let defaultedExpiry = 0;

            for (let i = 1; i < lines.length; i++) {
                const cols = this.parseCsvRow(lines[i]);
                const name = (cols[colMap.name] || '').trim();
                if (!name) continue;

                const expiryRaw = colMap.expiryDate >= 0 ? cols[colMap.expiryDate] : '';
                let expiryTs = this.parseImportExpiry(expiryRaw);
                if (!expiryTs) {
                    expiryTs = this._defaultImportExpiry();
                    defaultedExpiry++;
                }

                const rawDrug = colMap.drugType >= 0 ? String(cols[colMap.drugType] || '').trim().toUpperCase() : '';
                const validTypes = ['OTC', 'POM', 'PO', 'DDA'];
                let drugType = validTypes.includes(rawDrug) ? rawDrug : '';
                if (!drugType) {
                    drugType = 'OTC';
                    defaultedDrugType++;
                }

                const qRaw = colMap.quantity >= 0 ? cols[colMap.quantity] : '';
                const qtyParsed = parseFloat(String(qRaw != null ? qRaw : '').replace(/,/g, ''));
                const quantity = Math.max(0, Math.floor(isFinite(qtyParsed) ? qtyParsed : 0));

                const sku = colMap.sku >= 0 && String(cols[colMap.sku] || '').trim()
                    ? String(cols[colMap.sku]).trim()
                    : this.generateSKU();

                const batchNumber = colMap.batchNumber >= 0 ? String(cols[colMap.batchNumber] || '').trim() : '';

                const buyingPrice = colMap.buyingPrice >= 0 ? (parseFloat(String(cols[colMap.buyingPrice] || '').replace(/,/g, '')) || 0) : 0;
                const sellingPrice = parseFloat(String(cols[colMap.sellingPrice] || '').replace(/,/g, '')) || 0;

                products.push({
                    name: name,
                    genericName: colMap.genericName >= 0 ? String(cols[colMap.genericName] || '').trim() : '',
                    category: colMap.category >= 0 ? String(cols[colMap.category] || '').trim() : '',
                    drugType: drugType,
                    batchNumber: batchNumber,
                    quantity: quantity,
                    buyingPrice: buyingPrice,
                    sellingPrice: sellingPrice,
                    expiryDate: expiryTs,
                    stockBatches: [{
                        batchNumber: batchNumber || sku,
                        quantity: quantity,
                        expiryDate: expiryTs,
                        buyingPrice: buyingPrice,
                        sellingPrice: sellingPrice,
                        minimumSellPrice: buyingPrice,
                        addedAt: new Date().toISOString(),
                        source: 'import'
                    }],
                    manufacturer: colMap.manufacturer >= 0 ? String(cols[colMap.manufacturer] || '').trim() : '',
                    dosage: colMap.dosage >= 0 ? String(cols[colMap.dosage] || '').trim() : '',
                    description: '',
                    supplier: colMap.supplier >= 0 ? String(cols[colMap.supplier] || '').trim() : '',
                    invoiceNumber: '',
                    unit: colMap.unit >= 0 ? String(cols[colMap.unit] || 'Tablets').trim() : 'Tablets',
                    reorderLevel: colMap.reorderLevel >= 0 ? (parseInt(String(cols[colMap.reorderLevel]), 10) || 10) : 10,
                    sku: sku,
                    vatEnabled: false,
                    vatType: 'percent',
                    vatValue: 0,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    createdBy: PharmaFlow.Auth?.currentUser?.uid || ''
                });
            }

            if (products.length === 0) {
                this.showToast('No valid products found in file.', 'error');
                return null;
            }

            return {
                products: products,
                stats: {
                    defaultedDrugType: defaultedDrugType,
                    defaultedExpiry: defaultedExpiry
                }
            };
        },

        parseCsvRow: function (line) {
            const result = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (inQuotes) {
                    if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
                    else if (ch === '"') { inQuotes = false; }
                    else { current += ch; }
                } else {
                    if (ch === '"') { inQuotes = true; }
                    else if (ch === ',') { result.push(current); current = ''; }
                    else { current += ch; }
                }
            }
            result.push(current);
            return result;
        },

        findHeaderIdx: function (headers, names) {
            for (const n of names) {
                const idx = headers.indexOf(n);
                if (idx >= 0) return idx;
            }
            return -1;
        },

        showImportPreview: function (products, stats) {
            const section = document.getElementById('inv-import-preview-section');
            const previewEl = document.getElementById('inv-import-preview-table');
            const fileInfo = document.getElementById('inv-import-file-info');
            const warnEl = document.getElementById('inv-import-warnings');
            const confirmBtn = document.getElementById('inv-import-confirm');

            if (!section || !previewEl) return;

            section.style.display = 'block';
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fas fa-upload"></i> Import ' + products.length + ' Products';

            fileInfo.innerHTML = '<i class="fas fa-check-circle" style="color:var(--success)"></i> <strong>' + products.length + '</strong> products ready to import';

            if (warnEl) {
                const defExp = stats && stats.defaultedExpiry > 0 ? stats.defaultedExpiry : 0;
                const defDrug = stats && stats.defaultedDrugType > 0 ? stats.defaultedDrugType : 0;
                if (defExp > 0 || defDrug > 0) {
                    warnEl.style.display = 'block';
                    const parts = [];
                    if (defDrug > 0) {
                        parts.push('Drug type was missing or invalid for <strong>' + defDrug + '</strong> row(s); set to <code>OTC</code>.');
                    }
                    if (defExp > 0) {
                        parts.push('Expiry was missing or invalid for <strong>' + defExp + '</strong> row(s); defaulted to ~2 years from import date.');
                    }
                    warnEl.innerHTML = '<strong>Defaults applied</strong><ul>' + parts.map(p => '<li>' + p + '</li>').join('') + '</ul>';
                } else {
                    warnEl.style.display = 'none';
                    warnEl.innerHTML = '';
                }
            }

            const showCount = Math.min(products.length, 10);
            previewEl.innerHTML = '<table class="inv-preview-table"><thead><tr><th>#</th><th>Name</th><th>Generic</th><th>Category</th><th>Drug Type</th><th>Qty</th><th>Buy Price</th><th>Sell Price</th></tr></thead><tbody>' +
                products.slice(0, showCount).map((p, i) => {
                    return '<tr><td>' + (i + 1) + '</td><td>' + this.escapeHtml(p.name) + '</td><td>' + this.escapeHtml(p.genericName || '—') + '</td><td>' + this.escapeHtml(p.category) + '</td><td>' + (p.drugType || '-') + '</td><td>' + p.quantity + '</td><td>' + this.formatCurrency(p.buyingPrice) + '</td><td>' + this.formatCurrency(p.sellingPrice) + '</td></tr>';
                }).join('') +
                (products.length > showCount ? '<tr><td colspan="8" style="text-align:center;color:var(--text-tertiary);font-style:italic">... and ' + (products.length - showCount) + ' more products</td></tr>' : '') +
                '</tbody></table>';

            // Scroll preview into view
            section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        },

        executeBulkImport: async function (products, businessId, closeModal) {
            const colRef = getBusinessCollection(businessId, 'inventory');
            if (!colRef) { this.showToast('Database error.', 'error'); closeModal(); return; }

            const progressEl = document.getElementById('inv-import-progress');
            const fillEl = document.getElementById('inv-progress-fill');
            const textEl = document.getElementById('inv-progress-text');
            if (progressEl) progressEl.style.display = 'block';

            let imported = 0;
            let failed = 0;
            const BATCH_SIZE = 400;
            const total = products.length;

            for (let i = 0; i < total; i += BATCH_SIZE) {
                const chunk = products.slice(i, i + BATCH_SIZE);
                const batch = window.db.batch();
                chunk.forEach(p => {
                    const ref = colRef.doc();
                    p._importProductId = ref.id;
                    const productData = Object.assign({}, p);
                    delete productData._importProductId;
                    batch.set(ref, productData);
                });
                try {
                    await batch.commit();
                    try {
                        const stockBatch = window.db.batch();
                        chunk.forEach(p => {
                            const historyRef = getBusinessCollection(businessId, 'stock_history').doc();
                            stockBatch.set(historyRef, {
                                productId: p._importProductId,
                                productName: p.name || '',
                                sku: p.sku || '',
                                category: p.category || '',
                                type: 'bulk_import',
                                previousQty: 0,
                                addedQty: p.quantity || 0,
                                newQty: p.quantity || 0,
                                unitCost: p.buyingPrice || 0,
                                batchNumber: p.batchNumber || '',
                                expiryDate: p.expiryDate || null,
                                addedBy: PharmaFlow.Auth?.userProfile?.displayName || PharmaFlow.Auth?.userProfile?.email || 'Unknown',
                                createdAt: new Date().toISOString()
                            });
                            delete p._importProductId;
                        });
                        await stockBatch.commit();
                    } catch (historyErr) {
                        console.warn('Inventory import succeeded but stock history logging failed:', historyErr);
                    }
                    imported += chunk.length;
                } catch (err) {
                    console.error('Batch import error at chunk ' + Math.floor(i / BATCH_SIZE) + ':', err);
                    failed += chunk.length;
                }

                // Update progress bar
                const pct = Math.round(((imported + failed) / total) * 100);
                if (fillEl) fillEl.style.width = pct + '%';
                if (textEl) textEl.textContent = 'Imported ' + imported + ' of ' + total + ' products...' + (failed > 0 ? ' (' + failed + ' failed)' : '');
            }

            // Brief pause to show 100%
            if (fillEl) fillEl.style.width = '100%';
            if (textEl) textEl.textContent = failed > 0 ? ('Done! ' + imported + ' imported, ' + failed + ' failed.') : ('Done! ' + imported + ' products imported successfully.');

            setTimeout(() => {
                closeModal();
                if (failed > 0) {
                    this.showToast('Imported ' + imported + ' products. ' + failed + ' failed.', 'error');
                } else {
                    this.showToast('Successfully imported ' + imported + ' products!');
                    if (PharmaFlow.ActivityLog) {
                        PharmaFlow.ActivityLog.log({
                            title: 'Bulk inventory import',
                            description: 'Imported ' + imported + ' product(s) from file.',
                            category: 'Inventory',
                            status: 'COMPLETED',
                            metadata: { count: imported, businessId: businessId }
                        });
                    }
                }
            }, 800);
        },

        escapeHtml: function (str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },

        // ─── ADD INVENTORY ───────────────────────────────────

        renderAdd: function (container) {
            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="inv-module">
                    <div class="page-header">
                        <div>
                            <h2>Add Product</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Inventory</span><span>/</span>
                                <span>Add Product</span>
                            </div>
                        </div>
                    </div>

                    <div class="inv-form-card">
                        <form id="inv-add-form" autocomplete="off">
                            <div class="inv-form-grid">
                                <!-- Product Info -->
                                <div class="inv-form-section">
                                    <h4><i class="fas fa-info-circle"></i> Product Information</h4>
                                    <div class="inv-form-row">
                                        <div class="inv-form-group">
                                            <label for="inv-name">Brand / trade name <span class="req">*</span></label>
                                            <input type="text" id="inv-name" required placeholder="e.g. Panadol 500mg">
                                        </div>
                                        <div class="inv-form-group">
                                            <label for="inv-category">Category <span class="req">*</span></label>
                                            <select id="inv-category" required>
                                                <option value="">Select Category</option>
                                                ${this.DRUG_CATEGORIES.map(c => '<option value="' + c + '">' + c + '</option>').join('')}
                                            </select>
                                        </div>
                                    </div>
                                    <div class="inv-form-row">
                                        <div class="inv-form-group full-width">
                                            <label for="inv-generic-name">Generic name</label>
                                            <input type="text" id="inv-generic-name" placeholder="e.g. Paracetamol (optional)">
                                        </div>
                                    </div>
                                    <div class="inv-form-row">
                                        <div class="inv-form-group">
                                            <label for="inv-manufacturer">Manufacturer</label>
                                            <input type="text" id="inv-manufacturer" placeholder="e.g. GSK">
                                        </div>
                                        <div class="inv-form-group">
                                            <label for="inv-dosage">Dosage / Strength</label>
                                            <input type="text" id="inv-dosage" placeholder="e.g. 500mg">
                                        </div>
                                    </div>
                                    <div class="inv-form-row">
                                        <div class="inv-form-group">
                                            <label for="inv-drug-type">Drug Classification <span class="req">*</span></label>
                                            <select id="inv-drug-type" required>
                                                <option value="" disabled selected>Select classification...</option>
                                                <option value="OTC">OTC — Over The Counter</option>
                                                <option value="POM">POM — Prescription Only Medicine</option>
                                                <option value="PO">PO — Pharmacy Only</option>
                                                <option value="DDA">DDA — Dangerous Drug Act</option>
                                            </select>
                                        </div>
                                        <div class="inv-form-group">
                                            <label for="inv-sku">SKU / Barcode</label>
                                            <div class="inv-sku-row">
                                                <input type="text" id="inv-sku" placeholder="Auto-generated" readonly>
                                                <button type="button" class="btn btn-sm btn-outline" id="inv-generate-sku" title="Generate new SKU">
                                                    <i class="fas fa-barcode"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="inv-form-row">
                                        <div class="inv-form-group full-width">
                                            <label for="inv-description">Description</label>
                                            <textarea id="inv-description" rows="2" placeholder="Brief product description (optional)"></textarea>
                                        </div>
                                    </div>
                                </div>

                                <!-- Stock Info -->
                                <div class="inv-form-section">
                                    <h4><i class="fas fa-cubes"></i> Stock Details</h4>
                                    <div class="inv-form-row">
                                        <div class="inv-form-group">
                                            <label for="inv-batch-mode">Batch Number</label>
                                            <select id="inv-batch-mode">
                                                <option value="manual" selected>Manual entry</option>
                                                <option value="auto">Auto-generate</option>
                                            </select>
                                            <div class="inv-sku-row inv-batch-row">
                                                <input type="text" id="inv-batch" placeholder="Enter batch number manually">
                                                <button type="button" class="btn btn-sm btn-outline" id="inv-generate-batch" title="Generate batch number">
                                                    <i class="fas fa-dice"></i>
                                                </button>
                                            </div>
                                        </div>
                                        <div class="inv-form-group">
                                            <label for="inv-quantity">Quantity <span class="req">*</span></label>
                                            <input type="number" id="inv-quantity" required min="0" placeholder="e.g. 100">
                                        </div>
                                    </div>
                                    <div class="inv-form-row">
                                        <div class="inv-form-group">
                                            <label for="inv-reorder">Reorder Level</label>
                                            <input type="number" id="inv-reorder" min="0" value="10" placeholder="e.g. 10">
                                        </div>
                                        <div class="inv-form-group">
                                            <label for="inv-unit">Unit of Measure</label>
                                            <select id="inv-unit">
                                                <option value="Tablets">Tablets</option>
                                                <option value="Capsules">Capsules</option>
                                                <option value="Bottles">Bottles</option>
                                                <option value="Vials">Vials</option>
                                                <option value="Strips">Strips</option>
                                                <option value="Packs">Packs</option>
                                                <option value="Tubes">Tubes</option>
                                                <option value="Sachets">Sachets</option>
                                                <option value="Ampoules">Ampoules</option>
                                                <option value="Pieces">Pieces</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <!-- Pricing -->
                                <div class="inv-form-section">
                                    <h4><i class="fas fa-tags"></i> Pricing</h4>
                                    <div class="inv-form-row">
                                        <div class="inv-form-group">
                                            <label for="inv-buying-price">Buying Price (KSH) <span class="req">*</span></label>
                                            <input type="number" id="inv-buying-price" required min="0" step="0.01" placeholder="e.g. 50.00">
                                        </div>
                                        <div class="inv-form-group">
                                            <label for="inv-selling-price">Selling Price (KSH) <span class="req">*</span></label>
                                            <input type="number" id="inv-selling-price" required min="0" step="0.01" placeholder="e.g. 80.00">
                                        </div>
                                    </div>
                                    <div class="inv-form-row">
                                        <div class="inv-form-group full-width">
                                            <label for="inv-min-sell-price">Minimum sell price — discount floor (KSH)</label>
                                            <input type="number" id="inv-min-sell-price" min="0" step="0.01" placeholder="Leave blank to use buying price">
                                            <small>Optional. POS blocks discounts that net below this per unit (cart discount is split by line). Blank = buying price.</small>
                                        </div>
                                    </div>
                                    <div class="inv-form-row">
                                        <div class="inv-form-group">
                                            <label for="inv-vat-enabled">VAT Applies</label>
                                            <select id="inv-vat-enabled">
                                                <option value="false" selected>No VAT</option>
                                                <option value="true">VAT Applicable</option>
                                            </select>
                                        </div>
                                        <div class="inv-form-group">
                                            <label for="inv-vat-value">VAT Value</label>
                                            <div class="inv-form-row inv-input-combo">
                                                <input type="number" id="inv-vat-value" min="0" step="0.01" value="0" placeholder="e.g. 16">
                                                <select id="inv-vat-type">
                                                    <option value="percent" selected>%</option>
                                                    <option value="amount">KSH</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="inv-form-row" id="inv-row-total-with-vat" style="display:none;">
                                        <div class="inv-form-group full-width">
                                            <label>Total with VAT (per unit)</label>
                                            <div class="inv-margin-display inv-total-with-vat" id="inv-total-with-vat">—</div>
                                        </div>
                                    </div>
                                    <div class="inv-form-row">
                                        <div class="inv-form-group">
                                            <label>Profit Margin</label>
                                            <div class="inv-margin-display" id="inv-margin">—</div>
                                        </div>
                                        <div class="inv-form-group">
                                            <label for="inv-expiry">Expiry Date <span class="req">*</span></label>
                                            <input type="date" id="inv-expiry" required>
                                        </div>
                                    </div>
                                </div>

                                <!-- Supplier -->
                                <div class="inv-form-section">
                                    <h4><i class="fas fa-truck"></i> Supplier Info</h4>
                                    <div class="inv-form-row">
                                        <div class="inv-form-group">
                                            <label for="inv-supplier">Supplier Name</label>
                                            <input type="text" id="inv-supplier" placeholder="e.g. Kenya Pharma Ltd">
                                        </div>
                                        <div class="inv-form-group">
                                            <label for="inv-invoice">Invoice / Receipt No.</label>
                                            <input type="text" id="inv-invoice" placeholder="e.g. INV-2026-001">
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="inv-form-actions">
                                <button type="reset" class="btn btn-outline" id="inv-reset-btn">
                                    <i class="fas fa-rotate-left"></i> Reset
                                </button>
                                <button type="submit" class="btn btn-primary" id="inv-submit-btn">
                                    <i class="fas fa-plus"></i> Add Product
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            `;

            this.bindAddEvents(container, businessId);
            this.populateAddCategories();
        },

        populateAddCategories: function () {
            // Categories are now pre-populated from DRUG_CATEGORIES — no dynamic datalist needed
        },

        bindAddEvents: function (container, businessId) {
            // Dashboard link
            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) {
                dashLink.addEventListener('click', function (e) {
                    e.preventDefault();
                    PharmaFlow.Sidebar.setActive('dashboard', null);
                });
            }

            // Auto-generate SKU on page load
            const skuInput = document.getElementById('inv-sku');
            if (skuInput) skuInput.value = this.generateSKU();
            const genSkuBtn = document.getElementById('inv-generate-sku');
            if (genSkuBtn) {
                genSkuBtn.addEventListener('click', () => {
                    if (skuInput) skuInput.value = this.generateSKU();
                });
            }

            this.applyBatchMode('inv-batch-mode', 'inv-batch', 'inv-generate-batch');

            // Margin calculator
            const buyInput = document.getElementById('inv-buying-price');
            const sellInput = document.getElementById('inv-selling-price');
            const updateMargin = () => {
                const buy = parseFloat(buyInput?.value) || 0;
                const sell = parseFloat(sellInput?.value) || 0;
                const marginEl = document.getElementById('inv-margin');
                if (!marginEl) return;
                if (buy > 0 && sell > 0) {
                    const margin = ((sell - buy) / buy * 100).toFixed(1);
                    const profit = sell - buy;
                    marginEl.textContent = margin + '% (KSH ' + profit.toFixed(2) + ' per unit)';
                    marginEl.className = 'inv-margin-display ' + (profit >= 0 ? 'inv-margin--positive' : 'inv-margin--negative');
                } else {
                    marginEl.textContent = '—';
                    marginEl.className = 'inv-margin-display';
                }
            };
            if (buyInput) buyInput.addEventListener('input', updateMargin);
            if (sellInput) sellInput.addEventListener('input', () => {
                updateMargin();
                this.updateAddFormVatTotalPreview();
            });
            const vatEn = document.getElementById('inv-vat-enabled');
            const vatVal = document.getElementById('inv-vat-value');
            const vatTyp = document.getElementById('inv-vat-type');
            const vatUpd = () => this.updateAddFormVatTotalPreview();
            if (vatEn) vatEn.addEventListener('change', vatUpd);
            if (vatVal) vatVal.addEventListener('input', vatUpd);
            if (vatTyp) vatTyp.addEventListener('change', vatUpd);
            this.updateAddFormVatTotalPreview();

            // Form submit
            const form = document.getElementById('inv-add-form');
            if (form) {
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.handleAddProduct();
                });
            }
        },

        handleAddProduct: async function () {
            const businessId = this.getBusinessId();
            if (!businessId) {
                this.showToast('No business assigned. Contact admin.', 'error');
                return;
            }

            const submitBtn = document.getElementById('inv-submit-btn');
            const name = document.getElementById('inv-name')?.value?.trim();
            const genericName = document.getElementById('inv-generic-name')?.value?.trim() || '';
            const category = document.getElementById('inv-category')?.value?.trim();
            const batch = document.getElementById('inv-batch')?.value?.trim();
            const quantity = parseInt(document.getElementById('inv-quantity')?.value) || 0;
            const buyingPrice = parseFloat(document.getElementById('inv-buying-price')?.value) || 0;
            const sellingPrice = parseFloat(document.getElementById('inv-selling-price')?.value) || 0;
            const vatEnabled = (document.getElementById('inv-vat-enabled')?.value || 'false') === 'true';
            const vatValueRaw = parseFloat(document.getElementById('inv-vat-value')?.value) || 0;
            const vatType = document.getElementById('inv-vat-type')?.value || 'percent';
            const expiryStr = document.getElementById('inv-expiry')?.value;

            const drugType = document.getElementById('inv-drug-type')?.value || '';
            const sku = document.getElementById('inv-sku')?.value?.trim() || this.generateSKU();

            if (!name || !category || !expiryStr || !drugType) {
                this.showToast('Please fill in all required fields.', 'error');
                return;
            }

            if (sellingPrice < buyingPrice) {
                this.showToast('Selling price should not be less than buying price.', 'error');
                return;
            }

            const minSellRaw = parseFloat(document.getElementById('inv-min-sell-price')?.value);
            let minimumSellPrice = Number.isFinite(minSellRaw) && minSellRaw > 0 ? minSellRaw : null;
            if (minimumSellPrice != null) {
                if (minimumSellPrice - sellingPrice > 0.001) {
                    this.showToast('Minimum sell price cannot be greater than selling price.', 'error');
                    return;
                }
                if (buyingPrice > 0 && minimumSellPrice + 0.001 < buyingPrice) {
                    this.showToast('Minimum sell price cannot be below buying price (cost).', 'error');
                    return;
                }
            }

            if (vatEnabled && vatValueRaw < 0) {
                this.showToast('VAT value cannot be negative.', 'error');
                return;
            }

            const vatValue = vatEnabled
                ? (vatType === 'percent' ? Math.min(vatValueRaw, 100) : vatValueRaw)
                : 0;

            // Disable button
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
            }

            const product = {
                name: name,
                genericName: genericName,
                category: category,
                drugType: drugType,
                sku: sku,
                batchNumber: batch,
                quantity: quantity,
                reorderLevel: parseInt(document.getElementById('inv-reorder')?.value) || 10,
                unit: document.getElementById('inv-unit')?.value || 'Tablets',
                buyingPrice: buyingPrice,
                sellingPrice: sellingPrice,
                vatEnabled: vatEnabled,
                vatType: vatType,
                vatValue: vatValue,
                expiryDate: firebase.firestore.Timestamp.fromDate(new Date(expiryStr)),
                stockBatches: [{
                    batchNumber: batch || sku,
                    quantity: quantity,
                    expiryDate: firebase.firestore.Timestamp.fromDate(new Date(expiryStr)),
                    buyingPrice: buyingPrice,
                    sellingPrice: sellingPrice,
                    minimumSellPrice: minimumSellPrice != null ? minimumSellPrice : buyingPrice,
                    addedAt: new Date().toISOString(),
                    source: 'initial'
                }],
                manufacturer: document.getElementById('inv-manufacturer')?.value?.trim() || '',
                dosage: document.getElementById('inv-dosage')?.value?.trim() || '',
                description: document.getElementById('inv-description')?.value?.trim() || '',
                supplier: document.getElementById('inv-supplier')?.value?.trim() || '',
                invoiceNumber: document.getElementById('inv-invoice')?.value?.trim() || '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: PharmaFlow.Auth?.currentUser?.uid || ''
            };

            if (minimumSellPrice != null) {
                product.minimumSellPrice = minimumSellPrice;
            }

            try {
                const colRef = getBusinessCollection(businessId, 'inventory');
                const docRef = await colRef.add(product);
                await getBusinessCollection(businessId, 'stock_history').add({
                    productId: docRef.id,
                    productName: name,
                    sku: sku,
                    category: category,
                    type: 'initial',
                    previousQty: 0,
                    addedQty: quantity,
                    newQty: quantity,
                    unitCost: buyingPrice,
                    batchNumber: batch || sku,
                    expiryDate: expiryStr,
                    addedBy: PharmaFlow.Auth?.userProfile?.displayName || PharmaFlow.Auth?.userProfile?.email || 'Unknown',
                    createdAt: new Date().toISOString()
                });

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Product Added',
                        description: 'Added "' + name + '" (SKU: ' + sku + ') — Qty: ' + quantity + ', Price: ' + this.formatCurrency(sellingPrice),
                        category: 'Inventory',
                        status: 'COMPLETED',
                        metadata: { sku: sku, name: name, quantity: quantity, sellingPrice: sellingPrice, buyingPrice: buyingPrice }
                    });
                }

                this.showToast('Product added successfully!');
                document.getElementById('inv-add-form')?.reset();
                document.getElementById('inv-margin').textContent = '—';
                document.getElementById('inv-margin').className = 'inv-margin-display';
            } catch (err) {
                console.error('Error adding product:', err);
                this.showToast('Failed to add product. Try again.', 'error');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fas fa-plus"></i> Add Product';
                }
            }
        },

        // ─── ADD STOCK MODAL ─────────────────────────────────

        openStockModal: function (productId) {
            const product = allProducts.find(p => p.id === productId);
            if (!product) return;

            const existing = document.getElementById('inv-stock-modal');
            if (existing) existing.remove();

            const currentExpiry = product.expiryDate
                ? (product.expiryDate.toDate ? product.expiryDate.toDate() : new Date(product.expiryDate)).toISOString().split('T')[0]
                : '';
            const currentBuyingPrice = parseFloat(product.buyingPrice) || 0;
            const currentSellingPrice = parseFloat(product.sellingPrice) || 0;
            const currentMinimumSellPrice = parseFloat(product.minimumSellPrice) || currentBuyingPrice;

            const modal = document.createElement('div');
            modal.className = 'inv-modal-overlay';
            modal.id = 'inv-stock-modal';
            modal.innerHTML = `
                <div class="inv-modal inv-modal--sm">
                    <div class="inv-modal-header">
                        <h3><i class="fas fa-boxes-packing"></i> Add Stock</h3>
                        <button class="inv-modal-close" id="inv-stock-close">&times;</button>
                    </div>
                    <div class="inv-modal-body">
                        <div class="inv-stock-info">
                            <strong>${this.escapeHtml(product.name)}</strong>
                            ${product.genericName ? '<small class="inv-product-generic">' + this.escapeHtml(product.genericName) + '</small>' : ''}
                            <span>Current Stock: <b>${product.quantity || 0}</b></span>
                        </div>
                        <div class="inv-stock-history-wrap">
                            <div class="inv-stock-history-title">Existing Batches</div>
                            ${this.renderStockBatchHistory(product)}
                            <small style="color:var(--text-tertiary)">Each restock is stored as a separate batch so its expiry date stays intact.</small>
                        </div>
                        <div class="inv-form-group" style="margin-top:14px">
                            <label for="stock-new-batch-mode">New Batch Number</label>
                            <select id="stock-new-batch-mode">
                                <option value="manual" selected>Manual entry</option>
                                <option value="auto">Auto-generate</option>
                            </select>
                            <div class="inv-sku-row inv-batch-row">
                                <input type="text" id="stock-new-batch" placeholder="Enter batch number manually">
                                <button type="button" class="btn btn-sm btn-outline" id="stock-generate-batch" title="Generate batch number">
                                    <i class="fas fa-dice"></i>
                                </button>
                            </div>
                        </div>
                        <div class="inv-form-group" style="margin-top:14px">
                            <label for="stock-add-qty">Quantity to Add <span class="req">*</span></label>
                            <input type="number" id="stock-add-qty" min="1" placeholder="e.g. 50" required autofocus>
                        </div>
                        <div class="inv-form-row" style="margin-top:10px">
                            <div class="inv-form-group">
                                <label for="stock-buying-price">Buying Price (KSH) <span class="req">*</span></label>
                                <input type="number" id="stock-buying-price" min="0" step="0.01" value="${currentBuyingPrice}">
                            </div>
                            <div class="inv-form-group">
                                <label for="stock-selling-price">Selling Price (KSH) <span class="req">*</span></label>
                                <input type="number" id="stock-selling-price" min="0" step="0.01" value="${currentSellingPrice}">
                            </div>
                        </div>
                        <div class="inv-form-group" style="margin-top:10px">
                            <label for="stock-min-sell-price">Minimum sell price — discount floor (KSH)</label>
                            <input type="number" id="stock-min-sell-price" min="0" step="0.01" value="${currentMinimumSellPrice}">
                            <small style="color:var(--text-tertiary)">Applies to this new batch only. Blank defaults to buying price.</small>
                        </div>
                        <div class="inv-form-group" style="margin-top:10px">
                            <label for="stock-new-expiry">New Expiry Date</label>
                            <input type="date" id="stock-new-expiry" value="${currentExpiry}">
                            <small style="color:var(--text-tertiary)">Leave unchanged to keep current expiry</small>
                        </div>
                    </div>
                    <div class="inv-modal-footer">
                        <button class="btn btn-outline" id="inv-stock-cancel">Cancel</button>
                        <button class="btn btn-primary" id="inv-stock-confirm">
                            <i class="fas fa-plus"></i> Add Stock
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            this.applyBatchMode('stock-new-batch-mode', 'stock-new-batch', 'stock-generate-batch');

            const closeModal = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            document.getElementById('inv-stock-close').addEventListener('click', closeModal);
            document.getElementById('inv-stock-cancel').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

            document.getElementById('inv-stock-confirm').addEventListener('click', async () => {
                const addQty = parseInt(document.getElementById('stock-add-qty').value);
                const newExpiry = document.getElementById('stock-new-expiry').value;
                const newBatchNumber = document.getElementById('stock-new-batch')?.value?.trim() || '';
                const newBatchMode = document.getElementById('stock-new-batch-mode')?.value || 'manual';
                const batchBuyingPrice = parseFloat(document.getElementById('stock-buying-price')?.value) || 0;
                const batchSellingPrice = parseFloat(document.getElementById('stock-selling-price')?.value) || 0;
                const batchMinSellRaw = parseFloat(document.getElementById('stock-min-sell-price')?.value);
                const batchMinimumSellPrice = Number.isFinite(batchMinSellRaw) && batchMinSellRaw > 0 ? batchMinSellRaw : batchBuyingPrice;
                const expiryValue = newExpiry || currentExpiry;

                if (!addQty || addQty < 1) {
                    this.showToast('Enter a valid quantity to add.', 'error');
                    return;
                }

                if (!expiryValue) {
                    this.showToast('Please provide an expiry date for the new stock batch.', 'error');
                    return;
                }

                if (batchSellingPrice < batchBuyingPrice) {
                    this.showToast('Selling price should not be less than buying price.', 'error');
                    return;
                }

                if (batchMinimumSellPrice - batchSellingPrice > 0.001) {
                    this.showToast('Minimum sell price cannot be greater than selling price.', 'error');
                    return;
                }

                if (batchBuyingPrice > 0 && batchMinimumSellPrice + 0.001 < batchBuyingPrice) {
                    this.showToast('Minimum sell price cannot be below buying price (cost).', 'error');
                    return;
                }

                const btn = document.getElementById('inv-stock-confirm');
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

                try {
                    const businessId = this.getBusinessId();
                    if (!businessId) throw new Error('No business assigned');

                    const docRef = getBusinessCollection(businessId, 'inventory').doc(productId);
                    const self = this;
                    let previousQtyForHistory = 0;
                    let newQtyForHistory = 0;
                    let batchNumberForHistory = newBatchNumber;

                    await window.db.runTransaction(async (transaction) => {
                        const snapshot = await transaction.get(docRef);
                        if (!snapshot.exists) throw new Error('Product not found');

                        const data = snapshot.data() || {};
                        previousQtyForHistory = parseInt(data.quantity) || 0;
                        const currentBatches = Array.isArray(data.stockBatches) && data.stockBatches.length
                            ? data.stockBatches.slice()
                            : self.getStockBatches(data);
                        const expiryTimestamp = firebase.firestore.Timestamp.fromDate(new Date(expiryValue));
                        const batchRecord = {
                            batchNumber: newBatchNumber || self.generateBatchNumber(),
                            quantity: addQty,
                            expiryDate: expiryTimestamp,
                            buyingPrice: batchBuyingPrice,
                            sellingPrice: batchSellingPrice,
                            minimumSellPrice: batchMinimumSellPrice,
                            addedAt: new Date().toISOString(),
                            source: 'restock',
                            mode: newBatchMode
                        };

                        currentBatches.push(batchRecord);
                        newQtyForHistory = previousQtyForHistory + addQty;
                        batchNumberForHistory = batchRecord.batchNumber;

                        transaction.update(docRef, {
                            quantity: newQtyForHistory,
                            buyingPrice: batchBuyingPrice,
                            sellingPrice: batchSellingPrice,
                            minimumSellPrice: batchMinimumSellPrice,
                            batchNumber: data.batchNumber || batchRecord.batchNumber,
                            expiryDate: self.getPrimaryExpiryFromBatches(currentBatches) || expiryTimestamp,
                            stockBatches: currentBatches,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    });
                    await getBusinessCollection(businessId, 'stock_history').add({
                        productId: productId,
                        productName: product.name || '',
                        sku: product.sku || '',
                        category: product.category || '',
                        type: 'restock',
                        previousQty: previousQtyForHistory,
                        addedQty: addQty,
                        newQty: newQtyForHistory,
                        unitCost: batchBuyingPrice,
                        sellingPrice: batchSellingPrice,
                        batchNumber: batchNumberForHistory,
                        expiryDate: expiryValue,
                        addedBy: PharmaFlow.Auth?.userProfile?.displayName || PharmaFlow.Auth?.userProfile?.email || 'Unknown',
                        createdAt: new Date().toISOString()
                    });

                    // Log activity
                    if (PharmaFlow.ActivityLog) {
                        PharmaFlow.ActivityLog.log({
                            title: 'Stock Added',
                            description: 'Added ' + addQty + ' units to "' + product.name + '"',
                            category: 'Inventory',
                            status: 'COMPLETED',
                            metadata: { productId: productId, name: product.name, addedQty: addQty }
                        });
                    }

                    closeModal();
                    this.showToast('Added ' + addQty + ' units to ' + product.name + '!');
                } catch (err) {
                    console.error('Stock top-up error:', err);
                    this.showToast('Failed to update stock.', 'error');
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-plus"></i> Add Stock';
                }
            });
        },

        // ─── EDIT PRODUCT MODAL ──────────────────────────────

        openEditModal: function (productId) {
            const product = allProducts.find(p => p.id === productId);
            if (!product) return;

            // Remove existing modal
            const existing = document.getElementById('inv-edit-modal');
            if (existing) existing.remove();

            const expiryVal = product.expiryDate
                ? (product.expiryDate.toDate ? product.expiryDate.toDate() : new Date(product.expiryDate)).toISOString().split('T')[0]
                : '';

            const modal = document.createElement('div');
            modal.className = 'inv-modal-overlay';
            modal.id = 'inv-edit-modal';
            modal.innerHTML = `
                <div class="inv-modal">
                    <div class="inv-modal-header">
                        <h3><i class="fas fa-pen-to-square"></i> Edit Product</h3>
                        <button class="inv-modal-close" id="inv-modal-close-btn">&times;</button>
                    </div>
                    <form id="inv-edit-form" autocomplete="off">
                        <div class="inv-modal-body">
                            <div class="inv-form-row">
                                <div class="inv-form-group">
                                    <label>Brand / trade name <span class="req">*</span></label>
                                    <input type="text" id="edit-name" required value="${this.escapeHtml(product.name || '')}">
                                </div>
                                <div class="inv-form-group">
                                    <label>Category <span class="req">*</span></label>
                                    <select id="edit-category" required>
                                        <option value="">Select Category</option>
                                        ${this.DRUG_CATEGORIES.map(c => '<option value="' + c + '"' + (product.category === c ? ' selected' : '') + '>' + c + '</option>').join('')}
                                    </select>
                                </div>
                            </div>
                            <div class="inv-form-row">
                                <div class="inv-form-group full-width">
                                    <label for="edit-generic-name">Generic name</label>
                                    <input type="text" id="edit-generic-name" value="${this.escapeHtml(product.genericName || '')}" placeholder="Optional">
                                </div>
                            </div>
                            <div class="inv-form-row">
                                <div class="inv-form-group">
                                    <label>Batch Number</label>
                                    <input type="text" id="edit-batch" value="${this.escapeHtml(product.batchNumber || '')}">
                                </div>
                                <div class="inv-form-group">
                                    <label>Quantity <span class="req">*</span></label>
                                    <input type="number" id="edit-quantity" required min="0" value="${product.quantity || 0}">
                                </div>
                            </div>
                            <div class="inv-form-row">
                                <div class="inv-form-group">
                                    <label>Buying Price (KSH)</label>
                                    <input type="number" id="edit-buying-price" min="0" step="0.01" value="${product.buyingPrice || 0}">
                                </div>
                                <div class="inv-form-group">
                                    <label>Selling Price (KSH)</label>
                                    <input type="number" id="edit-selling-price" min="0" step="0.01" value="${product.sellingPrice || 0}">
                                </div>
                            </div>
                            <div class="inv-form-row">
                                <div class="inv-form-group full-width">
                                    <label for="edit-min-sell-price">Minimum sell price — discount floor (KSH)</label>
                                    <input type="number" id="edit-min-sell-price" min="0" step="0.01" value="${product.minimumSellPrice != null && product.minimumSellPrice !== '' ? product.minimumSellPrice : ''}" placeholder="Blank = buying price">
                                    <small>Optional. POS cannot discount below this per unit. Blank uses buying price.</small>
                                </div>
                            </div>
                            <div class="inv-form-row">
                                <div class="inv-form-group">
                                    <label>VAT Applies</label>
                                    <select id="edit-vat-enabled">
                                        <option value="false" ${product.vatEnabled ? '' : 'selected'}>No VAT</option>
                                        <option value="true" ${product.vatEnabled ? 'selected' : ''}>VAT Applicable</option>
                                    </select>
                                </div>
                                <div class="inv-form-group">
                                    <label>VAT Value</label>
                                    <div class="inv-form-row inv-input-combo">
                                        <input type="number" id="edit-vat-value" min="0" step="0.01" value="${product.vatValue || 0}">
                                        <select id="edit-vat-type">
                                            <option value="percent" ${(product.vatType || 'percent') === 'percent' ? 'selected' : ''}>%</option>
                                            <option value="amount" ${product.vatType === 'amount' ? 'selected' : ''}>KSH</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div class="inv-form-row" id="edit-row-total-with-vat" style="display:none;">
                                <div class="inv-form-group full-width">
                                    <label>Total with VAT (per unit)</label>
                                    <div class="inv-margin-display inv-total-with-vat" id="edit-total-with-vat">—</div>
                                </div>
                            </div>
                            <div class="inv-form-row">
                                <div class="inv-form-group">
                                    <label>Reorder Level</label>
                                    <input type="number" id="edit-reorder" min="0" value="${product.reorderLevel || 10}">
                                </div>
                                <div class="inv-form-group">
                                    <label>Expiry Date</label>
                                    <input type="date" id="edit-expiry" value="${expiryVal}">
                                </div>
                            </div>
                            <div class="inv-form-row">
                                <div class="inv-form-group">
                                    <label>Drug Classification</label>
                                    <select id="edit-drug-type">
                                        <option value="OTC" ${product.drugType === 'OTC' ? 'selected' : ''}>OTC — Over The Counter</option>
                                        <option value="POM" ${product.drugType === 'POM' ? 'selected' : ''}>POM — Prescription Only</option>
                                        <option value="PO" ${product.drugType === 'PO' ? 'selected' : ''}>PO — Pharmacy Only</option>
                                        <option value="DDA" ${product.drugType === 'DDA' ? 'selected' : ''}>DDA — Dangerous Drug</option>
                                    </select>
                                </div>
                                <div class="inv-form-group">
                                    <label>SKU / Barcode</label>
                                    <input type="text" id="edit-sku" value="${this.escapeHtml(product.sku || '')}" readonly>
                                </div>
                            </div>
                            <div class="inv-form-row">
                                <div class="inv-form-group">
                                    <label>Manufacturer</label>
                                    <input type="text" id="edit-manufacturer" value="${this.escapeHtml(product.manufacturer || '')}">
                                </div>
                                <div class="inv-form-group">
                                    <label>Supplier</label>
                                    <input type="text" id="edit-supplier" value="${this.escapeHtml(product.supplier || '')}">
                                </div>
                            </div>
                        </div>
                        <div class="inv-modal-footer">
                            <button type="button" class="btn btn-outline" id="inv-modal-cancel-btn">Cancel</button>
                            <button type="submit" class="btn btn-primary" id="inv-edit-submit-btn">
                                <i class="fas fa-save"></i> Save Changes
                            </button>
                        </div>
                    </form>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            // Close handlers
            const closeModal = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            document.getElementById('inv-modal-close-btn').addEventListener('click', closeModal);
            document.getElementById('inv-modal-cancel-btn').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

            // Submit
            document.getElementById('inv-edit-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.handleEditProduct(productId, closeModal);
            });

            const editVatUpd = () => this.updateEditFormVatTotalPreview();
            document.getElementById('edit-selling-price')?.addEventListener('input', editVatUpd);
            document.getElementById('edit-vat-enabled')?.addEventListener('change', editVatUpd);
            document.getElementById('edit-vat-value')?.addEventListener('input', editVatUpd);
            document.getElementById('edit-vat-type')?.addEventListener('change', editVatUpd);
            this.updateEditFormVatTotalPreview();
        },

        handleEditProduct: async function (productId, closeModal) {
            const businessId = this.getBusinessId();
            if (!businessId) return;

            const submitBtn = document.getElementById('inv-edit-submit-btn');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

            const vatEnabled = (document.getElementById('edit-vat-enabled')?.value || 'false') === 'true';
            const vatType = document.getElementById('edit-vat-type')?.value || 'percent';
            const vatRaw = parseFloat(document.getElementById('edit-vat-value')?.value) || 0;
            const vatValue = vatEnabled ? (vatType === 'percent' ? Math.min(vatRaw, 100) : vatRaw) : 0;

            const expiryStr = document.getElementById('edit-expiry')?.value;
            const sellPrice = parseFloat(document.getElementById('edit-selling-price')?.value) || 0;
            const buyPrice = parseFloat(document.getElementById('edit-buying-price')?.value) || 0;
            const minSellRaw = parseFloat(document.getElementById('edit-min-sell-price')?.value);
            let minSellPersist = Number.isFinite(minSellRaw) && minSellRaw > 0 ? minSellRaw : null;
            if (minSellPersist != null) {
                if (minSellPersist - sellPrice > 0.001) {
                    this.showToast('Minimum sell price cannot be greater than selling price.', 'error');
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
                    return;
                }
                if (buyPrice > 0 && minSellPersist + 0.001 < buyPrice) {
                    this.showToast('Minimum sell price cannot be below buying price (cost).', 'error');
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
                    return;
                }
            }

            const updates = {
                name: document.getElementById('edit-name')?.value?.trim() || '',
                genericName: document.getElementById('edit-generic-name')?.value?.trim() || '',
                category: document.getElementById('edit-category')?.value?.trim() || '',
                batchNumber: document.getElementById('edit-batch')?.value?.trim() || '',
                quantity: parseInt(document.getElementById('edit-quantity')?.value) || 0,
                buyingPrice: parseFloat(document.getElementById('edit-buying-price')?.value) || 0,
                sellingPrice: parseFloat(document.getElementById('edit-selling-price')?.value) || 0,
                vatEnabled: vatEnabled,
                vatType: vatType,
                vatValue: vatValue,
                reorderLevel: parseInt(document.getElementById('edit-reorder')?.value) || 10,
                drugType: document.getElementById('edit-drug-type')?.value || '',
                manufacturer: document.getElementById('edit-manufacturer')?.value?.trim() || '',
                supplier: document.getElementById('edit-supplier')?.value?.trim() || '',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                minimumSellPrice: minSellPersist != null ? minSellPersist : firebase.firestore.FieldValue.delete()
            };

            if (expiryStr) {
                updates.expiryDate = firebase.firestore.Timestamp.fromDate(new Date(expiryStr));
            }

            try {
                const docRef = getBusinessCollection(businessId, 'inventory').doc(productId);
                await docRef.update(updates);

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Product Updated',
                        description: 'Updated "' + (updates.name || productId) + '"',
                        category: 'Inventory',
                        status: 'COMPLETED',
                        metadata: { productId: productId, name: updates.name }
                    });
                }

                this.showToast('Product updated successfully!');
                closeModal();
            } catch (err) {
                console.error('Error updating product:', err);
                this.showToast('Failed to update product.', 'error');
            } finally {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
            }
        },

        // ─── DELETE PRODUCT ──────────────────────────────────

        confirmDelete: function (productId) {
            const product = allProducts.find(p => p.id === productId);
            if (!product) return;

            const existing = document.getElementById('inv-delete-modal');
            if (existing) existing.remove();

            const modal = document.createElement('div');
            modal.className = 'inv-modal-overlay';
            modal.id = 'inv-delete-modal';
            modal.innerHTML = `
                <div class="inv-modal inv-modal--sm">
                    <div class="inv-modal-header inv-modal-header--danger">
                        <h3><i class="fas fa-triangle-exclamation"></i> Delete Product</h3>
                        <button class="inv-modal-close" id="inv-del-close">&times;</button>
                    </div>
                    <div class="inv-modal-body">
                        <p>Are you sure you want to delete <strong>${this.escapeHtml(product.name)}</strong>?</p>
                        <p class="inv-delete-warn">This action cannot be undone.</p>
                    </div>
                    <div class="inv-modal-footer">
                        <button class="btn btn-outline" id="inv-del-cancel">Cancel</button>
                        <button class="btn btn-danger" id="inv-del-confirm">
                            <i class="fas fa-trash-can"></i> Delete
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            const closeModal = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            document.getElementById('inv-del-close').addEventListener('click', closeModal);
            document.getElementById('inv-del-cancel').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

            document.getElementById('inv-del-confirm').addEventListener('click', async () => {
                const btn = document.getElementById('inv-del-confirm');
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
                await this.handleDelete(productId, closeModal);
            });
        },

        handleDelete: async function (productId, closeModal) {
            const businessId = this.getBusinessId();
            if (!businessId) return;

            try {
                await getBusinessCollection(businessId, 'inventory').doc(productId).delete();

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Product Deleted',
                        description: 'Deleted product ID: ' + productId,
                        category: 'Inventory',
                        status: 'COMPLETED',
                        metadata: { productId: productId }
                    });
                }

                this.showToast('Product deleted successfully!');
                closeModal();
            } catch (err) {
                console.error('Error deleting product:', err);
                this.showToast('Failed to delete product.', 'error');
            }
        },

        // ─── CLEANUP ────────────────────────────────────────

        cleanup: function () {
            if (unsubInventory) {
                unsubInventory();
                unsubInventory = null;
            }
            if (unsubReconciliationSales) {
                unsubReconciliationSales();
                unsubReconciliationSales = null;
            }
            if (unsubReconciliationStock) {
                unsubReconciliationStock();
                unsubReconciliationStock = null;
            }
            if (unsubInventoryDisposals) {
                unsubInventoryDisposals();
                unsubInventoryDisposals = null;
            }
            if (unsubBatchTracker) {
                unsubBatchTracker();
                unsubBatchTracker = null;
            }
            reconciliationSales = [];
            reconciliationStockHistory = [];
            quarantinedByProduct = {};
        }
    };

    window.PharmaFlow.Inventory = Inventory;
})();
