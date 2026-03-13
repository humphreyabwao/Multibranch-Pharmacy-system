/**
 * PharmaFlow - Prescription Module
 * Create, manage, preview and print prescriptions.
 * Features:
 *   - Search drugs from inventory or add manually
 *   - Multiple drugs per prescription
 *   - Doctor details & patient info
 *   - Print-friendly prescription preview
 *   - Save to Firestore with real-time list
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let unsubPrescriptions = null;
    let unsubInventory = null;
    let inventoryCache = [];
    let allPrescriptions = [];
    let filteredPrescriptions = [];
    let currentPage = 1;
    const PAGE_SIZE = 20;

    // Current prescription being built
    let rxDrugs = [];
    let editingId = null;

    const Prescription = {

        // ═══════════════════════════════════════════════════
        //  HELPERS
        // ═══════════════════════════════════════════════════

        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        formatCurrency: function (amount) {
            const currency = PharmaFlow.Settings && PharmaFlow.Settings.getCurrency
                ? PharmaFlow.Settings.getCurrency() : 'KSH';
            return currency + ' ' + new Intl.NumberFormat('en-KE', {
                minimumFractionDigits: 2, maximumFractionDigits: 2
            }).format(amount || 0);
        },

        formatDate: function (ts) {
            if (!ts) return '—';
            const d = ts.toDate ? ts.toDate() : new Date(ts);
            return d.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
        },

        formatDateTime: function (ts) {
            if (!ts) return '—';
            const d = ts.toDate ? ts.toDate() : new Date(ts);
            return d.toLocaleDateString('en-KE', {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        },

        escapeHtml: function (str) {
            const d = document.createElement('div');
            d.textContent = str || '';
            return d.innerHTML;
        },

        showToast: function (msg, type) {
            const old = document.querySelector('.rx-toast');
            if (old) old.remove();
            const t = document.createElement('div');
            t.className = 'rx-toast rx-toast--' + (type || 'success');
            t.innerHTML = '<i class="fas fa-' + (type === 'error' ? 'exclamation-circle' : 'check-circle') + '"></i> ' + msg;
            document.body.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
        },

        generateRxId: function () {
            const now = new Date();
            const y = now.getFullYear().toString().slice(-2);
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
            return 'RX-' + y + m + d + '-' + rand;
        },

        cleanup: function () {
            if (unsubPrescriptions) { unsubPrescriptions(); unsubPrescriptions = null; }
            if (unsubInventory) { unsubInventory(); unsubInventory = null; }
            inventoryCache = [];
            allPrescriptions = [];
            filteredPrescriptions = [];
            rxDrugs = [];
            editingId = null;
            currentPage = 1;
        },

        // ═══════════════════════════════════════════════════
        //  MAIN RENDER
        // ═══════════════════════════════════════════════════

        render: function (container) {
            this.cleanup();
            const bizId = this.getBusinessId();

            container.innerHTML = `
                <div class="rx-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-prescription"></i> Prescriptions</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Pharmacy</span><span>/</span>
                                <span>Prescriptions</span>
                            </div>
                        </div>
                        <button class="rx-btn rx-btn--primary" id="rx-new-btn">
                            <i class="fas fa-plus-circle"></i> New Prescription
                        </button>
                    </div>

                    <!-- Stats -->
                    <div class="rx-stats" id="rx-stats">
                        <div class="rx-stat-card">
                            <div class="rx-stat-icon"><i class="fas fa-file-prescription"></i></div>
                            <div class="rx-stat-info">
                                <span class="rx-stat-value" id="rx-total">0</span>
                                <span class="rx-stat-label">Total Prescriptions</span>
                            </div>
                        </div>
                        <div class="rx-stat-card">
                            <div class="rx-stat-icon rx-stat-icon--info"><i class="fas fa-clock"></i></div>
                            <div class="rx-stat-info">
                                <span class="rx-stat-value" id="rx-today">0</span>
                                <span class="rx-stat-label">Today</span>
                            </div>
                        </div>
                        <div class="rx-stat-card">
                            <div class="rx-stat-icon rx-stat-icon--success"><i class="fas fa-check-circle"></i></div>
                            <div class="rx-stat-info">
                                <span class="rx-stat-value" id="rx-dispensed">0</span>
                                <span class="rx-stat-label">Dispensed</span>
                            </div>
                        </div>
                        <div class="rx-stat-card">
                            <div class="rx-stat-icon rx-stat-icon--warn"><i class="fas fa-hourglass-half"></i></div>
                            <div class="rx-stat-info">
                                <span class="rx-stat-value" id="rx-pending">0</span>
                                <span class="rx-stat-label">Pending</span>
                            </div>
                        </div>
                    </div>

                    <!-- Toolbar -->
                    <div class="rx-toolbar">
                        <div class="rx-search-box">
                            <i class="fas fa-search"></i>
                            <input type="text" id="rx-search" placeholder="Search by patient, doctor, Rx ID...">
                        </div>
                        <div class="rx-filter-group">
                            <select id="rx-filter-status">
                                <option value="">All Status</option>
                                <option value="pending">Pending</option>
                                <option value="dispensed">Dispensed</option>
                                <option value="cancelled">Cancelled</option>
                            </select>
                        </div>
                    </div>

                    <!-- Prescriptions Table -->
                    <div class="rx-table-wrap">
                        <table class="rx-table">
                            <thead>
                                <tr>
                                    <th>Rx ID</th>
                                    <th>Date</th>
                                    <th>Patient</th>
                                    <th>Doctor</th>
                                    <th>Items</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="rx-tbody">
                                <tr><td colspan="7" class="rx-loading"><i class="fas fa-spinner fa-spin"></i> Loading prescriptions...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="rx-pagination" id="rx-pagination"></div>
                </div>
            `;

            // Bind events
            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });

            document.getElementById('rx-new-btn').addEventListener('click', () => this.openPrescriptionForm());
            document.getElementById('rx-search').addEventListener('input', () => { currentPage = 1; this.filterPrescriptions(); });
            document.getElementById('rx-filter-status').addEventListener('change', () => { currentPage = 1; this.filterPrescriptions(); });

            // Subscribe to data
            this.subscribePrescriptions(bizId);
            this.subscribeInventory(bizId);
        },

        // ═══════════════════════════════════════════════════
        //  DATA SUBSCRIPTIONS
        // ═══════════════════════════════════════════════════

        subscribePrescriptions: function (bizId) {
            if (!bizId || !window.db) return;
            if (unsubPrescriptions) unsubPrescriptions();

            unsubPrescriptions = window.db.collection('businesses').doc(bizId)
                .collection('prescriptions')
                .orderBy('createdAt', 'desc')
                .onSnapshot(snap => {
                    allPrescriptions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    this.updateStats();
                    this.filterPrescriptions();
                }, err => {
                    console.error('Prescriptions listener error:', err);
                });
        },

        subscribeInventory: function (bizId) {
            if (!bizId || !window.db) return;
            if (unsubInventory) unsubInventory();

            unsubInventory = window.db.collection('businesses').doc(bizId)
                .collection('inventory')
                .onSnapshot(snap => {
                    inventoryCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                }, err => {
                    console.error('Inventory listener error:', err);
                });
        },

        updateStats: function () {
            const total = allPrescriptions.length;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayCount = allPrescriptions.filter(rx => {
                const d = rx.createdAt ? (rx.createdAt.toDate ? rx.createdAt.toDate() : new Date(rx.createdAt)) : null;
                return d && d >= today;
            }).length;
            const dispensed = allPrescriptions.filter(rx => rx.status === 'dispensed').length;
            const pending = allPrescriptions.filter(rx => rx.status === 'pending').length;

            const el = id => document.getElementById(id);
            if (el('rx-total')) el('rx-total').textContent = total;
            if (el('rx-today')) el('rx-today').textContent = todayCount;
            if (el('rx-dispensed')) el('rx-dispensed').textContent = dispensed;
            if (el('rx-pending')) el('rx-pending').textContent = pending;
        },

        filterPrescriptions: function () {
            const search = (document.getElementById('rx-search')?.value || '').toLowerCase().trim();
            const statusFilter = document.getElementById('rx-filter-status')?.value || '';

            filteredPrescriptions = allPrescriptions.filter(rx => {
                if (statusFilter && rx.status !== statusFilter) return false;
                if (search) {
                    const haystack = [
                        rx.rxId, rx.patientName, rx.doctorName, rx.diagnosis
                    ].filter(Boolean).join(' ').toLowerCase();
                    if (!haystack.includes(search)) return false;
                }
                return true;
            });

            this.renderTable();
        },

        renderTable: function () {
            const tbody = document.getElementById('rx-tbody');
            if (!tbody) return;

            if (filteredPrescriptions.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="rx-empty"><i class="fas fa-inbox"></i> No prescriptions found</td></tr>';
                this.renderPagination(0);
                return;
            }

            const totalPages = Math.ceil(filteredPrescriptions.length / PAGE_SIZE);
            if (currentPage > totalPages) currentPage = totalPages;
            const start = (currentPage - 1) * PAGE_SIZE;
            const page = filteredPrescriptions.slice(start, start + PAGE_SIZE);

            tbody.innerHTML = page.map(rx => {
                const statusClass = rx.status === 'dispensed' ? 'rx-status--dispensed' :
                    rx.status === 'cancelled' ? 'rx-status--cancelled' : 'rx-status--pending';
                const drugCount = (rx.drugs || []).length;
                return `<tr>
                    <td><strong>${this.escapeHtml(rx.rxId || '—')}</strong></td>
                    <td>${this.formatDateTime(rx.createdAt)}</td>
                    <td>${this.escapeHtml(rx.patientName || '—')}</td>
                    <td>${this.escapeHtml(rx.doctorName || '—')}</td>
                    <td><span class="rx-drug-count">${drugCount} drug${drugCount !== 1 ? 's' : ''}</span></td>
                    <td><span class="rx-status-badge ${statusClass}">${(rx.status || 'pending').toUpperCase()}</span></td>
                    <td class="rx-actions-cell">
                        <button class="rx-icon-btn" title="View/Print" data-action="view" data-id="${rx.id}"><i class="fas fa-eye"></i></button>
                        <button class="rx-icon-btn" title="Edit" data-action="edit" data-id="${rx.id}"><i class="fas fa-edit"></i></button>
                        ${rx.status === 'pending' ? `<button class="rx-icon-btn rx-icon-btn--success" title="Mark Dispensed" data-action="dispense" data-id="${rx.id}"><i class="fas fa-check"></i></button>` : ''}
                        <button class="rx-icon-btn rx-icon-btn--danger" title="Delete" data-action="delete" data-id="${rx.id}"><i class="fas fa-trash-alt"></i></button>
                    </td>
                </tr>`;
            }).join('');

            // Bind action buttons
            tbody.querySelectorAll('.rx-icon-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const action = btn.dataset.action;
                    const id = btn.dataset.id;
                    if (action === 'view') this.viewPrescription(id);
                    else if (action === 'edit') this.editPrescription(id);
                    else if (action === 'dispense') this.dispensePrescription(id);
                    else if (action === 'delete') this.deletePrescription(id);
                });
            });

            this.renderPagination(totalPages);
        },

        renderPagination: function (totalPages) {
            const container = document.getElementById('rx-pagination');
            if (!container) return;
            if (totalPages <= 1) { container.innerHTML = ''; return; }

            let html = '';
            html += `<button class="rx-page-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>`;
            for (let i = 1; i <= totalPages; i++) {
                if (totalPages > 7 && i > 2 && i < totalPages - 1 && Math.abs(i - currentPage) > 1) {
                    if (i === 3 || i === totalPages - 2) html += '<span class="rx-page-dots">...</span>';
                    continue;
                }
                html += `<button class="rx-page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
            }
            html += `<button class="rx-page-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
            container.innerHTML = html;

            container.querySelectorAll('.rx-page-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const page = parseInt(btn.dataset.page);
                    if (page >= 1 && page <= totalPages) { currentPage = page; this.renderTable(); }
                });
            });
        },

        // ═══════════════════════════════════════════════════
        //  PRESCRIPTION FORM (CREATE / EDIT)
        // ═══════════════════════════════════════════════════

        openPrescriptionForm: function (existingRx) {
            const isEdit = !!existingRx;
            editingId = isEdit ? existingRx.id : null;
            rxDrugs = isEdit ? [...(existingRx.drugs || [])] : [];

            const user = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : {};
            const bizName = PharmaFlow.Settings && PharmaFlow.Settings.getBusinessName
                ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow';

            // Pre-fill doctor details from profile if creating new
            const doctorName = isEdit ? (existingRx.doctorName || '') : (user.displayName || '');
            const doctorLicense = isEdit ? (existingRx.doctorLicense || '') : '';
            const doctorPhone = isEdit ? (existingRx.doctorPhone || '') : (user.phone || '');

            // Create modal overlay
            const overlay = document.createElement('div');
            overlay.className = 'rx-modal-overlay';
            overlay.id = 'rx-form-modal';
            overlay.innerHTML = `
                <div class="rx-modal rx-modal--large">
                    <div class="rx-modal-header">
                        <h3><i class="fas fa-${isEdit ? 'edit' : 'plus-circle'}"></i> ${isEdit ? 'Edit' : 'New'} Prescription</h3>
                        <button class="rx-modal-close" id="rx-form-close">&times;</button>
                    </div>
                    <div class="rx-modal-body">
                        <div class="rx-form-grid">
                            <!-- Left column: Details -->
                            <div class="rx-form-col">
                                <h4 class="rx-form-section-title"><i class="fas fa-user-injured"></i> Patient Information</h4>
                                <div class="rx-form-row">
                                    <div class="rx-form-group">
                                        <label>Patient Name <span class="required">*</span></label>
                                        <input type="text" id="rx-patient-name" value="${this.escapeHtml(isEdit ? existingRx.patientName : '')}" placeholder="Full name" required>
                                    </div>
                                    <div class="rx-form-group">
                                        <label>Age</label>
                                        <input type="text" id="rx-patient-age" value="${this.escapeHtml(isEdit ? (existingRx.patientAge || '') : '')}" placeholder="e.g., 35 years">
                                    </div>
                                </div>
                                <div class="rx-form-row">
                                    <div class="rx-form-group">
                                        <label>Gender</label>
                                        <select id="rx-patient-gender">
                                            <option value="">Select</option>
                                            <option value="Male" ${isEdit && existingRx.patientGender === 'Male' ? 'selected' : ''}>Male</option>
                                            <option value="Female" ${isEdit && existingRx.patientGender === 'Female' ? 'selected' : ''}>Female</option>
                                            <option value="Other" ${isEdit && existingRx.patientGender === 'Other' ? 'selected' : ''}>Other</option>
                                        </select>
                                    </div>
                                    <div class="rx-form-group">
                                        <label>Phone</label>
                                        <input type="tel" id="rx-patient-phone" value="${this.escapeHtml(isEdit ? (existingRx.patientPhone || '') : '')}" placeholder="+254 7XX XXX XXX">
                                    </div>
                                </div>
                                <div class="rx-form-group">
                                    <label>Diagnosis / Notes</label>
                                    <textarea id="rx-diagnosis" rows="2" placeholder="Diagnosis or clinical notes...">${this.escapeHtml(isEdit ? (existingRx.diagnosis || '') : '')}</textarea>
                                </div>

                                <hr class="rx-divider">

                                <h4 class="rx-form-section-title"><i class="fas fa-user-md"></i> Doctor / Prescriber</h4>
                                <div class="rx-form-row">
                                    <div class="rx-form-group">
                                        <label>Doctor Name <span class="required">*</span></label>
                                        <input type="text" id="rx-doctor-name" value="${this.escapeHtml(doctorName)}" placeholder="Dr. Full Name" required>
                                    </div>
                                    <div class="rx-form-group">
                                        <label>License / Reg. No.</label>
                                        <input type="text" id="rx-doctor-license" value="${this.escapeHtml(doctorLicense)}" placeholder="e.g., MED/2024/001">
                                    </div>
                                </div>
                                <div class="rx-form-row">
                                    <div class="rx-form-group">
                                        <label>Phone / Contact</label>
                                        <input type="tel" id="rx-doctor-phone" value="${this.escapeHtml(doctorPhone)}" placeholder="+254 7XX XXX XXX">
                                    </div>
                                    <div class="rx-form-group">
                                        <label>Specialty</label>
                                        <input type="text" id="rx-doctor-specialty" value="${this.escapeHtml(isEdit ? (existingRx.doctorSpecialty || '') : '')}" placeholder="e.g., General Practitioner">
                                    </div>
                                </div>
                            </div>

                            <!-- Right column: Drugs -->
                            <div class="rx-form-col">
                                <h4 class="rx-form-section-title"><i class="fas fa-pills"></i> Prescribed Drugs</h4>

                                <!-- Drug Search -->
                                <div class="rx-drug-search-wrap">
                                    <div class="rx-drug-search-bar">
                                        <i class="fas fa-search"></i>
                                        <input type="text" id="rx-drug-search" placeholder="Search inventory by drug name..." autocomplete="off">
                                    </div>
                                    <div class="rx-drug-results" id="rx-drug-results"></div>
                                </div>

                                <button class="rx-btn rx-btn--outline rx-btn--sm" id="rx-add-manual-btn" type="button">
                                    <i class="fas fa-plus"></i> Add Drug Manually
                                </button>

                                <!-- Drugs list -->
                                <div class="rx-drugs-list" id="rx-drugs-list">
                                    ${rxDrugs.length === 0 ? '<div class="rx-drugs-empty"><i class="fas fa-pills"></i><p>No drugs added yet. Search or add manually.</p></div>' : ''}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="rx-modal-footer">
                        <button class="rx-btn rx-btn--cancel" id="rx-form-cancel">Cancel</button>
                        <button class="rx-btn rx-btn--secondary" id="rx-preview-btn"><i class="fas fa-eye"></i> Preview</button>
                        <button class="rx-btn rx-btn--primary" id="rx-save-btn"><i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Save'} Prescription</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);
            setTimeout(() => overlay.classList.add('open'), 10);

            // Bind events
            document.getElementById('rx-form-close').addEventListener('click', () => this.closeModal('rx-form-modal'));
            document.getElementById('rx-form-cancel').addEventListener('click', () => this.closeModal('rx-form-modal'));
            document.getElementById('rx-save-btn').addEventListener('click', () => this.savePrescription());
            document.getElementById('rx-preview-btn').addEventListener('click', () => this.previewPrescription());
            document.getElementById('rx-add-manual-btn').addEventListener('click', () => this.addManualDrug());

            // Drug search
            const searchInput = document.getElementById('rx-drug-search');
            let searchTimeout = null;
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => this.searchDrugs(searchInput.value), 200);
            });

            // Close results when clicking outside
            overlay.addEventListener('click', (e) => {
                if (!e.target.closest('.rx-drug-search-wrap')) {
                    document.getElementById('rx-drug-results').innerHTML = '';
                }
            });

            // Render existing drugs if editing
            if (isEdit && rxDrugs.length > 0) this.renderDrugsList();
        },

        closeModal: function (id) {
            const modal = document.getElementById(id);
            if (modal) {
                modal.classList.remove('open');
                setTimeout(() => modal.remove(), 200);
            }
        },

        // ─── DRUG SEARCH ─────────────────────────────────
        searchDrugs: function (query) {
            const resultsEl = document.getElementById('rx-drug-results');
            if (!resultsEl) return;

            query = (query || '').trim().toLowerCase();
            if (query.length < 2) { resultsEl.innerHTML = ''; return; }

            const matches = inventoryCache.filter(item => {
                const haystack = [item.name, item.sku, item.category, item.manufacturer, item.dosage]
                    .filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(query);
            }).slice(0, 10);

            if (matches.length === 0) {
                resultsEl.innerHTML = '<div class="rx-drug-no-result">No inventory matches. Use "Add Drug Manually".</div>';
                return;
            }

            resultsEl.innerHTML = matches.map(item => `
                <div class="rx-drug-result-item" data-id="${item.id}">
                    <div class="rx-drug-result-info">
                        <strong>${this.escapeHtml(item.name)}</strong>
                        <small>${this.escapeHtml(item.category || '')} ${item.dosage ? '• ' + this.escapeHtml(item.dosage) : ''} ${item.manufacturer ? '• ' + this.escapeHtml(item.manufacturer) : ''}</small>
                    </div>
                    <div class="rx-drug-result-meta">
                        <span class="rx-drug-stock ${(item.quantity || 0) <= 0 ? 'rx-drug-stock--out' : ''}">${item.quantity || 0} in stock</span>
                        <span>${this.formatCurrency(item.sellingPrice || item.unitPrice || 0)}</span>
                    </div>
                </div>
            `).join('');

            resultsEl.querySelectorAll('.rx-drug-result-item').forEach(el => {
                el.addEventListener('click', () => {
                    const itemId = el.dataset.id;
                    const item = inventoryCache.find(i => i.id === itemId);
                    if (item) this.addDrugFromInventory(item);
                    resultsEl.innerHTML = '';
                    document.getElementById('rx-drug-search').value = '';
                });
            });
        },

        addDrugFromInventory: function (item) {
            // Check duplicate
            if (rxDrugs.find(d => d.inventoryId === item.id)) {
                this.showToast('Drug already added to prescription', 'error');
                return;
            }

            rxDrugs.push({
                inventoryId: item.id,
                name: item.name || '',
                category: item.category || '',
                dosage: item.dosage || '',
                drugType: item.drugType || '',
                unitPrice: item.sellingPrice || item.unitPrice || 0,
                quantity: 1,
                frequency: '',
                duration: '',
                instructions: '',
                fromInventory: true
            });

            this.renderDrugsList();
        },

        addManualDrug: function () {
            rxDrugs.push({
                inventoryId: null,
                name: '',
                dosage: '',
                drugType: '',
                category: '',
                unitPrice: 0,
                quantity: 1,
                frequency: '',
                duration: '',
                instructions: '',
                fromInventory: false
            });
            this.renderDrugsList();
        },

        removeDrug: function (index) {
            rxDrugs.splice(index, 1);
            this.renderDrugsList();
        },

        renderDrugsList: function () {
            const container = document.getElementById('rx-drugs-list');
            if (!container) return;

            if (rxDrugs.length === 0) {
                container.innerHTML = '<div class="rx-drugs-empty"><i class="fas fa-pills"></i><p>No drugs added yet. Search or add manually.</p></div>';
                return;
            }

            container.innerHTML = rxDrugs.map((drug, idx) => `
                <div class="rx-drug-card" data-index="${idx}">
                    <div class="rx-drug-card-header">
                        <span class="rx-drug-num">#${idx + 1}</span>
                        ${drug.fromInventory ? '<span class="rx-drug-badge rx-drug-badge--inv"><i class="fas fa-warehouse"></i> Inventory</span>' : '<span class="rx-drug-badge rx-drug-badge--manual"><i class="fas fa-pen"></i> Manual</span>'}
                        <button class="rx-drug-remove" data-index="${idx}" title="Remove"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="rx-drug-card-body">
                        <div class="rx-drug-row">
                            <div class="rx-form-group">
                                <label>Drug Name <span class="required">*</span></label>
                                <input type="text" class="rx-drug-field" data-index="${idx}" data-field="name" value="${this.escapeHtml(drug.name)}" placeholder="Drug name" ${drug.fromInventory ? 'readonly' : ''}>
                            </div>
                            <div class="rx-form-group">
                                <label>Dosage / Strength</label>
                                <input type="text" class="rx-drug-field" data-index="${idx}" data-field="dosage" value="${this.escapeHtml(drug.dosage)}" placeholder="e.g., 500mg">
                            </div>
                        </div>
                        <div class="rx-drug-row">
                            <div class="rx-form-group">
                                <label>Quantity</label>
                                <input type="number" class="rx-drug-field" data-index="${idx}" data-field="quantity" value="${drug.quantity}" min="1" placeholder="Qty">
                            </div>
                            <div class="rx-form-group">
                                <label>Frequency</label>
                                <input type="text" class="rx-drug-field" data-index="${idx}" data-field="frequency" value="${this.escapeHtml(drug.frequency)}" placeholder="e.g., 3x daily">
                            </div>
                        </div>
                        <div class="rx-drug-row">
                            <div class="rx-form-group">
                                <label>Duration</label>
                                <input type="text" class="rx-drug-field" data-index="${idx}" data-field="duration" value="${this.escapeHtml(drug.duration)}" placeholder="e.g., 7 days">
                            </div>
                            <div class="rx-form-group">
                                <label>Instructions</label>
                                <input type="text" class="rx-drug-field" data-index="${idx}" data-field="instructions" value="${this.escapeHtml(drug.instructions)}" placeholder="e.g., After meals">
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');

            // Bind field changes
            container.querySelectorAll('.rx-drug-field').forEach(input => {
                input.addEventListener('change', () => {
                    const i = parseInt(input.dataset.index);
                    const field = input.dataset.field;
                    if (field === 'quantity') {
                        rxDrugs[i][field] = parseInt(input.value) || 1;
                    } else {
                        rxDrugs[i][field] = input.value;
                    }
                });
                // Also sync on input for text fields
                if (input.type !== 'number') {
                    input.addEventListener('input', () => {
                        const i = parseInt(input.dataset.index);
                        rxDrugs[i][input.dataset.field] = input.value;
                    });
                }
            });

            // Bind remove buttons
            container.querySelectorAll('.rx-drug-remove').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.removeDrug(parseInt(btn.dataset.index));
                });
            });
        },

        // ═══════════════════════════════════════════════════
        //  SAVE PRESCRIPTION
        // ═══════════════════════════════════════════════════

        savePrescription: async function () {
            const patientName = document.getElementById('rx-patient-name')?.value?.trim();
            const doctorName = document.getElementById('rx-doctor-name')?.value?.trim();

            if (!patientName) { this.showToast('Patient name is required', 'error'); return; }
            if (!doctorName) { this.showToast('Doctor name is required', 'error'); return; }
            if (rxDrugs.length === 0) { this.showToast('Add at least one drug', 'error'); return; }

            // Validate all drugs have names
            for (let i = 0; i < rxDrugs.length; i++) {
                if (!rxDrugs[i].name.trim()) {
                    this.showToast('Drug #' + (i + 1) + ' needs a name', 'error');
                    return;
                }
            }

            const bizId = this.getBusinessId();
            if (!bizId) { this.showToast('No business ID', 'error'); return; }

            const saveBtn = document.getElementById('rx-save-btn');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

            try {
                const data = {
                    rxId: editingId ? (allPrescriptions.find(r => r.id === editingId)?.rxId || this.generateRxId()) : this.generateRxId(),
                    patientName: patientName,
                    patientAge: document.getElementById('rx-patient-age')?.value?.trim() || '',
                    patientGender: document.getElementById('rx-patient-gender')?.value || '',
                    patientPhone: document.getElementById('rx-patient-phone')?.value?.trim() || '',
                    diagnosis: document.getElementById('rx-diagnosis')?.value?.trim() || '',
                    doctorName: doctorName,
                    doctorLicense: document.getElementById('rx-doctor-license')?.value?.trim() || '',
                    doctorPhone: document.getElementById('rx-doctor-phone')?.value?.trim() || '',
                    doctorSpecialty: document.getElementById('rx-doctor-specialty')?.value?.trim() || '',
                    drugs: rxDrugs.map(d => ({
                        inventoryId: d.inventoryId || null,
                        name: d.name,
                        dosage: d.dosage || '',
                        drugType: d.drugType || '',
                        category: d.category || '',
                        unitPrice: d.unitPrice || 0,
                        quantity: d.quantity || 1,
                        frequency: d.frequency || '',
                        duration: d.duration || '',
                        instructions: d.instructions || '',
                        fromInventory: !!d.fromInventory
                    })),
                    status: 'pending',
                    businessId: bizId,
                    createdBy: PharmaFlow.Auth?.currentUser?.uid || '',
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                const ref = window.db.collection('businesses').doc(bizId).collection('prescriptions');

                if (editingId) {
                    await ref.doc(editingId).update(data);
                    this.showToast('Prescription updated', 'success');
                } else {
                    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                    await ref.add(data);
                    this.showToast('Prescription saved', 'success');
                }

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: editingId ? 'Prescription Updated' : 'Prescription Created',
                        description: data.rxId + ' for ' + patientName + ' by Dr. ' + doctorName,
                        category: 'Pharmacy',
                        status: 'COMPLETED'
                    });
                }

                this.closeModal('rx-form-modal');
            } catch (err) {
                console.error('Save prescription error:', err);
                this.showToast('Failed to save: ' + (err.message || 'Unknown error'), 'error');
            } finally {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Prescription'; }
            }
        },

        // ═══════════════════════════════════════════════════
        //  VIEW / EDIT / DISPENSE / DELETE
        // ═══════════════════════════════════════════════════

        editPrescription: function (id) {
            const rx = allPrescriptions.find(r => r.id === id);
            if (!rx) return;
            this.openPrescriptionForm(rx);
        },

        deletePrescription: async function (id) {
            if (!(await PharmaFlow.confirm('Delete this prescription? This cannot be undone.', { title: 'Delete Prescription', confirmText: 'Delete', danger: true }))) return;
            const bizId = this.getBusinessId();
            if (!bizId) return;

            try {
                await window.db.collection('businesses').doc(bizId).collection('prescriptions').doc(id).delete();
                this.showToast('Prescription deleted', 'success');
            } catch (err) {
                this.showToast('Delete failed: ' + (err.message || ''), 'error');
            }
        },

        dispensePrescription: async function (id) {
            if (!(await PharmaFlow.confirm('Mark this prescription as dispensed?', { title: 'Dispense Prescription', confirmText: 'Yes, Dispensed' }))) return;
            const bizId = this.getBusinessId();
            if (!bizId) return;

            try {
                await window.db.collection('businesses').doc(bizId).collection('prescriptions').doc(id).update({
                    status: 'dispensed',
                    dispensedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    dispensedBy: PharmaFlow.Auth?.currentUser?.uid || ''
                });
                this.showToast('Prescription marked as dispensed', 'success');
            } catch (err) {
                this.showToast('Update failed: ' + (err.message || ''), 'error');
            }
        },

        // ═══════════════════════════════════════════════════
        //  PREVIEW & PRINT
        // ═══════════════════════════════════════════════════

        viewPrescription: function (id) {
            const rx = allPrescriptions.find(r => r.id === id);
            if (!rx) return;
            this.showPreviewModal(rx);
        },

        previewPrescription: function () {
            // Build preview from current form
            const rx = {
                rxId: editingId ? (allPrescriptions.find(r => r.id === editingId)?.rxId || 'PREVIEW') : 'PREVIEW',
                patientName: document.getElementById('rx-patient-name')?.value?.trim() || '',
                patientAge: document.getElementById('rx-patient-age')?.value?.trim() || '',
                patientGender: document.getElementById('rx-patient-gender')?.value || '',
                patientPhone: document.getElementById('rx-patient-phone')?.value?.trim() || '',
                diagnosis: document.getElementById('rx-diagnosis')?.value?.trim() || '',
                doctorName: document.getElementById('rx-doctor-name')?.value?.trim() || '',
                doctorLicense: document.getElementById('rx-doctor-license')?.value?.trim() || '',
                doctorPhone: document.getElementById('rx-doctor-phone')?.value?.trim() || '',
                doctorSpecialty: document.getElementById('rx-doctor-specialty')?.value?.trim() || '',
                drugs: rxDrugs,
                status: 'pending',
                createdAt: new Date()
            };
            this.showPreviewModal(rx, true);
        },

        showPreviewModal: function (rx, isPreview) {
            const bizName = PharmaFlow.Settings && PharmaFlow.Settings.getBusinessName
                ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow';
            const bizAddress = PharmaFlow.Settings && PharmaFlow.Settings.getBusinessAddress
                ? PharmaFlow.Settings.getBusinessAddress() : '';
            const bizPhone = PharmaFlow.Settings && PharmaFlow.Settings.getBusinessPhone
                ? PharmaFlow.Settings.getBusinessPhone() : '';

            const dateStr = this.formatDateTime(rx.createdAt);

            const drugItems = (rx.drugs || []).map((d, i) => {
                let details = [];
                if (d.dosage) details.push(this.escapeHtml(d.dosage));
                if (d.frequency) details.push(this.escapeHtml(d.frequency));
                if (d.duration) details.push(this.escapeHtml(d.duration));
                const instrLine = d.instructions ? '<div class="rr-drug-note">' + this.escapeHtml(d.instructions) + '</div>' : '';
                return `
                    <div class="rr-drug-item">
                        <div class="rr-drug-main">
                            <span class="rr-drug-name">${i + 1}. ${this.escapeHtml(d.name)}</span>
                            <span class="rr-drug-qty">x${d.quantity || 1}</span>
                        </div>
                        ${details.length ? '<div class="rr-drug-detail">' + details.join(' &bull; ') + '</div>' : ''}
                        ${instrLine}
                    </div>`;
            }).join('');

            const overlay = document.createElement('div');
            overlay.className = 'rx-modal-overlay';
            overlay.id = 'rx-preview-modal';
            overlay.innerHTML = `
                <div class="rx-modal rx-modal--receipt">
                    <div class="rx-modal-header">
                        <h3><i class="fas fa-eye"></i> Prescription ${isPreview ? 'Preview' : 'Details'}</h3>
                        <div class="rx-preview-actions-header">
                            <button class="rx-btn rx-btn--primary rx-btn--sm" id="rx-print-btn"><i class="fas fa-print"></i> Print</button>
                            <button class="rx-modal-close" id="rx-preview-close">&times;</button>
                        </div>
                    </div>
                    <div class="rx-modal-body rx-preview-scroll">
                        <div class="rr-receipt" id="rx-print-area">
                            <div class="rr-header">
                                <div class="rr-rx-symbol">&#8478;</div>
                                <h2 class="rr-biz-name">${this.escapeHtml(bizName)}</h2>
                                ${bizAddress ? '<p class="rr-biz-sub">' + this.escapeHtml(bizAddress) + '</p>' : ''}
                                ${bizPhone ? '<p class="rr-biz-sub">' + this.escapeHtml(bizPhone) + '</p>' : ''}
                            </div>

                            <div class="rr-divider"></div>
                            <div class="rr-title">PRESCRIPTION</div>
                            <div class="rr-divider"></div>

                            <div class="rr-info-row"><span>Rx ID:</span><strong>${this.escapeHtml(rx.rxId || '—')}</strong></div>
                            <div class="rr-info-row"><span>Date:</span><span>${dateStr}</span></div>
                            <div class="rr-info-row"><span>Status:</span><span class="rr-status rr-status--${rx.status || 'pending'}">${(rx.status || 'pending').toUpperCase()}</span></div>

                            <div class="rr-divider rr-divider--dashed"></div>

                            <div class="rr-section-label">PATIENT</div>
                            <div class="rr-info-row"><span>Name:</span><strong>${this.escapeHtml(rx.patientName || '—')}</strong></div>
                            ${rx.patientAge ? '<div class="rr-info-row"><span>Age:</span><span>' + this.escapeHtml(rx.patientAge) + '</span></div>' : ''}
                            ${rx.patientGender ? '<div class="rr-info-row"><span>Gender:</span><span>' + this.escapeHtml(rx.patientGender) + '</span></div>' : ''}
                            ${rx.patientPhone ? '<div class="rr-info-row"><span>Phone:</span><span>' + this.escapeHtml(rx.patientPhone) + '</span></div>' : ''}

                            <div class="rr-divider rr-divider--dashed"></div>

                            <div class="rr-section-label">PRESCRIBER</div>
                            <div class="rr-info-row"><span>Doctor:</span><strong>Dr. ${this.escapeHtml(rx.doctorName || '—')}</strong></div>
                            ${rx.doctorSpecialty ? '<div class="rr-info-row"><span>Specialty:</span><span>' + this.escapeHtml(rx.doctorSpecialty) + '</span></div>' : ''}
                            ${rx.doctorLicense ? '<div class="rr-info-row"><span>Reg No:</span><span>' + this.escapeHtml(rx.doctorLicense) + '</span></div>' : ''}
                            ${rx.doctorPhone ? '<div class="rr-info-row"><span>Phone:</span><span>' + this.escapeHtml(rx.doctorPhone) + '</span></div>' : ''}

                            ${rx.diagnosis ? '<div class="rr-divider rr-divider--dashed"></div><div class="rr-section-label">DIAGNOSIS</div><div class="rr-diagnosis">' + this.escapeHtml(rx.diagnosis) + '</div>' : ''}

                            <div class="rr-divider"></div>
                            <div class="rr-section-label">PRESCRIBED DRUGS</div>

                            <div class="rr-drugs-list">
                                ${drugItems || '<div class="rr-empty">No drugs prescribed</div>'}
                            </div>

                            <div class="rr-divider"></div>

                            <div class="rr-sig-area">
                                <div class="rr-sig-line"></div>
                                <p>Doctor's Signature & Stamp</p>
                            </div>

                            <div class="rr-divider rr-divider--dashed"></div>

                            <div class="rr-footer">
                                <p>Valid for 30 days from date of issue</p>
                                <p>${this.escapeHtml(bizName)}</p>
                                <p>Thank you & get well soon!</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);
            setTimeout(() => overlay.classList.add('open'), 10);

            document.getElementById('rx-preview-close').addEventListener('click', () => this.closeModal('rx-preview-modal'));
            document.getElementById('rx-print-btn').addEventListener('click', () => this.printPrescription());
        },

        printPrescription: function () {
            const printArea = document.getElementById('rx-print-area');
            if (!printArea) return;

            const printWindow = window.open('', '_blank', 'width=420,height=700');
            printWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Prescription</title>
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body {
                            font-family: 'Courier New', Courier, monospace;
                            width: 80mm; max-width: 80mm;
                            margin: 0 auto; padding: 8px 10px;
                            color: #000; font-size: 12px; line-height: 1.4;
                        }
                        .rr-header { text-align: center; margin-bottom: 4px; }
                        .rr-rx-symbol { font-size: 28px; font-weight: 700; line-height: 1; }
                        .rr-biz-name { font-size: 16px; font-weight: 700; margin: 2px 0; }
                        .rr-biz-sub { font-size: 10px; color: #444; }
                        .rr-divider { border-top: 1px solid #000; margin: 6px 0; }
                        .rr-divider--dashed { border-top-style: dashed; }
                        .rr-title { text-align: center; font-size: 13px; font-weight: 700; letter-spacing: 2px; margin: 4px 0; }
                        .rr-section-label { font-size: 10px; font-weight: 700; letter-spacing: 1px; margin-bottom: 3px; text-transform: uppercase; }
                        .rr-info-row { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 1px; }
                        .rr-info-row span:first-child { color: #555; }
                        .rr-info-row strong { font-weight: 700; }
                        .rr-status { font-weight: 700; }
                        .rr-diagnosis { font-size: 11px; margin-bottom: 4px; }
                        .rr-drugs-list { margin: 4px 0; }
                        .rr-drug-item { margin-bottom: 6px; padding-bottom: 5px; border-bottom: 1px dotted #ccc; }
                        .rr-drug-item:last-child { border-bottom: none; }
                        .rr-drug-main { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; }
                        .rr-drug-detail { font-size: 10px; color: #444; margin-top: 1px; }
                        .rr-drug-note { font-size: 10px; font-style: italic; color: #666; margin-top: 1px; }
                        .rr-sig-area { text-align: center; margin: 20px 0 8px; }
                        .rr-sig-line { border-bottom: 1px solid #000; width: 60%; margin: 0 auto 4px; height: 30px; }
                        .rr-sig-area p { font-size: 9px; color: #666; }
                        .rr-footer { text-align: center; font-size: 9px; color: #888; }
                        .rr-footer p { margin: 1px 0; }
                        .rr-empty { text-align: center; color: #999; font-size: 11px; padding: 8px; }
                        @media print {
                            body { width: 80mm; padding: 4px 6px; }
                            @page { size: 80mm auto; margin: 0; }
                        }
                    </style>
                </head>
                <body>
                    ${printArea.innerHTML}
                    <script>
                        window.onload = function() { window.print(); window.onafterprint = function() { window.close(); }; };
                    <\/script>
                </body>
                </html>
            `);
            printWindow.document.close();
        }
    };

    window.PharmaFlow.Prescription = Prescription;
})();
