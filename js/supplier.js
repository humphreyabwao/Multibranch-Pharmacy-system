/**
 * PharmaFlow - Supplier Module
 * Full CRUD for managing suppliers.
 * Single-page module (no sub-modules) — renders a table with Add/Edit/Delete.
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let supplierListener = null;
    let supplierOrdersListener = null;
    let allSuppliers = [];
    let filteredSuppliers = [];
    let supplierOrdersCache = [];
    let supplierOrderCountById = {};
    let supplierOrderCountByName = {};
    let currentPage = 1;
    const PAGE_SIZE = 25;
    let editingSupplierId = null;
    let activeSupplierOrdersSupplierId = null;
    let supplierOrdersInvoiceQuery = '';

    const Supplier = {

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
            const old = document.querySelector('.sup-toast');
            if (old) old.remove();
            const t = document.createElement('div');
            t.className = 'sup-toast' + (type === 'error' ? ' sup-toast--error' : '');
            t.innerHTML = '<i class="fas ' + (type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle') + '"></i> ' + msg;
            document.body.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
        },

        cleanup: function () {
            if (supplierListener) { supplierListener(); supplierListener = null; }
            if (supplierOrdersListener) { supplierOrdersListener(); supplierOrdersListener = null; }
            allSuppliers = [];
            filteredSuppliers = [];
            supplierOrdersCache = [];
            supplierOrderCountById = {};
            supplierOrderCountByName = {};
            editingSupplierId = null;
            activeSupplierOrdersSupplierId = null;
            supplierOrdersInvoiceQuery = '';
        },

        normalizeText: function (value) {
            return String(value || '').trim().toLowerCase();
        },

        // ═══════════════════════════════════════════════
        //  RENDER
        // ═══════════════════════════════════════════════

        render: function (container) {
            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-truck-field"></i> Suppliers</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>Supplier</span>
                            </div>
                        </div>
                        <button class="dda-btn dda-btn--primary" id="sup-add-btn">
                            <i class="fas fa-plus"></i> Add Supplier
                        </button>
                    </div>

                    <!-- Stats -->
                    <div class="dda-stats">
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon"><i class="fas fa-truck"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="sup-total">0</span>
                                <span class="dda-stat-label">Total Suppliers</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-check-circle"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="sup-active">0</span>
                                <span class="dda-stat-label">Active</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-pause-circle"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="sup-inactive">0</span>
                                <span class="dda-stat-label">Inactive</span>
                            </div>
                        </div>
                        <div class="dda-stat-card dda-stat-card--loan">
                            <div class="dda-stat-icon dda-stat-icon--loan"><i class="fas fa-hand-holding-dollar"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="sup-loan-total">KSH 0.00</span>
                                <span class="dda-stat-label">Loan Owed</span>
                                <span class="dda-stat-subtext" id="sup-loan-top">No outstanding supplier loans</span>
                            </div>
                        </div>
                    </div>

                    <!-- Toolbar -->
                    <div class="dda-toolbar">
                        <div class="dda-search-box">
                            <i class="fas fa-search"></i>
                            <input type="text" id="sup-search" placeholder="Search suppliers...">
                        </div>
                        <div class="dda-toolbar-actions">
                            <select id="sup-status-filter">
                                <option value="">All Status</option>
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                            </select>
                            <button class="dda-btn dda-btn--export" id="sup-export-pdf">
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
                                    <th>Supplier Name</th>
                                    <th>Contact Person</th>
                                    <th>Phone</th>
                                    <th>Email</th>
                                    <th>Location</th>
                                    <th>Category</th>
                                    <th>Status</th>
                                    <th>Orders</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="sup-tbody">
                                <tr><td colspan="10" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading suppliers...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="dda-pagination" id="sup-pagination"></div>
                </div>

                <!-- Add/Edit Supplier Modal -->
                <div class="dda-modal-overlay" id="sup-modal" style="display:none">
                    <div class="dda-modal">
                        <div class="dda-modal-header">
                            <h3 id="sup-modal-title"><i class="fas fa-plus"></i> Add Supplier</h3>
                            <button class="dda-modal-close" id="sup-modal-close">&times;</button>
                        </div>
                        <div class="dda-modal-body">
                            <div class="dda-form-group">
                                <label>Supplier Name <span class="required">*</span></label>
                                <input type="text" id="sup-name" placeholder="e.g., MedPharm Distributors">
                            </div>
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Contact Person</label>
                                    <input type="text" id="sup-contact" placeholder="Full name">
                                </div>
                                <div class="dda-form-group">
                                    <label>Phone Number</label>
                                    <input type="tel" id="sup-phone" placeholder="e.g., 0712345678">
                                </div>
                            </div>
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Email</label>
                                    <input type="email" id="sup-email" placeholder="supplier@email.com">
                                </div>
                                <div class="dda-form-group">
                                    <label>Location / Address</label>
                                    <input type="text" id="sup-location" placeholder="City, area">
                                </div>
                            </div>
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Category / Specialty</label>
                                    <select id="sup-category">
                                        <option value="">Select category</option>
                                        <option value="General Pharmaceuticals">General Pharmaceuticals</option>
                                        <option value="OTC & Consumer Health">OTC & Consumer Health</option>
                                        <option value="Surgical & Medical Devices">Surgical & Medical Devices</option>
                                        <option value="Lab & Diagnostics">Lab & Diagnostics</option>
                                        <option value="Vaccines & Biologics">Vaccines & Biologics</option>
                                        <option value="DDA & Controlled Substances">DDA & Controlled Substances</option>
                                        <option value="Herbal & Alternative">Herbal & Alternative</option>
                                        <option value="Cosmetics & Dermatology">Cosmetics & Dermatology</option>
                                        <option value="Veterinary">Veterinary</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>
                                <div class="dda-form-group">
                                    <label>Status</label>
                                    <select id="sup-status">
                                        <option value="active">Active</option>
                                        <option value="inactive">Inactive</option>
                                    </select>
                                </div>
                            </div>
                            <div class="dda-form-group">
                                <label>Notes</label>
                                <textarea id="sup-notes" rows="2" placeholder="Additional notes..."></textarea>
                            </div>
                        </div>
                        <div class="dda-modal-footer">
                            <button class="dda-btn dda-btn--cancel" id="sup-cancel">Cancel</button>
                            <button class="dda-btn dda-btn--primary" id="sup-save">
                                <i class="fas fa-save"></i> Save Supplier
                            </button>
                        </div>
                    </div>
                </div>

                <!-- View Supplier Modal -->
                <div class="dda-modal-overlay" id="sup-view-modal" style="display:none">
                    <div class="dda-modal dda-modal--view">
                        <div class="dda-modal-header">
                            <h3><i class="fas fa-truck"></i> Supplier Details</h3>
                            <button class="dda-modal-close" id="sup-view-close">&times;</button>
                        </div>
                        <div class="dda-modal-body" id="sup-view-body"></div>
                        <div class="dda-modal-footer">
                            <button class="dda-btn dda-btn--cancel" id="sup-view-close-btn">Close</button>
                        </div>
                    </div>
                </div>

                <!-- Supplier Orders Modal -->
                <div class="dda-modal-overlay" id="sup-orders-modal" style="display:none">
                    <div class="dda-modal sup-orders-modal">
                        <div class="dda-modal-header">
                            <h3><i class="fas fa-receipt"></i> Supplier Orders</h3>
                            <button class="dda-modal-close" id="sup-orders-close">&times;</button>
                        </div>
                        <div class="dda-modal-body">
                            <div class="sup-orders-summary" id="sup-orders-summary"></div>
                            <div class="sup-orders-search">
                                <i class="fas fa-search"></i>
                                <input type="text" id="sup-orders-invoice-search" placeholder="Search invoice number..." autocomplete="off">
                            </div>
                            <div class="dda-table-wrap">
                                <table class="dda-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Order ID</th>
                                            <th>Order Date</th>
                                            <th>Status</th>
                                            <th>Payment</th>
                                            <th>Total Amount</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody id="sup-orders-tbody">
                                        <tr><td colspan="7" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading orders...</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div class="dda-modal-footer">
                            <button class="dda-btn dda-btn--cancel" id="sup-orders-close-btn">Close</button>
                        </div>
                    </div>
                </div>
            `;

            this.bindEvents(container);
            this.subscribe();
        },

        // ═══════════════════════════════════════════════
        //  EVENTS
        // ═══════════════════════════════════════════════

        bindEvents: function (container) {
            document.getElementById('sup-search')?.addEventListener('input', () => { currentPage = 1; this.filter(); });
            document.getElementById('sup-status-filter')?.addEventListener('change', () => { currentPage = 1; this.filter(); });
            document.getElementById('sup-export-pdf')?.addEventListener('click', () => this.exportPdf());
            document.getElementById('sup-add-btn')?.addEventListener('click', () => this.openModal());
            document.getElementById('sup-modal-close')?.addEventListener('click', () => this.closeModal());
            document.getElementById('sup-cancel')?.addEventListener('click', () => this.closeModal());
            document.getElementById('sup-save')?.addEventListener('click', () => this.save());
            document.getElementById('sup-view-close')?.addEventListener('click', () => { document.getElementById('sup-view-modal').style.display = 'none'; });
            document.getElementById('sup-view-close-btn')?.addEventListener('click', () => { document.getElementById('sup-view-modal').style.display = 'none'; });
            document.getElementById('sup-orders-close')?.addEventListener('click', () => this.closeSupplierOrdersModal());
            document.getElementById('sup-orders-close-btn')?.addEventListener('click', () => this.closeSupplierOrdersModal());
            document.getElementById('sup-orders-invoice-search')?.addEventListener('input', (e) => {
                supplierOrdersInvoiceQuery = (e.target.value || '').trim().toLowerCase();
                if (activeSupplierOrdersSupplierId) this.openSupplierOrdersModal(activeSupplierOrdersSupplierId, true);
            });

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });
        },

        // ═══════════════════════════════════════════════
        //  FIRESTORE
        // ═══════════════════════════════════════════════

        subscribe: function () {
            const businessId = this.getBusinessId();
            if (!businessId) return;
            if (supplierListener) supplierListener();
            this.subscribeOrderStats();

            supplierListener = getBusinessCollection(businessId, 'suppliers')
                .onSnapshot(snap => {
                    allSuppliers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    allSuppliers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                    this.updateStats();
                    this.filter();
                }, err => {
                    console.error('Supplier subscribe error:', err);
                    const tbody = document.getElementById('sup-tbody');
                    if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="dda-loading"><i class="fas fa-exclamation-circle"></i> Failed to load suppliers</td></tr>';
                });
        },

        subscribeOrderStats: function () {
            const businessId = this.getBusinessId();
            if (!businessId) return;
            if (supplierOrdersListener) { supplierOrdersListener(); supplierOrdersListener = null; }

            supplierOrdersListener = getBusinessCollection(businessId, 'orders')
                .onSnapshot(snap => {
                    supplierOrdersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    const byId = {};
                    const byName = {};

                    supplierOrdersCache.forEach(order => {
                        const supplierId = order.supplierId || '';
                        const supplierName = this.normalizeText(order.supplierName || '');
                        if (supplierId) byId[supplierId] = (byId[supplierId] || 0) + 1;
                        if (supplierName) byName[supplierName] = (byName[supplierName] || 0) + 1;
                    });

                    supplierOrderCountById = byId;
                    supplierOrderCountByName = byName;

                    // Keep supplier table counts current
                    if (document.getElementById('sup-tbody')) this.renderPage();

                    // Keep open supplier-orders modal current
                    if (activeSupplierOrdersSupplierId) this.openSupplierOrdersModal(activeSupplierOrdersSupplierId, true);
                }, err => {
                    console.error('Supplier order stats subscribe error:', err);
                });
        },

        getSupplierOrderCount: function (supplier) {
            if (!supplier) return 0;
            const byId = supplierOrderCountById[supplier.id] || 0;
            const byName = supplierOrderCountByName[this.normalizeText(supplier.name)] || 0;
            return Math.max(byId, byName);
        },

        getOrdersForSupplier: function (supplier) {
            const supplierId = supplier ? supplier.id : '';
            const supplierName = this.normalizeText(supplier ? supplier.name : '');

            const rows = supplierOrdersCache.filter(order => {
                if (supplierId && order.supplierId === supplierId) return true;
                return !order.supplierId && this.normalizeText(order.supplierName) === supplierName;
            });

            rows.sort((a, b) => {
                const ta = a.orderTimestamp && a.orderTimestamp.toDate ? a.orderTimestamp.toDate().getTime() : Date.parse(a.createdAt || a.orderDate || 0);
                const tb = b.orderTimestamp && b.orderTimestamp.toDate ? b.orderTimestamp.toDate().getTime() : Date.parse(b.createdAt || b.orderDate || 0);
                return tb - ta;
            });
            return rows;
        },

        getOrderStatusBadge: function (status) {
            const map = {
                pending: 'ord-status--pending',
                approved: 'ord-status--approved',
                received: 'ord-status--received',
                cancelled: 'ord-status--cancelled'
            };
            const key = status || 'pending';
            const cls = map[key] || map.pending;
            const label = key.charAt(0).toUpperCase() + key.slice(1);
            return '<span class="ord-status-badge ' + cls + '">' + label + '</span>';
        },

        getOrderPaymentBadge: function (order) {
            const paymentStatus = order.paymentStatus || (order.paymentMode === 'on-loan' ? 'on-loan' : 'paid');
            if (paymentStatus === 'paid') {
                return '<span class="ord-payment-badge ord-payment--paid"><i class="fas fa-check-circle"></i> Paid in Full</span>';
            }
            return '<span class="ord-payment-badge ord-payment--loan"><i class="fas fa-hand-holding-dollar"></i> On Loan</span>';
        },

        updateStats: function () {
            const el = id => document.getElementById(id);
            if (el('sup-total')) el('sup-total').textContent = allSuppliers.length;
            if (el('sup-active')) el('sup-active').textContent = allSuppliers.filter(s => s.status !== 'inactive').length;
            if (el('sup-inactive')) el('sup-inactive').textContent = allSuppliers.filter(s => s.status === 'inactive').length;

            let totalLoanOwed = 0;
            const loanBySupplier = new Map();

            supplierOrdersCache.forEach(order => {
                const totalAmount = parseFloat(order.totalAmount) || 0;
                const amountPaid = parseFloat(order.amountPaid) || 0;
                const explicitOutstanding = parseFloat(order.outstandingAmount);
                const outstanding = Number.isFinite(explicitOutstanding) ? explicitOutstanding : Math.max(totalAmount - amountPaid, 0);
                const paymentStatus = order.paymentStatus || (order.paymentMode === 'on-loan' ? 'on-loan' : 'paid');
                if (paymentStatus === 'paid' || outstanding <= 0) return;

                totalLoanOwed += outstanding;

                const supplierId = order.supplierId || this.normalizeText(order.supplierName || '');
                if (!supplierId) return;

                const current = loanBySupplier.get(supplierId) || {
                    name: order.supplierName || 'Unknown Supplier',
                    amount: 0
                };
                current.amount += outstanding;
                if (!current.name && order.supplierName) current.name = order.supplierName;
                loanBySupplier.set(supplierId, current);
            });

            let topLoanSupplier = null;
            loanBySupplier.forEach((value, key) => {
                if (!topLoanSupplier || value.amount > topLoanSupplier.amount) {
                    topLoanSupplier = { key, name: value.name, amount: value.amount };
                }
            });

            if (el('sup-loan-total')) el('sup-loan-total').textContent = this.formatCurrency(totalLoanOwed);
            if (el('sup-loan-top')) {
                el('sup-loan-top').textContent = topLoanSupplier
                    ? ('Top: ' + topLoanSupplier.name + ' • ' + this.formatCurrency(topLoanSupplier.amount))
                    : 'No outstanding supplier loans';
            }
        },

        // ═══════════════════════════════════════════════
        //  FILTER & RENDER
        // ═══════════════════════════════════════════════

        filter: function () {
            const query = (document.getElementById('sup-search')?.value || '').toLowerCase();
            const statusFilter = document.getElementById('sup-status-filter')?.value || '';

            filteredSuppliers = allSuppliers.filter(s => {
                if (statusFilter) {
                    const st = s.status || 'active';
                    if (st !== statusFilter) return false;
                }
                if (query) {
                    const haystack = ((s.name || '') + ' ' + (s.contactPerson || '') + ' ' + (s.phone || '') + ' ' + (s.email || '') + ' ' + (s.location || '') + ' ' + (s.category || '')).toLowerCase();
                    return haystack.includes(query);
                }
                return true;
            });

            this.renderPage();
        },

        renderPage: function () {
            const tbody = document.getElementById('sup-tbody');
            if (!tbody) return;

            const start = (currentPage - 1) * PAGE_SIZE;
            const pageData = filteredSuppliers.slice(start, start + PAGE_SIZE);

            if (pageData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10" class="dda-loading"><i class="fas fa-inbox"></i> No suppliers found</td></tr>';
                this.renderPagination();
                return;
            }

            tbody.innerHTML = pageData.map((s, i) => {
                const st = s.status || 'active';
                const orderCount = this.getSupplierOrderCount(s);
                const statusBadge = st === 'active'
                    ? '<span class="dda-stock-badge dda-stock--ok">Active</span>'
                    : '<span class="dda-stock-badge dda-stock--out">Inactive</span>';

                return `<tr>
                    <td>${start + i + 1}</td>
                    <td><strong>${this.escapeHtml(s.name)}</strong></td>
                    <td>${this.escapeHtml(s.contactPerson || '—')}</td>
                    <td>${this.escapeHtml(s.phone || '—')}</td>
                    <td>${this.escapeHtml(s.email || '—')}</td>
                    <td>${this.escapeHtml(s.location || '—')}</td>
                    <td>${this.escapeHtml(s.category || '—')}</td>
                    <td>${statusBadge}</td>
                    <td><button class="sup-orders-btn" data-id="${s.id}" title="View supplier orders"><i class="fas fa-receipt"></i> ${orderCount}</button></td>
                    <td>
                        <button class="sales-action-btn sales-action--view sup-view" data-id="${s.id}" title="View"><i class="fas fa-eye"></i></button>
                        <button class="sales-action-btn sales-action--approve sup-edit" data-id="${s.id}" title="Edit"><i class="fas fa-pen"></i></button>
                        <button class="sales-action-btn sup-delete" data-id="${s.id}" title="Delete" style="background:#fee2e2;color:#dc2626"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>`;
            }).join('');

            // Bind action buttons
            tbody.querySelectorAll('.sup-view').forEach(btn => {
                btn.addEventListener('click', () => {
                    const sup = allSuppliers.find(s => s.id === btn.dataset.id);
                    if (sup) this.viewSupplier(sup);
                });
            });
            tbody.querySelectorAll('.sup-edit').forEach(btn => {
                btn.addEventListener('click', () => this.openModal(btn.dataset.id));
            });
            tbody.querySelectorAll('.sup-delete').forEach(btn => {
                btn.addEventListener('click', () => this.deleteSupplier(btn.dataset.id));
            });
            tbody.querySelectorAll('.sup-orders-btn').forEach(btn => {
                btn.addEventListener('click', () => this.openSupplierOrdersModal(btn.dataset.id));
            });

            this.renderPagination();
        },

        renderPagination: function () {
            const container = document.getElementById('sup-pagination');
            if (!container) return;
            const totalItems = filteredSuppliers.length;
            const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
            if (totalPages <= 1) { container.innerHTML = ''; return; }

            const start = (currentPage - 1) * PAGE_SIZE + 1;
            const end = Math.min(currentPage * PAGE_SIZE, totalItems);

            let pagesHtml = '';
            const maxV = 5;
            let sp = Math.max(1, currentPage - Math.floor(maxV / 2));
            let ep = Math.min(totalPages, sp + maxV - 1);
            if (ep - sp < maxV - 1) sp = Math.max(1, ep - maxV + 1);

            if (sp > 1) pagesHtml += '<button class="dda-page-btn" data-page="1">1</button>';
            if (sp > 2) pagesHtml += '<span class="dda-page-dots">...</span>';
            for (let p = sp; p <= ep; p++) {
                pagesHtml += '<button class="dda-page-btn' + (p === currentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
            }
            if (ep < totalPages - 1) pagesHtml += '<span class="dda-page-dots">...</span>';
            if (ep < totalPages) pagesHtml += '<button class="dda-page-btn" data-page="' + totalPages + '">' + totalPages + '</button>';

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
                    if (page >= 1 && page <= totalPages) { currentPage = page; this.renderPage(); }
                });
            });
        },

        // ═══════════════════════════════════════════════
        //  MODAL CRUD
        // ═══════════════════════════════════════════════

        openModal: function (supplierId) {
            editingSupplierId = supplierId || null;
            const modal = document.getElementById('sup-modal');
            const title = document.getElementById('sup-modal-title');
            if (!modal) return;

            // Reset form
            ['sup-name', 'sup-contact', 'sup-phone', 'sup-email', 'sup-location', 'sup-notes'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            const catEl = document.getElementById('sup-category');
            if (catEl) catEl.value = '';
            const stEl = document.getElementById('sup-status');
            if (stEl) stEl.value = 'active';

            if (editingSupplierId) {
                title.innerHTML = '<i class="fas fa-pen"></i> Edit Supplier';
                const sup = allSuppliers.find(s => s.id === editingSupplierId);
                if (sup) {
                    document.getElementById('sup-name').value = sup.name || '';
                    document.getElementById('sup-contact').value = sup.contactPerson || '';
                    document.getElementById('sup-phone').value = sup.phone || '';
                    document.getElementById('sup-email').value = sup.email || '';
                    document.getElementById('sup-location').value = sup.location || '';
                    if (catEl) catEl.value = sup.category || '';
                    if (stEl) stEl.value = sup.status || 'active';
                    document.getElementById('sup-notes').value = sup.notes || '';
                }
            } else {
                title.innerHTML = '<i class="fas fa-plus"></i> Add Supplier';
            }

            modal.style.display = 'flex';
        },

        closeModal: function () {
            const modal = document.getElementById('sup-modal');
            if (modal) modal.style.display = 'none';
            editingSupplierId = null;
        },

        save: async function () {
            const name = document.getElementById('sup-name')?.value?.trim();
            if (!name) { this.showToast('Supplier name is required.', 'error'); return; }

            const businessId = this.getBusinessId();
            if (!businessId) { this.showToast('No business assigned.', 'error'); return; }

            const saveBtn = document.getElementById('sup-save');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

            const data = {
                name: name,
                contactPerson: document.getElementById('sup-contact')?.value?.trim() || '',
                phone: document.getElementById('sup-phone')?.value?.trim() || '',
                email: document.getElementById('sup-email')?.value?.trim() || '',
                location: document.getElementById('sup-location')?.value?.trim() || '',
                category: document.getElementById('sup-category')?.value || '',
                status: document.getElementById('sup-status')?.value || 'active',
                notes: document.getElementById('sup-notes')?.value?.trim() || '',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            try {
                if (editingSupplierId) {
                    await getBusinessCollection(businessId, 'suppliers').doc(editingSupplierId).update(data);
                    this.showToast('Supplier updated successfully!');
                } else {
                    data.createdAt = new Date().toISOString();
                    data.createdBy = PharmaFlow.Auth?.userProfile?.displayName || PharmaFlow.Auth?.userProfile?.email || 'Unknown';
                    await getBusinessCollection(businessId, 'suppliers').add(data);
                    this.showToast('Supplier added successfully!');
                }
                this.closeModal();
            } catch (err) {
                console.error('Save supplier error:', err);
                this.showToast('Failed to save supplier: ' + err.message, 'error');
            } finally {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Supplier'; }
            }
        },

        deleteSupplier: async function (supplierId) {
            if (!(await PharmaFlow.confirm('Are you sure you want to delete this supplier?', { title: 'Delete Supplier', confirmText: 'Delete', danger: true }))) return;
            const businessId = this.getBusinessId();
            if (!businessId) return;

            try {
                await getBusinessCollection(businessId, 'suppliers').doc(supplierId).delete();
                this.showToast('Supplier deleted.');
            } catch (err) {
                console.error('Delete supplier error:', err);
                this.showToast('Failed to delete supplier.', 'error');
            }
        },

        viewSupplier: function (sup) {
            const modal = document.getElementById('sup-view-modal');
            const body = document.getElementById('sup-view-body');
            if (!modal || !body) return;

            const statusBadge = (sup.status || 'active') === 'active'
                ? '<span class="dda-stock-badge dda-stock--ok">Active</span>'
                : '<span class="dda-stock-badge dda-stock--out">Inactive</span>';
            const orders = this.getOrdersForSupplier(sup);
            const latestOrder = orders.length ? orders[0] : null;
            const recentOrders = orders.slice(0, 3);
            const totalOrderedValue = orders.reduce((sum, order) => sum + (parseFloat(order.totalAmount) || 0), 0);

            const latestOrderHtml = latestOrder ? `
                <div class="sup-view-latest-order">
                    <div class="sup-view-section-title"><i class="fas fa-receipt"></i> Latest Order</div>
                    <div class="sup-view-order-grid">
                        <div><span>Invoice</span><strong>${this.escapeHtml(latestOrder.orderId || latestOrder.id || '—')}</strong></div>
                        <div><span>Date</span><strong>${this.escapeHtml(latestOrder.orderDate || '—')}</strong></div>
                        <div><span>Status</span><strong>${this.escapeHtml((latestOrder.status || 'pending').replace(/-/g, ' '))}</strong></div>
                        <div><span>Payment</span><strong>${this.escapeHtml(latestOrder.paymentStatus || (latestOrder.paymentMode === 'on-loan' ? 'on-loan' : 'paid'))}</strong></div>
                        <div><span>Total</span><strong>${this.formatCurrency(latestOrder.totalAmount || 0)}</strong></div>
                        <div><span>Outstanding</span><strong>${this.formatCurrency(Math.max((parseFloat(latestOrder.totalAmount) || 0) - (parseFloat(latestOrder.amountPaid) || 0), 0))}</strong></div>
                    </div>
                </div>` : `
                <div class="sup-view-empty-state">
                    <i class="fas fa-inbox"></i>
                    <span>No supplier orders recorded yet</span>
                </div>`;

            const recentOrdersHtml = recentOrders.length ? `
                <div class="sup-view-recent-orders">
                    <div class="sup-view-section-title"><i class="fas fa-clock-rotate-left"></i> Recent Orders</div>
                    <div class="sup-view-recent-list">
                        ${recentOrders.map(order => `
                            <div class="sup-view-recent-item">
                                <div>
                                    <strong>${this.escapeHtml(order.orderId || order.id || '—')}</strong>
                                    <span>${this.escapeHtml(order.orderDate || '—')}</span>
                                </div>
                                <div>
                                    <strong>${this.formatCurrency(order.totalAmount || 0)}</strong>
                                    <span>${this.escapeHtml(order.paymentStatus || (order.paymentMode === 'on-loan' ? 'on-loan' : 'paid'))}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>` : '';

            body.innerHTML = `
                <div class="dda-view-details">
                    <div class="dda-view-row"><span class="dda-view-label">Supplier Name</span><span class="dda-view-value"><strong>${this.escapeHtml(sup.name)}</strong></span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Contact Person</span><span class="dda-view-value">${this.escapeHtml(sup.contactPerson || '—')}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Phone</span><span class="dda-view-value">${this.escapeHtml(sup.phone || '—')}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Email</span><span class="dda-view-value">${this.escapeHtml(sup.email || '—')}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Location</span><span class="dda-view-value">${this.escapeHtml(sup.location || '—')}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Category</span><span class="dda-view-value">${this.escapeHtml(sup.category || '—')}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Status</span><span class="dda-view-value">${statusBadge}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Times Ordered</span><span class="dda-view-value"><strong>${orders.length}</strong></span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Total Ordered Value</span><span class="dda-view-value"><strong>${this.formatCurrency(totalOrderedValue)}</strong></span></div>
                    ${sup.notes ? '<div class="dda-view-row"><span class="dda-view-label">Notes</span><span class="dda-view-value">' + this.escapeHtml(sup.notes) + '</span></div>' : ''}
                    ${sup.createdBy ? '<div class="dda-view-row"><span class="dda-view-label">Added By</span><span class="dda-view-value">' + this.escapeHtml(sup.createdBy) + '</span></div>' : ''}
                </div>
                <div class="sup-view-orders-overview">
                    ${latestOrderHtml}
                    ${recentOrdersHtml}
                </div>
            `;
            modal.style.display = 'flex';
        },

        openSupplierOrdersModal: function (supplierId, fromRefresh) {
            const modal = document.getElementById('sup-orders-modal');
            const tbody = document.getElementById('sup-orders-tbody');
            const summary = document.getElementById('sup-orders-summary');
            const invoiceSearchInput = document.getElementById('sup-orders-invoice-search');
            if (!modal || !tbody || !summary || !invoiceSearchInput) return;

            const supplier = allSuppliers.find(s => s.id === supplierId);
            if (!supplier) return;

            activeSupplierOrdersSupplierId = supplierId;
            const orders = this.getOrdersForSupplier(supplier);
            const paidCount = orders.filter(o => (o.paymentStatus || (o.paymentMode === 'on-loan' ? 'on-loan' : 'paid')) === 'paid').length;
            const loanCount = orders.length - paidCount;

            let totalPaidInFullAmount = 0;
            let totalLoanOutstandingAmount = 0;
            let overdueCount = 0;
            let dueTodayCount = 0;
            let upcomingCount = 0;
            let nextDueDate = null;
            const today = new Date().toISOString().split('T')[0];

            orders.forEach(order => {
                const totalAmount = parseFloat(order.totalAmount) || 0;
                const amountPaid = parseFloat(order.amountPaid) || 0;
                const explicitOutstanding = parseFloat(order.outstandingAmount);
                const outstanding = Number.isFinite(explicitOutstanding) ? explicitOutstanding : Math.max(totalAmount - amountPaid, 0);
                const paymentStatus = order.paymentStatus || (order.paymentMode === 'on-loan' ? 'on-loan' : 'paid');

                if (paymentStatus === 'paid' || outstanding <= 0) {
                    totalPaidInFullAmount += totalAmount;
                } else {
                    totalLoanOutstandingAmount += outstanding;
                    const dueDate = (order.loanDueDate || '').trim();
                    if (dueDate) {
                        if (dueDate < today) {
                            overdueCount++;
                        } else if (dueDate === today) {
                            dueTodayCount++;
                        } else {
                            upcomingCount++;
                            if (!nextDueDate || dueDate < nextDueDate) nextDueDate = dueDate;
                        }
                    }
                }
            });

            summary.innerHTML =
                '<div class="sup-orders-summary-title"><strong>' + this.escapeHtml(supplier.name) + '</strong></div>' +
                '<div class="sup-orders-summary-meta">' +
                '<span><i class="fas fa-receipt"></i> Total Orders: ' + orders.length + '</span>' +
                '<span><i class="fas fa-check-circle"></i> Paid in Full: ' + paidCount + '</span>' +
                '<span><i class="fas fa-hand-holding-dollar"></i> On Loan: ' + loanCount + '</span>' +
                '</div>' +
                '<div class="sup-orders-cards">' +
                '  <div class="sup-orders-card sup-orders-card--loan">' +
                '    <div class="sup-orders-card-label">Loan Outstanding</div>' +
                '    <div class="sup-orders-card-value">' + this.formatCurrency(totalLoanOutstandingAmount) + '</div>' +
                '  </div>' +
                '  <div class="sup-orders-card sup-orders-card--paid">' +
                '    <div class="sup-orders-card-label">Paid In Full Amount</div>' +
                '    <div class="sup-orders-card-value">' + this.formatCurrency(totalPaidInFullAmount) + '</div>' +
                '  </div>' +
                '  <div class="sup-orders-card sup-orders-card--reminder">' +
                '    <div class="sup-orders-card-label">Payment Reminders</div>' +
                '    <div class="sup-orders-card-reminders">Overdue: <strong>' + overdueCount + '</strong> · Due Today: <strong>' + dueTodayCount + '</strong> · Upcoming: <strong>' + upcomingCount + '</strong></div>' +
                '    <div class="sup-orders-card-note">' + (nextDueDate ? ('Next due date: ' + nextDueDate) : 'No upcoming loan due date') + '</div>' +
                '  </div>' +
                '</div>';

            if (invoiceSearchInput.value !== supplierOrdersInvoiceQuery) {
                invoiceSearchInput.value = supplierOrdersInvoiceQuery;
            }

            const filteredOrders = !supplierOrdersInvoiceQuery
                ? orders
                : orders.filter(order => {
                    const invoiceText = String(order.orderId || order.id || '').toLowerCase();
                    return invoiceText.includes(supplierOrdersInvoiceQuery);
                });

            if (orders.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="dda-loading"><i class="fas fa-inbox"></i> No orders found for this supplier</td></tr>';
                if (!fromRefresh) modal.style.display = 'flex';
                return;
            }

            if (filteredOrders.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="dda-loading"><i class="fas fa-search"></i> No invoice matches your search</td></tr>';
                if (!fromRefresh) modal.style.display = 'flex';
                return;
            }

            tbody.innerHTML = filteredOrders.map((order, idx) => {
                const date = order.orderDate || '—';
                return '<tr>' +
                    '<td>' + (idx + 1) + '</td>' +
                    '<td><code class="sales-receipt-code">' + this.escapeHtml(order.orderId || order.id || '') + '</code></td>' +
                    '<td>' + this.escapeHtml(date) + '</td>' +
                    '<td>' + this.getOrderStatusBadge(order.status) + '</td>' +
                    '<td>' + this.getOrderPaymentBadge(order) + '</td>' +
                    '<td><strong>' + this.formatCurrency(order.totalAmount || 0) + '</strong></td>' +
                    '<td><button class="dda-btn dda-btn--export sup-order-print" data-id="' + this.escapeHtml(order.id) + '"><i class="fas fa-print"></i> Print Invoice</button></td>' +
                    '</tr>';
            }).join('');

            tbody.querySelectorAll('.sup-order-print').forEach(btn => {
                btn.addEventListener('click', () => {
                    const order = filteredOrders.find(o => o.id === btn.dataset.id);
                    if (order) this.printSupplierOrderInvoice(order);
                });
            });

            if (!fromRefresh) modal.style.display = 'flex';
        },

        closeSupplierOrdersModal: function () {
            const modal = document.getElementById('sup-orders-modal');
            const invoiceSearchInput = document.getElementById('sup-orders-invoice-search');
            if (modal) modal.style.display = 'none';
            supplierOrdersInvoiceQuery = '';
            if (invoiceSearchInput) invoiceSearchInput.value = '';
            activeSupplierOrdersSupplierId = null;
        },

        printSupplierOrderInvoice: function (order) {
            if (PharmaFlow.MyOrders && typeof PharmaFlow.MyOrders.printInvoice === 'function') {
                PharmaFlow.MyOrders.printInvoice(order);
                return;
            }

            // Fallback lightweight invoice if MyOrders print helper is unavailable
            const win = window.open('', '_blank', 'width=860,height=700');
            if (!win) {
                this.showToast('Unable to open print window.', 'error');
                return;
            }
            const items = (order.items || []).map((item, i) => (
                '<tr>' +
                '<td>' + (i + 1) + '</td>' +
                '<td>' + this.escapeHtml(item.name || '') + '</td>' +
                '<td>' + this.escapeHtml(item.sku || '') + '</td>' +
                '<td style="text-align:center">' + (item.orderQty || 0) + '</td>' +
                '<td style="text-align:right">' + this.formatCurrency(item.unitCost || 0) + '</td>' +
                '<td style="text-align:right"><strong>' + this.formatCurrency(item.lineTotal || 0) + '</strong></td>' +
                '</tr>'
            )).join('');

            const html =
                '<!DOCTYPE html><html><head><title>Invoice - ' + this.escapeHtml(order.orderId || order.id || '') + '</title>' +
                '<style>body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#0f172a}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #e2e8f0;padding:8px;font-size:12px}th{background:#f8fafc;text-align:left}.meta{margin:8px 0 16px;color:#475569;font-size:13px}.total{margin-top:16px;text-align:right;font-size:15px;font-weight:700}.btn{margin-top:18px;padding:9px 14px;background:#2563eb;color:#fff;border:0;border-radius:6px;cursor:pointer}</style>' +
                '</head><body>' +
                '<h2>Purchase Order Invoice</h2>' +
                '<div class="meta">Order: <strong>' + this.escapeHtml(order.orderId || order.id || '') + '</strong> | Date: ' + this.escapeHtml(order.orderDate || '—') + ' | Supplier: ' + this.escapeHtml(order.supplierName || '—') + '</div>' +
                '<table><thead><tr><th>#</th><th>Item</th><th>SKU</th><th>Qty</th><th>Unit Cost</th><th>Total</th></tr></thead><tbody>' + items + '</tbody></table>' +
                '<div class="total">Grand Total: ' + this.formatCurrency(order.totalAmount || 0) + '</div>' +
                '<button class="btn" onclick="window.print()">Print Invoice</button>' +
                '</body></html>';

            win.document.write(html);
            win.document.close();
        },

        // ═══════════════════════════════════════════════
        //  EXPORT
        // ═══════════════════════════════════════════════

        exportPdf: function () {
            const { jsPDF } = window.jspdf;
            if (!jsPDF) { this.showToast('PDF library not loaded.', 'error'); return; }
            const doc = new jsPDF('l', 'mm', 'a4');

            doc.setFontSize(16);
            doc.text('Supplier Directory', 14, 18);
            doc.setFontSize(9);
            doc.text('Generated: ' + new Date().toLocaleString('en-KE'), 14, 24);
            doc.text('Total Suppliers: ' + filteredSuppliers.length, 14, 29);

            const rows = filteredSuppliers.map((s, i) => [
                i + 1, s.name || '', s.contactPerson || '', s.phone || '', s.email || '', s.location || '', s.category || '', (s.status || 'active')
            ]);

            doc.autoTable({
                startY: 34,
                head: [['#', 'Supplier Name', 'Contact', 'Phone', 'Email', 'Location', 'Category', 'Status']],
                body: rows,
                styles: { fontSize: 8, cellPadding: 2 },
                headStyles: { fillColor: [79, 70, 229], textColor: 255 }
            });

            doc.save('Suppliers_' + new Date().toISOString().split('T')[0] + '.pdf');
            this.showToast('PDF exported!');
        },

        // ═══════════════════════════════════════════════
        //  PUBLIC: Get suppliers list (used by Orders)
        // ═══════════════════════════════════════════════

        getSuppliers: function () {
            return allSuppliers;
        },

        fetchSuppliers: async function (businessId) {
            const snap = await getBusinessCollection(businessId, 'suppliers').where('status', '==', 'active').get();
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
    };

    window.PharmaFlow.Supplier = Supplier;
})();
