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
    let hrReportCharts = [];
    let hrLoaded = false;
    let hrLoadedBusinessId = null;
    const hrPayslipState = {
        search: '',
        staffType: '',
        period: '',
        page: 1,
        pageSize: 10
    };

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
            this.destroyReportCharts();
        },

        invalidateData() {
            hrLoaded = false;
            hrLoadedBusinessId = null;
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

        businessName() {
            if (PharmaFlow.Settings && PharmaFlow.Settings.getBusinessName) {
                return PharmaFlow.Settings.getBusinessName() || 'PharmaFlow';
            }
            try {
                const snap = PharmaFlow.BrandingSync && PharmaFlow.BrandingSync.getResolvedSnapshot
                    ? PharmaFlow.BrandingSync.getResolvedSnapshot(this.getBusinessId())
                    : null;
                return (snap && snap.name) || localStorage.getItem('pf_brand_name') || 'PharmaFlow';
            } catch (e) {
                return 'PharmaFlow';
            }
        },

        staffCodePrefix() {
            const name = this.businessName();
            const letters = String(name || '')
                .toUpperCase()
                .replace(/[^A-Z]/g, '');
            const fallback = String(name || '')
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '');
            return (letters + fallback + 'PHA').slice(0, 3);
        },

        staffCode(staff) {
            if (staff.staffCode) return staff.staffCode;
            const source = String(staff.id || staff.email || this.staffLabel(staff));
            let hash = 0;
            for (let i = 0; i < source.length; i++) {
                hash = ((hash << 5) - hash) + source.charCodeAt(i);
                hash |= 0;
            }
            const number = String((Math.abs(hash) % 990) + 10).padStart(3, '0');
            return this.staffCodePrefix() + '/' + number;
        },

        staffCodeFromKey(staffKey) {
            const staff = this.allStaff().find(s => this.staffId(s) === staffKey);
            return staff ? this.staffCode(staff) : '';
        },

        payrollBalancePayable(payroll) {
            return this.roundMoney(payroll.cashBalancePayable ?? payroll.netPay ?? 0);
        },

        payrollTotalPaidForMonth(payroll) {
            const total = payroll.totalMonthPay || payroll.grossPay || 0;
            const balance = this.payrollBalancePayable(payroll);
            return payroll.paymentConfirmed || payroll.status === 'paid'
                ? this.roundMoney(total)
                : this.roundMoney(Math.max(0, total - balance));
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
            const businessId = this.getBusinessId();
            if (!businessId) throw new Error('NO_BUSINESS_SELECTED');
            if (hrLoaded && hrLoadedBusinessId === businessId) return;

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
            hrLoadedBusinessId = businessId;
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
                const balancePayable = monthPayroll.reduce((s, p) => s + this.payrollBalancePayable(p), 0);
                const totalPaidThisMonth = monthPayroll.reduce((s, p) => s + this.payrollTotalPaidForMonth(p), 0);
                const advanceBalance = this.roundMoney(hrAdvances.reduce((s, entry) => s + this.advanceSignedAmount(entry), 0));
                const body = `
                <div class="dda-stats hr-stats">
                    <div class="dda-stat-card"><div class="dda-stat-icon"><i class="fas fa-users"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${staff.length}</span><span class="dda-stat-label">Total Staff</span></div></div>
                    <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-id-badge"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${hrUsers.length}</span><span class="dda-stat-label">System Staff</span></div></div>
                    <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-person-digging"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${hrCasualStaff.length}</span><span class="dda-stat-label">Casual Staff</span></div></div>
                    <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--revenue"><i class="fas fa-money-check-dollar"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${this.formatCurrency(balancePayable)}</span><span class="dda-stat-label">Balance Payable This Month</span></div></div>
                    <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-circle-check"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${this.formatCurrency(totalPaidThisMonth)}</span><span class="dda-stat-label">Total Paid This Month</span></div></div>
                    <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-hand-holding-dollar"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${this.formatCurrency(advanceBalance)}</span><span class="dda-stat-label">Advance Balances</span></div></div>
                </div>
                <div class="rpt-grid-2">
                    <div class="card">
                        <div class="rpt-section-header"><h3><i class="fas fa-wallet"></i> Current Payroll Position</h3></div>
                        <div class="rpt-pnl">
                            <div class="rpt-pnl-row"><span>Gross Pay</span><span>${this.formatCurrency(gross)}</span></div>
                            <div class="rpt-pnl-row"><span>Deductions</span><span>${this.formatCurrency(deductions)}</span></div>
                            <div class="rpt-pnl-row"><span>Balance Payable</span><span>${this.formatCurrency(balancePayable)}</span></div>
                            <div class="rpt-pnl-row rpt-pnl-total"><span>Total Paid This Month</span><span>${this.formatCurrency(totalPaidThisMonth)}</span></div>
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
                        <button class="hr-advance-btn" data-hr-action="advance-payment"><i class="fas fa-hand-holding-dollar"></i> Add Advance Payment</button>
                        <button class="dda-btn dda-btn--primary" id="hr-add-casual"><i class="fas fa-user-plus"></i> Add Casual Staff</button>
                    </div>
                </div>
                <div class="dda-table-wrap">
                    <table class="dda-table">
                        <thead><tr><th>#</th><th>Staff ID</th><th>Name</th><th>Type</th><th>Role / Job</th><th>Phone</th><th>Base Pay</th><th>Advance Balance</th><th>Status</th><th>Actions</th></tr></thead>
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
            if (!staff.length) return '<tr><td colspan="10" class="dda-loading"><i class="fas fa-inbox"></i> No staff found</td></tr>';
            return staff.map((s, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td><span class="hr-staff-code">${this.escapeHtml(this.staffCode(s))}</span></td>
                    <td><strong>${this.escapeHtml(this.staffLabel(s))}</strong><small>${this.escapeHtml(s.email || '')}</small></td>
                    <td><span class="ord-status-badge ${s.hrKind === 'system' ? 'ord-status--approved' : 'ord-status--pending'}">${s.staffType}</span></td>
                    <td>${this.escapeHtml(s.hrRole || s.jobTitle || s.role || '-')}</td>
                    <td>${this.escapeHtml(s.phone || '-')}</td>
                    <td>${s.basePay ? this.formatCurrency(s.basePay) : '-'}</td>
                    <td><strong>${this.formatCurrency(this.staffAdvanceBalance(this.staffId(s)))}</strong></td>
                    <td>${s.isActive === false || s.status === 'disabled' ? '<span class="ord-status-badge ord-status--cancelled">Inactive</span>' : '<span class="ord-status-badge ord-status--approved">Active</span>'}</td>
                    <td class="hr-actions-cell">
                        <button type="button" class="hr-row-action hr-row-action--advance" data-hr-action="advance-payment" data-staff-key="${this.escapeHtml(this.staffId(s))}" title="Add advance payment" aria-label="Add advance payment"><i class="fas fa-hand-holding-dollar"></i></button>
                        ${s.hrKind === 'casual' ? '<button type="button" class="hr-row-action hr-row-action--edit hr-edit-casual" data-hr-action="edit-casual" data-id="' + this.escapeHtml(s.id) + '" title="Edit casual staff" aria-label="Edit casual staff"><i class="fas fa-pen"></i></button>' : '<button type="button" class="hr-row-action hr-row-action--settings hr-edit-system" data-hr-action="edit-system" data-id="' + this.escapeHtml(s.id) + '" title="HR settings" aria-label="Open HR settings"><i class="fas fa-gear"></i></button>'}
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
                    this.invalidateData();
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
                    this.invalidateData();
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
                    this.invalidateData();
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
                staffCode: this.staffCode(staff),
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
                    <div class="rpt-section-header">
                        <h3><i class="fas fa-money-check-dollar"></i> Generate Payroll / Payslip</h3>
                        <button type="button" class="hr-advance-btn" data-hr-action="advance-payment"><i class="fas fa-hand-holding-dollar"></i> Add Advance Payment</button>
                    </div>
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
                    <div class="dda-table-wrap"><table class="dda-table"><thead><tr><th>Period</th><th>Staff</th><th>Balance Payable</th><th>Status</th></tr></thead><tbody>${this.payrollRows(true)}</tbody></table></div>
                </div>
            </div>`;
            container.innerHTML = this.pageShell('Payroll Automation', 'fas fa-money-check-dollar', 'Payroll', body);
            this.bindDashboardLink(container);
            this.bindStaffActions(container);
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
            const cashBalancePayable = this.roundMoney(Math.max(0, grossPay - deductions));
            const netPay = Math.max(0, grossPay - deductions);
            const period = document.getElementById('hr-pay-period').value || new Date().toISOString().slice(0, 7);
            const createdBy = PharmaFlow.Auth?.userProfile ? (PharmaFlow.Auth.userProfile.displayName || PharmaFlow.Auth.userProfile.email) : 'Unknown';
            const payrollRef = await getBusinessCollection(businessId, 'hr_payroll').add({
                staffKey,
                staffId: staff.id,
                staffCode: this.staffCode(staff),
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
                advanceAsPaid: advanceRepayment,
                advanceBalanceBefore: currentAdvanceBalance,
                advanceBalanceAfter,
                applyStatutory,
                statutoryDeductions,
                grossPay,
                netPay,
                cashBalancePayable,
                totalMonthPay: grossPay,
                paymentConfirmed: false,
                advanceSettled: false,
                paymentMethod: document.getElementById('hr-pay-method').value,
                notes: document.getElementById('hr-pay-notes').value.trim(),
                status: 'pending-payment',
                createdBy,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            this.showToast('Payslip generated. Confirm payment after paying the balance.');
            this.invalidateData();
            this.renderPayroll(document.getElementById('content-body'));
        },

        payrollRows(limit) {
            const rows = (limit ? hrPayroll.slice(0, 8) : hrPayroll);
            if (!rows.length) return '<tr><td colspan="' + (limit ? 4 : 8) + '" class="dda-loading"><i class="fas fa-inbox"></i> No payroll records yet</td></tr>';
            return rows.map((p, i) => limit
                ? `<tr><td>${this.escapeHtml(p.period || '-')}</td><td>${this.escapeHtml(p.staffName || '-')}</td><td>${this.formatCurrency(p.cashBalancePayable ?? p.netPay ?? 0)}</td><td><span class="ord-status-badge ${p.paymentConfirmed || p.status === 'paid' ? 'ord-status--approved' : 'ord-status--pending'}">${this.escapeHtml(p.paymentConfirmed || p.status === 'paid' ? 'paid' : (p.status || 'pending-payment'))}</span></td></tr>`
                : `<tr><td>${i + 1}</td><td>${this.escapeHtml(p.period || '-')}</td><td><strong>${this.escapeHtml(p.staffName || '-')}</strong><small>${this.escapeHtml(p.jobTitle || '')}</small></td><td>${this.escapeHtml(p.staffType || '-')}</td><td>${this.formatCurrency(p.grossPay || 0)}</td><td>${this.formatCurrency(p.advanceAsPaid ?? p.advanceRepayment ?? 0)}</td><td><strong>${this.formatCurrency(this.payrollBalancePayable(p))}</strong></td><td><button type="button" class="hr-row-action hr-row-action--print hr-print-slip" data-id="${this.escapeHtml(p.id)}" title="Print Payslip" aria-label="Print payslip"><i class="fas fa-print"></i></button></td></tr>`
            ).join('');
        },

        filteredPayslips() {
            const query = String(hrPayslipState.search || '').trim().toLowerCase();
            return hrPayroll.filter(p => {
                const code = p.staffCode || this.staffCodeFromKey(p.staffKey) || '';
                const haystack = [
                    p.staffName,
                    p.jobTitle,
                    p.hrRole,
                    p.staffType,
                    p.period,
                    p.status,
                    code
                ].join(' ').toLowerCase();
                if (query && haystack.indexOf(query) === -1) return false;
                if (hrPayslipState.staffType && p.staffType !== hrPayslipState.staffType) return false;
                if (hrPayslipState.period && p.period !== hrPayslipState.period) return false;
                return true;
            });
        },

        payslipRows(rows, startIndex) {
            if (!rows.length) return '<tr><td colspan="10" class="dda-loading"><i class="fas fa-inbox"></i> No payslips match your filters</td></tr>';
            return rows.map((p, i) => {
                const staffCode = p.staffCode || this.staffCodeFromKey(p.staffKey) || '-';
                const paid = p.paymentConfirmed || p.status === 'paid';
                return `<tr>
                    <td>${startIndex + i + 1}</td>
                    <td><span class="hr-staff-code">${this.escapeHtml(staffCode)}</span></td>
                    <td>${this.escapeHtml(p.period || '-')}</td>
                    <td><strong>${this.escapeHtml(p.staffName || '-')}</strong><small>${this.escapeHtml(p.jobTitle || '')}</small></td>
                    <td>${this.escapeHtml(p.staffType || '-')}</td>
                    <td>${this.formatCurrency(p.grossPay || 0)}</td>
                    <td>${this.formatCurrency(p.advanceAsPaid ?? p.advanceRepayment ?? 0)}</td>
                    <td><strong>${this.formatCurrency(p.cashBalancePayable ?? p.netPay ?? 0)}</strong></td>
                    <td><span class="ord-status-badge ${paid ? 'ord-status--approved' : 'ord-status--pending'}">${paid ? 'Paid' : 'Pending'}</span></td>
                    <td class="hr-actions-cell">
                        <button type="button" class="hr-row-action hr-row-action--print hr-print-slip" data-id="${this.escapeHtml(p.id)}" title="Print Payslip" aria-label="Print payslip"><i class="fas fa-print"></i></button>
                        <button type="button" class="hr-row-action hr-row-action--history hr-payment-history" data-id="${this.escapeHtml(p.id)}" title="Payment history" aria-label="Payment history"><i class="fas fa-clock-rotate-left"></i></button>
                        ${paid ? '' : '<button type="button" class="hr-row-action hr-row-action--confirm hr-confirm-payroll" data-id="' + this.escapeHtml(p.id) + '" title="Confirm payment" aria-label="Confirm payment"><i class="fas fa-check"></i></button>'}
                    </td>
                </tr>`;
            }).join('');
        },

        formatDateTime(value) {
            if (!value) return '-';
            const date = value && value.toDate ? value.toDate() : new Date(value);
            if (Number.isNaN(date.getTime())) return '-';
            return date.toLocaleString();
        },

        paymentHistoryCards(payroll) {
            const related = hrPayroll
                .filter(p => p.staffKey === payroll.staffKey)
                .sort((a, b) => {
                    const ad = a.paymentConfirmedAt && a.paymentConfirmedAt.toDate ? a.paymentConfirmedAt.toDate() : new Date(a.paymentConfirmedAt || a.createdAt || 0);
                    const bd = b.paymentConfirmedAt && b.paymentConfirmedAt.toDate ? b.paymentConfirmedAt.toDate() : new Date(b.paymentConfirmedAt || b.createdAt || 0);
                    return bd.getTime() - ad.getTime();
                });
            if (!related.length) return '<div class="hr-history-empty"><i class="fas fa-inbox"></i><span>No payment history found</span></div>';
            return related.map(p => {
                const paid = p.paymentConfirmed || p.status === 'paid';
                const amount = paid ? (p.paidAmountTotal || p.totalMonthPay || p.grossPay || 0) : this.payrollTotalPaidForMonth(p);
                const balance = this.payrollBalancePayable(p);
                const executor = p.paymentConfirmedBy || p.createdBy || '-';
                const when = p.paymentConfirmedAt || p.createdAt;
                return `<article class="hr-history-card">
                    <div class="hr-history-card-head">
                        <div>
                            <span class="hr-history-period">${this.escapeHtml(p.period || '-')}</span>
                            <h4>${this.escapeHtml(p.staffName || '-')}</h4>
                            <p>${this.escapeHtml(this.formatDateTime(when))}</p>
                        </div>
                        <span class="ord-status-badge ${paid ? 'ord-status--approved' : 'ord-status--pending'}">${paid ? 'Paid' : 'Pending'}</span>
                    </div>
                    <div class="hr-history-metrics">
                        <div><span>Total Pay</span><strong>${this.formatCurrency(p.totalMonthPay || p.grossPay || 0)}</strong></div>
                        <div><span>Advance Paid</span><strong>${this.formatCurrency(p.advanceAsPaid ?? p.advanceRepayment ?? 0)}</strong></div>
                        <div><span>${paid ? 'Paid Amount' : 'Balance Due'}</span><strong>${this.formatCurrency(paid ? amount : balance)}</strong></div>
                    </div>
                    <div class="hr-history-card-foot">
                        <div class="hr-history-executor"><i class="fas fa-user-check"></i><span>${this.escapeHtml(executor)}</span></div>
                        <button type="button" class="hr-history-print-btn hr-history-print" data-id="${this.escapeHtml(p.id)}"><i class="fas fa-print"></i><span>Print Payslip</span></button>
                    </div>
                </article>`;
            }).join('');
        },

        openPaymentHistoryModal(id) {
            const payroll = hrPayroll.find(p => p.id === id);
            if (!payroll) return;
            const staffCode = payroll.staffCode || this.staffCodeFromKey(payroll.staffKey) || '-';
            const related = hrPayroll.filter(p => p.staffKey === payroll.staffKey);
            const paidCount = related.filter(p => p.paymentConfirmed || p.status === 'paid').length;
            const totalPaid = related.reduce((sum, p) => sum + this.payrollTotalPaidForMonth(p), 0);
            const pendingBalance = related.reduce((sum, p) => sum + this.payrollBalancePayable(p), 0);
            const modal = document.createElement('div');
            modal.className = 'hr-modal-overlay active';
            modal.innerHTML = `
            <div class="hr-modal hr-history-modal" role="dialog" aria-modal="true" aria-labelledby="hr-history-title">
                <div class="hr-modal-header">
                    <h3 id="hr-history-title"><i class="fas fa-clock-rotate-left"></i> Payment History</h3>
                    <button type="button" class="hr-modal-close" aria-label="Close">&times;</button>
                </div>
                <div class="hr-modal-body">
                    <section class="hr-history-profile">
                        <div class="hr-history-avatar"><i class="fas fa-user-check"></i></div>
                        <div class="hr-history-profile-main">
                            <h4>${this.escapeHtml(payroll.staffName || 'Staff')}</h4>
                            <p>${this.escapeHtml(payroll.jobTitle || payroll.hrRole || payroll.staffType || '-')}</p>
                        </div>
                        <span class="hr-staff-code">${this.escapeHtml(staffCode)}</span>
                    </section>
                    <section class="hr-history-summary-grid">
                        <div><span>Records</span><strong>${related.length}</strong></div>
                        <div><span>Fully Paid</span><strong>${paidCount}</strong></div>
                        <div><span>Total Paid</span><strong>${this.formatCurrency(totalPaid)}</strong></div>
                        <div><span>Balance Due</span><strong>${this.formatCurrency(pendingBalance)}</strong></div>
                    </section>
                    <div class="hr-history-list">
                        ${this.paymentHistoryCards(payroll)}
                    </div>
                </div>
                <div class="hr-modal-footer"><button type="button" class="dda-btn dda-btn--cancel hr-modal-cancel">Close</button></div>
            </div>`;
            document.body.appendChild(modal);
            const close = () => modal.remove();
            modal.querySelector('.hr-modal-close').addEventListener('click', close);
            modal.querySelector('.hr-modal-cancel').addEventListener('click', close);
            modal.addEventListener('click', e => { if (e.target === modal) close(); });
            modal.querySelectorAll('.hr-history-print').forEach(btn => btn.addEventListener('click', () => this.printPayslip(btn.dataset.id)));
        },

        async confirmPayrollPayment(id) {
            const payroll = hrPayroll.find(p => p.id === id);
            if (!payroll) return;
            if (payroll.paymentConfirmed || payroll.status === 'paid') {
                this.showToast('This payroll is already marked as paid.');
                return;
            }
            const balance = payroll.cashBalancePayable ?? payroll.netPay ?? 0;

            const businessId = this.getBusinessId();
            const createdBy = PharmaFlow.Auth?.userProfile ? (PharmaFlow.Auth.userProfile.displayName || PharmaFlow.Auth.userProfile.email) : 'Unknown';
            if ((payroll.advanceRepayment || payroll.advanceAsPaid || 0) > 0 && !payroll.advanceSettled) {
                await getBusinessCollection(businessId, 'hr_advances').add({
                    type: 'repayment',
                    staffKey: payroll.staffKey,
                    staffId: payroll.staffId,
                    staffCode: payroll.staffCode || this.staffCodeFromKey(payroll.staffKey),
                    staffKind: payroll.staffKind,
                    staffType: payroll.staffType,
                    staffName: payroll.staffName,
                    amount: payroll.advanceRepayment || payroll.advanceAsPaid || 0,
                    payrollId: payroll.id,
                    period: payroll.period,
                    paymentMethod: payroll.paymentMethod || 'cash',
                    reference: 'Payroll ' + (payroll.period || ''),
                    notes: 'Advance settled after month-end balance payment confirmation',
                    createdBy,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            await getBusinessCollection(businessId, 'hr_payroll').doc(id).set({
                status: 'paid',
                paymentConfirmed: true,
                advanceSettled: true,
                totalMonthPay: payroll.totalMonthPay || payroll.grossPay || 0,
                cashBalancePaid: balance,
                paidAmountTotal: payroll.grossPay || payroll.totalMonthPay || 0,
                paymentConfirmedBy: createdBy,
                paymentConfirmedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            this.showToast('Payroll marked as fully paid.');
            this.invalidateData();
            await this.ensureData();
            this.renderPayslipTable();
        },

        openConfirmPayrollModal(id) {
            const payroll = hrPayroll.find(p => p.id === id);
            if (!payroll) return;
            const balance = payroll.cashBalancePayable ?? payroll.netPay ?? 0;
            const modal = document.createElement('div');
            modal.className = 'hr-modal-overlay active';
            modal.innerHTML = `
            <div class="hr-modal hr-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="hr-confirm-pay-title">
                <div class="hr-modal-header">
                    <h3 id="hr-confirm-pay-title"><i class="fas fa-circle-check"></i> Confirm Payroll Payment</h3>
                    <button type="button" class="hr-modal-close" aria-label="Close">&times;</button>
                </div>
                <div class="hr-modal-body">
                    <div class="hr-confirm-summary">
                        <div class="hr-confirm-icon"><i class="fas fa-money-check-dollar"></i></div>
                        <div>
                            <strong>${this.escapeHtml(payroll.staffName || 'Staff')}</strong>
                            <span>${this.escapeHtml(payroll.period || '-')} payroll balance</span>
                        </div>
                    </div>
                    <div class="hr-statutory-panel">
                        <div class="hr-statutory-row"><span>Total monthly pay</span><strong>${this.formatCurrency(payroll.totalMonthPay || payroll.grossPay || 0)}</strong></div>
                        <div class="hr-statutory-row"><span>Advance already paid</span><strong>${this.formatCurrency(payroll.advanceAsPaid ?? payroll.advanceRepayment ?? 0)}</strong></div>
                        <div class="hr-statutory-row hr-statutory-row--total"><span>Balance to confirm</span><strong>${this.formatCurrency(balance)}</strong></div>
                    </div>
                </div>
                <div class="hr-modal-footer">
                    <button type="button" class="dda-btn dda-btn--cancel hr-modal-cancel">Cancel</button>
                    <button type="button" class="hr-confirm-pay-btn" id="hr-confirm-pay-now"><i class="fas fa-check"></i> Confirm Paid</button>
                </div>
            </div>`;
            document.body.appendChild(modal);
            const close = () => modal.remove();
            modal.querySelector('.hr-modal-close').addEventListener('click', close);
            modal.querySelector('.hr-modal-cancel').addEventListener('click', close);
            modal.addEventListener('click', e => { if (e.target === modal) close(); });
            modal.querySelector('#hr-confirm-pay-now').addEventListener('click', async () => {
                const btn = modal.querySelector('#hr-confirm-pay-now');
                if (btn.disabled) return;
                btn.disabled = true;
                try {
                    await this.confirmPayrollPayment(id);
                    close();
                } catch (err) {
                    console.error('HR payroll confirmation failed:', err);
                    this.showToast('Could not confirm payroll payment.', 'error');
                    btn.disabled = false;
                }
            });
        },

        renderPayslipTable() {
            const filtered = this.filteredPayslips();
            const totalPages = Math.max(1, Math.ceil(filtered.length / hrPayslipState.pageSize));
            hrPayslipState.page = Math.min(Math.max(1, hrPayslipState.page), totalPages);
            const start = (hrPayslipState.page - 1) * hrPayslipState.pageSize;
            const pageRows = filtered.slice(start, start + hrPayslipState.pageSize);
            const body = document.getElementById('hr-payslip-body');
            const summary = document.getElementById('hr-payslip-summary');
            const pagination = document.getElementById('hr-payslip-pagination');
            if (body) body.innerHTML = this.payslipRows(pageRows, start);
            if (summary) {
                const end = filtered.length ? Math.min(start + pageRows.length, filtered.length) : 0;
                summary.textContent = 'Showing ' + (filtered.length ? start + 1 : 0) + '-' + end + ' of ' + filtered.length + ' payslips';
            }
            if (pagination) pagination.innerHTML = this.payslipPaginationHtml(totalPages);
            if (body) {
                body.querySelectorAll('.hr-print-slip').forEach(btn => btn.addEventListener('click', () => this.printPayslip(btn.dataset.id)));
                body.querySelectorAll('.hr-payment-history').forEach(btn => btn.addEventListener('click', () => this.openPaymentHistoryModal(btn.dataset.id)));
                body.querySelectorAll('.hr-confirm-payroll').forEach(btn => btn.addEventListener('click', () => this.openConfirmPayrollModal(btn.dataset.id)));
            }
        },

        payslipPaginationHtml(totalPages) {
            return `
                <button type="button" class="hr-page-btn" data-page="prev" ${hrPayslipState.page <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
                <span class="hr-page-info">Page ${hrPayslipState.page} of ${totalPages}</span>
                <button type="button" class="hr-page-btn" data-page="next" ${hrPayslipState.page >= totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
        },

        payslipExportRows() {
            return this.filteredPayslips().map(p => ({
                staffCode: p.staffCode || this.staffCodeFromKey(p.staffKey) || '-',
                period: p.period || '-',
                staffName: p.staffName || '-',
                staffType: p.staffType || '-',
                jobTitle: p.jobTitle || p.hrRole || '-',
                grossPay: p.grossPay || 0,
                totalMonthPay: p.totalMonthPay || p.grossPay || 0,
                statutory: p.statutoryDeductions ? (p.statutoryDeductions.total || 0) : 0,
                advancePaid: p.advanceAsPaid ?? p.advanceRepayment ?? 0,
                balancePayable: p.cashBalancePayable ?? p.netPay ?? 0,
                otherDeductions: p.otherDeductions || 0,
                totalDeductions: p.totalDeductions || 0,
                netPay: p.netPay || 0,
                status: p.paymentConfirmed || p.status === 'paid' ? 'paid' : (p.status || 'pending-payment')
            }));
        },

        csvCell(value) {
            const text = String(value == null ? '' : value);
            return '"' + text.replace(/"/g, '""') + '"';
        },

        exportPayslipsCsv() {
            const rows = this.payslipExportRows();
            if (!rows.length) { this.showToast('No payslips to export.', 'error'); return; }
            const headers = ['Staff ID', 'Period', 'Staff', 'Type', 'Job Title', 'Total Pay', 'Advance Paid', 'Balance Payable', 'Statutory', 'Other Deductions', 'Total Deductions', 'Status'];
            const csvRows = rows.map(r => [
                r.staffCode,
                r.period,
                r.staffName,
                r.staffType,
                r.jobTitle,
                r.totalMonthPay,
                r.advancePaid,
                r.balancePayable,
                r.statutory,
                r.otherDeductions,
                r.totalDeductions,
                r.status
            ].map(v => this.csvCell(v)).join(','));
            const csv = [headers.map(h => this.csvCell(h)).join(',')].concat(csvRows).join('\r\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'hr-payslips-' + new Date().toISOString().slice(0, 10) + '.csv';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            this.showToast('Payslips CSV exported.');
        },

        exportPayslipsPdf() {
            const rows = this.payslipExportRows();
            if (!rows.length) { this.showToast('No payslips to export.', 'error'); return; }
            if (!window.jspdf || !window.jspdf.jsPDF) {
                this.showToast('PDF export is not available. Please refresh the page.', 'error');
                return;
            }
            try {
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF('l', 'mm', 'a4');
                const title = (this.businessName() || 'PharmaFlow') + ' - Payslips';
                doc.setFontSize(14);
                doc.text(title, 14, 14);
                doc.setFontSize(9);
                doc.text('Exported: ' + new Date().toLocaleString(), 14, 21);
                const body = rows.map(r => [
                    r.staffCode,
                    r.period,
                    r.staffName,
                    r.staffType,
                    r.jobTitle,
                    this.formatCurrency(r.totalMonthPay),
                    this.formatCurrency(r.advancePaid),
                    this.formatCurrency(r.balancePayable),
                    r.status
                ]);
                doc.autoTable({
                    head: [['Staff ID', 'Period', 'Staff', 'Type', 'Job Title', 'Total Pay', 'Advance Paid', 'Balance Payable', 'Status']],
                    body,
                    startY: 28,
                    styles: { fontSize: 8, cellPadding: 2 },
                    headStyles: { fillColor: [22, 163, 74] },
                    columnStyles: {
                        2: { cellWidth: 42 },
                        4: { cellWidth: 38 }
                    }
                });
                doc.save('hr-payslips-' + new Date().toISOString().slice(0, 10) + '.pdf');
                this.showToast('Payslips PDF exported.');
            } catch (err) {
                console.error('HR payslip PDF export failed:', err);
                this.showToast('Failed to export PDF.', 'error');
            }
        },

        bindPayslipControls(container) {
            const search = container.querySelector('#hr-payslip-search');
            const type = container.querySelector('#hr-payslip-type');
            const period = container.querySelector('#hr-payslip-period');
            const size = container.querySelector('#hr-payslip-size');
            const reset = container.querySelector('#hr-payslip-reset');
            const csvBtn = container.querySelector('#hr-payslip-export-csv');
            const pdfBtn = container.querySelector('#hr-payslip-export-pdf');
            const pagination = container.querySelector('#hr-payslip-pagination');
            const update = () => {
                hrPayslipState.search = search ? search.value : '';
                hrPayslipState.staffType = type ? type.value : '';
                hrPayslipState.period = period ? period.value : '';
                hrPayslipState.pageSize = parseInt(size ? size.value : '10', 10) || 10;
                hrPayslipState.page = 1;
                this.renderPayslipTable();
            };
            search?.addEventListener('input', update);
            type?.addEventListener('change', update);
            period?.addEventListener('change', update);
            size?.addEventListener('change', update);
            reset?.addEventListener('click', () => {
                hrPayslipState.search = '';
                hrPayslipState.staffType = '';
                hrPayslipState.period = '';
                hrPayslipState.page = 1;
                hrPayslipState.pageSize = 10;
                if (search) search.value = '';
                if (type) type.value = '';
                if (period) period.value = '';
                if (size) size.value = '10';
                this.renderPayslipTable();
            });
            csvBtn?.addEventListener('click', () => this.exportPayslipsCsv());
            pdfBtn?.addEventListener('click', () => this.exportPayslipsPdf());
            pagination?.addEventListener('click', e => {
                const btn = e.target.closest('[data-page]');
                if (!btn || btn.disabled) return;
                if (btn.dataset.page === 'prev') hrPayslipState.page -= 1;
                if (btn.dataset.page === 'next') hrPayslipState.page += 1;
                this.renderPayslipTable();
            });
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
            const periods = Array.from(new Set(hrPayroll.map(p => p.period).filter(Boolean))).sort((a, b) => b.localeCompare(a));
            const periodOptions = periods.map(period => '<option value="' + this.escapeHtml(period) + '"' + (hrPayslipState.period === period ? ' selected' : '') + '>' + this.escapeHtml(period) + '</option>').join('');
            const body = `
            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-file-invoice-dollar"></i> Payslips</h3></div>
                <div class="hr-payslip-toolbar">
                    <div class="hr-search-box">
                        <i class="fas fa-search"></i>
                        <input id="hr-payslip-search" type="search" placeholder="Search staff, ID, role, period..." value="${this.escapeHtml(hrPayslipState.search)}">
                    </div>
                    <select id="hr-payslip-type">
                        <option value="">All Types</option>
                        <option value="System" ${hrPayslipState.staffType === 'System' ? 'selected' : ''}>System Staff</option>
                        <option value="Casual" ${hrPayslipState.staffType === 'Casual' ? 'selected' : ''}>Casual Staff</option>
                    </select>
                    <select id="hr-payslip-period">
                        <option value="">All Periods</option>
                        ${periodOptions}
                    </select>
                    <select id="hr-payslip-size">
                        <option value="10" ${hrPayslipState.pageSize === 10 ? 'selected' : ''}>10 rows</option>
                        <option value="25" ${hrPayslipState.pageSize === 25 ? 'selected' : ''}>25 rows</option>
                        <option value="50" ${hrPayslipState.pageSize === 50 ? 'selected' : ''}>50 rows</option>
                    </select>
                    <button type="button" class="hr-export-btn hr-export-btn--csv" id="hr-payslip-export-csv"><i class="fas fa-file-csv"></i> CSV</button>
                    <button type="button" class="hr-export-btn hr-export-btn--pdf" id="hr-payslip-export-pdf"><i class="fas fa-file-pdf"></i> PDF</button>
                    <button type="button" class="hr-filter-reset" id="hr-payslip-reset"><i class="fas fa-rotate-left"></i> Reset</button>
                </div>
                <div class="dda-table-wrap"><table class="dda-table"><thead><tr><th>#</th><th>Staff ID</th><th>Period</th><th>Staff</th><th>Type</th><th>Total Pay</th><th>Advance Paid</th><th>Balance Payable</th><th>Status</th><th>Actions</th></tr></thead><tbody id="hr-payslip-body"></tbody></table></div>
                <div class="hr-table-meta hr-table-meta--bottom">
                    <span id="hr-payslip-summary"></span>
                    <div class="hr-pagination" id="hr-payslip-pagination"></div>
                </div>
            </div>`;
            container.innerHTML = this.pageShell('Payslips', 'fas fa-file-invoice-dollar', 'Payslips', body);
            this.bindDashboardLink(container);
            this.bindPayslipControls(container);
            this.renderPayslipTable();
        },

        printPayslip(id) {
            const p = hrPayroll.find(x => x.id === id);
            if (!p) return;
            const business = PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow';
            const businessPhone = PharmaFlow.Settings && PharmaFlow.Settings.getBusinessPhone ? PharmaFlow.Settings.getBusinessPhone() : '';
            const businessAddress = PharmaFlow.Settings && PharmaFlow.Settings.getBusinessAddress ? PharmaFlow.Settings.getBusinessAddress() : '';
            const statutory = p.statutoryDeductions || {};
            const statutoryRows = p.applyStatutory ? `
                <div class="slip-row"><span>NSSF</span><strong>${this.formatCurrency(statutory.nssf || 0)}</strong></div>
                <div class="slip-row"><span>SHIF</span><strong>${this.formatCurrency(statutory.shif || 0)}</strong></div>
                <div class="slip-row"><span>Housing Levy</span><strong>${this.formatCurrency(statutory.housingLevy || 0)}</strong></div>
                <div class="slip-row"><span>PAYE</span><strong>${this.formatCurrency(statutory.paye || 0)}</strong></div>` : '';
            const advanceRows = (p.advanceRepayment || p.advanceBalanceBefore || p.advanceBalanceAfter) ? `
                <div class="slip-row"><span>Advance Bal. Before</span><strong>${this.formatCurrency(p.advanceBalanceBefore || 0)}</strong></div>
                <div class="slip-row"><span>Advance Already Paid</span><strong>${this.formatCurrency(p.advanceAsPaid ?? p.advanceRepayment ?? 0)}</strong></div>
                <div class="slip-row"><span>Advance Bal. After</span><strong>${this.formatCurrency(p.advanceBalanceAfter || 0)}</strong></div>` : '';
            const staffCode = p.staffCode || this.staffCodeFromKey(p.staffKey) || '-';
            const generatedAt = new Date().toLocaleString();
            const paid = p.paymentConfirmed || p.status === 'paid';
            const balancePayable = p.cashBalancePayable ?? p.netPay ?? 0;
            const html = `<!doctype html><html><head><title>Payslip - ${this.escapeHtml(p.staffName || '')}</title><style>
                @page{size:80mm auto;margin:4mm}
                *{box-sizing:border-box}
                body{margin:0;background:#f3f4f6;color:#111827;font-family:"Courier New",monospace;font-size:12px;line-height:1.35}
                .slip{width:80mm;max-width:100%;margin:12px auto;padding:12px;background:#fff}
                .center{text-align:center}.brand{font-family:Arial,sans-serif;font-size:17px;font-weight:800;letter-spacing:0;text-transform:uppercase}.sub{font-size:10px;color:#374151;margin-top:2px}.title{margin:10px 0 6px;padding:6px 0;border-top:1px dashed #111827;border-bottom:1px dashed #111827;font-weight:800;text-align:center}
                .section{margin-top:8px}.section-title{margin:8px 0 4px;font-weight:800;text-transform:uppercase;border-bottom:1px solid #111827;padding-bottom:3px}
                .slip-row{display:flex;justify-content:space-between;gap:8px;padding:2px 0}.slip-row span{color:#374151}.slip-row strong{text-align:right;font-weight:800}.muted{color:#6b7280}.divider{border-top:1px dashed #111827;margin:8px 0}.net{margin-top:8px;padding:8px 0;border-top:2px solid #111827;border-bottom:2px solid #111827;font-size:15px;font-weight:900}.foot{margin-top:10px;text-align:center;font-size:10px;color:#374151}
                .no-print{display:flex;gap:8px;justify-content:center;margin:12px auto}.no-print button{border:0;border-radius:6px;padding:8px 12px;background:#111827;color:#fff;font-weight:700;cursor:pointer}
                @media print{body{background:#fff}.slip{margin:0;padding:0;width:72mm}.no-print{display:none}}
            </style></head><body>
                <div class="slip">
                    <div class="center">
                        <div class="brand">${this.escapeHtml(business)}</div>
                        ${businessAddress ? '<div class="sub">' + this.escapeHtml(businessAddress) + '</div>' : ''}
                        ${businessPhone ? '<div class="sub">Tel: ' + this.escapeHtml(businessPhone) + '</div>' : ''}
                    </div>
                    <div class="title">STAFF PAYSLIP</div>
                    <div class="section">
                        <div class="slip-row"><span>Period</span><strong>${this.escapeHtml(p.period || '-')}</strong></div>
                        <div class="slip-row"><span>Staff ID</span><strong>${this.escapeHtml(staffCode)}</strong></div>
                        <div class="slip-row"><span>Name</span><strong>${this.escapeHtml(p.staffName || '-')}</strong></div>
                        <div class="slip-row"><span>Role</span><strong>${this.escapeHtml(p.jobTitle || p.hrRole || '-')}</strong></div>
                        <div class="slip-row"><span>Status</span><strong>${paid ? 'PAID FULLY' : 'PENDING BALANCE'}</strong></div>
                    </div>
                    <div class="section"><div class="section-title">Earnings</div>
                        <div class="slip-row"><span>Basic Pay</span><strong>${this.formatCurrency(p.basicPay || 0)}</strong></div>
                        <div class="slip-row"><span>Allowances</span><strong>${this.formatCurrency(p.allowances || 0)}</strong></div>
                        <div class="slip-row"><span>Total Monthly Pay</span><strong>${this.formatCurrency(p.totalMonthPay || p.grossPay || 0)}</strong></div>
                    </div>
                    <div class="section"><div class="section-title">Deductions</div>
                        ${statutoryRows}
                        ${advanceRows}
                        <div class="slip-row"><span>Other Deductions</span><strong>${this.formatCurrency(p.otherDeductions || 0)}</strong></div>
                        <div class="slip-row"><span>Total Deductions</span><strong>${this.formatCurrency(p.totalDeductions || 0)}</strong></div>
                    </div>
                    <div class="slip-row net"><span>BALANCE PAYABLE</span><strong>${this.formatCurrency(balancePayable)}</strong></div>
                    <div class="foot">
                        Generated: ${this.escapeHtml(generatedAt)}<br>
                        By: ${this.escapeHtml(p.createdBy || '-')}<br>
                        This is a system generated payslip.
                    </div>
                </div>
                <div class="no-print"><button onclick="window.print()">Print</button><button onclick="window.close()">Close</button></div>
            </body></html>`;
            const w = window.open('', '_blank');
            if (!w) {
                this.showToast('Allow popups to print the payslip.', 'error');
                return;
            }
            w.document.write(html);
            w.document.close();
            w.focus();
            w.print();
        },

        destroyReportCharts() {
            hrReportCharts.forEach(chart => {
                try { chart.destroy(); } catch (e) { /* ignore */ }
            });
            hrReportCharts = [];
        },

        buildHrReportData() {
            const byType = { System: hrUsers.length, Casual: hrCasualStaff.length };
            const advanceBalance = this.roundMoney(hrAdvances.reduce((s, entry) => s + this.advanceSignedAmount(entry), 0));
            const totalGross = hrPayroll.reduce((s, p) => s + (p.grossPay || 0), 0);
            const totalDeductions = hrPayroll.reduce((s, p) => s + (p.totalDeductions || 0), 0);
            const totalBalancePayable = hrPayroll.reduce((s, p) => s + this.payrollBalancePayable(p), 0);
            const totalPaidForMonth = hrPayroll.reduce((s, p) => s + this.payrollTotalPaidForMonth(p), 0);
            const totalStatutory = hrPayroll.reduce((s, p) => s + ((p.statutoryDeductions && p.statutoryDeductions.total) || 0), 0);
            const totalAdvanceRepayments = hrPayroll.reduce((s, p) => s + (p.advanceRepayment || 0), 0);
            const byPeriod = {};
            hrPayroll.forEach(p => {
                const period = p.period || 'Unspecified';
                if (!byPeriod[period]) byPeriod[period] = { period, gross: 0, deductions: 0, balancePayable: 0, totalPaid: 0, count: 0 };
                byPeriod[period].gross += p.grossPay || 0;
                byPeriod[period].deductions += p.totalDeductions || 0;
                byPeriod[period].balancePayable += this.payrollBalancePayable(p);
                byPeriod[period].totalPaid += this.payrollTotalPaidForMonth(p);
                byPeriod[period].count++;
            });
            const periods = Object.values(byPeriod).sort((a, b) => a.period.localeCompare(b.period));
            return { byType, advanceBalance, totalGross, totalDeductions, totalBalancePayable, totalPaidForMonth, totalStatutory, totalAdvanceRepayments, periods };
        },

        renderHrReportCharts(data) {
            this.destroyReportCharts();
            if (!window.Chart) return;
            const periodLabels = data.periods.map(p => p.period);
            const makeChart = (id, config) => {
                const canvas = document.getElementById(id);
                if (!canvas) return;
                hrReportCharts.push(new Chart(canvas, config));
            };
            makeChart('hr-payroll-line-chart', {
                type: 'line',
                data: {
                    labels: periodLabels,
                    datasets: [
                        { label: 'Gross Pay', data: data.periods.map(p => p.gross), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.12)', tension: 0.32, fill: true },
                        { label: 'Balance Payable', data: data.periods.map(p => p.balancePayable), borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,.10)', tension: 0.32, fill: true },
                        { label: 'Total Paid', data: data.periods.map(p => p.totalPaid), borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,.10)', tension: 0.32, fill: true }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }
            });
            makeChart('hr-deductions-chart', {
                type: 'bar',
                data: {
                    labels: periodLabels,
                    datasets: [{ label: 'Deductions', data: data.periods.map(p => p.deductions), backgroundColor: '#f97316', borderRadius: 6 }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
            });
            makeChart('hr-staff-mix-chart', {
                type: 'doughnut',
                data: {
                    labels: ['System Staff', 'Casual Staff'],
                    datasets: [{ data: [data.byType.System, data.byType.Casual], backgroundColor: ['#4f46e5', '#f59e0b'], borderWidth: 0 }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
            });
            makeChart('hr-deduction-mix-chart', {
                type: 'doughnut',
                data: {
                    labels: ['Statutory', 'Advance Repayments', 'Other'],
                    datasets: [{
                        data: [
                            data.totalStatutory,
                            data.totalAdvanceRepayments,
                            Math.max(0, data.totalDeductions - data.totalStatutory - data.totalAdvanceRepayments)
                        ],
                        backgroundColor: ['#2563eb', '#16a34a', '#dc2626'],
                        borderWidth: 0
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
            });
        },

        exportHrReportCsv() {
            const data = this.buildHrReportData();
            if (!data.periods.length) { this.showToast('No HR report data to export.', 'error'); return; }
            const headers = ['Period', 'Payslips', 'Gross Pay', 'Deductions', 'Balance Payable', 'Total Paid'];
            const rows = data.periods.map(p => [p.period, p.count, p.gross, p.deductions, p.balancePayable, p.totalPaid]);
            const csv = [headers, ...rows].map(row => row.map(v => this.csvCell(v)).join(',')).join('\r\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'hr-report-' + new Date().toISOString().slice(0, 10) + '.csv';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            this.showToast('HR report CSV exported.');
        },

        exportHrReportPdf() {
            const data = this.buildHrReportData();
            if (!data.periods.length) { this.showToast('No HR report data to export.', 'error'); return; }
            if (!window.jspdf || !window.jspdf.jsPDF) {
                this.showToast('PDF export is not available. Please refresh the page.', 'error');
                return;
            }
            try {
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF('l', 'mm', 'a4');
                doc.setFontSize(14);
                doc.text((this.businessName() || 'PharmaFlow') + ' - HR Report', 14, 14);
                doc.setFontSize(9);
                doc.text('Generated: ' + new Date().toLocaleString(), 14, 21);
                doc.text('Staff: ' + (data.byType.System + data.byType.Casual) + ' | Payslips: ' + hrPayroll.length + ' | Balance Payable: ' + this.formatCurrency(data.totalBalancePayable) + ' | Total Paid: ' + this.formatCurrency(data.totalPaidForMonth), 14, 27);
                doc.autoTable({
                    head: [['Period', 'Payslips', 'Gross Pay', 'Deductions', 'Balance Payable', 'Total Paid']],
                    body: data.periods.map(p => [p.period, p.count, this.formatCurrency(p.gross), this.formatCurrency(p.deductions), this.formatCurrency(p.balancePayable), this.formatCurrency(p.totalPaid)]),
                    startY: 34,
                    styles: { fontSize: 8 },
                    headStyles: { fillColor: [37, 99, 235] }
                });
                doc.save('hr-report-' + new Date().toISOString().slice(0, 10) + '.pdf');
                this.showToast('HR report PDF exported.');
            } catch (err) {
                console.error('HR report PDF export failed:', err);
                this.showToast('Failed to export HR report PDF.', 'error');
            }
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
            const report = this.buildHrReportData();
            const periodRows = report.periods.slice().reverse().map(v => `<tr><td>${this.escapeHtml(v.period)}</td><td>${v.count}</td><td>${this.formatCurrency(v.gross)}</td><td>${this.formatCurrency(v.deductions)}</td><td>${this.formatCurrency(v.balancePayable)}</td><td><strong>${this.formatCurrency(v.totalPaid)}</strong></td></tr>`).join('');
            const body = `
            <div class="dda-stats hr-stats">
                <div class="dda-stat-card"><div class="dda-stat-icon"><i class="fas fa-id-badge"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${report.byType.System}</span><span class="dda-stat-label">System Staff</span></div></div>
                <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-person-digging"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${report.byType.Casual}</span><span class="dda-stat-label">Casual Staff</span></div></div>
                <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--revenue"><i class="fas fa-file-invoice"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${hrPayroll.length}</span><span class="dda-stat-label">Payslips</span></div></div>
                <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-hand-holding-dollar"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${this.formatCurrency(report.advanceBalance)}</span><span class="dda-stat-label">Outstanding Advances</span></div></div>
                <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--revenue"><i class="fas fa-money-check-dollar"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${this.formatCurrency(report.totalBalancePayable)}</span><span class="dda-stat-label">Balance Payable</span></div></div>
                <div class="dda-stat-card"><div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-sack-dollar"></i></div><div class="dda-stat-info"><span class="dda-stat-value">${this.formatCurrency(report.totalPaidForMonth)}</span><span class="dda-stat-label">Total Paid</span></div></div>
            </div>
            <div class="card">
                <div class="rpt-section-header">
                    <h3><i class="fas fa-chart-line"></i> HR Statistics & Charts</h3>
                    <div class="hr-report-actions">
                        <button type="button" class="hr-export-btn hr-export-btn--csv" id="hr-report-export-csv"><i class="fas fa-file-csv"></i> CSV</button>
                        <button type="button" class="hr-export-btn hr-export-btn--pdf" id="hr-report-export-pdf"><i class="fas fa-file-pdf"></i> PDF</button>
                    </div>
                </div>
                <div class="hr-report-grid">
                    <div class="hr-chart-card hr-chart-card--wide"><h4>Payroll Trend</h4><div class="hr-chart-box"><canvas id="hr-payroll-line-chart"></canvas></div></div>
                    <div class="hr-chart-card"><h4>Deductions by Period</h4><div class="hr-chart-box"><canvas id="hr-deductions-chart"></canvas></div></div>
                    <div class="hr-chart-card"><h4>Staff Mix</h4><div class="hr-chart-box"><canvas id="hr-staff-mix-chart"></canvas></div></div>
                    <div class="hr-chart-card"><h4>Deduction Mix</h4><div class="hr-chart-box"><canvas id="hr-deduction-mix-chart"></canvas></div></div>
                </div>
            </div>
            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-chart-column"></i> Payroll by Period</h3></div>
                <div class="dda-table-wrap"><table class="dda-table"><thead><tr><th>Period</th><th>Payslips</th><th>Gross</th><th>Deductions</th><th>Balance Payable</th><th>Total Paid</th></tr></thead><tbody>${periodRows || '<tr><td colspan="6" class="dda-loading">No payroll reports yet</td></tr>'}</tbody></table></div>
            </div>`;
            container.innerHTML = this.pageShell('HR Reports', 'fas fa-chart-column', 'Reports', body);
            this.bindDashboardLink(container);
            document.getElementById('hr-report-export-csv')?.addEventListener('click', () => this.exportHrReportCsv());
            document.getElementById('hr-report-export-pdf')?.addEventListener('click', () => this.exportHrReportPdf());
            setTimeout(() => this.renderHrReportCharts(report), 0);
        }
    };

    window.PharmaFlow.HumanResource = HR;
})();
