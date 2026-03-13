/**
 * PharmaFlow - Reports Module
 * Comprehensive analytics and report generation across all modules.
 * Real-time data via Firestore onSnapshot listeners.
 */
(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    /* ─── State ─── */
    let rptUnsubs = [];
    let rptSales = [], rptExpenses = [], rptInventory = [], rptPatients = [];
    let rptBills = [], rptWholesale = [], rptOrders = [];
    let rptDataReady = { sales: false, expenses: false, inventory: false, patients: false, bills: false, wholesale: false, orders: false };
    let rptCurrentTab = 'reports-overview';
    let rptDateRange = 'month'; // today | week | month | year | custom
    let rptCustomFrom = '', rptCustomTo = '';
    let rptContainer = null;

    const Reports = {
        /* ─── Helpers ─── */
        _fc(amount) {
            return 'KSH ' + new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
        },
        _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; },
        _bid() {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },
        _today() { return new Date().toISOString().slice(0, 10); },
        _dateObj(d) {
            if (!d) return null;
            if (d.toDate) return d.toDate();
            if (d.seconds) return new Date(d.seconds * 1000);
            if (typeof d === 'string') return new Date(d);
            return d instanceof Date ? d : null;
        },

        /* ─── Date Range Filter ─── */
        _getRange() {
            const now = new Date();
            const todayStr = now.toISOString().slice(0, 10);
            let from, to;
            if (rptDateRange === 'today') {
                from = todayStr; to = todayStr;
            } else if (rptDateRange === 'week') {
                const d = new Date(now); d.setDate(d.getDate() - d.getDay());
                from = d.toISOString().slice(0, 10); to = todayStr;
            } else if (rptDateRange === 'month') {
                from = todayStr.slice(0, 8) + '01'; to = todayStr;
            } else if (rptDateRange === 'year') {
                from = todayStr.slice(0, 5) + '01-01'; to = todayStr;
            } else {
                from = rptCustomFrom || todayStr; to = rptCustomTo || todayStr;
            }
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
            rptUnsubs.forEach(fn => fn());
            rptUnsubs = [];
            rptSales = []; rptExpenses = []; rptInventory = []; rptPatients = [];
            rptBills = []; rptWholesale = []; rptOrders = [];
            rptDataReady = { sales: false, expenses: false, inventory: false, patients: false, bills: false, wholesale: false, orders: false };
            rptContainer = null;
        },

        /* ─── Start Real-Time Listeners ─── */
        _startListeners(businessId) {
            const colls = [
                { name: 'sales', arr: 'rptSales', key: 'sales' },
                { name: 'expenses', arr: 'rptExpenses', key: 'expenses' },
                { name: 'inventory', arr: 'rptInventory', key: 'inventory' },
                { name: 'patients', arr: 'rptPatients', key: 'patients' },
                { name: 'patient_bills', arr: 'rptBills', key: 'bills' },
                { name: 'wholesale_orders', arr: 'rptWholesale', key: 'wholesale' },
                { name: 'orders', arr: 'rptOrders', key: 'orders' }
            ];
            const refs = {
                rptSales: v => { rptSales = v; },
                rptExpenses: v => { rptExpenses = v; },
                rptInventory: v => { rptInventory = v; },
                rptPatients: v => { rptPatients = v; },
                rptBills: v => { rptBills = v; },
                rptWholesale: v => { rptWholesale = v; },
                rptOrders: v => { rptOrders = v; }
            };
            colls.forEach(c => {
                const ref = getBusinessCollection(businessId, c.name);
                if (!ref) return;
                const unsub = ref.onSnapshot(snap => {
                    const data = [];
                    snap.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
                    refs[c.arr](data);
                    rptDataReady[c.key] = true;
                    this._onDataUpdate();
                }, err => console.error('Reports listener error:', c.name, err));
                rptUnsubs.push(unsub);
            });
        },

        _onDataUpdate() {
            if (!rptContainer) return;
            const body = rptContainer.querySelector('.rpt-tab-body');
            if (!body) return;
            this._renderCurrentTab(body);
        },

        /* ─── Router Entry Points ─── */
        renderOverview(container) { rptCurrentTab = 'reports-overview'; this._init(container); },
        renderSales(container) { rptCurrentTab = 'sales-reports'; this._init(container); },
        renderInventory(container) { rptCurrentTab = 'inventory-reports'; this._init(container); },
        renderFinancial(container) { rptCurrentTab = 'financial-reports'; this._init(container); },
        renderGenerate(container) { rptCurrentTab = 'generate-report'; this._init(container); },

        _init(container) {
            rptContainer = container;
            const businessId = this._bid();
            if (!businessId) { container.innerHTML = '<div class="card"><p>Please log in first.</p></div>'; return; }
            container.innerHTML = this._buildShell();
            this._bindDateFilter();
            const body = container.querySelector('.rpt-tab-body');
            if (body) body.innerHTML = '<div class="rpt-loading"><i class="fas fa-spinner fa-spin"></i> Loading data...</div>';
            if (rptUnsubs.length === 0) this._startListeners(businessId);
            else this._renderCurrentTab(body);
        },

        /* ─── Shell ─── */
        _buildShell() {
            const { from, to } = this._getRange();
            return `
            <div class="page-header">
                <div><h2><i class="fas fa-chart-bar"></i> Reports & Analytics</h2>
                    <div class="breadcrumb"><a href="#" data-nav="dashboard">Home</a><span>/</span><span>Reports</span></div>
                </div>
                <div class="rpt-date-controls">
                    <select id="rpt-range-select" class="form-control">
                        <option value="today" ${rptDateRange === 'today' ? 'selected' : ''}>Today</option>
                        <option value="week" ${rptDateRange === 'week' ? 'selected' : ''}>This Week</option>
                        <option value="month" ${rptDateRange === 'month' ? 'selected' : ''}>This Month</option>
                        <option value="year" ${rptDateRange === 'year' ? 'selected' : ''}>This Year</option>
                        <option value="custom" ${rptDateRange === 'custom' ? 'selected' : ''}>Custom Range</option>
                    </select>
                    <div id="rpt-custom-range" class="rpt-custom-range" style="display:${rptDateRange === 'custom' ? 'flex' : 'none'}">
                        <input type="date" id="rpt-from" class="form-control" value="${from}">
                        <span>to</span>
                        <input type="date" id="rpt-to" class="form-control" value="${to}">
                        <button class="btn btn-sm btn-primary" id="rpt-apply-range">Apply</button>
                    </div>
                </div>
            </div>
            <div class="rpt-tab-body"></div>`;
        },

        _bindDateFilter() {
            const sel = rptContainer.querySelector('#rpt-range-select');
            if (sel) sel.addEventListener('change', () => {
                rptDateRange = sel.value;
                const custom = rptContainer.querySelector('#rpt-custom-range');
                if (custom) custom.style.display = rptDateRange === 'custom' ? 'flex' : 'none';
                if (rptDateRange !== 'custom') this._onDataUpdate();
            });
            const apply = rptContainer.querySelector('#rpt-apply-range');
            if (apply) apply.addEventListener('click', () => {
                rptCustomFrom = rptContainer.querySelector('#rpt-from').value;
                rptCustomTo = rptContainer.querySelector('#rpt-to').value;
                this._onDataUpdate();
            });
            const navLink = rptContainer.querySelector('[data-nav="dashboard"]');
            if (navLink) navLink.addEventListener('click', e => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });
        },

        /* ─── Tab Router ─── */
        _renderCurrentTab(body) {
            if (!body) return;
            switch (rptCurrentTab) {
                case 'reports-overview': this._renderOverviewTab(body); break;
                case 'sales-reports': this._renderSalesTab(body); break;
                case 'inventory-reports': this._renderInventoryTab(body); break;
                case 'financial-reports': this._renderFinancialTab(body); break;
                case 'generate-report': this._renderGenerateTab(body); break;
            }
        },

        /* ─── Filtered Data Helpers ─── */
        _fSales() { return rptSales.filter(s => s.status !== 'voided' && s.status !== 'cancelled' && this._inRange(s)); },
        _fExpenses() { return rptExpenses.filter(e => this._inRange(e)); },
        _fBills() { return rptBills.filter(b => this._inRange(b)); },
        _fWholesale() { return rptWholesale.filter(w => this._inRange(w)); },

        /* ================================
         * TAB 1: OVERVIEW
         * ================================ */
        _renderOverviewTab(body) {
            const sales = this._fSales();
            const expenses = this._fExpenses();
            const bills = this._fBills();
            const wholesale = this._fWholesale();

            const totalRevenue = sales.reduce((s, d) => s + (d.total || 0), 0);
            const totalExpenses = expenses.reduce((s, d) => s + (d.amount || 0), 0);
            const totalProfit = sales.reduce((s, d) => s + (d.totalProfit || 0), 0);
            const totalBilling = bills.reduce((s, d) => s + (d.totalAmount || d.grandTotal || 0), 0);
            const retailSales = sales.filter(s => s.type !== 'wholesale' && s.type !== 'bulk');
            const wholesaleSales = sales.filter(s => s.type === 'wholesale' || s.type === 'bulk');
            const retailRev = retailSales.reduce((s, d) => s + (d.total || 0), 0);
            const wholesaleRev = wholesaleSales.reduce((s, d) => s + (d.total || 0), 0);
            const totalOrders = rptOrders.length;
            const activePatients = rptPatients.filter(p => p.status === 'active').length;

            // Payment method breakdown
            const pmBreak = {};
            sales.forEach(s => { const m = s.paymentMethod || 'other'; pmBreak[m] = (pmBreak[m] || 0) + (s.total || 0); });

            // Top categories
            const catBreak = {};
            sales.forEach(s => {
                (s.items || []).forEach(it => {
                    const cat = it.category || 'Uncategorized';
                    catBreak[cat] = (catBreak[cat] || 0) + (it.lineTotal || 0);
                });
            });
            const topCats = Object.entries(catBreak).sort((a, b) => b[1] - a[1]).slice(0, 6);
            const maxCat = topCats.length ? topCats[0][1] : 1;

            // Expense categories
            const expCat = {};
            expenses.forEach(e => { const c = e.category || 'Other'; expCat[c] = (expCat[c] || 0) + (e.amount || 0); });
            const topExpCats = Object.entries(expCat).sort((a, b) => b[1] - a[1]).slice(0, 6);
            const maxExpCat = topExpCats.length ? topExpCats[0][1] : 1;

            body.innerHTML = `
            <div class="rpt-kpi-grid">
                <div class="rpt-kpi-card rpt-kpi-blue">
                    <div class="rpt-kpi-icon"><i class="fas fa-coins"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalRevenue)}</span><span class="rpt-kpi-label">Total Revenue</span></div>
                </div>
                <div class="rpt-kpi-card rpt-kpi-red">
                    <div class="rpt-kpi-icon"><i class="fas fa-arrow-down"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalExpenses)}</span><span class="rpt-kpi-label">Total Expenses</span></div>
                </div>
                <div class="rpt-kpi-card rpt-kpi-green">
                    <div class="rpt-kpi-icon"><i class="fas fa-chart-line"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalProfit)}</span><span class="rpt-kpi-label">Gross Profit</span></div>
                </div>
                <div class="rpt-kpi-card ${(totalRevenue - totalExpenses) >= 0 ? 'rpt-kpi-green' : 'rpt-kpi-red'}">
                    <div class="rpt-kpi-icon"><i class="fas fa-balance-scale"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalRevenue - totalExpenses)}</span><span class="rpt-kpi-label">Net Income</span></div>
                </div>
                <div class="rpt-kpi-card rpt-kpi-purple">
                    <div class="rpt-kpi-icon"><i class="fas fa-shopping-cart"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${sales.length}</span><span class="rpt-kpi-label">Total Transactions</span></div>
                </div>
                <div class="rpt-kpi-card rpt-kpi-orange">
                    <div class="rpt-kpi-icon"><i class="fas fa-users"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${activePatients}</span><span class="rpt-kpi-label">Active Patients</span></div>
                </div>
            </div>

            <div class="rpt-grid-2">
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-coins"></i> Revenue Breakdown</h3></div>
                    <div class="rpt-revenue-split">
                        <div class="rpt-rev-item"><span class="rpt-rev-label">Retail Sales</span><span class="rpt-rev-val">${this._fc(retailRev)}</span></div>
                        <div class="rpt-rev-item"><span class="rpt-rev-label">Wholesale</span><span class="rpt-rev-val">${this._fc(wholesaleRev)}</span></div>
                        <div class="rpt-rev-item"><span class="rpt-rev-label">Patient Billing</span><span class="rpt-rev-val">${this._fc(totalBilling)}</span></div>
                    </div>
                    <div class="rpt-section-header" style="margin-top:15px"><h4>Payment Methods</h4></div>
                    <div class="rpt-bar-chart">
                        ${Object.entries(pmBreak).sort((a,b)=>b[1]-a[1]).map(([m, v]) => {
                            const pct = totalRevenue ? Math.round(v / totalRevenue * 100) : 0;
                            return `<div class="rpt-bar-row"><span class="rpt-bar-label">${this._esc(m.toUpperCase())}</span><div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-blue" style="width:${pct}%"></div></div><span class="rpt-bar-val">${this._fc(v)} (${pct}%)</span></div>`;
                        }).join('')}
                    </div>
                </div>
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-tags"></i> Top Selling Categories</h3></div>
                    <div class="rpt-bar-chart">
                        ${topCats.map(([cat, v]) => {
                            const pct = Math.round(v / maxCat * 100);
                            return `<div class="rpt-bar-row"><span class="rpt-bar-label">${this._esc(cat)}</span><div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-green" style="width:${pct}%"></div></div><span class="rpt-bar-val">${this._fc(v)}</span></div>`;
                        }).join('') || '<p class="rpt-empty">No category data</p>'}
                    </div>
                    <div class="rpt-section-header" style="margin-top:15px"><h3><i class="fas fa-money-bill-wave"></i> Top Expense Categories</h3></div>
                    <div class="rpt-bar-chart">
                        ${topExpCats.map(([cat, v]) => {
                            const pct = Math.round(v / maxExpCat * 100);
                            return `<div class="rpt-bar-row"><span class="rpt-bar-label">${this._esc(cat)}</span><div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-red" style="width:${pct}%"></div></div><span class="rpt-bar-val">${this._fc(v)}</span></div>`;
                        }).join('') || '<p class="rpt-empty">No expense data</p>'}
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-boxes-stacked"></i> Inventory Snapshot</h3></div>
                <div class="rpt-kpi-grid rpt-kpi-grid-4">
                    <div class="rpt-kpi-card rpt-kpi-blue-light">
                        <div class="rpt-kpi-info"><span class="rpt-kpi-value">${rptInventory.length}</span><span class="rpt-kpi-label">Total Products</span></div>
                    </div>
                    <div class="rpt-kpi-card rpt-kpi-red-light">
                        <div class="rpt-kpi-info"><span class="rpt-kpi-value">${rptInventory.filter(i => (i.quantity || 0) <= 0).length}</span><span class="rpt-kpi-label">Out of Stock</span></div>
                    </div>
                    <div class="rpt-kpi-card rpt-kpi-orange-light">
                        <div class="rpt-kpi-info"><span class="rpt-kpi-value">${rptInventory.filter(i => (i.quantity || 0) > 0 && (i.quantity || 0) <= (i.reorderLevel || 10)).length}</span><span class="rpt-kpi-label">Low Stock</span></div>
                    </div>
                    <div class="rpt-kpi-card rpt-kpi-green-light">
                        <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(rptInventory.reduce((s, i) => s + ((i.quantity || 0) * (i.buyingPrice || 0)), 0))}</span><span class="rpt-kpi-label">Inventory Value</span></div>
                    </div>
                </div>
            </div>`;
        },

        /* ================================
         * TAB 2: SALES REPORTS
         * ================================ */
        _renderSalesTab(body) {
            const sales = this._fSales();
            const totalRev = sales.reduce((s, d) => s + (d.total || 0), 0);
            const totalProfit = sales.reduce((s, d) => s + (d.totalProfit || 0), 0);
            const totalItems = sales.reduce((s, d) => s + (d.itemCount || 0), 0);
            const avgSale = sales.length ? totalRev / sales.length : 0;

            // Daily aggregation
            const dailyMap = {};
            sales.forEach(s => {
                const d = this._dateObj(s.createdAt || s.saleDate);
                if (!d) return;
                const ds = d.toISOString().slice(0, 10);
                if (!dailyMap[ds]) dailyMap[ds] = { revenue: 0, profit: 0, count: 0, items: 0 };
                dailyMap[ds].revenue += (s.total || 0);
                dailyMap[ds].profit += (s.totalProfit || 0);
                dailyMap[ds].count++;
                dailyMap[ds].items += (s.itemCount || 0);
            });
            const dailyArr = Object.entries(dailyMap).sort((a, b) => b[0].localeCompare(a[0]));
            const maxDailyRev = dailyArr.reduce((m, [, v]) => Math.max(m, v.revenue), 1);

            // Top products
            const prodMap = {};
            sales.forEach(s => {
                (s.items || []).forEach(it => {
                    const key = it.name || 'Unknown';
                    if (!prodMap[key]) prodMap[key] = { qty: 0, revenue: 0, profit: 0 };
                    prodMap[key].qty += (it.quantity || 0);
                    prodMap[key].revenue += (it.lineTotal || 0);
                    prodMap[key].profit += (it.profit || 0);
                });
            });
            const topProducts = Object.entries(prodMap).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 15);

            // Sales by staff
            const staffMap = {};
            sales.forEach(s => { const n = s.soldBy || 'Unknown'; staffMap[n] = (staffMap[n] || 0) + (s.total || 0); });
            const staffArr = Object.entries(staffMap).sort((a, b) => b[1] - a[1]);
            const maxStaff = staffArr.length ? staffArr[0][1] : 1;

            body.innerHTML = `
            <div class="rpt-kpi-grid rpt-kpi-grid-4">
                <div class="rpt-kpi-card rpt-kpi-blue"><div class="rpt-kpi-icon"><i class="fas fa-coins"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalRev)}</span><span class="rpt-kpi-label">Total Revenue</span></div></div>
                <div class="rpt-kpi-card rpt-kpi-green"><div class="rpt-kpi-icon"><i class="fas fa-chart-line"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalProfit)}</span><span class="rpt-kpi-label">Total Profit</span></div></div>
                <div class="rpt-kpi-card rpt-kpi-purple"><div class="rpt-kpi-icon"><i class="fas fa-receipt"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${sales.length}</span><span class="rpt-kpi-label">Transactions</span></div></div>
                <div class="rpt-kpi-card rpt-kpi-orange"><div class="rpt-kpi-icon"><i class="fas fa-calculator"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(avgSale)}</span><span class="rpt-kpi-label">Avg Sale</span></div></div>
            </div>

            <div class="rpt-grid-2">
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-chart-area"></i> Daily Sales Trend</h3></div>
                    <div class="rpt-bar-chart rpt-bar-chart-v">
                        ${dailyArr.slice(0, 14).map(([day, v]) => {
                            const pct = Math.round(v.revenue / maxDailyRev * 100);
                            return `<div class="rpt-bar-row"><span class="rpt-bar-label">${day}</span><div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-blue" style="width:${pct}%"></div></div><span class="rpt-bar-val">${this._fc(v.revenue)} (${v.count} sales)</span></div>`;
                        }).join('') || '<p class="rpt-empty">No sales data</p>'}
                    </div>
                </div>
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-user-tie"></i> Sales by Staff</h3></div>
                    <div class="rpt-bar-chart">
                        ${staffArr.map(([name, v]) => {
                            const pct = Math.round(v / maxStaff * 100);
                            return `<div class="rpt-bar-row"><span class="rpt-bar-label">${this._esc(name)}</span><div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-purple" style="width:${pct}%"></div></div><span class="rpt-bar-val">${this._fc(v)}</span></div>`;
                        }).join('') || '<p class="rpt-empty">No staff data</p>'}
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="rpt-section-header">
                    <h3><i class="fas fa-trophy"></i> Top Selling Products</h3>
                    <button class="btn btn-sm btn-outline" id="rpt-export-sales"><i class="fas fa-file-export"></i> Export</button>
                </div>
                <div class="table-responsive">
                    <table class="data-table">
                        <thead><tr><th>#</th><th>Product</th><th>Qty Sold</th><th>Revenue</th><th>Profit</th><th>Margin</th></tr></thead>
                        <tbody>
                            ${topProducts.map(([name, v], i) => {
                                const margin = v.revenue ? ((v.profit / v.revenue) * 100).toFixed(1) : '0.0';
                                return `<tr><td>${i + 1}</td><td>${this._esc(name)}</td><td>${v.qty}</td><td>${this._fc(v.revenue)}</td><td>${this._fc(v.profit)}</td><td>${margin}%</td></tr>`;
                            }).join('') || '<tr><td colspan="6" class="rpt-empty">No product data</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-calendar-day"></i> Daily Breakdown</h3></div>
                <div class="table-responsive">
                    <table class="data-table">
                        <thead><tr><th>Date</th><th>Transactions</th><th>Items Sold</th><th>Revenue</th><th>Profit</th></tr></thead>
                        <tbody>
                            ${dailyArr.map(([day, v]) =>
                                `<tr><td>${day}</td><td>${v.count}</td><td>${v.items}</td><td>${this._fc(v.revenue)}</td><td>${this._fc(v.profit)}</td></tr>`
                            ).join('') || '<tr><td colspan="5" class="rpt-empty">No data</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>`;

            const expBtn = body.querySelector('#rpt-export-sales');
            if (expBtn) expBtn.addEventListener('click', () => this._exportSalesReport(sales, topProducts, dailyArr));
        },

        /* ================================
         * TAB 3: INVENTORY REPORTS
         * ================================ */
        _renderInventoryTab(body) {
            const inv = rptInventory;
            const totalProducts = inv.length;
            const totalValue = inv.reduce((s, i) => s + ((i.quantity || 0) * (i.buyingPrice || 0)), 0);
            const totalRetailValue = inv.reduce((s, i) => s + ((i.quantity || 0) * (i.sellingPrice || 0)), 0);
            const outOfStock = inv.filter(i => (i.quantity || 0) <= 0);
            const lowStock = inv.filter(i => (i.quantity || 0) > 0 && (i.quantity || 0) <= (i.reorderLevel || 10));
            const now = new Date();
            const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            const expiring = inv.filter(i => {
                if (!i.expiryDate) return false;
                const exp = new Date(i.expiryDate);
                return exp <= thirtyDays && exp > now;
            });
            const expired = inv.filter(i => {
                if (!i.expiryDate) return false;
                return new Date(i.expiryDate) <= now;
            });

            // Category breakdown
            const catMap = {};
            inv.forEach(i => {
                const cat = i.category || 'Uncategorized';
                if (!catMap[cat]) catMap[cat] = { count: 0, value: 0, qty: 0 };
                catMap[cat].count++;
                catMap[cat].value += (i.quantity || 0) * (i.buyingPrice || 0);
                catMap[cat].qty += (i.quantity || 0);
            });
            const catArr = Object.entries(catMap).sort((a, b) => b[1].value - a[1].value);
            const maxCatVal = catArr.length ? catArr[0][1].value : 1;

            // Drug type breakdown
            const dtMap = {};
            inv.forEach(i => { const t = i.drugType || 'Other'; dtMap[t] = (dtMap[t] || 0) + 1; });

            body.innerHTML = `
            <div class="rpt-kpi-grid rpt-kpi-grid-4">
                <div class="rpt-kpi-card rpt-kpi-blue"><div class="rpt-kpi-icon"><i class="fas fa-boxes-stacked"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${totalProducts}</span><span class="rpt-kpi-label">Total Products</span></div></div>
                <div class="rpt-kpi-card rpt-kpi-green"><div class="rpt-kpi-icon"><i class="fas fa-coins"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalValue)}</span><span class="rpt-kpi-label">Cost Value</span></div></div>
                <div class="rpt-kpi-card rpt-kpi-purple"><div class="rpt-kpi-icon"><i class="fas fa-tag"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalRetailValue)}</span><span class="rpt-kpi-label">Retail Value</span></div></div>
                <div class="rpt-kpi-card rpt-kpi-orange"><div class="rpt-kpi-icon"><i class="fas fa-chart-pie"></i></div>
                    <div class="rpt-kpi-info"><span class="rpt-kpi-value">${this._fc(totalRetailValue - totalValue)}</span><span class="rpt-kpi-label">Potential Profit</span></div></div>
            </div>

            <div class="rpt-grid-2">
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-layer-group"></i> Stock by Category</h3></div>
                    <div class="rpt-bar-chart">
                        ${catArr.map(([cat, v]) => {
                            const pct = Math.round(v.value / maxCatVal * 100);
                            return `<div class="rpt-bar-row"><span class="rpt-bar-label">${this._esc(cat)} (${v.count})</span><div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-blue" style="width:${pct}%"></div></div><span class="rpt-bar-val">${this._fc(v.value)}</span></div>`;
                        }).join('') || '<p class="rpt-empty">No categories</p>'}
                    </div>
                </div>
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-pills"></i> Drug Type Distribution</h3></div>
                    <div class="rpt-type-grid">
                        ${Object.entries(dtMap).map(([t, c]) =>
                            `<div class="rpt-type-item"><span class="rpt-type-badge rpt-type-${t.toLowerCase()}">${this._esc(t)}</span><span class="rpt-type-count">${c} items</span></div>`
                        ).join('')}
                    </div>
                    <div class="rpt-section-header" style="margin-top:15px"><h3><i class="fas fa-exclamation-triangle"></i> Stock Alerts</h3></div>
                    <div class="rpt-alert-grid">
                        <div class="rpt-alert-card rpt-alert-danger"><i class="fas fa-ban"></i><span>${outOfStock.length}</span><small>Out of Stock</small></div>
                        <div class="rpt-alert-card rpt-alert-warning"><i class="fas fa-arrow-down"></i><span>${lowStock.length}</span><small>Low Stock</small></div>
                        <div class="rpt-alert-card rpt-alert-warning"><i class="fas fa-clock"></i><span>${expiring.length}</span><small>Expiring Soon</small></div>
                        <div class="rpt-alert-card rpt-alert-danger"><i class="fas fa-skull-crossbones"></i><span>${expired.length}</span><small>Expired</small></div>
                    </div>
                </div>
            </div>

            ${outOfStock.length ? `
            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-ban"></i> Out of Stock Items (${outOfStock.length})</h3>
                    <button class="btn btn-sm btn-outline" id="rpt-export-oos"><i class="fas fa-file-export"></i> Export</button></div>
                <div class="table-responsive"><table class="data-table">
                    <thead><tr><th>Name</th><th>SKU</th><th>Category</th><th>Reorder Level</th><th>Buying Price</th><th>Selling Price</th></tr></thead>
                    <tbody>${outOfStock.slice(0, 30).map(i => `<tr><td>${this._esc(i.name)}</td><td>${this._esc(i.sku || '-')}</td><td>${this._esc(i.category || '-')}</td><td>${i.reorderLevel || '-'}</td><td>${this._fc(i.buyingPrice)}</td><td>${this._fc(i.sellingPrice)}</td></tr>`).join('')}</tbody>
                </table></div>
            </div>` : ''}

            ${expiring.length ? `
            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-clock"></i> Expiring Within 30 Days (${expiring.length})</h3></div>
                <div class="table-responsive"><table class="data-table">
                    <thead><tr><th>Name</th><th>SKU</th><th>Batch</th><th>Qty</th><th>Expiry Date</th><th>Value</th></tr></thead>
                    <tbody>${expiring.map(i => `<tr><td>${this._esc(i.name)}</td><td>${this._esc(i.sku || '-')}</td><td>${this._esc(i.batchNumber || '-')}</td><td>${i.quantity || 0}</td><td><span class="rpt-badge-warn">${i.expiryDate || '-'}</span></td><td>${this._fc((i.quantity || 0) * (i.buyingPrice || 0))}</td></tr>`).join('')}</tbody>
                </table></div>
            </div>` : ''}`;

            const oosBtn = body.querySelector('#rpt-export-oos');
            if (oosBtn) oosBtn.addEventListener('click', () => this._exportInventoryReport(outOfStock, 'Out_of_Stock'));
        },

        /* ================================
         * TAB 4: FINANCIAL REPORTS
         * ================================ */
        _renderFinancialTab(body) {
            const sales = this._fSales();
            const expenses = this._fExpenses();
            const bills = this._fBills();
            const wholesale = this._fWholesale();

            const retailSales = sales.filter(s => s.type !== 'wholesale' && s.type !== 'bulk');
            const wholesaleSales = sales.filter(s => s.type === 'wholesale' || s.type === 'bulk');

            const retailRev = retailSales.reduce((s, d) => s + (d.total || 0), 0);
            const wholesaleRev = wholesaleSales.reduce((s, d) => s + (d.total || 0), 0);
            const billingRev = bills.reduce((s, d) => s + (d.totalAmount || d.grandTotal || 0), 0);
            const totalIncome = retailRev + wholesaleRev + billingRev;
            const totalCOGS = sales.reduce((s, d) => s + ((d.total || 0) - (d.totalProfit || 0)), 0);
            const grossProfit = sales.reduce((s, d) => s + (d.totalProfit || 0), 0);
            const totalExp = expenses.reduce((s, d) => s + (d.amount || 0), 0);
            const netProfit = grossProfit - totalExp;

            // Monthly trend
            const monthMap = {};
            sales.forEach(s => {
                const d = this._dateObj(s.createdAt || s.saleDate); if (!d) return;
                const m = d.toISOString().slice(0, 7);
                if (!monthMap[m]) monthMap[m] = { income: 0, expenses: 0, profit: 0 };
                monthMap[m].income += (s.total || 0);
                monthMap[m].profit += (s.totalProfit || 0);
            });
            expenses.forEach(e => {
                const d = this._dateObj(e.createdAt || e.expenseTimestamp); if (!d) return;
                const m = d.toISOString().slice(0, 7);
                if (!monthMap[m]) monthMap[m] = { income: 0, expenses: 0, profit: 0 };
                monthMap[m].expenses += (e.amount || 0);
            });
            const monthArr = Object.entries(monthMap).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
            const maxMonth = monthArr.reduce((m, [, v]) => Math.max(m, v.income, v.expenses), 1);

            // Expense by category
            const expCat = {};
            expenses.forEach(e => { const c = e.category || 'Other'; expCat[c] = (expCat[c] || 0) + (e.amount || 0); });
            const expCatArr = Object.entries(expCat).sort((a, b) => b[1] - a[1]);

            // Payment method income
            const pmIncome = {};
            sales.forEach(s => { const m = s.paymentMethod || 'other'; pmIncome[m] = (pmIncome[m] || 0) + (s.total || 0); });

            body.innerHTML = `
            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-file-invoice-dollar"></i> Profit & Loss Summary</h3>
                    <button class="btn btn-sm btn-outline" id="rpt-print-pnl"><i class="fas fa-print"></i> Print</button></div>
                <div class="rpt-pnl">
                    <div class="rpt-pnl-section">
                        <div class="rpt-pnl-header">Revenue</div>
                        <div class="rpt-pnl-row"><span>Retail Sales</span><span>${this._fc(retailRev)}</span></div>
                        <div class="rpt-pnl-row"><span>Wholesale Sales</span><span>${this._fc(wholesaleRev)}</span></div>
                        <div class="rpt-pnl-row"><span>Patient Billing</span><span>${this._fc(billingRev)}</span></div>
                        <div class="rpt-pnl-row rpt-pnl-total"><span>Total Revenue</span><span>${this._fc(totalIncome)}</span></div>
                    </div>
                    <div class="rpt-pnl-section">
                        <div class="rpt-pnl-header">Cost of Goods Sold</div>
                        <div class="rpt-pnl-row"><span>COGS (Purchase Cost)</span><span>${this._fc(totalCOGS)}</span></div>
                        <div class="rpt-pnl-row rpt-pnl-total rpt-pnl-good"><span>Gross Profit</span><span>${this._fc(grossProfit)}</span></div>
                    </div>
                    <div class="rpt-pnl-section">
                        <div class="rpt-pnl-header">Operating Expenses</div>
                        ${expCatArr.map(([cat, v]) => `<div class="rpt-pnl-row"><span>${this._esc(cat)}</span><span>${this._fc(v)}</span></div>`).join('')}
                        <div class="rpt-pnl-row rpt-pnl-total"><span>Total Expenses</span><span>${this._fc(totalExp)}</span></div>
                    </div>
                    <div class="rpt-pnl-section">
                        <div class="rpt-pnl-row rpt-pnl-total ${netProfit >= 0 ? 'rpt-pnl-good' : 'rpt-pnl-bad'}">
                            <span>Net Profit / Loss</span><span>${this._fc(netProfit)}</span>
                        </div>
                        <div class="rpt-pnl-row"><span>Profit Margin</span><span>${totalIncome ? ((netProfit / totalIncome) * 100).toFixed(1) : '0.0'}%</span></div>
                    </div>
                </div>
            </div>

            <div class="rpt-grid-2">
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-chart-bar"></i> Monthly Trend</h3></div>
                    <div class="rpt-bar-chart">
                        ${monthArr.map(([m, v]) => {
                            const iPct = Math.round(v.income / maxMonth * 100);
                            const ePct = Math.round(v.expenses / maxMonth * 100);
                            return `
                            <div class="rpt-bar-row rpt-bar-dual">
                                <span class="rpt-bar-label">${m}</span>
                                <div class="rpt-bar-dual-tracks">
                                    <div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-green" style="width:${iPct}%"></div></div>
                                    <div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-red" style="width:${ePct}%"></div></div>
                                </div>
                                <span class="rpt-bar-val-dual"><span class="rpt-val-green">${this._fc(v.income)}</span><span class="rpt-val-red">${this._fc(v.expenses)}</span></span>
                            </div>`;
                        }).join('') || '<p class="rpt-empty">No data</p>'}
                    </div>
                    <div class="rpt-legend"><span class="rpt-legend-item"><span class="rpt-dot rpt-dot-green"></span> Income</span><span class="rpt-legend-item"><span class="rpt-dot rpt-dot-red"></span> Expenses</span></div>
                </div>
                <div class="card">
                    <div class="rpt-section-header"><h3><i class="fas fa-wallet"></i> Income by Payment Method</h3></div>
                    <div class="rpt-bar-chart">
                        ${Object.entries(pmIncome).sort((a,b)=>b[1]-a[1]).map(([m, v]) => {
                            const pct = totalIncome ? Math.round(v / totalIncome * 100) : 0;
                            return `<div class="rpt-bar-row"><span class="rpt-bar-label">${this._esc(m.toUpperCase())}</span><div class="rpt-bar-track"><div class="rpt-bar-fill rpt-bar-blue" style="width:${pct}%"></div></div><span class="rpt-bar-val">${this._fc(v)} (${pct}%)</span></div>`;
                        }).join('')}
                    </div>
                </div>
            </div>`;

            const printBtn = body.querySelector('#rpt-print-pnl');
            if (printBtn) printBtn.addEventListener('click', () => this._printPnL({ retailRev, wholesaleRev, billingRev, totalIncome, totalCOGS, grossProfit, expCatArr, totalExp, netProfit }));
        },

        /* ================================
         * TAB 5: GENERATE REPORT
         * ================================ */
        _renderGenerateTab(body) {
            body.innerHTML = `
            <div class="card">
                <div class="rpt-section-header"><h3><i class="fas fa-file-export"></i> Generate & Export Report</h3></div>
                <div class="rpt-gen-form">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Report Type</label>
                            <select id="rpt-gen-type" class="form-control">
                                <option value="sales">Sales Report</option>
                                <option value="inventory">Inventory Report</option>
                                <option value="expenses">Expenses Report</option>
                                <option value="patients">Patients Report</option>
                                <option value="wholesale">Wholesale Report</option>
                                <option value="financial">Financial Summary</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Format</label>
                            <select id="rpt-gen-format" class="form-control">
                                <option value="pdf">PDF</option>
                                <option value="excel">Excel (.xlsx)</option>
                                <option value="print">Print</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>From Date</label>
                            <input type="date" id="rpt-gen-from" class="form-control" value="${this._getRange().from}">
                        </div>
                        <div class="form-group">
                            <label>To Date</label>
                            <input type="date" id="rpt-gen-to" class="form-control" value="${this._getRange().to}">
                        </div>
                    </div>
                    <button class="btn btn-primary btn-lg" id="rpt-gen-btn"><i class="fas fa-download"></i> Generate Report</button>
                </div>
            </div>
            <div id="rpt-gen-preview" class="card" style="display:none">
                <div class="rpt-section-header"><h3><i class="fas fa-eye"></i> Preview</h3></div>
                <div id="rpt-gen-preview-body"></div>
            </div>`;

            body.querySelector('#rpt-gen-btn').addEventListener('click', () => this._generateReport());
        },

        _generateReport() {
            const type = rptContainer.querySelector('#rpt-gen-type').value;
            const format = rptContainer.querySelector('#rpt-gen-format').value;
            const from = rptContainer.querySelector('#rpt-gen-from').value;
            const to = rptContainer.querySelector('#rpt-gen-to').value;

            // Filter data by the generate form dates
            const inR = (doc) => {
                const d = this._dateObj(doc.createdAt || doc.saleDate || doc.expenseTimestamp || doc.orderTimestamp);
                if (!d) return false;
                const ds = d.toISOString().slice(0, 10);
                return ds >= from && ds <= to;
            };

            let title = '', headers = [], rows = [];

            switch (type) {
                case 'sales': {
                    title = 'Sales Report';
                    const data = rptSales.filter(s => s.status !== 'voided' && inR(s));
                    headers = ['Sale ID', 'Date', 'Items', 'Total', 'Profit', 'Payment', 'Sold By'];
                    rows = data.map(s => {
                        const d = this._dateObj(s.createdAt || s.saleDate);
                        return [s.saleId || s.id, d ? d.toLocaleDateString('en-KE') : '-', s.itemCount || 0, s.total || 0, s.totalProfit || 0, (s.paymentMethod || '').toUpperCase(), s.soldBy || '-'];
                    });
                    break;
                }
                case 'inventory': {
                    title = 'Inventory Report';
                    headers = ['Name', 'SKU', 'Category', 'Drug Type', 'Qty', 'Buy Price', 'Sell Price', 'Value', 'Expiry'];
                    rows = rptInventory.map(i => [i.name || '-', i.sku || '-', i.category || '-', i.drugType || '-', i.quantity || 0, i.buyingPrice || 0, i.sellingPrice || 0, (i.quantity || 0) * (i.buyingPrice || 0), i.expiryDate || '-']);
                    break;
                }
                case 'expenses': {
                    title = 'Expenses Report';
                    const data = rptExpenses.filter(inR);
                    headers = ['Date', 'Title', 'Category', 'Amount', 'Payment Method', 'Vendor', 'Status'];
                    rows = data.map(e => {
                        const d = this._dateObj(e.createdAt || e.expenseTimestamp);
                        return [d ? d.toLocaleDateString('en-KE') : '-', e.title || '-', e.category || '-', e.amount || 0, e.paymentMethod || '-', e.vendor || '-', e.status || '-'];
                    });
                    break;
                }
                case 'patients': {
                    title = 'Patients Report';
                    headers = ['Patient ID', 'Name', 'Phone', 'Gender', 'Insurance', 'Total Billed', 'Total Paid', 'Visits', 'Status'];
                    rows = rptPatients.map(p => [p.patientId || '-', p.fullName || `${p.firstName || ''} ${p.lastName || ''}`, p.phone || '-', p.gender || '-', p.insurance || 'None', p.totalBilled || 0, p.totalPaid || 0, p.visitCount || 0, p.status || '-']);
                    break;
                }
                case 'wholesale': {
                    title = 'Wholesale Orders Report';
                    const data = rptWholesale.filter(inR);
                    headers = ['Order ID', 'Invoice', 'Customer', 'Items', 'Grand Total', 'Paid', 'Balance', 'Status'];
                    rows = data.map(w => [w.orderId || '-', w.invoiceNo || '-', (w.customer && w.customer.name) || '-', w.itemCount || 0, w.grandTotal || 0, w.amountPaid || 0, w.balanceDue || 0, w.status || '-']);
                    break;
                }
                case 'financial': {
                    title = 'Financial Summary';
                    const fSales = rptSales.filter(s => s.status !== 'voided' && inR(s));
                    const fExp = rptExpenses.filter(inR);
                    const totalRev = fSales.reduce((s, d) => s + (d.total || 0), 0);
                    const totalProf = fSales.reduce((s, d) => s + (d.totalProfit || 0), 0);
                    const totalExpAmt = fExp.reduce((s, d) => s + (d.amount || 0), 0);
                    headers = ['Metric', 'Amount'];
                    rows = [
                        ['Total Revenue', totalRev], ['Total Profit', totalProf],
                        ['Total Expenses', totalExpAmt], ['Net Profit', totalProf - totalExpAmt],
                        ['Total Transactions', fSales.length], ['Profit Margin (%)', totalRev ? ((totalProf - totalExpAmt) / totalRev * 100).toFixed(1) + '%' : '0%']
                    ];
                    break;
                }
            }

            // Show preview
            const preview = rptContainer.querySelector('#rpt-gen-preview');
            const previewBody = rptContainer.querySelector('#rpt-gen-preview-body');
            if (preview) preview.style.display = 'block';
            if (previewBody) {
                previewBody.innerHTML = `
                <p><strong>${title}</strong> | ${from} to ${to} | ${rows.length} records</p>
                <div class="table-responsive"><table class="data-table">
                    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                    <tbody>${rows.slice(0, 20).map(r => `<tr>${r.map(c => `<td>${typeof c === 'number' && headers[r.indexOf(c)] !== 'Qty' && headers[r.indexOf(c)] !== 'Items' && headers[r.indexOf(c)] !== 'Visits' ? this._fc(c) : this._esc(String(c))}</td>`).join('')}</tr>`).join('')}
                    ${rows.length > 20 ? `<tr><td colspan="${headers.length}" class="rpt-empty">... and ${rows.length - 20} more rows (shown in export)</td></tr>` : ''}
                    </tbody>
                </table></div>`;
            }

            // Export
            if (format === 'pdf') this._exportPDF(title, headers, rows, from, to);
            else if (format === 'excel') this._exportExcel(title, headers, rows, from, to);
            else if (format === 'print') this._printReport(title, headers, rows, from, to);
        },

        /* ─── Export Helpers ─── */
        _exportPDF(title, headers, rows, from, to) {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('l', 'mm', 'a4');
            const _bn = PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow';
            doc.setFontSize(16);
            doc.text(`${_bn} - ${title}`, 14, 15);
            doc.setFontSize(10);
            doc.text(`Period: ${from} to ${to} | Generated: ${new Date().toLocaleString('en-KE')}`, 14, 22);
            const fmtRows = rows.map(r => r.map(c => typeof c === 'number' ? this._fc(c) : String(c)));
            doc.autoTable({ head: [headers], body: fmtRows, startY: 28, styles: { fontSize: 8 }, headStyles: { fillColor: [37, 99, 235] } });
            doc.save(`${_bn.replace(/\s+/g, '')}_${title.replace(/\s+/g, '_')}_${from}_${to}.pdf`);
        },

        _exportExcel(title, headers, rows, from, to) {
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
            const _bn = PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow';
            XLSX.writeFile(wb, `${_bn.replace(/\s+/g, '')}_${title.replace(/\s+/g, '_')}_${from}_${to}.xlsx`);
        },

        _printReport(title, headers, rows, from, to) {
            const fmtRows = rows.map(r => r.map(c => typeof c === 'number' ? this._fc(c) : String(this._esc(c))));
            const html = `<!DOCTYPE html><html><head><title>${title}</title><style>
                body{font-family:Arial,sans-serif;padding:20px;font-size:12px}
                h1{font-size:18px;margin-bottom:4px}
                .meta{color:#666;margin-bottom:15px}
                table{width:100%;border-collapse:collapse;margin-top:10px}
                th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:11px}
                th{background:#2563eb;color:#fff}
                tr:nth-child(even){background:#f8f9fa}
            </style></head><body>
                <h1>${PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow'} - ${title}</h1>
                <p class="meta">Period: ${from} to ${to} | Generated: ${new Date().toLocaleString('en-KE')}</p>
                <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                <tbody>${fmtRows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>
            </body></html>`;
            const w = window.open('', '_blank');
            w.document.write(html);
            w.document.close();
            w.focus();
            w.print();
        },

        _exportSalesReport(sales, topProducts, dailyArr) {
            const { from, to } = this._getRange();
            const headers = ['Sale ID', 'Date', 'Items', 'Total', 'Profit', 'Payment', 'Sold By'];
            const rows = sales.map(s => {
                const d = this._dateObj(s.createdAt || s.saleDate);
                return [s.saleId || s.id, d ? d.toLocaleDateString('en-KE') : '-', s.itemCount || 0, s.total || 0, s.totalProfit || 0, (s.paymentMethod || '').toUpperCase(), s.soldBy || '-'];
            });
            this._exportPDF('Sales Report', headers, rows, from, to);
        },

        _exportInventoryReport(items, label) {
            const headers = ['Name', 'SKU', 'Category', 'Qty', 'Reorder Level', 'Buy Price', 'Sell Price'];
            const rows = items.map(i => [i.name || '-', i.sku || '-', i.category || '-', i.quantity || 0, i.reorderLevel || '-', i.buyingPrice || 0, i.sellingPrice || 0]);
            this._exportPDF(`Inventory - ${label}`, headers, rows, this._today(), this._today());
        },

        _printPnL(data) {
            const { retailRev, wholesaleRev, billingRev, totalIncome, totalCOGS, grossProfit, expCatArr, totalExp, netProfit } = data;
            const { from, to } = this._getRange();
            const html = `<!DOCTYPE html><html><head><title>P&L Statement</title><style>
                body{font-family:Arial,sans-serif;padding:30px;font-size:13px;max-width:700px;margin:auto}
                h1{font-size:20px;border-bottom:2px solid #2563eb;padding-bottom:8px}
                .meta{color:#666;margin-bottom:20px}
                .section{margin-bottom:15px}
                .section-title{font-weight:bold;font-size:14px;color:#2563eb;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-bottom:8px}
                .row{display:flex;justify-content:space-between;padding:4px 0}
                .total{font-weight:bold;border-top:2px solid #333;padding-top:6px;margin-top:6px}
                .good{color:#16a34a} .bad{color:#dc2626}
            </style></head><body>
                <h1>Profit & Loss Statement</h1>
                <p class="meta">Period: ${from} to ${to} | ${PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow'}</p>
                <div class="section"><div class="section-title">Revenue</div>
                    <div class="row"><span>Retail Sales</span><span>${this._fc(retailRev)}</span></div>
                    <div class="row"><span>Wholesale Sales</span><span>${this._fc(wholesaleRev)}</span></div>
                    <div class="row"><span>Patient Billing</span><span>${this._fc(billingRev)}</span></div>
                    <div class="row total"><span>Total Revenue</span><span>${this._fc(totalIncome)}</span></div>
                </div>
                <div class="section"><div class="section-title">Cost of Goods Sold</div>
                    <div class="row"><span>COGS</span><span>${this._fc(totalCOGS)}</span></div>
                    <div class="row total good"><span>Gross Profit</span><span>${this._fc(grossProfit)}</span></div>
                </div>
                <div class="section"><div class="section-title">Operating Expenses</div>
                    ${expCatArr.map(([c, v]) => `<div class="row"><span>${this._esc(c)}</span><span>${this._fc(v)}</span></div>`).join('')}
                    <div class="row total"><span>Total Expenses</span><span>${this._fc(totalExp)}</span></div>
                </div>
                <div class="section"><div class="row total ${netProfit >= 0 ? 'good' : 'bad'}"><span>Net Profit / Loss</span><span>${this._fc(netProfit)}</span></div></div>
            </body></html>`;
            const w = window.open('', '_blank');
            w.document.write(html);
            w.document.close();
            w.focus();
            w.print();
        }
    };

    window.PharmaFlow.Reports = Reports;
})();
