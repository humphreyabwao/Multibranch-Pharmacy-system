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
    let allProducts = [];

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
            return 'KSH ' + new Intl.NumberFormat('en-KE', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(amount);
        },

        formatDate: function (ts) {
            if (!ts) return '—';
            const d = ts.toDate ? ts.toDate() : new Date(ts);
            return d.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
        },

        generateSKU: function () {
            const prefix = 'PF';
            const timestamp = Date.now().toString(36).toUpperCase();
            const random = Math.random().toString(36).substring(2, 6).toUpperCase();
            return prefix + '-' + timestamp + random;
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
                            <input type="text" id="inv-search-input" placeholder="Search by name, batch, or category...">
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
                                        <th>Product Name</th>
                                        <th>Category</th>
                                        <th>Drug Type</th>
                                        <th>Batch No.</th>
                                        <th>Qty</th>
                                        <th>Buying Price</th>
                                        <th>Selling Price</th>
                                        <th>Expiry Date</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="inv-table-body">
                                    <tr>
                                        <td colspan="11" class="inv-loading-cell">
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
                        allProducts = [];
                        snapshot.forEach(doc => {
                            allProducts.push({ id: doc.id, ...doc.data() });
                        });
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
                    }
                    this.updateStats();
                    this.populateCategories();
                    this.applyFilters();
                },
                (err) => {
                    console.error('Inventory listener error:', err);
                    const tbody = document.getElementById('inv-table-body');
                    if (tbody) {
                        tbody.innerHTML = '<tr><td colspan="9" class="inv-loading-cell" style="color:var(--danger)"><i class="fas fa-exclamation-triangle"></i> Failed to load inventory</td></tr>';
                    }
                }
            );
        },

        updateStats: function () {
            const now = new Date();
            const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

            let totalValue = 0;
            let outOfStock = 0;
            let lowStock = 0;
            let expiringSoon = 0;

            allProducts.forEach(p => {
                const qty = p.quantity || 0;
                const price = p.sellingPrice || 0;
                const reorderLevel = p.reorderLevel || 10;

                totalValue += qty * price;

                if (qty <= 0) outOfStock++;
                else if (qty <= reorderLevel) lowStock++;

                if (p.expiryDate) {
                    const exp = p.expiryDate.toDate ? p.expiryDate.toDate() : new Date(p.expiryDate);
                    if (exp <= thirtyDays && exp > now) expiringSoon++;
                }
            });

            this.setStat('inv-stat-total', allProducts.length);
            this.setStat('inv-stat-value', this.formatCurrency(totalValue));
            this.setStat('inv-stat-outofstock', outOfStock);
            this.setStat('inv-stat-lowstock', lowStock);
            this.setStat('inv-stat-expiring', expiringSoon);
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
                    const batch = (p.batchNumber || '').toLowerCase();
                    const cat = (p.category || '').toLowerCase();
                    const sku = (p.sku || '').toLowerCase();
                    if (!name.includes(search) && !batch.includes(search) && !cat.includes(search) && !sku.includes(search)) return false;
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
                        <td colspan="11" class="inv-empty-cell">
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
                                ${p.manufacturer ? '<small>' + this.escapeHtml(p.manufacturer) + '</small>' : ''}
                            </div>
                        </td>
                        <td>${this.escapeHtml(p.category || '—')}</td>
                        <td>${this.getDrugTypeBadge(p.drugType)}</td>
                        <td><code>${this.escapeHtml(p.batchNumber || '—')}</code></td>
                        <td class="${(p.quantity || 0) <= (p.reorderLevel || 10) ? 'inv-qty-warn' : ''}">${p.quantity || 0}</td>
                        <td>${this.formatCurrency(p.buyingPrice || 0)}</td>
                        <td>${this.formatCurrency(p.sellingPrice || 0)}</td>
                        <td>${this.formatDate(p.expiryDate)}</td>
                        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                        <td>
                            <div class="inv-actions">
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
                'Product Name': p.name || '',
                'Category': p.category || '',
                'Drug Type': p.drugType || '',
                'Batch Number': p.batchNumber || '',
                'Quantity': p.quantity || 0,
                'Buying Price': p.buyingPrice || 0,
                'Selling Price': p.sellingPrice || 0,
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
            const headers = ['SKU', 'Product', 'Category', 'Type', 'Batch', 'Qty', 'Buy Price', 'Sell Price', 'Expiry', 'Status'];
            const rows = products.map(p => [
                p.sku || '',
                p.name || '',
                p.category || '',
                p.drugType || '',
                p.batchNumber || '',
                String(p.quantity || 0),
                this.formatCurrency(p.buyingPrice || 0),
                this.formatCurrency(p.sellingPrice || 0),
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

        getImportTemplateHeaders: function () {
            return ['Name', 'Category', 'Drug Type', 'Batch Number', 'Quantity', 'Buying Price', 'Selling Price', 'Expiry Date', 'Manufacturer', 'Supplier', 'Unit', 'Reorder Level', 'Dosage'];
        },

        getImportSampleRows: function () {
            return [
                ['Paracetamol 500mg', 'Analgesics & Antipyretics', 'OTC', 'BTN-2026-001', '500', '3.50', '8.00', '2027-06-15', 'GSK', 'MedSupply Ltd', 'Tablets', '50', '500mg'],
                ['Amoxicillin 250mg', 'Antibiotics', 'POM', 'BTN-2026-002', '200', '12.00', '25.00', '2027-03-20', 'Cipla', 'PharmaDist', 'Capsules', '30', '250mg'],
                ['Loratadine 10mg', 'Antihistamines & Allergy', 'OTC', 'BTN-2026-003', '150', '5.00', '15.00', '2028-01-10', 'Bayer', 'HealthCorp', 'Tablets', '20', '10mg']
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
                            <p class="inv-import-hint">Supports <strong>.csv</strong> and <strong>.xlsx / .xls</strong> (Excel) files.</p>
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
                if (e.target.files[0]) self.processImportFile(e.target.files[0], businessId, (products) => {
                    parsedProducts = products;
                });
            });

            // Drag and drop
            const dropzone = document.getElementById('inv-import-dropzone');
            dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
            dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('dragover'); });
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file) self.processImportFile(file, businessId, (products) => {
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

            // Update dropzone to show selected file
            const inner = document.getElementById('inv-dropzone-inner');
            const ext = name.split('.').pop();
            const icon = ext === 'csv' ? 'fa-file-csv' : 'fa-file-excel';
            inner.innerHTML = '<i class="fas ' + icon + ' inv-file-icon--' + ext + '"></i><p>' + this.escapeHtml(file.name) + '</p><small>' + (file.size / 1024).toFixed(1) + ' KB</small>';

            if (name.endsWith('.csv')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const products = this.parseCsvToProducts(e.target.result);
                    if (products) {
                        this.showImportPreview(products);
                        onParsed(products);
                    }
                };
                reader.readAsText(file);
            } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
                if (typeof XLSX === 'undefined') {
                    this.showToast('Excel library loading... try again.', 'error');
                    return;
                }
                const reader = new FileReader();
                reader.onload = (e) => {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const csvText = XLSX.utils.sheet_to_csv(firstSheet);
                    const products = this.parseCsvToProducts(csvText);
                    if (products) {
                        this.showImportPreview(products);
                        onParsed(products);
                    }
                };
                reader.readAsArrayBuffer(file);
            } else {
                this.showToast('Unsupported file format. Use CSV or Excel.', 'error');
            }
        },

        parseCsvToProducts: function (csvText) {
            const lines = csvText.split(/\r?\n/).filter(l => l.trim());
            if (lines.length < 2) {
                this.showToast('File is empty or has no data rows.', 'error');
                return null;
            }

            const headers = this.parseCsvRow(lines[0]).map(h => h.trim().toLowerCase());

            const colMap = {
                name: headers.indexOf('name') >= 0 ? headers.indexOf('name') : headers.indexOf('product name'),
                category: headers.indexOf('category'),
                drugType: this.findHeaderIdx(headers, ['drug type', 'drugtype', 'type', 'classification']),
                batchNumber: this.findHeaderIdx(headers, ['batch number', 'batchnumber', 'batch no', 'batch']),
                quantity: this.findHeaderIdx(headers, ['quantity', 'qty']),
                buyingPrice: this.findHeaderIdx(headers, ['buying price', 'buyingprice', 'cost price', 'cost']),
                sellingPrice: this.findHeaderIdx(headers, ['selling price', 'sellingprice', 'price', 'sell price']),
                expiryDate: this.findHeaderIdx(headers, ['expiry date', 'expirydate', 'expiry', 'exp date']),
                manufacturer: this.findHeaderIdx(headers, ['manufacturer', 'mfg']),
                supplier: this.findHeaderIdx(headers, ['supplier']),
                unit: this.findHeaderIdx(headers, ['unit', 'unit of measure', 'uom']),
                reorderLevel: this.findHeaderIdx(headers, ['reorder level', 'reorderlevel', 'reorder']),
                dosage: this.findHeaderIdx(headers, ['dosage', 'strength']),
                sku: this.findHeaderIdx(headers, ['sku', 'barcode'])
            };

            if (colMap.name < 0) {
                this.showToast('File must have a "Name" or "Product Name" column.', 'error');
                return null;
            }

            const products = [];
            for (let i = 1; i < lines.length; i++) {
                const cols = this.parseCsvRow(lines[i]);
                const name = (cols[colMap.name] || '').trim();
                if (!name) continue;

                const expiryRaw = colMap.expiryDate >= 0 ? (cols[colMap.expiryDate] || '').trim() : '';
                let expiryTs = null;
                if (expiryRaw) {
                    const d = new Date(expiryRaw);
                    if (!isNaN(d.getTime())) expiryTs = firebase.firestore.Timestamp.fromDate(d);
                }

                const drugType = colMap.drugType >= 0 ? (cols[colMap.drugType] || '').trim().toUpperCase() : '';
                const validTypes = ['OTC', 'POM', 'PO', 'DDA'];

                products.push({
                    name: name,
                    category: colMap.category >= 0 ? (cols[colMap.category] || '').trim() : '',
                    drugType: validTypes.includes(drugType) ? drugType : '',
                    batchNumber: colMap.batchNumber >= 0 ? (cols[colMap.batchNumber] || '').trim() : '',
                    quantity: colMap.quantity >= 0 ? (parseInt(cols[colMap.quantity]) || 0) : 0,
                    buyingPrice: colMap.buyingPrice >= 0 ? (parseFloat(cols[colMap.buyingPrice]) || 0) : 0,
                    sellingPrice: colMap.sellingPrice >= 0 ? (parseFloat(cols[colMap.sellingPrice]) || 0) : 0,
                    expiryDate: expiryTs,
                    manufacturer: colMap.manufacturer >= 0 ? (cols[colMap.manufacturer] || '').trim() : '',
                    supplier: colMap.supplier >= 0 ? (cols[colMap.supplier] || '').trim() : '',
                    unit: colMap.unit >= 0 ? (cols[colMap.unit] || 'Tablets').trim() : 'Tablets',
                    reorderLevel: colMap.reorderLevel >= 0 ? (parseInt(cols[colMap.reorderLevel]) || 10) : 10,
                    dosage: colMap.dosage >= 0 ? (cols[colMap.dosage] || '').trim() : '',
                    sku: colMap.sku >= 0 && (cols[colMap.sku] || '').trim() ? (cols[colMap.sku]).trim() : this.generateSKU(),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    createdBy: PharmaFlow.Auth?.currentUser?.uid || ''
                });
            }

            if (products.length === 0) {
                this.showToast('No valid products found in file.', 'error');
                return null;
            }

            return products;
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

        showImportPreview: function (products) {
            const section = document.getElementById('inv-import-preview-section');
            const previewEl = document.getElementById('inv-import-preview-table');
            const fileInfo = document.getElementById('inv-import-file-info');
            const confirmBtn = document.getElementById('inv-import-confirm');

            if (!section || !previewEl) return;

            section.style.display = 'block';
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fas fa-upload"></i> Import ' + products.length + ' Products';

            fileInfo.innerHTML = '<i class="fas fa-check-circle" style="color:var(--success)"></i> <strong>' + products.length + '</strong> products ready to import';

            const showCount = Math.min(products.length, 10);
            previewEl.innerHTML = '<table class="inv-preview-table"><thead><tr><th>#</th><th>Name</th><th>Category</th><th>Drug Type</th><th>Qty</th><th>Buy Price</th><th>Sell Price</th></tr></thead><tbody>' +
                products.slice(0, showCount).map((p, i) => {
                    return '<tr><td>' + (i + 1) + '</td><td>' + this.escapeHtml(p.name) + '</td><td>' + this.escapeHtml(p.category) + '</td><td>' + (p.drugType || '-') + '</td><td>' + p.quantity + '</td><td>' + this.formatCurrency(p.buyingPrice) + '</td><td>' + this.formatCurrency(p.sellingPrice) + '</td></tr>';
                }).join('') +
                (products.length > showCount ? '<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);font-style:italic">... and ' + (products.length - showCount) + ' more products</td></tr>' : '') +
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
                    batch.set(ref, p);
                });
                try {
                    await batch.commit();
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
                                            <label for="inv-name">Product Name <span class="req">*</span></label>
                                            <input type="text" id="inv-name" required placeholder="e.g. Paracetamol 500mg">
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
                                            <label for="inv-batch">Batch Number</label>
                                            <input type="text" id="inv-batch" placeholder="e.g. BN-20260301">
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
            if (sellInput) sellInput.addEventListener('input', updateMargin);

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
            const category = document.getElementById('inv-category')?.value?.trim();
            const batch = document.getElementById('inv-batch')?.value?.trim();
            const quantity = parseInt(document.getElementById('inv-quantity')?.value) || 0;
            const buyingPrice = parseFloat(document.getElementById('inv-buying-price')?.value) || 0;
            const sellingPrice = parseFloat(document.getElementById('inv-selling-price')?.value) || 0;
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

            // Disable button
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
            }

            const product = {
                name: name,
                category: category,
                drugType: drugType,
                sku: sku,
                batchNumber: batch,
                quantity: quantity,
                reorderLevel: parseInt(document.getElementById('inv-reorder')?.value) || 10,
                unit: document.getElementById('inv-unit')?.value || 'Tablets',
                buyingPrice: buyingPrice,
                sellingPrice: sellingPrice,
                expiryDate: firebase.firestore.Timestamp.fromDate(new Date(expiryStr)),
                manufacturer: document.getElementById('inv-manufacturer')?.value?.trim() || '',
                dosage: document.getElementById('inv-dosage')?.value?.trim() || '',
                description: document.getElementById('inv-description')?.value?.trim() || '',
                supplier: document.getElementById('inv-supplier')?.value?.trim() || '',
                invoiceNumber: document.getElementById('inv-invoice')?.value?.trim() || '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: PharmaFlow.Auth?.currentUser?.uid || ''
            };

            try {
                const colRef = getBusinessCollection(businessId, 'inventory');
                await colRef.add(product);

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
                            <span>Current Stock: <b>${product.quantity || 0}</b></span>
                        </div>
                        <div class="inv-form-group" style="margin-top:14px">
                            <label for="stock-add-qty">Quantity to Add <span class="req">*</span></label>
                            <input type="number" id="stock-add-qty" min="1" placeholder="e.g. 50" required autofocus>
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

            const closeModal = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            document.getElementById('inv-stock-close').addEventListener('click', closeModal);
            document.getElementById('inv-stock-cancel').addEventListener('click', closeModal);
            modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

            document.getElementById('inv-stock-confirm').addEventListener('click', async () => {
                const addQty = parseInt(document.getElementById('stock-add-qty').value);
                const newExpiry = document.getElementById('stock-new-expiry').value;

                if (!addQty || addQty < 1) {
                    this.showToast('Enter a valid quantity to add.', 'error');
                    return;
                }

                const btn = document.getElementById('inv-stock-confirm');
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

                try {
                    const businessId = this.getBusinessId();
                    if (!businessId) throw new Error('No business assigned');

                    const updateData = {
                        quantity: (product.quantity || 0) + addQty,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    };

                    if (newExpiry) {
                        updateData.expiryDate = firebase.firestore.Timestamp.fromDate(new Date(newExpiry));
                    }

                    await getBusinessCollection(businessId, 'inventory').doc(productId).update(updateData);

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
                                    <label>Product Name <span class="req">*</span></label>
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
        },

        handleEditProduct: async function (productId, closeModal) {
            const businessId = this.getBusinessId();
            if (!businessId) return;

            const submitBtn = document.getElementById('inv-edit-submit-btn');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

            const expiryStr = document.getElementById('edit-expiry')?.value;
            const updates = {
                name: document.getElementById('edit-name')?.value?.trim() || '',
                category: document.getElementById('edit-category')?.value?.trim() || '',
                batchNumber: document.getElementById('edit-batch')?.value?.trim() || '',
                quantity: parseInt(document.getElementById('edit-quantity')?.value) || 0,
                buyingPrice: parseFloat(document.getElementById('edit-buying-price')?.value) || 0,
                sellingPrice: parseFloat(document.getElementById('edit-selling-price')?.value) || 0,
                reorderLevel: parseInt(document.getElementById('edit-reorder')?.value) || 10,
                drugType: document.getElementById('edit-drug-type')?.value || '',
                manufacturer: document.getElementById('edit-manufacturer')?.value?.trim() || '',
                supplier: document.getElementById('edit-supplier')?.value?.trim() || '',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
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
        }
    };

    window.PharmaFlow.Inventory = Inventory;
})();
