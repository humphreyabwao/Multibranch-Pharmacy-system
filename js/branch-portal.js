/**
 * PharmaFlow - Branch Portal
 * Superadmin billing, branch communications, and contract exchange.
 */
(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let activeListener = null;
    let financeDocs = [];
    let communications = [];
    let contracts = [];
    let businesses = [];
    let signingPad = null;

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const BranchPortal = {
        cleanup: function () {
            if (activeListener) {
                activeListener();
                activeListener = null;
            }
            financeDocs = [];
            communications = [];
            contracts = [];
            signingPad = null;
        },

        isSuperAdmin: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.isSuperAdmin ? PharmaFlow.Auth.isSuperAdmin() : false;
        },

        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        getUserName: function () {
            const p = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
            return p ? (p.displayName || p.email || 'User') : 'User';
        },

        escapeHtml: function (value) {
            const d = document.createElement('div');
            d.textContent = value == null ? '' : String(value);
            return d.innerHTML;
        },

        money: function (amount, currency) {
            const n = Number(amount || 0);
            return (currency || 'KES') + ' ' + n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },

        formatDate: function (value) {
            if (!value) return 'Not set';
            const d = value.toDate ? value.toDate() : (value.seconds ? new Date(value.seconds * 1000) : new Date(value));
            if (isNaN(d.getTime())) return 'Not set';
            return d.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
        },

        nowIso: function () {
            return new Date().toISOString();
        },

        showToast: function (message, type) {
            const old = document.querySelector('.bp-toast');
            if (old) old.remove();
            const toast = document.createElement('div');
            toast.className = 'bp-toast' + (type === 'error' ? ' bp-toast--error' : '');
            toast.innerHTML = '<i class="fas ' + (type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle') + '"></i> ' + this.escapeHtml(message);
            document.body.appendChild(toast);
            setTimeout(() => toast.classList.add('show'), 10);
            setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3200);
        },

        loadBusinesses: async function () {
            if (!this.isSuperAdmin() || businesses.length) return businesses;
            const snap = await window.db.collection('businesses').get();
            businesses = snap.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            return businesses;
        },

        branchName: function (businessId, fallback) {
            const b = businesses.find(item => item.id === businessId);
            return b ? (b.name || b.id) : (fallback || businessId || 'Branch');
        },

        businessOptions: function (selectedId) {
            return businesses.map(b => {
                const name = this.escapeHtml(b.name || b.id);
                return '<option value="' + this.escapeHtml(b.id) + '"' + (selectedId === b.id ? ' selected' : '') + '>' + name + '</option>';
            }).join('');
        },

        makeDocNumber: function (type) {
            const prefix = type === 'receipt' ? 'RCT' : 'INV';
            const d = new Date();
            return prefix + '-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
        },

        renderBilling: async function (container) {
            this.cleanup();
            await this.loadBusinesses();
            const admin = this.isSuperAdmin();
            container.innerHTML = `
                <div class="bp-module">
                    ${this.headerHtml('Invoices & Receipts', 'fas fa-file-invoice-dollar', 'Monthly system payments')}
                    <div class="bp-grid ${admin ? '' : 'bp-grid--single'}">
                        ${admin ? this.billingFormHtml() : ''}
                        <section class="bp-card">
                            <div class="bp-card-head">
                                <div>
                                    <h3>${admin ? 'Issued Documents' : 'My Documents'}</h3>
                                    <small>Clean monthly payment records</small>
                                </div>
                                <button class="btn btn-sm btn-outline" id="bp-refresh-billing"><i class="fas fa-rotate"></i> Refresh</button>
                            </div>
                            <div class="bp-toolbar">
                                <div class="bp-search"><i class="fas fa-search"></i><input id="bp-billing-search" type="text" placeholder="Search document, branch, month..."></div>
                                <select id="bp-billing-type" class="bp-input">
                                    <option value="">All types</option>
                                    <option value="invoice">Invoices</option>
                                    <option value="receipt">Receipts</option>
                                </select>
                            </div>
                            <div class="bp-table-wrap">
                                <table class="bp-table">
                                    <thead><tr><th>Document</th><th>Branch</th><th>Month</th><th>Amount</th><th>Status</th><th>Issued</th><th></th></tr></thead>
                                    <tbody id="bp-billing-body"><tr><td colspan="7" class="bp-empty"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr></tbody>
                                </table>
                            </div>
                        </section>
                    </div>
                </div>
            `;
            if (admin) document.getElementById('bp-billing-form')?.addEventListener('submit', e => this.createFinanceDoc(e));
            document.getElementById('bp-billing-search')?.addEventListener('input', () => this.renderBillingRows());
            document.getElementById('bp-billing-type')?.addEventListener('change', () => this.renderBillingRows());
            document.getElementById('bp-refresh-billing')?.addEventListener('click', () => this.renderBilling(container));
            this.subscribeBilling();
        },

        billingFormHtml: function () {
            const currentMonth = MONTHS[new Date().getMonth()] + ' ' + new Date().getFullYear();
            return `
                <form class="bp-card bp-form-card" id="bp-billing-form">
                    <div class="bp-card-head">
                        <div>
                            <h3>Create Billing Document</h3>
                            <small>Invoice or receipt for one branch</small>
                        </div>
                        <span class="bp-pill">Superadmin</span>
                    </div>
                    <div class="bp-form-grid">
                        <label>Branch<select id="bp-bill-business" class="bp-input" required><option value="">Select branch</option>${this.businessOptions('')}</select></label>
                        <label>Type<select id="bp-bill-type" class="bp-input" required><option value="invoice">Invoice</option><option value="receipt">Receipt</option></select></label>
                        <label>Billing Month<input id="bp-bill-month" class="bp-input" value="${this.escapeHtml(currentMonth)}" required></label>
                        <label>Amount<input id="bp-bill-amount" class="bp-input" type="number" min="0" step="0.01" placeholder="0.00" required></label>
                        <label>Currency<input id="bp-bill-currency" class="bp-input" value="KES" maxlength="5" required></label>
                        <label>Due Date<input id="bp-bill-due" class="bp-input" type="date"></label>
                        <label class="bp-field-full">Note<textarea id="bp-bill-note" class="bp-input" rows="4" placeholder="Optional payment note"></textarea></label>
                    </div>
                    <div class="bp-actions">
                        <button class="btn btn-primary" type="submit"><i class="fas fa-paper-plane"></i> Issue Document</button>
                        <button class="btn btn-outline" type="reset"><i class="fas fa-rotate-left"></i> Reset</button>
                    </div>
                </form>
            `;
        },

        subscribeBilling: function () {
            if (activeListener) activeListener();
            let ref = window.db.collection('branch_finance_docs');
            if (!this.isSuperAdmin()) {
                const businessId = this.getBusinessId();
                if (!businessId) return this.showBillingError('No branch is assigned to this user.');
                ref = ref.where('businessId', '==', businessId);
            }
            activeListener = ref.onSnapshot(snap => {
                financeDocs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                financeDocs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
                this.renderBillingRows();
            }, err => this.showBillingError(err.message || 'Failed to load billing documents.'));
        },

        showBillingError: function (message) {
            const body = document.getElementById('bp-billing-body');
            if (body) body.innerHTML = '<tr><td colspan="7" class="bp-empty bp-empty--error"><i class="fas fa-triangle-exclamation"></i> ' + this.escapeHtml(message) + '</td></tr>';
        },

        renderBillingRows: function () {
            const body = document.getElementById('bp-billing-body');
            if (!body) return;
            const q = (document.getElementById('bp-billing-search')?.value || '').toLowerCase();
            const type = document.getElementById('bp-billing-type')?.value || '';
            let rows = financeDocs.slice();
            if (type) rows = rows.filter(doc => doc.type === type);
            if (q) rows = rows.filter(doc => [doc.docNumber, doc.businessName, doc.billingMonth, doc.status, doc.note].join(' ').toLowerCase().includes(q));
            if (!rows.length) {
                body.innerHTML = '<tr><td colspan="7" class="bp-empty"><i class="fas fa-folder-open"></i> No documents found</td></tr>';
                return;
            }
            body.innerHTML = rows.map(doc => `
                <tr>
                    <td><strong>${this.escapeHtml(doc.docNumber)}</strong><br><span class="bp-muted">${this.escapeHtml((doc.type || '').toUpperCase())}</span></td>
                    <td>${this.escapeHtml(doc.businessName || this.branchName(doc.businessId))}</td>
                    <td>${this.escapeHtml(doc.billingMonth || '')}</td>
                    <td>${this.money(doc.amount, doc.currency)}</td>
                    <td><span class="bp-status bp-status--${doc.status === 'paid' ? 'ok' : 'warn'}">${this.escapeHtml(doc.status || 'issued')}</span></td>
                    <td>${this.formatDate(doc.createdAt)}</td>
                    <td><button class="btn btn-sm btn-outline" data-bp-download="${this.escapeHtml(doc.id)}"><i class="fas fa-download"></i> PDF</button></td>
                </tr>
            `).join('');
            body.querySelectorAll('[data-bp-download]').forEach(btn => {
                btn.addEventListener('click', () => this.downloadFinancePdf(btn.dataset.bpDownload));
            });
        },

        createFinanceDoc: async function (e) {
            e.preventDefault();
            const businessId = document.getElementById('bp-bill-business')?.value;
            const businessName = this.branchName(businessId);
            const type = document.getElementById('bp-bill-type')?.value || 'invoice';
            const amount = Number(document.getElementById('bp-bill-amount')?.value || 0);
            if (!businessId || !amount) return this.showToast('Select a branch and enter an amount.', 'error');
            const data = {
                businessId,
                businessName,
                type,
                docNumber: this.makeDocNumber(type),
                billingMonth: (document.getElementById('bp-bill-month')?.value || '').trim(),
                amount,
                currency: (document.getElementById('bp-bill-currency')?.value || 'KES').trim().toUpperCase(),
                dueDate: document.getElementById('bp-bill-due')?.value || '',
                note: (document.getElementById('bp-bill-note')?.value || '').trim(),
                status: type === 'receipt' ? 'paid' : 'issued',
                createdBy: this.getUserName(),
                createdAt: this.nowIso(),
                updatedAt: this.nowIso()
            };
            await window.db.collection('branch_finance_docs').add(data);
            this.showToast((type === 'receipt' ? 'Receipt' : 'Invoice') + ' issued to ' + businessName + '.');
            e.target.reset();
        },

        downloadFinancePdf: function (id) {
            const doc = financeDocs.find(item => item.id === id);
            if (!doc) return this.showToast('Document not found.', 'error');
            const html = this.buildFinanceDocumentHtml(doc);
            const win = window.open('', '_blank', 'width=980,height=760');
            if (!win) {
                this.showToast('Allow popups to open the invoice preview.', 'error');
                return;
            }
            win.document.open();
            win.document.write(html);
            win.document.close();
            win.focus();
        },

        buildFinanceDocumentHtml: function (doc) {
            const title = doc.type === 'receipt' ? 'RECEIPT' : 'INVOICE';
            const status = doc.status || (doc.type === 'receipt' ? 'paid' : 'issued');
            const isPaid = status === 'paid' || doc.type === 'receipt';
            const branch = doc.businessName || this.branchName(doc.businessId);
            const amount = this.money(doc.amount, doc.currency);
            const docNumber = doc.docNumber || doc.id || 'PF-DOC';
            const issued = this.formatDate(doc.createdAt);
            const due = doc.dueDate ? this.formatDate(doc.dueDate) : 'On receipt';
            const note = doc.note || 'This document only covers the monthly PharmaFlow system payment.';
            const statusClass = isPaid ? 'paid' : (status === 'overdue' ? 'overdue' : 'issued');
            const escapedTitle = this.escapeHtml(title);

            return `<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${this.escapeHtml(docNumber)} - ${escapedTitle}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0;
            background: #eef2f7;
            color: #172033;
            font-family: 'Montserrat', Arial, sans-serif;
            line-height: 1.45;
        }
        .toolbar {
            position: sticky;
            top: 0;
            z-index: 5;
            display: flex;
            justify-content: center;
            gap: 10px;
            padding: 14px;
            background: rgba(238, 242, 247, .92);
            backdrop-filter: blur(8px);
            border-bottom: 1px solid #d8e0ea;
        }
        .toolbar button {
            border: 0;
            border-radius: 7px;
            padding: 10px 16px;
            font: 700 13px 'Montserrat', Arial, sans-serif;
            cursor: pointer;
        }
        .toolbar .primary { background: #1f3a5f; color: #fff; }
        .toolbar .ghost { background: #fff; color: #1f3a5f; border: 1px solid #cdd6e2; }
        .sheet {
            width: min(860px, calc(100vw - 28px));
            margin: 24px auto 40px;
            background: #fff;
            border-radius: 14px;
            box-shadow: 0 18px 45px rgba(23, 32, 51, .15);
            overflow: hidden;
        }
        .brand-strip {
            height: 12px;
            background: linear-gradient(90deg, #1f3a5f 0%, #2f6f73 55%, #c99a3d 100%);
        }
        .header {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 28px;
            padding: 42px 46px 28px;
            border-bottom: 1px solid #e5eaf1;
        }
        .logo-mark {
            width: 48px;
            height: 48px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            background: #1f3a5f;
            color: #fff;
            font-weight: 800;
            font-size: 20px;
            margin-bottom: 14px;
        }
        .brand h1 {
            margin: 0;
            font-size: 24px;
            letter-spacing: 0;
            color: #172033;
        }
        .brand p {
            margin: 5px 0 0;
            color: #64748b;
            font-size: 12px;
            font-weight: 500;
        }
        .doc-title {
            min-width: 230px;
            text-align: right;
        }
        .doc-title h2 {
            margin: 0;
            color: #1f3a5f;
            font-size: 34px;
            letter-spacing: 0;
            font-weight: 800;
        }
        .doc-title code {
            display: inline-block;
            margin-top: 8px;
            padding: 6px 10px;
            border-radius: 999px;
            background: #f1f5f9;
            color: #334155;
            font-family: 'Montserrat', Arial, sans-serif;
            font-size: 11px;
            font-weight: 700;
        }
        .status {
            display: inline-block;
            margin-top: 12px;
            padding: 7px 12px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
        }
        .status.paid { background: #dcfce7; color: #166534; }
        .status.issued { background: #dbeafe; color: #1d4ed8; }
        .status.overdue { background: #fee2e2; color: #b91c1c; }
        .content { padding: 32px 46px 42px; }
        .meta-grid {
            display: grid;
            grid-template-columns: 1.1fr .9fr;
            gap: 24px;
            margin-bottom: 28px;
        }
        .panel {
            border: 1px solid #e5eaf1;
            border-radius: 12px;
            padding: 18px;
            background: #fbfdff;
        }
        .panel .label {
            display: block;
            margin-bottom: 8px;
            color: #64748b;
            font-size: 10px;
            font-weight: 800;
            text-transform: uppercase;
        }
        .panel strong {
            color: #172033;
            font-size: 16px;
        }
        .facts {
            display: grid;
            gap: 10px;
        }
        .fact {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            font-size: 12px;
        }
        .fact span:first-child { color: #64748b; font-weight: 600; }
        .fact span:last-child { color: #172033; font-weight: 700; text-align: right; }
        table {
            width: 100%;
            border-collapse: collapse;
            overflow: hidden;
            border-radius: 12px;
            border: 1px solid #e5eaf1;
        }
        th {
            background: #1f3a5f;
            color: #fff;
            padding: 14px 16px;
            text-align: left;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0;
        }
        th:last-child, td:last-child { text-align: right; }
        td {
            padding: 18px 16px;
            border-bottom: 1px solid #e5eaf1;
            color: #334155;
            font-size: 13px;
            vertical-align: top;
        }
        td strong { color: #172033; }
        .line-note { display: block; margin-top: 4px; color: #64748b; font-size: 11px; }
        .totals {
            width: min(360px, 100%);
            margin-left: auto;
            margin-top: 22px;
            border: 1px solid #e5eaf1;
            border-radius: 12px;
            overflow: hidden;
        }
        .total-row {
            display: flex;
            justify-content: space-between;
            padding: 13px 16px;
            color: #334155;
            font-size: 13px;
            border-bottom: 1px solid #e5eaf1;
        }
        .total-row:last-child {
            border-bottom: 0;
            background: #172033;
            color: #fff;
            font-size: 16px;
            font-weight: 800;
        }
        .note {
            margin-top: 28px;
            padding: 16px 18px;
            border-left: 4px solid #c99a3d;
            border-radius: 10px;
            background: #fffbeb;
            color: #66512a;
            font-size: 12px;
        }
        .footer {
            display: flex;
            justify-content: space-between;
            gap: 20px;
            margin-top: 34px;
            padding-top: 18px;
            border-top: 1px solid #e5eaf1;
            color: #64748b;
            font-size: 11px;
        }
        @media print {
            body { background: #fff; }
            .toolbar { display: none; }
            .sheet {
                width: 100%;
                margin: 0;
                border-radius: 0;
                box-shadow: none;
            }
            @page { size: A4; margin: 12mm; }
        }
        @media (max-width: 680px) {
            .header, .meta-grid, .footer { grid-template-columns: 1fr; }
            .header { display: block; padding: 30px 24px 20px; }
            .doc-title { text-align: left; margin-top: 22px; }
            .content { padding: 24px; }
            .meta-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button class="primary" onclick="window.print()">Print / Save PDF</button>
        <button class="ghost" onclick="window.close()">Close</button>
    </div>
    <main class="sheet">
        <div class="brand-strip"></div>
        <section class="header">
            <div class="brand">
                <div class="logo-mark">PF</div>
                <h1>PharmaFlow</h1>
                <p>Multibranch Pharmacy Management System</p>
            </div>
            <div class="doc-title">
                <h2>${escapedTitle}</h2>
                <code>${this.escapeHtml(docNumber)}</code><br>
                <span class="status ${this.escapeHtml(statusClass)}">${this.escapeHtml(status)}</span>
            </div>
        </section>
        <section class="content">
            <div class="meta-grid">
                <div class="panel">
                    <span class="label">Bill To</span>
                    <strong>${this.escapeHtml(branch)}</strong>
                    <p style="margin:8px 0 0;color:#64748b;font-size:12px;">Branch system subscription account</p>
                </div>
                <div class="panel facts">
                    <div class="fact"><span>Issued</span><span>${this.escapeHtml(issued)}</span></div>
                    <div class="fact"><span>Due Date</span><span>${this.escapeHtml(due)}</span></div>
                    <div class="fact"><span>Billing Period</span><span>${this.escapeHtml(doc.billingMonth || 'System subscription')}</span></div>
                    <div class="fact"><span>Currency</span><span>${this.escapeHtml(doc.currency || 'KES')}</span></div>
                </div>
            </div>
            <table>
                <thead>
                    <tr><th>Description</th><th>Period</th><th>Amount</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <td><strong>PharmaFlow system subscription</strong><span class="line-note">Monthly platform access, branch operations, realtime sync, and support.</span></td>
                        <td>${this.escapeHtml(doc.billingMonth || 'Current billing cycle')}</td>
                        <td>${this.escapeHtml(amount)}</td>
                    </tr>
                </tbody>
            </table>
            <div class="totals">
                <div class="total-row"><span>Subtotal</span><strong>${this.escapeHtml(amount)}</strong></div>
                <div class="total-row"><span>Tax</span><strong>Included</strong></div>
                <div class="total-row"><span>Total</span><span>${this.escapeHtml(amount)}</span></div>
            </div>
            <div class="note">${this.escapeHtml(note)}</div>
            <div class="footer">
                <span>Generated by PharmaFlow</span>
                <span>${this.escapeHtml(title)} for system subscription billing only</span>
            </div>
        </section>
    </main>
</body>
</html>`;
        },

        renderCommunications: async function (container) {
            this.cleanup();
            await this.loadBusinesses();
            const admin = this.isSuperAdmin();
            container.innerHTML = `
                <div class="bp-module">
                    ${this.headerHtml('Communications', 'fas fa-comments', 'Real-time branch messages')}
                    <div class="bp-grid ${admin ? '' : 'bp-grid--single'}">
                        ${admin ? this.communicationFormHtml() : ''}
                        <section class="bp-card">
                            <div class="bp-card-head"><div><h3>${admin ? 'Message Stream' : 'Branch Messages'}</h3><small>Live updates</small></div></div>
                            <div class="bp-thread" id="bp-communication-thread"><div class="bp-empty"><i class="fas fa-spinner fa-spin"></i> Loading...</div></div>
                            <form class="bp-reply" id="bp-reply-form">
                                ${admin ? `<select id="bp-reply-business" class="bp-input" required><option value="">Reply to branch</option>${this.businessOptions('')}</select>` : ''}
                                <input id="bp-reply-text" class="bp-input" placeholder="Type a reply or update..." required>
                                <button class="btn btn-primary" type="submit"><i class="fas fa-paper-plane"></i></button>
                            </form>
                        </section>
                    </div>
                </div>
            `;
            if (admin) document.getElementById('bp-comms-form')?.addEventListener('submit', e => this.createCommunication(e));
            document.getElementById('bp-reply-form')?.addEventListener('submit', e => this.createQuickCommunication(e));
            this.subscribeCommunications();
        },

        communicationFormHtml: function () {
            return `
                <form class="bp-card bp-form-card" id="bp-comms-form">
                    <div class="bp-card-head"><div><h3>Send To Branch</h3><small>Appears instantly in branch portal</small></div><span class="bp-pill">Live</span></div>
                    <div class="bp-form-grid">
                        <label>Branch<select id="bp-comms-business" class="bp-input" required><option value="">Select branch</option>${this.businessOptions('')}</select></label>
                        <label>Priority<select id="bp-comms-priority" class="bp-input"><option>Normal</option><option>Important</option><option>Urgent</option></select></label>
                        <label class="bp-field-full">Subject<input id="bp-comms-subject" class="bp-input" placeholder="Message subject" required></label>
                        <label class="bp-field-full">Message<textarea id="bp-comms-message" class="bp-input" rows="6" required></textarea></label>
                    </div>
                    <div class="bp-actions"><button class="btn btn-primary" type="submit"><i class="fas fa-paper-plane"></i> Send Message</button></div>
                </form>
            `;
        },

        subscribeCommunications: function () {
            if (activeListener) activeListener();
            let ref = window.db.collection('branch_communications');
            if (!this.isSuperAdmin()) {
                const businessId = this.getBusinessId();
                if (!businessId) return this.showThreadError('No branch is assigned to this user.');
                ref = ref.where('businessId', '==', businessId);
            }
            activeListener = ref.onSnapshot(snap => {
                communications = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                communications.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
                this.renderCommunicationThread();
            }, err => this.showThreadError(err.message || 'Failed to load communications.'));
        },

        showThreadError: function (message) {
            const thread = document.getElementById('bp-communication-thread');
            if (thread) thread.innerHTML = '<div class="bp-empty bp-empty--error"><i class="fas fa-triangle-exclamation"></i> ' + this.escapeHtml(message) + '</div>';
        },

        renderCommunicationThread: function () {
            const thread = document.getElementById('bp-communication-thread');
            if (!thread) return;
            if (!communications.length) {
                thread.innerHTML = '<div class="bp-empty"><i class="fas fa-comments"></i> No messages yet</div>';
                return;
            }
            thread.innerHTML = communications.map(msg => `
                <article class="bp-message ${msg.senderRole === 'superadmin' ? 'bp-message--admin' : ''}">
                    <div class="bp-message-top">
                        <strong>${this.escapeHtml(msg.subject || 'Update')}</strong>
                        <span class="bp-status bp-status--${msg.priority === 'Urgent' ? 'danger' : msg.priority === 'Important' ? 'warn' : 'ok'}">${this.escapeHtml(msg.priority || 'Normal')}</span>
                    </div>
                    <p>${this.escapeHtml(msg.message || '')}</p>
                    <div class="bp-message-meta">
                        <span>${this.escapeHtml(msg.businessName || this.branchName(msg.businessId))}</span>
                        <span>${this.escapeHtml(msg.senderName || 'User')}</span>
                        <span>${this.formatDate(msg.createdAt)}</span>
                    </div>
                </article>
            `).join('');
        },

        createCommunication: async function (e) {
            e.preventDefault();
            const businessId = document.getElementById('bp-comms-business')?.value;
            if (!businessId) return this.showToast('Select a branch.', 'error');
            await window.db.collection('branch_communications').add({
                businessId,
                businessName: this.branchName(businessId),
                subject: (document.getElementById('bp-comms-subject')?.value || '').trim(),
                message: (document.getElementById('bp-comms-message')?.value || '').trim(),
                priority: document.getElementById('bp-comms-priority')?.value || 'Normal',
                senderRole: 'superadmin',
                senderName: this.getUserName(),
                createdAt: this.nowIso()
            });
            this.showToast('Message sent.');
            e.target.reset();
        },

        createQuickCommunication: async function (e) {
            e.preventDefault();
            const text = (document.getElementById('bp-reply-text')?.value || '').trim();
            if (!text) return;
            let businessId = this.getBusinessId();
            if (this.isSuperAdmin()) {
                businessId = document.getElementById('bp-reply-business')?.value || '';
            }
            if (!businessId) return this.showToast('Select a branch for the reply.', 'error');
            await window.db.collection('branch_communications').add({
                businessId,
                businessName: this.branchName(businessId),
                subject: this.isSuperAdmin() ? 'Admin reply' : 'Branch reply',
                message: text,
                priority: 'Normal',
                senderRole: this.isSuperAdmin() ? 'superadmin' : 'branch',
                senderName: this.getUserName(),
                createdAt: this.nowIso()
            });
            e.target.reset();
        },

        renderContracts: async function (container) {
            this.cleanup();
            await this.loadBusinesses();
            const admin = this.isSuperAdmin();
            container.innerHTML = `
                <div class="bp-module">
                    ${this.headerHtml('Contracts', 'fas fa-file-signature', 'Upload, sign, and exchange agreements')}
                    <div class="bp-grid ${admin ? '' : 'bp-grid--single'}">
                        ${admin ? this.contractFormHtml() : ''}
                        <section class="bp-card">
                            <div class="bp-card-head"><div><h3>${admin ? 'Contract Register' : 'My Contracts'}</h3><small>Download, upload signed copy, or digitally sign</small></div></div>
                            <div class="bp-table-wrap">
                                <table class="bp-table">
                                    <thead><tr><th>Contract</th><th>Branch</th><th>Status</th><th>Uploaded</th><th>Actions</th></tr></thead>
                                    <tbody id="bp-contract-body"><tr><td colspan="5" class="bp-empty"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr></tbody>
                                </table>
                            </div>
                        </section>
                    </div>
                    <div id="bp-sign-modal" class="bp-modal" aria-hidden="true"></div>
                </div>
            `;
            if (admin) document.getElementById('bp-contract-form')?.addEventListener('submit', e => this.createContract(e));
            this.subscribeContracts();
        },

        contractFormHtml: function () {
            return `
                <form class="bp-card bp-form-card" id="bp-contract-form">
                    <div class="bp-card-head"><div><h3>Upload Contract</h3><small>Send document to a branch</small></div><span class="bp-pill">PDF/DOC</span></div>
                    <div class="bp-form-grid">
                        <label>Branch<select id="bp-contract-business" class="bp-input" required><option value="">Select branch</option>${this.businessOptions('')}</select></label>
                        <label>Contract Title<input id="bp-contract-title" class="bp-input" placeholder="Service Agreement" required></label>
                        <label class="bp-field-full">Contract File<input id="bp-contract-file" class="bp-input" type="file" accept=".pdf,.doc,.docx,image/*" required></label>
                        <label class="bp-field-full">Note<textarea id="bp-contract-note" class="bp-input" rows="4" placeholder="Signing instructions"></textarea></label>
                    </div>
                    <div class="bp-actions"><button class="btn btn-primary" type="submit"><i class="fas fa-upload"></i> Upload Contract</button></div>
                </form>
            `;
        },

        subscribeContracts: function () {
            if (activeListener) activeListener();
            let ref = window.db.collection('branch_contracts');
            if (!this.isSuperAdmin()) {
                const businessId = this.getBusinessId();
                if (!businessId) return this.showContractsError('No branch is assigned to this user.');
                ref = ref.where('businessId', '==', businessId);
            }
            activeListener = ref.onSnapshot(snap => {
                contracts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                contracts.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
                this.renderContractRows();
            }, err => this.showContractsError(err.message || 'Failed to load contracts.'));
        },

        showContractsError: function (message) {
            const body = document.getElementById('bp-contract-body');
            if (body) body.innerHTML = '<tr><td colspan="5" class="bp-empty bp-empty--error"><i class="fas fa-triangle-exclamation"></i> ' + this.escapeHtml(message) + '</td></tr>';
        },

        renderContractRows: function () {
            const body = document.getElementById('bp-contract-body');
            if (!body) return;
            if (!contracts.length) {
                body.innerHTML = '<tr><td colspan="5" class="bp-empty"><i class="fas fa-file-contract"></i> No contracts found</td></tr>';
                return;
            }
            body.innerHTML = contracts.map(contract => `
                <tr>
                    <td><strong>${this.escapeHtml(contract.title)}</strong><br><span class="bp-muted">${this.escapeHtml(contract.note || '')}</span></td>
                    <td>${this.escapeHtml(contract.businessName || this.branchName(contract.businessId))}</td>
                    <td><span class="bp-status bp-status--${contract.status === 'signed' ? 'ok' : 'warn'}">${this.escapeHtml(contract.status || 'pending')}</span></td>
                    <td>${this.formatDate(contract.createdAt)}</td>
                    <td class="bp-row-actions">
                        <a class="btn btn-sm btn-outline" href="${this.escapeHtml(contract.fileUrl || '#')}" target="_blank" rel="noopener"><i class="fas fa-download"></i> Original</a>
                        ${contract.signedFileUrl ? `<a class="btn btn-sm btn-outline" href="${this.escapeHtml(contract.signedFileUrl)}" target="_blank" rel="noopener"><i class="fas fa-file-circle-check"></i> Signed</a>` : ''}
                        ${!this.isSuperAdmin() ? `<label class="btn btn-sm btn-outline bp-upload-inline"><i class="fas fa-upload"></i> Upload<input type="file" data-bp-signed-upload="${this.escapeHtml(contract.id)}" accept=".pdf,.doc,.docx,image/*"></label><button class="btn btn-sm btn-primary" data-bp-sign="${this.escapeHtml(contract.id)}"><i class="fas fa-signature"></i> Sign</button>` : ''}
                    </td>
                </tr>
            `).join('');
            body.querySelectorAll('[data-bp-signed-upload]').forEach(input => {
                input.addEventListener('change', () => this.uploadSignedContract(input.dataset.bpSignedUpload, input.files[0]));
            });
            body.querySelectorAll('[data-bp-sign]').forEach(btn => {
                btn.addEventListener('click', () => this.openSignModal(btn.dataset.bpSign));
            });
        },

        uploadFile: async function (file, businessId, folder) {
            if (!file) throw new Error('No file selected.');
            const safeName = Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            if (PharmaFlow.CloudinaryUpload && PharmaFlow.CloudinaryUpload.isActive()) {
                const publicId = safeName.replace(/\.[^/.]+$/, '');
                return PharmaFlow.CloudinaryUpload.uploadFile(file, {
                    folder: 'pharmaflow/' + folder + '/' + businessId,
                    publicId: publicId
                });
            }
            const ref = window.storage.ref('businesses/' + businessId + '/' + folder + '/' + safeName);
            const snap = await ref.put(file);
            return snap.ref.getDownloadURL();
        },

        createContract: async function (e) {
            e.preventDefault();
            const businessId = document.getElementById('bp-contract-business')?.value;
            const file = document.getElementById('bp-contract-file')?.files[0];
            if (!businessId || !file) return this.showToast('Select a branch and contract file.', 'error');
            const btn = e.target.querySelector('button[type="submit"]');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...'; }
            try {
                const fileUrl = await this.uploadFile(file, businessId, 'contracts');
                await window.db.collection('branch_contracts').add({
                    businessId,
                    businessName: this.branchName(businessId),
                    title: (document.getElementById('bp-contract-title')?.value || '').trim(),
                    note: (document.getElementById('bp-contract-note')?.value || '').trim(),
                    fileUrl,
                    fileName: file.name,
                    status: 'pending',
                    createdBy: this.getUserName(),
                    createdAt: this.nowIso(),
                    updatedAt: this.nowIso()
                });
                this.showToast('Contract uploaded.');
                e.target.reset();
            } catch (err) {
                this.showToast('Upload failed: ' + err.message, 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> Upload Contract'; }
            }
        },

        uploadSignedContract: async function (id, file) {
            const contract = contracts.find(item => item.id === id);
            if (!contract || !file) return;
            try {
                const signedFileUrl = await this.uploadFile(file, contract.businessId, 'signed_contracts');
                await window.db.collection('branch_contracts').doc(id).update({
                    signedFileUrl,
                    signedFileName: file.name,
                    signedBy: this.getUserName(),
                    signedAt: this.nowIso(),
                    status: 'signed',
                    updatedAt: this.nowIso()
                });
                this.showToast('Signed contract uploaded.');
            } catch (err) {
                this.showToast('Signed upload failed: ' + err.message, 'error');
            }
        },

        openSignModal: function (id) {
            const contract = contracts.find(item => item.id === id);
            if (!contract) return;
            const modal = document.getElementById('bp-sign-modal');
            modal.innerHTML = `
                <div class="bp-modal-panel">
                    <div class="bp-card-head">
                        <div><h3>Digital Signature</h3><small>${this.escapeHtml(contract.title)}</small></div>
                        <button class="btn btn-sm btn-outline" id="bp-sign-close"><i class="fas fa-times"></i></button>
                    </div>
                    <canvas id="bp-sign-canvas" width="720" height="220"></canvas>
                    <div class="bp-actions">
                        <button class="btn btn-outline" id="bp-sign-clear"><i class="fas fa-eraser"></i> Clear</button>
                        <button class="btn btn-primary" id="bp-sign-save"><i class="fas fa-check"></i> Save Signature</button>
                    </div>
                </div>
            `;
            modal.classList.add('show');
            modal.setAttribute('aria-hidden', 'false');
            document.getElementById('bp-sign-close')?.addEventListener('click', () => this.closeSignModal());
            document.getElementById('bp-sign-clear')?.addEventListener('click', () => this.clearSignature());
            document.getElementById('bp-sign-save')?.addEventListener('click', () => this.saveSignature(id));
            this.bindSignaturePad();
        },

        closeSignModal: function () {
            const modal = document.getElementById('bp-sign-modal');
            if (modal) {
                modal.classList.remove('show');
                modal.setAttribute('aria-hidden', 'true');
                modal.innerHTML = '';
            }
        },

        bindSignaturePad: function () {
            const canvas = document.getElementById('bp-sign-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.strokeStyle = '#111827';
            signingPad = { canvas, drawing: false, hasInk: false };
            const pos = e => {
                const rect = canvas.getBoundingClientRect();
                const p = e.touches ? e.touches[0] : e;
                return { x: (p.clientX - rect.left) * (canvas.width / rect.width), y: (p.clientY - rect.top) * (canvas.height / rect.height) };
            };
            const start = e => { e.preventDefault(); signingPad.drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
            const move = e => { if (!signingPad.drawing) return; e.preventDefault(); const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); signingPad.hasInk = true; };
            const end = () => { signingPad.drawing = false; };
            canvas.addEventListener('mousedown', start);
            canvas.addEventListener('mousemove', move);
            window.addEventListener('mouseup', end, { once: false });
            canvas.addEventListener('touchstart', start, { passive: false });
            canvas.addEventListener('touchmove', move, { passive: false });
            canvas.addEventListener('touchend', end);
        },

        clearSignature: function () {
            if (!signingPad) return;
            signingPad.canvas.getContext('2d').clearRect(0, 0, signingPad.canvas.width, signingPad.canvas.height);
            signingPad.hasInk = false;
        },

        saveSignature: async function (id) {
            if (!signingPad || !signingPad.hasInk) return this.showToast('Please sign inside the box first.', 'error');
            await window.db.collection('branch_contracts').doc(id).update({
                signatureDataUrl: signingPad.canvas.toDataURL('image/png'),
                signedBy: this.getUserName(),
                signedAt: this.nowIso(),
                status: 'signed',
                updatedAt: this.nowIso()
            });
            this.closeSignModal();
            this.showToast('Digital signature saved.');
        },

        headerHtml: function (title, icon, subtitle) {
            return `
                <div class="page-header">
                    <div>
                        <h2><i class="${icon}"></i> ${this.escapeHtml(title)}</h2>
                        <div class="breadcrumb"><a href="#" data-nav="dashboard">Home</a><span>/</span><span>Branch Portal</span><span>/</span><span>${this.escapeHtml(title)}</span></div>
                        <p class="bp-subtitle">${this.escapeHtml(subtitle)}</p>
                    </div>
                </div>
            `;
        }
    };

    window.PharmaFlow.BranchPortal = BranchPortal;
})();
