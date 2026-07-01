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
    let hrAdvances = [];
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
            hrAdvances = [];
        },

        staffLabel(staff) {
            return staff.displayName || staff.name || staff.email || 'Unnamed staff';
        },

        staffId(staff) {
            return staff.hrKind + ':' + staff.id;
        },

        advanceSignedAmount(entry) {
            const amount = Math.max(0, Number(entry.amount) || 0);
            return entry.type === 'repayment' ? -amount : amount;
        },

        staffAdvanceBalance(staffKey) {
            const balance = hrAdvances
                .filter(entry => entry.staffKey === staffKey)
                .reduce((sum, entry) => sum + this.advanceSignedAmount(entry), 0);
            return this.roundMoney(Math.max(0, balance));
        },

        staffAdvanceEntries(staffKey) {
            return hrAdvances
                .filter(entry => entry.staffKey === staffKey)
                .sort((a, b) => {
                    const ad = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                    const bd = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                    return bd.getTime() - ad.getTime();
                });
        },

        parseMoney(id) {
            return Math.max(0, parseFloat((document.getElementById(id) || {}).value) || 0);
        },

        roundMoney(value) {
            return Math.round((Number(value) || 0) * 100) / 100;
        },

        calculatePaye(taxablePay) {
            let remaining = Math.max(0, Number(taxablePay) || 0);
            const bands = [
                { limit: 24000, rate: 0.10 },
                { limit: 8333, rate: 0.25 },
                { limit: 467667, rate: 0.30 },
                { limit: 300000, rate: 0.325 },
                { limit: Infinity, rate: 0.35 }
            ];
            let tax = 0;
            bands.forEach(band => {
                if (remaining <= 0) return;
                const amount = Math.min(remaining, band.limit);
                tax += amount * band.rate;
                remaining -= amount;
            });
            return this.roundMoney(Math.max(0, tax - 2400));
        },

        calculateStatutoryDeductions(grossPay) {
            const gross = Math.max(0, Number(grossPay) || 0);
            if (!gross) {
                return { nssf: 0, shif: 0, housingLevy: 0, paye: 0, total: 0, taxablePay: 0 };
            }
            const nssf = this.roundMoney(Math.min(gross, 108000) * 0.06);
            const shif = this.roundMoney(Math.max(300, gross * 0.0275));
            const housingLevy = this.roundMoney(gross * 0.015);
            const taxablePay = this.roundMoney(Math.max(0, gross - nssf - shif - housingLevy));
            const paye = this.calculatePaye(taxablePay);
            const total = this.roundMoney(nssf + shif + housingLevy + paye);
            return { nssf, shif, housingLevy, paye, total, taxablePay };
        },

        statutoryBreakdownHtml(deductions) {
            const d = deductions || this.calculateStatutoryDeductions(0);
            return `
                <div class="hr-statutory-row"><span>NSSF</span><strong>${this.formatCurrency(d.nssf)}</strong></div>
                <div class="hr-statutory-row"><span>SHIF</span><strong>${this.formatCurrency(d.shif)}</strong></div>
                <div class="hr-statutory-row"><span>Housing Levy</span><strong>${this.formatCurrency(d.housingLevy)}</strong></div>
                <div class="hr-statutory-row"><span>PAYE</span><strong>${this.formatCurrency(d.paye)}</strong></div>
                <div class="hr-statutory-row hr-statutory-row--total"><span>Total statutory</span><strong>${this.formatCurrency(d.total)}</strong></div>`;
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
            const advancesCol = getBusinessCollection(businessId, 'hr_advances');
            const [usersSnap, casualSnap, payrollSnap, profilesSnap, advancesSnap] = await Promise.all([
                userQuery.get(),
                casualCol.get(),
                payrollCol.get(),
                profilesCol.get(),
                advancesCol.get()
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
            hrAdvances = advancesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
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

        bindStaffActions(container) {
            if (container.dataset.hrStaffActionsBound === 'true') return;
            container.dataset.hrStaffActionsBound = 'true';
            container.addEventListener('click', e => {
                const addBtn = e.target.closest('#hr-add-casual, [data-hr-action="add-casual"]');
                const editCasualBtn = e.target.closest('[data-hr-action="edit-casual"]');
                const editSystemBtn = e.target.closest('[data-hr-action="edit-system"]');
                const advanceBtn = e.target.closest('[data-hr-action="advance-payment"]');

                if (addBtn) {
                    e.preventDefault();
                    this.openCasualModal();
                    return;
                }
                if (editCasualBtn) {
                    e.preventDefault();
                    this.openCasualModal(editCasualBtn.dataset.id);
                    return;
                }
                if (editSystemBtn) {
                    e.preventDefault();
                    this.openSystemProfileModal(editSystemBtn.dataset.id);
                    return;
                }
                if (advanceBtn) {
                    e.preventDefault();
                    this.openAdvanceModal(advanceBtn.dataset.staffKey || '');
                }
            });
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
                const advanceBalance = this.roundMoney(hrAdvances.reduce((s, entry) => s + this.advanceSignedAmount(entry), 0));
                const body = `
                <div class="dda-stats hr-stats">
                    <div class="dda-stat-card"><div class="dda-stat-icon"><i class="fas fa-users"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${staff.length}</span><span class="dda-stat-label">Total Staff</span></div></div>
                    <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-id-badge"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${hrUsers.length}</span><span class="dda-stat-label">System Staff</span></div></div>
                    <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-person-digging"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${hrCasualStaff.length}</span><span class="dda-stat-label">Casual Staff</span></div></div>
                    <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--revenue"><i class="fas fa-money-check-dollar"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${this.formatCurrency(net)}</span><span class="dda-stat-label">Net Payroll This Month</span></div></div>
                    <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-hand-holding-dollar"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${this.formatCurrency(advanceBalance)}</span><span class="dda-stat-label">Advance Balances</span></div></div>
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
                            <button class="adm-action-card" id="hr-go-staff" data-hr-action="add-casual"><i class="fas fa-user-plus"></i><span>Add Staff</span></button>
                            <button class="adm-action-card" data-hr-action="advance-payment"><i class="fas fa-hand-holding-dollar"></i><span>Advance Payment</span></button>
                            <button class="adm-action-card" id="hr-go-payroll"><i class="fas fa-money-check-dollar"></i><span>Run Payroll</span></button>
                            <button class="adm-action-card" id="hr-go-payslips"><i class="fas fa-file-invoice"></i><span>View Payslips</span></button>
                        </div>
                    </div>
                </div>`;
                container.innerHTML = this.pageShell('HR Dashboard', 'fas fa-people-group', 'Overview', body);
                this.bindDashboardLink(container);
                this.bindStaffActions(container);
                document.getElementById('hr-go-payroll')?.addEventListener('click', () => PharmaFlow.Sidebar.setActive('human-resource', 'hr-payroll'));
                document.getElementById('hr-go-payslips')?.addEventListener('click', () => PharmaFlow.Sidebar.setActive('human-resource', 'hr-payslips'));
            } catch (err) {
                container.innerHTML = this.renderHrLoadError(err, 'dashboard');
                console.error('HR overview error:', err);
            }
        },

        renderHrLoadError(err, area) {
            const noBusiness = err && err.message === 'NO_BUSINESS_SELECTED';
            const rawCode = err && (err.code || err.message) ? String(err.code || err.message) : '';
            const permissionDenied = rawCode.indexOf('permission-denied') !== -1 || rawCode.indexOf('PERMISSION_DENIED') !== -1;
            const detail = permissionDenied
                ? 'Firebase denied access to HR records. Deploy the updated Firestore rules and confirm this user has Human Resource permission.'
                : 'Please refresh and try again. If it continues, check your HR permissions and Firestore access.';
            return this.pageShell('HR ' + area, 'fas fa-people-group', area, `
                <div class="card">
                    <div class="page-placeholder">
                        <i class="fas ${noBusiness ? 'fa-building-circle-exclamation' : 'fa-triangle-exclamation'}"></i>
                        <h2>${noBusiness ? 'Select a franchise first' : 'Failed to load HR ' + this.escapeHtml(area)}</h2>
                        <p>${noBusiness ? 'Use the franchise selector at the top to choose the business workspace for HR.' : this.escapeHtml(detail)}</p>
                        ${!noBusiness && rawCode ? '<small class="hr-error-code">Error: ' + this.escapeHtml(rawCode) + '</small>' : ''}
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
                    <div class="dda-toolbar-actions">
                        <button class="dda-btn dda-btn--secondary" data-hr-action="advance-payment"><i class="fas fa-hand-holding-dollar"></i> Add Advance Payment</button>
                        <button class="dda-btn dda-btn--primary" id="hr-add-casual"><i class="fas fa-user-plus"></i> Add Casual Staff</button>
                    </div>
                </div>
                <div class="dda-table-wrap">
                    <table class="dda-table">
                        <thead><tr><th>#</th><th>Name</th><th>Type</th><th>Role / Job</th><th>Phone</th><th>Base Pay</th><th>Advance Balance</th><th>Status</th><th>Actions</th></tr></thead>
                        <tbody id="hr-staff-body">${this.staffRows()}</tbody>
                    </table>
                </div>
            </div>`;
            container.innerHTML = this.pageShell('Staff Management', 'fas fa-users-gear', 'Staff', body);
            this.bindDashboardLink(container);
            this.bindStaffActions(container);
        },

        staffRows() {
            const staff = this.allStaff();
            if (!staff.length) return '<tr><td colspan="9" class="dda-loading"><i class="fas fa-inbox"></i> No staff found</td></tr>';
            return staff.map((s, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td><strong>${this.escapeHtml(this.staffLabel(s))}</strong><small>${this.escapeHtml(s.email || '')}</small></td>
                    <td><span class="ord-status-badge ${s.hrKind === 'system' ? 'ord-status--approved' : 'ord-status--pending'}">${s.staffType}</span></td>
                    <td>${this.escapeHtml(s.hrRole || s.jobTitle || s.role || '-')}</td>
                    <td>${this.escapeHtml(s.phone || '-')}</td>
                    <td>${s.basePay ? this.formatCurrency(s.basePay) : '-'}</td>
                    <td><strong>${this.formatCurrency(this.staffAdvanceBalance(this.staffId(s)))}</strong></td>
                    <td>${s.isActive === false || s.status === 'disabled' ? '<span class="ord-status-badge ord-status--cancelled">Inactive</span>' : '<span class="ord-status-badge ord-status--approved">Active</span>'}</td>
                    <td>
                        <button type="button" class="sales-action-btn" data-hr-action="advance-payment" data-staff-key="${this.escapeHtml(this.staffId(s))}" title="Add advance payment" aria-label="Add advance payment"><i class="fas fa-hand-holding-dollar"></i></button>
                        ${s.hrKind === 'casual' ? '<button type="button" class="sales-action-btn hr-edit-casual" data-hr-action="edit-casual" data-id="' + this.escapeHtml(s.id) + '" title="Edit casual staff" aria-label="Edit casual staff"><i class="fas fa-pen"></i></button>' : '<button type="button" class="sales-action-btn hr-edit-system" data-hr-action="edit-system" data-id="' + this.escapeHtml(s.id) + '" title="HR settings" aria-label="Open HR settings"><i class="fas fa-gear"></i></button>'}
                    </td>
                </tr>`).join('');
        },

        openSystemProfileModal(id) {
            const existing = hrUsers.find(s => s.id === id);
            if (!existing) {
                this.showToast('Staff record was not found. Refresh and try again.', 'error');
                return;
            }
            const modal = document.createElement('div');
            modal.className = 'hr-modal-overlay active';
            modal.innerHTML = `
            <div class="hr-modal" role="dialog" aria-modal="true" aria-labelledby="hr-system-modal-title">
                <div class="hr-modal-header"><h3 id="hr-system-modal-title"><i class="fas fa-id-badge"></i> System Staff HR Settings</h3><button type="button" class="hr-modal-close" aria-label="Close">&times;</button></div>
                <div class="hr-modal-body">
                    <div class="hr-system-note"><strong>${this.escapeHtml(this.staffLabel(existing))}</strong><span>${this.escapeHtml(existing.email || '')}</span></div>
                    <div class="dda-form-row"><div class="dda-form-group"><label>HR Role</label><select id="hr-s-role">${this.roleOptions(existing.hrRole || existing.jobTitle || existing.role || 'Staff')}</select></div><div class="dda-form-group"><label>Job Title</label><input id="hr-s-job" value="${this.escapeHtml(existing.jobTitle || '')}"></div></div>
                    <div class="dda-form-row"><div class="dda-form-group"><label>Base Pay</label><input type="number" id="hr-s-pay" value="${existing.basePay || 0}" min="0" step="0.01"></div><div class="dda-form-group"><label>Pay Cycle</label><select id="hr-s-cycle"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="daily">Daily</option></select></div></div>
                    <div class="dda-form-group"><label>Notes</label><textarea id="hr-s-notes" rows="2">${this.escapeHtml(existing.notes || '')}</textarea></div>
                </div>
                <div class="hr-modal-footer"><button type="button" class="dda-btn dda-btn--cancel hr-modal-cancel">Cancel</button><button type="button" class="dda-btn dda-btn--primary" id="hr-save-system">Save HR Settings</button></div>
            </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#hr-s-cycle').value = existing.payCycle || 'monthly';
            const close = () => modal.remove();
            modal.querySelector('.hr-modal-close').addEventListener('click', close);
            modal.querySelector('.hr-modal-cancel').addEventListener('click', close);
            modal.addEventListener('click', e => { if (e.target === modal) close(); });
            modal.querySelector('#hr-save-system').addEventListener('click', async () => {
                try {
                    await this.saveSystemProfile(existing.id);
                    close();
                    hrLoaded = false;
                    this.renderStaff(document.getElementById('content-body'));
                } catch (err) {
                    console.error('HR system staff save failed:', err);
                    this.showToast('Could not save HR settings.', 'error');
                }
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
            modal.className = 'hr-modal-overlay active';
            modal.innerHTML = `
            <div class="hr-modal" role="dialog" aria-modal="true" aria-labelledby="hr-casual-modal-title">
                <div class="hr-modal-header"><h3 id="hr-casual-modal-title"><i class="fas fa-user-plus"></i> ${existing ? 'Edit' : 'Add'} Staff</h3><button type="button" class="hr-modal-close" aria-label="Close">&times;</button></div>
                <div class="hr-modal-body">
                    <div class="dda-form-row"><div class="dda-form-group"><label>Full Name</label><input id="hr-c-name" value="${this.escapeHtml(existing?.name || '')}"></div><div class="dda-form-group"><label>HR Role</label><select id="hr-c-role">${this.roleOptions(existing?.hrRole || existing?.jobTitle || 'Casual Worker')}</select></div></div>
                    <div class="dda-form-row"><div class="dda-form-group"><label>Job Title</label><input id="hr-c-job" value="${this.escapeHtml(existing?.jobTitle || '')}" placeholder="Cleaner, Rider, Security..."></div><div class="dda-form-group"><label>Phone</label><input id="hr-c-phone" value="${this.escapeHtml(existing?.phone || '')}"></div></div>
                    <div class="dda-form-row"><div class="dda-form-group"><label>National ID</label><input id="hr-c-national" value="${this.escapeHtml(existing?.nationalId || '')}"></div><div class="dda-form-group"><label>Status</label><select id="hr-c-active"><option value="true">Active</option><option value="false">Inactive</option></select></div></div>
                    <div class="dda-form-row"><div class="dda-form-group"><label>Base Pay</label><input type="number" id="hr-c-pay" value="${existing?.basePay || 0}" min="0" step="0.01"></div><div class="dda-form-group"><label>Pay Cycle</label><select id="hr-c-cycle"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="daily">Daily</option></select></div></div>
                    <div class="dda-form-group"><label>Notes</label><textarea id="hr-c-notes" rows="2">${this.escapeHtml(existing?.notes || '')}</textarea></div>
                </div>
                <div class="hr-modal-footer"><button type="button" class="dda-btn dda-btn--cancel hr-modal-cancel">Cancel</button><button type="button" class="dda-btn dda-btn--primary" id="hr-save-casual">Save Staff</button></div>
            </div>`;
            document.body.appendChild(modal);
            if (existing) modal.querySelector('#hr-c-cycle').value = existing.payCycle || 'monthly';
            if (existing) modal.querySelector('#hr-c-active').value = existing.isActive === false ? 'false' : 'true';
            const close = () => modal.remove();
            modal.querySelector('.hr-modal-close').addEventListener('click', close);
            modal.querySelector('.hr-modal-cancel').addEventListener('click', close);
            modal.addEventListener('click', e => { if (e.target === modal) close(); });
            modal.querySelector('#hr-save-casual').addEventListener('click', async () => {
                try {
                    const saved = await this.saveCasualStaff(existing && existing.id);
                    if (!saved) return;
                    close();
                    hrLoaded = false;
                    this.renderStaff(document.getElementById('content-body'));
                } catch (err) {
                    console.error('HR casual staff save failed:', err);
                    this.showToast('Could not save staff.', 'error');
                }
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
            if (!data.name) { this.showToast('Staff name is required.', 'error'); return false; }
            const col = getBusinessCollection(businessId, 'hr_staff');
            if (id) await col.doc(id).set(data, { merge: true });
            else await col.add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
            this.showToast('Staff saved.');
            return true;
        },

        openAdvanceModal(staffKey) {
            const staffOptions = this.allStaff().map(s => {
                const key = this.staffId(s);
                return '<option value="' + this.escapeHtml(key) + '"' + (key === staffKey ? ' selected' : '') + '>' + this.escapeHtml(this.staffLabel(s)) + ' - ' + this.escapeHtml(s.staffType) + '</option>';
            }).join('');
            const selectedStaff = this.allStaff().find(s => this.staffId(s) === staffKey) || this.allStaff()[0];
            const selectedKey = selectedStaff ? this.staffId(selectedStaff) : '';
            const modal = document.createElement('div');
            modal.className = 'hr-modal-overlay active';
            modal.innerHTML = `
            <div class="hr-modal" role="dialog" aria-modal="true" aria-labelledby="hr-advance-modal-title">
                <div class="hr-modal-header"><h3 id="hr-advance-modal-title"><i class="fas fa-hand-holding-dollar"></i> Advance Payment</h3><button type="button" class="hr-modal-close" aria-label="Close">&times;</button></div>
                <div class="hr-modal-body">
                    <div class="dda-form-row">
                        <div class="dda-form-group"><label>Staff</label><select id="hr-a-staff">${staffOptions}</select></div>
                        <div class="dda-form-group"><label>Amount</label><input type="number" id="hr-a-amount" min="0" step="0.01" value="0"></div>
                    </div>
                    <div class="dda-form-row">
                        <div class="dda-form-group"><label>Payment Method</label><select id="hr-a-method"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="bank">Bank</option><option value="cheque">Cheque</option></select></div>
                        <div class="dda-form-group"><label>Reference</label><input id="hr-a-reference" placeholder="Receipt, M-Pesa code, voucher..."></div>
                    </div>
                    <div class="dda-form-group"><label>Notes</label><textarea id="hr-a-notes" rows="2"></textarea></div>
                    <div class="hr-statutory-panel">
                        <div class="hr-statutory-row"><span>Current outstanding balance</span><strong id="hr-a-current">${this.formatCurrency(this.staffAdvanceBalance(selectedKey))}</strong></div>
                        <div class="hr-statutory-row hr-statutory-row--total"><span>Balance after this advance</span><strong id="hr-a-after">${this.formatCurrency(this.staffAdvanceBalance(selectedKey))}</strong></div>
                    </div>
                    <div class="dda-table-wrap">
                        <table class="dda-table">
                            <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Reference</th></tr></thead>
                            <tbody id="hr-a-history">${this.advanceRows(selectedKey)}</tbody>
                        </table>
                    </div>
                </div>
                <div class="hr-modal-footer"><button type="button" class="dda-btn dda-btn--cancel hr-modal-cancel">Cancel</button><button type="button" class="dda-btn dda-btn--primary" id="hr-save-advance">Save Advance</button></div>
            </div>`;
            document.body.appendChild(modal);
            const close = () => modal.remove();
            const syncBalance = () => {
                const key = modal.querySelector('#hr-a-staff').value;
                const amount = this.parseMoney('hr-a-amount');
                const current = this.staffAdvanceBalance(key);
                modal.querySelector('#hr-a-current').textContent = this.formatCurrency(current);
                modal.querySelector('#hr-a-after').textContent = this.formatCurrency(current + amount);
                modal.querySelector('#hr-a-history').innerHTML = this.advanceRows(key);
            };
            modal.querySelector('.hr-modal-close').addEventListener('click', close);
            modal.querySelector('.hr-modal-cancel').addEventListener('click', close);
            modal.addEventListener('click', e => { if (e.target === modal) close(); });
            modal.querySelector('#hr-a-staff').addEventListener('change', syncBalance);
            modal.querySelector('#hr-a-amount').addEventListener('input', syncBalance);
            modal.querySelector('#hr-save-advance').addEventListener('click', async () => {
                try {
                    const saved = await this.saveAdvancePayment();
                    if (!saved) return;
                    close();
                    hrLoaded = false;
                    this.renderStaff(document.getElementById('content-body'));
                } catch (err) {
                    console.error('HR advance save failed:', err);
                    this.showToast('Could not save advance payment.', 'error');
                }
            });
            syncBalance();
        },

        advanceRows(staffKey) {
            const rows = this.staffAdvanceEntries(staffKey).slice(0, 8);
            if (!rows.length) return '<tr><td colspan="4" class="dda-loading">No advance history</td></tr>';
            return rows.map(entry => {
                const date = entry.createdAt && entry.createdAt.toDate ? entry.createdAt.toDate() : new Date(entry.createdAt || Date.now());
                const amount = this.advanceSignedAmount(entry);
                return `<tr><td>${this.escapeHtml(date.toLocaleDateString())}</td><td>${this.escapeHtml(entry.type || 'advance')}</td><td><strong>${this.formatCurrency(amount)}</strong></td><td>${this.escapeHtml(entry.reference || entry.payrollId || '-')}</td></tr>`;
            }).join('');
        },

        async saveAdvancePayment() {
            const businessId = this.getBusinessId();
            const staffKey = document.getElementById('hr-a-staff').value;
            const staff = this.allStaff().find(s => this.staffId(s) === staffKey);
            const amount = this.parseMoney('hr-a-amount');
            if (!staff) { this.showToast('Select staff first.', 'error'); return false; }
            if (amount <= 0) { this.showToast('Advance amount must be greater than zero.', 'error'); return false; }
            await getBusinessCollection(businessId, 'hr_advances').add({
                type: 'advance',
                staffKey,
                staffId: staff.id,
                staffKind: staff.hrKind,
                staffType: staff.staffType,
                staffName: this.staffLabel(staff),
                amount,
                paymentMethod: document.getElementById('hr-a-method').value,
                reference: document.getElementById('hr-a-reference').value.trim(),
                notes: document.getElementById('hr-a-notes').value.trim(),
                createdBy: PharmaFlow.Auth?.userProfile ? (PharmaFlow.Auth.userProfile.displayName || PharmaFlow.Auth.userProfile.email) : 'Unknown',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.showToast('Advance payment saved.');
            return true;
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
                        <div class="form-row"><div class="form-group"><label>Other Deductions</label><input type="number" id="hr-other-deductions" class="form-control" value="0"></div><div class="form-group"><label>Advance Repayment</label><input type="number" id="hr-advance-repayment" class="form-control" value="0" min="0" step="0.01"></div></div>
                        <div class="form-row"><div class="form-group"><label>Total Deductions</label><input type="number" id="hr-deductions" class="form-control" value="0" readonly></div><div class="form-group"><label>Payment Method</label><select id="hr-pay-method" class="form-control"><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="bank">Bank</option><option value="cheque">Cheque</option></select></div></div>
                        <div class="hr-statutory-panel">
                            <div class="hr-statutory-row"><span>Outstanding advance balance</span><strong id="hr-advance-balance">KSH 0.00</strong></div>
                            <div class="hr-statutory-row hr-statutory-row--total"><span>Balance after repayment</span><strong id="hr-advance-after">KSH 0.00</strong></div>
                        </div>
                        <div class="hr-statutory-panel">
                            <label class="hr-statutory-toggle"><input type="checkbox" id="hr-apply-statutory" checked> Apply statutory deductions</label>
                            <div class="hr-statutory-breakdown" id="hr-statutory-breakdown">${this.statutoryBreakdownHtml(this.calculateStatutoryDeductions(0))}</div>
                        </div>
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
                const balance = st ? this.staffAdvanceBalance(this.staffId(st)) : 0;
                const repaymentInput = document.getElementById('hr-advance-repayment');
                if (repaymentInput) repaymentInput.value = Math.min(balance, this.parseMoney('hr-basic')).toFixed(2);
                syncStatutory();
            };
            const syncStatutory = () => {
                const gross = this.parseMoney('hr-basic') + this.parseMoney('hr-allowances');
                const apply = document.getElementById('hr-apply-statutory')?.checked;
                const statutory = apply ? this.calculateStatutoryDeductions(gross) : this.calculateStatutoryDeductions(0);
                const manual = this.parseMoney('hr-other-deductions');
                const selectedStaff = this.allStaff().find(s => this.staffId(s) === select.value);
                const advanceBalance = selectedStaff ? this.staffAdvanceBalance(this.staffId(selectedStaff)) : 0;
                const repaymentInput = document.getElementById('hr-advance-repayment');
                const advanceRepayment = Math.min(this.parseMoney('hr-advance-repayment'), advanceBalance);
                if (repaymentInput && this.parseMoney('hr-advance-repayment') !== advanceRepayment) repaymentInput.value = advanceRepayment.toFixed(2);
                const deductionsInput = document.getElementById('hr-deductions');
                const breakdown = document.getElementById('hr-statutory-breakdown');
                const balanceEl = document.getElementById('hr-advance-balance');
                const afterEl = document.getElementById('hr-advance-after');
                if (deductionsInput) deductionsInput.value = this.roundMoney(manual + advanceRepayment + statutory.total).toFixed(2);
                if (breakdown) breakdown.innerHTML = this.statutoryBreakdownHtml(statutory);
                if (balanceEl) balanceEl.textContent = this.formatCurrency(advanceBalance);
                if (afterEl) afterEl.textContent = this.formatCurrency(Math.max(0, advanceBalance - advanceRepayment));
            };
            select?.addEventListener('change', syncBase);
            document.getElementById('hr-basic')?.addEventListener('input', syncStatutory);
            document.getElementById('hr-allowances')?.addEventListener('input', syncStatutory);
            document.getElementById('hr-other-deductions')?.addEventListener('input', syncStatutory);
            document.getElementById('hr-advance-repayment')?.addEventListener('input', syncStatutory);
            document.getElementById('hr-apply-statutory')?.addEventListener('change', syncStatutory);
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
            const grossPay = basicPay + allowances;
            const applyStatutory = document.getElementById('hr-apply-statutory')?.checked !== false;
            const statutoryDeductions = applyStatutory ? this.calculateStatutoryDeductions(grossPay) : this.calculateStatutoryDeductions(0);
            const otherDeductions = this.parseMoney('hr-other-deductions');
            const currentAdvanceBalance = this.staffAdvanceBalance(staffKey);
            const advanceRepayment = Math.min(this.parseMoney('hr-advance-repayment'), currentAdvanceBalance);
            const advanceBalanceAfter = this.roundMoney(Math.max(0, currentAdvanceBalance - advanceRepayment));
            const deductions = this.roundMoney(otherDeductions + advanceRepayment + statutoryDeductions.total);
            const netPay = Math.max(0, grossPay - deductions);
            const period = document.getElementById('hr-pay-period').value || new Date().toISOString().slice(0, 7);
            const createdBy = PharmaFlow.Auth?.userProfile ? (PharmaFlow.Auth.userProfile.displayName || PharmaFlow.Auth.userProfile.email) : 'Unknown';
            const payrollRef = await getBusinessCollection(businessId, 'hr_payroll').add({
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
                otherDeductions,
                advanceRepayment,
                advanceBalanceBefore: currentAdvanceBalance,
                advanceBalanceAfter,
                applyStatutory,
                statutoryDeductions,
                grossPay,
                netPay,
                paymentMethod: document.getElementById('hr-pay-method').value,
                notes: document.getElementById('hr-pay-notes').value.trim(),
                status: 'generated',
                createdBy,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            if (advanceRepayment > 0) {
                await getBusinessCollection(businessId, 'hr_advances').add({
                    type: 'repayment',
                    staffKey,
                    staffId: staff.id,
                    staffKind: staff.hrKind,
                    staffType: staff.staffType,
                    staffName: this.staffLabel(staff),
                    amount: advanceRepayment,
                    payrollId: payrollRef.id,
                    period,
                    paymentMethod: document.getElementById('hr-pay-method').value,
                    reference: 'Payroll ' + period,
                    notes: 'Advance repayment deducted from payslip',
                    createdBy,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            this.showToast('Payslip generated.');
            hrLoaded = false;
            this.renderPayroll(document.getElementById('content-body'));
        },

        payrollRows(limit) {
            const rows = (limit ? hrPayroll.slice(0, 8) : hrPayroll);
            if (!rows.length) return '<tr><td colspan="' + (limit ? 4 : 8) + '" class="dda-loading"><i class="fas fa-inbox"></i> No payroll records yet</td></tr>';
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
            const statutory = p.statutoryDeductions || {};
            const statutoryRows = p.applyStatutory ? `
                <div class="row muted"><span>NSSF</span><strong>${this.formatCurrency(statutory.nssf || 0)}</strong></div>
                <div class="row muted"><span>SHIF</span><strong>${this.formatCurrency(statutory.shif || 0)}</strong></div>
                <div class="row muted"><span>Housing Levy</span><strong>${this.formatCurrency(statutory.housingLevy || 0)}</strong></div>
                <div class="row muted"><span>PAYE</span><strong>${this.formatCurrency(statutory.paye || 0)}</strong></div>` : '';
            const advanceRows = (p.advanceRepayment || p.advanceBalanceBefore || p.advanceBalanceAfter) ? `
                <div class="row muted"><span>Advance Balance Before</span><strong>${this.formatCurrency(p.advanceBalanceBefore || 0)}</strong></div>
                <div class="row muted"><span>Advance Repayment</span><strong>${this.formatCurrency(p.advanceRepayment || 0)}</strong></div>
                <div class="row muted"><span>Advance Balance After</span><strong>${this.formatCurrency(p.advanceBalanceAfter || 0)}</strong></div>` : '';
            const html = `<!doctype html><html><head><title>Payslip</title><style>body{font-family:Arial,sans-serif;max-width:720px;margin:30px auto;color:#111827}h1{font-size:22px;margin-bottom:4px}.meta{color:#64748b;margin-bottom:22px}.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #e5e7eb}.muted{color:#475569;font-size:13px}.total{font-weight:700;font-size:18px;border-top:2px solid #111827;margin-top:10px}</style></head><body><h1>${this.escapeHtml(business)} - Payslip</h1><div class="meta">Period: ${this.escapeHtml(p.period || '-')} | Staff: ${this.escapeHtml(p.staffName || '-')}</div><div class="row"><span>Job Title</span><strong>${this.escapeHtml(p.jobTitle || '-')}</strong></div><div class="row"><span>Basic Pay</span><strong>${this.formatCurrency(p.basicPay || 0)}</strong></div><div class="row"><span>Allowances</span><strong>${this.formatCurrency(p.allowances || 0)}</strong></div>${statutoryRows}${advanceRows}<div class="row muted"><span>Other Deductions</span><strong>${this.formatCurrency(p.otherDeductions || 0)}</strong></div><div class="row"><span>Total Deductions</span><strong>${this.formatCurrency(p.totalDeductions || 0)}</strong></div><div class="row total"><span>Net Pay</span><strong>${this.formatCurrency(p.netPay || 0)}</strong></div><p class="meta">Generated by ${this.escapeHtml(p.createdBy || '-')}</p></body></html>`;
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
            const advanceBalance = this.roundMoney(hrAdvances.reduce((s, entry) => s + this.advanceSignedAmount(entry), 0));
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
                <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-hand-holding-dollar"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${this.formatCurrency(advanceBalance)}</span><span class="dda-stat-label">Outstanding Advances</span></div></div>
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
