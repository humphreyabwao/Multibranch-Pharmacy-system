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
    let certificates = [];
    let businesses = [];
    let signingPad = null;
    let editingContractId = null;

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const CONTRACT_PAGE_LIMIT = 60;
    const BranchPortal = {
        cleanup: function () {
            if (activeListener) {
                activeListener();
                activeListener = null;
            }
            financeDocs = [];
            communications = [];
            contracts = [];
            certificates = [];
            signingPad = null;
            editingContractId = null;
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
            if (PharmaFlow.Settings && PharmaFlow.Settings.formatCurrency) return PharmaFlow.Settings.formatCurrency(amount);
            const n = Number(amount || 0);
            return (currency || 'KES') + ' ' + n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },

        formatDate: function (value) {
            if (PharmaFlow.Settings && PharmaFlow.Settings.formatDate) return PharmaFlow.Settings.formatDate(value);
            if (!value) return 'Not set';
            const d = value.toDate ? value.toDate() : (value.seconds ? new Date(value.seconds * 1000) : new Date(value));
            if (isNaN(d.getTime())) return 'Not set';
            return d.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
        },

        nowIso: function () {
            return new Date().toISOString();
        },

        isPdfFile: function (url, name) {
            const source = ((name || '') + ' ' + (url || '')).toLowerCase();
            return source.includes('.pdf') || source.includes('/pdf') || source.includes('application/pdf');
        },

        isImageFile: function (url, name) {
            const source = ((name || '') + ' ' + (url || '')).toLowerCase().split('?')[0];
            return /\.(png|jpe?g|gif|webp|bmp)$/i.test(source);
        },

        isAllowedContractFile: function (file) {
            if (!file) return false;
            const name = String(file.name || '').toLowerCase();
            const type = String(file.type || '').toLowerCase();
            const isPdf = type === 'application/pdf' || /\.pdf$/i.test(name);
            const isImage = /^(image\/(png|jpe?g|webp|gif|bmp))$/i.test(type)
                || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name);
            return isPdf || isImage;
        },

        isAllowedCertificateImage: function (file) {
            if (!file) return false;
            const name = String(file.name || '').toLowerCase();
            const type = String(file.type || '').toLowerCase();
            return /^(image\/(png|jpe?g|webp))$/i.test(type)
                || /\.(png|jpe?g|webp)$/i.test(name);
        },

        contractFileType: function (file) {
            if (!file) return '';
            return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '') ? 'pdf' : 'image';
        },

        isCloudinaryUrl: function (url) {
            return typeof url === 'string' && url.indexOf('res.cloudinary.com/') !== -1;
        },

        cloudinaryPdfPageUrl: function (url, page) {
            if (!this.isCloudinaryUrl(url) || !this.isPdfFile(url)) return '';
            const pageNo = page || 1;
            if (url.indexOf('/image/upload/') !== -1) {
                return url.replace('/image/upload/', '/image/upload/pg_' + pageNo + ',f_png,q_auto/');
            }
            if (url.indexOf('/raw/upload/') !== -1) {
                return url.replace('/raw/upload/', '/image/upload/pg_' + pageNo + ',f_png,q_auto/');
            }
            return '';
        },

        displayUrl: function (url, name) {
            if (!url) return '#';
            return url;
        },

        isBlockedRawPdf: function (url, name) {
            return this.isCloudinaryUrl(url) && this.isPdfFile(url, name) && url.indexOf('/raw/upload/') !== -1;
        },

        openActionHtml: function (url, name, label, id, type) {
            if (!url) return '';
            if (this.isBlockedRawPdf(url, name)) {
                return '<button class="btn btn-sm btn-outline" type="button" disabled title="Re-upload this PDF with Update to enable preview"><i class="fas fa-lock"></i> Re-upload to Preview</button>';
            }
            if (this.isCloudinaryUrl(url) && this.isPdfFile(url, name) && url.indexOf('/image/upload/') !== -1) {
                return '<button class="btn btn-sm btn-outline" data-bp-preview="' + this.escapeHtml(id || '') + '" data-bp-preview-type="' + this.escapeHtml(type || 'original') + '" data-bp-preview-mode="full"><i class="fas fa-file-lines"></i> ' + this.escapeHtml(label || 'Open') + '</button>';
            }
            return '<a class="btn btn-sm btn-outline" href="' + this.escapeHtml(this.displayUrl(url, name)) + '" target="_blank" rel="noopener"><i class="fas fa-up-right-from-square"></i> ' + this.escapeHtml(label || 'Open') + '</a>';
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
                    <div id="bp-contract-modal" class="bp-modal" aria-hidden="true"></div>
                    <div id="bp-sign-modal" class="bp-modal" aria-hidden="true"></div>
                </div>
            `;
            if (admin) {
                document.getElementById('bp-contract-form')?.addEventListener('submit', e => this.saveContract(e));
                document.getElementById('bp-contract-cancel')?.addEventListener('click', () => this.resetContractForm());
            }
            this.subscribeContracts();
        },

        contractFormHtml: function () {
            return `
                <form class="bp-card bp-form-card" id="bp-contract-form">
                    <div class="bp-card-head"><div><h3 id="bp-contract-form-title">Upload Contract</h3><small id="bp-contract-form-subtitle">Send a PDF or image to a branch</small></div><span class="bp-pill">PDF / IMAGE</span></div>
                    <div class="bp-form-grid">
                        <label>Branch<select id="bp-contract-business" class="bp-input" required><option value="">Select branch</option>${this.businessOptions('')}</select></label>
                        <label>Contract Title<input id="bp-contract-title" class="bp-input" placeholder="Service Agreement" required></label>
                        <label class="bp-field-full">Contract File<input id="bp-contract-file" class="bp-input" type="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp" required><small id="bp-contract-file-help">PDF, PNG, JPG, WEBP, GIF, or BMP only. Documents open directly in the portal.</small></label>
                        <label class="bp-field-full">Note<textarea id="bp-contract-note" class="bp-input" rows="4" placeholder="Signing instructions"></textarea></label>
                    </div>
                    <div class="bp-actions">
                        <button class="btn btn-outline" type="button" id="bp-contract-cancel" style="display:none"><i class="fas fa-times"></i> Cancel Edit</button>
                        <button class="btn btn-primary" type="submit" id="bp-contract-submit"><i class="fas fa-upload"></i> Upload Contract</button>
                    </div>
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
                        <button class="btn btn-sm btn-outline" data-bp-preview="${this.escapeHtml(contract.id)}" data-bp-preview-type="original"><i class="fas fa-eye"></i> Preview</button>
                        ${this.openActionHtml(contract.fileUrl, contract.fileName, 'Open', contract.id, 'original')}
                        ${contract.signedFileUrl ? `<button class="btn btn-sm btn-outline" data-bp-preview="${this.escapeHtml(contract.id)}" data-bp-preview-type="signed"><i class="fas fa-file-lines"></i> Signed Preview</button>${this.openActionHtml(contract.signedFileUrl, contract.signedFileName, 'Signed', contract.id, 'signed')}` : ''}
                        ${this.isSuperAdmin() ? `<button class="btn btn-sm btn-outline" data-bp-edit-contract="${this.escapeHtml(contract.id)}"><i class="fas fa-pen"></i> Update</button><button class="btn btn-sm btn-danger" data-bp-delete-contract="${this.escapeHtml(contract.id)}"><i class="fas fa-trash"></i> Delete</button>` : `<label class="btn btn-sm btn-outline bp-upload-inline"><i class="fas fa-upload"></i> Upload<input type="file" data-bp-signed-upload="${this.escapeHtml(contract.id)}" accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp"></label><button class="btn btn-sm btn-primary" data-bp-sign="${this.escapeHtml(contract.id)}"><i class="fas fa-signature"></i> Sign</button>`}
                    </td>
                </tr>
            `).join('');
            body.querySelectorAll('[data-bp-preview]').forEach(btn => {
                btn.addEventListener('click', () => this.openContractPreview(btn.dataset.bpPreview, btn.dataset.bpPreviewType, btn.dataset.bpPreviewMode));
            });
            body.querySelectorAll('[data-bp-edit-contract]').forEach(btn => {
                btn.addEventListener('click', () => this.editContract(btn.dataset.bpEditContract));
            });
            body.querySelectorAll('[data-bp-delete-contract]').forEach(btn => {
                btn.addEventListener('click', () => this.deleteContract(btn.dataset.bpDeleteContract));
            });
            body.querySelectorAll('[data-bp-signed-upload]').forEach(input => {
                input.addEventListener('change', () => this.uploadSignedContract(input.dataset.bpSignedUpload, input.files[0]));
            });
            body.querySelectorAll('[data-bp-sign]').forEach(btn => {
                btn.addEventListener('click', () => this.openSignModal(btn.dataset.bpSign));
            });
        },

        uploadFile: async function (file, businessId, folder) {
            if (!file) throw new Error('No file selected.');
            if (!this.isAllowedContractFile(file)) {
                throw new Error('Only PDF and image files are allowed.');
            }
            const safeName = Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            if (PharmaFlow.CloudinaryUpload && PharmaFlow.CloudinaryUpload.isActive()) {
                const publicId = safeName.replace(/\.[^/.]+$/, '');
                const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
                return PharmaFlow.CloudinaryUpload.uploadFile(file, {
                    folder: 'pharmaflow/' + folder + '/' + businessId,
                    publicId: publicId,
                    resourceType: isPdf ? 'image' : undefined
                });
            }
            const ref = window.storage.ref('businesses/' + businessId + '/' + folder + '/' + safeName);
            const snap = await ref.put(file);
            return snap.ref.getDownloadURL();
        },

        saveContract: async function (e) {
            e.preventDefault();
            const businessId = document.getElementById('bp-contract-business')?.value;
            const file = document.getElementById('bp-contract-file')?.files[0];
            if (!businessId || (!editingContractId && !file)) return this.showToast('Select a branch and contract file.', 'error');
            if (file && !this.isAllowedContractFile(file)) return this.showToast('Choose a PDF or image file only.', 'error');
            const btn = e.target.querySelector('button[type="submit"]');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
            try {
                const payload = {
                    businessId,
                    businessName: this.branchName(businessId),
                    title: (document.getElementById('bp-contract-title')?.value || '').trim(),
                    note: (document.getElementById('bp-contract-note')?.value || '').trim(),
                    updatedAt: this.nowIso()
                };
                if (file) {
                    payload.fileUrl = await this.uploadFile(file, businessId, 'contracts');
                    payload.fileName = file.name;
                    payload.fileType = this.contractFileType(file);
                    payload.status = 'pending';
                    payload.signedFileUrl = firebase.firestore.FieldValue.delete();
                    payload.signedFileName = firebase.firestore.FieldValue.delete();
                    payload.signatureDataUrl = firebase.firestore.FieldValue.delete();
                    payload.signedBy = firebase.firestore.FieldValue.delete();
                    payload.signedAt = firebase.firestore.FieldValue.delete();
                }
                if (editingContractId) {
                    payload.updatedBy = this.getUserName();
                    await window.db.collection('branch_contracts').doc(editingContractId).update(payload);
                    this.showToast('Contract updated.');
                } else {
                    payload.createdBy = this.getUserName();
                    payload.createdAt = this.nowIso();
                    payload.status = payload.status || 'pending';
                    await window.db.collection('branch_contracts').add(payload);
                    this.showToast('Contract uploaded.');
                }
                this.resetContractForm();
            } catch (err) {
                this.showToast('Contract save failed: ' + err.message, 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = editingContractId ? '<i class="fas fa-save"></i> Update Contract' : '<i class="fas fa-upload"></i> Upload Contract'; }
            }
        },

        editContract: function (id) {
            const contract = contracts.find(item => item.id === id);
            if (!contract || !this.isSuperAdmin()) return;
            editingContractId = id;
            const form = document.getElementById('bp-contract-form');
            document.getElementById('bp-contract-business').value = contract.businessId || '';
            document.getElementById('bp-contract-title').value = contract.title || '';
            document.getElementById('bp-contract-note').value = contract.note || '';
            document.getElementById('bp-contract-file').required = false;
            document.getElementById('bp-contract-file').value = '';
            document.getElementById('bp-contract-file-help').textContent = 'Leave blank to keep the current file. Choose a new file to replace it and reset signing.';
            document.getElementById('bp-contract-form-title').textContent = 'Update Contract';
            document.getElementById('bp-contract-form-subtitle').textContent = 'Edit details or replace the document';
            document.getElementById('bp-contract-submit').innerHTML = '<i class="fas fa-save"></i> Update Contract';
            document.getElementById('bp-contract-cancel').style.display = '';
            if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },

        resetContractForm: function () {
            editingContractId = null;
            const form = document.getElementById('bp-contract-form');
            if (form) form.reset();
            const file = document.getElementById('bp-contract-file');
            if (file) file.required = true;
            const help = document.getElementById('bp-contract-file-help');
            if (help) help.textContent = 'PDF, PNG, JPG, WEBP, GIF, or BMP only. Documents open directly in the portal.';
            const title = document.getElementById('bp-contract-form-title');
            if (title) title.textContent = 'Upload Contract';
            const subtitle = document.getElementById('bp-contract-form-subtitle');
            if (subtitle) subtitle.textContent = 'Send document to a branch';
            const submit = document.getElementById('bp-contract-submit');
            if (submit) submit.innerHTML = '<i class="fas fa-upload"></i> Upload Contract';
            const cancel = document.getElementById('bp-contract-cancel');
            if (cancel) cancel.style.display = 'none';
        },

        deleteContract: async function (id) {
            if (!this.isSuperAdmin()) return;
            const contract = contracts.find(item => item.id === id);
            if (!contract) return;
            const ok = confirm('Delete "' + (contract.title || 'this contract') + '" from the branch portal? This removes the portal record for the branch.');
            if (!ok) return;
            try {
                await window.db.collection('branch_contracts').doc(id).delete();
                if (editingContractId === id) this.resetContractForm();
                this.showToast('Contract deleted.');
            } catch (err) {
                this.showToast('Delete failed: ' + err.message, 'error');
            }
        },

        openContractPreview: function (id, type, mode) {
            const contract = contracts.find(item => item.id === id);
            if (!contract) return;
            const signed = type === 'signed';
            const url = signed ? contract.signedFileUrl : contract.fileUrl;
            const name = signed ? contract.signedFileName : contract.fileName;
            if (!url) return this.showToast('No document is available to preview.', 'error');
            const modal = document.getElementById('bp-contract-modal');
            if (!modal) return;
            const isImage = this.isImageFile(url, name);
            modal.innerHTML = `
                <div class="bp-modal-panel bp-modal-panel--preview">
                    <div class="bp-preview-header">
                        <div class="bp-preview-heading">
                            <span class="bp-preview-file-icon"><i class="fas ${isImage ? 'fa-file-image' : 'fa-file-pdf'}"></i></span>
                            <div><h3>${signed ? 'Signed Contract' : 'Contract Preview'}</h3><small>${this.escapeHtml(contract.title || name || 'Document')}</small></div>
                        </div>
                        <div class="bp-preview-toolbar">
                            ${isImage ? '<button class="btn btn-sm btn-outline" id="bp-preview-zoom-out" type="button" title="Zoom out"><i class="fas fa-minus"></i></button><span id="bp-preview-zoom-label">100%</span><button class="btn btn-sm btn-outline" id="bp-preview-zoom-in" type="button" title="Zoom in"><i class="fas fa-plus"></i></button><button class="btn btn-sm btn-outline" id="bp-preview-zoom-reset" type="button" title="Fit image"><i class="fas fa-expand"></i></button>' : ''}
                            <button class="btn btn-sm btn-outline" id="bp-contract-preview-close" type="button" aria-label="Close preview"><i class="fas fa-times"></i></button>
                        </div>
                    </div>
                    <div class="bp-contract-preview">
                        ${this.contractPreviewHtml(url, name)}
                    </div>
                    <div class="bp-actions bp-preview-actions">
                        ${this.downloadActionHtml(url, name)}
                        ${this.printActionHtml(url, name)}
                        <a class="btn btn-outline" href="${this.escapeHtml(url)}" target="_blank" rel="noopener"><i class="fas fa-up-right-from-square"></i> Open in New Tab</a>
                    </div>
                </div>
            `;
            modal.classList.add('show');
            modal.setAttribute('aria-hidden', 'false');
            document.getElementById('bp-contract-preview-close')?.addEventListener('click', () => this.closeContractPreview());
            document.getElementById('bp-contract-download-full')?.addEventListener('click', () => this.downloadFullContract(url, name, contract.title));
            document.getElementById('bp-contract-print')?.addEventListener('click', () => this.printContract(url, name, contract.title));
            if (isImage) this.bindImagePreviewControls(modal);
        },

        downloadActionHtml: function (url, name) {
            return '<a class="btn btn-primary" href="' + this.escapeHtml(url) + '" target="_blank" rel="noopener" download="' + this.escapeHtml(name || 'contract') + '"><i class="fas fa-download"></i> Download</a>';
        },

        printActionHtml: function (url, name) {
            if (this.isPdfFile(url, name) || this.isImageFile(url, name)) {
                return '<button class="btn btn-outline" id="bp-contract-print" type="button"><i class="fas fa-print"></i> Print</button>';
            }
            return '';
        },

        contractPreviewHtml: function (url, name) {
            const safeUrl = this.escapeHtml(url);
            if (this.isImageFile(url, name)) {
                return '<div class="bp-contract-image-stage"><img class="bp-contract-preview-img" id="bp-contract-preview-image" src="' + safeUrl + '" alt="Contract preview"></div>';
            }
            if (this.isPdfFile(url, name)) {
                return '<object class="bp-contract-preview-frame" data="' + safeUrl + '#toolbar=1&navpanes=0&view=FitH" type="application/pdf"><div class="bp-preview-fallback"><i class="fas fa-file-pdf"></i><h4>Your browser could not display this PDF</h4><p>Use Open in New Tab or Download below.</p></div></object>';
            }
            return '<div class="bp-preview-fallback"><i class="fas fa-file-circle-xmark"></i><h4>Unsupported legacy contract</h4><p>Replace this file with a PDF or image to preview it.</p></div>';
        },

        bindImagePreviewControls: function (modal) {
            const image = modal.querySelector('#bp-contract-preview-image');
            const label = modal.querySelector('#bp-preview-zoom-label');
            if (!image) return;
            let zoom = 1;
            const applyZoom = () => {
                image.style.transform = 'scale(' + zoom + ')';
                if (label) label.textContent = Math.round(zoom * 100) + '%';
            };
            modal.querySelector('#bp-preview-zoom-in')?.addEventListener('click', () => {
                zoom = Math.min(3, zoom + .25);
                applyZoom();
            });
            modal.querySelector('#bp-preview-zoom-out')?.addEventListener('click', () => {
                zoom = Math.max(.5, zoom - .25);
                applyZoom();
            });
            modal.querySelector('#bp-preview-zoom-reset')?.addEventListener('click', () => {
                zoom = 1;
                applyZoom();
            });
        },

        loadContractPageData: async function (url, maxPages) {
            const pages = [];
            const limit = maxPages || CONTRACT_PAGE_LIMIT;
            for (let page = 1; page <= limit; page++) {
                const pageUrl = this.cloudinaryPdfPageUrl(url, page);
                if (!pageUrl) break;
                try {
                    const res = await fetch(pageUrl);
                    if (!res.ok) {
                        if (page > 1) break;
                        throw new Error('Preview page could not be loaded.');
                    }
                    const blob = await res.blob();
                    const dataUrl = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    pages.push({ page, url: pageUrl, dataUrl });
                } catch (err) {
                    if (page > 1) break;
                    throw err;
                }
            }
            if (!pages.length) throw new Error('No document pages were available.');
            return pages;
        },

        imageSize: function (dataUrl) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
                img.onerror = reject;
                img.src = dataUrl;
            });
        },

        safeFileBase: function (name, fallback) {
            return String(name || fallback || 'contract')
                .replace(/\.[^.]+$/, '')
                .replace(/[^a-zA-Z0-9_-]+/g, '_')
                .replace(/^_+|_+$/g, '') || 'contract';
        },

        downloadFullContract: async function (url, name, title) {
            if (!(this.isCloudinaryUrl(url) && this.isPdfFile(url, name) && url.indexOf('/image/upload/') !== -1)) {
                window.open(url, '_blank', 'noopener');
                return;
            }
            if (!window.jspdf || !window.jspdf.jsPDF) {
                this.showToast('PDF library is not loaded. Use Print to save the full document.', 'error');
                return;
            }
            const btn = document.getElementById('bp-contract-download-full');
            const oldHtml = btn ? btn.innerHTML : '';
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...'; }
            try {
                const pages = await this.loadContractPageData(url, CONTRACT_PAGE_LIMIT);
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF('p', 'mm', 'a4');
                const pageW = pdf.internal.pageSize.getWidth();
                const pageH = pdf.internal.pageSize.getHeight();
                for (let i = 0; i < pages.length; i++) {
                    if (i > 0) pdf.addPage();
                    const size = await this.imageSize(pages[i].dataUrl);
                    const ratio = Math.min(pageW / size.width, pageH / size.height);
                    const w = size.width * ratio;
                    const h = size.height * ratio;
                    pdf.addImage(pages[i].dataUrl, 'PNG', (pageW - w) / 2, (pageH - h) / 2, w, h);
                }
                pdf.save(this.safeFileBase(name, title) + '.pdf');
                this.showToast('Full contract downloaded.');
            } catch (err) {
                this.showToast('Download failed: ' + (err.message || err), 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = oldHtml || '<i class="fas fa-download"></i> Download Full Document'; }
            }
        },

        printContract: async function (url, name, title) {
            const win = window.open('', '_blank', 'width=980,height=900');
            if (!win) return this.showToast('Allow popups to print the contract.', 'error');
            const btn = document.getElementById('bp-contract-print');
            const oldHtml = btn ? btn.innerHTML : '';
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...'; }
            try {
                let pageImgs = [];
                if (this.isCloudinaryUrl(url) && this.isPdfFile(url, name) && url.indexOf('/image/upload/') !== -1) {
                    const pages = await this.loadContractPageData(url, CONTRACT_PAGE_LIMIT);
                    pageImgs = pages.map(p => p.url);
                } else if (this.isImageFile(url, name)) {
                    pageImgs = [this.displayUrl(url, name)];
                } else {
                    const src = this.displayUrl(url, name);
                    const heading = this.escapeHtml(title || name || 'Contract');
                    const html = '<!doctype html><html><head><title>' + heading + '</title>' +
                        '<style>html,body{height:100%;margin:0}.toolbar{position:fixed;top:0;left:0;right:0;z-index:5;padding:10px;text-align:center;background:#111827}.toolbar button{padding:10px 22px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer}.frame{position:absolute;inset:52px 0 0 0}.frame iframe{width:100%;height:100%;border:0}@media print{.toolbar{display:none}.frame{inset:0}}</style>' +
                        '</head><body><div class="toolbar"><button onclick="window.print()">Print</button></div><div class="frame"><iframe src="' + this.escapeHtml(src) + '"></iframe></div></body></html>';
                    win.document.write(html);
                    win.document.close();
                    return;
                }
                const heading = this.escapeHtml(title || name || 'Contract');
                const html = '<!doctype html><html><head><title>' + heading + '</title>' +
                    '<style>body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif}.toolbar{position:sticky;top:0;z-index:5;padding:12px;text-align:center;background:#111827;color:#fff}.toolbar button{padding:10px 22px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer}.page{page-break-after:always;display:flex;justify-content:center;padding:18px}.page img{max-width:100%;width:900px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18)}@media print{body{background:#fff}.toolbar{display:none}.page{padding:0;page-break-after:always}.page img{width:100%;box-shadow:none}}</style>' +
                    '</head><body><div class="toolbar"><button onclick="window.print()">Print</button></div>' +
                    pageImgs.map(src => '<div class="page"><img src="' + this.escapeHtml(src) + '" alt="Contract page"></div>').join('') +
                    '<script>window.onload=function(){setTimeout(function(){window.print()},600)};<\\/script></body></html>';
                win.document.write(html);
                win.document.close();
            } catch (err) {
                win.close();
                this.showToast('Print failed: ' + (err.message || err), 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = oldHtml || '<i class="fas fa-print"></i> Print'; }
            }
        },

        closeContractPreview: function () {
            const modal = document.getElementById('bp-contract-modal');
            if (modal) {
                modal.classList.remove('show');
                modal.setAttribute('aria-hidden', 'true');
                modal.innerHTML = '';
            }
        },

        uploadSignedContract: async function (id, file) {
            const contract = contracts.find(item => item.id === id);
            if (!contract || !file) return;
            if (!this.isAllowedContractFile(file)) return this.showToast('Choose a PDF or image file only.', 'error');
            try {
                const signedFileUrl = await this.uploadFile(file, contract.businessId, 'signed_contracts');
                await window.db.collection('branch_contracts').doc(id).update({
                    signedFileUrl,
                    signedFileName: file.name,
                    signedFileType: this.contractFileType(file),
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

        renderCertificates: async function (container) {
            this.cleanup();
            await this.loadBusinesses();
            const admin = this.isSuperAdmin();
            const businessId = this.getBusinessId();
            let uploadEnabled = admin;

            if (!admin && businessId) {
                try {
                    const businessSnap = await window.db.collection('businesses').doc(businessId).get();
                    uploadEnabled = businessSnap.exists && businessSnap.data().branchCertificateUploadEnabled === true;
                } catch (err) {
                    uploadEnabled = false;
                }
            }

            container.innerHTML = `
                <div class="bp-module bp-cert-module">
                    ${this.headerHtml('Branch Certificates', 'fas fa-certificate', 'Licences, waste-facility approvals, and branch compliance images')}

                    ${admin ? `
                        <div class="bp-cert-admin-note">
                            <i class="fas fa-shield-halved"></i>
                            <div><strong>Superadmin certificate register</strong><span>Upload rights are granted per branch from Admin Panel → Manage Franchises.</span></div>
                        </div>
                    ` : uploadEnabled ? this.certificateUploadFormHtml() : `
                        <div class="bp-cert-locked">
                            <span><i class="fas fa-lock"></i></span>
                            <div>
                                <strong>Certificate uploads are not enabled</strong>
                                <p>Your Superadmin must grant this branch permission before users can upload licensing or waste-facility certificates.</p>
                            </div>
                        </div>
                    `}

                    <section class="bp-card">
                        <div class="bp-card-head">
                            <div>
                                <h3>${admin ? 'All Branch Certificates' : 'Branch Certificate Register'}</h3>
                                <small>Image records retained for branch compliance review</small>
                            </div>
                            <span class="bp-pill">Images only</span>
                        </div>
                        <div class="bp-toolbar">
                            <div class="bp-search"><i class="fas fa-search"></i><input id="bp-cert-search" type="text" placeholder="Search certificate, authority, branch..."></div>
                            <select id="bp-cert-type-filter" class="bp-input">
                                <option value="">All certificate types</option>
                                <option value="pharmacy_license">Pharmacy licence</option>
                                <option value="waste_facility">Waste facility</option>
                                <option value="business_permit">Business permit</option>
                                <option value="professional_license">Professional licence</option>
                                <option value="inspection_certificate">Inspection certificate</option>
                                <option value="other">Other</option>
                            </select>
                            ${admin ? `<select id="bp-cert-business-filter" class="bp-input"><option value="">All branches</option>${this.businessOptions('')}</select>` : ''}
                        </div>
                        <div class="bp-cert-grid" id="bp-cert-grid">
                            <div class="bp-empty"><i class="fas fa-spinner fa-spin"></i> Loading certificates...</div>
                        </div>
                    </section>
                    <div id="bp-cert-preview-modal" class="bp-modal" aria-hidden="true"></div>
                </div>
            `;

            if (!admin && uploadEnabled) {
                document.getElementById('bp-cert-form')?.addEventListener('submit', event => this.saveCertificate(event));
            }
            document.getElementById('bp-cert-search')?.addEventListener('input', () => this.renderCertificateCards());
            document.getElementById('bp-cert-type-filter')?.addEventListener('change', () => this.renderCertificateCards());
            document.getElementById('bp-cert-business-filter')?.addEventListener('change', () => this.renderCertificateCards());
            this.subscribeCertificates();
        },

        certificateUploadFormHtml: function () {
            return `
                <form class="bp-card bp-cert-upload" id="bp-cert-form">
                    <div class="bp-card-head">
                        <div><h3>Upload Certificate</h3><small>Add an image of an official branch certificate</small></div>
                        <span class="bp-status bp-status--ok"><i class="fas fa-unlock-keyhole"></i> Enabled</span>
                    </div>
                    <div class="bp-form-grid">
                        <label>Certificate type
                            <select id="bp-cert-type" class="bp-input" required>
                                <option value="">Select type</option>
                                <option value="pharmacy_license">Pharmacy licence</option>
                                <option value="waste_facility">Waste facility</option>
                                <option value="business_permit">Business permit</option>
                                <option value="professional_license">Professional licence</option>
                                <option value="inspection_certificate">Inspection certificate</option>
                                <option value="other">Other</option>
                            </select>
                        </label>
                        <label>Certificate title<input id="bp-cert-title" class="bp-input" placeholder="e.g. Medical Waste Handling Licence" required></label>
                        <label>Issuing authority<input id="bp-cert-authority" class="bp-input" placeholder="e.g. County Government or PPB"></label>
                        <label>Certificate / licence number<input id="bp-cert-number" class="bp-input" placeholder="Reference number"></label>
                        <label>Issue date<input id="bp-cert-issued" class="bp-input" type="date"></label>
                        <label>Expiry date<input id="bp-cert-expiry" class="bp-input" type="date"></label>
                        <label class="bp-field-full">Certificate image
                            <input id="bp-cert-file" class="bp-input" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" required>
                            <small>PNG, JPG, or WEBP only. Maximum recommended size: 8 MB.</small>
                        </label>
                        <label class="bp-field-full">Notes<textarea id="bp-cert-notes" class="bp-input" rows="3" placeholder="Optional compliance notes"></textarea></label>
                    </div>
                    <div class="bp-actions">
                        <button class="btn btn-primary" id="bp-cert-submit" type="submit"><i class="fas fa-cloud-arrow-up"></i> Upload Certificate</button>
                        <button class="btn btn-outline" type="reset"><i class="fas fa-rotate-left"></i> Clear</button>
                    </div>
                </form>
            `;
        },

        subscribeCertificates: function () {
            if (activeListener) activeListener();
            let ref = window.db.collection('branch_certificates');
            if (!this.isSuperAdmin()) {
                const businessId = this.getBusinessId();
                if (!businessId) return this.showCertificatesError('No branch is assigned to this user.');
                ref = ref.where('businessId', '==', businessId);
            }
            activeListener = ref.onSnapshot(snapshot => {
                certificates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                certificates.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
                this.renderCertificateCards();
            }, err => this.showCertificatesError(err.message || 'Failed to load branch certificates.'));
        },

        showCertificatesError: function (message) {
            const grid = document.getElementById('bp-cert-grid');
            if (grid) grid.innerHTML = '<div class="bp-empty bp-empty--error"><i class="fas fa-triangle-exclamation"></i> ' + this.escapeHtml(message) + '</div>';
        },

        certificateTypeLabel: function (type) {
            const labels = {
                pharmacy_license: 'Pharmacy licence',
                waste_facility: 'Waste facility',
                business_permit: 'Business permit',
                professional_license: 'Professional licence',
                inspection_certificate: 'Inspection certificate',
                other: 'Other'
            };
            return labels[type] || 'Certificate';
        },

        certificateExpiryState: function (value) {
            if (!value) return { className: 'neutral', label: 'No expiry' };
            const date = new Date(value + 'T23:59:59');
            if (isNaN(date.getTime())) return { className: 'neutral', label: 'No expiry' };
            const days = Math.ceil((date.getTime() - Date.now()) / 86400000);
            if (days < 0) return { className: 'expired', label: 'Expired' };
            if (days <= 30) return { className: 'warning', label: days + ' days left' };
            return { className: 'valid', label: 'Valid' };
        },

        renderCertificateCards: function () {
            const grid = document.getElementById('bp-cert-grid');
            if (!grid) return;
            const query = (document.getElementById('bp-cert-search')?.value || '').trim().toLowerCase();
            const type = document.getElementById('bp-cert-type-filter')?.value || '';
            const businessFilter = document.getElementById('bp-cert-business-filter')?.value || '';
            let rows = certificates.slice();
            if (type) rows = rows.filter(item => item.certificateType === type);
            if (businessFilter) rows = rows.filter(item => item.businessId === businessFilter);
            if (query) {
                rows = rows.filter(item => [
                    item.title, item.authority, item.certificateNumber, item.businessName,
                    item.uploadedBy, this.certificateTypeLabel(item.certificateType)
                ].join(' ').toLowerCase().includes(query));
            }
            if (!rows.length) {
                grid.innerHTML = '<div class="bp-empty"><i class="fas fa-certificate"></i> No certificates found</div>';
                return;
            }

            grid.innerHTML = rows.map(item => {
                const expiry = this.certificateExpiryState(item.expiryDate);
                return `
                    <article class="bp-cert-card">
                        <button class="bp-cert-image" type="button" data-bp-cert-preview="${this.escapeHtml(item.id)}" aria-label="Preview ${this.escapeHtml(item.title || 'certificate')}">
                            <img src="${this.escapeHtml(item.imageUrl)}" alt="${this.escapeHtml(item.title || 'Branch certificate')}" loading="lazy">
                            <span><i class="fas fa-expand"></i> Preview</span>
                        </button>
                        <div class="bp-cert-card__body">
                            <div class="bp-cert-card__top">
                                <span class="bp-cert-type">${this.escapeHtml(this.certificateTypeLabel(item.certificateType))}</span>
                                <span class="bp-cert-expiry bp-cert-expiry--${expiry.className}">${this.escapeHtml(expiry.label)}</span>
                            </div>
                            <h4>${this.escapeHtml(item.title || 'Certificate')}</h4>
                            <p>${this.escapeHtml(item.authority || 'Issuing authority not specified')}</p>
                            <dl>
                                <div><dt>Branch</dt><dd>${this.escapeHtml(item.businessName || this.branchName(item.businessId))}</dd></div>
                                <div><dt>Reference</dt><dd>${this.escapeHtml(item.certificateNumber || '—')}</dd></div>
                                <div><dt>Expiry</dt><dd>${item.expiryDate ? this.formatDate(item.expiryDate) : 'No expiry'}</dd></div>
                                <div><dt>Uploaded by</dt><dd>${this.escapeHtml(item.uploadedBy || 'User')}</dd></div>
                            </dl>
                        </div>
                        <div class="bp-cert-card__actions">
                            <button class="btn btn-sm btn-outline" data-bp-cert-preview="${this.escapeHtml(item.id)}"><i class="fas fa-eye"></i> View</button>
                            <a class="btn btn-sm btn-outline" href="${this.escapeHtml(item.imageUrl)}" target="_blank" rel="noopener"><i class="fas fa-up-right-from-square"></i> Open</a>
                            ${this.isSuperAdmin() ? `<button class="btn btn-sm btn-danger" data-bp-cert-delete="${this.escapeHtml(item.id)}"><i class="fas fa-trash"></i></button>` : ''}
                        </div>
                    </article>
                `;
            }).join('');

            grid.querySelectorAll('[data-bp-cert-preview]').forEach(button => {
                button.addEventListener('click', () => this.openCertificatePreview(button.dataset.bpCertPreview));
            });
            grid.querySelectorAll('[data-bp-cert-delete]').forEach(button => {
                button.addEventListener('click', () => this.deleteCertificate(button.dataset.bpCertDelete));
            });
        },

        saveCertificate: async function (event) {
            event.preventDefault();
            const businessId = this.getBusinessId();
            const file = document.getElementById('bp-cert-file')?.files[0];
            if (!businessId || !file) return this.showToast('Select a certificate image.', 'error');
            if (!this.isAllowedCertificateImage(file)) return this.showToast('Only PNG, JPG, and WEBP images are allowed.', 'error');
            if (file.size > 8 * 1024 * 1024) return this.showToast('Certificate image must be smaller than 8 MB.', 'error');

            const button = document.getElementById('bp-cert-submit');
            if (button) { button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...'; }
            try {
                const imageUrl = await this.uploadFile(file, businessId, 'branch_certificates');
                const businessSnap = await window.db.collection('businesses').doc(businessId).get();
                const businessName = businessSnap.exists ? (businessSnap.data().name || businessId) : businessId;
                const extension = String(file.name || '').toLowerCase().split('.').pop();
                const imageType = file.type || (extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg');
                await window.db.collection('branch_certificates').add({
                    businessId,
                    businessName,
                    certificateType: document.getElementById('bp-cert-type')?.value || 'other',
                    title: (document.getElementById('bp-cert-title')?.value || '').trim(),
                    authority: (document.getElementById('bp-cert-authority')?.value || '').trim(),
                    certificateNumber: (document.getElementById('bp-cert-number')?.value || '').trim(),
                    issueDate: document.getElementById('bp-cert-issued')?.value || '',
                    expiryDate: document.getElementById('bp-cert-expiry')?.value || '',
                    notes: (document.getElementById('bp-cert-notes')?.value || '').trim(),
                    imageUrl,
                    imageName: file.name,
                    imageType,
                    uploadedBy: this.getUserName(),
                    uploadedByUid: window.auth?.currentUser?.uid || '',
                    createdAt: this.nowIso(),
                    updatedAt: this.nowIso()
                });
                event.target.reset();
                this.showToast('Branch certificate uploaded.');
            } catch (err) {
                this.showToast('Certificate upload failed: ' + (err.message || err), 'error');
            } finally {
                if (button) { button.disabled = false; button.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Upload Certificate'; }
            }
        },

        openCertificatePreview: function (id) {
            const certificate = certificates.find(item => item.id === id);
            const modal = document.getElementById('bp-cert-preview-modal');
            if (!certificate || !modal) return;
            modal.innerHTML = `
                <div class="bp-modal-panel bp-cert-preview-panel">
                    <div class="bp-preview-header">
                        <div class="bp-preview-heading">
                            <span class="bp-preview-file-icon"><i class="fas fa-certificate"></i></span>
                            <div><h3>${this.escapeHtml(certificate.title || 'Branch Certificate')}</h3><small>${this.escapeHtml(certificate.businessName || this.branchName(certificate.businessId))}</small></div>
                        </div>
                        <button class="btn btn-sm btn-outline" id="bp-cert-preview-close" aria-label="Close certificate preview"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="bp-cert-preview-stage"><img src="${this.escapeHtml(certificate.imageUrl)}" alt="${this.escapeHtml(certificate.title || 'Certificate')}"></div>
                    <div class="bp-actions">
                        <a class="btn btn-primary" href="${this.escapeHtml(certificate.imageUrl)}" target="_blank" rel="noopener"><i class="fas fa-up-right-from-square"></i> Open Full Image</a>
                        <button class="btn btn-outline" id="bp-cert-preview-done">Close</button>
                    </div>
                </div>
            `;
            modal.classList.add('show');
            modal.setAttribute('aria-hidden', 'false');
            const close = () => {
                modal.classList.remove('show');
                modal.setAttribute('aria-hidden', 'true');
                modal.innerHTML = '';
            };
            document.getElementById('bp-cert-preview-close')?.addEventListener('click', close);
            document.getElementById('bp-cert-preview-done')?.addEventListener('click', close);
            modal.addEventListener('click', event => { if (event.target === modal) close(); }, { once: true });
        },

        deleteCertificate: async function (id) {
            if (!this.isSuperAdmin()) return;
            const certificate = certificates.find(item => item.id === id);
            if (!certificate) return;
            if (!confirm('Delete "' + (certificate.title || 'this certificate') + '" from the branch register?')) return;
            try {
                await window.db.collection('branch_certificates').doc(id).delete();
                this.showToast('Certificate record deleted.');
            } catch (err) {
                this.showToast('Delete failed: ' + (err.message || err), 'error');
            }
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
