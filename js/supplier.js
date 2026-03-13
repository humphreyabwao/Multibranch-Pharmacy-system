/**
 * PharmaFlow - Supplier Module
 * Full CRUD for managing suppliers.
 * Single-page module (no sub-modules) — renders a table with Add/Edit/Delete.
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let supplierListener = null;
    let allSuppliers = [];
    let filteredSuppliers = [];
    let currentPage = 1;
    const PAGE_SIZE = 25;
    let editingSupplierId = null;

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
            allSuppliers = [];
            filteredSuppliers = [];
            editingSupplierId = null;
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
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="sup-tbody">
                                <tr><td colspan="9" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading suppliers...</td></tr>
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

            supplierListener = getBusinessCollection(businessId, 'suppliers')
                .onSnapshot(snap => {
                    allSuppliers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    allSuppliers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                    this.updateStats();
                    this.filter();
                }, err => {
                    console.error('Supplier subscribe error:', err);
                    const tbody = document.getElementById('sup-tbody');
                    if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="dda-loading"><i class="fas fa-exclamation-circle"></i> Failed to load suppliers</td></tr>';
                });
        },

        updateStats: function () {
            const el = id => document.getElementById(id);
            if (el('sup-total')) el('sup-total').textContent = allSuppliers.length;
            if (el('sup-active')) el('sup-active').textContent = allSuppliers.filter(s => s.status !== 'inactive').length;
            if (el('sup-inactive')) el('sup-inactive').textContent = allSuppliers.filter(s => s.status === 'inactive').length;
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
                tbody.innerHTML = '<tr><td colspan="9" class="dda-loading"><i class="fas fa-inbox"></i> No suppliers found</td></tr>';
                this.renderPagination();
                return;
            }

            tbody.innerHTML = pageData.map((s, i) => {
                const st = s.status || 'active';
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

            body.innerHTML = `
                <div class="dda-view-details">
                    <div class="dda-view-row"><span class="dda-view-label">Supplier Name</span><span class="dda-view-value"><strong>${this.escapeHtml(sup.name)}</strong></span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Contact Person</span><span class="dda-view-value">${this.escapeHtml(sup.contactPerson || '—')}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Phone</span><span class="dda-view-value">${this.escapeHtml(sup.phone || '—')}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Email</span><span class="dda-view-value">${this.escapeHtml(sup.email || '—')}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Location</span><span class="dda-view-value">${this.escapeHtml(sup.location || '—')}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Category</span><span class="dda-view-value">${this.escapeHtml(sup.category || '—')}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Status</span><span class="dda-view-value">${statusBadge}</span></div>
                    ${sup.notes ? '<div class="dda-view-row"><span class="dda-view-label">Notes</span><span class="dda-view-value">' + this.escapeHtml(sup.notes) + '</span></div>' : ''}
                    ${sup.createdBy ? '<div class="dda-view-row"><span class="dda-view-label">Added By</span><span class="dda-view-value">' + this.escapeHtml(sup.createdBy) + '</span></div>' : ''}
                </div>
            `;
            modal.style.display = 'flex';
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
