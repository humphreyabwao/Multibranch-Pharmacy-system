/**
 * PharmaFlow - Pharmacy Customers Module
 * Aggregates customers from POS sales and provides searchable customer insights.
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let unsubCustomerSales = null;
    let customerSalesData = [];
    let customerRows = [];
    let filteredCustomerRows = [];
    let currentPage = 1;
    let pageSize = 50;

    const PharmacyCustomers = {

        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        formatCurrency: function (amount) {
            return 'KSH ' + new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
        },

        escapeHtml: function (str) {
            const div = document.createElement('div');
            div.textContent = str || '';
            return div.innerHTML;
        },

        showToast: function (message, type) {
            const existing = document.querySelector('.as-toast');
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.className = 'as-toast as-toast--' + (type || 'success');
            toast.innerHTML = '<i class="fas fa-' + (type === 'error' ? 'exclamation-circle' : 'check-circle') + '"></i> ' + message;
            document.body.appendChild(toast);
            setTimeout(() => toast.classList.add('show'), 10);
            setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
        },

        parseDate: function (sale) {
            const src = sale.saleDate || sale.createdAt || sale.saleDateStr || null;
            if (!src) return null;
            if (src.toDate && typeof src.toDate === 'function') return src.toDate();
            const d = new Date(src);
            return isNaN(d.getTime()) ? null : d;
        },

        normalizePhone: function (phone) {
            return (phone || '').replace(/\s+/g, '').replace(/[^0-9+]/g, '').toLowerCase();
        },

        formatDate: function (dt) {
            if (!dt) return '—';
            return dt.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
        },

        formatDateTime: function (dt) {
            if (!dt) return '—';
            return dt.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' +
                dt.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
        },

        getCustomerFrequencyMeta: function (transactions) {
            const tx = parseInt(transactions, 10) || 0;
            if (tx >= 10) return { key: 'loyal', label: 'Loyal' };
            if (tx >= 6) return { key: 'frequent', label: 'Frequent' };
            if (tx >= 3) return { key: 'regular', label: 'Regular' };
            if (tx >= 2) return { key: 'potential', label: 'Potential' };
            return { key: 'new', label: 'New' };
        },

        normalizeWhatsAppPhone: function (phone) {
            const raw = String(phone || '').trim();
            if (!raw || raw === '—') return '';
            const cleaned = raw.replace(/[^0-9+]/g, '');
            if (!cleaned) return '';

            // KE-friendly normalization: 07xxxxxxxx -> 2547xxxxxxxx
            if (cleaned.startsWith('+')) return cleaned.slice(1);
            if (cleaned.startsWith('254')) return cleaned;
            if (cleaned.startsWith('0')) return '254' + cleaned.slice(1);
            return cleaned;
        },

        buildCustomerMessage: function (customer) {
            const name = customer && customer.name && customer.name !== 'Walk-in Customer' ? customer.name : 'Customer';
            return 'Hello ' + name + ', this is PharmaFlow. Thank you for choosing us. We are here to assist you with your medication and refill needs.';
        },

        render: function (container) {
            currentPage = 1;

            container.innerHTML = `
                <div class="sales-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-users"></i> Pharmacy Customers</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Pharmacy</span><span>/</span>
                                <span>Customers</span>
                            </div>
                        </div>
                        <div class="page-header-right">
                            <button class="btn btn-sm btn-outline" id="pc-export-btn">
                                <i class="fas fa-file-export"></i> Export
                            </button>
                            <div class="as-export-menu" id="pc-export-menu" style="display:none;">
                                <button class="as-export-option" data-type="excel"><i class="fas fa-file-excel"></i> Export Excel</button>
                                <button class="as-export-option" data-type="pdf"><i class="fas fa-file-pdf"></i> Export PDF</button>
                            </div>
                        </div>
                    </div>

                    <div class="sales-stats-row">
                        <div class="sales-stat-card sales-stat--count">
                            <i class="fas fa-users"></i>
                            <div><span class="sales-stat-value" id="pc-total-customers">0</span><small>Total Customers</small></div>
                        </div>
                        <div class="sales-stat-card sales-stat--items">
                            <i class="fas fa-phone"></i>
                            <div><span class="sales-stat-value" id="pc-with-phone">0</span><small>With Phone</small></div>
                        </div>
                        <div class="sales-stat-card sales-stat--revenue">
                            <i class="fas fa-coins"></i>
                            <div><span class="sales-stat-value" id="pc-revenue">KSH 0.00</span><small>Total Revenue</small></div>
                        </div>
                        <div class="sales-stat-card sales-stat--profit">
                            <i class="fas fa-receipt"></i>
                            <div><span class="sales-stat-value" id="pc-transactions">0</span><small>Transactions</small></div>
                        </div>
                    </div>

                    <div class="sales-toolbar">
                        <div class="sales-search">
                            <i class="fas fa-search"></i>
                            <input type="text" id="pc-search" placeholder="Search by customer name, phone, or receipt #...">
                        </div>
                        <div class="sales-filters">
                            <select id="pc-phone-filter">
                                <option value="">All Contacts</option>
                                <option value="with-phone">With Phone</option>
                                <option value="without-phone">Without Phone</option>
                            </select>
                            <select id="pc-activity-filter">
                                <option value="">All Activity</option>
                                <option value="30">Last 30 days</option>
                                <option value="90">Last 90 days</option>
                                <option value="365">Last 12 months</option>
                            </select>
                            <select id="pc-page-size">
                                <option value="25">25 per page</option>
                                <option value="50" selected>50 per page</option>
                                <option value="100">100 per page</option>
                            </select>
                        </div>
                    </div>

                    <div class="sales-table-wrapper">
                        <table class="sales-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Customer</th>
                                    <th>Phone</th>
                                    <th>Transactions</th>
                                    <th>Frequency</th>
                                    <th>Items</th>
                                    <th>Total Spent</th>
                                    <th>Last Purchase</th>
                                    <th>Last Payment</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="pc-tbody">
                                <tr><td colspan="10" class="sales-loading"><i class="fas fa-spinner fa-spin"></i> Loading customer activity...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <div class="sales-pagination" id="pc-pagination"></div>
                </div>
            `;

            this.bindEvents(container);
            this.subscribeSales();
        },

        bindEvents: function (container) {
            const self = this;

            const search = document.getElementById('pc-search');
            if (search) {
                let debounce;
                search.addEventListener('input', function () {
                    clearTimeout(debounce);
                    debounce = setTimeout(() => { currentPage = 1; self.applyFilters(); }, 150);
                });
            }

            const phoneFilter = document.getElementById('pc-phone-filter');
            if (phoneFilter) phoneFilter.addEventListener('change', () => { currentPage = 1; this.applyFilters(); });

            const activityFilter = document.getElementById('pc-activity-filter');
            if (activityFilter) activityFilter.addEventListener('change', () => { currentPage = 1; this.applyFilters(); });

            const pageSizeSelect = document.getElementById('pc-page-size');
            if (pageSizeSelect) pageSizeSelect.addEventListener('change', function () {
                pageSize = parseInt(this.value) || 50;
                currentPage = 1;
                self.renderCurrentPage();
            });

            // Export button
            const exportBtn = document.getElementById('pc-export-btn');
            const exportMenu = document.getElementById('pc-export-menu');
            if (exportBtn && exportMenu) {
                exportBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    exportMenu.style.display = exportMenu.style.display === 'none' ? 'block' : 'none';
                });
                document.addEventListener('click', () => { exportMenu.style.display = 'none'; });

                exportMenu.querySelectorAll('.as-export-option').forEach(opt => {
                    opt.addEventListener('click', () => {
                        exportMenu.style.display = 'none';
                        if (opt.dataset.type === 'excel') this.exportExcel();
                        else if (opt.dataset.type === 'pdf') this.exportPDF();
                    });
                });
            }

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) {
                dashLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    PharmaFlow.Sidebar.setActive('dashboard', null);
                });
            }
        },

        subscribeSales: function () {
            const businessId = this.getBusinessId();
            if (unsubCustomerSales) { unsubCustomerSales(); unsubCustomerSales = null; }
            if (!businessId) return;

            const col = getBusinessCollection(businessId, 'sales');
            if (!col) return;

            unsubCustomerSales = col.onSnapshot(snapshot => {
                customerSalesData = [];
                snapshot.forEach(doc => customerSalesData.push({ id: doc.id, ...doc.data() }));
                this.aggregateCustomers();
                this.applyFilters();
            }, err => {
                console.error('Customer sales subscription error:', err);
                this.showToast('Failed to load customers.', 'error');
            });
        },

        aggregateCustomers: function () {
            const map = new Map();

            customerSalesData.forEach(sale => {
                const name = (sale.customer?.name || '').trim();
                const phone = (sale.customer?.phone || '').trim();
                if (!name && !phone) return;

                const key = (name || 'walk-in').toLowerCase() + '|' + this.normalizePhone(phone || 'no-phone');
                if (!map.has(key)) {
                    map.set(key, {
                        key: key,
                        name: name || 'Walk-in Customer',
                        phone: phone || '—',
                        email: (sale.customer?.email || '').trim(),
                        transactions: 0,
                        items: 0,
                        totalSpent: 0,
                        lastPurchase: null,
                        lastPayment: '',
                        sales: []
                    });
                }

                const c = map.get(key);
                const dt = this.parseDate(sale);
                const isCancelled = (sale.status || 'completed') === 'cancelled';

                c.sales.push({ ...sale, _parsedDate: dt });

                if (!isCancelled) {
                    c.transactions += 1;
                    c.items += (sale.itemCount || 0);
                    c.totalSpent += (sale.total || 0);
                }

                if (!c.lastPurchase || (dt && c.lastPurchase && dt.getTime() > c.lastPurchase.getTime()) || (dt && !c.lastPurchase)) {
                    c.lastPurchase = dt;
                    c.lastPayment = (sale.paymentMethod || '').toUpperCase() || '—';
                }

                if (!c.email && sale.customer?.email) {
                    c.email = String(sale.customer.email).trim();
                }
            });

            customerRows = Array.from(map.values()).map(c => {
                c.sales.sort((a, b) => {
                    const ta = a._parsedDate ? a._parsedDate.getTime() : 0;
                    const tb = b._parsedDate ? b._parsedDate.getTime() : 0;
                    return tb - ta;
                });
                return c;
            });

            customerRows.sort((a, b) => {
                const ta = a.lastPurchase ? a.lastPurchase.getTime() : 0;
                const tb = b.lastPurchase ? b.lastPurchase.getTime() : 0;
                return tb - ta;
            });
        },

        applyFilters: function () {
            const query = (document.getElementById('pc-search')?.value || '').toLowerCase().trim();
            const phoneFilter = document.getElementById('pc-phone-filter')?.value || '';
            const activityFilter = parseInt(document.getElementById('pc-activity-filter')?.value || '0') || 0;
            const now = new Date();

            filteredCustomerRows = customerRows.filter(c => {
                if (phoneFilter === 'with-phone' && c.phone === '—') return false;
                if (phoneFilter === 'without-phone' && c.phone !== '—') return false;

                if (activityFilter > 0) {
                    if (!c.lastPurchase) return false;
                    const diffDays = (now.getTime() - c.lastPurchase.getTime()) / (1000 * 60 * 60 * 24);
                    if (diffDays > activityFilter) return false;
                }

                if (query) {
                    const inSales = c.sales.some(s => (s.saleId || '').toLowerCase().includes(query));
                    const match = c.name.toLowerCase().includes(query)
                        || (c.phone || '').toLowerCase().includes(query)
                        || inSales;
                    if (!match) return false;
                }

                return true;
            });

            this.updateStats();
            this.renderCurrentPage();
        },

        updateStats: function () {
            const totalCustomers = filteredCustomerRows.length;
            const withPhone = filteredCustomerRows.filter(c => c.phone !== '—').length;
            const revenue = filteredCustomerRows.reduce((sum, c) => sum + c.totalSpent, 0);
            const tx = filteredCustomerRows.reduce((sum, c) => sum + c.transactions, 0);

            const setText = (id, value) => {
                const el = document.getElementById(id);
                if (el) el.textContent = value;
            };

            setText('pc-total-customers', totalCustomers);
            setText('pc-with-phone', withPhone);
            setText('pc-revenue', this.formatCurrency(revenue));
            setText('pc-transactions', tx);
        },

        renderCurrentPage: function () {
            const tbody = document.getElementById('pc-tbody');
            if (!tbody) return;

            const totalPages = Math.max(1, Math.ceil(filteredCustomerRows.length / pageSize));
            if (currentPage > totalPages) currentPage = totalPages;

            const start = (currentPage - 1) * pageSize;
            const pageData = filteredCustomerRows.slice(start, start + pageSize);

            if (pageData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10" class="sales-loading"><i class="fas fa-inbox"></i> No customers found</td></tr>';
                this.renderPagination(0, 0);
                return;
            }

            tbody.innerHTML = pageData.map((c, i) => `
                <tr>
                    <td>${start + i + 1}</td>
                    <td>
                        <div class="pc-customer-cell">
                            <span class="pc-customer-avatar">${this.escapeHtml((c.name || '?').charAt(0).toUpperCase())}</span>
                            <span>${this.escapeHtml(c.name)}</span>
                        </div>
                    </td>
                    <td>${this.escapeHtml(c.phone)}</td>
                    <td>${c.transactions}</td>
                    <td><span class="pc-frequency-badge pc-frequency--${this.getCustomerFrequencyMeta(c.transactions).key}">${this.getCustomerFrequencyMeta(c.transactions).label}</span></td>
                    <td>${c.items}</td>
                    <td><strong>${this.formatCurrency(c.totalSpent)}</strong></td>
                    <td>${this.formatDate(c.lastPurchase)}</td>
                    <td>${this.escapeHtml(c.lastPayment || '—')}</td>
                    <td>
                        <button class="sales-action-btn sales-action--view" data-action="history" data-key="${this.escapeHtml(c.key)}" title="View Sales History">
                            <i class="fas fa-clock-rotate-left"></i>
                        </button>
                        <button class="sales-action-btn sales-action--approve" data-action="new-sale" data-key="${this.escapeHtml(c.key)}" title="New Sale for Customer">
                            <i class="fas fa-cart-plus"></i>
                        </button>
                        <button class="sales-action-btn pc-message-btn" data-action="message" data-key="${this.escapeHtml(c.key)}" title="Message Customer">
                            <i class="fas fa-comments"></i>
                        </button>
                    </td>
                </tr>
            `).join('');

            tbody.querySelectorAll('[data-action="history"]').forEach(btn => {
                btn.addEventListener('click', () => this.openHistoryModal(btn.dataset.key));
            });

            tbody.querySelectorAll('[data-action="new-sale"]').forEach(btn => {
                btn.addEventListener('click', () => this.openPosWithCustomer(btn.dataset.key));
            });

            tbody.querySelectorAll('[data-action="message"]').forEach(btn => {
                btn.addEventListener('click', () => this.openMessageModal(btn.dataset.key));
            });

            this.renderPagination(totalPages, filteredCustomerRows.length);
        },

        renderPagination: function (totalPages, totalItems) {
            const container = document.getElementById('pc-pagination');
            if (!container) return;

            if (totalPages <= 1) { container.innerHTML = ''; return; }

            let html = '<div class="sales-page-info">Page ' + currentPage + ' of ' + totalPages + ' (' + totalItems + ' customers)</div><div class="sales-page-btns">';
            html += '<button class="sales-page-btn" data-page="1" ' + (currentPage === 1 ? 'disabled' : '') + '><i class="fas fa-angles-left"></i></button>';
            html += '<button class="sales-page-btn" data-page="' + (currentPage - 1) + '" ' + (currentPage === 1 ? 'disabled' : '') + '><i class="fas fa-angle-left"></i></button>';

            const startPage = Math.max(1, currentPage - 2);
            const endPage = Math.min(totalPages, currentPage + 2);
            for (let p = startPage; p <= endPage; p++) {
                html += '<button class="sales-page-btn ' + (p === currentPage ? 'active' : '') + '" data-page="' + p + '">' + p + '</button>';
            }

            html += '<button class="sales-page-btn" data-page="' + (currentPage + 1) + '" ' + (currentPage === totalPages ? 'disabled' : '') + '><i class="fas fa-angle-right"></i></button>';
            html += '<button class="sales-page-btn" data-page="' + totalPages + '" ' + (currentPage === totalPages ? 'disabled' : '') + '><i class="fas fa-angles-right"></i></button>';
            html += '</div>';
            container.innerHTML = html;

            container.querySelectorAll('.sales-page-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const p = parseInt(btn.dataset.page);
                    if (p >= 1 && p <= totalPages && p !== currentPage) {
                        currentPage = p;
                        this.renderCurrentPage();
                    }
                });
            });
        },

        openPosWithCustomer: function (key) {
            const customer = customerRows.find(c => c.key === key);
            if (!customer) return;

            localStorage.setItem('pf_pos_customer_prefill', JSON.stringify({
                name: customer.name === 'Walk-in Customer' ? '' : customer.name,
                phone: customer.phone === '—' ? '' : customer.phone
            }));

            PharmaFlow.Sidebar.setActive('pharmacy', 'pos');
        },

        openHistoryModal: function (key) {
            const customer = customerRows.find(c => c.key === key);
            if (!customer) return;

            const existing = document.getElementById('pc-history-modal');
            if (existing) existing.remove();

            const rowsHtml = customer.sales.map((sale, i) => {
                const dt = sale._parsedDate;
                const status = (sale.status || 'completed');
                return `
                    <tr>
                        <td>${i + 1}</td>
                        <td><code class="sales-receipt-code">${this.escapeHtml(sale.saleId || sale.id)}</code></td>
                        <td>${this.formatDateTime(dt)}</td>
                        <td>${this.formatCurrency(sale.total || 0)}</td>
                        <td>${this.escapeHtml((sale.paymentMethod || '').toUpperCase() || '—')}</td>
                        <td>${this.escapeHtml(status)}</td>
                        <td>
                            <button class="sales-action-btn sales-action--view" data-sale-id="${this.escapeHtml(sale.id)}" title="View Receipt">
                                <i class="fas fa-eye"></i>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');

            const modal = document.createElement('div');
            modal.className = 'pc-modal-overlay';
            modal.id = 'pc-history-modal';
            modal.innerHTML = `
                <div class="pc-modal-card">
                    <div class="pc-modal-header">
                        <h3><i class="fas fa-user-clock"></i> ${this.escapeHtml(customer.name)} - Sales History</h3>
                        <button class="slide-panel-close" id="pc-close-modal"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="pc-modal-meta">
                        <span><strong>Phone:</strong> ${this.escapeHtml(customer.phone)}</span>
                        <span><strong>Transactions:</strong> ${customer.transactions}</span>
                        <span><strong>Total Spent:</strong> ${this.formatCurrency(customer.totalSpent)}</span>
                    </div>
                    <div class="pc-modal-body">
                        <table class="sales-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Receipt #</th>
                                    <th>Date</th>
                                    <th>Total</th>
                                    <th>Payment</th>
                                    <th>Status</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>${rowsHtml || '<tr><td colspan="7" class="sales-loading">No sales found</td></tr>'}</tbody>
                        </table>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const close = () => modal.remove();
            document.getElementById('pc-close-modal')?.addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            modal.querySelectorAll('[data-sale-id]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const sale = customer.sales.find(s => s.id === btn.dataset.saleId);
                    if (sale && PharmaFlow.POS) {
                        PharmaFlow.POS.showReceipt(sale, sale.changeDue || 0);
                    }
                });
            });
        },

        openMessageModal: function (key) {
            const customer = customerRows.find(c => c.key === key);
            if (!customer) return;

            const existing = document.getElementById('pc-message-modal');
            if (existing) existing.remove();

            const phoneForWhatsapp = this.normalizeWhatsAppPhone(customer.phone);
            const defaultMessage = this.buildCustomerMessage(customer);
            const modal = document.createElement('div');
            modal.className = 'pc-modal-overlay';
            modal.id = 'pc-message-modal';
            modal.innerHTML = `
                <div class="pc-modal-card pc-message-modal-card">
                    <div class="pc-modal-header">
                        <h3><i class="fas fa-comments"></i> Message ${this.escapeHtml(customer.name)}</h3>
                        <button class="slide-panel-close" id="pc-msg-close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="pc-modal-meta">
                        <span><strong>Phone:</strong> ${this.escapeHtml(customer.phone)}</span>
                        <span><strong>Email:</strong> ${this.escapeHtml(customer.email || '—')}</span>
                    </div>
                    <div class="pc-modal-body">
                        <div class="pc-msg-fields">
                            <div class="pc-msg-group">
                                <label>Phone</label>
                                <input type="text" id="pc-msg-phone" value="${this.escapeHtml(customer.phone === '—' ? '' : customer.phone)}" placeholder="e.g. 0712345678">
                            </div>
                            <div class="pc-msg-group">
                                <label>Email</label>
                                <input type="email" id="pc-msg-email" value="${this.escapeHtml(customer.email || '')}" placeholder="customer@email.com">
                            </div>
                            <div class="pc-msg-group pc-msg-group--full">
                                <label>Message</label>
                                <textarea id="pc-msg-text" rows="4" placeholder="Type message...">${this.escapeHtml(defaultMessage)}</textarea>
                            </div>
                        </div>
                        <div class="pc-msg-actions">
                            <button class="btn btn-outline" id="pc-send-sms"><i class="fas fa-message"></i> SMS</button>
                            <button class="btn btn-primary" id="pc-send-whatsapp"><i class="fab fa-whatsapp"></i> WhatsApp</button>
                            <button class="btn btn-outline" id="pc-send-email"><i class="fas fa-envelope"></i> Email</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const close = () => modal.remove();
            document.getElementById('pc-msg-close')?.addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            const getMsg = () => document.getElementById('pc-msg-text')?.value?.trim() || '';
            const getPhone = () => document.getElementById('pc-msg-phone')?.value?.trim() || '';
            const getEmail = () => document.getElementById('pc-msg-email')?.value?.trim() || '';

            document.getElementById('pc-send-whatsapp')?.addEventListener('click', () => {
                const phone = this.normalizeWhatsAppPhone(getPhone() || phoneForWhatsapp);
                const msg = getMsg();
                if (!phone) { this.showToast('Customer phone is required for WhatsApp.', 'error'); return; }
                const url = 'https://wa.me/' + encodeURIComponent(phone) + '?text=' + encodeURIComponent(msg);
                window.open(url, '_blank');
            });

            document.getElementById('pc-send-sms')?.addEventListener('click', () => {
                const phone = getPhone();
                const msg = getMsg();
                if (!phone) { this.showToast('Customer phone is required for SMS.', 'error'); return; }
                window.location.href = 'sms:' + encodeURIComponent(phone) + '?body=' + encodeURIComponent(msg);
            });

            document.getElementById('pc-send-email')?.addEventListener('click', () => {
                const email = getEmail();
                const msg = getMsg();
                if (!email) { this.showToast('Customer email is required for email.', 'error'); return; }
                const subject = 'Message from ' + (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow');
                window.location.href = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(msg);
            });
        },

        exportExcel: function () {
            if (filteredCustomerRows.length === 0) {
                this.showToast('No customers to export', 'error');
                return;
            }

            const rows = filteredCustomerRows.map(c => ({
                'Customer': c.name,
                'Phone': c.phone === '—' ? '' : c.phone,
                'Transactions': c.transactions || 0,
                'Frequency': this.getCustomerFrequencyMeta(c.transactions).label,
                'Items': c.items || 0,
                'Total Spent': c.totalSpent || 0,
                'Last Purchase': c.lastPurchase ? this.formatDateTime(c.lastPurchase) : '',
                'Last Payment': c.lastPayment || '',
                'Last Receipt #': c.sales && c.sales[0] ? (c.sales[0].saleId || c.sales[0].id || '') : ''
            }));

            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Customers');
            XLSX.writeFile(wb, (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow').replace(/\s+/g, '') + '_Customers_' + new Date().toISOString().split('T')[0] + '.xlsx');
            this.showToast('Customers Excel exported!');
        },

        exportPDF: function () {
            if (filteredCustomerRows.length === 0) {
                this.showToast('No customers to export', 'error');
                return;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('landscape');
            doc.setFontSize(16);
            doc.text((PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow') + ' - Pharmacy Customers', 14, 18);
            doc.setFontSize(10);
            doc.text('Generated: ' + new Date().toLocaleString('en-KE'), 14, 26);

            const rows = filteredCustomerRows.map((c, i) => [
                i + 1,
                c.name,
                c.phone === '—' ? '' : c.phone,
                c.transactions || 0,
                this.getCustomerFrequencyMeta(c.transactions).label,
                c.items || 0,
                this.formatCurrency(c.totalSpent || 0),
                c.lastPurchase ? this.formatDate(c.lastPurchase) : '—',
                c.lastPayment || '—'
            ]);

            doc.autoTable({
                startY: 32,
                head: [['#', 'Customer', 'Phone', 'Transactions', 'Frequency', 'Items', 'Total Spent', 'Last Purchase', 'Last Payment']],
                body: rows,
                styles: { fontSize: 8 },
                headStyles: { fillColor: [37, 99, 235] }
            });

            doc.save((PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow').replace(/\s+/g, '') + '_Customers_' + new Date().toISOString().split('T')[0] + '.pdf');
            this.showToast('Customers PDF exported!');
        },

        cleanup: function () {
            if (unsubCustomerSales) { unsubCustomerSales(); unsubCustomerSales = null; }
            customerSalesData = [];
            customerRows = [];
            filteredCustomerRows = [];
        }
    };

    window.PharmaFlow.PharmacyCustomers = PharmacyCustomers;
})();
