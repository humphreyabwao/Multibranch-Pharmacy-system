/**
 * PharmaFlow - Medication Refill Module
 *   1. Refill Overview   – Dashboard with stats, upcoming & overdue refills
 *   2. Add Refill        – Register a new chronic patient refill schedule
 *   3. Manage Refills    – Full table with edit, complete, disable
 *   4. Refill Reminders  – View and manage upcoming reminders
 *
 * Firestore collection: businesses/{businessId}/medication_refills
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    /* ─── module-level state ─── */
    let mrUnsubRefills = null;
    let mrUnsubPatients = null;
    let mrAllRefills = [];
    let mrAllPatients = [];
    let mrFilteredRefills = [];
    let mrCurrentPage = 1;
    const MR_PAGE_SIZE = 20;

    const MR_FREQUENCIES = [
        'Daily', 'Every 2 Days', 'Every 3 Days', 'Weekly', 'Every 2 Weeks',
        'Monthly', 'Every 2 Months', 'Every 3 Months', 'Every 6 Months', 'Yearly'
    ];

    const MR_FREQ_DAYS = {
        'Daily': 1, 'Every 2 Days': 2, 'Every 3 Days': 3, 'Weekly': 7,
        'Every 2 Weeks': 14, 'Monthly': 30, 'Every 2 Months': 60,
        'Every 3 Months': 90, 'Every 6 Months': 180, 'Yearly': 365
    };

    const MR_STATUSES = ['Active', 'Paused', 'Completed', 'Discontinued'];

    const MedicationRefill = {

        /* ══════════════════════════════════
         * HELPERS
         * ══════════════════════════════════ */

        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        getCurrentUser: function () {
            const p = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
            return p ? (p.displayName || p.email || 'User') : 'Unknown';
        },

        escapeHtml: function (str) {
            const div = document.createElement('div');
            div.textContent = str || '';
            return div.innerHTML;
        },

        showToast: function (msg, type) {
            const old = document.querySelector('.mr-toast');
            if (old) old.remove();
            const t = document.createElement('div');
            t.className = 'mr-toast mr-toast--' + (type || 'success');
            t.innerHTML = '<i class="fas fa-' + (type === 'error' ? 'exclamation-circle' : 'check-circle') + '"></i> ' + this.escapeHtml(msg);
            document.body.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
        },

        formatDate: function (val) {
            if (!val) return '—';
            let d;
            if (val.toDate) d = val.toDate();
            else if (val.seconds) d = new Date(val.seconds * 1000);
            else d = new Date(val);
            if (isNaN(d.getTime())) return '—';
            return d.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
        },

        toISODate: function (d) {
            return d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
        },

        daysBetween: function (dateStr1, dateStr2) {
            const d1 = new Date(dateStr1);
            const d2 = new Date(dateStr2);
            return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
        },

        generateId: function () {
            const now = new Date();
            const y = now.getFullYear().toString().slice(-2);
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
            return 'MR-' + y + m + d + '-' + rand;
        },

        calcNextRefill: function (lastRefillDate, frequency) {
            const days = MR_FREQ_DAYS[frequency] || 30;
            const d = new Date(lastRefillDate);
            d.setDate(d.getDate() + days);
            return this.toISODate(d);
        },

        getRefillUrgency: function (nextRefillDate) {
            if (!nextRefillDate) return 'unknown';
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const next = new Date(nextRefillDate); next.setHours(0, 0, 0, 0);
            const diff = Math.round((next - today) / (1000 * 60 * 60 * 24));
            if (diff < 0) return 'overdue';
            if (diff <= 3) return 'urgent';
            if (diff <= 7) return 'upcoming';
            return 'scheduled';
        },

        cleanup: function () {
            if (mrUnsubRefills) { mrUnsubRefills(); mrUnsubRefills = null; }
            if (mrUnsubPatients) { mrUnsubPatients(); mrUnsubPatients = null; }
            mrAllRefills = [];
            mrAllPatients = [];
            mrFilteredRefills = [];
            mrCurrentPage = 1;
        },

        /* helper: load patients list for dropdowns */
        _loadPatients: function (businessId, callback) {
            const ref = PharmaFlow.getBusinessCollection(businessId, 'patients');
            if (!ref) { callback([]); return; }
            if (mrUnsubPatients) { mrUnsubPatients(); mrUnsubPatients = null; }
            mrUnsubPatients = ref.orderBy('fullName', 'asc').onSnapshot(function (snap) {
                mrAllPatients = [];
                snap.forEach(function (doc) { mrAllPatients.push(Object.assign({ id: doc.id }, doc.data())); });
                if (callback) callback(mrAllPatients);
            }, function () { if (callback) callback([]); });
        },

        /* ══════════════════════════════════════════
         * 1) REFILL OVERVIEW (Dashboard)
         * ══════════════════════════════════════════ */

        renderOverview: function (container) {
            this.cleanup();
            const businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="mr-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-pills"></i> Medication Refill Overview</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Medication Refill</span><span>/</span><span>Overview</span>
                            </div>
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="mr-stats-row">
                        <div class="mr-stat-card">
                            <div class="mr-stat-icon" style="background:#dbeafe;color:#2563eb;"><i class="fas fa-list"></i></div>
                            <div class="mr-stat-info"><span class="mr-stat-value" id="mr-stat-total">0</span><span class="mr-stat-label">Total Refills</span></div>
                        </div>
                        <div class="mr-stat-card">
                            <div class="mr-stat-icon" style="background:#dcfce7;color:#16a34a;"><i class="fas fa-check-circle"></i></div>
                            <div class="mr-stat-info"><span class="mr-stat-value" id="mr-stat-active">0</span><span class="mr-stat-label">Active</span></div>
                        </div>
                        <div class="mr-stat-card">
                            <div class="mr-stat-icon" style="background:#fee2e2;color:#dc2626;"><i class="fas fa-exclamation-triangle"></i></div>
                            <div class="mr-stat-info"><span class="mr-stat-value" id="mr-stat-overdue">0</span><span class="mr-stat-label">Overdue</span></div>
                        </div>
                        <div class="mr-stat-card">
                            <div class="mr-stat-icon" style="background:#fef3c7;color:#d97706;"><i class="fas fa-clock"></i></div>
                            <div class="mr-stat-info"><span class="mr-stat-value" id="mr-stat-upcoming">0</span><span class="mr-stat-label">Due This Week</span></div>
                        </div>
                    </div>

                    <!-- Two-column: Overdue + Upcoming -->
                    <div class="mr-overview-grid">
                        <div class="mr-overview-section">
                            <h3><i class="fas fa-exclamation-circle" style="color:#dc2626;"></i> Overdue Refills</h3>
                            <div class="mr-overview-list" id="mr-overdue-list">
                                <div class="mr-empty-mini"><i class="fas fa-spinner fa-spin"></i> Loading...</div>
                            </div>
                        </div>
                        <div class="mr-overview-section">
                            <h3><i class="fas fa-calendar-check" style="color:#2563eb;"></i> Upcoming Refills (7 days)</h3>
                            <div class="mr-overview-list" id="mr-upcoming-list">
                                <div class="mr-empty-mini"><i class="fas fa-spinner fa-spin"></i> Loading...</div>
                            </div>
                        </div>
                    </div>

                    <!-- Recent completions -->
                    <div class="mr-overview-section" style="margin-top:20px;">
                        <h3><i class="fas fa-history" style="color:#16a34a;"></i> Recently Completed</h3>
                        <div class="mr-overview-list" id="mr-recent-list">
                             <div class="mr-empty-mini"><i class="fas fa-spinner fa-spin"></i> Loading...</div>
                        </div>
                    </div>
                </div>
            `;

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', function (e) {
                e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null);
            });

            this._loadOverviewData(businessId);
        },

        _loadOverviewData: function (businessId) {
            if (!businessId) return;
            var self = this;
            var ref = PharmaFlow.getBusinessCollection(businessId, 'medication_refills');
            if (!ref) return;

            if (mrUnsubRefills) { mrUnsubRefills(); mrUnsubRefills = null; }

            mrUnsubRefills = ref.orderBy('nextRefillDate', 'asc').onSnapshot(function (snap) {
                mrAllRefills = [];
                snap.forEach(function (doc) { mrAllRefills.push(Object.assign({ id: doc.id }, doc.data())); });
                self._renderOverviewData();
            });
        },

        _renderOverviewData: function () {
            var self = this;
            var todayStr = this.toISODate(new Date());
            var weekLater = new Date(); weekLater.setDate(weekLater.getDate() + 7);
            var weekStr = this.toISODate(weekLater);

            var active = mrAllRefills.filter(function (r) { return r.status === 'Active'; });
            var overdue = active.filter(function (r) { return r.nextRefillDate && r.nextRefillDate < todayStr; });
            var upcoming = active.filter(function (r) { return r.nextRefillDate && r.nextRefillDate >= todayStr && r.nextRefillDate <= weekStr; });

            // Stats
            var el;
            el = document.getElementById('mr-stat-total'); if (el) el.textContent = mrAllRefills.length;
            el = document.getElementById('mr-stat-active'); if (el) el.textContent = active.length;
            el = document.getElementById('mr-stat-overdue'); if (el) el.textContent = overdue.length;
            el = document.getElementById('mr-stat-upcoming'); if (el) el.textContent = upcoming.length;

            // Overdue list
            var overdueList = document.getElementById('mr-overdue-list');
            if (overdueList) {
                if (overdue.length === 0) {
                    overdueList.innerHTML = '<div class="mr-empty-mini"><i class="fas fa-check-circle" style="color:#16a34a;"></i> No overdue refills</div>';
                } else {
                    overdueList.innerHTML = overdue.slice(0, 10).map(function (r) {
                        var daysOver = self.daysBetween(r.nextRefillDate, todayStr);
                        return '<div class="mr-refill-card mr-refill-card--overdue">' +
                            '<div class="mr-refill-card-left">' +
                                '<strong>' + self.escapeHtml(r.patientName || 'Unknown') + '</strong>' +
                                '<span class="mr-refill-med"><i class="fas fa-pills"></i> ' + self.escapeHtml(r.medication) + ' (' + self.escapeHtml(r.dosage || '') + ')</span>' +
                            '</div>' +
                            '<div class="mr-refill-card-right">' +
                                '<span class="mr-badge mr-badge--danger">' + daysOver + ' day' + (daysOver !== 1 ? 's' : '') + ' overdue</span>' +
                                '<button class="mr-btn mr-btn--sm mr-btn--success" data-refill-id="' + r.id + '" data-action="complete"><i class="fas fa-check"></i> Complete</button>' +
                            '</div>' +
                        '</div>';
                    }).join('');
                    overdueList.querySelectorAll('[data-action="complete"]').forEach(function (btn) {
                        btn.addEventListener('click', function () { self._completeRefill(btn.dataset.refillId); });
                    });
                }
            }

            // Upcoming list
            var upcomingList = document.getElementById('mr-upcoming-list');
            if (upcomingList) {
                if (upcoming.length === 0) {
                    upcomingList.innerHTML = '<div class="mr-empty-mini"><i class="fas fa-calendar-check" style="color:#64748b;"></i> No upcoming refills this week</div>';
                } else {
                    upcomingList.innerHTML = upcoming.slice(0, 10).map(function (r) {
                        var daysUntil = self.daysBetween(todayStr, r.nextRefillDate);
                        var label = daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : 'In ' + daysUntil + ' days';
                        return '<div class="mr-refill-card mr-refill-card--upcoming">' +
                            '<div class="mr-refill-card-left">' +
                                '<strong>' + self.escapeHtml(r.patientName || 'Unknown') + '</strong>' +
                                '<span class="mr-refill-med"><i class="fas fa-pills"></i> ' + self.escapeHtml(r.medication) + ' (' + self.escapeHtml(r.dosage || '') + ')</span>' +
                            '</div>' +
                            '<div class="mr-refill-card-right">' +
                                '<span class="mr-badge mr-badge--info">' + label + '</span>' +
                                '<span class="mr-refill-date">' + self.formatDate(r.nextRefillDate) + '</span>' +
                            '</div>' +
                        '</div>';
                    }).join('');
                }
            }

            // Recently completed (last 5 refills with lastRefillDate desc)
            var recentList = document.getElementById('mr-recent-list');
            if (recentList) {
                var completed = mrAllRefills.filter(function (r) { return r.lastRefillDate; });
                completed.sort(function (a, b) { return (b.lastRefillDate || '').localeCompare(a.lastRefillDate || ''); });
                var recent = completed.slice(0, 5);
                if (recent.length === 0) {
                    recentList.innerHTML = '<div class="mr-empty-mini"><i class="fas fa-inbox"></i> No recent completions</div>';
                } else {
                    recentList.innerHTML = recent.map(function (r) {
                        return '<div class="mr-refill-card">' +
                            '<div class="mr-refill-card-left">' +
                                '<strong>' + self.escapeHtml(r.patientName || 'Unknown') + '</strong>' +
                                '<span class="mr-refill-med"><i class="fas fa-pills"></i> ' + self.escapeHtml(r.medication) + '</span>' +
                            '</div>' +
                            '<div class="mr-refill-card-right">' +
                                '<span class="mr-badge mr-badge--success">Refilled</span>' +
                                '<span class="mr-refill-date">' + self.formatDate(r.lastRefillDate) + '</span>' +
                            '</div>' +
                        '</div>';
                    }).join('');
                }
            }
        },

        /* ══════════════════════════════════════════
         * 2) ADD REFILL
         * ══════════════════════════════════════════ */

        renderAdd: function (container) {
            this.cleanup();
            var businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="mr-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-plus-circle"></i> Add Refill Schedule</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Medication Refill</span><span>/</span><span>Add Refill</span>
                            </div>
                        </div>
                    </div>

                    <div class="mr-form-card">
                        <form id="mr-add-form" autocomplete="off">
                            <h3><i class="fas fa-user"></i> Patient Information</h3>
                            <div class="mr-form-grid">
                                <div class="mr-field">
                                    <label>Patient *</label>
                                    <select id="mr-patient" class="mr-select" required>
                                        <option value="">— Select Patient —</option>
                                    </select>
                                </div>
                                <div class="mr-field">
                                    <label>Condition / Diagnosis *</label>
                                    <input type="text" id="mr-condition" class="mr-input" placeholder="e.g. Diabetes Type 2, Hypertension" required>
                                </div>
                            </div>

                            <h3><i class="fas fa-pills"></i> Medication Details</h3>
                            <div class="mr-form-grid">
                                <div class="mr-field">
                                    <label>Medication Name *</label>
                                    <input type="text" id="mr-medication" class="mr-input" placeholder="e.g. Metformin 500mg" required>
                                </div>
                                <div class="mr-field">
                                    <label>Dosage *</label>
                                    <input type="text" id="mr-dosage" class="mr-input" placeholder="e.g. 1 tablet twice daily" required>
                                </div>
                                <div class="mr-field">
                                    <label>Quantity per Refill</label>
                                    <input type="number" id="mr-quantity" class="mr-input" placeholder="e.g. 60" min="1">
                                </div>
                                <div class="mr-field">
                                    <label>Refill Frequency *</label>
                                    <select id="mr-frequency" class="mr-select" required>
                                        ${MR_FREQUENCIES.map(function (f) { return '<option value="' + f + '">' + f + '</option>'; }).join('')}
                                    </select>
                                </div>
                            </div>

                            <h3><i class="fas fa-calendar"></i> Schedule</h3>
                            <div class="mr-form-grid">
                                <div class="mr-field">
                                    <label>Last Refill Date *</label>
                                    <input type="date" id="mr-last-refill" class="mr-input" required>
                                </div>
                                <div class="mr-field">
                                    <label>Next Refill Date</label>
                                    <input type="date" id="mr-next-refill" class="mr-input" readonly>
                                </div>
                                <div class="mr-field">
                                    <label>Reminder (days before)</label>
                                    <input type="number" id="mr-reminder-days" class="mr-input" value="3" min="0" max="30">
                                </div>
                                <div class="mr-field">
                                    <label>Prescribing Doctor</label>
                                    <input type="text" id="mr-doctor" class="mr-input" placeholder="e.g. Dr. Kamau">
                                </div>
                            </div>

                            <div class="mr-field" style="margin-top:8px;">
                                <label>Notes</label>
                                <textarea id="mr-notes" class="mr-input mr-textarea" rows="3" placeholder="Additional notes..."></textarea>
                            </div>

                            <div class="mr-form-actions">
                                <button type="submit" class="mr-btn mr-btn--primary" id="mr-save-btn">
                                    <i class="fas fa-save"></i> Save Refill Schedule
                                </button>
                                <button type="reset" class="mr-btn mr-btn--secondary">
                                    <i class="fas fa-rotate-left"></i> Reset
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            `;

            var dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', function (e) {
                e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null);
            });

            // Load patients for dropdown
            var self = this;
            this._loadPatients(businessId, function (patients) {
                var sel = document.getElementById('mr-patient');
                if (!sel) return;
                sel.innerHTML = '<option value="">— Select Patient —</option>' +
                    patients.map(function (p) {
                        return '<option value="' + (p.patientId || p.id) + '" data-name="' + self.escapeHtml(p.fullName || (p.firstName + ' ' + p.lastName)) + '">' +
                            self.escapeHtml(p.fullName || (p.firstName + ' ' + p.lastName)) + ' (' + (p.patientId || p.id) + ')' +
                        '</option>';
                    }).join('');
            });

            // Auto-calculate next refill
            var lastInput = document.getElementById('mr-last-refill');
            var freqSelect = document.getElementById('mr-frequency');
            var nextInput = document.getElementById('mr-next-refill');

            function updateNext() {
                if (lastInput && lastInput.value && freqSelect) {
                    nextInput.value = self.calcNextRefill(lastInput.value, freqSelect.value);
                }
            }
            if (lastInput) lastInput.addEventListener('change', updateNext);
            if (freqSelect) freqSelect.addEventListener('change', updateNext);

            // Set default last refill to today
            if (lastInput) {
                lastInput.value = this.toISODate(new Date());
                updateNext();
            }

            // Submit handler
            var form = document.getElementById('mr-add-form');
            if (form) form.addEventListener('submit', function (e) {
                e.preventDefault();
                self._saveRefill(businessId);
            });
        },

        _saveRefill: async function (businessId) {
            if (!businessId) return;

            var patientSel = document.getElementById('mr-patient');
            var patientId = patientSel ? patientSel.value : '';
            var patientName = patientSel && patientSel.selectedOptions[0] ? patientSel.selectedOptions[0].dataset.name || '' : '';
            var condition = (document.getElementById('mr-condition')?.value || '').trim();
            var medication = (document.getElementById('mr-medication')?.value || '').trim();
            var dosage = (document.getElementById('mr-dosage')?.value || '').trim();
            var quantity = parseInt(document.getElementById('mr-quantity')?.value) || 0;
            var frequency = document.getElementById('mr-frequency')?.value || 'Monthly';
            var lastRefillDate = document.getElementById('mr-last-refill')?.value || '';
            var nextRefillDate = document.getElementById('mr-next-refill')?.value || '';
            var reminderDays = parseInt(document.getElementById('mr-reminder-days')?.value) || 3;
            var doctor = (document.getElementById('mr-doctor')?.value || '').trim();
            var notes = (document.getElementById('mr-notes')?.value || '').trim();

            if (!patientId || !condition || !medication || !dosage || !lastRefillDate) {
                this.showToast('Please fill all required fields', 'error');
                return;
            }

            if (!nextRefillDate) {
                nextRefillDate = this.calcNextRefill(lastRefillDate, frequency);
            }

            var refillId = this.generateId();
            var btn = document.getElementById('mr-save-btn');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

            var data = {
                refillId: refillId,
                patientId: patientId,
                patientName: patientName,
                condition: condition,
                medication: medication,
                dosage: dosage,
                quantityPerRefill: quantity,
                frequency: frequency,
                lastRefillDate: lastRefillDate,
                nextRefillDate: nextRefillDate,
                reminderDays: reminderDays,
                doctor: doctor,
                notes: notes,
                status: 'Active',
                refillCount: 0,
                createdBy: this.getCurrentUser(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            try {
                var ref = PharmaFlow.getBusinessCollection(businessId, 'medication_refills');
                await ref.doc(refillId).set(data);

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Refill Schedule Created',
                        description: 'Scheduled ' + medication + ' (' + dosage + ') for ' + patientName + ' — ' + frequency,
                        category: 'Refill',
                        status: 'COMPLETED',
                        metadata: { refillId: refillId, patientId: patientId, medication: medication, frequency: frequency }
                    });
                }

                this.showToast('Refill schedule saved for ' + patientName + '!');
                document.getElementById('mr-add-form')?.reset();
                document.getElementById('mr-next-refill').value = '';
                document.getElementById('mr-last-refill').value = this.toISODate(new Date());
            } catch (err) {
                console.error('Save refill error:', err);
                this.showToast('Failed to save: ' + err.message, 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Refill Schedule'; }
            }
        },

        /* ══════════════════════════════════════════
         * 3) MANAGE REFILLS
         * ══════════════════════════════════════════ */

        renderManage: function (container) {
            this.cleanup();
            var businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="mr-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-tasks"></i> Manage Refills</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Medication Refill</span><span>/</span><span>Manage Refills</span>
                            </div>
                        </div>
                    </div>

                    <!-- Filters -->
                    <div class="mr-filters-bar">
                        <div class="mr-filter-group">
                            <label>Search</label>
                            <input type="text" id="mr-search" class="mr-input" placeholder="Patient, medication...">
                        </div>
                        <div class="mr-filter-group">
                            <label>Status</label>
                            <select id="mr-filter-status" class="mr-select">
                                <option value="">All</option>
                                ${MR_STATUSES.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join('')}
                            </select>
                        </div>
                        <div class="mr-filter-group">
                            <label>Urgency</label>
                            <select id="mr-filter-urgency" class="mr-select">
                                <option value="">All</option>
                                <option value="overdue">Overdue</option>
                                <option value="urgent">Urgent (≤3 days)</option>
                                <option value="upcoming">Upcoming (≤7 days)</option>
                                <option value="scheduled">Scheduled</option>
                            </select>
                        </div>
                        <div class="mr-filter-group mr-filter-actions">
                            <label>&nbsp;</label>
                            <button class="mr-btn mr-btn--primary" id="mr-btn-apply"><i class="fas fa-search"></i> Filter</button>
                        </div>
                    </div>

                    <!-- Toolbar -->
                    <div class="mr-toolbar">
                        <span class="mr-results-count" id="mr-results-count">0 records</span>
                    </div>

                    <!-- Table -->
                    <div class="mr-table-wrap">
                        <table class="mr-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Patient</th>
                                    <th>Medication</th>
                                    <th>Dosage</th>
                                    <th>Frequency</th>
                                    <th>Next Refill</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="mr-table-body">
                                <tr><td colspan="8" class="mr-empty"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="mr-pagination" id="mr-pagination"></div>
                </div>
            `;

            var dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', function (e) {
                e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null);
            });

            this._bindManageFilters();
            this._loadManageData(businessId);
        },

        _bindManageFilters: function () {
            var self = this;
            var applyBtn = document.getElementById('mr-btn-apply');
            var searchInput = document.getElementById('mr-search');

            if (applyBtn) applyBtn.addEventListener('click', function () { self._applyManageFilters(); });
            if (searchInput) {
                var debounce;
                searchInput.addEventListener('input', function () {
                    clearTimeout(debounce);
                    debounce = setTimeout(function () { self._applyManageFilters(); }, 300);
                });
            }
        },

        _loadManageData: function (businessId) {
            if (!businessId) return;
            var self = this;
            var ref = PharmaFlow.getBusinessCollection(businessId, 'medication_refills');
            if (!ref) return;

            if (mrUnsubRefills) { mrUnsubRefills(); mrUnsubRefills = null; }

            mrUnsubRefills = ref.orderBy('nextRefillDate', 'asc').onSnapshot(function (snap) {
                mrAllRefills = [];
                snap.forEach(function (doc) { mrAllRefills.push(Object.assign({ id: doc.id }, doc.data())); });
                self._applyManageFilters();
            });
        },

        _applyManageFilters: function () {
            var search = (document.getElementById('mr-search') || {}).value || '';
            var statusFilter = (document.getElementById('mr-filter-status') || {}).value || '';
            var urgencyFilter = (document.getElementById('mr-filter-urgency') || {}).value || '';
            var q = search.toLowerCase().trim();
            var self = this;

            mrFilteredRefills = mrAllRefills.filter(function (r) {
                if (statusFilter && r.status !== statusFilter) return false;
                if (urgencyFilter && self.getRefillUrgency(r.nextRefillDate) !== urgencyFilter) return false;
                if (q) {
                    var haystack = [r.patientName, r.medication, r.dosage, r.condition, r.doctor].join(' ').toLowerCase();
                    if (haystack.indexOf(q) === -1) return false;
                }
                return true;
            });

            mrCurrentPage = 1;
            this._renderManageTable();
            this._renderManagePagination();

            var countEl = document.getElementById('mr-results-count');
            if (countEl) countEl.textContent = mrFilteredRefills.length + ' record' + (mrFilteredRefills.length !== 1 ? 's' : '');
        },

        _renderManageTable: function () {
            var tbody = document.getElementById('mr-table-body');
            if (!tbody) return;

            if (mrFilteredRefills.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="mr-empty"><i class="fas fa-inbox"></i> No refill records found</td></tr>';
                return;
            }

            var start = (mrCurrentPage - 1) * MR_PAGE_SIZE;
            var page = mrFilteredRefills.slice(start, start + MR_PAGE_SIZE);
            var self = this;

            tbody.innerHTML = page.map(function (r, i) {
                var urgency = self.getRefillUrgency(r.nextRefillDate);
                var urgencyClass = urgency === 'overdue' ? 'mr-badge--danger' :
                                   urgency === 'urgent' ? 'mr-badge--warning' :
                                   urgency === 'upcoming' ? 'mr-badge--info' : 'mr-badge--muted';
                var statusClass = r.status === 'Active' ? 'mr-badge--success' :
                                  r.status === 'Paused' ? 'mr-badge--warning' :
                                  r.status === 'Discontinued' ? 'mr-badge--danger' : 'mr-badge--muted';

                return '<tr>' +
                    '<td class="mr-cell-num">' + (start + i + 1) + '</td>' +
                    '<td><strong>' + self.escapeHtml(r.patientName || 'Unknown') + '</strong><br><small style="color:#64748b;">' + self.escapeHtml(r.condition || '') + '</small></td>' +
                    '<td>' + self.escapeHtml(r.medication) + '</td>' +
                    '<td>' + self.escapeHtml(r.dosage) + '</td>' +
                    '<td>' + self.escapeHtml(r.frequency) + '</td>' +
                    '<td>' +
                        '<span class="mr-badge ' + urgencyClass + '">' + self.formatDate(r.nextRefillDate) + '</span>' +
                        (urgency === 'overdue' ? '<br><small style="color:#dc2626;font-weight:600;">OVERDUE</small>' : '') +
                    '</td>' +
                    '<td><span class="mr-badge ' + statusClass + '">' + self.escapeHtml(r.status) + '</span></td>' +
                    '<td class="mr-cell-actions">' +
                        (r.status === 'Active' ? '<button class="mr-btn mr-btn--sm mr-btn--success" title="Complete Refill" data-action="complete" data-id="' + r.id + '"><i class="fas fa-check"></i></button> ' : '') +
                        '<button class="mr-btn mr-btn--sm mr-btn--outline" title="Edit" data-action="edit" data-id="' + r.id + '"><i class="fas fa-pen"></i></button> ' +
                        '<button class="mr-btn mr-btn--sm mr-btn--outline" title="View" data-action="view" data-id="' + r.id + '"><i class="fas fa-eye"></i></button>' +
                    '</td>' +
                '</tr>';
            }).join('');

            // Bind action buttons
            tbody.querySelectorAll('[data-action]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var id = btn.dataset.id;
                    var action = btn.dataset.action;
                    if (action === 'complete') self._completeRefill(id);
                    else if (action === 'edit') self._showEditModal(id);
                    else if (action === 'view') self._showViewModal(id);
                });
            });
        },

        _renderManagePagination: function () {
            var container = document.getElementById('mr-pagination');
            if (!container) return;
            var totalPages = Math.ceil(mrFilteredRefills.length / MR_PAGE_SIZE);
            if (totalPages <= 1) { container.innerHTML = ''; return; }

            var self = this;
            var html = '<button class="mr-page-btn" data-page="prev" ' + (mrCurrentPage === 1 ? 'disabled' : '') + '><i class="fas fa-chevron-left"></i></button>';
            for (var p = 1; p <= totalPages; p++) {
                html += '<button class="mr-page-btn' + (p === mrCurrentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
            }
            html += '<button class="mr-page-btn" data-page="next" ' + (mrCurrentPage === totalPages ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i></button>';
            container.innerHTML = html;

            container.querySelectorAll('.mr-page-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var val = btn.dataset.page;
                    if (val === 'prev') { if (mrCurrentPage > 1) mrCurrentPage--; }
                    else if (val === 'next') { if (mrCurrentPage < totalPages) mrCurrentPage++; }
                    else mrCurrentPage = parseInt(val);
                    self._renderManageTable();
                    self._renderManagePagination();
                });
            });
        },

        /* ── Complete Refill ── */
        _completeRefill: async function (refillId) {
            var r = mrAllRefills.find(function (x) { return x.id === refillId; });
            if (!r) return;

            var businessId = this.getBusinessId();
            if (!businessId) return;

            var todayStr = this.toISODate(new Date());
            var newNext = this.calcNextRefill(todayStr, r.frequency);

            try {
                await PharmaFlow.getBusinessCollection(businessId, 'medication_refills').doc(refillId).update({
                    lastRefillDate: todayStr,
                    nextRefillDate: newNext,
                    refillCount: firebase.firestore.FieldValue.increment(1),
                    updatedAt: new Date().toISOString(),
                    updatedBy: this.getCurrentUser()
                });

                // Log activity
                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Refill Completed',
                        description: 'Completed refill of ' + r.medication + ' for ' + (r.patientName || 'patient') + '. Next: ' + this.formatDate(newNext),
                        category: 'Refill',
                        status: 'COMPLETED',
                        metadata: { refillId: refillId, medication: r.medication, patientName: r.patientName, nextRefill: newNext }
                    });
                }

                this.showToast('Refill completed! Next refill: ' + this.formatDate(newNext));
            } catch (err) {
                console.error('Complete refill error:', err);
                this.showToast('Failed: ' + err.message, 'error');
            }
        },

        /* ── View Modal ── */
        _showViewModal: function (refillId) {
            var r = mrAllRefills.find(function (x) { return x.id === refillId; });
            if (!r) return;
            var self = this;
            var urgency = this.getRefillUrgency(r.nextRefillDate);
            var urgencyLabel = urgency === 'overdue' ? 'OVERDUE' : urgency === 'urgent' ? 'URGENT' : urgency === 'upcoming' ? 'UPCOMING' : 'SCHEDULED';
            var urgencyClass = urgency === 'overdue' ? 'mr-badge--danger' : urgency === 'urgent' ? 'mr-badge--warning' : urgency === 'upcoming' ? 'mr-badge--info' : 'mr-badge--muted';

            var existing = document.getElementById('mr-view-modal');
            if (existing) existing.remove();

            var modal = document.createElement('div');
            modal.id = 'mr-view-modal';
            modal.className = 'mr-modal-overlay';
            modal.innerHTML = `
                <div class="mr-modal">
                    <div class="mr-modal-header">
                        <h3><i class="fas fa-eye"></i> Refill Details</h3>
                        <button class="mr-modal-close" id="mr-view-close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="mr-modal-body">
                        <div class="mr-detail-grid">
                            <div class="mr-detail-item"><label>Refill ID</label><span>${self.escapeHtml(r.refillId || r.id)}</span></div>
                            <div class="mr-detail-item"><label>Patient</label><span>${self.escapeHtml(r.patientName || 'Unknown')}</span></div>
                            <div class="mr-detail-item"><label>Condition</label><span>${self.escapeHtml(r.condition || '—')}</span></div>
                            <div class="mr-detail-item"><label>Medication</label><span>${self.escapeHtml(r.medication)}</span></div>
                            <div class="mr-detail-item"><label>Dosage</label><span>${self.escapeHtml(r.dosage)}</span></div>
                            <div class="mr-detail-item"><label>Qty per Refill</label><span>${r.quantityPerRefill || '—'}</span></div>
                            <div class="mr-detail-item"><label>Frequency</label><span>${self.escapeHtml(r.frequency)}</span></div>
                            <div class="mr-detail-item"><label>Last Refill</label><span>${self.formatDate(r.lastRefillDate)}</span></div>
                            <div class="mr-detail-item"><label>Next Refill</label><span>${self.formatDate(r.nextRefillDate)} <span class="mr-badge ${urgencyClass}">${urgencyLabel}</span></span></div>
                            <div class="mr-detail-item"><label>Reminder</label><span>${r.reminderDays || 3} days before</span></div>
                            <div class="mr-detail-item"><label>Doctor</label><span>${self.escapeHtml(r.doctor || '—')}</span></div>
                            <div class="mr-detail-item"><label>Status</label><span>${self.escapeHtml(r.status)}</span></div>
                            <div class="mr-detail-item"><label>Refill Count</label><span>${r.refillCount || 0}</span></div>
                            <div class="mr-detail-item"><label>Created</label><span>${self.formatDate(r.createdAt)} by ${self.escapeHtml(r.createdBy || '—')}</span></div>
                        </div>
                        ${r.notes ? '<div class="mr-detail-notes"><label>Notes</label><p>' + self.escapeHtml(r.notes) + '</p></div>' : ''}
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            modal.querySelector('#mr-view-close').addEventListener('click', function () { modal.remove(); });
            modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
        },

        /* ── Edit Modal ── */
        _showEditModal: function (refillId) {
            var r = mrAllRefills.find(function (x) { return x.id === refillId; });
            if (!r) return;
            var self = this;

            var existing = document.getElementById('mr-edit-modal');
            if (existing) existing.remove();

            var modal = document.createElement('div');
            modal.id = 'mr-edit-modal';
            modal.className = 'mr-modal-overlay';
            modal.innerHTML = `
                <div class="mr-modal">
                    <div class="mr-modal-header">
                        <h3><i class="fas fa-pen"></i> Edit Refill</h3>
                        <button class="mr-modal-close" id="mr-edit-close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="mr-modal-body">
                        <div class="mr-form-grid">
                            <div class="mr-field">
                                <label>Condition</label>
                                <input type="text" id="mr-edit-condition" class="mr-input" value="${self.escapeHtml(r.condition || '')}">
                            </div>
                            <div class="mr-field">
                                <label>Medication</label>
                                <input type="text" id="mr-edit-medication" class="mr-input" value="${self.escapeHtml(r.medication || '')}">
                            </div>
                            <div class="mr-field">
                                <label>Dosage</label>
                                <input type="text" id="mr-edit-dosage" class="mr-input" value="${self.escapeHtml(r.dosage || '')}">
                            </div>
                            <div class="mr-field">
                                <label>Qty per Refill</label>
                                <input type="number" id="mr-edit-quantity" class="mr-input" value="${r.quantityPerRefill || ''}">
                            </div>
                            <div class="mr-field">
                                <label>Frequency</label>
                                <select id="mr-edit-frequency" class="mr-select">
                                    ${MR_FREQUENCIES.map(function (f) { return '<option value="' + f + '"' + (f === r.frequency ? ' selected' : '') + '>' + f + '</option>'; }).join('')}
                                </select>
                            </div>
                            <div class="mr-field">
                                <label>Reminder (days)</label>
                                <input type="number" id="mr-edit-reminder" class="mr-input" value="${r.reminderDays || 3}" min="0" max="30">
                            </div>
                            <div class="mr-field">
                                <label>Doctor</label>
                                <input type="text" id="mr-edit-doctor" class="mr-input" value="${self.escapeHtml(r.doctor || '')}">
                            </div>
                            <div class="mr-field">
                                <label>Status</label>
                                <select id="mr-edit-status" class="mr-select">
                                    ${MR_STATUSES.map(function (s) { return '<option value="' + s + '"' + (s === r.status ? ' selected' : '') + '>' + s + '</option>'; }).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="mr-field" style="margin-top:8px;">
                            <label>Notes</label>
                            <textarea id="mr-edit-notes" class="mr-input mr-textarea" rows="3">${self.escapeHtml(r.notes || '')}</textarea>
                        </div>
                        <div class="mr-form-actions" style="margin-top:16px;">
                            <button class="mr-btn mr-btn--primary" id="mr-edit-save"><i class="fas fa-save"></i> Save Changes</button>
                            <button class="mr-btn mr-btn--danger" id="mr-edit-delete"><i class="fas fa-trash"></i> Delete</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            modal.querySelector('#mr-edit-close').addEventListener('click', function () { modal.remove(); });
            modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });

            modal.querySelector('#mr-edit-save').addEventListener('click', async function () {
                var businessId = self.getBusinessId();
                if (!businessId) return;

                var updates = {
                    condition: (document.getElementById('mr-edit-condition')?.value || '').trim(),
                    medication: (document.getElementById('mr-edit-medication')?.value || '').trim(),
                    dosage: (document.getElementById('mr-edit-dosage')?.value || '').trim(),
                    quantityPerRefill: parseInt(document.getElementById('mr-edit-quantity')?.value) || 0,
                    frequency: document.getElementById('mr-edit-frequency')?.value || 'Monthly',
                    reminderDays: parseInt(document.getElementById('mr-edit-reminder')?.value) || 3,
                    doctor: (document.getElementById('mr-edit-doctor')?.value || '').trim(),
                    status: document.getElementById('mr-edit-status')?.value || 'Active',
                    notes: (document.getElementById('mr-edit-notes')?.value || '').trim(),
                    updatedAt: new Date().toISOString(),
                    updatedBy: self.getCurrentUser()
                };

                // Recalculate next refill if frequency changed
                if (updates.frequency !== r.frequency && r.lastRefillDate) {
                    updates.nextRefillDate = self.calcNextRefill(r.lastRefillDate, updates.frequency);
                }

                try {
                    await PharmaFlow.getBusinessCollection(businessId, 'medication_refills').doc(refillId).update(updates);

                    if (PharmaFlow.ActivityLog) {
                        PharmaFlow.ActivityLog.log({
                            title: 'Refill Schedule Updated',
                            description: 'Updated refill for ' + (r.patientName || 'patient') + ' — ' + updates.medication,
                            category: 'Refill',
                            status: 'COMPLETED',
                            metadata: { refillId: refillId, medication: updates.medication, status: updates.status }
                        });
                    }

                    self.showToast('Refill updated!');
                    modal.remove();
                } catch (err) {
                    console.error('Edit refill error:', err);
                    self.showToast('Failed: ' + err.message, 'error');
                }
            });

            modal.querySelector('#mr-edit-delete').addEventListener('click', async function () {
                if (!(await PharmaFlow.confirm('Delete this refill schedule permanently?', { title: 'Delete Refill', confirmText: 'Delete', danger: true }))) return;
                var businessId = self.getBusinessId();
                try {
                    await PharmaFlow.getBusinessCollection(businessId, 'medication_refills').doc(refillId).delete();

                    if (PharmaFlow.ActivityLog) {
                        PharmaFlow.ActivityLog.log({
                            title: 'Refill Schedule Deleted',
                            description: 'Deleted refill schedule for ' + (r.patientName || 'patient') + ' — ' + r.medication,
                            category: 'Refill',
                            status: 'COMPLETED',
                            metadata: { refillId: refillId, medication: r.medication, patientName: r.patientName }
                        });
                    }

                    self.showToast('Refill deleted');
                    modal.remove();
                } catch (err) {
                    console.error('Delete refill error:', err);
                    self.showToast('Failed: ' + err.message, 'error');
                }
            });
        },

        /* ══════════════════════════════════════════
         * 4) REFILL REMINDERS
         * ══════════════════════════════════════════ */

        renderReminders: function (container) {
            this.cleanup();
            var businessId = this.getBusinessId();

            container.innerHTML = `
                <div class="mr-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-bell"></i> Refill Reminders</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a><span>/</span>
                                <span>Medication Refill</span><span>/</span><span>Reminders</span>
                            </div>
                        </div>
                    </div>

                    <!-- Reminder time range -->
                    <div class="mr-filters-bar">
                        <div class="mr-filter-group">
                            <label>View</label>
                            <select id="mr-reminder-range" class="mr-select">
                                <option value="3">Next 3 Days</option>
                                <option value="7" selected>Next 7 Days</option>
                                <option value="14">Next 14 Days</option>
                                <option value="30">Next 30 Days</option>
                            </select>
                        </div>
                        <div class="mr-filter-group mr-filter-actions">
                            <label>&nbsp;</label>
                            <button class="mr-btn mr-btn--primary" id="mr-reminder-apply"><i class="fas fa-search"></i> Show</button>
                        </div>
                    </div>

                    <!-- Overdue section -->
                    <div class="mr-reminder-section" id="mr-reminder-overdue"></div>

                    <!-- Upcoming section -->
                    <div class="mr-reminder-section" id="mr-reminder-upcoming"></div>
                </div>
            `;

            var dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', function (e) {
                e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null);
            });

            var self = this;
            var applyBtn = document.getElementById('mr-reminder-apply');
            if (applyBtn) applyBtn.addEventListener('click', function () { self._renderReminderLists(); });

            this._loadReminderData(businessId);
        },

        _loadReminderData: function (businessId) {
            if (!businessId) return;
            var self = this;
            var ref = PharmaFlow.getBusinessCollection(businessId, 'medication_refills');
            if (!ref) return;

            if (mrUnsubRefills) { mrUnsubRefills(); mrUnsubRefills = null; }

            mrUnsubRefills = ref.where('status', '==', 'Active').orderBy('nextRefillDate', 'asc').onSnapshot(function (snap) {
                mrAllRefills = [];
                snap.forEach(function (doc) { mrAllRefills.push(Object.assign({ id: doc.id }, doc.data())); });
                self._renderReminderLists();
            });
        },

        _renderReminderLists: function () {
            var self = this;
            var todayStr = this.toISODate(new Date());
            var rangeDays = parseInt((document.getElementById('mr-reminder-range') || {}).value) || 7;
            var futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + rangeDays);
            var futureStr = this.toISODate(futureDate);

            var overdue = mrAllRefills.filter(function (r) { return r.nextRefillDate && r.nextRefillDate < todayStr; });
            var upcoming = mrAllRefills.filter(function (r) { return r.nextRefillDate && r.nextRefillDate >= todayStr && r.nextRefillDate <= futureStr; });

            // Overdue section
            var overdueSection = document.getElementById('mr-reminder-overdue');
            if (overdueSection) {
                if (overdue.length === 0) {
                    overdueSection.innerHTML = '<div class="mr-reminder-header mr-reminder-header--danger"><i class="fas fa-exclamation-triangle"></i> Overdue (0)</div><div class="mr-empty-mini"><i class="fas fa-check-circle" style="color:#16a34a;"></i> No overdue refills!</div>';
                } else {
                    var html = '<div class="mr-reminder-header mr-reminder-header--danger"><i class="fas fa-exclamation-triangle"></i> Overdue (' + overdue.length + ')</div>';
                    html += '<div class="mr-reminder-cards">';
                    overdue.forEach(function (r) {
                        var daysOver = self.daysBetween(r.nextRefillDate, todayStr);
                        html += '<div class="mr-reminder-card mr-reminder-card--overdue">' +
                            '<div class="mr-reminder-card-top">' +
                                '<div class="mr-reminder-patient"><i class="fas fa-user"></i> ' + self.escapeHtml(r.patientName || 'Unknown') + '</div>' +
                                '<span class="mr-badge mr-badge--danger">' + daysOver + ' day' + (daysOver !== 1 ? 's' : '') + ' overdue</span>' +
                            '</div>' +
                            '<div class="mr-reminder-med"><i class="fas fa-pills"></i> ' + self.escapeHtml(r.medication) + ' — ' + self.escapeHtml(r.dosage || '') + '</div>' +
                            '<div class="mr-reminder-meta">' +
                                '<span><i class="fas fa-calendar"></i> Due: ' + self.formatDate(r.nextRefillDate) + '</span>' +
                                '<span><i class="fas fa-repeat"></i> ' + self.escapeHtml(r.frequency) + '</span>' +
                            '</div>' +
                            '<div class="mr-reminder-actions">' +
                                '<button class="mr-btn mr-btn--sm mr-btn--success" data-action="complete" data-id="' + r.id + '"><i class="fas fa-check"></i> Complete Refill</button>' +
                                (r.patientName ? '<button class="mr-btn mr-btn--sm mr-btn--outline" data-action="contact" data-phone="' + self.escapeHtml(r.patientPhone || '') + '" data-name="' + self.escapeHtml(r.patientName) + '"><i class="fas fa-phone"></i> Contact</button>' : '') +
                            '</div>' +
                        '</div>';
                    });
                    html += '</div>';
                    overdueSection.innerHTML = html;

                    overdueSection.querySelectorAll('[data-action="complete"]').forEach(function (btn) {
                        btn.addEventListener('click', function () { self._completeRefill(btn.dataset.id); });
                    });
                    overdueSection.querySelectorAll('[data-action="contact"]').forEach(function (btn) {
                        btn.addEventListener('click', function () {
                            var phone = btn.dataset.phone;
                            if (phone) {
                                self.showToast('Patient phone: ' + phone);
                            } else {
                                self.showToast('No phone number on file', 'error');
                            }
                        });
                    });
                }
            }

            // Upcoming section
            var upcomingSection = document.getElementById('mr-reminder-upcoming');
            if (upcomingSection) {
                if (upcoming.length === 0) {
                    upcomingSection.innerHTML = '<div class="mr-reminder-header mr-reminder-header--info"><i class="fas fa-calendar-check"></i> Upcoming (' + rangeDays + ' days) (0)</div><div class="mr-empty-mini"><i class="fas fa-calendar-xmark"></i> No upcoming refills in this period</div>';
                } else {
                    var html = '<div class="mr-reminder-header mr-reminder-header--info"><i class="fas fa-calendar-check"></i> Upcoming (' + rangeDays + ' days) (' + upcoming.length + ')</div>';
                    html += '<div class="mr-reminder-cards">';
                    upcoming.forEach(function (r) {
                        var daysUntil = self.daysBetween(todayStr, r.nextRefillDate);
                        var label = daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : 'In ' + daysUntil + ' days';
                        var cardClass = daysUntil <= (r.reminderDays || 3) ? 'mr-reminder-card--alert' : '';

                        html += '<div class="mr-reminder-card ' + cardClass + '">' +
                            '<div class="mr-reminder-card-top">' +
                                '<div class="mr-reminder-patient"><i class="fas fa-user"></i> ' + self.escapeHtml(r.patientName || 'Unknown') + '</div>' +
                                '<span class="mr-badge mr-badge--info">' + label + '</span>' +
                            '</div>' +
                            '<div class="mr-reminder-med"><i class="fas fa-pills"></i> ' + self.escapeHtml(r.medication) + ' — ' + self.escapeHtml(r.dosage || '') + '</div>' +
                            '<div class="mr-reminder-meta">' +
                                '<span><i class="fas fa-calendar"></i> Due: ' + self.formatDate(r.nextRefillDate) + '</span>' +
                                '<span><i class="fas fa-repeat"></i> ' + self.escapeHtml(r.frequency) + '</span>' +
                                (r.doctor ? '<span><i class="fas fa-user-md"></i> ' + self.escapeHtml(r.doctor) + '</span>' : '') +
                            '</div>' +
                        '</div>';
                    });
                    html += '</div>';
                    upcomingSection.innerHTML = html;
                }
            }
        }
    };

    window.PharmaFlow.MedicationRefill = MedicationRefill;
})();
