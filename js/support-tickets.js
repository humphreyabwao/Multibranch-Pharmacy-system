/**
 * PharmaFlow - Support Tickets
 * Branch users raise tickets to admin and track status from their branch.
 */
(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let branchTicketsListener = null;
    let branchTickets = [];

    const TICKET_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];
    const TICKET_PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
    const TICKET_CATEGORIES = ['System Issue', 'POS', 'Inventory', 'Sales', 'Reports', 'User Access', 'Billing', 'Other'];

    const SupportTickets = {
        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        getTicketsCollection: function (businessId) {
            if (!window.db || !businessId) return null;
            if (PharmaFlow.getBusinessCollection) {
                return PharmaFlow.getBusinessCollection(businessId, 'tickets');
            }
            return window.db.collection('businesses').doc(businessId).collection('tickets');
        },

        getCurrentUser: function () {
            const p = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
            return p ? (p.displayName || p.email || 'User') : 'Unknown';
        },

        escapeHtml: function (str) {
            const d = document.createElement('div');
            d.textContent = str || '';
            return d.innerHTML;
        },

        showToast: function (msg, type) {
            const old = document.querySelector('.tkt-toast');
            if (old) old.remove();
            const t = document.createElement('div');
            t.className = 'tkt-toast tkt-toast--' + (type || 'success');
            t.innerHTML = '<i class="fas fa-' + (type === 'error' ? 'exclamation-circle' : 'check-circle') + '"></i> ' + this.escapeHtml(msg);
            document.body.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
        },

        formatDateTime: function (val) {
            if (PharmaFlow.Settings && PharmaFlow.Settings.formatDateTime) return PharmaFlow.Settings.formatDateTime(val);
            if (!val) return '—';
            const d = val.toDate ? val.toDate() : (val.seconds ? new Date(val.seconds * 1000) : new Date(val));
            if (isNaN(d.getTime())) return '—';
            return d.toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
                d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
        },

        sortTickets: function (tickets) {
            return tickets.slice().sort((a, b) => {
                const aVal = a.updatedAt || a.createdAt || 0;
                const bVal = b.updatedAt || b.createdAt || 0;
                const aDate = aVal.toDate ? aVal.toDate() : (aVal.seconds ? new Date(aVal.seconds * 1000) : new Date(aVal));
                const bDate = bVal.toDate ? bVal.toDate() : (bVal.seconds ? new Date(bVal.seconds * 1000) : new Date(bVal));
                return (bDate.getTime() || 0) - (aDate.getTime() || 0);
            });
        },

        ticketLoadErrorMessage: function (err) {
            if (!err) return 'Failed to load tickets';
            if (err.code === 'permission-denied') {
                return 'Ticket access is blocked by Firestore rules. Deploy the updated ticket rules.';
            }
            if (err.code === 'failed-precondition') {
                return 'Ticket query needs a Firestore index. Use the simple branch ticket query or create the index shown by Firebase.';
            }
            return 'Failed to load tickets: ' + (err.message || err.code || 'Unknown error');
        },

        generateTicketId: function () {
            const d = new Date();
            return 'TKT-' + d.getFullYear().toString().slice(-2) +
                String(d.getMonth() + 1).padStart(2, '0') +
                String(d.getDate()).padStart(2, '0') + '-' +
                Math.random().toString(36).substring(2, 7).toUpperCase();
        },

        cleanup: function () {
            if (branchTicketsListener) {
                branchTicketsListener();
                branchTicketsListener = null;
            }
            branchTickets = [];
        },

        renderRaise: function (container) {
            this.cleanup();
            container.innerHTML = `
                <div class="tkt-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-ticket"></i> Raise Ticket</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Support Tickets</span><span>/</span><span>Raise Ticket</span>
                            </div>
                        </div>
                        <div class="page-header-right">
                            <button class="btn btn-sm btn-outline" id="tkt-view-my-tickets">
                                <i class="fas fa-list-check"></i> My Tickets
                            </button>
                        </div>
                    </div>

                    <div class="tkt-layout">
                        <form class="tkt-card tkt-form-card tkt-primary-panel" id="tkt-raise-form">
                            <div class="tkt-card-head">
                                <div class="tkt-head-title">
                                    <span class="tkt-head-icon"><i class="fas fa-pen-to-square"></i></span>
                                    <div>
                                        <h3>Ticket Details</h3>
                                        <small>Branch request</small>
                                    </div>
                                </div>
                                <span class="tkt-chip">New</span>
                            </div>
                            <div class="tkt-form-grid">
                                <div class="tkt-field">
                                    <label for="tkt-category">Category *</label>
                                    <select id="tkt-category" class="tkt-input" required>
                                        ${TICKET_CATEGORIES.map(c => '<option value="' + c + '">' + c + '</option>').join('')}
                                    </select>
                                </div>
                                <div class="tkt-field">
                                    <label for="tkt-priority">Priority *</label>
                                    <select id="tkt-priority" class="tkt-input" required>
                                        ${TICKET_PRIORITIES.map(p => '<option value="' + p + '"' + (p === 'Normal' ? ' selected' : '') + '>' + p + '</option>').join('')}
                                    </select>
                                </div>
                                <div class="tkt-field tkt-field--full">
                                    <label for="tkt-title">Subject *</label>
                                    <input id="tkt-title" class="tkt-input" type="text" placeholder="Short summary of the issue" required>
                                </div>
                                <div class="tkt-field tkt-field--full">
                                    <label for="tkt-description">Description *</label>
                                    <textarea id="tkt-description" class="tkt-input" rows="7" placeholder="Explain what happened, affected module, item/sale number, and what admin should check..." required></textarea>
                                </div>
                                <div class="tkt-field">
                                    <label for="tkt-contact">Contact Phone</label>
                                    <input id="tkt-contact" class="tkt-input" type="tel" placeholder="Optional contact number">
                                </div>
                                <div class="tkt-field">
                                    <label for="tkt-reference">Reference</label>
                                    <input id="tkt-reference" class="tkt-input" type="text" placeholder="Sale ID, product SKU, user email...">
                                </div>
                            </div>
                            <div class="tkt-form-actions">
                                <button type="submit" class="btn btn-primary" id="tkt-submit-btn">
                                    <i class="fas fa-paper-plane"></i> Send Ticket
                                </button>
                                <button type="reset" class="btn btn-outline">
                                    <i class="fas fa-rotate-left"></i> Reset
                                </button>
                            </div>
                        </form>

                        <aside class="tkt-card tkt-info-card">
                            <div class="tkt-info-top">
                                <div class="tkt-info-icon"><i class="fas fa-headset"></i></div>
                                <div>
                                    <h3>Support Desk</h3>
                                    <p>Admin queue</p>
                                </div>
                            </div>
                            <div class="tkt-info-list">
                                <span><i class="fas fa-building"></i> Branch copy</span>
                                <span><i class="fas fa-user-shield"></i> Admin review</span>
                                <span><i class="fas fa-clock-rotate-left"></i> Status history</span>
                            </div>
                        </aside>
                    </div>
                </div>
            `;

            container.querySelector('[data-nav="dashboard"]')?.addEventListener('click', (e) => {
                e.preventDefault();
                PharmaFlow.Sidebar.setActive('dashboard', null);
            });
            document.getElementById('tkt-view-my-tickets')?.addEventListener('click', () => {
                PharmaFlow.Sidebar.setActive('support-tickets', 'my-tickets');
            });
            document.getElementById('tkt-raise-form')?.addEventListener('submit', (e) => {
                e.preventDefault();
                this.submitTicket();
            });
        },

        submitTicket: async function () {
            const businessId = this.getBusinessId();
            if (!businessId) {
                this.showToast('No branch is assigned to this user.', 'error');
                return;
            }

            const title = (document.getElementById('tkt-title')?.value || '').trim();
            const description = (document.getElementById('tkt-description')?.value || '').trim();
            const category = document.getElementById('tkt-category')?.value || 'Other';
            const priority = document.getElementById('tkt-priority')?.value || 'Normal';
            const contactPhone = (document.getElementById('tkt-contact')?.value || '').trim();
            const reference = (document.getElementById('tkt-reference')?.value || '').trim();
            if (!title || !description) {
                this.showToast('Please enter ticket subject and description.', 'error');
                return;
            }

            const btn = document.getElementById('tkt-submit-btn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
            }

            try {
                const ticketId = this.generateTicketId();
                const user = PharmaFlow.Auth?.userProfile || {};
                const businessSnap = await window.db.collection('businesses').doc(businessId).get().catch(() => null);
                const businessName = businessSnap && businessSnap.exists ? (businessSnap.data().name || businessId) : businessId;
                const now = new Date().toISOString();
                const data = {
                    ticketId: ticketId,
                    businessId: businessId,
                    businessName: businessName,
                    title: title,
                    description: description,
                    category: category,
                    priority: priority,
                    contactPhone: contactPhone,
                    reference: reference,
                    status: 'Open',
                    adminNote: '',
                    raisedBy: user.displayName || user.email || 'Unknown',
                    raisedByUid: firebase.auth().currentUser ? firebase.auth().currentUser.uid : null,
                    raisedByEmail: user.email || '',
                    createdAt: now,
                    updatedAt: now,
                    lastUpdatedBy: user.displayName || user.email || 'Unknown'
                };

                const ticketsCol = this.getTicketsCollection(businessId);
                if (!ticketsCol) throw new Error('Firestore tickets collection is not ready.');
                const branchRef = ticketsCol.doc(ticketId);
                const centralRef = window.db.collection('support_tickets').doc(ticketId);
                const batch = window.db.batch();
                batch.set(branchRef, data);
                batch.set(centralRef, data);
                await batch.commit();

                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Support Ticket Raised',
                        description: ticketId + ' - ' + title,
                        category: 'Support',
                        status: 'COMPLETED',
                        metadata: { ticketId: ticketId, priority: priority, category: category }
                    });
                }

                this.showToast('Ticket sent to admin. Tracking copy saved for this branch.');
                document.getElementById('tkt-raise-form')?.reset();
                PharmaFlow.Sidebar.setActive('support-tickets', 'my-tickets');
            } catch (err) {
                console.error('Submit ticket error:', err);
                this.showToast('Failed to send ticket: ' + err.message, 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Ticket';
                }
            }
        },

        renderMyTickets: function (container) {
            this.cleanup();
            const businessId = this.getBusinessId();
            container.innerHTML = `
                <div class="tkt-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-list-check"></i> My Tickets</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Support Tickets</span><span>/</span><span>My Tickets</span>
                            </div>
                        </div>
                        <div class="page-header-right">
                            <button class="btn btn-sm btn-primary" id="tkt-raise-new">
                                <i class="fas fa-plus"></i> Raise Ticket
                            </button>
                        </div>
                    </div>

                    <div class="tkt-toolbar">
                        <div class="tkt-search"><i class="fas fa-search"></i><input id="tkt-search" type="text" placeholder="Search tickets..."></div>
                        <select id="tkt-status-filter" class="tkt-input">
                            <option value="">All statuses</option>
                            ${TICKET_STATUSES.map(s => '<option value="' + s + '">' + s + '</option>').join('')}
                        </select>
                    </div>

                    <div class="tkt-card tkt-list-card">
                        <div class="tkt-card-head tkt-card-head--compact">
                            <div class="tkt-head-title">
                                <span class="tkt-head-icon"><i class="fas fa-inbox"></i></span>
                                <div>
                                    <h3>Branch Ticket History</h3>
                                    <small>Live status tracking</small>
                                </div>
                            </div>
                        </div>
                        <div class="tkt-table-wrap">
                            <table class="tkt-table">
                                <thead>
                                    <tr>
                                        <th>Ticket</th>
                                        <th>Category</th>
                                        <th>Priority</th>
                                        <th>Status</th>
                                        <th>Admin Note</th>
                                        <th>Updated</th>
                                    </tr>
                                </thead>
                                <tbody id="tkt-my-body">
                                    <tr><td colspan="6" class="tkt-empty"><i class="fas fa-spinner fa-spin"></i> Loading tickets...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;

            container.querySelector('[data-nav="dashboard"]')?.addEventListener('click', (e) => {
                e.preventDefault();
                PharmaFlow.Sidebar.setActive('dashboard', null);
            });
            document.getElementById('tkt-raise-new')?.addEventListener('click', () => {
                PharmaFlow.Sidebar.setActive('support-tickets', 'raise-ticket');
            });
            document.getElementById('tkt-search')?.addEventListener('input', () => this.renderTicketTable());
            document.getElementById('tkt-status-filter')?.addEventListener('change', () => this.renderTicketTable());

            if (!window.db) {
                this.showTicketLoadError(new Error('Firestore is not initialized yet.'));
                return;
            }
            if (!businessId) {
                this.showTicketLoadError(new Error('No branch is assigned to this user.'));
                return;
            }
            this.subscribeBranchTickets(businessId);
        },

        subscribeBranchTickets: function (businessId) {
            if (branchTicketsListener) branchTicketsListener();
            const ticketsCol = this.getTicketsCollection(businessId);
            if (!ticketsCol) {
                this.showTicketLoadError(new Error('Firestore tickets collection is not ready.'));
                return;
            }
            branchTicketsListener = ticketsCol
                .onSnapshot(snap => {
                    branchTickets = this.sortTickets(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                    this.renderTicketTable();
                }, err => {
                    console.error('Branch tickets listener error:', err);
                    this.subscribeCentralTicketCopy(businessId, err);
                });
        },

        subscribeCentralTicketCopy: function (businessId, originalErr) {
            if (branchTicketsListener) branchTicketsListener();
            branchTicketsListener = window.db.collection('support_tickets')
                .where('businessId', '==', businessId)
                .onSnapshot(snap => {
                    branchTickets = this.sortTickets(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                    this.renderTicketTable();
                }, err => {
                    console.error('Central tickets fallback listener error:', err);
                    this.showTicketLoadError(err || originalErr);
                });
        },

        showTicketLoadError: function (err) {
            const body = document.getElementById('tkt-my-body');
            if (!body) return;
            body.innerHTML = '<tr><td colspan="6" class="tkt-empty tkt-empty--error"><i class="fas fa-triangle-exclamation"></i> ' + this.escapeHtml(this.ticketLoadErrorMessage(err)) + '</td></tr>';
        },

        renderTicketTable: function () {
            const body = document.getElementById('tkt-my-body');
            if (!body) return;

            const q = (document.getElementById('tkt-search')?.value || '').toLowerCase().trim();
            const status = document.getElementById('tkt-status-filter')?.value || '';
            let rows = branchTickets.slice();
            if (status) rows = rows.filter(t => t.status === status);
            if (q) {
                rows = rows.filter(t => [t.ticketId, t.title, t.description, t.category, t.priority, t.reference, t.adminNote].join(' ').toLowerCase().indexOf(q) !== -1);
            }

            if (!rows.length) {
                body.innerHTML = '<tr><td colspan="6" class="tkt-empty"><i class="fas fa-inbox"></i> No tickets found</td></tr>';
                return;
            }

            body.innerHTML = rows.map(t => {
                return '<tr>' +
                    '<td><strong>' + this.escapeHtml(t.title) + '</strong><br><code>' + this.escapeHtml(t.ticketId || t.id) + '</code>' + (t.reference ? '<br><small>' + this.escapeHtml(t.reference) + '</small>' : '') + '</td>' +
                    '<td>' + this.escapeHtml(t.category || 'Other') + '</td>' +
                    '<td>' + this.priorityBadge(t.priority) + '</td>' +
                    '<td>' + this.statusBadge(t.status) + '</td>' +
                    '<td>' + (t.adminNote ? this.escapeHtml(t.adminNote) : '<span class="tkt-muted">No admin note yet</span>') + '</td>' +
                    '<td>' + this.formatDateTime(t.updatedAt || t.createdAt) + '</td>' +
                '</tr>';
            }).join('');
        },

        statusBadge: function (status) {
            const s = status || 'Open';
            const cls = s === 'Resolved' || s === 'Closed' ? 'ok' : s === 'In Progress' ? 'info' : 'warn';
            return '<span class="tkt-badge tkt-badge--' + cls + '">' + this.escapeHtml(s) + '</span>';
        },

        priorityBadge: function (priority) {
            const p = priority || 'Normal';
            const cls = p === 'Urgent' || p === 'High' ? 'danger' : p === 'Low' ? 'muted' : 'info';
            return '<span class="tkt-badge tkt-badge--' + cls + '">' + this.escapeHtml(p) + '</span>';
        }
    };

    window.PharmaFlow.SupportTickets = SupportTickets;
})();
