/**
 * PharmaFlow - Patient Management Module
 *   1. Add Patient (short registration form)
 *   2. Manage Patients (full table with view/edit/delete)
 *   3. Patient Billing (multi-service billing with invoice & print)
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let ptUnsubPatients = null;
    let ptUnsubBilling = null;
    let ptAllBills = [];
    let ptBillItems = [];
    let ptUnsubRecords = null;
    let ptManageRecords = [];
    let ptTreatmentDrugs = [];
    let ptInventoryCache = [];

    // Cursor-based pagination state for manage patients
    let ptPage = 1;
    let ptPageSize = 25;
    let ptPageData = [];
    let ptFirstDoc = null;
    let ptLastDoc = null;
    let ptPageStack = [];
    let ptHasNext = false;
    let ptIsLoading = false;

    /* ── Manage Billing state ── */
    let ptUnsubManageBills = null;
    let ptManageBillsCache = [];
    let ptMbFilteredCache = [];
    let ptMbPage = 1;
    let ptMbPageSize = 25;

    const SERVICE_CATEGORIES = [
        'Consultation', 'Medication', 'Lab Test', 'Injection',
        'Dressing', 'Vaccination', 'X-Ray', 'Ultrasound',
        'Minor Surgery', 'Dental', 'Eye Test', 'Physiotherapy',
        'Counseling', 'Home Visit', 'Delivery', 'Other'
    ];

    const Patients = {

        /* ══════════════════════════════════
         * HELPERS
         * ══════════════════════════════════ */

        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        getCurrentUser: function () {
            const p = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
            return p ? (p.displayName || p.email || 'User') : 'Unknown';
        },

        formatCurrency: function (amount) {
            return 'KSH ' + new Intl.NumberFormat('en-KE', {
                minimumFractionDigits: 2, maximumFractionDigits: 2
            }).format(amount || 0);
        },

        escapeHtml: function (str) {
            const div = document.createElement('div');
            div.textContent = str || '';
            return div.innerHTML;
        },

        showToast: function (msg, type) {
            const old = document.querySelector('.pt-toast');
            if (old) old.remove();
            const t = document.createElement('div');
            t.className = 'pt-toast pt-toast--' + (type || 'success');
            t.innerHTML = '<i class="fas fa-' + (type === 'error' ? 'exclamation-circle' : 'check-circle') + '"></i> ' + this.escapeHtml(msg);
            document.body.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
        },

        generateId: function (prefix) {
            const now = new Date();
            const y = now.getFullYear().toString().slice(-2);
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
            return (prefix || 'PT') + '-' + y + m + d + '-' + rand;
        },

        cleanup: function () {
            if (ptUnsubPatients) { ptUnsubPatients(); ptUnsubPatients = null; }
            if (ptUnsubBilling) { ptUnsubBilling(); ptUnsubBilling = null; }
            if (ptUnsubRecords) { ptUnsubRecords(); ptUnsubRecords = null; }
            if (ptUnsubManageBills) { ptUnsubManageBills(); ptUnsubManageBills = null; }
            ptAllBills = [];
            ptBillItems = [];
            ptManageRecords = [];
            ptManageBillsCache = [];
            ptMbFilteredCache = [];
            ptMbPage = 1;
            ptPage = 1;
            ptPageData = [];
            ptFirstDoc = null;
            ptLastDoc = null;
            ptPageStack = [];
            ptHasNext = false;
        },

        /* ══════════════════════════════════════════
         * 1) ADD PATIENT
         * ══════════════════════════════════════════ */

        renderAdd: function (container) {
            this.cleanup();
            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="pt-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-user-plus"></i> Register Patient</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Patients</span><span>/</span><span>Add Patient</span>
                            </div>
                        </div>
                    </div>

                    <div class="pt-add-layout">
                        <div class="card pt-card">
                            <div class="card-header">
                                <span class="card-title"><i class="fas fa-id-card"></i> Patient Registration</span>
                            </div>
                            <form id="pt-add-form" autocomplete="off">
                                <div class="pt-form-grid">
                                    <div class="form-group">
                                        <label for="pt-fname">First Name <span class="required">*</span></label>
                                        <input type="text" id="pt-fname" placeholder="First name" required>
                                    </div>
                                    <div class="form-group">
                                        <label for="pt-lname">Last Name <span class="required">*</span></label>
                                        <input type="text" id="pt-lname" placeholder="Last name" required>
                                    </div>
                                    <div class="form-group">
                                        <label for="pt-phone">Phone <span class="required">*</span></label>
                                        <input type="tel" id="pt-phone" placeholder="e.g. 0712345678" required>
                                    </div>
                                    <div class="form-group">
                                        <label for="pt-email">Email</label>
                                        <input type="email" id="pt-email" placeholder="email@example.com">
                                    </div>
                                    <div class="form-group">
                                        <label for="pt-dob">Date of Birth</label>
                                        <input type="date" id="pt-dob">
                                    </div>
                                    <div class="form-group">
                                        <label for="pt-gender">Gender <span class="required">*</span></label>
                                        <select id="pt-gender" required>
                                            <option value="">Select</option>
                                            <option value="Male">Male</option>
                                            <option value="Female">Female</option>
                                            <option value="Other">Other</option>
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label for="pt-id-number">ID / Passport No.</label>
                                        <input type="text" id="pt-id-number" placeholder="National ID or Passport">
                                    </div>
                                    <div class="form-group">
                                        <label for="pt-insurance">Insurance Provider</label>
                                        <input type="text" id="pt-insurance" placeholder="e.g. NHIF, AAR, Jubilee">
                                    </div>
                                    <div class="form-group">
                                        <label for="pt-insurance-no">Insurance / Member No.</label>
                                        <input type="text" id="pt-insurance-no" placeholder="Member number">
                                    </div>
                                    <div class="form-group">
                                        <label for="pt-address">Address</label>
                                        <input type="text" id="pt-address" placeholder="Residential address">
                                    </div>
                                    <div class="form-group pt-span-2">
                                        <label for="pt-allergies">Known Allergies</label>
                                        <textarea id="pt-allergies" rows="2" placeholder="List known allergies (if any)"></textarea>
                                    </div>
                                    <div class="form-group pt-span-2">
                                        <label for="pt-notes">Notes</label>
                                        <textarea id="pt-notes" rows="2" placeholder="Any additional notes about the patient"></textarea>
                                    </div>
                                </div>
                                <div class="pt-form-actions">
                                    <button type="submit" class="btn btn-primary" id="pt-submit-btn">
                                        <i class="fas fa-user-plus"></i> Register Patient
                                    </button>
                                    <button type="reset" class="btn btn-outline">
                                        <i class="fas fa-eraser"></i> Clear Form
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            `;

            // Breadcrumb
            container.querySelector('[data-nav="dashboard"]')?.addEventListener('click', (e) => {
                e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null);
            });

            // Form submit
            document.getElementById('pt-add-form')?.addEventListener('submit', (e) => {
                e.preventDefault();
                this._savePatient(businessId);
            });
        },

        _savePatient: async function (businessId) {
            if (!businessId) { this.showToast('No business assigned', 'error'); return; }

            const fname = (document.getElementById('pt-fname')?.value || '').trim();
            const lname = (document.getElementById('pt-lname')?.value || '').trim();
            const phone = (document.getElementById('pt-phone')?.value || '').trim();
            const gender = document.getElementById('pt-gender')?.value || '';

            if (!fname || !lname) { this.showToast('First and last name required', 'error'); return; }
            if (!phone) { this.showToast('Phone number required', 'error'); return; }
            if (!gender) { this.showToast('Gender required', 'error'); return; }

            const btn = document.getElementById('pt-submit-btn');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

            try {
                const patientId = this.generateId('PT');
                const data = {
                    patientId: patientId,
                    firstName: fname,
                    lastName: lname,
                    fullName: fname + ' ' + lname,
                    phone: phone,
                    email: (document.getElementById('pt-email')?.value || '').trim(),
                    dob: document.getElementById('pt-dob')?.value || '',
                    gender: gender,
                    idNumber: (document.getElementById('pt-id-number')?.value || '').trim(),
                    insurance: (document.getElementById('pt-insurance')?.value || '').trim(),
                    insuranceNo: (document.getElementById('pt-insurance-no')?.value || '').trim(),
                    address: (document.getElementById('pt-address')?.value || '').trim(),
                    allergies: (document.getElementById('pt-allergies')?.value || '').trim(),
                    notes: (document.getElementById('pt-notes')?.value || '').trim(),
                    status: 'active',
                    totalBilled: 0,
                    totalPaid: 0,
                    visitCount: 0,
                    createdBy: this.getCurrentUser(),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                await getBusinessCollection(businessId, 'patients').doc(patientId).set(data);

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Patient Registered',
                        description: 'Registered ' + fname + ' ' + lname + ' (' + patientId + ')',
                        category: 'Patient',
                        status: 'COMPLETED',
                        metadata: { patientId: patientId, name: fname + ' ' + lname, phone: phone }
                    });
                }

                this.showToast('Patient ' + fname + ' ' + lname + ' registered!');
                document.getElementById('pt-add-form')?.reset();
            } catch (err) {
                console.error('Save patient error:', err);
                this.showToast('Failed: ' + err.message, 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus"></i> Register Patient'; }
            }
        },

        /* ══════════════════════════════════════════
         * 2) MANAGE PATIENTS
         * ══════════════════════════════════════════ */

        renderManage: function (container) {
            this.cleanup();
            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="pt-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-users"></i> Manage Patients</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Patients</span><span>/</span><span>Manage</span>
                            </div>
                        </div>
                        <div class="page-header-right">
                            <button class="btn btn-sm btn-primary" id="pt-add-new-btn">
                                <i class="fas fa-user-plus"></i> New Patient
                            </button>
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="pt-manage-stats">
                        <div class="pt-stat-mini pt-stat--blue">
                            <i class="fas fa-users"></i>
                            <div><span class="pt-stat-num" id="pt-stat-total">0</span><span class="pt-stat-label">Total Patients</span></div>
                        </div>
                        <div class="pt-stat-mini pt-stat--green">
                            <i class="fas fa-user-check"></i>
                            <div><span class="pt-stat-num" id="pt-stat-active">0</span><span class="pt-stat-label">Active</span></div>
                        </div>
                        <div class="pt-stat-mini pt-stat--purple">
                            <i class="fas fa-shield-halved"></i>
                            <div><span class="pt-stat-num" id="pt-stat-insured">0</span><span class="pt-stat-label">Insured</span></div>
                        </div>
                        <div class="pt-stat-mini pt-stat--orange">
                            <i class="fas fa-calendar-check"></i>
                            <div><span class="pt-stat-num" id="pt-stat-today">0</span><span class="pt-stat-label">Registered Today</span></div>
                        </div>
                    </div>

                    <!-- Toolbar -->
                    <div class="card pt-card">
                        <div class="pt-toolbar">
                            <div class="pt-search-bar">
                                <i class="fas fa-search"></i>
                                <input type="text" id="pt-manage-search" placeholder="Search patients by name, phone, ID..." autocomplete="off">
                            </div>
                            <select id="pt-filter-status" class="pt-select">
                                <option value="all">All Statuses</option>
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                            </select>
                            <select id="pt-filter-gender" class="pt-select">
                                <option value="all">All Genders</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                                <option value="Other">Other</option>
                            </select>
                            <select id="pt-page-size" class="pt-select" title="Rows per page">
                                <option value="25">25 rows</option>
                                <option value="50">50 rows</option>
                                <option value="100">100 rows</option>
                            </select>
                        </div>

                        <div class="pt-table-wrap">
                            <table class="pt-table">
                                <thead>
                                    <tr>
                                        <th>Patient ID</th>
                                        <th>Name</th>
                                        <th>Phone</th>
                                        <th>Gender</th>
                                        <th>Age</th>
                                        <th>Insurance</th>
                                        <th>Status</th>
                                        <th>Registered</th>
                                        <th style="text-align:center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="pt-patients-list">
                                    <tr><td colspan="9" class="pt-loading"><div class="spinner"></div> Loading patients...</td></tr>
                                </tbody>
                            </table>
                        </div>

                        <!-- Pagination -->
                        <div class="dda-pagination" id="pt-manage-pagination"></div>
                    </div>
                </div>
            `;

            // Events
            container.querySelector('[data-nav="dashboard"]')?.addEventListener('click', (e) => {
                e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null);
            });
            document.getElementById('pt-add-new-btn')?.addEventListener('click', () => {
                PharmaFlow.Sidebar.setActive('patients', 'add-patient');
            });

            let debounce;
            document.getElementById('pt-manage-search')?.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(() => { this._resetPtPagination(); this._loadPatientsPage(); }, 350);
            });
            document.getElementById('pt-filter-status')?.addEventListener('change', () => { this._resetPtPagination(); this._loadPatientsPage(); this._loadPatientStats(); });
            document.getElementById('pt-filter-gender')?.addEventListener('change', () => { this._resetPtPagination(); this._loadPatientsPage(); this._loadPatientStats(); });
            document.getElementById('pt-page-size')?.addEventListener('change', (e) => { ptPageSize = parseInt(e.target.value) || 25; this._resetPtPagination(); this._loadPatientsPage(); });

            this._resetPtPagination();
            this._loadPatientsPage();
            this._loadPatientStats();
        },

        _resetPtPagination: function () {
            ptPage = 1;
            ptPageData = [];
            ptFirstDoc = null;
            ptLastDoc = null;
            ptPageStack = [];
            ptHasNext = false;
        },

        _buildPatientQuery: function () {
            const businessId = this.getBusinessId();
            if (!businessId) return null;
            let q = getBusinessCollection(businessId, 'patients');

            const statusF = document.getElementById('pt-filter-status')?.value || 'all';
            const genderF = document.getElementById('pt-filter-gender')?.value || 'all';

            if (statusF !== 'all') q = q.where('status', '==', statusF);
            if (genderF !== 'all') q = q.where('gender', '==', genderF);

            q = q.orderBy('createdAt', 'desc');
            return q;
        },

        _loadPatientsPage: async function (direction) {
            if (ptIsLoading) return;
            ptIsLoading = true;

            const tbody = document.getElementById('pt-patients-list');
            if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="pt-loading"><div class="spinner"></div> Loading patients...</td></tr>';

            try {
                let q = this._buildPatientQuery();
                if (!q) { ptIsLoading = false; return; }

                if (direction === 'next' && ptLastDoc) {
                    q = q.startAfter(ptLastDoc);
                } else if (direction === 'prev' && ptPageStack.length > 0) {
                    const prevCursor = ptPageStack.pop();
                    q = q.startAt(prevCursor);
                    ptPage--;
                }

                const snap = await q.limit(ptPageSize + 1).get();
                const docs = snap.docs;

                ptHasNext = docs.length > ptPageSize;
                const pageDocs = ptHasNext ? docs.slice(0, ptPageSize) : docs;

                ptPageData = pageDocs.map(d => ({ id: d.id, ...d.data() }));

                // Client-side search filter
                const searchQ = (document.getElementById('pt-manage-search')?.value || '').toLowerCase().trim();
                if (searchQ) {
                    ptPageData = ptPageData.filter(p => {
                        const hay = ((p.fullName || '') + ' ' + (p.phone || '') + ' ' + (p.patientId || '') + ' ' + (p.idNumber || '') + ' ' + (p.insurance || '')).toLowerCase();
                        return hay.includes(searchQ);
                    });
                }

                if (pageDocs.length > 0) {
                    if (direction === 'next' && ptFirstDoc) {
                        ptPageStack.push(ptFirstDoc);
                        ptPage++;
                    }
                    ptFirstDoc = pageDocs[0];
                    ptLastDoc = pageDocs[pageDocs.length - 1];
                } else {
                    ptFirstDoc = null;
                    ptLastDoc = null;
                }

                this._renderPatientsTable(ptPageData);
                this._renderPtPagination();
            } catch (err) {
                console.error('Load patients page error:', err);
                if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="pt-loading"><i class="fas fa-exclamation-circle"></i> Failed to load patients</td></tr>';
            } finally {
                ptIsLoading = false;
            }
        },

        _loadPatientStats: async function () {
            const businessId = this.getBusinessId();
            if (!businessId) return;
            const el = (id) => document.getElementById(id);
            const col = getBusinessCollection(businessId, 'patients');
            const today = new Date().toISOString().split('T')[0];

            try {
                if (typeof col.count === 'function') {
                    const [total, active, insured, todayCount] = await Promise.all([
                        col.count().get(),
                        col.where('status', '==', 'active').count().get(),
                        col.where('insurance', '!=', '').count().get(),
                        col.where('createdAt', '>=', today).where('createdAt', '<=', today + '\uf8ff').count().get()
                    ]);
                    if (el('pt-stat-total')) el('pt-stat-total').textContent = total.data().count;
                    if (el('pt-stat-active')) el('pt-stat-active').textContent = active.data().count;
                    if (el('pt-stat-insured')) el('pt-stat-insured').textContent = insured.data().count;
                    if (el('pt-stat-today')) el('pt-stat-today').textContent = todayCount.data().count;
                } else {
                    const snap = await col.orderBy('createdAt', 'desc').limit(10000).get();
                    const all = snap.docs.map(d => d.data());
                    const suffix = all.length >= 10000 ? '+' : '';
                    if (el('pt-stat-total')) el('pt-stat-total').textContent = all.length + suffix;
                    if (el('pt-stat-active')) el('pt-stat-active').textContent = all.filter(p => p.status === 'active').length;
                    if (el('pt-stat-insured')) el('pt-stat-insured').textContent = all.filter(p => p.insurance && p.insurance.trim()).length;
                    if (el('pt-stat-today')) el('pt-stat-today').textContent = all.filter(p => (p.createdAt || '').startsWith(today)).length;
                }
            } catch (err) {
                console.error('Load patient stats error:', err);
            }
        },

        _renderPtPagination: function () {
            const container = document.getElementById('pt-manage-pagination');
            if (!container) return;

            const hasPrev = ptPage > 1;
            const hasNext = ptHasNext;
            const count = ptPageData.length;
            const start = (ptPage - 1) * ptPageSize + 1;
            const end = start + count - 1;

            if (!hasPrev && !hasNext && count <= ptPageSize) {
                container.innerHTML = count > 0 ? '<span class="dda-page-info">Showing ' + count + ' patient' + (count !== 1 ? 's' : '') + ' &mdash; Page ' + ptPage + '</span>' : '';
                return;
            }

            container.innerHTML = '<span class="dda-page-info">Page ' + ptPage + ' &middot; Showing ' + (count > 0 ? start + '-' + end : '0') + ' patients</span>' +
                '<div class="dda-page-controls">' +
                '<button class="dda-page-btn" id="pt-prev-page"' + (!hasPrev ? ' disabled' : '') + '><i class="fas fa-chevron-left"></i> Prev</button>' +
                '<span class="dda-page-btn active" style="cursor:default">' + ptPage + '</span>' +
                '<button class="dda-page-btn" id="pt-next-page"' + (!hasNext ? ' disabled' : '') + '>Next <i class="fas fa-chevron-right"></i></button>' +
                '</div>';

            document.getElementById('pt-prev-page')?.addEventListener('click', () => {
                if (hasPrev) this._loadPatientsPage('prev');
            });
            document.getElementById('pt-next-page')?.addEventListener('click', () => {
                if (hasNext) this._loadPatientsPage('next');
            });
        },

        /** Fetch a single patient by ID from Firestore */
        _fetchPatientById: async function (patientId) {
            // First check current page data
            const local = ptPageData.find(x => (x.patientId || x.id) === patientId);
            if (local) return local;
            // Fetch from Firestore
            const businessId = this.getBusinessId();
            if (!businessId) return null;
            const doc = await getBusinessCollection(businessId, 'patients').doc(patientId).get();
            return doc.exists ? { id: doc.id, ...doc.data() } : null;
        },

        _calcAge: function (dob) {
            if (!dob) return '-';
            const birth = new Date(dob);
            const diff = Date.now() - birth.getTime();
            const age = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
            return age >= 0 ? age : '-';
        },

        _renderPatientsTable: function (patients) {
            const tbody = document.getElementById('pt-patients-list');
            if (!tbody) return;

            if (patients.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" class="pt-empty"><div class="pt-empty-box"><i class="fas fa-users"></i><p>No patients found</p></div></td></tr>';
                return;
            }

            tbody.innerHTML = patients.map(p => {
                const date = p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
                const statusCls = p.status === 'active' ? 'pt-badge--green' : 'pt-badge--red';
                const age = this._calcAge(p.dob);

                return `
                    <tr>
                        <td><span class="pt-pid">${this.escapeHtml(p.patientId || p.id)}</span></td>
                        <td>
                            <div class="pt-name-cell">
                                <div class="pt-avatar">${(p.firstName || '?')[0].toUpperCase()}</div>
                                <div>
                                    <strong>${this.escapeHtml(p.fullName || '')}</strong>
                                    ${p.email ? '<small>' + this.escapeHtml(p.email) + '</small>' : ''}
                                </div>
                            </div>
                        </td>
                        <td>${this.escapeHtml(p.phone || '-')}</td>
                        <td>${this.escapeHtml(p.gender || '-')}</td>
                        <td>${age}</td>
                        <td>${p.insurance ? '<span class="pt-insurance-tag"><i class="fas fa-shield-halved"></i> ' + this.escapeHtml(p.insurance) + '</span>' : '<span class="pt-no-ins">None</span>'}</td>
                        <td><span class="pt-badge ${statusCls}">${p.status || 'active'}</span></td>
                        <td><small>${date}</small></td>
                        <td style="text-align:center">
                            <div class="pt-action-group">
                                <button class="pt-action-btn pt-act--view" data-id="${p.patientId || p.id}" title="View"><i class="fas fa-eye"></i></button>
                                <button class="pt-action-btn pt-act--edit" data-id="${p.patientId || p.id}" title="Edit"><i class="fas fa-pen"></i></button>
                                <button class="pt-action-btn pt-act--bill" data-id="${p.patientId || p.id}" title="Create Bill"><i class="fas fa-file-invoice-dollar"></i></button>
                                <button class="pt-action-btn pt-act--manage" data-id="${p.patientId || p.id}" title="Manage"><i class="fas fa-clipboard-list"></i></button>
                                <button class="pt-action-btn pt-act--toggle" data-id="${p.patientId || p.id}" data-status="${p.status}" title="${p.status === 'active' ? 'Deactivate' : 'Activate'}">
                                    <i class="fas fa-${p.status === 'active' ? 'user-slash' : 'user-check'}"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            const self = this;
            tbody.querySelectorAll('.pt-act--view').forEach(btn => btn.addEventListener('click', () => self._viewPatient(btn.dataset.id)));
            tbody.querySelectorAll('.pt-act--edit').forEach(btn => btn.addEventListener('click', () => self._editPatient(btn.dataset.id)));
            tbody.querySelectorAll('.pt-act--bill').forEach(btn => btn.addEventListener('click', () => self._quickBill(btn.dataset.id)));
            tbody.querySelectorAll('.pt-act--manage').forEach(btn => btn.addEventListener('click', () => self._managePatient(btn.dataset.id)));
            tbody.querySelectorAll('.pt-act--toggle').forEach(btn => btn.addEventListener('click', async () => {
                await self._toggleStatus(btn.dataset.id, btn.dataset.status);
                self._loadPatientsPage();
                self._loadPatientStats();
            }));
        },

        /* ── View Patient Modal ── */
        _viewPatient: async function (patientId) {
            const p = await this._fetchPatientById(patientId);
            if (!p) { this.showToast('Patient not found', 'error'); return; }
            const age = this._calcAge(p.dob);

            const modal = document.createElement('div');
            modal.className = 'pt-modal-overlay';
            modal.innerHTML = `
                <div class="pt-modal pt-modal--md">
                    <div class="pt-modal-header">
                        <h3><i class="fas fa-user"></i> Patient Details</h3>
                        <button class="pt-modal-close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="pt-modal-body">
                        <div class="pt-view-header">
                            <div class="pt-view-avatar">${(p.firstName || '?')[0].toUpperCase()}</div>
                            <div>
                                <h3>${this.escapeHtml(p.fullName || '')}</h3>
                                <span class="pt-pid">${this.escapeHtml(p.patientId || p.id)}</span>
                                <span class="pt-badge ${p.status === 'active' ? 'pt-badge--green' : 'pt-badge--red'}">${p.status || 'active'}</span>
                            </div>
                        </div>
                        <div class="pt-view-grid">
                            <div class="pt-view-row"><span class="pt-view-label">Phone</span><span class="pt-view-value">${this.escapeHtml(p.phone || '-')}</span></div>
                            <div class="pt-view-row"><span class="pt-view-label">Email</span><span class="pt-view-value">${this.escapeHtml(p.email || '-')}</span></div>
                            <div class="pt-view-row"><span class="pt-view-label">Gender</span><span class="pt-view-value">${this.escapeHtml(p.gender || '-')}</span></div>
                            <div class="pt-view-row"><span class="pt-view-label">Date of Birth</span><span class="pt-view-value">${p.dob || '-'}</span></div>
                            <div class="pt-view-row"><span class="pt-view-label">Age</span><span class="pt-view-value">${age}</span></div>
                            <div class="pt-view-row"><span class="pt-view-label">ID / Passport</span><span class="pt-view-value">${this.escapeHtml(p.idNumber || '-')}</span></div>
                            <div class="pt-view-row"><span class="pt-view-label">Insurance</span><span class="pt-view-value">${this.escapeHtml(p.insurance || 'None')}</span></div>
                            <div class="pt-view-row"><span class="pt-view-label">Insurance No.</span><span class="pt-view-value">${this.escapeHtml(p.insuranceNo || '-')}</span></div>
                            <div class="pt-view-row"><span class="pt-view-label">Address</span><span class="pt-view-value">${this.escapeHtml(p.address || '-')}</span></div>
                            <div class="pt-view-row"><span class="pt-view-label">Allergies</span><span class="pt-view-value">${this.escapeHtml(p.allergies || 'None')}</span></div>
                            <div class="pt-view-row"><span class="pt-view-label">Notes</span><span class="pt-view-value">${this.escapeHtml(p.notes || '-')}</span></div>
                            <div class="pt-view-row"><span class="pt-view-label">Registered</span><span class="pt-view-value">${p.createdAt ? new Date(p.createdAt).toLocaleString('en-KE') : '-'}</span></div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);
            const close = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            modal.querySelector('.pt-modal-close').addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        },

        /* ── Edit Patient Modal ── */
        _editPatient: async function (patientId) {
            const p = await this._fetchPatientById(patientId);
            if (!p) { this.showToast('Patient not found', 'error'); return; }
            const businessId = this.getBusinessId();

            const modal = document.createElement('div');
            modal.className = 'pt-modal-overlay';
            modal.innerHTML = `
                <div class="pt-modal pt-modal--md">
                    <div class="pt-modal-header">
                        <h3><i class="fas fa-pen"></i> Edit Patient</h3>
                        <button class="pt-modal-close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="pt-modal-body">
                        <form id="pt-edit-form" class="pt-edit-form">
                            <div class="pt-form-grid">
                                <div class="form-group">
                                    <label>First Name <span class="required">*</span></label>
                                    <input type="text" id="pt-edit-fname" value="${this.escapeHtml(p.firstName || '')}" required>
                                </div>
                                <div class="form-group">
                                    <label>Last Name <span class="required">*</span></label>
                                    <input type="text" id="pt-edit-lname" value="${this.escapeHtml(p.lastName || '')}" required>
                                </div>
                                <div class="form-group">
                                    <label>Phone <span class="required">*</span></label>
                                    <input type="tel" id="pt-edit-phone" value="${this.escapeHtml(p.phone || '')}" required>
                                </div>
                                <div class="form-group">
                                    <label>Email</label>
                                    <input type="email" id="pt-edit-email" value="${this.escapeHtml(p.email || '')}">
                                </div>
                                <div class="form-group">
                                    <label>Date of Birth</label>
                                    <input type="date" id="pt-edit-dob" value="${p.dob || ''}">
                                </div>
                                <div class="form-group">
                                    <label>Gender</label>
                                    <select id="pt-edit-gender">
                                        <option value="Male" ${p.gender === 'Male' ? 'selected' : ''}>Male</option>
                                        <option value="Female" ${p.gender === 'Female' ? 'selected' : ''}>Female</option>
                                        <option value="Other" ${p.gender === 'Other' ? 'selected' : ''}>Other</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>ID / Passport</label>
                                    <input type="text" id="pt-edit-id" value="${this.escapeHtml(p.idNumber || '')}">
                                </div>
                                <div class="form-group">
                                    <label>Insurance</label>
                                    <input type="text" id="pt-edit-ins" value="${this.escapeHtml(p.insurance || '')}">
                                </div>
                                <div class="form-group">
                                    <label>Insurance No.</label>
                                    <input type="text" id="pt-edit-ins-no" value="${this.escapeHtml(p.insuranceNo || '')}">
                                </div>
                                <div class="form-group">
                                    <label>Address</label>
                                    <input type="text" id="pt-edit-addr" value="${this.escapeHtml(p.address || '')}">
                                </div>
                                <div class="form-group pt-span-2">
                                    <label>Allergies</label>
                                    <textarea id="pt-edit-allergy" rows="2">${this.escapeHtml(p.allergies || '')}</textarea>
                                </div>
                                <div class="form-group pt-span-2">
                                    <label>Notes</label>
                                    <textarea id="pt-edit-notes" rows="2">${this.escapeHtml(p.notes || '')}</textarea>
                                </div>
                            </div>
                            <div class="pt-form-actions">
                                <button type="submit" class="btn btn-primary" id="pt-edit-save"><i class="fas fa-save"></i> Save Changes</button>
                                <button type="button" class="btn btn-outline pt-modal-close-btn">Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);
            const close = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            modal.querySelector('.pt-modal-close').addEventListener('click', close);
            modal.querySelector('.pt-modal-close-btn')?.addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            const self = this;
            document.getElementById('pt-edit-form')?.addEventListener('submit', async function (e) {
                e.preventDefault();
                const btn = document.getElementById('pt-edit-save');
                if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
                try {
                    const fname = (document.getElementById('pt-edit-fname')?.value || '').trim();
                    const lname = (document.getElementById('pt-edit-lname')?.value || '').trim();
                    await getBusinessCollection(businessId, 'patients').doc(p.patientId || p.id).update({
                        firstName: fname,
                        lastName: lname,
                        fullName: fname + ' ' + lname,
                        phone: (document.getElementById('pt-edit-phone')?.value || '').trim(),
                        email: (document.getElementById('pt-edit-email')?.value || '').trim(),
                        dob: document.getElementById('pt-edit-dob')?.value || '',
                        gender: document.getElementById('pt-edit-gender')?.value || '',
                        idNumber: (document.getElementById('pt-edit-id')?.value || '').trim(),
                        insurance: (document.getElementById('pt-edit-ins')?.value || '').trim(),
                        insuranceNo: (document.getElementById('pt-edit-ins-no')?.value || '').trim(),
                        address: (document.getElementById('pt-edit-addr')?.value || '').trim(),
                        allergies: (document.getElementById('pt-edit-allergy')?.value || '').trim(),
                        notes: (document.getElementById('pt-edit-notes')?.value || '').trim(),
                        updatedAt: new Date().toISOString()
                    });

                    // Log activity
                    if (PharmaFlow.ActivityLog) {
                        PharmaFlow.ActivityLog.log({
                            title: 'Patient Updated',
                            description: 'Updated patient ' + fname + ' ' + lname,
                            category: 'Patient',
                            status: 'COMPLETED',
                            metadata: { patientId: p.patientId || p.id, name: fname + ' ' + lname }
                        });
                    }

                    self.showToast('Patient updated');
                    close();
                    self._loadPatientsPage();
                } catch (err) {
                    console.error('Edit patient error:', err);
                    self.showToast('Failed: ' + err.message, 'error');
                } finally {
                    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
                }
            });
        },

        /* ── Toggle active/inactive ── */
        _toggleStatus: async function (patientId, currentStatus) {
            const businessId = this.getBusinessId();
            if (!businessId) return;
            const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
            try {
                await getBusinessCollection(businessId, 'patients').doc(patientId).update({
                    status: newStatus,
                    updatedAt: new Date().toISOString()
                });
                this.showToast('Patient marked ' + newStatus);
            } catch (err) {
                this.showToast('Failed: ' + err.message, 'error');
            }
        },

        /* ── Quick-bill from manage table ── */
        _quickBill: function (patientId) {
            // Navigate to billing tab with pre-selected patient
            this._pendingBillPatientId = patientId;
            PharmaFlow.Sidebar.setActive('patients', 'patient-billing');
        },

        /* ══════════════════════════════════════════
         * 3) PATIENT BILLING
         * ══════════════════════════════════════════ */

        renderBilling: function (container) {
            this.cleanup();
            ptBillItems = [];
            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="pt-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-file-invoice-dollar"></i> Patient Billing</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Patients</span><span>/</span><span>Billing</span>
                            </div>
                        </div>
                    </div>

                    <div class="pt-billing-layout">
                        <!-- LEFT: Create Bill -->
                        <div class="pt-billing-form-section">
                            <!-- Patient Selection -->
                            <div class="card pt-card">
                                <div class="card-header">
                                    <span class="card-title"><i class="fas fa-user"></i> Select Patient</span>
                                </div>
                                <div class="pt-patient-select-wrap">
                                    <div class="pt-search-bar">
                                        <i class="fas fa-search"></i>
                                        <input type="text" id="pt-bill-patient-search" placeholder="Search patient by name or phone..." autocomplete="off">
                                    </div>
                                    <div class="pt-patient-dropdown" id="pt-patient-dropdown"></div>
                                    <div class="pt-selected-patient" id="pt-selected-patient" style="display:none;">
                                        <div class="pt-sel-info">
                                            <div class="pt-sel-avatar" id="pt-sel-avatar">?</div>
                                            <div>
                                                <strong id="pt-sel-name">—</strong>
                                                <small id="pt-sel-details">—</small>
                                            </div>
                                        </div>
                                        <button class="btn btn-sm btn-outline" id="pt-change-patient"><i class="fas fa-exchange-alt"></i> Change</button>
                                    </div>
                                </div>
                            </div>

                            <!-- Services -->
                            <div class="card pt-card">
                                <div class="card-header">
                                    <span class="card-title"><i class="fas fa-stethoscope"></i> Services</span>
                                    <button class="btn btn-sm btn-outline" id="pt-add-service-btn">
                                        <i class="fas fa-plus"></i> Add Service
                                    </button>
                                </div>

                                <!-- Add service form (hidden) -->
                                <div class="pt-service-form" id="pt-service-form" style="display:none;">
                                    <div class="pt-service-grid">
                                        <div class="form-group">
                                            <label>Category <span class="required">*</span></label>
                                            <select id="pt-svc-category">
                                                <option value="">Select category</option>
                                                ${SERVICE_CATEGORIES.map(c => '<option value="' + c + '">' + c + '</option>').join('')}
                                            </select>
                                        </div>
                                        <div class="form-group">
                                            <label>Service Name <span class="required">*</span></label>
                                            <input type="text" id="pt-svc-name" placeholder="e.g. General Consultation">
                                        </div>
                                        <div class="form-group">
                                            <label>Quantity</label>
                                            <input type="number" id="pt-svc-qty" min="1" value="1">
                                        </div>
                                        <div class="form-group">
                                            <label>Unit Price (KSH) <span class="required">*</span></label>
                                            <input type="number" id="pt-svc-price" min="0" step="0.01" placeholder="0.00">
                                        </div>
                                        <div class="form-group pt-span-2">
                                            <label>Description / Notes</label>
                                            <input type="text" id="pt-svc-desc" placeholder="Optional service notes">
                                        </div>
                                    </div>
                                    <div class="pt-svc-form-actions">
                                        <button class="btn btn-sm btn-primary" id="pt-svc-add-btn"><i class="fas fa-plus"></i> Add to Bill</button>
                                        <button class="btn btn-sm btn-outline" id="pt-svc-cancel-btn">Cancel</button>
                                    </div>
                                </div>

                                <!-- Services table -->
                                <div class="pt-table-wrap">
                                    <table class="pt-table pt-bill-items-table">
                                        <thead>
                                            <tr>
                                                <th>#</th>
                                                <th>Service</th>
                                                <th>Category</th>
                                                <th style="text-align:center">Qty</th>
                                                <th style="text-align:right">Price</th>
                                                <th style="text-align:right">Total</th>
                                                <th style="text-align:center">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody id="pt-bill-items-list">
                                            <tr><td colspan="7" class="pt-empty">
                                                <div class="pt-empty-box"><i class="fas fa-stethoscope"></i><p>No services added</p><span>Click "Add Service" to begin</span></div>
                                            </td></tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <!-- RIGHT: Bill Summary -->
                        <div class="pt-billing-summary-section">
                            <div class="card pt-card pt-summary-card">
                                <div class="card-header">
                                    <span class="card-title"><i class="fas fa-calculator"></i> Bill Summary</span>
                                </div>
                                <div class="pt-summary-body">
                                    <div class="pt-summary-row"><span>Services</span><span id="pt-b-count">0</span></div>
                                    <div class="pt-summary-row"><span>Subtotal</span><span id="pt-b-subtotal">KSH 0.00</span></div>
                                    <div class="pt-summary-row">
                                        <span>Discount</span>
                                        <div class="pt-discount-wrap">
                                            <input type="number" id="pt-b-discount" min="0" value="0" placeholder="0">
                                            <select id="pt-b-disc-type">
                                                <option value="amount">KSH</option>
                                                <option value="percent">%</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div class="pt-summary-total">
                                        <span>Total Due</span>
                                        <span id="pt-b-total">KSH 0.00</span>
                                    </div>
                                </div>

                                <div class="pt-bill-payment">
                                    <div class="form-group">
                                        <label>Payment Method</label>
                                        <select id="pt-b-method" class="pt-select">
                                            <option value="cash">Cash</option>
                                            <option value="mpesa">M-Pesa</option>
                                            <option value="insurance">Insurance</option>
                                            <option value="bank_transfer">Bank Transfer</option>
                                            <option value="card">Card</option>
                                            <option value="credit">Credit</option>
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label>Payment Status</label>
                                        <select id="pt-b-pay-status" class="pt-select">
                                            <option value="paid">Paid</option>
                                            <option value="partial">Partially Paid</option>
                                            <option value="unpaid" selected>Unpaid</option>
                                        </select>
                                    </div>
                                    <div class="form-group" id="pt-b-paid-group" style="display:none;">
                                        <label>Amount Paid</label>
                                        <input type="number" id="pt-b-amount-paid" min="0" step="0.01" placeholder="0.00">
                                    </div>
                                    <div class="form-group">
                                        <label>Notes</label>
                                        <textarea id="pt-b-notes" rows="2" class="pt-textarea" placeholder="Billing notes..."></textarea>
                                    </div>
                                </div>

                                <div class="pt-bill-actions">
                                    <button class="btn btn-primary btn-lg pt-bill-submit" id="pt-submit-bill" disabled>
                                        <i class="fas fa-file-invoice-dollar"></i> Generate Bill
                                    </button>
                                </div>
                            </div>

                            <!-- Recent bills -->
                            <div class="card pt-card pt-recent-bills-card">
                                <div class="card-header">
                                    <span class="card-title"><i class="fas fa-history"></i> Recent Bills</span>
                                </div>
                                <div class="pt-recent-bills" id="pt-recent-bills">
                                    <div class="pt-loading"><div class="spinner"></div> Loading...</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            this._bindBillingEvents(container, businessId);
            this._subscribeBills(businessId);

            // Auto-select patient if coming from quick-bill
            if (this._pendingBillPatientId) {
                this._fetchPatientById(this._pendingBillPatientId).then(pat => {
                    if (pat) this._selectBillPatient(pat);
                    this._pendingBillPatientId = null;
                }).catch(() => { this._pendingBillPatientId = null; });
            }
        },

        _selectedPatient: null,

        _bindBillingEvents: function (container, businessId) {
            const self = this;

            container.querySelector('[data-nav="dashboard"]')?.addEventListener('click', (e) => {
                e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null);
            });

            // Patient search
            const searchInput = document.getElementById('pt-bill-patient-search');
            const dropdown = document.getElementById('pt-patient-dropdown');
            if (searchInput && dropdown) {
                let debounce;
                searchInput.addEventListener('input', function () {
                    clearTimeout(debounce);
                    debounce = setTimeout(() => self._searchPatients(this.value, dropdown), 180);
                });
                searchInput.addEventListener('focus', function () {
                    if (this.value.trim().length >= 1) self._searchPatients(this.value, dropdown);
                });
                document.addEventListener('click', (e) => {
                    if (!dropdown.contains(e.target) && e.target !== searchInput) dropdown.classList.remove('show');
                });
            }

            // Change patient
            document.getElementById('pt-change-patient')?.addEventListener('click', () => {
                this._selectedPatient = null;
                document.getElementById('pt-selected-patient').style.display = 'none';
                const si = document.getElementById('pt-bill-patient-search');
                if (si) { si.closest('.pt-search-bar').style.display = 'flex'; si.value = ''; si.focus(); }
                this._updateBillSummary();
            });

            // Toggle service form
            document.getElementById('pt-add-service-btn')?.addEventListener('click', () => {
                const form = document.getElementById('pt-service-form');
                if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
            });
            document.getElementById('pt-svc-cancel-btn')?.addEventListener('click', () => {
                const form = document.getElementById('pt-service-form');
                if (form) form.style.display = 'none';
            });
            document.getElementById('pt-svc-add-btn')?.addEventListener('click', () => this._addService());

            // Discount
            document.getElementById('pt-b-discount')?.addEventListener('input', () => this._updateBillSummary());
            document.getElementById('pt-b-disc-type')?.addEventListener('change', () => this._updateBillSummary());

            // Payment status
            document.getElementById('pt-b-pay-status')?.addEventListener('change', function () {
                document.getElementById('pt-b-paid-group').style.display = this.value === 'partial' ? 'block' : 'none';
            });

            // Submit bill
            document.getElementById('pt-submit-bill')?.addEventListener('click', () => this._submitBill(businessId));
        },

        _searchPatients: async function (query, dropdown) {
            const q = (query || '').toLowerCase().trim();
            if (q.length < 1) { dropdown.classList.remove('show'); return; }

            // Search Firestore directly for billing patient search
            const businessId = this.getBusinessId();
            let results = [];
            if (businessId) {
                try {
                    const snap = await getBusinessCollection(businessId, 'patients')
                        .where('status', '==', 'active')
                        .orderBy('fullName')
                        .limit(50)
                        .get();
                    results = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => {
                        const hay = ((p.fullName || '') + ' ' + (p.phone || '') + ' ' + (p.patientId || '')).toLowerCase();
                        return hay.includes(q);
                    }).slice(0, 8);
                } catch (e) {
                    console.error('Patient search error:', e);
                    results = [];
                }
            }

            if (results.length === 0) {
                dropdown.innerHTML = '<div class="pt-dd-empty"><i class="fas fa-search"></i> No patients found</div>';
                dropdown.classList.add('show');
                return;
            }

            dropdown.innerHTML = results.map(p => `
                <div class="pt-dd-item" data-id="${p.patientId || p.id}">
                    <div class="pt-dd-avatar">${(p.firstName || '?')[0].toUpperCase()}</div>
                    <div class="pt-dd-info">
                        <strong>${this.escapeHtml(p.fullName || '')}</strong>
                        <small>${this.escapeHtml(p.phone || '')} · ${this.escapeHtml(p.patientId || p.id)}</small>
                    </div>
                    ${p.insurance ? '<span class="pt-insurance-tag"><i class="fas fa-shield-halved"></i></span>' : ''}
                </div>
            `).join('');

            dropdown.classList.add('show');

            dropdown.querySelectorAll('.pt-dd-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const pat = await this._fetchPatientById(item.dataset.id);
                    if (pat) this._selectBillPatient(pat);
                    dropdown.classList.remove('show');
                });
            });
        },

        _selectBillPatient: function (patient) {
            this._selectedPatient = patient;
            const selBox = document.getElementById('pt-selected-patient');
            const searchBar = document.getElementById('pt-bill-patient-search')?.closest('.pt-search-bar');
            if (selBox) {
                selBox.style.display = 'flex';
                document.getElementById('pt-sel-avatar').textContent = (patient.firstName || '?')[0].toUpperCase();
                document.getElementById('pt-sel-name').textContent = patient.fullName || '';
                document.getElementById('pt-sel-details').textContent =
                    (patient.phone || '') + ' · ' + (patient.patientId || patient.id) +
                    (patient.insurance ? ' · ' + patient.insurance : '');
            }
            if (searchBar) searchBar.style.display = 'none';
            this._updateBillSummary();
        },

        _addService: function () {
            const cat = document.getElementById('pt-svc-category')?.value || '';
            const name = (document.getElementById('pt-svc-name')?.value || '').trim();
            const qty = parseInt(document.getElementById('pt-svc-qty')?.value) || 1;
            const price = parseFloat(document.getElementById('pt-svc-price')?.value) || 0;
            const desc = (document.getElementById('pt-svc-desc')?.value || '').trim();

            if (!cat) { this.showToast('Select a category', 'error'); return; }
            if (!name) { this.showToast('Service name is required', 'error'); return; }
            if (price <= 0) { this.showToast('Price must be greater than 0', 'error'); return; }

            ptBillItems.push({
                id: Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
                category: cat,
                name: name,
                qty: qty,
                unitPrice: price,
                description: desc
            });

            // Clear form
            document.getElementById('pt-svc-category').value = '';
            document.getElementById('pt-svc-name').value = '';
            document.getElementById('pt-svc-qty').value = '1';
            document.getElementById('pt-svc-price').value = '';
            document.getElementById('pt-svc-desc').value = '';
            document.getElementById('pt-service-form').style.display = 'none';

            this.showToast(name + ' added');
            this._renderBillItems();
            this._updateBillSummary();
        },

        _renderBillItems: function () {
            const tbody = document.getElementById('pt-bill-items-list');
            const submitBtn = document.getElementById('pt-submit-bill');
            if (!tbody) return;

            if (ptBillItems.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="pt-empty"><div class="pt-empty-box"><i class="fas fa-stethoscope"></i><p>No services added</p><span>Click "Add Service" to begin</span></div></td></tr>';
                if (submitBtn) submitBtn.disabled = true;
                return;
            }

            if (submitBtn) submitBtn.disabled = !this._selectedPatient;

            tbody.innerHTML = ptBillItems.map((item, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td>
                        <strong>${this.escapeHtml(item.name)}</strong>
                        ${item.description ? '<br><small class="pt-svc-note">' + this.escapeHtml(item.description) + '</small>' : ''}
                    </td>
                    <td><span class="pt-cat-badge">${this.escapeHtml(item.category)}</span></td>
                    <td style="text-align:center">
                        <div class="pt-qty-controls">
                            <button class="pt-qty-btn" data-action="dec" data-id="${item.id}"><i class="fas fa-minus"></i></button>
                            <span class="pt-qty-val">${item.qty}</span>
                            <button class="pt-qty-btn" data-action="inc" data-id="${item.id}"><i class="fas fa-plus"></i></button>
                        </div>
                    </td>
                    <td style="text-align:right">${this.formatCurrency(item.unitPrice)}</td>
                    <td style="text-align:right"><strong>${this.formatCurrency(item.unitPrice * item.qty)}</strong></td>
                    <td style="text-align:center">
                        <button class="pt-remove-btn" data-id="${item.id}" title="Remove"><i class="fas fa-trash-alt"></i></button>
                    </td>
                </tr>
            `).join('');

            // qty buttons
            tbody.querySelectorAll('.pt-qty-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const item = ptBillItems.find(i => i.id === btn.dataset.id);
                    if (!item) return;
                    if (btn.dataset.action === 'inc') item.qty++;
                    else if (item.qty > 1) item.qty--;
                    else { ptBillItems = ptBillItems.filter(i => i.id !== btn.dataset.id); }
                    this._renderBillItems();
                    this._updateBillSummary();
                });
            });

            // remove
            tbody.querySelectorAll('.pt-remove-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    ptBillItems = ptBillItems.filter(i => i.id !== btn.dataset.id);
                    this._renderBillItems();
                    this._updateBillSummary();
                });
            });
        },

        _updateBillSummary: function () {
            const subtotal = ptBillItems.reduce((sum, i) => sum + (i.unitPrice * i.qty), 0);
            const totalQty = ptBillItems.reduce((sum, i) => sum + i.qty, 0);

            const discVal = parseFloat(document.getElementById('pt-b-discount')?.value) || 0;
            const discType = document.getElementById('pt-b-disc-type')?.value || 'amount';
            let discount = 0;
            if (discVal > 0) {
                discount = discType === 'percent' ? subtotal * (Math.min(discVal, 100) / 100) : Math.min(discVal, subtotal);
            }
            const total = Math.max(subtotal - discount, 0);

            const el = (id) => document.getElementById(id);
            if (el('pt-b-count')) el('pt-b-count').textContent = totalQty + ' service' + (totalQty !== 1 ? 's' : '');
            if (el('pt-b-subtotal')) el('pt-b-subtotal').textContent = this.formatCurrency(subtotal);
            if (el('pt-b-total')) el('pt-b-total').textContent = this.formatCurrency(total);

            const submitBtn = document.getElementById('pt-submit-bill');
            if (submitBtn) submitBtn.disabled = ptBillItems.length === 0 || !this._selectedPatient;
        },

        _submitBill: async function (businessId) {
            if (!businessId) { this.showToast('No business assigned', 'error'); return; }
            if (!this._selectedPatient) { this.showToast('Select a patient first', 'error'); return; }
            if (ptBillItems.length === 0) { this.showToast('Add at least one service', 'error'); return; }

            const submitBtn = document.getElementById('pt-submit-bill');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...'; }

            try {
                const subtotal = ptBillItems.reduce((sum, i) => sum + (i.unitPrice * i.qty), 0);
                const discVal = parseFloat(document.getElementById('pt-b-discount')?.value) || 0;
                const discType = document.getElementById('pt-b-disc-type')?.value || 'amount';
                let discount = 0;
                if (discVal > 0) {
                    discount = discType === 'percent' ? subtotal * (Math.min(discVal, 100) / 100) : Math.min(discVal, subtotal);
                }
                const total = Math.max(subtotal - discount, 0);

                const payMethod = document.getElementById('pt-b-method')?.value || 'cash';
                const payStatus = document.getElementById('pt-b-pay-status')?.value || 'unpaid';
                const amountPaid = payStatus === 'paid' ? total : (payStatus === 'partial' ? (parseFloat(document.getElementById('pt-b-amount-paid')?.value) || 0) : 0);
                const balanceDue = Math.max(total - amountPaid, 0);

                const billId = this.generateId('BL');
                const pat = this._selectedPatient;

                const billData = {
                    billId: billId,
                    patient: {
                        id: pat.patientId || pat.id,
                        name: pat.fullName || '',
                        phone: pat.phone || '',
                        insurance: pat.insurance || '',
                        insuranceNo: pat.insuranceNo || ''
                    },
                    services: ptBillItems.map(item => ({
                        category: item.category,
                        name: item.name,
                        description: item.description || '',
                        quantity: item.qty,
                        unitPrice: item.unitPrice,
                        lineTotal: item.unitPrice * item.qty
                    })),
                    serviceCount: ptBillItems.reduce((s, i) => s + i.qty, 0),
                    subtotal: subtotal,
                    discountValue: discVal,
                    discountType: discType,
                    discountAmount: discount,
                    total: total,
                    paymentMethod: payMethod,
                    paymentStatus: payStatus,
                    amountPaid: amountPaid,
                    balanceDue: balanceDue,
                    notes: (document.getElementById('pt-b-notes')?.value || '').trim(),
                    status: 'active',
                    createdBy: this.getCurrentUser(),
                    createdByUid: firebase.auth().currentUser ? firebase.auth().currentUser.uid : null,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                await getBusinessCollection(businessId, 'patient_bills').doc(billId).set(billData);

                // Update patient totals
                await getBusinessCollection(businessId, 'patients').doc(pat.patientId || pat.id).update({
                    totalBilled: firebase.firestore.FieldValue.increment(total),
                    totalPaid: firebase.firestore.FieldValue.increment(amountPaid),
                    visitCount: firebase.firestore.FieldValue.increment(1),
                    updatedAt: new Date().toISOString()
                });

                this.showToast('Bill ' + billId + ' generated!');

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Patient Bill Generated',
                        description: 'Bill ' + billId + ' for ' + (pat.fullName || 'patient') + ' — ' + this.formatCurrency(total),
                        category: 'Billing',
                        status: 'COMPLETED',
                        amount: total,
                        metadata: { billId: billId, patientId: pat.patientId || pat.id, patientName: pat.fullName, total: total, services: ptBillItems.length }
                    });
                }

                this._showBillInvoice(billData);

                // Reset
                ptBillItems = [];
                this._renderBillItems();
                this._updateBillSummary();
                document.getElementById('pt-b-discount').value = '0';
                document.getElementById('pt-b-notes').value = '';

            } catch (err) {
                console.error('Submit bill error:', err);
                this.showToast('Failed: ' + err.message, 'error');
            } finally {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-file-invoice-dollar"></i> Generate Bill'; }
            }
        },

        /* ── Subscribe to bills for recent list ── */
        _subscribeBills: function (businessId) {
            if (ptUnsubBilling) { ptUnsubBilling(); ptUnsubBilling = null; }
            if (!businessId) return;
            const col = getBusinessCollection(businessId, 'patient_bills');
            if (!col) return;

            ptUnsubBilling = col.orderBy('createdAt', 'desc').limit(20).onSnapshot(snap => {
                ptAllBills = [];
                snap.forEach(doc => ptAllBills.push({ id: doc.id, ...doc.data() }));
                this._renderRecentBills();
            }, err => console.error('Bills listener error:', err));
        },

        _renderRecentBills: function () {
            const wrap = document.getElementById('pt-recent-bills');
            if (!wrap) return;

            if (ptAllBills.length === 0) {
                wrap.innerHTML = '<div class="pt-empty-box" style="padding:24px;"><i class="fas fa-file-invoice"></i><p>No bills yet</p></div>';
                return;
            }

            wrap.innerHTML = ptAllBills.map(b => {
                const dateStr = b.createdAt ? new Date(b.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' }) : '';
                const payBadge = b.paymentStatus === 'paid' ? 'pt-badge--green' : (b.paymentStatus === 'partial' ? 'pt-badge--orange' : 'pt-badge--red');
                return `
                    <div class="pt-recent-bill-item" data-id="${b.billId || b.id}">
                        <div class="pt-rb-left">
                            <strong>${this.escapeHtml(b.patient?.name || 'Unknown')}</strong>
                            <small>${this.escapeHtml(b.billId || b.id)} · ${dateStr}</small>
                        </div>
                        <div class="pt-rb-right">
                            <span class="pt-rb-amount">${this.formatCurrency(b.total)}</span>
                            <span class="pt-badge ${payBadge}">${b.paymentStatus || 'unpaid'}</span>
                        </div>
                    </div>
                `;
            }).join('');

            wrap.querySelectorAll('.pt-recent-bill-item').forEach(item => {
                item.addEventListener('click', () => {
                    const bill = ptAllBills.find(b => (b.billId || b.id) === item.dataset.id);
                    if (bill) this._showBillInvoice(bill);
                });
            });
        },

        /* ══════════════════════════════════════════
         * BILL INVOICE & PRINT
         * ══════════════════════════════════════════ */

        _showBillInvoice: function (bill) {
            const existing = document.getElementById('pt-invoice-modal');
            if (existing) existing.remove();

            const dateStr = bill.createdAt ? new Date(bill.createdAt).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

            const servicesHtml = (bill.services || []).map((s, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td>
                        ${this.escapeHtml(s.name)}
                        ${s.description ? '<br><small style="color:#888;">' + this.escapeHtml(s.description) + '</small>' : ''}
                    </td>
                    <td>${this.escapeHtml(s.category)}</td>
                    <td style="text-align:center">${s.quantity}</td>
                    <td style="text-align:right">${this.formatCurrency(s.unitPrice)}</td>
                    <td style="text-align:right">${this.formatCurrency(s.lineTotal)}</td>
                </tr>
            `).join('');

            const modal = document.createElement('div');
            modal.className = 'pt-modal-overlay';
            modal.id = 'pt-invoice-modal';
            modal.innerHTML = `
                <div class="pt-invoice-container">
                    <div class="pt-invoice" id="pt-invoice-content">
                        <!-- Header -->
                        <div class="pt-inv-header">
                            <div class="pt-inv-brand">
                                <div class="pt-inv-logo"><i class="${PharmaFlow.Settings ? PharmaFlow.Settings.getLogoIcon() : 'fas fa-capsules'}"></i><h2>${PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow'}</h2></div>
                                <p class="pt-inv-tagline">${PharmaFlow.Settings ? PharmaFlow.Settings.getTagline() : 'Pharmacy Management System'}</p>
                            </div>
                            <div class="pt-inv-title-block">
                                <h1 class="pt-inv-title">PATIENT BILL</h1>
                                <div class="pt-inv-meta">
                                    <span><strong>Bill #:</strong> ${this.escapeHtml(bill.billId || '')}</span>
                                    <span><strong>Date:</strong> ${dateStr}</span>
                                </div>
                            </div>
                        </div>

                        <!-- Patient -->
                        <div class="pt-inv-parties">
                            <div class="pt-inv-party">
                                <h4>Patient:</h4>
                                <strong>${this.escapeHtml(bill.patient?.name || 'N/A')}</strong>
                                ${bill.patient?.phone ? '<br>' + this.escapeHtml(bill.patient.phone) : ''}
                                ${bill.patient?.insurance ? '<br>Insurance: ' + this.escapeHtml(bill.patient.insurance) : ''}
                                ${bill.patient?.insuranceNo ? ' (' + this.escapeHtml(bill.patient.insuranceNo) + ')' : ''}
                            </div>
                            <div class="pt-inv-party pt-inv-party--right">
                                <h4>Provider:</h4>
                                <strong>${PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow'}</strong>
                                <br>${this.escapeHtml(bill.createdBy || 'Staff')}
                            </div>
                        </div>

                        <!-- Services Table -->
                        <table class="pt-inv-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Service</th>
                                    <th>Category</th>
                                    <th style="text-align:center">Qty</th>
                                    <th style="text-align:right">Price</th>
                                    <th style="text-align:right">Amount</th>
                                </tr>
                            </thead>
                            <tbody>${servicesHtml}</tbody>
                        </table>

                        <!-- Totals -->
                        <div class="pt-inv-totals">
                            <div class="pt-inv-totals-table">
                                <div class="pt-inv-total-row"><span>Subtotal</span><span>${this.formatCurrency(bill.subtotal)}</span></div>
                                ${bill.discountAmount > 0 ? '<div class="pt-inv-total-row"><span>Discount' + (bill.discountType === 'percent' ? ' (' + bill.discountValue + '%)' : '') + '</span><span>- ' + this.formatCurrency(bill.discountAmount) + '</span></div>' : ''}
                                <div class="pt-inv-total-row pt-inv-grand-total"><span>TOTAL</span><span>${this.formatCurrency(bill.total)}</span></div>
                                <div class="pt-inv-total-row"><span>Amount Paid</span><span>${this.formatCurrency(bill.amountPaid || 0)}</span></div>
                                ${(bill.balanceDue || 0) > 0 ? '<div class="pt-inv-total-row pt-inv-balance-due"><span>Balance Due</span><span>' + this.formatCurrency(bill.balanceDue) + '</span></div>' : ''}
                            </div>
                        </div>

                        <div class="pt-inv-payment-info">
                            <span><strong>Payment:</strong> ${this.escapeHtml((bill.paymentMethod || 'N/A').replace('_', ' ').toUpperCase())}</span>
                            <span><strong>Status:</strong> ${this.escapeHtml((bill.paymentStatus || 'N/A').toUpperCase())}</span>
                        </div>

                        ${bill.notes ? '<div class="pt-inv-notes"><h4>Notes:</h4><p>' + this.escapeHtml(bill.notes) + '</p></div>' : ''}

                        <div class="pt-inv-footer">
                            <p>${PharmaFlow.Settings ? PharmaFlow.Settings.getReceiptFooter() : 'Thank you for your purchase!'}</p>
                            <small>${PharmaFlow.Settings ? PharmaFlow.Settings.getInvoiceGenerated() : 'Generated by PharmaFlow Pharmacy Management System'}</small>
                        </div>
                    </div>

                    <div class="pt-invoice-actions">
                        <button class="btn btn-primary" id="pt-print-bill"><i class="fas fa-print"></i> Print</button>
                        <button class="btn btn-outline" id="pt-close-bill"><i class="fas fa-times"></i> Close</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            const close = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            document.getElementById('pt-close-bill').addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            document.getElementById('pt-print-bill').addEventListener('click', () => this._printBill(bill));
        },

        _printBill: function (bill) {
            const content = document.getElementById('pt-invoice-content');
            if (!content) return;

            const printWin = window.open('', '_blank', 'width=800,height=1000');
            printWin.document.write(`
                <html><head><title>Bill - ${this.escapeHtml(bill.billId || '')}</title>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
                <style>
                    * { margin:0; padding:0; box-sizing:border-box; }
                    body { font-family:'Segoe UI',Arial,sans-serif; padding:30px; max-width:800px; margin:0 auto; color:#1e293b; }
                    .pt-inv-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:28px; padding-bottom:18px; border-bottom:3px solid #2563eb; }
                    .pt-inv-logo { display:flex; align-items:center; gap:10px; }
                    .pt-inv-logo i { font-size:1.8rem; color:#2563eb; }
                    .pt-inv-logo h2 { font-size:1.5rem; color:#2563eb; margin:0; }
                    .pt-inv-tagline { font-size:0.78rem; color:#64748b; margin-top:4px; }
                    .pt-inv-title { font-size:1.8rem; color:#2563eb; text-align:right; letter-spacing:3px; margin:0; }
                    .pt-inv-meta { display:flex; flex-direction:column; gap:3px; text-align:right; font-size:0.82rem; margin-top:8px; color:#475569; }
                    .pt-inv-parties { display:flex; justify-content:space-between; margin-bottom:22px; gap:40px; }
                    .pt-inv-party { font-size:0.85rem; line-height:1.7; }
                    .pt-inv-party h4 { font-size:0.76rem; text-transform:uppercase; letter-spacing:1px; color:#2563eb; margin-bottom:5px; font-weight:700; }
                    .pt-inv-party--right { text-align:right; }
                    .pt-inv-table { width:100%; border-collapse:collapse; margin-bottom:20px; font-size:0.85rem; }
                    .pt-inv-table th { background:#f1f5f9; padding:10px 12px; text-align:left; font-weight:700; border-bottom:2px solid #e2e8f0; font-size:0.76rem; text-transform:uppercase; letter-spacing:0.5px; color:#475569; }
                    .pt-inv-table td { padding:10px 12px; border-bottom:1px solid #f1f5f9; }
                    .pt-inv-totals { display:flex; justify-content:flex-end; margin-bottom:18px; }
                    .pt-inv-totals-table { width:280px; }
                    .pt-inv-total-row { display:flex; justify-content:space-between; padding:5px 0; font-size:0.88rem; color:#475569; }
                    .pt-inv-grand-total { font-size:1.1rem; font-weight:800; color:#2563eb; border-top:2px solid #2563eb; border-bottom:2px solid #2563eb; padding:10px 0; margin:6px 0; }
                    .pt-inv-balance-due { color:#dc2626; font-weight:700; }
                    .pt-inv-payment-info { display:flex; gap:30px; font-size:0.82rem; padding:12px 0; border-top:1px solid #e2e8f0; margin-bottom:14px; color:#475569; }
                    .pt-inv-notes { background:#f8fafc; padding:12px; border-radius:6px; margin-bottom:18px; font-size:0.82rem; }
                    .pt-inv-notes h4 { font-size:0.76rem; text-transform:uppercase; letter-spacing:1px; color:#2563eb; margin-bottom:4px; }
                    .pt-inv-footer { text-align:center; padding-top:18px; border-top:1px solid #e2e8f0; font-size:0.84rem; color:#64748b; }
                    .pt-inv-footer small { display:block; margin-top:4px; font-size:0.72rem; }
                    @media print { body { padding:15px; } }
                </style></head><body>${content.innerHTML}</body></html>
            `);
            printWin.document.close();
            printWin.focus();
            setTimeout(() => printWin.print(), 400);
        },

        /* ══════════════════════════════════════════
         * 4) PATIENT MANAGEMENT MODAL
         * ══════════════════════════════════════════ */

        _mgmtTabConfig: {
            triage: {
                label: 'Triage', icon: 'fa-heartbeat', addLabel: 'Add Triage',
                fields: [
                    { key: 'bloodPressure', label: 'Blood Pressure', type: 'text', placeholder: '120/80 mmHg', required: true },
                    { key: 'heartRate', label: 'Heart Rate (bpm)', type: 'number', placeholder: '72' },
                    { key: 'temperature', label: 'Temperature (°C)', type: 'number', placeholder: '36.5', step: '0.1' },
                    { key: 'weight', label: 'Weight (kg)', type: 'number', placeholder: '70', step: '0.1' },
                    { key: 'height', label: 'Height (cm)', type: 'number', placeholder: '170' },
                    { key: 'spO2', label: 'SpO2 (%)', type: 'number', placeholder: '98' },
                    { key: 'respiratoryRate', label: 'Resp. Rate (/min)', type: 'number', placeholder: '16' },
                    { key: 'chiefComplaint', label: 'Chief Complaint', type: 'textarea', placeholder: 'Describe complaint...', full: true },
                    { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...', full: true }
                ],
                columns: [
                    { key: 'createdAt', label: 'Date', fmt: 'date' },
                    { key: 'bloodPressure', label: 'BP' },
                    { key: 'heartRate', label: 'HR' },
                    { key: 'temperature', label: 'Temp' },
                    { key: 'weight', label: 'Wt' },
                    { key: 'spO2', label: 'SpO2' },
                    { key: 'chiefComplaint', label: 'Complaint', truncate: 40 }
                ]
            },
            history: {
                label: 'Medical History', icon: 'fa-history', addLabel: 'Add Entry',
                fields: [
                    { key: 'condition', label: 'Condition / Diagnosis', type: 'text', placeholder: 'e.g. Hypertension', required: true },
                    { key: 'treatment', label: 'Treatment', type: 'text', placeholder: 'Treatment given' },
                    { key: 'startDate', label: 'Date of Onset', type: 'date' },
                    { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Resolved', 'Chronic', 'Managed'] },
                    { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Details...', full: true }
                ],
                columns: [
                    { key: 'createdAt', label: 'Recorded', fmt: 'date' },
                    { key: 'condition', label: 'Condition' },
                    { key: 'treatment', label: 'Treatment' },
                    { key: 'startDate', label: 'Since' },
                    { key: 'status', label: 'Status', badge: true }
                ]
            },
            lab: {
                label: 'Lab Tests', icon: 'fa-flask', addLabel: 'Add Lab Test',
                fields: [
                    { key: 'testName', label: 'Test Name', type: 'text', placeholder: 'e.g. CBC, Blood Sugar', required: true },
                    { key: 'category', label: 'Category', type: 'select', options: ['Blood Test', 'Urine Test', 'Stool Test', 'Swab', 'Culture', 'Pathology', 'Other'] },
                    { key: 'result', label: 'Result', type: 'text', placeholder: 'Test result' },
                    { key: 'referenceRange', label: 'Reference Range', type: 'text', placeholder: 'Normal range' },
                    { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Completed', 'Normal', 'Abnormal'] },
                    { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Notes...', full: true }
                ],
                columns: [
                    { key: 'createdAt', label: 'Date', fmt: 'date' },
                    { key: 'testName', label: 'Test' },
                    { key: 'category', label: 'Category' },
                    { key: 'result', label: 'Result' },
                    { key: 'status', label: 'Status', badge: true }
                ]
            },
            imaging: {
                label: 'Imaging Tests', icon: 'fa-x-ray', addLabel: 'Add Imaging',
                fields: [
                    { key: 'imagingType', label: 'Imaging Type', type: 'select', required: true, options: ['X-Ray', 'CT Scan', 'MRI', 'Ultrasound', 'Mammogram', 'Fluoroscopy', 'PET Scan', 'Other'] },
                    { key: 'bodyPart', label: 'Body Part / Region', type: 'text', placeholder: 'e.g. Chest, Abdomen', required: true },
                    { key: 'findings', label: 'Findings', type: 'textarea', placeholder: 'Imaging findings...', full: true },
                    { key: 'impression', label: 'Impression', type: 'textarea', placeholder: 'Radiologist impression...', full: true },
                    { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Completed', 'Normal', 'Abnormal'] },
                    { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Notes...', full: true }
                ],
                columns: [
                    { key: 'createdAt', label: 'Date', fmt: 'date' },
                    { key: 'imagingType', label: 'Type' },
                    { key: 'bodyPart', label: 'Body Part' },
                    { key: 'findings', label: 'Findings', truncate: 40 },
                    { key: 'status', label: 'Status', badge: true }
                ]
            },
            treatment: {
                label: 'Treatment / Prescription', icon: 'fa-prescription', addLabel: 'New Prescription',
                custom: true,
                fields: [],
                columns: [
                    { key: 'createdAt', label: 'Date', fmt: 'date' },
                    { key: 'doctorName', label: 'Doctor' },
                    { key: 'diagnosis', label: 'Diagnosis', truncate: 30 },
                    { key: 'drugsSummary', label: 'Drugs' },
                    { key: 'status', label: 'Status', badge: true }
                ]
            },
            specialist: {
                label: 'Specialist Clinic', icon: 'fa-user-md', addLabel: 'Add Referral',
                fields: [
                    { key: 'specialty', label: 'Specialty', type: 'select', required: true, options: ['Cardiology', 'Orthopedics', 'Neurology', 'Dermatology', 'ENT', 'Ophthalmology', 'Gynecology', 'Urology', 'Pediatrics', 'Psychiatry', 'Oncology', 'Pulmonology', 'Gastroenterology', 'Nephrology', 'Endocrinology', 'Other'] },
                    { key: 'doctorName', label: 'Doctor Name', type: 'text', placeholder: 'Dr. Name' },
                    { key: 'clinic', label: 'Clinic / Hospital', type: 'text', placeholder: 'Clinic name' },
                    { key: 'reason', label: 'Reason for Referral', type: 'textarea', placeholder: 'Why referred...', full: true },
                    { key: 'findings', label: 'Findings', type: 'textarea', placeholder: 'Specialist findings...', full: true },
                    { key: 'recommendation', label: 'Recommendation', type: 'textarea', placeholder: 'Recommendations...', full: true },
                    { key: 'nextVisit', label: 'Next Visit', type: 'date' }
                ],
                columns: [
                    { key: 'createdAt', label: 'Date', fmt: 'date' },
                    { key: 'specialty', label: 'Specialty' },
                    { key: 'doctorName', label: 'Doctor' },
                    { key: 'reason', label: 'Reason', truncate: 35 },
                    { key: 'nextVisit', label: 'Next Visit' }
                ]
            },
            followup: {
                label: 'Follow-up', icon: 'fa-calendar-check', addLabel: 'Schedule Follow-up',
                fields: [
                    { key: 'followUpDate', label: 'Follow-up Date', type: 'date', required: true },
                    { key: 'reason', label: 'Reason', type: 'text', placeholder: 'Reason for follow-up', required: true },
                    { key: 'status', label: 'Status', type: 'select', options: ['Scheduled', 'Completed', 'Missed', 'Cancelled'] },
                    { key: 'outcome', label: 'Outcome', type: 'textarea', placeholder: 'Follow-up outcome...', full: true },
                    { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Notes...', full: true }
                ],
                columns: [
                    { key: 'followUpDate', label: 'Date' },
                    { key: 'reason', label: 'Reason' },
                    { key: 'status', label: 'Status', badge: true },
                    { key: 'outcome', label: 'Outcome', truncate: 35 },
                    { key: 'createdAt', label: 'Created', fmt: 'date' }
                ]
            },
            notes: {
                label: 'Clinical Notes', icon: 'fa-sticky-note', addLabel: 'Add Note',
                fields: [
                    { key: 'noteType', label: 'Note Type', type: 'select', required: true, options: ['Clinical', 'Nursing', 'Progress', 'Discharge', 'Procedure', 'Consultation', 'Other'] },
                    { key: 'title', label: 'Title', type: 'text', placeholder: 'Note title', required: true },
                    { key: 'content', label: 'Content', type: 'textarea', placeholder: 'Write note content...', full: true, rows: 4 }
                ],
                columns: [
                    { key: 'createdAt', label: 'Date', fmt: 'date' },
                    { key: 'noteType', label: 'Type' },
                    { key: 'title', label: 'Title' },
                    { key: 'content', label: 'Content', truncate: 60 }
                ]
            }
        },

        _managePatient: async function (patientId) {
            const p = await this._fetchPatientById(patientId);
            if (!p) { this.showToast('Patient not found', 'error'); return; }
            const businessId = this.getBusinessId();
            if (!businessId) return;

            this._managedPatient = p;
            this._mgmtActiveTab = 'triage';
            this._mgmtBusinessId = businessId;
            ptManageRecords = [];

            const tabsHtml = Object.entries(this._mgmtTabConfig).map(function (entry) {
                const id = entry[0], cfg = entry[1];
                return '<button class="pt-mgmt-tab' + (id === 'triage' ? ' active' : '') + '" data-tab="' + id + '"><i class="fas ' + cfg.icon + '"></i><span>' + cfg.label + '</span></button>';
            }).join('');

            const modal = document.createElement('div');
            modal.className = 'pt-modal-overlay';
            modal.id = 'pt-manage-modal';
            modal.innerHTML = '<div class="pt-modal pt-modal--xl">' +
                '<div class="pt-modal-header">' +
                    '<div class="pt-mgmt-hdr-left">' +
                        '<div class="pt-mgmt-avatar">' + (p.firstName || '?')[0].toUpperCase() + '</div>' +
                        '<div><h3>' + this.escapeHtml(p.fullName || '') + '</h3>' +
                        '<small>' + this.escapeHtml(p.patientId || p.id) + ' &middot; ' + this.escapeHtml(p.phone || '') +
                        (p.insurance ? ' &middot; ' + this.escapeHtml(p.insurance) : '') + '</small></div>' +
                    '</div>' +
                    '<div class="pt-mgmt-hdr-right">' +
                        '<button class="btn btn-sm btn-primary" id="pt-mgmt-print-all"><i class="fas fa-file-medical-alt"></i> Full Report</button>' +
                        '<button class="pt-modal-close" title="Close"><i class="fas fa-times"></i></button>' +
                    '</div>' +
                '</div>' +
                '<div class="pt-mgmt-tabs">' + tabsHtml + '</div>' +
                '<div class="pt-mgmt-body" id="pt-mgmt-body"><div class="pt-loading"><div class="spinner"></div> Loading records...</div></div>' +
            '</div>';

            document.body.appendChild(modal);
            setTimeout(function () { modal.classList.add('show'); }, 10);

            var self = this;
            var close = function () {
                if (ptUnsubRecords) { ptUnsubRecords(); ptUnsubRecords = null; }
                ptManageRecords = [];
                self._managedPatient = null;
                modal.classList.remove('show');
                setTimeout(function () { modal.remove(); }, 200);
            };
            modal.querySelector('.pt-modal-close').addEventListener('click', close);
            modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

            modal.querySelectorAll('.pt-mgmt-tab').forEach(function (tab) {
                tab.addEventListener('click', function () {
                    modal.querySelectorAll('.pt-mgmt-tab').forEach(function (t) { t.classList.remove('active'); });
                    tab.classList.add('active');
                    self._mgmtActiveTab = tab.dataset.tab;
                    self._renderMgmtTab();
                });
            });

            document.getElementById('pt-mgmt-print-all').addEventListener('click', function () { self._printFullReport(p); });
            this._subscribeMgmtRecords(businessId, p.patientId || p.id);
        },

        _subscribeMgmtRecords: function (businessId, patientId) {
            if (ptUnsubRecords) { ptUnsubRecords(); ptUnsubRecords = null; }
            if (!businessId || !patientId) return;
            var col = getBusinessCollection(businessId, 'patient_records');
            if (!col) return;
            var self = this;

            ptUnsubRecords = col.where('patientId', '==', patientId).onSnapshot(function (snap) {
                ptManageRecords = [];
                snap.forEach(function (doc) { ptManageRecords.push(Object.assign({ id: doc.id }, doc.data())); });
                ptManageRecords.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
                self._renderMgmtTab();
            }, function (err) { console.error('Mgmt records error:', err); });
        },

        _renderMgmtTab: function () {
            var body = document.getElementById('pt-mgmt-body');
            if (!body) return;
            var tabId = this._mgmtActiveTab || 'triage';
            var config = this._mgmtTabConfig[tabId];
            if (!config) return;

            // Treatment tab uses custom renderer
            if (tabId === 'treatment') {
                this._renderTreatmentTab(body);
                return;
            }
            var self = this;

            var records = ptManageRecords.filter(function (r) { return r.recordType === tabId; });

            // Build form fields
            var fieldsHtml = config.fields.map(function (f) {
                var fullCls = f.full ? ' pt-span-2' : '';
                var input = '';
                if (f.type === 'textarea') {
                    input = '<textarea id="pt-mgmt-' + f.key + '" rows="' + (f.rows || 2) + '" placeholder="' + self.escapeHtml(f.placeholder || '') + '" class="pt-textarea"' + (f.required ? ' required' : '') + '></textarea>';
                } else if (f.type === 'select') {
                    input = '<select id="pt-mgmt-' + f.key + '"' + (f.required ? ' required' : '') + '><option value="">Select</option>' +
                        (f.options || []).map(function (o) { return '<option value="' + self.escapeHtml(o) + '">' + self.escapeHtml(o) + '</option>'; }).join('') + '</select>';
                } else {
                    input = '<input type="' + (f.type || 'text') + '" id="pt-mgmt-' + f.key + '" placeholder="' + self.escapeHtml(f.placeholder || '') + '"' +
                        (f.step ? ' step="' + f.step + '"' : '') + (f.required ? ' required' : '') + '>';
                }
                return '<div class="form-group' + fullCls + '"><label>' + f.label + (f.required ? ' <span class="required">*</span>' : '') + '</label>' + input + '</div>';
            }).join('');

            // Build records table
            var tableHtml = '';
            if (records.length === 0) {
                tableHtml = '<div class="pt-empty-box"><i class="fas ' + config.icon + '"></i><p>No ' + config.label.toLowerCase() + ' records</p><span>Click "' + config.addLabel + '" to add one</span></div>';
            } else {
                var headers = config.columns.map(function (c) { return '<th>' + self.escapeHtml(c.label) + '</th>'; }).join('') + '<th style="text-align:center;width:50px"></th>';
                var rows = records.map(function (r) {
                    var cells = config.columns.map(function (c) {
                        var val = r[c.key] != null && r[c.key] !== '' ? String(r[c.key]) : '-';
                        if (c.fmt === 'date' && val !== '-') {
                            try { val = new Date(val).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (e) { /* keep raw */ }
                        }
                        if (c.truncate && val.length > c.truncate) val = val.substring(0, c.truncate) + '…';
                        if (c.badge) {
                            var cls = (val === 'Active' || val === 'Completed' || val === 'Normal' || val === 'Resolved' || val === 'Managed') ? 'pt-badge--green' :
                                      (val === 'Abnormal' || val === 'Missed' || val === 'Cancelled') ? 'pt-badge--red' :
                                      (val === 'Pending' || val === 'Scheduled' || val === 'Chronic') ? 'pt-badge--orange' : 'pt-badge--blue';
                            return '<td><span class="pt-badge ' + cls + '">' + self.escapeHtml(val) + '</span></td>';
                        }
                        return '<td>' + self.escapeHtml(val) + '</td>';
                    }).join('');
                    return '<tr>' + cells + '<td style="text-align:center"><button class="pt-remove-btn pt-mgmt-del" data-id="' + r.id + '" title="Delete"><i class="fas fa-trash-alt"></i></button></td></tr>';
                }).join('');
                tableHtml = '<div class="pt-table-wrap"><table class="pt-table"><thead><tr>' + headers + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
            }

            body.innerHTML =
                '<div class="pt-mgmt-toolbar">' +
                    '<span class="pt-mgmt-count"><strong>' + records.length + '</strong> record' + (records.length !== 1 ? 's' : '') + '</span>' +
                    '<div class="pt-mgmt-toolbar-right">' +
                        '<button class="btn btn-sm btn-outline" id="pt-mgmt-print-tab"><i class="fas fa-print"></i> Print ' + self.escapeHtml(config.label) + '</button>' +
                        '<button class="btn btn-sm btn-primary" id="pt-mgmt-add-btn"><i class="fas fa-plus"></i> ' + self.escapeHtml(config.addLabel) + '</button>' +
                    '</div>' +
                '</div>' +
                '<div class="pt-mgmt-add-form" id="pt-mgmt-add-form" style="display:none;">' +
                    '<div class="card pt-card">' +
                        '<div class="card-header"><span class="card-title"><i class="fas ' + config.icon + '"></i> ' + self.escapeHtml(config.addLabel) + '</span></div>' +
                        '<div class="pt-form-grid">' + fieldsHtml + '</div>' +
                        '<div class="pt-form-actions">' +
                            '<button class="btn btn-sm btn-primary" id="pt-mgmt-save"><i class="fas fa-save"></i> Save</button>' +
                            '<button class="btn btn-sm btn-outline" id="pt-mgmt-cancel">Cancel</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="pt-mgmt-records">' + tableHtml + '</div>';

            // Bind events
            document.getElementById('pt-mgmt-add-btn').addEventListener('click', function () {
                var form = document.getElementById('pt-mgmt-add-form');
                if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
            });
            document.getElementById('pt-mgmt-cancel').addEventListener('click', function () {
                document.getElementById('pt-mgmt-add-form').style.display = 'none';
            });
            document.getElementById('pt-mgmt-save').addEventListener('click', function () { self._saveMgmtRecord(tabId); });
            document.getElementById('pt-mgmt-print-tab').addEventListener('click', function () { self._printTabReceipt(tabId, records); });

            body.querySelectorAll('.pt-mgmt-del').forEach(function (btn) {
                btn.addEventListener('click', function () { self._deleteMgmtRecord(btn.dataset.id); });
            });
        },

        _saveMgmtRecord: async function (tabId) {
            var businessId = this._mgmtBusinessId;
            var patient = this._managedPatient;
            if (!businessId || !patient) return;
            var config = this._mgmtTabConfig[tabId];
            if (!config) return;

            var data = { recordType: tabId, patientId: patient.patientId || patient.id };
            var valid = true;
            config.fields.forEach(function (f) {
                var el = document.getElementById('pt-mgmt-' + f.key);
                if (!el) return;
                var val = (el.value || '').trim();
                if (f.required && !val) valid = false;
                data[f.key] = f.type === 'number' ? (val !== '' ? parseFloat(val) : '') : val;
            });

            if (!valid) { this.showToast('Fill in required fields', 'error'); return; }

            var saveBtn = document.getElementById('pt-mgmt-save');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

            try {
                var recordId = this.generateId(tabId.substring(0, 2).toUpperCase());
                data.recordId = recordId;
                data.createdBy = this.getCurrentUser();
                data.createdAt = new Date().toISOString();

                if (tabId === 'triage' && data.weight && data.height) {
                    var hm = data.height / 100;
                    if (hm > 0) data.bmi = (data.weight / (hm * hm)).toFixed(1);
                }

                await getBusinessCollection(businessId, 'patient_records').doc(recordId).set(data);

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: config.label + ' Record Saved',
                        description: config.label + ' record for patient ' + (patient.fullName || patient.patientId || patient.id),
                        category: 'Patient',
                        status: 'COMPLETED',
                        metadata: { recordId: recordId, recordType: tabId, patientId: patient.patientId || patient.id }
                    });
                }

                this.showToast(config.label + ' record saved!');
                document.getElementById('pt-mgmt-add-form').style.display = 'none';
            } catch (err) {
                console.error('Save mgmt record error:', err);
                this.showToast('Failed: ' + err.message, 'error');
            } finally {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; }
            }
        },

        _deleteMgmtRecord: async function (recordId) {
            if (!recordId) return;
            var businessId = this._mgmtBusinessId;
            if (!businessId) return;
            if (!(await PharmaFlow.confirm('Delete this record?', { title: 'Delete Record', confirmText: 'Delete', danger: true }))) return;

            try {
                await getBusinessCollection(businessId, 'patient_records').doc(recordId).delete();
                this.showToast('Record deleted');
            } catch (err) {
                this.showToast('Failed: ' + err.message, 'error');
            }
        },

        /* ══════════════════════════════════════════
         * TREATMENT / PRESCRIPTION TAB
         * ══════════════════════════════════════════ */

        _loadInventory: function () {
            var businessId = this._mgmtBusinessId;
            if (!businessId || ptInventoryCache.length > 0) return;
            var col = getBusinessCollection(businessId, 'inventory');
            if (!col) return;
            col.get().then(function (snap) {
                ptInventoryCache = [];
                snap.forEach(function (doc) { ptInventoryCache.push(Object.assign({ id: doc.id }, doc.data())); });
            }).catch(function (err) { console.error('Inventory load error:', err); });
        },

        _renderTreatmentTab: function (body) {
            var self = this;
            var records = ptManageRecords.filter(function (r) { return r.recordType === 'treatment'; });
            this._loadInventory();

            // Build records table
            var tableHtml = '';
            if (records.length === 0) {
                tableHtml = '<div class="pt-empty-box"><i class="fas fa-prescription"></i><p>No prescriptions yet</p><span>Click "New Prescription" to create one</span></div>';
            } else {
                var rows = records.map(function (r) {
                    var dateStr = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
                    var timeStr = r.visitTime || '-';
                    var drugCount = (r.drugs || []).length;
                    var drugNames = (r.drugs || []).map(function (d) { return d.drugName; }).join(', ');
                    if (drugNames.length > 50) drugNames = drugNames.substring(0, 50) + '…';
                    var statusCls = r.status === 'Dispensed' ? 'pt-badge--green' : r.status === 'Cancelled' ? 'pt-badge--red' : 'pt-badge--orange';
                    return '<tr>' +
                        '<td><small>' + self.escapeHtml(dateStr) + '</small><br><small style="color:var(--text-tertiary)">' + self.escapeHtml(timeStr) + '</small></td>' +
                        '<td><strong>' + self.escapeHtml(r.doctorName || '-') + '</strong></td>' +
                        '<td>' + self.escapeHtml(r.diagnosis || '-') + '</td>' +
                        '<td><span class="pt-cat-badge">' + drugCount + ' drug' + (drugCount !== 1 ? 's' : '') + '</span><br><small style="color:var(--text-tertiary)">' + self.escapeHtml(drugNames) + '</small></td>' +
                        '<td><span class="pt-badge ' + statusCls + '">' + self.escapeHtml(r.status || 'Pending') + '</span></td>' +
                        '<td style="text-align:center">' +
                            '<div class="pt-action-group" style="justify-content:center">' +
                                '<button class="pt-action-btn pt-act--view pt-rx-view" data-id="' + r.id + '" title="View"><i class="fas fa-eye"></i></button>' +
                                '<button class="pt-remove-btn pt-mgmt-del" data-id="' + r.id + '" title="Delete"><i class="fas fa-trash-alt"></i></button>' +
                            '</div>' +
                        '</td></tr>';
                }).join('');
                tableHtml = '<div class="pt-table-wrap"><table class="pt-table"><thead><tr>' +
                    '<th>Date / Time</th><th>Doctor</th><th>Diagnosis</th><th>Drugs</th><th>Status</th><th style="text-align:center;width:80px"></th>' +
                    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
            }

            body.innerHTML =
                '<div class="pt-mgmt-toolbar">' +
                    '<span class="pt-mgmt-count"><strong>' + records.length + '</strong> prescription' + (records.length !== 1 ? 's' : '') + '</span>' +
                    '<div class="pt-mgmt-toolbar-right">' +
                        '<button class="btn btn-sm btn-outline" id="pt-mgmt-print-tab"><i class="fas fa-print"></i> Print Prescriptions</button>' +
                        '<button class="btn btn-sm btn-primary" id="pt-mgmt-add-btn"><i class="fas fa-plus"></i> New Prescription</button>' +
                    '</div>' +
                '</div>' +
                '<div class="pt-mgmt-add-form" id="pt-mgmt-add-form" style="display:none;">' +
                    '<div class="card pt-card">' +
                        '<div class="card-header"><span class="card-title"><i class="fas fa-prescription"></i> New Prescription</span></div>' +
                        '<div class="pt-rx-form">' +
                            '<div class="pt-form-grid">' +
                                '<div class="form-group"><label>Doctor Name <span class="required">*</span></label><input type="text" id="pt-rx-doctor" placeholder="Dr. Name" required></div>' +
                                '<div class="form-group"><label>Visit Time</label><input type="time" id="pt-rx-time"></div>' +
                                '<div class="form-group"><label>Diagnosis <span class="required">*</span></label><input type="text" id="pt-rx-diagnosis" placeholder="Diagnosis" required></div>' +
                                '<div class="form-group"><label>Status</label><select id="pt-rx-status"><option value="Pending">Pending</option><option value="Dispensed">Dispensed</option><option value="Cancelled">Cancelled</option></select></div>' +
                                '<div class="form-group pt-span-2"><label>Clinical Notes</label><textarea id="pt-rx-notes" rows="2" class="pt-textarea" placeholder="Notes..."></textarea></div>' +
                            '</div>' +
                            '<div class="pt-rx-drugs-section">' +
                                '<h4>Drugs / Medications</h4>' +
                                '<div class="pt-rx-drug-entry">' +
                                    '<div class="pt-rx-drug-search-wrap">' +
                                        '<div class="pt-search-bar"><i class="fas fa-search"></i><input type="text" id="pt-rx-drug-search" placeholder="Search drug from inventory..." autocomplete="off"></div>' +
                                        '<div class="pt-rx-drug-dropdown" id="pt-rx-drug-dropdown"></div>' +
                                    '</div>' +
                                    '<div class="pt-rx-drug-fields" id="pt-rx-drug-fields" style="display:none;">' +
                                        '<div class="pt-rx-selected-drug" id="pt-rx-selected-drug"></div>' +
                                        '<div class="pt-rx-drug-grid">' +
                                            '<div class="form-group"><label>Dosage</label><input type="text" id="pt-rx-drug-dosage" placeholder="e.g. 500mg"></div>' +
                                            '<div class="form-group"><label>Frequency</label><select id="pt-rx-drug-freq"><option value="OD">OD (Once daily)</option><option value="BD">BD (Twice daily)</option><option value="TDS">TDS (3x daily)</option><option value="QDS">QDS (4x daily)</option><option value="STAT">STAT (Immediately)</option><option value="PRN">PRN (As needed)</option><option value="Nocte">Nocte (At night)</option><option value="Mane">Mane (Morning)</option><option value="Other">Other</option></select></div>' +
                                            '<div class="form-group"><label>Duration</label><input type="text" id="pt-rx-drug-duration" placeholder="e.g. 7 days"></div>' +
                                            '<div class="form-group"><label>Quantity</label><input type="number" id="pt-rx-drug-qty" min="1" value="1"></div>' +
                                            '<div class="form-group"><label>Route</label><select id="pt-rx-drug-route"><option value="Oral">Oral</option><option value="IV">IV</option><option value="IM">IM</option><option value="SC">SC</option><option value="Topical">Topical</option><option value="Rectal">Rectal</option><option value="Inhaled">Inhaled</option><option value="Sublingual">Sublingual</option><option value="Other">Other</option></select></div>' +
                                            '<div class="form-group"><label>Instructions</label><input type="text" id="pt-rx-drug-instr" placeholder="e.g. After meals"></div>' +
                                        '</div>' +
                                        '<div class="pt-rx-drug-actions">' +
                                            '<button class="btn btn-sm btn-primary" id="pt-rx-add-drug"><i class="fas fa-plus"></i> Add Drug</button>' +
                                            '<button class="btn btn-sm btn-outline" id="pt-rx-clear-drug">Clear</button>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>' +
                                '<div class="pt-rx-drugs-list" id="pt-rx-drugs-list"></div>' +
                            '</div>' +
                            '<div class="pt-form-actions">' +
                                '<button class="btn btn-primary" id="pt-rx-save" disabled><i class="fas fa-save"></i> Save Prescription</button>' +
                                '<button class="btn btn-outline" id="pt-mgmt-cancel">Cancel</button>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="pt-mgmt-records">' + tableHtml + '</div>';

            // Reset drugs list for new entry
            ptTreatmentDrugs = [];
            this._renderRxDrugsList();

            // Bind events
            document.getElementById('pt-mgmt-add-btn').addEventListener('click', function () {
                var form = document.getElementById('pt-mgmt-add-form');
                if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
            });
            document.getElementById('pt-mgmt-cancel').addEventListener('click', function () {
                document.getElementById('pt-mgmt-add-form').style.display = 'none';
            });

            // Drug search
            var searchInput = document.getElementById('pt-rx-drug-search');
            var dropdown = document.getElementById('pt-rx-drug-dropdown');
            if (searchInput && dropdown) {
                var debounce;
                searchInput.addEventListener('input', function () {
                    clearTimeout(debounce);
                    debounce = setTimeout(function () { self._searchInventory(searchInput.value, dropdown); }, 180);
                });
                searchInput.addEventListener('focus', function () {
                    if (this.value.trim().length >= 1) self._searchInventory(this.value, dropdown);
                });
                document.addEventListener('click', function (e) {
                    if (!dropdown.contains(e.target) && e.target !== searchInput) dropdown.classList.remove('show');
                });
            }

            document.getElementById('pt-rx-add-drug').addEventListener('click', function () { self._addRxDrug(); });
            document.getElementById('pt-rx-clear-drug').addEventListener('click', function () { self._clearRxDrugFields(); });
            document.getElementById('pt-rx-save').addEventListener('click', function () { self._saveTreatmentRecord(); });
            document.getElementById('pt-mgmt-print-tab').addEventListener('click', function () { self._printTabReceipt('treatment', records); });

            body.querySelectorAll('.pt-mgmt-del').forEach(function (btn) {
                btn.addEventListener('click', function () { self._deleteMgmtRecord(btn.dataset.id); });
            });
            body.querySelectorAll('.pt-rx-view').forEach(function (btn) {
                btn.addEventListener('click', function () { self._viewPrescription(btn.dataset.id); });
            });
        },

        _searchInventory: function (query, dropdown) {
            var q = (query || '').toLowerCase().trim();
            if (q.length < 1) { dropdown.classList.remove('show'); return; }

            var results = ptInventoryCache.filter(function (item) {
                var hay = ((item.name || '') + ' ' + (item.category || '') + ' ' + (item.sku || '') + ' ' + (item.dosage || '')).toLowerCase();
                return hay.includes(q) && (item.quantity || 0) > 0;
            }).slice(0, 10);

            if (results.length === 0) {
                dropdown.innerHTML = '<div class="pt-dd-empty"><i class="fas fa-search"></i> No drugs found in inventory</div>';
                dropdown.classList.add('show');
                return;
            }

            var self = this;
            dropdown.innerHTML = results.map(function (item) {
                return '<div class="pt-dd-item pt-rx-dd-item" data-id="' + item.id + '">' +
                    '<div class="pt-rx-dd-icon"><i class="fas fa-pills"></i></div>' +
                    '<div class="pt-dd-info">' +
                        '<strong>' + self.escapeHtml(item.name || '') + '</strong>' +
                        '<small>' + self.escapeHtml((item.dosage || '') + ' · ' + (item.category || '') + ' · Stock: ' + (item.quantity || 0) + ' ' + (item.unit || '')) + '</small>' +
                    '</div>' +
                    '<span class="pt-rx-dd-price">' + self.formatCurrency(item.sellingPrice || 0) + '</span>' +
                '</div>';
            }).join('');

            dropdown.classList.add('show');

            dropdown.querySelectorAll('.pt-rx-dd-item').forEach(function (el) {
                el.addEventListener('click', function () {
                    var item = ptInventoryCache.find(function (i) { return i.id === el.dataset.id; });
                    if (item) self._selectRxDrug(item);
                    dropdown.classList.remove('show');
                });
            });
        },

        _rxSelectedDrug: null,

        _selectRxDrug: function (item) {
            this._rxSelectedDrug = item;
            var fieldsWrap = document.getElementById('pt-rx-drug-fields');
            var selDiv = document.getElementById('pt-rx-selected-drug');
            var searchInput = document.getElementById('pt-rx-drug-search');

            if (fieldsWrap) fieldsWrap.style.display = 'block';
            if (searchInput) searchInput.value = '';

            if (selDiv) {
                selDiv.innerHTML = '<div class="pt-rx-sel-drug">' +
                    '<i class="fas fa-pills"></i>' +
                    '<div><strong>' + this.escapeHtml(item.name || '') + '</strong>' +
                    '<small>' + this.escapeHtml((item.dosage || '') + ' · ' + (item.category || '') + ' · Stock: ' + (item.quantity || 0)) + '</small></div>' +
                    '</div>';
            }

            // Pre-fill dosage if available
            var dosageEl = document.getElementById('pt-rx-drug-dosage');
            if (dosageEl && item.dosage) dosageEl.value = item.dosage;
        },

        _clearRxDrugFields: function () {
            this._rxSelectedDrug = null;
            var fieldsWrap = document.getElementById('pt-rx-drug-fields');
            if (fieldsWrap) fieldsWrap.style.display = 'none';
            document.getElementById('pt-rx-drug-dosage').value = '';
            document.getElementById('pt-rx-drug-freq').value = 'OD';
            document.getElementById('pt-rx-drug-duration').value = '';
            document.getElementById('pt-rx-drug-qty').value = '1';
            document.getElementById('pt-rx-drug-route').value = 'Oral';
            document.getElementById('pt-rx-drug-instr').value = '';
            document.getElementById('pt-rx-selected-drug').innerHTML = '';
        },

        _addRxDrug: function () {
            if (!this._rxSelectedDrug) { this.showToast('Select a drug first', 'error'); return; }
            var drug = this._rxSelectedDrug;

            ptTreatmentDrugs.push({
                drugId: drug.id,
                drugName: drug.name || '',
                category: drug.category || '',
                dosageStrength: drug.dosage || '',
                dosage: (document.getElementById('pt-rx-drug-dosage')?.value || '').trim(),
                frequency: document.getElementById('pt-rx-drug-freq')?.value || 'OD',
                duration: (document.getElementById('pt-rx-drug-duration')?.value || '').trim(),
                quantity: parseInt(document.getElementById('pt-rx-drug-qty')?.value) || 1,
                route: document.getElementById('pt-rx-drug-route')?.value || 'Oral',
                instructions: (document.getElementById('pt-rx-drug-instr')?.value || '').trim(),
                unitPrice: drug.sellingPrice || 0,
                unit: drug.unit || 'Tablets'
            });

            this.showToast(drug.name + ' added to prescription');
            this._clearRxDrugFields();
            this._renderRxDrugsList();

            // Enable save button
            var saveBtn = document.getElementById('pt-rx-save');
            if (saveBtn) saveBtn.disabled = false;
        },

        _renderRxDrugsList: function () {
            var wrap = document.getElementById('pt-rx-drugs-list');
            if (!wrap) return;

            if (ptTreatmentDrugs.length === 0) {
                wrap.innerHTML = '<div class="pt-rx-drugs-empty"><i class="fas fa-pills"></i><span>No drugs added yet</span></div>';
                return;
            }

            var self = this;
            var total = 0;
            var html = '<div class="pt-table-wrap"><table class="pt-table"><thead><tr>' +
                '<th>#</th><th>Drug</th><th>Dosage</th><th>Freq</th><th>Route</th><th>Duration</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th><th style="text-align:center"></th>' +
                '</tr></thead><tbody>';

            ptTreatmentDrugs.forEach(function (d, i) {
                var lineTotal = d.unitPrice * d.quantity;
                total += lineTotal;
                html += '<tr>' +
                    '<td>' + (i + 1) + '</td>' +
                    '<td><strong>' + self.escapeHtml(d.drugName) + '</strong>' + (d.instructions ? '<br><small class="pt-svc-note">' + self.escapeHtml(d.instructions) + '</small>' : '') + '</td>' +
                    '<td>' + self.escapeHtml(d.dosage || d.dosageStrength || '-') + '</td>' +
                    '<td><span class="pt-cat-badge">' + self.escapeHtml(d.frequency) + '</span></td>' +
                    '<td>' + self.escapeHtml(d.route) + '</td>' +
                    '<td>' + self.escapeHtml(d.duration || '-') + '</td>' +
                    '<td style="text-align:center">' + d.quantity + ' ' + self.escapeHtml(d.unit) + '</td>' +
                    '<td style="text-align:right">' + self.formatCurrency(lineTotal) + '</td>' +
                    '<td style="text-align:center"><button class="pt-remove-btn pt-rx-remove" data-idx="' + i + '" title="Remove"><i class="fas fa-trash-alt"></i></button></td>' +
                    '</tr>';
            });

            html += '<tr class="pt-rx-total-row"><td colspan="7" style="text-align:right;font-weight:700">Total</td><td style="text-align:right;font-weight:700">' + self.formatCurrency(total) + '</td><td></td></tr>';
            html += '</tbody></table></div>';
            wrap.innerHTML = html;

            wrap.querySelectorAll('.pt-rx-remove').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    ptTreatmentDrugs.splice(parseInt(btn.dataset.idx), 1);
                    self._renderRxDrugsList();
                    var saveBtn = document.getElementById('pt-rx-save');
                    if (saveBtn) saveBtn.disabled = ptTreatmentDrugs.length === 0;
                });
            });
        },

        _saveTreatmentRecord: async function () {
            var businessId = this._mgmtBusinessId;
            var patient = this._managedPatient;
            if (!businessId || !patient) return;

            var doctorName = (document.getElementById('pt-rx-doctor')?.value || '').trim();
            var diagnosis = (document.getElementById('pt-rx-diagnosis')?.value || '').trim();

            if (!doctorName) { this.showToast('Doctor name is required', 'error'); return; }
            if (!diagnosis) { this.showToast('Diagnosis is required', 'error'); return; }
            if (ptTreatmentDrugs.length === 0) { this.showToast('Add at least one drug', 'error'); return; }

            var saveBtn = document.getElementById('pt-rx-save');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

            try {
                var recordId = this.generateId('RX');
                var drugsTotal = ptTreatmentDrugs.reduce(function (sum, d) { return sum + (d.unitPrice * d.quantity); }, 0);

                var data = {
                    recordType: 'treatment',
                    recordId: recordId,
                    patientId: patient.patientId || patient.id,
                    doctorName: doctorName,
                    visitTime: document.getElementById('pt-rx-time')?.value || '',
                    diagnosis: diagnosis,
                    status: document.getElementById('pt-rx-status')?.value || 'Pending',
                    notes: (document.getElementById('pt-rx-notes')?.value || '').trim(),
                    drugs: ptTreatmentDrugs.map(function (d) { return Object.assign({}, d); }),
                    drugsSummary: ptTreatmentDrugs.length + ' drug' + (ptTreatmentDrugs.length !== 1 ? 's' : ''),
                    drugsTotal: drugsTotal,
                    createdBy: this.getCurrentUser(),
                    createdAt: new Date().toISOString()
                };

                await getBusinessCollection(businessId, 'patient_records').doc(recordId).set(data);

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Prescription Saved',
                        description: 'Prescription ' + recordId + ' — ' + ptTreatmentDrugs.length + ' drug(s) for ' + (patient.fullName || patient.patientId),
                        category: 'Patient',
                        status: 'COMPLETED',
                        amount: drugsTotal,
                        metadata: { recordId: recordId, patientId: patient.patientId || patient.id, drugCount: ptTreatmentDrugs.length, diagnosis: diagnosis }
                    });
                }

                this.showToast('Prescription saved!');
                ptTreatmentDrugs = [];
                document.getElementById('pt-mgmt-add-form').style.display = 'none';
            } catch (err) {
                console.error('Save treatment error:', err);
                this.showToast('Failed: ' + err.message, 'error');
            } finally {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Prescription'; }
            }
        },

        _viewPrescription: function (recordId) {
            var r = ptManageRecords.find(function (x) { return x.id === recordId; });
            if (!r) return;
            var patient = this._managedPatient;
            var self = this;
            var dateStr = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }) : '-';

            var drugsRows = (r.drugs || []).map(function (d, i) {
                return '<tr><td>' + (i + 1) + '</td>' +
                    '<td><strong>' + self.escapeHtml(d.drugName) + '</strong></td>' +
                    '<td>' + self.escapeHtml(d.dosage || '-') + '</td>' +
                    '<td>' + self.escapeHtml(d.frequency || '-') + '</td>' +
                    '<td>' + self.escapeHtml(d.route || '-') + '</td>' +
                    '<td>' + self.escapeHtml(d.duration || '-') + '</td>' +
                    '<td style="text-align:center">' + (d.quantity || 1) + '</td>' +
                    '<td>' + self.escapeHtml(d.instructions || '-') + '</td></tr>';
            }).join('');

            var modal = document.createElement('div');
            modal.className = 'pt-modal-overlay';
            modal.innerHTML = '<div class="pt-modal pt-modal--md">' +
                '<div class="pt-modal-header"><h3><i class="fas fa-prescription"></i> Prescription Details</h3>' +
                '<div class="pt-mgmt-hdr-right"><button class="btn btn-sm btn-outline pt-rx-print-single" title="Print"><i class="fas fa-print"></i> Print</button>' +
                '<button class="pt-modal-close" title="Close"><i class="fas fa-times"></i></button></div></div>' +
                '<div class="pt-modal-body">' +
                    '<div class="pt-rx-view-meta">' +
                        '<div class="pt-rx-meta-row"><span>Date</span><strong>' + self.escapeHtml(dateStr) + (r.visitTime ? ' at ' + self.escapeHtml(r.visitTime) : '') + '</strong></div>' +
                        '<div class="pt-rx-meta-row"><span>Doctor</span><strong>' + self.escapeHtml(r.doctorName || '-') + '</strong></div>' +
                        '<div class="pt-rx-meta-row"><span>Diagnosis</span><strong>' + self.escapeHtml(r.diagnosis || '-') + '</strong></div>' +
                        '<div class="pt-rx-meta-row"><span>Status</span><strong>' + self.escapeHtml(r.status || 'Pending') + '</strong></div>' +
                        (r.notes ? '<div class="pt-rx-meta-row pt-span-2"><span>Notes</span><strong>' + self.escapeHtml(r.notes) + '</strong></div>' : '') +
                    '</div>' +
                    '<h4 style="margin:16px 0 10px;font-size:0.88rem;"><i class="fas fa-pills" style="color:var(--primary)"></i> Prescribed Drugs (' + (r.drugs || []).length + ')</h4>' +
                    '<div class="pt-table-wrap"><table class="pt-table"><thead><tr>' +
                        '<th>#</th><th>Drug</th><th>Dosage</th><th>Freq</th><th>Route</th><th>Duration</th><th style="text-align:center">Qty</th><th>Instructions</th>' +
                    '</tr></thead><tbody>' + drugsRows + '</tbody></table></div>' +
                '</div></div>';

            document.body.appendChild(modal);
            setTimeout(function () { modal.classList.add('show'); }, 10);
            var close = function () { modal.classList.remove('show'); setTimeout(function () { modal.remove(); }, 200); };
            modal.querySelector('.pt-modal-close').addEventListener('click', close);
            modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
            modal.querySelector('.pt-rx-print-single').addEventListener('click', function () { self._printSinglePrescription(r, patient); });
        },

        _printSinglePrescription: function (r, patient) {
            var self = this;
            var dateStr = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }) : '-';
            var age = this._calcAge(patient ? patient.dob : '');

            var drugsRows = (r.drugs || []).map(function (d, i) {
                return '<tr><td>' + (i + 1) + '</td>' +
                    '<td><strong>' + self.escapeHtml(d.drugName) + '</strong></td>' +
                    '<td>' + self.escapeHtml(d.dosage || '-') + '</td>' +
                    '<td>' + self.escapeHtml(d.frequency || '-') + '</td>' +
                    '<td>' + self.escapeHtml(d.route || '-') + '</td>' +
                    '<td>' + self.escapeHtml(d.duration || '-') + '</td>' +
                    '<td style="text-align:center">' + (d.quantity || 1) + '</td>' +
                    '<td>' + self.escapeHtml(d.instructions || '-') + '</td></tr>';
            }).join('');

            var printWin = window.open('', '_blank', 'width=800,height=900');
            printWin.document.write(
                '<html><head><title>Prescription - ' + self.escapeHtml(patient ? patient.fullName : '') + '</title>' +
                '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">' +
                '<style>' + this._mgmtPrintCSS() + '.rx-info { display:grid; grid-template-columns:1fr 1fr; gap:6px 30px; margin-bottom:16px; font-size:0.85rem; } .rx-info strong { color:#1e293b; }</style></head><body>' +
                '<div class="header"><div><div class="logo"><i class="' + (PharmaFlow.Settings ? PharmaFlow.Settings.getLogoIcon() : 'fas fa-capsules') + '"></i><h2>' + (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + '</h2></div>' +
                '<p class="subtitle">' + (PharmaFlow.Settings ? PharmaFlow.Settings.getTagline() : 'Pharmacy Management System') + '</p></div>' +
                '<div><h1 class="title">PRESCRIPTION</h1><p class="date">' + dateStr + '</p></div></div>' +
                '<div class="patient-info">' +
                '<span><strong>Patient:</strong> ' + self.escapeHtml(patient ? patient.fullName : '') + '</span>' +
                '<span><strong>ID:</strong> ' + self.escapeHtml(patient ? patient.patientId || '' : '') + '</span>' +
                '<span><strong>Age:</strong> ' + age + '</span>' +
                '<span><strong>Gender:</strong> ' + self.escapeHtml(patient ? patient.gender || '' : '') + '</span>' +
                '</div>' +
                '<div class="rx-info">' +
                '<span><strong>Doctor:</strong> ' + self.escapeHtml(r.doctorName || '-') + '</span>' +
                '<span><strong>Time:</strong> ' + self.escapeHtml(r.visitTime || '-') + '</span>' +
                '<span><strong>Diagnosis:</strong> ' + self.escapeHtml(r.diagnosis || '-') + '</span>' +
                '<span><strong>Status:</strong> ' + self.escapeHtml(r.status || 'Pending') + '</span>' +
                '</div>' +
                (r.notes ? '<div style="background:#f8fafc;padding:10px;border-radius:6px;margin-bottom:14px;font-size:0.82rem;border:1px solid #e2e8f0;"><strong style="color:#2563eb;">Notes:</strong> ' + self.escapeHtml(r.notes) + '</div>' : '') +
                '<table><thead><tr><th>#</th><th>Drug</th><th>Dosage</th><th>Freq</th><th>Route</th><th>Duration</th><th style="text-align:center">Qty</th><th>Instructions</th></tr></thead><tbody>' + drugsRows + '</tbody></table>' +
                '<div style="margin-top:40px;display:flex;justify-content:space-between;font-size:0.85rem;color:#475569;">' +
                '<div><p style="border-top:1px solid #1e293b;padding-top:6px;min-width:200px;"><strong>Doctor\'s Signature</strong></p></div>' +
                '<div><p style="border-top:1px solid #1e293b;padding-top:6px;min-width:200px;"><strong>Pharmacist\'s Signature</strong></p></div></div>' +
                '<div class="footer"><p>' + (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + ' &middot; ' + (PharmaFlow.Settings ? PharmaFlow.Settings.getTagline() : 'Pharmacy Management System') + '</p>' +
                '<small>Printed on ' + new Date().toLocaleString('en-KE') + '</small></div>' +
                '</body></html>'
            );
            printWin.document.close();
            printWin.focus();
            setTimeout(function () { printWin.print(); }, 400);
        },

        _mgmtPrintCSS: function () {
            return '* { margin:0; padding:0; box-sizing:border-box; }' +
                'body { font-family:"Segoe UI",Arial,sans-serif; padding:30px; max-width:800px; margin:0 auto; color:#1e293b; }' +
                '.header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; padding-bottom:15px; border-bottom:3px solid #2563eb; }' +
                '.logo { display:flex; align-items:center; gap:8px; }' +
                '.logo i { font-size:1.5rem; color:#2563eb; }' +
                '.logo h2 { font-size:1.3rem; color:#2563eb; margin:0; }' +
                '.subtitle { font-size:0.75rem; color:#64748b; margin-top:3px; }' +
                '.title { font-size:1.4rem; font-weight:800; color:#2563eb; letter-spacing:2px; text-align:right; margin:0; }' +
                '.date { font-size:0.8rem; color:#64748b; text-align:right; margin-top:4px; }' +
                '.patient-info { display:flex; gap:20px; flex-wrap:wrap; margin-bottom:18px; padding:12px; background:#f8fafc; border-radius:6px; font-size:0.85rem; border:1px solid #e2e8f0; }' +
                '.patient-info strong { color:#2563eb; }' +
                'table { width:100%; border-collapse:collapse; margin-bottom:20px; font-size:0.84rem; }' +
                'th { background:#f1f5f9; padding:9px 10px; text-align:left; font-weight:700; border-bottom:2px solid #e2e8f0; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; color:#475569; }' +
                'td { padding:8px 10px; border-bottom:1px solid #f1f5f9; }' +
                '.section { margin-bottom:22px; page-break-inside:avoid; }' +
                '.section h3 { font-size:0.92rem; color:#2563eb; padding:8px 0 6px; border-bottom:2px solid #dbeafe; margin-bottom:8px; display:flex; align-items:center; gap:8px; }' +
                '.section h3 .count { font-weight:400; font-size:0.78rem; color:#64748b; }' +
                '.patient-box { display:grid; grid-template-columns:1fr 1fr; gap:6px 30px; margin-bottom:22px; padding:14px 16px; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0; font-size:0.84rem; }' +
                '.patient-box strong { color:#2563eb; }' +
                '.footer { text-align:center; padding-top:15px; border-top:1px solid #e2e8f0; font-size:0.8rem; color:#64748b; margin-top:20px; }' +
                '.footer small { display:block; margin-top:4px; font-size:0.72rem; }' +
                '@media print { body { padding:15px; } .section { page-break-inside:avoid; } }';
        },

        _printTabReceipt: function (tabId, records) {
            var config = this._mgmtTabConfig[tabId];
            var patient = this._managedPatient;
            if (!config || !patient) return;
            var self = this;
            var dateStr = new Date().toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' });
            var age = this._calcAge(patient.dob);

            var tableHtml = '';
            if (records.length > 0) {
                if (tabId === 'treatment') {
                    // Treatment: show each prescription with its drugs
                    tableHtml = records.map(function (r, idx) {
                        var rDate = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
                        var drugsTable = (r.drugs || []).map(function (d, i) {
                            return '<tr><td>' + (i + 1) + '</td><td>' + self.escapeHtml(d.drugName) + '</td><td>' + self.escapeHtml(d.dosage || '-') + '</td><td>' + self.escapeHtml(d.frequency || '-') + '</td><td>' + self.escapeHtml(d.route || '-') + '</td><td>' + self.escapeHtml(d.duration || '-') + '</td><td style="text-align:center">' + (d.quantity || 1) + '</td><td>' + self.escapeHtml(d.instructions || '-') + '</td></tr>';
                        }).join('');
                        return '<div class="section"><h3>Prescription #' + (idx + 1) + ' \u2014 ' + self.escapeHtml(rDate) + (r.visitTime ? ' at ' + self.escapeHtml(r.visitTime) : '') + '</h3>' +
                            '<p style="font-size:0.84rem;margin-bottom:8px;"><strong>Doctor:</strong> ' + self.escapeHtml(r.doctorName || '-') + ' &nbsp;&middot;&nbsp; <strong>Diagnosis:</strong> ' + self.escapeHtml(r.diagnosis || '-') + ' &nbsp;&middot;&nbsp; <strong>Status:</strong> ' + self.escapeHtml(r.status || 'Pending') + '</p>' +
                            (r.notes ? '<p style="font-size:0.82rem;color:#475569;margin-bottom:8px;"><strong>Notes:</strong> ' + self.escapeHtml(r.notes) + '</p>' : '') +
                            '<table><thead><tr><th>#</th><th>Drug</th><th>Dosage</th><th>Freq</th><th>Route</th><th>Duration</th><th style="text-align:center">Qty</th><th>Instructions</th></tr></thead><tbody>' + drugsTable + '</tbody></table></div>';
                    }).join('');
                } else {
                    var headers = config.columns.map(function (c) { return '<th>' + c.label + '</th>'; }).join('');
                    var rows = records.map(function (r) {
                        return '<tr>' + config.columns.map(function (c) {
                            var val = r[c.key] != null && r[c.key] !== '' ? String(r[c.key]) : '-';
                            if (c.fmt === 'date' && val !== '-') {
                                try { val = new Date(val).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (e) { /* keep raw */ }
                            }
                            return '<td>' + self.escapeHtml(val) + '</td>';
                        }).join('') + '</tr>';
                    }).join('');
                    tableHtml = '<table><thead><tr>' + headers + '</tr></thead><tbody>' + rows + '</tbody></table>';
                }
            } else {
                tableHtml = '<p style="text-align:center;color:#888;padding:20px;">No records found</p>';
            }

            var printWin = window.open('', '_blank', 'width=800,height=900');
            printWin.document.write(
                '<html><head><title>' + self.escapeHtml(config.label) + ' - ' + self.escapeHtml(patient.fullName || '') + '</title>' +
                '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">' +
                '<style>' + this._mgmtPrintCSS() + '</style></head><body>' +
                '<div class="header"><div><div class="logo"><i class="' + (PharmaFlow.Settings ? PharmaFlow.Settings.getLogoIcon() : 'fas fa-capsules') + '"></i><h2>' + (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + '</h2></div>' +
                '<p class="subtitle">' + (PharmaFlow.Settings ? PharmaFlow.Settings.getTagline() : 'Pharmacy Management System') + '</p></div>' +
                '<div><h1 class="title">' + self.escapeHtml(config.label.toUpperCase()) + '</h1><p class="date">' + dateStr + '</p></div></div>' +
                '<div class="patient-info">' +
                '<span><strong>Patient:</strong> ' + self.escapeHtml(patient.fullName || '') + '</span>' +
                '<span><strong>ID:</strong> ' + self.escapeHtml(patient.patientId || '') + '</span>' +
                '<span><strong>Gender:</strong> ' + self.escapeHtml(patient.gender || '') + '</span>' +
                '<span><strong>Age:</strong> ' + age + '</span>' +
                '<span><strong>Phone:</strong> ' + self.escapeHtml(patient.phone || '') + '</span>' +
                (patient.insurance ? '<span><strong>Insurance:</strong> ' + self.escapeHtml(patient.insurance) + '</span>' : '') +
                '</div>' +
                tableHtml +
                '<div class="footer"><p>' + (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + ' &middot; ' + (PharmaFlow.Settings ? PharmaFlow.Settings.getTagline() : 'Pharmacy Management System') + '</p>' +
                '<small>Printed on ' + new Date().toLocaleString('en-KE') + '</small></div>' +
                '</body></html>'
            );
            printWin.document.close();
            printWin.focus();
            setTimeout(function () { printWin.print(); }, 400);
        },

        _printFullReport: function (patient) {
            if (!patient) return;
            var self = this;
            var dateStr = new Date().toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' });
            var age = this._calcAge(patient.dob);

            var sectionsHtml = '';
            Object.entries(this._mgmtTabConfig).forEach(function (entry) {
                var tabId = entry[0], config = entry[1];
                var records = ptManageRecords.filter(function (r) { return r.recordType === tabId; });
                var tableHtml = '';
                if (records.length > 0) {
                    if (tabId === 'treatment') {
                        // Treatment records have nested drugs
                        var headers = '<th>Date</th><th>Doctor</th><th>Diagnosis</th><th>Drugs</th><th>Status</th>';
                        var rows = records.map(function (r) {
                            var dateVal = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
                            var drugNames = (r.drugs || []).map(function (d) { return d.drugName; }).join(', ');
                            return '<tr><td>' + self.escapeHtml(dateVal) + '</td><td>' + self.escapeHtml(r.doctorName || '-') + '</td><td>' + self.escapeHtml(r.diagnosis || '-') + '</td><td>' + self.escapeHtml(drugNames || '-') + '</td><td>' + self.escapeHtml(r.status || '-') + '</td></tr>';
                        }).join('');
                        tableHtml = '<table><thead><tr>' + headers + '</tr></thead><tbody>' + rows + '</tbody></table>';
                    } else {
                        var headers = config.columns.map(function (c) { return '<th>' + c.label + '</th>'; }).join('');
                        var rows = records.map(function (r) {
                            return '<tr>' + config.columns.map(function (c) {
                                var val = r[c.key] != null && r[c.key] !== '' ? String(r[c.key]) : '-';
                                if (c.fmt === 'date' && val !== '-') {
                                    try { val = new Date(val).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (e) { /* keep raw */ }
                                }
                                if (c.truncate && val.length > c.truncate) val = val.substring(0, c.truncate) + '…';
                                return '<td>' + self.escapeHtml(val) + '</td>';
                            }).join('') + '</tr>';
                        }).join('');
                        tableHtml = '<table><thead><tr>' + headers + '</tr></thead><tbody>' + rows + '</tbody></table>';
                    }
                } else {
                    tableHtml = '<p style="color:#888;font-size:0.82rem;padding:8px 0;">No records</p>';
                }
                sectionsHtml += '<div class="section"><h3><i class="fas ' + config.icon + '"></i> ' + self.escapeHtml(config.label) + ' <span class="count">(' + records.length + ')</span></h3>' + tableHtml + '</div>';
            });

            var printWin = window.open('', '_blank', 'width=800,height=1200');
            printWin.document.write(
                '<html><head><title>Full Report - ' + self.escapeHtml(patient.fullName || '') + '</title>' +
                '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">' +
                '<style>' + this._mgmtPrintCSS() + '</style></head><body>' +
                '<div class="header"><div><div class="logo"><i class="' + (PharmaFlow.Settings ? PharmaFlow.Settings.getLogoIcon() : 'fas fa-capsules') + '"></i><h2>' + (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + '</h2></div>' +
                '<p class="subtitle">' + (PharmaFlow.Settings ? PharmaFlow.Settings.getTagline() : 'Pharmacy Management System') + '</p></div>' +
                '<div><h1 class="title">PATIENT REPORT</h1><p class="date">' + dateStr + '</p></div></div>' +
                '<div class="patient-box">' +
                '<span><strong>Patient:</strong> ' + self.escapeHtml(patient.fullName || '') + '</span>' +
                '<span><strong>Patient ID:</strong> ' + self.escapeHtml(patient.patientId || '') + '</span>' +
                '<span><strong>Gender:</strong> ' + self.escapeHtml(patient.gender || '-') + '</span>' +
                '<span><strong>Age:</strong> ' + age + '</span>' +
                '<span><strong>Phone:</strong> ' + self.escapeHtml(patient.phone || '-') + '</span>' +
                '<span><strong>Insurance:</strong> ' + self.escapeHtml(patient.insurance || 'None') + '</span>' +
                '<span><strong>ID/Passport:</strong> ' + self.escapeHtml(patient.idNumber || '-') + '</span>' +
                '<span><strong>Allergies:</strong> ' + self.escapeHtml(patient.allergies || 'None') + '</span>' +
                '</div>' +
                sectionsHtml +
                '<div class="footer"><p>' + (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + ' &middot; Complete Patient Report</p>' +
                '<small>Generated on ' + new Date().toLocaleString('en-KE') + '</small></div>' +
                '</body></html>'
            );
            printWin.document.close();
            printWin.focus();
            setTimeout(function () { printWin.print(); }, 400);
        },

        /* ══════════════════════════════════════════════════════
         * MANAGE BILLING — view all bills, update balance/status
         * ══════════════════════════════════════════════════════ */

        renderManageBilling: function (container) {
            this.cleanup();
            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="pt-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-file-invoice-dollar"></i> Manage Billing</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Patients</span><span>/</span><span>Manage Billing</span>
                            </div>
                        </div>
                        <div class="page-header-right">
                            <button class="btn btn-sm btn-primary" id="pt-mb-new-bill">
                                <i class="fas fa-plus"></i> New Bill
                            </button>
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="pt-manage-stats">
                        <div class="pt-stat-mini pt-stat--blue">
                            <i class="fas fa-file-invoice"></i>
                            <div><span class="pt-stat-num" id="pt-mb-total">0</span><span class="pt-stat-label">Total Bills</span></div>
                        </div>
                        <div class="pt-stat-mini pt-stat--green">
                            <i class="fas fa-check-circle"></i>
                            <div><span class="pt-stat-num" id="pt-mb-paid">0</span><span class="pt-stat-label">Paid</span></div>
                        </div>
                        <div class="pt-stat-mini pt-stat--orange">
                            <i class="fas fa-clock"></i>
                            <div><span class="pt-stat-num" id="pt-mb-partial">0</span><span class="pt-stat-label">Partial</span></div>
                        </div>
                        <div class="pt-stat-mini pt-stat--red">
                            <i class="fas fa-exclamation-circle"></i>
                            <div><span class="pt-stat-num" id="pt-mb-unpaid">0</span><span class="pt-stat-label">Unpaid</span></div>
                        </div>
                    </div>

                    <!-- Toolbar -->
                    <div class="card pt-card">
                        <div class="pt-toolbar">
                            <div class="pt-search-bar">
                                <i class="fas fa-search"></i>
                                <input type="text" id="pt-mb-search" placeholder="Search by bill ID, patient name, phone..." autocomplete="off">
                            </div>
                            <select id="pt-mb-filter-status" class="pt-select">
                                <option value="all">All Statuses</option>
                                <option value="paid">Paid</option>
                                <option value="partial">Partial</option>
                                <option value="unpaid">Unpaid</option>
                            </select>
                            <select id="pt-mb-filter-method" class="pt-select">
                                <option value="all">All Methods</option>
                                <option value="cash">Cash</option>
                                <option value="mpesa">M-Pesa</option>
                                <option value="insurance">Insurance</option>
                                <option value="bank_transfer">Bank Transfer</option>
                                <option value="card">Card</option>
                                <option value="credit">Credit</option>
                            </select>
                            <select id="pt-mb-page-size" class="pt-select" style="width:90px;">
                                <option value="25">25</option>
                                <option value="50">50</option>
                                <option value="100">100</option>
                                <option value="250">250</option>
                            </select>
                        </div>

                        <div class="pt-table-wrap">
                            <table class="pt-table" id="pt-mb-table">
                                <thead>
                                    <tr>
                                        <th>Bill #</th>
                                        <th>Patient</th>
                                        <th>Services</th>
                                        <th style="text-align:right">Total</th>
                                        <th style="text-align:right">Paid</th>
                                        <th style="text-align:right">Balance</th>
                                        <th>Status</th>
                                        <th>Method</th>
                                        <th style="text-align:center">History</th>
                                        <th>Date</th>
                                        <th style="text-align:center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="pt-mb-bills-list">
                                    <tr><td colspan="11" class="pt-loading"><div class="spinner"></div> Loading bills...</td></tr>
                                </tbody>
                            </table>
                        </div>

                        <!-- Pagination -->
                        <div class="pt-mb-pagination" id="pt-mb-pagination" style="display:none;">
                            <div class="pt-mb-page-info" id="pt-mb-page-info"></div>
                            <div class="pt-mb-page-btns">
                                <button class="btn btn-sm btn-outline" id="pt-mb-prev" disabled><i class="fas fa-chevron-left"></i> Prev</button>
                                <button class="btn btn-sm btn-outline" id="pt-mb-next" disabled>Next <i class="fas fa-chevron-right"></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            this._bindManageBillingEvents(container, businessId);
            this._subscribeManageBills(businessId);
        },

        _bindManageBillingEvents: function (container, businessId) {
            const self = this;

            container.querySelector('[data-nav="dashboard"]')?.addEventListener('click', (e) => {
                e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null);
            });

            document.getElementById('pt-mb-new-bill')?.addEventListener('click', () => {
                PharmaFlow.Sidebar.setActive('patients', 'patient-billing');
            });

            let debounce;
            document.getElementById('pt-mb-search')?.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(() => self._filterManageBills(), 200);
            });
            document.getElementById('pt-mb-filter-status')?.addEventListener('change', () => self._filterManageBills());
            document.getElementById('pt-mb-filter-method')?.addEventListener('change', () => self._filterManageBills());
            document.getElementById('pt-mb-page-size')?.addEventListener('change', function () {
                ptMbPageSize = parseInt(this.value) || 25;
                ptMbPage = 1;
                self._renderManageBillsPage();
            });
            document.getElementById('pt-mb-prev')?.addEventListener('click', () => {
                if (ptMbPage > 1) { ptMbPage--; self._renderManageBillsPage(); }
            });
            document.getElementById('pt-mb-next')?.addEventListener('click', () => {
                const maxPage = Math.ceil(ptMbFilteredCache.length / ptMbPageSize);
                if (ptMbPage < maxPage) { ptMbPage++; self._renderManageBillsPage(); }
            });
        },

        _subscribeManageBills: function (businessId) {
            if (ptUnsubManageBills) { ptUnsubManageBills(); ptUnsubManageBills = null; }
            if (!businessId) return;
            const col = getBusinessCollection(businessId, 'patient_bills');
            if (!col) return;

            ptUnsubManageBills = col.orderBy('createdAt', 'desc').onSnapshot(snap => {
                ptManageBillsCache = [];
                snap.forEach(doc => ptManageBillsCache.push({ id: doc.id, ...doc.data() }));
                this._updateManageBillStats();
                this._filterManageBills();
            }, err => console.error('Manage bills listener error:', err));
        },

        _updateManageBillStats: function () {
            const all = ptManageBillsCache;
            const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
            el('pt-mb-total', all.length);
            el('pt-mb-paid', all.filter(b => b.paymentStatus === 'paid').length);
            el('pt-mb-partial', all.filter(b => b.paymentStatus === 'partial').length);
            el('pt-mb-unpaid', all.filter(b => b.paymentStatus === 'unpaid').length);
        },

        _filterManageBills: function () {
            const query = (document.getElementById('pt-mb-search')?.value || '').trim().toLowerCase();
            const statusFilter = document.getElementById('pt-mb-filter-status')?.value || 'all';
            const methodFilter = document.getElementById('pt-mb-filter-method')?.value || 'all';

            ptMbFilteredCache = ptManageBillsCache.filter(b => {
                if (statusFilter !== 'all' && b.paymentStatus !== statusFilter) return false;
                if (methodFilter !== 'all' && b.paymentMethod !== methodFilter) return false;
                if (query) {
                    const haystack = [
                        b.billId, b.patient?.name, b.patient?.phone, b.paymentMethod, b.createdBy
                    ].filter(Boolean).join(' ').toLowerCase();
                    if (!haystack.includes(query)) return false;
                }
                return true;
            });

            ptMbPage = 1;
            this._renderManageBillsPage();
        },

        _renderManageBillsPage: function () {
            const self = this;
            const tbody = document.getElementById('pt-mb-bills-list');
            if (!tbody) return;

            const total = ptMbFilteredCache.length;
            const start = (ptMbPage - 1) * ptMbPageSize;
            const end = Math.min(start + ptMbPageSize, total);
            const page = ptMbFilteredCache.slice(start, end);

            if (total === 0) {
                tbody.innerHTML = '<tr><td colspan="11" class="pt-empty"><div class="pt-empty-box"><i class="fas fa-file-invoice"></i><p>No bills found</p></div></td></tr>';
                const pag = document.getElementById('pt-mb-pagination');
                if (pag) pag.style.display = 'none';
                return;
            }

            tbody.innerHTML = page.map(b => {
                const dateStr = b.createdAt ? new Date(b.createdAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: '2-digit' }) : '-';
                const payBadge = b.paymentStatus === 'paid' ? 'pt-badge--green' : (b.paymentStatus === 'partial' ? 'pt-badge--orange' : 'pt-badge--red');
                const svcSummary = (b.services || []).map(s => s.name).slice(0, 2).join(', ') + (b.services && b.services.length > 2 ? ' +' + (b.services.length - 2) : '');
                const balance = b.balanceDue || Math.max((b.total || 0) - (b.amountPaid || 0), 0);
                const histCount = (b.paymentHistory || []).length;

                return '<tr>' +
                    '<td><strong>' + self.escapeHtml(b.billId || b.id) + '</strong></td>' +
                    '<td>' + self.escapeHtml(b.patient?.name || 'N/A') + '<br><small style="color:#888;">' + self.escapeHtml(b.patient?.phone || '') + '</small></td>' +
                    '<td><small>' + self.escapeHtml(svcSummary || '-') + '</small><br><span class="pt-badge pt-badge--blue">' + (b.serviceCount || (b.services || []).length) + ' item' + ((b.serviceCount || (b.services || []).length) !== 1 ? 's' : '') + '</span></td>' +
                    '<td style="text-align:right"><strong>' + self.formatCurrency(b.total) + '</strong></td>' +
                    '<td style="text-align:right">' + self.formatCurrency(b.amountPaid || 0) + '</td>' +
                    '<td style="text-align:right;' + (balance > 0 ? 'color:#dc2626;font-weight:600;' : '') + '">' + self.formatCurrency(balance) + '</td>' +
                    '<td><span class="pt-badge ' + payBadge + '">' + (b.paymentStatus || 'unpaid') + '</span></td>' +
                    '<td>' + self.escapeHtml((b.paymentMethod || '-').replace('_', ' ')) + '</td>' +
                    '<td style="text-align:center">' +
                        (histCount > 0 ? '<button class="btn btn-xs btn-outline pt-mb-hist-btn" data-id="' + (b.billId || b.id) + '" title="Payment History (' + histCount + ')"><i class="fas fa-history"></i> ' + histCount + '</button> ' : '<small style="color:#aaa;">—</small> ') +
                    '</td>' +
                    '<td><small>' + dateStr + '</small></td>' +
                    '<td style="text-align:center;white-space:nowrap;">' +
                        '<button class="btn btn-xs btn-outline pt-mb-view-btn" data-id="' + (b.billId || b.id) + '" title="View Invoice"><i class="fas fa-eye"></i></button> ' +
                        (balance > 0 ? '<button class="btn btn-xs btn-success pt-mb-topup-btn" data-id="' + (b.billId || b.id) + '" title="Top Up Payment"><i class="fas fa-plus-circle"></i> Top Up</button>' : '') +
                    '</td>' +
                '</tr>';
            }).join('');

            // Bind action buttons
            tbody.querySelectorAll('.pt-mb-view-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const bill = ptManageBillsCache.find(b => (b.billId || b.id) === btn.dataset.id);
                    if (bill) self._showBillInvoice(bill);
                });
            });
            tbody.querySelectorAll('.pt-mb-topup-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const bill = ptManageBillsCache.find(b => (b.billId || b.id) === btn.dataset.id);
                    if (bill) self._showUpdatePaymentModal(bill);
                });
            });
            tbody.querySelectorAll('.pt-mb-hist-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const bill = ptManageBillsCache.find(b => (b.billId || b.id) === btn.dataset.id);
                    if (bill) self._showPaymentHistoryModal(bill);
                });
            });

            // Pagination
            const pag = document.getElementById('pt-mb-pagination');
            const maxPage = Math.ceil(total / ptMbPageSize);
            if (pag) {
                pag.style.display = total > ptMbPageSize ? 'flex' : 'none';
                const info = document.getElementById('pt-mb-page-info');
                if (info) info.textContent = 'Showing ' + (start + 1) + '-' + end + ' of ' + total + ' bills (Page ' + ptMbPage + '/' + maxPage + ')';
                const prev = document.getElementById('pt-mb-prev');
                const next = document.getElementById('pt-mb-next');
                if (prev) prev.disabled = ptMbPage <= 1;
                if (next) next.disabled = ptMbPage >= maxPage;
            }
        },

        /* ── Payment History Modal ── */
        _showPaymentHistoryModal: function (bill) {
            const self = this;
            const existing = document.getElementById('pt-mb-hist-modal');
            if (existing) existing.remove();

            const history = bill.paymentHistory || [];
            const balance = bill.balanceDue || Math.max((bill.total || 0) - (bill.amountPaid || 0), 0);

            const rowsHtml = history.length > 0 ? history.map((h, i) => {
                const d = h.date ? new Date(h.date).toLocaleString('en-KE', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
                return '<tr>' +
                    '<td>' + (i + 1) + '</td>' +
                    '<td><strong>' + self.formatCurrency(h.amount) + '</strong></td>' +
                    '<td>' + self.escapeHtml((h.method || '-').replace('_', ' ')) + '</td>' +
                    '<td>' + self.escapeHtml(h.recordedBy || '-') + '</td>' +
                    '<td><small>' + d + '</small></td>' +
                    '<td><small>' + self.escapeHtml(h.notes || '-') + '</small></td>' +
                '</tr>';
            }).join('') : '<tr><td colspan="6" style="text-align:center;color:#888;padding:20px;">No payment history recorded</td></tr>';

            const totalPaidFromHistory = history.reduce((s, h) => s + (h.amount || 0), 0);

            const modal = document.createElement('div');
            modal.className = 'pt-modal-overlay';
            modal.id = 'pt-mb-hist-modal';
            modal.innerHTML = `
                <div class="pt-modal pt-modal--lg">
                    <div class="pt-modal-header">
                        <h3><i class="fas fa-history"></i> Payment History — ${self.escapeHtml(bill.billId || bill.id)}</h3>
                        <button class="pt-modal-close" id="pt-mb-hist-close">&times;</button>
                    </div>
                    <div class="pt-modal-body">
                        <div class="pt-mb-pay-info" style="margin-bottom:16px;">
                            <div class="pt-mb-pay-row"><span>Patient</span><strong>${self.escapeHtml(bill.patient?.name || 'N/A')}</strong></div>
                            <div class="pt-mb-pay-row"><span>Bill Total</span><strong>${self.formatCurrency(bill.total)}</strong></div>
                            <div class="pt-mb-pay-row"><span>Total Paid</span><strong style="color:#16a34a;">${self.formatCurrency(bill.amountPaid || 0)}</strong></div>
                            <div class="pt-mb-pay-row pt-mb-pay-row--highlight"><span>Balance</span><strong style="color:${balance > 0 ? '#dc2626' : '#16a34a'};">${self.formatCurrency(balance)}</strong></div>
                            <div class="pt-mb-pay-row"><span>Payments Recorded</span><strong>${history.length}</strong></div>
                        </div>
                        <div class="pt-table-wrap">
                            <table class="pt-table" style="font-size:0.85rem;">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Amount</th>
                                        <th>Method</th>
                                        <th>Recorded By</th>
                                        <th>Date</th>
                                        <th>Notes</th>
                                    </tr>
                                </thead>
                                <tbody>${rowsHtml}</tbody>
                            </table>
                        </div>
                    </div>
                    <div class="pt-modal-footer">
                        ${balance > 0 ? '<button class="btn btn-success" id="pt-mb-hist-topup"><i class="fas fa-plus-circle"></i> Top Up Payment</button>' : ''}
                        <button class="btn btn-outline" id="pt-mb-hist-done">Close</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            const close = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            document.getElementById('pt-mb-hist-close').addEventListener('click', close);
            document.getElementById('pt-mb-hist-done').addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            const topupBtn = document.getElementById('pt-mb-hist-topup');
            if (topupBtn) {
                topupBtn.addEventListener('click', () => {
                    close();
                    setTimeout(() => self._showUpdatePaymentModal(bill), 250);
                });
            }
        },

        /* ── Update Payment Modal ── */
        _showUpdatePaymentModal: function (bill) {
            const self = this;
            const businessId = this.getBusinessId();
            const existing = document.getElementById('pt-mb-pay-modal');
            if (existing) existing.remove();

            const balance = bill.balanceDue || Math.max((bill.total || 0) - (bill.amountPaid || 0), 0);

            const modal = document.createElement('div');
            modal.className = 'pt-modal-overlay';
            modal.id = 'pt-mb-pay-modal';
            modal.innerHTML = `
                <div class="pt-modal pt-modal--md">
                    <div class="pt-modal-header">
                        <h3><i class="fas fa-money-bill-wave"></i> Update Payment</h3>
                        <button class="pt-modal-close" id="pt-mb-pay-close">&times;</button>
                    </div>
                    <div class="pt-modal-body">
                        <div class="pt-mb-pay-info">
                            <div class="pt-mb-pay-row"><span>Bill #</span><strong>${self.escapeHtml(bill.billId || bill.id)}</strong></div>
                            <div class="pt-mb-pay-row"><span>Patient</span><strong>${self.escapeHtml(bill.patient?.name || 'N/A')}</strong></div>
                            <div class="pt-mb-pay-row"><span>Total Amount</span><strong>${self.formatCurrency(bill.total)}</strong></div>
                            <div class="pt-mb-pay-row"><span>Previously Paid</span><strong>${self.formatCurrency(bill.amountPaid || 0)}</strong></div>
                            <div class="pt-mb-pay-row pt-mb-pay-row--highlight"><span>Balance Due</span><strong style="color:#dc2626;">${self.formatCurrency(balance)}</strong></div>
                        </div>

                        <div class="pt-mb-pay-form">
                            <div class="form-group">
                                <label>Amount to Pay <span class="required">*</span></label>
                                <input type="number" id="pt-mb-pay-amount" min="0.01" max="${balance}" step="0.01" placeholder="0.00" value="${balance.toFixed(2)}">
                                <small style="color:#888;">Max: ${self.formatCurrency(balance)}</small>
                            </div>
                            <div class="form-group">
                                <label>Payment Method</label>
                                <select id="pt-mb-pay-method" class="pt-select">
                                    <option value="cash" ${bill.paymentMethod === 'cash' ? 'selected' : ''}>Cash</option>
                                    <option value="mpesa" ${bill.paymentMethod === 'mpesa' ? 'selected' : ''}>M-Pesa</option>
                                    <option value="insurance" ${bill.paymentMethod === 'insurance' ? 'selected' : ''}>Insurance</option>
                                    <option value="bank_transfer" ${bill.paymentMethod === 'bank_transfer' ? 'selected' : ''}>Bank Transfer</option>
                                    <option value="card" ${bill.paymentMethod === 'card' ? 'selected' : ''}>Card</option>
                                    <option value="credit" ${bill.paymentMethod === 'credit' ? 'selected' : ''}>Credit</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Notes</label>
                                <textarea id="pt-mb-pay-notes" rows="2" class="pt-textarea" placeholder="Payment notes..."></textarea>
                            </div>
                        </div>
                    </div>
                    <div class="pt-modal-footer">
                        <button class="btn btn-outline" id="pt-mb-pay-cancel">Cancel</button>
                        <button class="btn btn-primary" id="pt-mb-pay-submit"><i class="fas fa-check"></i> Record Payment</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            setTimeout(() => modal.classList.add('show'), 10);

            const close = () => { modal.classList.remove('show'); setTimeout(() => modal.remove(), 200); };
            document.getElementById('pt-mb-pay-close').addEventListener('click', close);
            document.getElementById('pt-mb-pay-cancel').addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            document.getElementById('pt-mb-pay-submit').addEventListener('click', async () => {
                const payAmount = parseFloat(document.getElementById('pt-mb-pay-amount')?.value) || 0;
                if (payAmount <= 0) { self.showToast('Enter a valid amount', 'error'); return; }
                if (payAmount > balance + 0.01) { self.showToast('Amount exceeds balance', 'error'); return; }

                const submitBtn = document.getElementById('pt-mb-pay-submit');
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

                try {
                    const newPaid = (bill.amountPaid || 0) + payAmount;
                    const newBalance = Math.max((bill.total || 0) - newPaid, 0);
                    const newStatus = newBalance <= 0.01 ? 'paid' : 'partial';
                    const payMethod = document.getElementById('pt-mb-pay-method')?.value || bill.paymentMethod;
                    const payNotes = (document.getElementById('pt-mb-pay-notes')?.value || '').trim();

                    const paymentEntry = {
                        amount: Math.round(payAmount * 100) / 100,
                        method: payMethod,
                        notes: payNotes || '',
                        recordedBy: self.getCurrentUser() || 'Staff',
                        date: new Date().toISOString()
                    };

                    const updateData = {
                        amountPaid: Math.round(newPaid * 100) / 100,
                        balanceDue: Math.round(newBalance * 100) / 100,
                        paymentStatus: newStatus,
                        paymentMethod: payMethod,
                        updatedAt: new Date().toISOString(),
                        updatedBy: self.getCurrentUser(),
                        paymentHistory: firebase.firestore.FieldValue.arrayUnion(paymentEntry)
                    };

                    await getBusinessCollection(businessId, 'patient_bills').doc(bill.billId || bill.id).update(updateData);

                    // Update patient totals
                    if (bill.patient?.id) {
                        await getBusinessCollection(businessId, 'patients').doc(bill.patient.id).update({
                            totalPaid: firebase.firestore.FieldValue.increment(payAmount),
                            updatedAt: new Date().toISOString()
                        });
                    }

                    // Log activity
                    if (PharmaFlow.ActivityLog) {
                        PharmaFlow.ActivityLog.log({
                            title: 'Bill Payment Recorded',
                            description: 'Payment of ' + self.formatCurrency(payAmount) + ' for bill ' + (bill.billId || bill.id) + ' — ' + (bill.patient?.name || 'patient') + '. Status: ' + newStatus,
                            category: 'Billing',
                            status: 'COMPLETED',
                            amount: payAmount,
                            metadata: { billId: bill.billId || bill.id, patientId: bill.patient?.id, amountPaid: payAmount, newBalance: newBalance, newStatus: newStatus }
                        });
                    }

                    self.showToast('Payment of ' + self.formatCurrency(payAmount) + ' recorded — ' + (newStatus === 'paid' ? 'Bill fully paid!' : 'Balance: ' + self.formatCurrency(newBalance)));
                    close();
                } catch (err) {
                    console.error('Payment update error:', err);
                    self.showToast('Failed: ' + err.message, 'error');
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fas fa-check"></i> Record Payment';
                }
            });
        }
    };

    window.PharmaFlow.Patients = Patients;
})();
