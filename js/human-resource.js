/**
 * PharmaFlow - Human Resource Module
 * Staff registry, payroll runs, payslips, and HR reports.
 */
(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let hrUsers = [];
    let hrSystemProfiles = [];
    let hrCasualStaff = [];
    let hrPayroll = [];
    let hrLoaded = false;

    const HR = {
        getBusinessId() {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        escapeHtml(str) {
            if (str == null) return '';
            const d = document.createElement('div');
            d.textContent = String(str);
            return d.innerHTML;
        },

        formatCurrency(val) {
            return PharmaFlow.Settings && PharmaFlow.Settings.formatCurrency
                ? PharmaFlow.Settings.formatCurrency(val)
                : 'KSH ' + new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val || 0);
        },

        showToast(msg, type) {
            const old = document.querySelector('.hr-toast');
            if (old) old.remove();
            const t = document.createElement('div');
            t.className = 'hr-toast' + (type === 'error' ? ' hr-toast--error' : '');
            t.innerHTML = '<i class="fas ' + (type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle') + '"></i> ' + this.escapeHtml(msg);
            document.body.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 3000);
        },

        cleanup() {
            hrLoaded = false;
            hrUsers = [];
            hrSystemProfiles = [];
            hrCasualStaff = [];
            hrPayroll = [];
        },

        staffLabel(staff) {
            return staff.displayName || staff.name || staff.email || 'Unnamed staff';
        },

        staffId(staff) {
            return staff.hrKind + ':' + staff.id;
        },

        parseMoney(id) {
            return Math.max(0, parseFloat((document.getElementById(id) || {}).value) || 0);
        },

        roleOptions(selected) {
            const roles = ['Pharmacist', 'Cashier', 'Branch Manager', 'Inventory Officer', 'Accountant', 'Cleaner', 'Security', 'Rider', 'Casual Worker', 'Other'];
            return roles.map(role => '<option value="' + this.escapeHtml(role) + '"' + (role === selected ? ' selected' : '') + '>' + this.escapeHtml(role) + '</option>').join('');
        },

        async ensureData() {
            if (hrLoaded) return;
            const businessId = this.getBusinessId();
            if (!businessId) throw new Error('NO_BUSINESS_SELECTED');

            const userQuery = window.db.collection('users').where('businessId', '==', businessId);
            const casualCol = getBusinessCollection(businessId, 'hr_staff');
            const payrollCol = getBusinessCollection(businessId, 'hr_payroll');
            const profilesCol = getBusinessCollection(businessId, 'hr_staff_profiles');
            const [usersSnap, casualSnap, payrollSnap, profilesSnap] = await Promise.all([
                userQuery.get(),
                casualCol.get(),
                payrollCol.get(),
                profilesCol.get()
            ]);

            hrSystemProfiles = profilesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            const profileMap = {};
            hrSystemProfiles.forEach(p => { profileMap[p.id] = p; });
            hrUsers = usersSnap.docs.map(d => {
                const user = { id: d.id, ...d.data() };
                const profile = profileMap[d.id] || {};
                return { ...user, ...profile, id: d.id, hrKind: 'system', staffType: 'System', sourceRole: user.role };
            });
            hrCasualStaff = casualSnap.docs.map(d => ({ id: d.id, hrKind: 'casual', staffType: 'Casual', ...d.data() }));
            hrPayroll = payrollSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
                const ad = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                const bd = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                return bd.getTime() - ad.getTime();
            });
            this.syncSystemStaffProfiles(businessId, profilesCol, usersSnap.docs, profileMap);
            hrLoaded = true;
        },

        syncSystemStaffProfiles(businessId, profilesCol, userDocs, profileMap) {
            userDocs.forEach(doc => {
                if (profileMap[doc.id]) return;
                const user = doc.data() || {};
                profilesCol.doc(doc.id).set({
                    userId: doc.id,
                    staffType: 'System',
                    name: user.displayName || user.name || user.email || '',
                    email: user.email || '',
                    phone: user.phone || '',
                    sourceRole: user.role || 'staff',
                    hrRole: user.jobTitle || user.role || 'Staff',
                    jobTitle: user.jobTitle || '',
                    basePay: user.basePay || 0,
                    payCycle: 'monthly',
                    isActive: user.active !== false && user.isActive !== false && user.status !== 'disabled',
                    autoDetected: true,
                    businessId: businessId,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true }).catch(err => console.warn('HR system staff sync failed:', err));
            });
        },

        allStaff() {
            return hrUsers.concat(hrCasualStaff).sort((a, b) => this.staffLabel(a).localeCompare(this.staffLabel(b)));
        },

        pageShell(title, icon, crumb, body) {
            return `
            <div class="dda-module hr-module">
                <div class="page-header">
                    <div>
                        <h2><i class="${icon}"></i> ${title}</h2>
                        <div class="breadcrumb"><a href="#" data-nav="dashboard">Home</a><span>/</span><span>Human Resource</span><span>/</span><span>${crumb}</span></div>
                    </div>
                </div>
                ${body}
            </div>`;
        },

        bindDashboardLink(container) {
            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', e => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });
        },

        async renderOverview(container) {
            container.innerHTML = '<div class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading HR dashboard...</div>';
            try {
                await this.ensureData();
                const staff = this.allStaff();
                const month = new Date().toISOString().slice(0, 7);
                const monthPayroll = hrPayroll.filter(p => p.period === month);
                const gross = monthPayroll.reduce((s, p) => s + (p.grossPay || 0), 0);
                const deductions = monthPayroll.reduce((s, p) => s + (p.totalDeductions || 0), 0);
                const net = monthPayroll.reduce((s, p) => s + (p.netPay || 0), 0);
                const body = `
                <div class="dda-stats hr-stats">
                    <div class="dda-stat-card"><div class="dda-stat-icon"><i class="fas fa-users"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${staff.length}</span><span class="dda-stat-label">Total Staff</span></div></div>
                    <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-id-badge"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${hrUsers.length}</span><span class="dda-stat-label">System Staff</span></div></div>
                    <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-person-digging"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${hrCasualStaff.length}</span><span class="dda-stat-label">Casual Staff</span></div></div>
                    <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--revenue"><i class="fas fa-money-check-dollar"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${this.formatCurrency(net)}</span><span class="dda-stat-label">Net Payroll This Month</span></div></div>
                </div>
                <div class="rpt-grid-2">
                    <div class="card">
                        <div class="rpt-section-header"><h3><i class="fas fa-wallet"></i> Current Payroll Position</h3></div>
                        <div class="rpt-pnl">
                            <div class="rpt-pnl-row"><span>Gross Pay</span><span>${this.formatCurrency(gross)}</span></div>
                            <div class="rpt-pnl-row"><span>Deductions</span><span>${this.formatCurrency(deductions)}</span></div>
                            <div class="rpt-pnl-row rpt-pnl-total"><span>Net Pay</span><span>${this.formatCurrency(net)}</span></div>
                            <div class="rpt-pnl-row"><span>Payslips Generated</span><span>${monthPayroll.length}</span></div>
                        </div>
                    </div>
                    <div class="card">
                        <div class="rpt-section-header"><h3><i class="fas fa-bolt"></i> HR Quick Actions</h3></div>
                        <div class="hr-action-grid">
                            <button class="adm-action-card" id="hr-go-staff"><i class="fas fa-user-plus"></i><span>Add Staff</span></button>
                            <button class="adm-action-card" id="hr-go-payroll"><i class="fas fa-money-check-dollar"></i><span>Run Payroll</span></button>
                            <button class="adm-action-card" id="hr-go-payslips"><i class="fas fa-file-invoice"></i><span>View Payslips</span></button>
                        </div>
                    </div>
                </div>`;
                container.innerHTML = this.pageShell('HR Dashboard', 'fas fa-people-group', 'Overview', body);
                this.bindDashboardLink(container);
                document.getElementById('hr-go-staff')?.addEventListener('click', () => PharmaFlow.Sidebar.setActive('human-resource', 'hr-staff'));
                document.getElementById('hr-go-payroll')?.addEventListener('click', () => PharmaFlow.Sidebar.setActive('human-resource', 'hr-payroll'));
                document.getElementById('hr-go-payslips')?.addEventListener('click', () => PharmaFlow.Sidebar.setActive('human-resource', 'hr-payslips'));
            } catch (err) {
                container.innerHTML = this.renderHrLoadError(err, 'dashboard');
                console.error('HR overview error:', err);
            }
        },

        renderHrLoadError(err, area) {
            const noBusiness = err && err.message === 'NO_BUSINESS_SELECTED';
            return this.pageShell('HR ' + area, 'fas fa-people-group', area, `
                <div class="card">
                    <div class="page-placeholder">
                        <i class="fas ${noBusiness ? 'fa-building-circle-exclamation' : 'fa-triangle-exclamation'}"></i>
                        <h2>${noBusiness ? 'Select a franchise first' : 'Failed to load HR ' + this.escapeHtml(area)}</h2>
                        <p>${noBusiness ? 'Use the franchise selector at the top to choose the business workspace for HR.' : 'Please refresh and try again. If it continues, check your HR permissions and Firestore access.'}</p>
                    </div>
                </div>`);
        },

        async renderStaff(container) {
            container.innerHTML = '<div class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading staff...</div>';
            try {
                await this.ensureData();
            } catch (err) {
                container.innerHTML = this.renderHrLoadError(err, 'staff');
                console.error('HR staff error:', err);
                return;
            }
            const body = `
            <div class="card">
                <div class="rpt-section-header">
                    <h3><i class="fas fa-users-gear"></i> Staff Register</h3>
                    <button class="dda-btn dda-btn--primary" id="hr-add-casual"><i class="fas fa-user-plus"></i> Add Casual Staff</button>
                </div>
                <div class="dda-table-wrap">
                    <table class="dda-table">
                        <thead><tr><th>#</th><th>Name</th><th>Type</th><th>Role / Job</th><th>Phone</th><th>Base Pay</th><th>Status</th><th>Actions</th></tr></thead>
                        <tbody id="hr-staff-body">${this.staffRows()}</tbody>
                    </table>
                </div>
            </div>`;
            container.innerHTML = this.pageShell('Staff Management', 'fas fa-users-gear', 'Staff', body);
            this.bindDashboardLink(container);
            document.getElementById('hr-add-casual')?.addEventListener('click', () => this.openCasualModal());
            container.querySelectorAll('.hr-edit-casual').forEach(btn => btn.addEventListener('click', () => this.openCasualModal(btn.dataset.id)));
            container.querySelectorAll('.hr-edit-system').forEach(btn => btn.addEventListener('click', () => this.openSystemProfileModal(btn.dataset.id)));
        },

        staffRows() {
            const staff = this.allStaff();
            if (!staff.length) return '<tr><td colspan="8" class="dda-loading"><i class="fas fa-inbox"></i> No staff found</td></tr>';
            return staff.map((s, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td><strong>${this.escapeHtml(this.staffLabel(s))}</strong><small>${this.escapeHtml(s.email || '')}</small></td>
                    <td><span class="ord-status-badge ${s.hrKind === 'system' ? 'ord-status--approved' : 'ord-status--pending'}">${s.staffType}</span></td>
                    <td>${this.escapeHtml(s.hrRole || s.jobTitle || s.role || '-')}</td>
                    <td>${this.escapeHtml(s.phone || '-')}</td>
                    <td>${s.basePay ? this.formatCurrency(s.basePay) : '-'}</td>
                    <td>${s.isActive === false || s.status === 'disabled' ? '<span class="ord-status-badge ord-status--cancelled">Inactive</span>' : '<span class="ord-status-badge ord-status--approved">Active</span>'}</td>
                    <td>${s.hrKind === 'casual' ? '<button class="sales-action-btn hr-edit-casual" data-id="' + this.escapeHtml(s.id) + '" title="Edit"><i class="fas fa-pen"></i></button>' : '<button class="sales-action-btn hr-edit-system" data-id="' + this.escapeHtml(s.id) + '" title="HR Settings"><i class="fas fa-gear"></i></button>'}</td>
                </tr>`).join('');
        },

        openSystemProfileModal(id) {
            const existing = hrUsers.find(s => s.id === id);
            if (!existing) return;
            const modal = document.createElement('div');
            modal.className = 'modal-overlay active';
            modal.innerHTML = `
            <div class="modal-content hr-modal">
                <div class="modal-header"><h3><i class="fas fa-id-badge"></i> System Staff HR Settings</h3><button class="modal-close">&times;</button></div>
                <div class="modal-body">
                    <div class="hr-system-note"><strong>${this.escapeHtml(this.staffLabel(existing))}</strong><span>${this.escapeHtml(existing.email || '')}</span></div>
                    <div class="dda-form-row"><div class="dda-form-group"><label>HR Role</label><select id="hr-s-role">${this.roleOptions(existing.hrRole || existing.jobTitle || existing.role || 'Staff')}</select></div><div class="dda-form-group"><label>Job Title</label><input id="hr-s-job" value="${this.escapeHtml(existing.jobTitle || '')}"></div></div>
                    <div class="dda-form-row"><div class="dda-form-group"><label>Base Pay</label><input type="number" id="hr-s-pay" value="${existing.basePay || 0}" min="0" step="0.01"></div><div class="dda-form-group"><label>Pay Cycle</label><select id="hr-s-cycle"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="daily">Daily</option></select></div></div>
                    <div class="dda-form-group"><label>Notes</label><textarea id="hr-s-notes" rows="2">${this.escapeHtml(existing.notes || '')}</textarea></div>
                </div>
                <div class="modal-footer"><button class="dda-btn dda-btn--cancel hr-modal-cancel">Cancel</button><button class="dda-btn dda-btn--primary" id="hr-save-system">Save HR Settings</button></div>
            </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#hr-s-cycle').value = existing.payCycle || 'monthly';
            const close = () => modal.remove();
            modal.querySelector('.modal-close').addEventListener('click', close);
            modal.querySelector('.hr-modal-cancel').addEventListener('click', close);
            modal.querySelector('#hr-save-system').addEventListener('click', async () => {
                await this.saveSystemProfile(existing.id);
                close();
                hrLoaded = false;
                this.renderStaff(document.getElementById('content-body'));
            });
        },

        async saveSystemProfile(id) {
            const businessId = this.getBusinessId();
            const user = hrUsers.find(s => s.id === id);
            if (!user) return;
            await getBusinessCollection(businessId, 'hr_staff_profiles').doc(id).set({
                userId: id,
                staffType: 'System',
                name: this.staffLabel(user),
                email: user.email || '',
                phone: user.phone || '',
                sourceRole: user.sourceRole || user.role || 'staff',
                hrRole: document.getElementById('hr-s-role').value,
                jobTitle: document.getElementById('hr-s-job').value.trim(),
                basePay: this.parseMoney('hr-s-pay'),
                payCycle: document.getElementById('hr-s-cycle').value,
                notes: document.getElementById('hr-s-notes').value.trim(),
                isActive: user.isActive !== false && user.active !== false && user.status !== 'disabled',
                autoDetected: true,
                businessId: businessId,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            this.showToast('System staff HR settings saved.');
        },

        openCasualModal(id) {
            const existing = id ? hrCasualStaff.find(s => s.id === id) : null;
            const modal = document.createElement('div');
            modal.className = 'modal-overlay active';
            modal.innerHTML = `
            <div class="modal-content hr-modal">
                <div class="modal-header"><h3><i class="fas fa-user-plus"></i> ${existing ? 'Edit' : 'Add'} Casual Staff</h3><button class="modal-close">&times;</button></div>
                <div class="modal-body">
                    <div class="dda-form-row"><div class="dda-form-group"><label>Full Name</label><input id="hr-c-name" value="${this.escapeHtml(existing?.name || '')}"></div><div class="dda-form-group"><label>HR Role</label><select id="hr-c-role">${this.roleOptions(existing?.hrRole || existing?.jobTitle || 'Casual Worker')}</select></div></div>
                    <div class="dda-form-row"><div class="dda-form-group"><label>Job Title</label><input id="hr-c-job" value="${this.escapeHtml(existing?.jobTitle || '')}" placeholder="Cleaner, Rider, Security..."></div><div class="dda-form-group"><label>Phone</label><input id="hr-c-phone" value="${this.escapeHtml(existing?.phone || '')}"></div></div>
                    <div class="dda-form-row"><div class="dda-form-group"><label>National ID</label><input id="hr-c-national" value="${this.escapeHtml(existing?.nationalId || '')}"></div><div class="dda-form-group"><label>Status</label><select id="hr-c-active"><option value="true">Active</option><option value="false">Inactive</option></select></div></div>
                    <div class="dda-form-row"><div class="dda-form-group"><label>Base Pay</label><input type="number" id="hr-c-pay" value="${existing?.basePay || 0}" min="0" step="0.01"></div><div class="dda-form-group"><label>Pay Cycle</label><select id="hr-c-cycle"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="daily">Daily</option></select></div></div>
                    <div class="dda-form-group"><label>Notes</label><textarea id="hr-c-notes" rows="2">${this.escapeHtml(existing?.notes || '')}</textarea></div>
                </div>
                <div class="modal-footer"><button class="dda-btn dda-btn--cancel hr-modal-cancel">Cancel</button><button class="dda-btn dda-btn--primary" id="hr-save-casual">Save Staff</button></div>
            </div>`;
            document.body.appendChild(modal);
            if (existing) modal.querySelector('#hr-c-cycle').value = existing.payCycle || 'monthly';
            if (existing) modal.querySelector('#hr-c-active').value = existing.isActive === false ? 'false' : 'true';
            const close = () => modal.remove();
            modal.querySelector('.modal-close').addEventListener('click', close);
            modal.querySelector('.hr-modal-cancel').addEventListener('click', close);
            modal.querySelector('#hr-save-casual').addEventListener('click', async () => {
                await this.saveCasualStaff(existing && existing.id);
                close();
                hrLoaded = false;
                this.renderStaff(document.getElementById('content-body'));
            });
        },

        async saveCasualStaff(id) {
            const businessId = this.getBusinessId();
            const data = {
                name: document.getElementById('hr-c-name').value.trim(),
                jobTitle: document.getElementById('hr-c-job').value.trim(),
                phone: document.getElementById('hr-c-phone').value.trim(),
                hrRole: document.getElementById('hr-c-role').value,
                nationalId: document.getElementById('hr-c-national').value.trim(),
                basePay: this.parseMoney('hr-c-pay'),
                payCycle: document.getElementById('hr-c-cycle').value,
                notes: document.getElementById('hr-c-notes').value.trim(),
                staffType: 'Casual',
                isActive: document.getElementById('hr-c-active').value !== 'false',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            if (!data.name) { this.showToast('Staff name is required.', 'error'); return; }
            const col = getBusinessCollection(businessId, 'hr_staff');
            if (id) await col.doc(id).set(data, { merge: true });
            else await col.add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
            this.showToast('Staff saved.');
        },

        async renderPayroll(container) {
            container.innerHTML = '<div class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading payroll...</div>';
            try {
                await this.ensureData();
            } catch (err) {
                container.innerHTML = this.renderHrLoadError(err, 'payroll');
                console.error('HR payroll error:', err);
                return;
            }
            const staffOptions = this.allStaff().map(s => '<option value="' + this.escapeHtml(this.staffId(s)) + '">' + this.escapeHtml(this.staffLabel(s)) + ' - ' + s.staffType + '</option>').join('');
            const body = `
            <div class="rpt-grid-2">
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-money-check-dollar"></i> Generate Payroll / Payslip</h3></div>
                    <div class="rpt-gen-form">
                        <div class="form-row"><div class="form-group"><label>Staff</label><select id="hr-pay-staff" class="form-control">${staffOptions}</select></div><div class="form-group"><label>Period</label><input type="month" id="hr-pay-period" class="form-control" value="${new Date().toISOString().slice(0, 7)}"></div></div>
                        <div class="form-row"><div class="form-group"><label>Basic Pay</label><input type="number" id="hr-basic" class="form-control" value="0"></div><div class="form-group"><label>Allowances</label><input type="number" id="hr-allowances" class="form-control" value="0"></div></div>
                        <div class="form-row"><div class="form-group"><label>Deductions</label><input type="number" id="hr-deductions" class="form-control" value="0"></div><div class="form-group"><label>Payment Method</label><select id="hr-pay-method" class="form-control"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="bank">Bank</option><option value="cheque">Cheque</option></select></div></div>
                        <div class="form-group"><label>Notes</label><textarea id="hr-pay-notes" class="form-control" rows="2"></textarea></div>
                        <button class="btn btn-primary btn-lg" id="hr-generate-pay"><i class="fas fa-file-invoice-dollar"></i> Generate Payslip</button>
                    </div>
                </div>
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-clock-rotate-left"></i> Recent Payroll</h3></div>
                    <div class="dda-table-wrap"><table class="dda-table"><thead><tr><th>Period</th><th>Staff</th><th>Net Pay</th><th>Status</th></tr></thead><tbody>${this.payrollRows(true)}</tbody></table></div>
                </div>
            </div>`;
            container.innerHTML = this.pageShell('Payroll Automation', 'fas fa-money-check-dollar', 'Payroll', body);
            this.bindDashboardLink(container);
            const select = document.getElementById('hr-pay-staff');
            const syncBase = () => {
                const st = this.allStaff().find(s => this.staffId(s) === select.value);
                if (st) document.getElementById('hr-basic').value = st.basePay || 0;
            };
            select?.addEventListener('change', syncBase);
            syncBase();
            document.getElementById('hr-generate-pay')?.addEventListener('click', () => this.generatePayroll());
        },

        async generatePayroll() {
            const businessId = this.getBusinessId();
            const staffKey = document.getElementById('hr-pay-staff').value;
            const staff = this.allStaff().find(s => this.staffId(s) === staffKey);
            if (!staff) { this.showToast('Select staff first.', 'error'); return; }
            const basicPay = this.parseMoney('hr-basic');
            const allowances = this.parseMoney('hr-allowances');
            const deductions = this.parseMoney('hr-deductions');
            const grossPay = basicPay + allowances;
            const netPay = Math.max(0, grossPay - deductions);
            const period = document.getElementById('hr-pay-period').value || new Date().toISOString().slice(0, 7);
            const createdBy = PharmaFlow.Auth?.userProfile ? (PharmaFlow.Auth.userProfile.displayName || PharmaFlow.Auth.userProfile.email) : 'Unknown';
            await getBusinessCollection(businessId, 'hr_payroll').add({
                staffKey,
                staffId: staff.id,
                staffKind: staff.hrKind,
                staffType: staff.staffType,
                staffName: this.staffLabel(staff),
                hrRole: staff.hrRole || staff.jobTitle || staff.role || '',
                jobTitle: staff.jobTitle || staff.hrRole || staff.role || '',
                period,
                basicPay,
                allowances,
                totalDeductions: deductions,
                grossPay,
                netPay,
                paymentMethod: document.getElementById('hr-pay-method').value,
                notes: document.getElementById('hr-pay-notes').value.trim(),
                status: 'generated',
                createdBy,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.showToast('Payslip generated.');
            hrLoaded = false;
            this.renderPayroll(document.getElementById('content-body'));
        },

        payrollRows(limit) {
            const rows = (limit ? hrPayroll.slice(0, 8) : hrPayroll);
            if (!rows.length) return '<tr><td colspan="' + (limit ? 4 : 7) + '" class="dda-loading"><i class="fas fa-inbox"></i> No payroll records yet</td></tr>';
            return rows.map((p, i) => limit
                ? `<tr><td>${this.escapeHtml(p.period || '-')}</td><td>${this.escapeHtml(p.staffName || '-')}</td><td>${this.formatCurrency(p.netPay || 0)}</td><td><span class="ord-status-badge ord-status--approved">${this.escapeHtml(p.status || 'generated')}</span></td></tr>`
                : `<tr><td>${i + 1}</td><td>${this.escapeHtml(p.period || '-')}</td><td><strong>${this.escapeHtml(p.staffName || '-')}</strong><small>${this.escapeHtml(p.jobTitle || '')}</small></td><td>${this.escapeHtml(p.staffType || '-')}</td><td>${this.formatCurrency(p.grossPay || 0)}</td><td>${this.formatCurrency(p.totalDeductions || 0)}</td><td><strong>${this.formatCurrency(p.netPay || 0)}</strong></td><td><button class="sales-action-btn hr-print-slip" data-id="${this.escapeHtml(p.id)}" title="Print Payslip"><i class="fas fa-print"></i></button></td></tr>`
            ).join('');
        },

        async renderPayslips(container) {
            container.innerHTML = '<div class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading payslips...</div>';
            try {
                await this.ensureData();
            } catch (err) {
                container.innerHTML = this.renderHrLoadError(err, 'payslips');
                console.error('HR payslips error:', err);
                return;
            }
            const body = `
            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-file-invoice-dollar"></i> Payslips</h3></div>
                <div class="dda-table-wrap"><table class="dda-table"><thead><tr><th>#</th><th>Period</th><th>Staff</th><th>Type</th><th>Gross</th><th>Deductions</th><th>Net Pay</th><th>Action</th></tr></thead><tbody>${this.payrollRows(false)}</tbody></table></div>
            </div>`;
            container.innerHTML = this.pageShell('Payslips', 'fas fa-file-invoice-dollar', 'Payslips', body);
            this.bindDashboardLink(container);
            container.querySelectorAll('.hr-print-slip').forEach(btn => btn.addEventListener('click', () => this.printPayslip(btn.dataset.id)));
        },

        printPayslip(id) {
            const p = hrPayroll.find(x => x.id === id);
            if (!p) return;
            const business = PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow';
            const html = `<!doctype html><html><head><title>Payslip</title><style>body{font-family:Arial,sans-serif;max-width:720px;margin:30px auto;color:#111827}h1{font-size:22px;margin-bottom:4px}.meta{color:#64748b;margin-bottom:22px}.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #e5e7eb}.total{font-weight:700;font-size:18px;border-top:2px solid #111827;margin-top:10px}</style></head><body><h1>${this.escapeHtml(business)} - Payslip</h1><div class="meta">Period: ${this.escapeHtml(p.period || '-')} | Staff: ${this.escapeHtml(p.staffName || '-')}</div><div class="row"><span>Job Title</span><strong>${this.escapeHtml(p.jobTitle || '-')}</strong></div><div class="row"><span>Basic Pay</span><strong>${this.formatCurrency(p.basicPay || 0)}</strong></div><div class="row"><span>Allowances</span><strong>${this.formatCurrency(p.allowances || 0)}</strong></div><div class="row"><span>Deductions</span><strong>${this.formatCurrency(p.totalDeductions || 0)}</strong></div><div class="row total"><span>Net Pay</span><strong>${this.formatCurrency(p.netPay || 0)}</strong></div><p class="meta">Generated by ${this.escapeHtml(p.createdBy || '-')}</p></body></html>`;
            const w = window.open('', '_blank');
            w.document.write(html);
            w.document.close();
            w.focus();
            w.print();
        },

        async renderReports(container) {
            container.innerHTML = '<div class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading HR reports...</div>';
            try {
                await this.ensureData();
            } catch (err) {
                container.innerHTML = this.renderHrLoadError(err, 'reports');
                console.error('HR reports error:', err);
                return;
            }
            const byType = { System: hrUsers.length, Casual: hrCasualStaff.length };
            const byPeriod = {};
            hrPayroll.forEach(p => {
                if (!byPeriod[p.period]) byPeriod[p.period] = { gross: 0, deductions: 0, net: 0, count: 0 };
                byPeriod[p.period].gross += p.grossPay || 0;
                byPeriod[p.period].deductions += p.totalDeductions || 0;
                byPeriod[p.period].net += p.netPay || 0;
                byPeriod[p.period].count++;
            });
            const periodRows = Object.entries(byPeriod).sort((a, b) => b[0].localeCompare(a[0])).map(([period, v]) => `<tr><td>${this.escapeHtml(period)}</td><td>${v.count}</td><td>${this.formatCurrency(v.gross)}</td><td>${this.formatCurrency(v.deductions)}</td><td><strong>${this.formatCurrency(v.net)}</strong></td></tr>`).join('');
            const body = `
            <div class="dda-stats hr-stats">
                <div class="dda-stat-card"><div class="dda-stat-icon"><i class="fas fa-id-badge"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${byType.System}</span><span class="dda-stat-label">System Staff</span></div></div>
                <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-person-digging"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${byType.Casual}</span><span class="dda-stat-label">Casual Staff</span></div></div>
                <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--revenue"><i class="fas fa-file-invoice"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${hrPayroll.length}</span><span class="dda-stat-label">Payslips</span></div></div>
            </div>
            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-chart-column"></i> Payroll by Period</h3></div>
                <div class="dda-table-wrap"><table class="dda-table"><thead><tr><th>Period</th><th>Payslips</th><th>Gross</th><th>Deductions</th><th>Net</th></tr></thead><tbody>${periodRows || '<tr><td colspan="5" class="dda-loading">No payroll reports yet</td></tr>'}</tbody></table></div>
            </div>`;
            container.innerHTML = this.pageShell('HR Reports', 'fas fa-chart-column', 'Reports', body);
            this.bindDashboardLink(container);
        }
    };

    window.PharmaFlow.HumanResource = HR;
})();
