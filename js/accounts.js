/**
 * PharmaFlow - Accounts Module
 * Real-time financial reconciliation, income/expense tracking,
 * payment reconciliation, and profit & loss management.
 */
(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    /* ─── State ─── */
    let accUnsubs = [];
    let accSales = [], accExpenses = [], accBills = [], accWholesale = [];
    let accContainer = null;
    let accCurrentTab = 'accounts-overview';
    let accDateRange = 'month';
    let accCustomFrom = '', accCustomTo = '';

    const Accounts = {
        /* ─── Helpers ─── */
        _fc(a) { return 'KSH ' + new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(a || 0); },
        _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; },
        _bid() { return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null; },
        _dateObj(d) {
            if (!d) return null;
            if (d.toDate) return d.toDate();
            if (d.seconds) return new Date(d.seconds * 1000);
            if (typeof d === 'string') return new Date(d);
            return d instanceof Date ? d : null;
        },
        _getRange() {
            const now = new Date();
            const todayStr = now.toISOString().slice(0, 10);
            let from, to;
            if (accDateRange === 'today') { from = todayStr; to = todayStr; }
            else if (accDateRange === 'week') { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); from = d.toISOString().slice(0, 10); to = todayStr; }
            else if (accDateRange === 'month') { from = todayStr.slice(0, 8) + '01'; to = todayStr; }
            else if (accDateRange === 'year') { from = todayStr.slice(0, 5) + '01-01'; to = todayStr; }
            else { from = accCustomFrom || todayStr; to = accCustomTo || todayStr; }
            return { from, to };
        },
        _inRange(doc) {
            const { from, to } = this._getRange();
            const d = this._dateObj(doc.createdAt || doc.saleDate || doc.expenseTimestamp || doc.orderTimestamp);
            if (!d) return false;
            const ds = d.toISOString().slice(0, 10);
            return ds >= from && ds <= to;
        },

        /* ─── Cleanup ─── */
        cleanup() {
            accUnsubs.forEach(fn => fn());
            accUnsubs = [];
            accSales = []; accExpenses = []; accBills = []; accWholesale = [];
            accContainer = null;
        },

        /* ─── Listeners ─── */
        _startListeners(businessId) {
            const listen = (name, setter) => {
                const ref = getBusinessCollection(businessId, name);
                if (!ref) return;
                const unsub = ref.onSnapshot(snap => {
                    const data = [];
                    snap.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
                    setter(data);
                    this._onDataUpdate();
                }, err => console.error('Accounts listener error:', name, err));
                accUnsubs.push(unsub);
            };
            listen('sales', d => { accSales = d; });
            listen('expenses', d => { accExpenses = d; });
            listen('patient_bills', d => { accBills = d; });
            listen('wholesale_orders', d => { accWholesale = d; });
        },

        _onDataUpdate() {
            if (!accContainer) return;
            const body = accContainer.querySelector('.acc-tab-body');
            if (body) this._renderCurrentTab(body);
        },

        /* ─── Router Entry Points ─── */
        renderOverview(container) { accCurrentTab = 'accounts-overview'; this._init(container); },
        renderIncome(container) { accCurrentTab = 'income-tracking'; this._init(container); },
        renderExpenses(container) { accCurrentTab = 'expense-tracking'; this._init(container); },
        renderReconciliation(container) { accCurrentTab = 'reconciliation'; this._init(container); },
        renderProfitLoss(container) { accCurrentTab = 'profit-loss'; this._init(container); },

        _init(container) {
            accContainer = container;
            const businessId = this._bid();
            if (!businessId) { container.innerHTML = '<div class="card"><p>Please log in first.</p></div>'; return; }
            container.innerHTML = this._buildShell();
            this._bindControls();
            const body = container.querySelector('.acc-tab-body');
            if (body) body.innerHTML = '<div class="rpt-loading"><i class="fas fa-spinner fa-spin"></i> Loading financial data...</div>';
            if (accUnsubs.length === 0) this._startListeners(businessId);
            else this._renderCurrentTab(body);
        },

        _buildShell() {
            const { from, to } = this._getRange();
            return `
            <div class="page-header">
                <div><h2><i class="fas fa-calculator"></i> Accounts & Finance</h2>
                    <div class="breadcrumb"><a href="#" data-nav="dashboard">Home</a><span>/</span><span>Accounts</span></div>
                </div>
                <div class="rpt-date-controls">
                    <select id="acc-range-select" class="form-control">
                        <option value="today" ${accDateRange === 'today' ? 'selected' : ''}>Today</option>
                        <option value="week" ${accDateRange === 'week' ? 'selected' : ''}>This Week</option>
                        <option value="month" ${accDateRange === 'month' ? 'selected' : ''}>This Month</option>
                        <option value="year" ${accDateRange === 'year' ? 'selected' : ''}>This Year</option>
                        <option value="custom" ${accDateRange === 'custom' ? 'selected' : ''}>Custom Range</option>
                    </select>
                    <div id="acc-custom-range" class="rpt-custom-range" style="display:${accDateRange === 'custom' ? 'flex' : 'none'}">
                        <input type="date" id="acc-from" class="form-control" value="${from}">
                        <span>to</span>
                        <input type="date" id="acc-to" class="form-control" value="${to}">
                        <button class="btn btn-sm btn-primary" id="acc-apply-range">Apply</button>
                    </div>
                </div>
            </div>
            <div class="acc-tab-body"></div>`;
        },

        _bindControls() {
            const sel = accContainer.querySelector('#acc-range-select');
            if (sel) sel.addEventListener('change', () => {
                accDateRange = sel.value;
                const c = accContainer.querySelector('#acc-custom-range');
                if (c) c.style.display = accDateRange === 'custom' ? 'flex' : 'none';
                if (accDateRange !== 'custom') this._onDataUpdate();
            });
            const apply = accContainer.querySelector('#acc-apply-range');
            if (apply) apply.addEventListener('click', () => {
                accCustomFrom = accContainer.querySelector('#acc-from').value;
                accCustomTo = accContainer.querySelector('#acc-to').value;
                this._onDataUpdate();
            });
            const navLink = accContainer.querySelector('[data-nav="dashboard"]');
            if (navLink) navLink.addEventListener('click', e => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });
        },

        _renderCurrentTab(body) {
            if (!body) return;
            switch (accCurrentTab) {
                case 'accounts-overview': this._renderOverviewTab(body); break;
                case 'income-tracking': this._renderIncomeTab(body); break;
                case 'expense-tracking': this._renderExpenseTab(body); break;
                case 'reconciliation': this._renderReconciliationTab(body); break;
                case 'profit-loss': this._renderProfitLossTab(body); break;
            }
        },

        /* ─── Filtered Data ─── */
        _fSales() { return accSales.filter(s => s.status !== 'voided' && this._inRange(s)); },
        _fExpenses() { return accExpenses.filter(e => this._inRange(e)); },
        _fBills() { return accBills.filter(b => this._inRange(b)); },
        _fWholesale() { return accWholesale.filter(w => this._inRange(w)); },

        /* ================================
         * TAB 1: FINANCIAL OVERVIEW
         * ================================ */
        _renderOverviewTab(body) {
            const sales = this._fSales();
            const expenses = this._fExpenses();
            const bills = this._fBills();
            const wholesale = this._fWholesale();

            const retailSales = sales.filter(s => s.type !== 'wholesale' && s.type !== 'bulk');
            const wholesaleSales = sales.filter(s => s.type === 'wholesale' || s.type === 'bulk');

            const retailIncome = retailSales.reduce((s, d) => s + (d.total || 0), 0);
            const wholesaleIncome = wholesaleSales.reduce((s, d) => s + (d.total || 0), 0);
            const billingIncome = bills.reduce((s, d) => s + (d.totalPaid || d.amountPaid || 0), 0);
            const totalIncome = retailIncome + wholesaleIncome + billingIncome;
            const totalExpenses = expenses.reduce((s, d) => s + (d.amount || 0), 0);
            const totalProfit = sales.reduce((s, d) => s + (d.totalProfit || 0), 0);
            const netCashFlow = totalIncome - totalExpenses;

            // Outstanding receivables (wholesale with balance due)
            const receivables = accWholesale.filter(w => (w.balanceDue || 0) > 0 && w.status !== 'voided');
            const totalReceivables = receivables.reduce((s, w) => s + (w.balanceDue || 0), 0);

            // Pending expenses
            const pendingExp = accExpenses.filter(e => e.status === 'pending');
            const totalPending = pendingExp.reduce((s, e) => s + (e.amount || 0), 0);

            // Cash vs digital
            const cashIncome = sales.filter(s => s.paymentMethod === 'cash').reduce((s, d) => s + (d.total || 0), 0);
            const mpesaIncome = sales.filter(s => s.paymentMethod === 'mpesa').reduce((s, d) => s + (d.total || 0), 0);
            const cardIncome = sales.filter(s => s.paymentMethod === 'card').reduce((s, d) => s + (d.total || 0), 0);
            const otherIncome = totalIncome - cashIncome - mpesaIncome - cardIncome;

            // Daily cash flow
            const dailyCF = {};
            sales.forEach(s => {
                const d = this._dateObj(s.createdAt || s.saleDate); if (!d) return;
                const ds = d.toISOString().slice(0, 10);
                if (!dailyCF[ds]) dailyCF[ds] = { income: 0, expenses: 0 };
                dailyCF[ds].income += (s.total || 0);
            });
            expenses.forEach(e => {
                const d = this._dateObj(e.createdAt || e.expenseTimestamp); if (!d) return;
                const ds = d.toISOString().slice(0, 10);
                if (!dailyCF[ds]) dailyCF[ds] = { income: 0, expenses: 0 };
                dailyCF[ds].expenses += (e.amount || 0);
            });
            const cfArr = Object.entries(dailyCF).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10);
            const maxCF = cfArr.reduce((m, [, v]) => Math.max(m, v.income, v.expenses), 1);

            body.innerHTML = `
            <div class="rpt-kpi-grid">
                <div class="rpt-kpi-card rpt-kpi-green">
                    <div class="rpt-kpi-icon"><i class="fas fa-arrow-up"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalIncome)}</span><span class="rpt-kpi-label">Total Income</span></div>
                </div>
                <div class="rpt-kpi-card rpt-kpi-red">
                    <div class="rpt-kpi-icon"><i class="fas fa-arrow-down"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalExpenses)}</span><span class="rpt-kpi-label">Total Expenses</span></div>
                </div>
                <div class="rpt-kpi-card ${netCashFlow >= 0 ? 'rpt-kpi-green' : 'rpt-kpi-red'}">
                    <div class="rpt-kpi-icon"><i class="fas fa-exchange-alt"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(netCashFlow)}</span><span class="rpt-kpi-label">Net Cash Flow</span></div>
                </div>
                <div class="rpt-kpi-card rpt-kpi-blue">
                    <div class="rpt-kpi-icon"><i class="fas fa-chart-line"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalProfit)}</span><span class="rpt-kpi-label">Gross Profit</span></div>
                </div>
                <div class="rpt-kpi-card rpt-kpi-orange">
                    <div class="rpt-kpi-icon"><i class="fas fa-file-invoice"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalReceivables)}</span><span class="rpt-kpi-label">Outstanding Receivables</span></div>
                </div>
                <div class="rpt-kpi-card rpt-kpi-purple">
                    <div class="rpt-kpi-icon"><i class="fas fa-hourglass-half"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalPending)}</span><span class="rpt-kpi-label">Pending Expenses</span></div>
                </div>
            </div>

            <div class="rpt-grid-2">
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-wallet"></i> Income by Channel</h3></div>
                    <div class="acc-channel-grid">
                        <div class="acc-channel-item">
                            <div class="acc-channel-icon acc-ch-cash"><i class="fas fa-money-bill"></i></div>
                            <div class="acc-channel-info"><span class="acc-channel-label">Cash</span><span class="acc-channel-val">${this._fc(cashIncome)}</span>
                            <span class="acc-channel-pct">${totalIncome ? Math.round(cashIncome / totalIncome * 100) : 0}%</span></div>
                        </div>
                        <div class="acc-channel-item">
                            <div class="acc-channel-icon acc-ch-mpesa"><i class="fas fa-mobile-alt"></i></div>
                            <div class="acc-channel-info"><span class="acc-channel-label">M-Pesa</span><span class="acc-channel-val">${this._fc(mpesaIncome)}</span>
                            <span class="acc-channel-pct">${totalIncome ? Math.round(mpesaIncome / totalIncome * 100) : 0}%</span></div>
                        </div>
                        <div class="acc-channel-item">
                            <div class="acc-channel-icon acc-ch-card"><i class="fas fa-credit-card"></i></div>
                            <div class="acc-channel-info"><span class="acc-channel-label">Card</span><span class="acc-channel-val">${this._fc(cardIncome)}</span>
                            <span class="acc-channel-pct">${totalIncome ? Math.round(cardIncome / totalIncome * 100) : 0}%</span></div>
                        </div>
                        <div class="acc-channel-item">
                            <div class="acc-channel-icon acc-ch-other"><i class="fas fa-ellipsis-h"></i></div>
                            <div class="acc-channel-info"><span class="acc-channel-label">Other</span><span class="acc-channel-val">${this._fc(otherIncome)}</span>
                            <span class="acc-channel-pct">${totalIncome ? Math.round(otherIncome / totalIncome * 100) : 0}%</span></div>
                        </div>
                    </div>
                </div>
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-exchange-alt"></i> Daily Cash Flow</h3></div>
                    <div class="rpt-bar-chart">
                        ${cfArr.map(([day, v]) => {
                            const iPct = Math.round(v.income / maxCF * 100);
                            const ePct = Math.round(v.expenses / maxCF * 100);
                            const net = v.income - v.expenses;
                            return `
                            <div class="rpt-bar-row rpt-bar-dual">
                                <span class="rpt-bar-label">${day}</span>
                                <div class="rpt-bar-dual-tracks">
                                    <div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-green" style="width:${iPct}%"></div></div>
                                    <div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-red" style="width:${ePct}%"></div></div>
                                </div>
                                <span class="rpt-bar-val ${net >= 0 ? 'rpt-val-green' : 'rpt-val-red'}">${this._fc(net)}</span>
                            </div>`;
                        }).join('') || '<p class="rpt-empty">No data</p>'}
                    </div>
                    <div class="rpt-legend"><span class="rpt-legend-item"><span class="rpt-dot rpt-dot-green"></span> Income</span><span class="rpt-legend-item"><span class="rpt-dot rpt-dot-red"></span> Expenses</span></div>
                </div>
            </div>

            ${receivables.length ? `
            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-file-invoice-dollar"></i> Outstanding Receivables (${receivables.length})</h3></div>
                <div class="table-responsive"><table class="data-table">
                    <thead><tr><th>Order/Invoice</th><th>Customer</th><th>Total</th><th>Paid</th><th>Balance Due</th><th>Due Date</th><th>Status</th></tr></thead>
                    <tbody>${receivables.slice(0, 20).map(w => `<tr>
                        <td>${this._esc(w.orderId || '-')}<br><small>${this._esc(w.invoiceNo || '')}</small></td>
                        <td>${this._esc((w.customer && w.customer.name) || '-')}</td>
                        <td>${this._fc(w.grandTotal)}</td>
                        <td>${this._fc(w.amountPaid)}</td>
                        <td class="rpt-val-red"><strong>${this._fc(w.balanceDue)}</strong></td>
                        <td>${this._esc(w.dueDate || '-')}</td>
                        <td><span class="acc-status acc-status-${(w.paymentStatus || '').toLowerCase()}">${this._esc(w.paymentStatus || '-')}</span></td>
                    </tr>`).join('')}</tbody>
                </table></div>
            </div>` : ''}

            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-clock"></i> Recent Transactions</h3></div>
                <div class="table-responsive"><table class="data-table">
                    <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th><th>Payment</th></tr></thead>
                    <tbody>${this._getRecentTransactions(sales, expenses).map(t => `<tr>
                        <td>${t.date}</td>
                        <td><span class="acc-type-badge acc-type-${t.type}">${t.type === 'income' ? 'Income' : 'Expense'}</span></td>
                        <td>${this._esc(t.desc)}</td>
                        <td class="${t.type === 'income' ? 'rpt-val-green' : 'rpt-val-red'}">${t.type === 'income' ? '+' : '-'}${this._fc(t.amount)}</td>
                        <td>${this._esc(t.method)}</td>
                    </tr>`).join('') || '<tr><td colspan="5" class="rpt-empty">No transactions</td></tr>'}</tbody>
                </table></div>
            </div>`;
        },

        _getRecentTransactions(sales, expenses) {
            const txns = [];
            sales.forEach(s => {
                const d = this._dateObj(s.createdAt || s.saleDate);
                txns.push({ date: d ? d.toLocaleDateString('en-KE') : '-', type: 'income', desc: `Sale ${s.saleId || ''} (${s.itemCount || 0} items)`, amount: s.total || 0, method: (s.paymentMethod || '').toUpperCase(), ts: d ? d.getTime() : 0 });
            });
            expenses.forEach(e => {
                const d = this._dateObj(e.createdAt || e.expenseTimestamp);
                txns.push({ date: d ? d.toLocaleDateString('en-KE') : '-', type: 'expense', desc: e.title || 'Expense', amount: e.amount || 0, method: e.paymentMethod || '-', ts: d ? d.getTime() : 0 });
            });
            return txns.sort((a, b) => b.ts - a.ts).slice(0, 25);
        },

        /* ================================
         * TAB 2: INCOME TRACKING
         * ================================ */
        _renderIncomeTab(body) {
            const sales = this._fSales();
            const bills = this._fBills();

            const retailSales = sales.filter(s => s.type !== 'wholesale' && s.type !== 'bulk');
            const wholesaleSales = sales.filter(s => s.type === 'wholesale' || s.type === 'bulk');

            const retailIncome = retailSales.reduce((s, d) => s + (d.total || 0), 0);
            const wholesaleIncome = wholesaleSales.reduce((s, d) => s + (d.total || 0), 0);
            const billingIncome = bills.reduce((s, d) => s + (d.totalPaid || d.amountPaid || 0), 0);
            const totalIncome = retailIncome + wholesaleIncome + billingIncome;

            // Daily income
            const dailyIncome = {};
            sales.forEach(s => {
                const d = this._dateObj(s.createdAt || s.saleDate); if (!d) return;
                const ds = d.toISOString().slice(0, 10);
                if (!dailyIncome[ds]) dailyIncome[ds] = { retail: 0, wholesale: 0, billing: 0, count: 0 };
                if (s.type === 'wholesale' || s.type === 'bulk') dailyIncome[ds].wholesale += (s.total || 0);
                else dailyIncome[ds].retail += (s.total || 0);
                dailyIncome[ds].count++;
            });
            bills.forEach(b => {
                const d = this._dateObj(b.createdAt); if (!d) return;
                const ds = d.toISOString().slice(0, 10);
                if (!dailyIncome[ds]) dailyIncome[ds] = { retail: 0, wholesale: 0, billing: 0, count: 0 };
                dailyIncome[ds].billing += (b.totalPaid || b.amountPaid || 0);
            });
            const dailyArr = Object.entries(dailyIncome).sort((a, b) => b[0].localeCompare(a[0]));

            // Payment method
            const pmMap = {};
            sales.forEach(s => { const m = (s.paymentMethod || 'other').toUpperCase(); pmMap[m] = (pmMap[m] || 0) + (s.total || 0); });
            const pmArr = Object.entries(pmMap).sort((a, b) => b[1] - a[1]);
            const maxPM = pmArr.length ? pmArr[0][1] : 1;

            body.innerHTML = `
            <div class="rpt-kpi-grid rpt-kpi-grid-4">
                <div class="rpt-kpi-card rpt-kpi-green"><div class="rpt-kpi-icon"><i class="fas fa-coins"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalIncome)}</span><span class="rpt-kpi-label">Total Income</span></div></div>
                <div class="rpt-kpi-card rpt-kpi-blue"><div class="rpt-kpi-icon"><i class="fas fa-store"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(retailIncome)}</span><span class="rpt-kpi-label">Retail</span></div></div>
                <div class="rpt-kpi-card rpt-kpi-purple"><div class="rpt-kpi-icon"><i class="fas fa-truck"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(wholesaleIncome)}</span><span class="rpt-kpi-label">Wholesale</span></div></div>
                <div class="rpt-kpi-card rpt-kpi-orange"><div class="rpt-kpi-icon"><i class="fas fa-hospital-user"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(billingIncome)}</span><span class="rpt-kpi-label">Patient Billing</span></div></div>
            </div>

            <div class="rpt-grid-2">
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-chart-pie"></i> Income Source Distribution</h3></div>
                    <div class="acc-source-chart">
                        ${totalIncome > 0 ? `
                        <div class="acc-source-bar">
                            <div class="acc-source-seg acc-seg-retail" style="width:${Math.round(retailIncome/totalIncome*100)}%" title="Retail: ${this._fc(retailIncome)}"></div>
                            <div class="acc-source-seg acc-seg-wholesale" style="width:${Math.round(wholesaleIncome/totalIncome*100)}%" title="Wholesale: ${this._fc(wholesaleIncome)}"></div>
                            <div class="acc-source-seg acc-seg-billing" style="width:${Math.max(Math.round(billingIncome/totalIncome*100),1)}%" title="Billing: ${this._fc(billingIncome)}"></div>
                        </div>
                        <div class="acc-source-legend">
                            <span><span class="rpt-dot acc-dot-retail"></span> Retail ${Math.round(retailIncome/totalIncome*100)}%</span>
                            <span><span class="rpt-dot acc-dot-wholesale"></span> Wholesale ${Math.round(wholesaleIncome/totalIncome*100)}%</span>
                            <span><span class="rpt-dot acc-dot-billing"></span> Billing ${Math.round(billingIncome/totalIncome*100)}%</span>
                        </div>` : '<p class="rpt-empty">No income data</p>'}
                    </div>
                </div>
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-wallet"></i> By Payment Method</h3></div>
                    <div class="rpt-bar-chart">
                        ${pmArr.map(([m, v]) => {
                            const pct = Math.round(v / maxPM * 100);
                            return `<div class="rpt-bar-row"><span class="rpt-bar-label">${this._esc(m)}</span><div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-green" style="width:${pct}%"></div></div><span class="rpt-bar-val">${this._fc(v)}</span></div>`;
                        }).join('') || '<p class="rpt-empty">No data</p>'}
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-calendar-day"></i> Daily Income Breakdown</h3>
                    <button class="btn btn-sm btn-outline" id="acc-export-income"><i class="fas fa-file-export"></i> Export</button></div>
                <div class="table-responsive"><table class="data-table">
                    <thead><tr><th>Date</th><th>Retail</th><th>Wholesale</th><th>Billing</th><th>Total</th><th>Transactions</th></tr></thead>
                    <tbody>${dailyArr.map(([day, v]) => {
                        const total = v.retail + v.wholesale + v.billing;
                        return `<tr><td>${day}</td><td>${this._fc(v.retail)}</td><td>${this._fc(v.wholesale)}</td><td>${this._fc(v.billing)}</td><td><strong>${this._fc(total)}</strong></td><td>${v.count}</td></tr>`;
                    }).join('') || '<tr><td colspan="6" class="rpt-empty">No data</td></tr>'}</tbody>
                </table></div>
            </div>`;

            const expBtn = body.querySelector('#acc-export-income');
            if (expBtn) expBtn.addEventListener('click', () => {
                const { from, to } = this._getRange();
                const headers = ['Date', 'Retail', 'Wholesale', 'Billing', 'Total', 'Transactions'];
                const rows = dailyArr.map(([day, v]) => [day, v.retail, v.wholesale, v.billing, v.retail + v.wholesale + v.billing, v.count]);
                this._exportPDF('Income Report', headers, rows, from, to);
            });
        },

        /* ================================
         * TAB 3: EXPENSE TRACKING
         * ================================ */
        _renderExpenseTab(body) {
            const expenses = this._fExpenses();
            const totalExp = expenses.reduce((s, d) => s + (d.amount || 0), 0);

            // By category
            const catMap = {};
            expenses.forEach(e => { const c = e.category || 'Other'; catMap[c] = (catMap[c] || 0) + (e.amount || 0); });
            const catArr = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
            const maxCat = catArr.length ? catArr[0][1] : 1;

            // By vendor
            const vendorMap = {};
            expenses.forEach(e => { const v = e.vendor || 'Unspecified'; vendorMap[v] = (vendorMap[v] || 0) + (e.amount || 0); });
            const vendorArr = Object.entries(vendorMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
            const maxVendor = vendorArr.length ? vendorArr[0][1] : 1;

            // By payment method
            const pmMap = {};
            expenses.forEach(e => { const m = e.paymentMethod || 'Other'; pmMap[m] = (pmMap[m] || 0) + (e.amount || 0); });

            // By status
            const statusMap = {};
            expenses.forEach(e => { const s = e.status || 'unknown'; statusMap[s] = (statusMap[s] || 0) + 1; });

            // Recurring
            const recurring = expenses.filter(e => e.recurring && e.recurring !== 'no');
            const recurringTotal = recurring.reduce((s, e) => s + (e.amount || 0), 0);

            // Daily
            const dailyMap = {};
            expenses.forEach(e => {
                const d = this._dateObj(e.createdAt || e.expenseTimestamp); if (!d) return;
                const ds = d.toISOString().slice(0, 10);
                dailyMap[ds] = (dailyMap[ds] || 0) + (e.amount || 0);
            });
            const dailyArr = Object.entries(dailyMap).sort((a, b) => b[0].localeCompare(a[0]));
            const maxDaily = dailyArr.reduce((m, [, v]) => Math.max(m, v), 1);

            body.innerHTML = `
            <div class="rpt-kpi-grid rpt-kpi-grid-4">
                <div class="rpt-kpi-card rpt-kpi-red"><div class="rpt-kpi-icon"><i class="fas fa-money-bill-wave"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalExp)}</span><span class="rpt-kpi-label">Total Expenses</span></div></div>
                <div class="rpt-kpi-card rpt-kpi-orange"><div class="rpt-kpi-icon"><i class="fas fa-receipt"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${expenses.length}</span><span class="rpt-kpi-label">Transactions</span></div></div>
                <div class="rpt-kpi-card rpt-kpi-blue"><div class="rpt-kpi-icon"><i class="fas fa-calculator"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(expenses.length ? totalExp / expenses.length : 0)}</span><span class="rpt-kpi-label">Avg Expense</span></div></div>
                <div class="rpt-kpi-card rpt-kpi-purple"><div class="rpt-kpi-icon"><i class="fas fa-sync"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(recurringTotal)}</span><span class="rpt-kpi-label">Recurring (${recurring.length})</span></div></div>
            </div>

            <div class="rpt-grid-2">
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-tags"></i> By Category</h3></div>
                    <div class="rpt-bar-chart">
                        ${catArr.map(([cat, v]) => {
                            const pct = Math.round(v / maxCat * 100);
                            const catPct = totalExp ? Math.round(v / totalExp * 100) : 0;
                            return `<div class="rpt-bar-row"><span class="rpt-bar-label">${this._esc(cat)}</span><div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-red" style="width:${pct}%"></div></div><span class="rpt-bar-val">${this._fc(v)} (${catPct}%)</span></div>`;
                        }).join('') || '<p class="rpt-empty">No data</p>'}
                    </div>
                </div>
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-building"></i> Top Vendors</h3></div>
                    <div class="rpt-bar-chart">
                        ${vendorArr.map(([v, amt]) => {
                            const pct = Math.round(amt / maxVendor * 100);
                            return `<div class="rpt-bar-row"><span class="rpt-bar-label">${this._esc(v)}</span><div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-orange" style="width:${pct}%"></div></div><span class="rpt-bar-val">${this._fc(amt)}</span></div>`;
                        }).join('') || '<p class="rpt-empty">No vendor data</p>'}
                    </div>
                    <div class="rpt-section-header" style="margin-top:15px"><h3><i class="fas fa-wallet"></i> Payment Methods</h3></div>
                    <div class="acc-pm-chips">
                        ${Object.entries(pmMap).map(([m, v]) => `<div class="acc-pm-chip"><span>${this._esc(m)}</span><strong>${this._fc(v)}</strong></div>`).join('')}
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-chart-area"></i> Daily Expense Trend</h3></div>
                <div class="rpt-bar-chart">
                    ${dailyArr.slice(0, 14).map(([day, v]) => {
                        const pct = Math.round(v / maxDaily * 100);
                        return `<div class="rpt-bar-row"><span class="rpt-bar-label">${day}</span><div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-red" style="width:${pct}%"></div></div><span class="rpt-bar-val">${this._fc(v)}</span></div>`;
                    }).join('') || '<p class="rpt-empty">No data</p>'}
                </div>
            </div>

            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-list"></i> All Expenses</h3>
                    <button class="btn btn-sm btn-outline" id="acc-export-exp"><i class="fas fa-file-export"></i> Export</button></div>
                <div class="table-responsive"><table class="data-table">
                    <thead><tr><th>Date</th><th>Title</th><th>Category</th><th>Amount</th><th>Payment</th><th>Vendor</th><th>Status</th></tr></thead>
                    <tbody>${expenses.sort((a, b) => {
                        const da = this._dateObj(a.createdAt || a.expenseTimestamp);
                        const db = this._dateObj(b.createdAt || b.expenseTimestamp);
                        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
                    }).slice(0, 50).map(e => {
                        const d = this._dateObj(e.createdAt || e.expenseTimestamp);
                        return `<tr><td>${d ? d.toLocaleDateString('en-KE') : '-'}</td><td>${this._esc(e.title)}</td><td>${this._esc(e.category)}</td><td>${this._fc(e.amount)}</td><td>${this._esc(e.paymentMethod || '-')}</td><td>${this._esc(e.vendor || '-')}</td><td><span class="acc-status acc-status-${(e.status||'').toLowerCase()}">${this._esc(e.status || '-')}</span></td></tr>`;
                    }).join('') || '<tr><td colspan="7" class="rpt-empty">No expenses</td></tr>'}</tbody>
                </table></div>
            </div>`;

            const expBtn = body.querySelector('#acc-export-exp');
            if (expBtn) expBtn.addEventListener('click', () => {
                const { from, to } = this._getRange();
                const headers = ['Date', 'Title', 'Category', 'Amount', 'Payment Method', 'Vendor', 'Status'];
                const rows = expenses.map(e => {
                    const d = this._dateObj(e.createdAt || e.expenseTimestamp);
                    return [d ? d.toLocaleDateString('en-KE') : '-', e.title || '-', e.category || '-', e.amount || 0, e.paymentMethod || '-', e.vendor || '-', e.status || '-'];
                });
                this._exportPDF('Expenses Report', headers, rows, from, to);
            });
        },

        /* ================================
         * TAB 4: RECONCILIATION
         * ================================ */
        _renderReconciliationTab(body) {
            const sales = this._fSales();
            const expenses = this._fExpenses();

            // Payment method reconciliation
            const methods = ['cash', 'mpesa', 'card'];
            const methodNames = { cash: 'Cash', mpesa: 'M-Pesa', card: 'Card/Bank' };
            const recon = {};
            methods.forEach(m => {
                recon[m] = {
                    income: sales.filter(s => s.paymentMethod === m).reduce((s, d) => s + (d.total || 0), 0),
                    expenses: expenses.filter(e => {
                        const pm = (e.paymentMethod || '').toLowerCase();
                        if (m === 'cash') return pm === 'cash';
                        if (m === 'mpesa') return pm === 'm-pesa' || pm === 'mpesa';
                        return pm === 'card' || pm === 'credit card' || pm === 'bank transfer';
                    }).reduce((s, d) => s + (d.amount || 0), 0),
                    salesCount: sales.filter(s => s.paymentMethod === m).length,
                    expCount: expenses.filter(e => {
                        const pm = (e.paymentMethod || '').toLowerCase();
                        if (m === 'cash') return pm === 'cash';
                        if (m === 'mpesa') return pm === 'm-pesa' || pm === 'mpesa';
                        return pm === 'card' || pm === 'credit card' || pm === 'bank transfer';
                    }).length
                };
            });

            // Daily reconciliation
            const dailyRecon = {};
            sales.forEach(s => {
                const d = this._dateObj(s.createdAt || s.saleDate); if (!d) return;
                const ds = d.toISOString().slice(0, 10);
                if (!dailyRecon[ds]) dailyRecon[ds] = { income: 0, expenses: 0, salesCount: 0, expCount: 0 };
                dailyRecon[ds].income += (s.total || 0);
                dailyRecon[ds].salesCount++;
            });
            expenses.forEach(e => {
                const d = this._dateObj(e.createdAt || e.expenseTimestamp); if (!d) return;
                const ds = d.toISOString().slice(0, 10);
                if (!dailyRecon[ds]) dailyRecon[ds] = { income: 0, expenses: 0, salesCount: 0, expCount: 0 };
                dailyRecon[ds].expenses += (e.amount || 0);
                dailyRecon[ds].expCount++;
            });
            const reconArr = Object.entries(dailyRecon).sort((a, b) => b[0].localeCompare(a[0]));

            // Wholesale outstanding
            const outstanding = accWholesale.filter(w => (w.balanceDue || 0) > 0 && w.status !== 'voided');
            const totalOutstanding = outstanding.reduce((s, w) => s + (w.balanceDue || 0), 0);

            // Voided sales
            const voided = accSales.filter(s => s.status === 'voided' && this._inRange(s));
            const voidedTotal = voided.reduce((s, d) => s + (d.total || 0), 0);

            body.innerHTML = `
            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-balance-scale"></i> Payment Method Reconciliation</h3>
                    <button class="btn btn-sm btn-outline" id="acc-print-recon"><i class="fas fa-print"></i> Print</button></div>
                <div class="acc-recon-grid">
                    ${methods.map(m => {
                        const r = recon[m];
                        const net = r.income - r.expenses;
                        return `
                        <div class="acc-recon-card">
                            <div class="acc-recon-header acc-recon-${m}"><i class="fas fa-${m === 'cash' ? 'money-bill' : m === 'mpesa' ? 'mobile-alt' : 'credit-card'}"></i> ${methodNames[m]}</div>
                            <div class="acc-recon-body">
                                <div class="acc-recon-row"><span>Income (${r.salesCount} sales)</span><span class="rpt-val-green">${this._fc(r.income)}</span></div>
                                <div class="acc-recon-row"><span>Expenses (${r.expCount})</span><span class="rpt-val-red">${this._fc(r.expenses)}</span></div>
                                <div class="acc-recon-row acc-recon-net"><span>Net Balance</span><span class="${net >= 0 ? 'rpt-val-green' : 'rpt-val-red'}">${this._fc(net)}</span></div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>

            <div class="rpt-grid-2">
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-exclamation-circle"></i> Discrepancies & Alerts</h3></div>
                    <div class="acc-alerts-list">
                        ${voidedTotal > 0 ? `<div class="acc-alert-item acc-alert-warn"><i class="fas fa-ban"></i><div><strong>${voided.length} Voided Sales</strong><p>Total voided: ${this._fc(voidedTotal)}</p></div></div>` : ''}
                        ${totalOutstanding > 0 ? `<div class="acc-alert-item acc-alert-warn"><i class="fas fa-clock"></i><div><strong>${outstanding.length} Outstanding Invoices</strong><p>Total due: ${this._fc(totalOutstanding)}</p></div></div>` : ''}
                        ${!voidedTotal && !totalOutstanding ? '<div class="acc-alert-item acc-alert-ok"><i class="fas fa-check-circle"></i><div><strong>All Clear</strong><p>No discrepancies detected</p></div></div>' : ''}
                    </div>
                </div>
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-chart-pie"></i> Quick Summary</h3></div>
                    <div class="acc-summary-stats">
                        <div class="acc-stat-row"><span>Total Income</span><span class="rpt-val-green">${this._fc(sales.reduce((s, d) => s + (d.total || 0), 0))}</span></div>
                        <div class="acc-stat-row"><span>Total Expenses</span><span class="rpt-val-red">${this._fc(expenses.reduce((s, d) => s + (d.amount || 0), 0))}</span></div>
                        <div class="acc-stat-row"><span>Voided Sales</span><span class="rpt-val-red">${this._fc(voidedTotal)}</span></div>
                        <div class="acc-stat-row"><span>Outstanding Balance</span><span class="rpt-val-red">${this._fc(totalOutstanding)}</span></div>
                        <div class="acc-stat-row acc-stat-total"><span>Net Position</span><span class="${(sales.reduce((s, d) => s + (d.total || 0), 0) - expenses.reduce((s, d) => s + (d.amount || 0), 0)) >= 0 ? 'rpt-val-green' : 'rpt-val-red'}">${this._fc(sales.reduce((s, d) => s + (d.total || 0), 0) - expenses.reduce((s, d) => s + (d.amount || 0), 0))}</span></div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-calendar-check"></i> Daily Reconciliation</h3></div>
                <div class="table-responsive"><table class="data-table">
                    <thead><tr><th>Date</th><th>Sales Count</th><th>Income</th><th>Expenses Count</th><th>Expenses</th><th>Net</th><th>Status</th></tr></thead>
                    <tbody>${reconArr.map(([day, v]) => {
                        const net = v.income - v.expenses;
                        return `<tr><td>${day}</td><td>${v.salesCount}</td><td class="rpt-val-green">${this._fc(v.income)}</td><td>${v.expCount}</td><td class="rpt-val-red">${this._fc(v.expenses)}</td><td class="${net >= 0 ? 'rpt-val-green' : 'rpt-val-red'}"><strong>${this._fc(net)}</strong></td><td><span class="acc-status ${net >= 0 ? 'acc-status-positive' : 'acc-status-negative'}">${net >= 0 ? 'Surplus' : 'Deficit'}</span></td></tr>`;
                    }).join('') || '<tr><td colspan="7" class="rpt-empty">No data</td></tr>'}</tbody>
                </table></div>
            </div>`;

            const printBtn = body.querySelector('#acc-print-recon');
            if (printBtn) printBtn.addEventListener('click', () => this._printReconciliation(recon, methodNames, reconArr));
        },

        /* ================================
         * TAB 5: PROFIT & LOSS
         * ================================ */
        _renderProfitLossTab(body) {
            const sales = this._fSales();
            const expenses = this._fExpenses();
            const bills = this._fBills();

            const retailSales = sales.filter(s => s.type !== 'wholesale' && s.type !== 'bulk');
            const wholesaleSales = sales.filter(s => s.type === 'wholesale' || s.type === 'bulk');
            const retailRev = retailSales.reduce((s, d) => s + (d.total || 0), 0);
            const wholesaleRev = wholesaleSales.reduce((s, d) => s + (d.total || 0), 0);
            const billingRev = bills.reduce((s, d) => s + (d.totalAmount || d.grandTotal || 0), 0);
            const totalRevenue = retailRev + wholesaleRev + billingRev;
            const totalCOGS = sales.reduce((s, d) => s + ((d.total || 0) - (d.totalProfit || 0)), 0);
            const grossProfit = totalRevenue - totalCOGS;
            const grossMargin = totalRevenue ? ((grossProfit / totalRevenue) * 100).toFixed(1) : '0.0';

            // Expenses by category
            const expCat = {};
            expenses.forEach(e => { const c = e.category || 'Other'; expCat[c] = (expCat[c] || 0) + (e.amount || 0); });
            const expCatArr = Object.entries(expCat).sort((a, b) => b[1] - a[1]);
            const totalExp = expenses.reduce((s, d) => s + (d.amount || 0), 0);
            const netProfit = grossProfit - totalExp;
            const netMargin = totalRevenue ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0.0';

            // Monthly P&L
            const monthPnL = {};
            sales.forEach(s => {
                const d = this._dateObj(s.createdAt || s.saleDate); if (!d) return;
                const m = d.toISOString().slice(0, 7);
                if (!monthPnL[m]) monthPnL[m] = { revenue: 0, cogs: 0, expenses: 0 };
                monthPnL[m].revenue += (s.total || 0);
                monthPnL[m].cogs += ((s.total || 0) - (s.totalProfit || 0));
            });
            expenses.forEach(e => {
                const d = this._dateObj(e.createdAt || e.expenseTimestamp); if (!d) return;
                const m = d.toISOString().slice(0, 7);
                if (!monthPnL[m]) monthPnL[m] = { revenue: 0, cogs: 0, expenses: 0 };
                monthPnL[m].expenses += (e.amount || 0);
            });
            const monthArr = Object.entries(monthPnL).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);

            body.innerHTML = `
            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-file-invoice-dollar"></i> Profit & Loss Statement</h3>
                    <div>
                        <button class="btn btn-sm btn-outline" id="acc-print-pnl"><i class="fas fa-print"></i> Print</button>
                        <button class="btn btn-sm btn-primary" id="acc-export-pnl" style="margin-left:8px"><i class="fas fa-download"></i> PDF</button>
                    </div>
                </div>
                <div class="rpt-pnl">
                    <div class="rpt-pnl-section">
                        <div class="rpt-pnl-header">Revenue</div>
                        <div class="rpt-pnl-row"><span>Retail Sales</span><span>${this._fc(retailRev)}</span></div>
                        <div class="rpt-pnl-row"><span>Wholesale Sales</span><span>${this._fc(wholesaleRev)}</span></div>
                        <div class="rpt-pnl-row"><span>Patient Billing</span><span>${this._fc(billingRev)}</span></div>
                        <div class="rpt-pnl-row rpt-pnl-total"><span>Total Revenue</span><span>${this._fc(totalRevenue)}</span></div>
                    </div>
                    <div class="rpt-pnl-section">
                        <div class="rpt-pnl-header">Cost of Goods Sold</div>
                        <div class="rpt-pnl-row"><span>Purchase Cost of Items Sold</span><span>(${this._fc(totalCOGS)})</span></div>
                        <div class="rpt-pnl-row rpt-pnl-total rpt-pnl-good"><span>Gross Profit (Margin: ${grossMargin}%)</span><span>${this._fc(grossProfit)}</span></div>
                    </div>
                    <div class="rpt-pnl-section">
                        <div class="rpt-pnl-header">Operating Expenses</div>
                        ${expCatArr.map(([cat, v]) => `<div class="rpt-pnl-row"><span>${this._esc(cat)}</span><span>${this._fc(v)}</span></div>`).join('') || '<div class="rpt-pnl-row"><span>No expenses recorded</span><span>KSH 0.00</span></div>'}
                        <div class="rpt-pnl-row rpt-pnl-total"><span>Total Operating Expenses</span><span>${this._fc(totalExp)}</span></div>
                    </div>
                    <div class="rpt-pnl-section">
                        <div class="rpt-pnl-row rpt-pnl-total ${netProfit >= 0 ? 'rpt-pnl-good' : 'rpt-pnl-bad'}">
                            <span>Net Profit / (Loss)</span><span>${this._fc(netProfit)}</span>
                        </div>
                        <div class="rpt-pnl-row"><span>Net Profit Margin</span><span>${netMargin}%</span></div>
                        <div class="rpt-pnl-row"><span>Return on Sales</span><span>${totalRevenue ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0.0'}%</span></div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-chart-bar"></i> Monthly P&L Trend</h3></div>
                <div class="table-responsive"><table class="data-table">
                    <thead><tr><th>Month</th><th>Revenue</th><th>COGS</th><th>Gross Profit</th><th>Expenses</th><th>Net Profit</th><th>Margin</th></tr></thead>
                    <tbody>${monthArr.map(([m, v]) => {
                        const gp = v.revenue - v.cogs;
                        const np = gp - v.expenses;
                        const margin = v.revenue ? ((np / v.revenue) * 100).toFixed(1) : '0.0';
                        return `<tr><td>${m}</td><td>${this._fc(v.revenue)}</td><td>${this._fc(v.cogs)}</td><td class="rpt-val-green">${this._fc(gp)}</td><td class="rpt-val-red">${this._fc(v.expenses)}</td><td class="${np >= 0 ? 'rpt-val-green' : 'rpt-val-red'}"><strong>${this._fc(np)}</strong></td><td>${margin}%</td></tr>`;
                    }).join('') || '<tr><td colspan="7" class="rpt-empty">No data</td></tr>'}</tbody>
                </table></div>
            </div>

            <div class="rpt-grid-2">
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-chart-pie"></i> Expense Composition</h3></div>
                    <div class="rpt-bar-chart">
                        ${expCatArr.map(([cat, v]) => {
                            const pct = totalExp ? Math.round(v / totalExp * 100) : 0;
                            return `<div class="rpt-bar-row"><span class="rpt-bar-label">${this._esc(cat)}</span><div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-red" style="width:${pct}%"></div></div><span class="rpt-bar-val">${pct}%</span></div>`;
                        }).join('') || '<p class="rpt-empty">No expense data</p>'}
                    </div>
                </div>
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-bullseye"></i> Key Ratios</h3></div>
                    <div class="acc-ratios">
                        <div class="acc-ratio-item"><span class="acc-ratio-label">Gross Margin</span>
                            <div class="acc-ratio-bar"><div class="acc-ratio-fill acc-ratio-green" style="width:${Math.min(Math.max(parseFloat(grossMargin), 0), 100)}%"></div></div>
                            <span class="acc-ratio-val">${grossMargin}%</span></div>
                        <div class="acc-ratio-item"><span class="acc-ratio-label">Net Margin</span>
                            <div class="acc-ratio-bar"><div class="acc-ratio-fill ${parseFloat(netMargin) >= 0 ? 'acc-ratio-green' : 'acc-ratio-red'}" style="width:${Math.min(Math.abs(parseFloat(netMargin)), 100)}%"></div></div>
                            <span class="acc-ratio-val">${netMargin}%</span></div>
                        <div class="acc-ratio-item"><span class="acc-ratio-label">Expense Ratio</span>
                            <div class="acc-ratio-bar"><div class="acc-ratio-fill acc-ratio-orange" style="width:${totalRevenue ? Math.min(Math.round(totalExp / totalRevenue * 100), 100) : 0}%"></div></div>
                            <span class="acc-ratio-val">${totalRevenue ? (totalExp / totalRevenue * 100).toFixed(1) : '0.0'}%</span></div>
                        <div class="acc-ratio-item"><span class="acc-ratio-label">COGS Ratio</span>
                            <div class="acc-ratio-bar"><div class="acc-ratio-fill acc-ratio-blue" style="width:${totalRevenue ? Math.min(Math.round(totalCOGS / totalRevenue * 100), 100) : 0}%"></div></div>
                            <span class="acc-ratio-val">${totalRevenue ? (totalCOGS / totalRevenue * 100).toFixed(1) : '0.0'}%</span></div>
                    </div>
                </div>
            </div>`;

            const printBtn = body.querySelector('#acc-print-pnl');
            if (printBtn) printBtn.addEventListener('click', () => this._printPnL({ retailRev, wholesaleRev, billingRev, totalRevenue, totalCOGS, grossProfit, grossMargin, expCatArr, totalExp, netProfit, netMargin }));
            const pdfBtn = body.querySelector('#acc-export-pnl');
            if (pdfBtn) pdfBtn.addEventListener('click', () => this._exportPnLPDF({ retailRev, wholesaleRev, billingRev, totalRevenue, totalCOGS, grossProfit, grossMargin, expCatArr, totalExp, netProfit, netMargin }));
        },

        /* ─── Export / Print Helpers ─── */
        _exportPDF(title, headers, rows, from, to) {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('l', 'mm', 'a4');
            const _bn = PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow';
            doc.setFontSize(16); doc.text(`${_bn} - ${title}`, 14, 15);
            doc.setFontSize(10); doc.text(`Period: ${from} to ${to} | Generated: ${new Date().toLocaleString('en-KE')}`, 14, 22);
            const fmtRows = rows.map(r => r.map(c => typeof c === 'number' ? this._fc(c) : String(c)));
            doc.autoTable({ head: [headers], body: fmtRows, startY: 28, styles: { fontSize: 8 }, headStyles: { fillColor: [37, 99, 235] } });
            doc.save(`${_bn.replace(/\s+/g, '')}_${title.replace(/\s+/g, '_')}_${from}_${to}.pdf`);
        },

        _printReconciliation(recon, methodNames, reconArr) {
            const { from, to } = this._getRange();
            const html = `<!DOCTYPE html><html><head><title>Reconciliation Report</title><style>
                body{font-family:Arial,sans-serif;padding:30px;font-size:12px;max-width:900px;margin:auto}
                h1{font-size:18px;border-bottom:2px solid #2563eb;padding-bottom:8px}
                .meta{color:#666;margin-bottom:20px;font-size:11px}
                table{width:100%;border-collapse:collapse;margin:15px 0}
                th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:11px}
                th{background:#2563eb;color:#fff}
                .section{margin:20px 0}
                .section h3{font-size:14px;color:#2563eb;margin-bottom:8px}
                .green{color:#16a34a} .red{color:#dc2626}
            </style></head><body>
                <h1>${PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow'} - Reconciliation Report</h1>
                <p class="meta">Period: ${from} to ${to} | Generated: ${new Date().toLocaleString('en-KE')}</p>
                <div class="section"><h3>Payment Method Summary</h3>
                <table><thead><tr><th>Method</th><th>Income</th><th>Expenses</th><th>Net Balance</th></tr></thead>
                <tbody>${['cash', 'mpesa', 'card'].map(m => {
                    const r = recon[m]; const net = r.income - r.expenses;
                    return `<tr><td>${methodNames[m]}</td><td class="green">${this._fc(r.income)}</td><td class="red">${this._fc(r.expenses)}</td><td class="${net >= 0 ? 'green' : 'red'}">${this._fc(net)}</td></tr>`;
                }).join('')}</tbody></table></div>
                <div class="section"><h3>Daily Breakdown</h3>
                <table><thead><tr><th>Date</th><th>Income</th><th>Expenses</th><th>Net</th></tr></thead>
                <tbody>${reconArr.map(([d, v]) => {
                    const net = v.income - v.expenses;
                    return `<tr><td>${d}</td><td class="green">${this._fc(v.income)}</td><td class="red">${this._fc(v.expenses)}</td><td class="${net >= 0 ? 'green' : 'red'}">${this._fc(net)}</td></tr>`;
                }).join('')}</tbody></table></div>
            </body></html>`;
            const w = window.open('', '_blank'); w.document.write(html); w.document.close(); w.focus(); w.print();
        },

        _printPnL(data) {
            const { retailRev, wholesaleRev, billingRev, totalRevenue, totalCOGS, grossProfit, grossMargin, expCatArr, totalExp, netProfit, netMargin } = data;
            const { from, to } = this._getRange();
            const html = `<!DOCTYPE html><html><head><title>P&L Statement</title><style>
                body{font-family:Arial,sans-serif;padding:30px;font-size:13px;max-width:700px;margin:auto}
                h1{font-size:20px;border-bottom:2px solid #2563eb;padding-bottom:8px}
                .meta{color:#666;margin-bottom:20px}
                .section{margin-bottom:15px}
                .section-title{font-weight:bold;font-size:14px;color:#2563eb;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-bottom:8px}
                .row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px}
                .total{font-weight:bold;border-top:2px solid #333;padding-top:6px;margin-top:6px}
                .good{color:#16a34a} .bad{color:#dc2626}
            </style></head><body>
                <h1>Profit & Loss Statement</h1>
                <p class="meta">Period: ${from} to ${to} | ${PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow'}</p>
                <div class="section"><div class="section-title">Revenue</div>
                    <div class="row"><span>Retail Sales</span><span>${this._fc(retailRev)}</span></div>
                    <div class="row"><span>Wholesale Sales</span><span>${this._fc(wholesaleRev)}</span></div>
                    <div class="row"><span>Patient Billing</span><span>${this._fc(billingRev)}</span></div>
                    <div class="row total"><span>Total Revenue</span><span>${this._fc(totalRevenue)}</span></div></div>
                <div class="section"><div class="section-title">Cost of Goods Sold</div>
                    <div class="row"><span>COGS</span><span>(${this._fc(totalCOGS)})</span></div>
                    <div class="row total good"><span>Gross Profit (${grossMargin}%)</span><span>${this._fc(grossProfit)}</span></div></div>
                <div class="section"><div class="section-title">Operating Expenses</div>
                    ${expCatArr.map(([c, v]) => `<div class="row"><span>${this._esc(c)}</span><span>${this._fc(v)}</span></div>`).join('')}
                    <div class="row total"><span>Total Expenses</span><span>${this._fc(totalExp)}</span></div></div>
                <div class="section"><div class="row total ${netProfit >= 0 ? 'good' : 'bad'}"><span>Net Profit / (Loss)</span><span>${this._fc(netProfit)}</span></div>
                    <div class="row"><span>Net Margin</span><span>${netMargin}%</span></div></div>
            </body></html>`;
            const w = window.open('', '_blank'); w.document.write(html); w.document.close(); w.focus(); w.print();
        },

        _exportPnLPDF(data) {
            const { retailRev, wholesaleRev, billingRev, totalRevenue, totalCOGS, grossProfit, grossMargin, expCatArr, totalExp, netProfit, netMargin } = data;
            const { from, to } = this._getRange();
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');
            doc.setFontSize(18); doc.text('Profit & Loss Statement', 14, 20);
            doc.setFontSize(10); doc.text(`${PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow'} | Period: ${from} to ${to}`, 14, 28);
            let y = 38;
            const addSection = (title, rows, isTotal) => {
                doc.setFontSize(12); doc.setTextColor(37, 99, 235); doc.text(title, 14, y); y += 2;
                doc.setDrawColor(37, 99, 235); doc.line(14, y, 196, y); y += 6;
                doc.setFontSize(10); doc.setTextColor(0, 0, 0);
                rows.forEach(([label, val]) => {
                    doc.text(label, 18, y); doc.text(val, 190, y, { align: 'right' }); y += 6;
                });
                if (isTotal) { doc.setDrawColor(0); doc.line(14, y - 2, 196, y - 2); }
                y += 4;
            };
            addSection('Revenue', [['Retail Sales', this._fc(retailRev)], ['Wholesale Sales', this._fc(wholesaleRev)], ['Patient Billing', this._fc(billingRev)], ['Total Revenue', this._fc(totalRevenue)]], true);
            addSection('Cost of Goods Sold', [['COGS', `(${this._fc(totalCOGS)})`], [`Gross Profit (${grossMargin}%)`, this._fc(grossProfit)]], true);
            addSection('Operating Expenses', [...expCatArr.map(([c, v]) => [c, this._fc(v)]), ['Total Expenses', this._fc(totalExp)]], true);
            doc.setFontSize(12); doc.setTextColor(netProfit >= 0 ? 22 : 220, netProfit >= 0 ? 163 : 38, netProfit >= 0 ? 74 : 38);
            doc.text('Net Profit / (Loss)', 14, y); doc.text(this._fc(netProfit), 190, y, { align: 'right' }); y += 6;
            doc.setTextColor(0); doc.setFontSize(10); doc.text(`Net Margin: ${netMargin}%`, 14, y);
            doc.save(`${(PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow').replace(/\s+/g, '')}_PnL_${from}_${to}.pdf`);
        }
    };

    window.PharmaFlow.Accounts = Accounts;
})();
