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
    let selectedCustomerKeys = new Set();
    let currentPage = 1;
    let pageSize = 50;

    const PharmacyCustomers = {

        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        getMessageHistoryKey: function () {
            return 'pf_message_history_' + (this.getBusinessId() || 'global');
        },

        getMessageHistoryCollection: function () {
            const businessId = this.getBusinessId();
            if (!businessId || !PharmaFlow.getBusinessCollection) return null;
            return PharmaFlow.getBusinessCollection(businessId, 'message_history');
        },

        loadMessageHistory: function () {
            try {
                const raw = localStorage.getItem(this.getMessageHistoryKey());
                const items = raw ? JSON.parse(raw) : [];
                return Array.isArray(items) ? items : [];
            } catch (err) {
                return [];
            }
        },

        saveMessageHistory: function (history) {
            try {
                localStorage.setItem(this.getMessageHistoryKey(), JSON.stringify(history || []));
            } catch (err) {
                console.error('Failed to save message history:', err);
            }
        },

        loadMessageHistoryFromFirestore: async function () {
            const ref = this.getMessageHistoryCollection();
            if (!ref) return this.loadMessageHistory();

            try {
                const snap = await ref.orderBy('createdAt', 'desc').limit(100).get();
                const history = [];
                snap.forEach(doc => history.push({ id: doc.id, ...doc.data() }));
                this.saveMessageHistory(history);
                return history;
            } catch (err) {
                console.error('Failed to load message history from Firestore:', err);
                return this.loadMessageHistory();
            }
        },

        persistMessageHistoryToFirestore: async function (entry) {
            const ref = this.getMessageHistoryCollection();
            if (!ref) return entry;

            const payload = {
                ...entry,
                updatedAt: new Date().toISOString()
            };

            try {
                if (entry.id) {
                    await ref.doc(entry.id).set(payload, { merge: true });
                    return { ...payload, id: entry.id };
                }

                const docRef = await ref.add(payload);
                return { ...payload, id: docRef.id };
            } catch (err) {
                console.error('Failed to persist message history entry:', err);
                return entry;
            }
        },

        addMessageHistoryEntry: async function (entry) {
            const history = this.loadMessageHistory();
            const record = {
                id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
                createdAt: new Date().toISOString(),
                note: '',
                ...entry
            };
            history.unshift(record);
            this.saveMessageHistory(history);
            return await this.persistMessageHistoryToFirestore(record);
        },

        updateMessageHistoryEntry: async function (entryId, updates) {
            const history = this.loadMessageHistory();
            const index = history.findIndex(item => item.id === entryId);
            if (index < 0) return null;
            history[index] = { ...history[index], ...updates };
            this.saveMessageHistory(history);
            await this.persistMessageHistoryToFirestore(history[index]);
            return history[index];
        },

        deleteMessageHistoryEntry: async function (entryId) {
            const history = this.loadMessageHistory().filter(item => item.id !== entryId);
            this.saveMessageHistory(history);
            const ref = this.getMessageHistoryCollection();
            if (ref) {
                try {
                    await ref.doc(entryId).delete();
                } catch (err) {
                    console.error('Failed to delete message history entry:', err);
                }
            }
            return history;
        },

        getChannelLabel: function (channel) {
            if (channel === 'email') return 'Email';
            if (channel === 'sms') return 'SMS';
            if (channel === 'whatsapp') return 'WhatsApp';
            if (channel === 'all') return 'All Channels';
            return channel || 'Message';
        },

        formatHistoryRecipients: function (entry) {
            const total = parseInt(entry.recipientCount, 10) || 0;
            const sent = parseInt(entry.sentCount, 10) || 0;
            const failed = parseInt(entry.failedCount, 10) || 0;
            return total + ' total' + (sent ? ', ' + sent + ' sent' : '') + (failed ? ', ' + failed + ' failed' : '');
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

        buildBulkCustomerMessage: function (count) {
            const businessName = PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow';
            return 'Hello, this is ' + businessName + '. We are reaching out to keep you informed about our pharmacy services, medication support, and refill reminders. Thank you for choosing us. (' + count + ' customers selected)';
        },

        getSelectedBulkCustomers: function () {
            const selected = customerRows.filter(c => selectedCustomerKeys.has(c.key));
            return selected.length > 0 ? selected : filteredCustomerRows.slice();
        },

        getBulkContactSummary: function (customers) {
            const uniqueEmails = new Set();
            const uniquePhones = new Set();
            const validWhatsApp = new Set();

            customers.forEach(customer => {
                const email = (customer.email || '').trim();
                const phone = (customer.phone || '').trim();
                if (email && email !== '—') uniqueEmails.add(email.toLowerCase());
                if (phone && phone !== '—') uniquePhones.add(phone);
                const wa = this.normalizeWhatsAppPhone(phone);
                if (wa) validWhatsApp.add(wa);
            });

            return {
                emails: Array.from(uniqueEmails),
                phones: Array.from(uniquePhones),
                whatsappPhones: Array.from(validWhatsApp)
            };
        },

        getMessagingIntegrations: function () {
            return PharmaFlow.Settings && PharmaFlow.Settings.getMessagingIntegrations
                ? PharmaFlow.Settings.getMessagingIntegrations()
                : {
                    provider: 'mixed',
                    africaTalkingUsername: '',
                    africaTalkingApiKey: '',
                    africaTalkingSenderId: '',
                    emailJsServiceId: '',
                    emailJsTemplateId: '',
                    emailJsPublicKey: '',
                    whatsappCallMeBotPhone: '',
                    whatsappCallMeBotApiKey: ''
                };
        },

        sendBulkSmsViaApi: async function (customers, message) {
            const cfg = this.getMessagingIntegrations();
            if (!cfg.africaTalkingUsername || !cfg.africaTalkingApiKey) return { ok: false, reason: 'missing-config' };

            const recipients = customers.map(customer => ({
                name: customer.name,
                phone: this.normalizePhone(customer.phone)
            })).filter(customer => customer.phone);

            if (recipients.length === 0) return { ok: false, reason: 'no-recipients' };

            let sent = 0;
            let failed = 0;

            for (const customer of recipients) {
                try {
                    const form = new URLSearchParams();
                    form.set('username', cfg.africaTalkingUsername);
                    form.set('to', customer.phone);
                    form.set('message', 'Hello ' + customer.name + ', ' + message);
                    if (cfg.africaTalkingSenderId) form.set('from', cfg.africaTalkingSenderId);

                    const response = await fetch('https://api.africastalking.com/version1/messaging', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Accept': 'application/json',
                            'apiKey': cfg.africaTalkingApiKey
                        },
                        body: form.toString()
                    });

                    if (!response.ok) throw new Error('Africa\'s Talking request failed');
                    sent += 1;
                } catch (err) {
                    console.error('Africa\'s Talking SMS failed:', customer.phone, err);
                    failed += 1;
                }
            }

            return { ok: sent > 0, sent, failed };
        },

        sendBulkEmailViaApi: async function (customers, message) {
            const cfg = this.getMessagingIntegrations();
            if (!cfg.emailJsServiceId || !cfg.emailJsTemplateId || !cfg.emailJsPublicKey) return { ok: false, reason: 'missing-config' };

            const recipients = customers.filter(c => (c.email || '').trim() && c.email !== '—');
            if (recipients.length === 0) return { ok: false, reason: 'no-recipients' };

            let sent = 0;
            let failed = 0;

            for (const customer of recipients) {
                try {
                    const payload = {
                        service_id: cfg.emailJsServiceId,
                        template_id: cfg.emailJsTemplateId,
                        user_id: cfg.emailJsPublicKey,
                        template_params: {
                            to_name: customer.name,
                            to_email: customer.email,
                            message: message,
                            business_name: PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow',
                            customer_phone: customer.phone || ''
                        }
                    };

                    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) throw new Error('EmailJS request failed');
                    sent += 1;
                } catch (err) {
                    console.error('EmailJS send failed:', customer.email, err);
                    failed += 1;
                }
            }

            return { ok: sent > 0, sent, failed };
        },

        sendBulkWhatsAppViaApi: async function (customers, message) {
            const cfg = this.getMessagingIntegrations();
            if (!cfg.whatsappCallMeBotPhone || !cfg.whatsappCallMeBotApiKey) return { ok: false, reason: 'missing-config' };

            const recipients = customers.map(customer => ({
                name: customer.name,
                phone: this.normalizeWhatsAppPhone(customer.phone)
            })).filter(customer => customer.phone);

            if (recipients.length === 0) return { ok: false, reason: 'no-recipients' };

            let sent = 0;
            let failed = 0;

            for (const customer of recipients) {
                try {
                    const text = 'Hello ' + customer.name + ', ' + message;
                    const url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(customer.phone) + '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(cfg.whatsappCallMeBotApiKey);
                    await fetch(url, { method: 'GET', mode: 'no-cors' });
                    sent += 1;
                } catch (err) {
                    console.error('CallMeBot send failed:', customer.phone, err);
                    failed += 1;
                }
            }

            return { ok: sent > 0, sent, failed };
        },

        setSelectedCustomerKeys: function (keys) {
            selectedCustomerKeys = new Set(keys || []);
            this.updateSelectionUi();
            this.renderCurrentPage();
        },

        selectAllFilteredCustomers: function () {
            this.setSelectedCustomerKeys(filteredCustomerRows.map(c => c.key));
        },

        clearSelectedCustomers: function () {
            this.setSelectedCustomerKeys([]);
        },

        updateSelectionUi: function () {
            const selectedCount = selectedCustomerKeys.size;
            const countEl = document.getElementById('pc-selected-count');
            if (countEl) countEl.textContent = String(selectedCount);

            const selectAllBtn = document.getElementById('pc-select-all-btn');
            if (selectAllBtn) {
                selectAllBtn.innerHTML = '<i class="fas fa-check-square"></i> Select All Filtered';
            }
        },

        openMessageHistoryModal: function () {
            const existing = document.getElementById('pc-history-modal-overlay');
            if (existing) existing.remove();

            const modal = document.createElement('div');
            modal.className = 'pc-modal-overlay';
            modal.id = 'pc-history-modal-overlay';
            modal.innerHTML = `
                <div class="pc-modal-card pc-history-modal-card">
                    <div class="pc-modal-header">
                        <h3><i class="fas fa-clock-rotate-left"></i> Message History</h3>
                        <button class="slide-panel-close" id="pc-history-close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="pc-modal-meta">
                        <span><strong>Messages:</strong> <span id="pc-history-count">0</span></span>
                        <span><strong>Storage:</strong> Firestore</span>
                        <span><strong>Business:</strong> ${this.escapeHtml(PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow')}</span>
                    </div>
                    <div class="pc-modal-body" id="pc-history-modal-body">
                        <div class="pc-history-loading"><i class="fas fa-spinner fa-spin"></i> Loading message history...</div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const close = () => modal.remove();
            document.getElementById('pc-history-close')?.addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            const load = async () => {
                const history = await this.loadMessageHistoryFromFirestore();
                if (!modal.isConnected) return;

                const countEl = document.getElementById('pc-history-count');
                const body = document.getElementById('pc-history-modal-body');
                if (countEl) countEl.textContent = String(history.length);
                if (!body) return;

                body.innerHTML = `
                    <div class="pc-history-list">
                        ${history.length ? history.map(entry => this.renderHistoryCard(entry)).join('') : '<div class="pc-history-empty"><i class="fas fa-inbox"></i><p>No message history yet.</p></div>'}
                    </div>
                `;

                body.querySelectorAll('[data-history-action="view"]').forEach(btn => {
                    btn.addEventListener('click', () => this.openHistoryEntryView(btn.dataset.entryId));
                });

                body.querySelectorAll('[data-history-action="note"]').forEach(btn => {
                    btn.addEventListener('click', () => this.openHistoryNotePrompt(btn.dataset.entryId));
                });

                body.querySelectorAll('[data-history-action="delete"]').forEach(btn => {
                    btn.addEventListener('click', () => this.deleteHistoryEntry(btn.dataset.entryId));
                });
            };

            load();
        },

        renderHistoryCard: function (entry) {
            const note = entry.note ? `<div class="pc-history-note"><i class="fas fa-sticky-note"></i> ${this.escapeHtml(entry.note)}</div>` : '';
            const statusClass = entry.status === 'sent' ? 'pc-history-status--success' : (entry.status === 'opened' ? 'pc-history-status--info' : 'pc-history-status--muted');
            const channels = Array.isArray(entry.channels) ? entry.channels.map(ch => `<span class="pc-history-chip">${this.escapeHtml(this.getChannelLabel(ch))}</span>`).join('') : '';

            return `
                <article class="pc-history-card">
                    <div class="pc-history-card__top">
                        <div>
                            <h4>${this.escapeHtml(entry.title || 'Bulk Message')}</h4>
                            <div class="pc-history-meta pc-history-meta--compact">
                                <span>${this.escapeHtml(new Date(entry.createdAt || Date.now()).toLocaleString('en-KE'))}</span>
                                <span class="pc-history-status ${statusClass}">${this.escapeHtml(entry.status || 'drafted')}</span>
                            </div>
                        </div>
                        <div class="pc-history-actions-top">
                            <button class="btn btn-sm btn-outline" data-history-action="view" data-entry-id="${this.escapeHtml(entry.id)}"><i class="fas fa-eye"></i> View</button>
                            <button class="btn btn-sm btn-outline" data-history-action="note" data-entry-id="${this.escapeHtml(entry.id)}"><i class="fas fa-sticky-note"></i></button>
                            <button class="btn btn-sm btn-danger" data-history-action="delete" data-entry-id="${this.escapeHtml(entry.id)}"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="pc-history-summary">${this.escapeHtml(this.formatHistoryRecipients(entry))}</div>
                    <div class="pc-history-channels">${channels}</div>
                    ${note}
                </article>
            `;
        },

        openHistoryEntryView: function (entryId) {
            const entry = this.loadMessageHistory().find(item => item.id === entryId);
            if (!entry) return;

            const existing = document.getElementById('pc-history-view-modal');
            if (existing) existing.remove();

            const preview = (entry.message || '').length > 500 ? entry.message.slice(0, 500) + '…' : (entry.message || '');
            const recipientsHtml = (entry.recipients || []).map(rec => `<li><strong>${this.escapeHtml(rec.name || 'Customer')}</strong>${rec.email ? ' • ' + this.escapeHtml(rec.email) : ''}${rec.phone ? ' • ' + this.escapeHtml(rec.phone) : ''}</li>`).join('');

            const modal = document.createElement('div');
            modal.className = 'pc-modal-overlay';
            modal.id = 'pc-history-view-modal';
            modal.innerHTML = `
                <div class="pc-modal-card pc-history-view-card">
                    <div class="pc-modal-header">
                        <h3><i class="fas fa-eye"></i> Message Details</h3>
                        <button class="slide-panel-close" id="pc-history-view-close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="pc-modal-meta">
                        <span><strong>Status:</strong> ${this.escapeHtml(entry.status || 'drafted')}</span>
                        <span><strong>Channel(s):</strong> ${this.escapeHtml((entry.channels || []).map(ch => this.getChannelLabel(ch)).join(', ') || '—')}</span>
                        <span><strong>Date:</strong> ${this.escapeHtml(new Date(entry.createdAt || Date.now()).toLocaleString('en-KE'))}</span>
                    </div>
                    <div class="pc-modal-body">
                        <div class="pc-history-detail-grid">
                            <div class="pc-history-detail-block">
                                <h4>Message</h4>
                                <p>${this.escapeHtml(preview || '—')}</p>
                            </div>
                            <div class="pc-history-detail-block">
                                <h4>Recipients</h4>
                                <ul class="pc-history-recipient-list">${recipientsHtml || '<li>No recipients</li>'}</ul>
                            </div>
                        </div>
                        <div class="pc-history-note pc-history-note--large">${entry.note ? '<i class="fas fa-sticky-note"></i> ' + this.escapeHtml(entry.note) : 'No note added.'}</div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            const close = () => modal.remove();
            document.getElementById('pc-history-view-close')?.addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        },

        openHistoryNotePrompt: async function (entryId) {
            const entry = this.loadMessageHistory().find(item => item.id === entryId);
            if (!entry) return;

            const note = window.prompt('Add a note for this message:', entry.note || '');
            if (note === null) return;

            await this.updateMessageHistoryEntry(entryId, { note: note.trim() });
            this.openMessageHistoryModal();
        },

        deleteHistoryEntry: async function (entryId) {
            if (!window.confirm('Delete this message history entry?')) return;
            await this.deleteMessageHistoryEntry(entryId);
            this.openMessageHistoryModal();
        },

        openBulkMessageModal: function () {
            const customers = this.getSelectedBulkCustomers();
            const existing = document.getElementById('pc-bulk-message-modal');
            if (existing) existing.remove();

            if (!customers.length) {
                this.showToast('No customers available for bulk messaging.', 'error');
                return;
            }

            const contactSummary = this.getBulkContactSummary(customers);
            const defaultMessage = this.buildBulkCustomerMessage(customers.length);
            const previewCustomers = customers.slice(0, 8);

            const modal = document.createElement('div');
            modal.className = 'pc-modal-overlay';
            modal.id = 'pc-bulk-message-modal';
            modal.innerHTML = `
                <div class="pc-modal-card pc-message-modal-card pc-bulk-message-modal-card">
                    <div class="pc-modal-header">
                        <h3><i class="fas fa-bullhorn"></i> Bulk Message Customers</h3>
                        <button class="slide-panel-close" id="pc-bulk-msg-close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="pc-modal-meta">
                        <span><strong>Customers:</strong> ${customers.length}</span>
                        <span><strong>Emails:</strong> ${contactSummary.emails.length}</span>
                        <span><strong>Phones:</strong> ${contactSummary.phones.length}</span>
                        <span><strong>WhatsApp:</strong> ${contactSummary.whatsappPhones.length}</span>
                    </div>
                    <div class="pc-modal-body">
                        <div class="pc-bulk-recipients">
                            ${previewCustomers.map(c => `
                                <span class="pc-bulk-recipient">${this.escapeHtml(c.name)}${c.phone && c.phone !== '—' ? ' • ' + this.escapeHtml(c.phone) : ''}</span>
                            `).join('')}
                            ${customers.length > previewCustomers.length ? '<span class="pc-bulk-recipient pc-bulk-recipient--more">+' + (customers.length - previewCustomers.length) + ' more</span>' : ''}
                        </div>
                        <div class="pc-msg-fields pc-bulk-fields">
                            <div class="pc-msg-group pc-msg-group--full">
                                <label>Message</label>
                                <textarea id="pc-bulk-msg-text" rows="5" placeholder="Type bulk message...">${this.escapeHtml(defaultMessage)}</textarea>
                            </div>
                            <div class="pc-msg-group pc-msg-group--full">
                                <label>Channels</label>
                                <div class="pc-bulk-channels">
                                    <label class="pc-bulk-channel"><input type="checkbox" id="pc-bulk-email" checked> <span>Email (BCC all)</span></label>
                                    <label class="pc-bulk-channel"><input type="checkbox" id="pc-bulk-sms" checked> <span>SMS (opens each message)</span></label>
                                    <label class="pc-bulk-channel"><input type="checkbox" id="pc-bulk-whatsapp" checked> <span>WhatsApp (opens each chat)</span></label>
                                </div>
                            </div>
                            <div class="pc-msg-group pc-msg-group--full">
                                <div class="pc-bulk-note">
                                    Email uses BCC to avoid exposing addresses. SMS and WhatsApp will open one message window per customer because those channels do not support true multi-recipient sending from the browser.
                                </div>
                            </div>
                        </div>
                        <div class="pc-msg-actions">
                            <button class="btn btn-outline" id="pc-bulk-clear-selection"><i class="fas fa-eraser"></i> Clear Selection</button>
                            <button class="btn btn-outline" id="pc-bulk-send-email"><i class="fas fa-envelope"></i> Send Email</button>
                            <button class="btn btn-outline" id="pc-bulk-send-sms"><i class="fas fa-message"></i> Send SMS</button>
                            <button class="btn btn-primary" id="pc-bulk-send-whatsapp"><i class="fab fa-whatsapp"></i> Send WhatsApp</button>
                            <button class="btn btn-primary" id="pc-bulk-send-all"><i class="fas fa-paper-plane"></i> Send Selected Channels</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const close = () => modal.remove();
            document.getElementById('pc-bulk-msg-close')?.addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            const getMsg = () => document.getElementById('pc-bulk-msg-text')?.value?.trim() || defaultMessage;

            const recordHistory = async (channel, status, meta) => {
                await this.addMessageHistoryEntry({
                    title: meta.title || 'Bulk ' + this.getChannelLabel(channel),
                    channel: channel,
                    channels: meta.channels || [channel],
                    status: status,
                    message: getMsg(),
                    recipientCount: meta.recipientCount || customers.length,
                    sentCount: meta.sentCount || 0,
                    failedCount: meta.failedCount || 0,
                    recipients: customers.map(customer => ({
                        name: customer.name,
                        phone: customer.phone,
                        email: customer.email
                    }))
                });
            };

            const launchEmail = async () => {
                if (!contactSummary.emails.length) { this.showToast('No customer emails found.', 'error'); return false; }
                const apiResult = await this.sendBulkEmailViaApi(customers, getMsg());
                if (apiResult.ok) {
                    this.showToast('Email sent to ' + apiResult.sent + ' customers via EmailJS.');
                    await recordHistory('email', 'sent', { channels: ['email'], recipientCount: contactSummary.emails.length, sentCount: apiResult.sent, failedCount: apiResult.failed });
                    return true;
                }

                const subject = 'Message from ' + (PharmaFlow.Settings ? PharmaFlow.Settings.getBusinessName() : 'PharmaFlow');
                const url = 'mailto:?bcc=' + encodeURIComponent(contactSummary.emails.join(',')) + '&subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(getMsg());
                window.location.href = url;
                await recordHistory('email', 'opened', { channels: ['email'], recipientCount: contactSummary.emails.length });
                return true;
            };

            const launchBulkLinks = (kind, urls) => {
                if (!urls.length) {
                    this.showToast('No valid ' + kind + ' recipients found.', 'error');
                    return false;
                }
                if (urls.length > 8 && !window.confirm('This will open ' + urls.length + ' ' + kind + ' message windows. Continue?')) {
                    return false;
                }
                urls.forEach((url, index) => {
                    setTimeout(() => window.open(url, '_blank'), index * 150);
                });
                return true;
            };

            const launchSms = async () => {
                const apiResult = await this.sendBulkSmsViaApi(customers, getMsg());
                if (apiResult.ok) {
                    this.showToast('SMS sent to ' + apiResult.sent + ' customers via Africa\'s Talking.');
                    await recordHistory('sms', 'sent', { channels: ['sms'], recipientCount: contactSummary.phones.length, sentCount: apiResult.sent, failedCount: apiResult.failed });
                    return true;
                }

                const urls = contactSummary.phones.map(phone => 'sms:' + encodeURIComponent(phone) + '?body=' + encodeURIComponent(getMsg()));
                await recordHistory('sms', 'opened', { channels: ['sms'], recipientCount: contactSummary.phones.length });
                return launchBulkLinks('SMS', urls);
            };

            const launchWhatsApp = async () => {
                const apiResult = await this.sendBulkWhatsAppViaApi(customers, getMsg());
                if (apiResult.ok) {
                    this.showToast('WhatsApp sent to ' + apiResult.sent + ' customers via CallMeBot.');
                    await recordHistory('whatsapp', 'sent', { channels: ['whatsapp'], recipientCount: contactSummary.whatsappPhones.length, sentCount: apiResult.sent, failedCount: apiResult.failed });
                    return true;
                }

                const urls = contactSummary.whatsappPhones.map(phone => 'https://wa.me/' + encodeURIComponent(phone) + '?text=' + encodeURIComponent(getMsg()));
                await recordHistory('whatsapp', 'opened', { channels: ['whatsapp'], recipientCount: contactSummary.whatsappPhones.length });
                return launchBulkLinks('WhatsApp', urls);
            };

            document.getElementById('pc-bulk-clear-selection')?.addEventListener('click', () => {
                this.clearSelectedCustomers();
                close();
            });

            document.getElementById('pc-bulk-send-email')?.addEventListener('click', async () => {
                const launched = await launchEmail();
                if (!launched) return;
            });

            document.getElementById('pc-bulk-send-sms')?.addEventListener('click', async () => {
                const launched = await launchSms();
                if (!launched) return;
            });

            document.getElementById('pc-bulk-send-whatsapp')?.addEventListener('click', async () => {
                const launched = await launchWhatsApp();
                if (!launched) return;
            });

            document.getElementById('pc-bulk-send-all')?.addEventListener('click', async () => {
                let launched = 0;
                if (document.getElementById('pc-bulk-email')?.checked && await launchEmail()) launched += 1;
                if (document.getElementById('pc-bulk-sms')?.checked && await launchSms()) launched += 1;
                if (document.getElementById('pc-bulk-whatsapp')?.checked && await launchWhatsApp()) launched += 1;
                if (launched > 0) {
                    this.showToast('Bulk message actions launched for ' + customers.length + ' customers.');
                    close();
                }
            });
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
                            <button class="btn btn-sm btn-outline" id="pc-history-btn">
                                <i class="fas fa-clock-rotate-left"></i> Message History
                            </button>
                            <button class="btn btn-sm btn-primary" id="pc-bulk-btn">
                                <i class="fas fa-bullhorn"></i> Bulk Message
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

                    <div class="pc-selection-bar">
                        <div class="pc-selection-bar__count"><i class="fas fa-check-square"></i> <span id="pc-selected-count">0</span> selected</div>
                        <div class="pc-selection-bar__actions">
                            <button class="btn btn-sm btn-outline" id="pc-select-all-btn"><i class="fas fa-check-square"></i> Select All Filtered</button>
                            <button class="btn btn-sm btn-outline" id="pc-clear-selected-btn"><i class="fas fa-eraser"></i> Clear Selection</button>
                        </div>
                    </div>

                    <div class="sales-table-wrapper">
                        <table class="sales-table">
                            <thead>
                                <tr>
                                    <th class="pc-select-col"><input type="checkbox" id="pc-select-all-page" title="Select all filtered customers"></th>
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
                                <tr><td colspan="11" class="sales-loading"><i class="fas fa-spinner fa-spin"></i> Loading customer activity...</td></tr>
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

            document.getElementById('pc-bulk-btn')?.addEventListener('click', () => this.openBulkMessageModal());
            document.getElementById('pc-history-btn')?.addEventListener('click', () => this.openMessageHistoryModal());
            document.getElementById('pc-select-all-btn')?.addEventListener('click', () => this.selectAllFilteredCustomers());
            document.getElementById('pc-clear-selected-btn')?.addEventListener('click', () => this.clearSelectedCustomers());

            const selectAllPage = document.getElementById('pc-select-all-page');
            if (selectAllPage) {
                selectAllPage.addEventListener('change', () => {
                    if (selectAllPage.checked) this.selectAllFilteredCustomers();
                    else this.clearSelectedCustomers();
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
                tbody.innerHTML = '<tr><td colspan="11" class="sales-loading"><i class="fas fa-inbox"></i> No customers found</td></tr>';
                this.renderPagination(0, 0);
                this.updateSelectionUi();
                return;
            }

            tbody.innerHTML = pageData.map((c, i) => `
                <tr>
                    <td class="pc-select-col">
                        <input type="checkbox" class="pc-row-select" data-key="${this.escapeHtml(c.key)}" ${selectedCustomerKeys.has(c.key) ? 'checked' : ''}>
                    </td>
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

            tbody.querySelectorAll('.pc-row-select').forEach(input => {
                input.addEventListener('change', () => {
                    const next = new Set(selectedCustomerKeys);
                    if (input.checked) next.add(input.dataset.key);
                    else next.delete(input.dataset.key);
                    selectedCustomerKeys = next;
                    this.updateSelectionUi();
                    this.renderCurrentPage();
                });
            });

            const selectAllPage = document.getElementById('pc-select-all-page');
            if (selectAllPage) {
                const allFilteredSelected = filteredCustomerRows.length > 0 && filteredCustomerRows.every(c => selectedCustomerKeys.has(c.key));
                selectAllPage.checked = allFilteredSelected;
                selectAllPage.indeterminate = selectedCustomerKeys.size > 0 && !allFilteredSelected;
            }

            tbody.querySelectorAll('[data-action="history"]').forEach(btn => {
                btn.addEventListener('click', () => this.openHistoryModal(btn.dataset.key));
            });

            tbody.querySelectorAll('[data-action="new-sale"]').forEach(btn => {
                btn.addEventListener('click', () => this.openPosWithCustomer(btn.dataset.key));
            });

            tbody.querySelectorAll('[data-action="message"]').forEach(btn => {
                btn.addEventListener('click', () => this.openMessageModal(btn.dataset.key));
            });

            this.updateSelectionUi();
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
            selectedCustomerKeys = new Set();
        }
    };

    window.PharmaFlow.PharmacyCustomers = PharmacyCustomers;
})();
