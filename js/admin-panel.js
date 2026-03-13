/**
 * PharmaFlow - Admin Panel Module
 * Robust permission-based, role-based administration:
 *   - Admin Dashboard: Stats overview (businesses, users, roles)
 *   - Manage Users: Full CRUD with role assignment + granular module/sub-module permissions
 *   - Manage Franchises: Superadmin creates/manages businesses (franchises)
 *
 * Permission model:
 *   userProfile.permissions = ['dashboard', 'pharmacy', 'pharmacy:pos', 'inventory', ...]
 *   Empty permissions array or missing = access ALL modules (backward compatible).
 *   Superadmins always have full access.
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let usersListener = null;
    let businessesListener = null;
    let bizUsersListener = null;
    let analyticsListener = null;
    let alertsListener = null;
    let allUsers = [];
    let allBusinesses = [];
    let bizNameCache = {};
    let filteredUsers = [];
    let filteredBusinesses = [];
    let userCurrentPage = 1;
    let bizCurrentPage = 1;
    const PAGE_SIZE = 20;

    /**
     * Build a flat list of all module + sub-module permission keys from NAV_CONFIG.
     * Returns [{moduleId, moduleLabel, moduleIcon, children: [{id, label}]}]
     */
    function buildPermissionTree() {
        const navConfig = PharmaFlow.NAV_CONFIG || [];
        return navConfig.map(mod => ({
            moduleId: mod.id,
            moduleLabel: mod.label,
            moduleIcon: mod.icon,
            section: mod.section || '',
            children: (mod.children || []).map(c => ({ id: c.id, label: c.label, icon: c.icon }))
        }));
    }

    const AdminPanel = {

        // ═══════════════════════════════════════════════
        //  UTILITIES
        // ═══════════════════════════════════════════════

        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        isSuperAdmin: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.isSuperAdmin ? PharmaFlow.Auth.isSuperAdmin() : false;
        },

        isAdminOrAbove: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.isAdminOrAbove ? PharmaFlow.Auth.isAdminOrAbove() : false;
        },

        escapeHtml: function (str) {
            if (!str) return '';
            const d = document.createElement('div');
            d.textContent = str;
            return d.innerHTML;
        },

        showToast: function (msg, type) {
            const old = document.querySelector('.adm-toast');
            if (old) old.remove();
            const t = document.createElement('div');
            t.className = 'adm-toast' + (type === 'error' ? ' adm-toast--error' : '');
            t.innerHTML = '<i class="fas ' + (type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle') + '"></i> ' + msg;
            document.body.appendChild(t);
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
        },

        cleanup: function () {
            if (usersListener) { usersListener(); usersListener = null; }
            if (businessesListener) { businessesListener(); businessesListener = null; }
            if (bizUsersListener) { bizUsersListener(); bizUsersListener = null; }
            if (analyticsListener) { analyticsListener(); analyticsListener = null; }
            if (alertsListener) { alertsListener(); alertsListener = null; }
            allUsers = [];
            allBusinesses = [];
            filteredUsers = [];
            filteredBusinesses = [];
        },

        // ═══════════════════════════════════════════════
        //  ADMIN DASHBOARD
        // ═══════════════════════════════════════════════

        renderDashboard: function (container) {
            this.cleanup();

            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-tachometer-alt"></i> Admin Dashboard</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>Admin Panel</span>
                                <span>/</span><span>Admin Dashboard</span>
                            </div>
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="dda-stats" id="adm-stats">
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon"><i class="fas fa-store"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="adm-total-biz">0</span>
                                <span class="dda-stat-label">Total Franchises</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-users"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="adm-total-users">0</span>
                                <span class="dda-stat-label">Total Users</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--danger"><i class="fas fa-user-shield"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="adm-superadmin-count">0</span>
                                <span class="dda-stat-label">Super Admins</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon" style="background:#dbeafe;color:#2563eb"><i class="fas fa-user-tie"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="adm-admin-count">0</span>
                                <span class="dda-stat-label">Admins</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-user"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="adm-staff-count">0</span>
                                <span class="dda-stat-label">Staff</span>
                            </div>
                        </div>
                    </div>

                    <!-- Quick Actions -->
                    <div class="adm-quick-actions">
                        <button class="adm-action-card" id="adm-goto-users">
                            <i class="fas fa-users-cog"></i>
                            <span>Manage Users</span>
                        </button>
                        ${this.isSuperAdmin() ? `
                        <button class="adm-action-card" id="adm-goto-franchises">
                            <i class="fas fa-building"></i>
                            <span>Manage Franchises</span>
                        </button>
                        <button class="adm-action-card" id="adm-add-user-quick">
                            <i class="fas fa-user-plus"></i>
                            <span>Add New User</span>
                        </button>
                        <button class="adm-action-card" id="adm-add-biz-quick">
                            <i class="fas fa-plus-circle"></i>
                            <span>New Franchise</span>
                        </button>` : `
                        <button class="adm-action-card" id="adm-add-user-quick">
                            <i class="fas fa-user-plus"></i>
                            <span>Add Staff</span>
                        </button>`}
                    </div>

                    <!-- Per-Business User Breakdown -->
                    <div class="ord-card" style="margin-top:20px">
                        <div class="ord-card-header"><i class="fas fa-chart-bar"></i> Users by Franchise</div>
                        <div class="ord-card-body" id="adm-biz-breakdown">
                            <div class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading...</div>
                        </div>
                    </div>
                </div>
            `;

            // Bind
            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });

            document.getElementById('adm-goto-users')?.addEventListener('click', () => {
                PharmaFlow.Sidebar.setActive('admin-panel', 'manage-users');
            });
            document.getElementById('adm-goto-franchises')?.addEventListener('click', () => {
                PharmaFlow.Sidebar.setActive('admin-panel', 'manage-franchises');
            });
            document.getElementById('adm-add-user-quick')?.addEventListener('click', () => {
                PharmaFlow.Sidebar.setActive('admin-panel', 'manage-users');
                // Small delay to let rendering finish then open modal
                setTimeout(() => {
                    const btn = document.getElementById('adm-add-user-btn');
                    if (btn) btn.click();
                }, 200);
            });
            document.getElementById('adm-add-biz-quick')?.addEventListener('click', () => {
                PharmaFlow.Sidebar.setActive('admin-panel', 'manage-franchises');
                setTimeout(() => {
                    const btn = document.getElementById('adm-add-biz-btn');
                    if (btn) btn.click();
                }, 200);
            });

            this.loadDashboardData();
        },

        loadDashboardData: async function () {
            try {
                // Load businesses
                const bizSnap = await window.db.collection('businesses').get();
                const businesses = bizSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                // Load users - superadmin sees all, admin sees own business
                let usersSnap;
                if (this.isSuperAdmin()) {
                    usersSnap = await window.db.collection('users').get();
                } else {
                    const bizId = this.getBusinessId();
                    usersSnap = await window.db.collection('users').where('businessId', '==', bizId).get();
                }
                const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                // Stats
                const el = id => document.getElementById(id);
                if (el('adm-total-biz')) el('adm-total-biz').textContent = businesses.length;
                if (el('adm-total-users')) el('adm-total-users').textContent = users.length;
                if (el('adm-superadmin-count')) el('adm-superadmin-count').textContent = users.filter(u => u.role === 'superadmin').length;
                if (el('adm-admin-count')) el('adm-admin-count').textContent = users.filter(u => u.role === 'admin').length;
                if (el('adm-staff-count')) el('adm-staff-count').textContent = users.filter(u => u.role === 'staff').length;

                // Business breakdown
                const breakdownEl = el('adm-biz-breakdown');
                if (breakdownEl) {
                    if (businesses.length === 0) {
                        breakdownEl.innerHTML = '<div class="ord-ls-empty"><i class="fas fa-inbox"></i> No franchises found.</div>';
                    } else {
                        breakdownEl.innerHTML = '<div class="dda-table-wrap"><table class="dda-table"><thead><tr><th>Franchise</th><th>Location</th><th>Users</th><th>Admins</th><th>Staff</th><th>Status</th></tr></thead><tbody>' +
                            businesses.map(b => {
                                const bizUsers = users.filter(u => u.businessId === b.id);
                                const admins = bizUsers.filter(u => u.role === 'admin' || u.role === 'superadmin').length;
                                const staff = bizUsers.filter(u => u.role === 'staff').length;
                                return '<tr><td><strong>' + this.escapeHtml(b.name || 'Unnamed') + '</strong></td><td>' + this.escapeHtml(b.address || '—') + '</td><td>' + bizUsers.length + '</td><td>' + admins + '</td><td>' + staff + '</td><td>' + (b.isActive !== false ? '<span class="ord-status-badge ord-status--approved">Active</span>' : '<span class="ord-status-badge ord-status--cancelled">Inactive</span>') + '</td></tr>';
                            }).join('') +
                            '</tbody></table></div>';
                    }
                }
            } catch (err) {
                console.error('Admin dashboard data error:', err);
            }
        },

        // ═══════════════════════════════════════════════
        //  MANAGE USERS
        // ═══════════════════════════════════════════════

        renderManageUsers: function (container) {
            this.cleanup();

            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-users-cog"></i> Manage Users</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>Admin Panel</span>
                                <span>/</span><span>Manage Users</span>
                            </div>
                        </div>
                        <button class="dda-btn dda-btn--primary" id="adm-add-user-btn">
                            <i class="fas fa-user-plus"></i> Add User
                        </button>
                    </div>

                    <!-- Stats -->
                    <div class="dda-stats" id="adm-user-stats">
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon"><i class="fas fa-users"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="adm-u-total">0</span>
                                <span class="dda-stat-label">Total Users</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--danger"><i class="fas fa-user-shield"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="adm-u-superadmin">0</span>
                                <span class="dda-stat-label">Super Admins</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon" style="background:#dbeafe;color:#2563eb"><i class="fas fa-user-tie"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="adm-u-admin">0</span>
                                <span class="dda-stat-label">Admins</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-user"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="adm-u-staff">0</span>
                                <span class="dda-stat-label">Staff</span>
                            </div>
                        </div>
                    </div>

                    <!-- Toolbar -->
                    <div class="dda-toolbar">
                        <div class="dda-search-box">
                            <i class="fas fa-search"></i>
                            <input type="text" id="adm-user-search" placeholder="Search by name, email, role...">
                        </div>
                        <div class="dda-toolbar-actions">
                            <select id="adm-role-filter">
                                <option value="">All Roles</option>
                                <option value="superadmin">Super Admin</option>
                                <option value="admin">Admin</option>
                                <option value="staff">Staff</option>
                            </select>
                            ${this.isSuperAdmin() ? `
                            <select id="adm-biz-filter">
                                <option value="">All Franchises</option>
                            </select>` : ''}
                        </div>
                    </div>

                    <!-- Table -->
                    <div class="dda-table-wrap">
                        <table class="dda-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>User</th>
                                    <th>Email</th>
                                    <th>Role</th>
                                    <th>Franchise</th>
                                    <th>Permissions</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="adm-users-tbody">
                                <tr><td colspan="8" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading users...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="dda-pagination" id="adm-users-pagination"></div>
                </div>

                <!-- Add/Edit User Modal -->
                <div class="dda-modal-overlay" id="adm-user-modal" style="display:none">
                    <div class="dda-modal" style="max-width:740px">
                        <div class="dda-modal-header">
                            <h3 id="adm-user-modal-title"><i class="fas fa-user-plus"></i> Add New User</h3>
                            <button class="dda-modal-close" id="adm-user-modal-close">&times;</button>
                        </div>
                        <div class="dda-modal-body">
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Full Name <span class="required">*</span></label>
                                    <input type="text" id="adm-u-name" placeholder="e.g., John Doe">
                                </div>
                                <div class="dda-form-group">
                                    <label>Email <span class="required">*</span></label>
                                    <input type="email" id="adm-u-email" placeholder="user@pharmacy.com">
                                </div>
                            </div>
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Phone</label>
                                    <input type="text" id="adm-u-phone" placeholder="+254 700 000 000">
                                </div>
                                <div class="dda-form-group">
                                    <label>Role <span class="required">*</span></label>
                                    <select id="adm-u-role">
                                        ${this.isSuperAdmin() ? '<option value="superadmin">Super Admin</option>' : ''}
                                        <option value="admin">Admin</option>
                                        <option value="staff" selected>Staff</option>
                                    </select>
                                </div>
                            </div>
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Franchise <span class="required">*</span></label>
                                    <select id="adm-u-business">
                                        <option value="">Select franchise</option>
                                    </select>
                                </div>
                                <div class="dda-form-group">
                                    <label>Status</label>
                                    <select id="adm-u-status">
                                        <option value="active">Active</option>
                                        <option value="disabled">Disabled</option>
                                    </select>
                                </div>
                            </div>
                            <div class="dda-form-group" id="adm-password-group">
                                <label>Temporary Password <span class="required">*</span></label>
                                <input type="password" id="adm-u-password" placeholder="Min 6 characters">
                                <small style="color:var(--text-tertiary)">User should change password after first login</small>
                            </div>

                            <!-- Permissions Section -->
                            <div class="adm-permissions-section">
                                <div class="adm-permissions-header">
                                    <h4><i class="fas fa-key"></i> Module Permissions</h4>
                                    <div class="adm-perm-actions">
                                        <button class="dda-btn dda-btn--sm" id="adm-perm-all">Select All</button>
                                        <button class="dda-btn dda-btn--sm dda-btn--cancel" id="adm-perm-none">Clear All</button>
                                    </div>
                                </div>
                                <p class="adm-perm-hint">Select which modules and sub-modules this user can access. Leave all unchecked for full access (admin/superadmin roles get full access by default).</p>
                                <div class="adm-permissions-grid" id="adm-permissions-grid"></div>
                            </div>

                            <input type="hidden" id="adm-u-edit-id">
                        </div>
                        <div class="dda-modal-footer">
                            <button class="dda-btn dda-btn--cancel" id="adm-user-cancel">Cancel</button>
                            <button class="dda-btn dda-btn--primary" id="adm-user-save"><i class="fas fa-save"></i> Save User</button>
                        </div>
                    </div>
                </div>

                <!-- View User Modal -->
                <div class="dda-modal-overlay" id="adm-view-user-modal" style="display:none">
                    <div class="dda-modal" style="max-width:600px">
                        <div class="dda-modal-header">
                            <h3><i class="fas fa-user"></i> User Details</h3>
                            <button class="dda-modal-close" id="adm-view-user-close">&times;</button>
                        </div>
                        <div class="dda-modal-body" id="adm-view-user-body"></div>
                        <div class="dda-modal-footer">
                            <button class="dda-btn dda-btn--cancel" id="adm-view-user-close-btn">Close</button>
                        </div>
                    </div>
                </div>
            `;

            this.bindUserEvents(container);
            this.renderPermissionsGrid();
            this.subscribeUsers();
            this.loadBusinessesForFilter();
        },

        bindUserEvents: function (container) {
            document.getElementById('adm-user-search')?.addEventListener('input', () => { userCurrentPage = 1; this.filterUsers(); });
            document.getElementById('adm-role-filter')?.addEventListener('change', () => { userCurrentPage = 1; this.filterUsers(); });
            document.getElementById('adm-biz-filter')?.addEventListener('change', () => { userCurrentPage = 1; this.filterUsers(); });

            document.getElementById('adm-add-user-btn')?.addEventListener('click', () => this.openUserModal());
            document.getElementById('adm-user-modal-close')?.addEventListener('click', () => { document.getElementById('adm-user-modal').style.display = 'none'; });
            document.getElementById('adm-user-cancel')?.addEventListener('click', () => { document.getElementById('adm-user-modal').style.display = 'none'; });
            document.getElementById('adm-user-save')?.addEventListener('click', () => this.saveUser());

            document.getElementById('adm-view-user-close')?.addEventListener('click', () => { document.getElementById('adm-view-user-modal').style.display = 'none'; });
            document.getElementById('adm-view-user-close-btn')?.addEventListener('click', () => { document.getElementById('adm-view-user-modal').style.display = 'none'; });

            document.getElementById('adm-perm-all')?.addEventListener('click', () => this.toggleAllPermissions(true));
            document.getElementById('adm-perm-none')?.addEventListener('click', () => this.toggleAllPermissions(false));

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });
        },

        // ═══════════════════════════════════════════════
        //  PERMISSIONS GRID
        // ═══════════════════════════════════════════════

        renderPermissionsGrid: function (existingPerms) {
            const grid = document.getElementById('adm-permissions-grid');
            if (!grid) return;

            const tree = buildPermissionTree();
            const perms = existingPerms || [];
            let currentSection = '';

            grid.innerHTML = tree.map(mod => {
                let sectionHtml = '';
                if (mod.section && mod.section !== currentSection) {
                    currentSection = mod.section;
                    sectionHtml = '<div class="adm-perm-section-title">' + this.escapeHtml(mod.section) + '</div>';
                }

                const moduleChecked = perms.length === 0 || perms.includes(mod.moduleId);
                const childrenHtml = mod.children.map(child => {
                    const childKey = mod.moduleId + ':' + child.id;
                    const childChecked = perms.length === 0 || perms.includes(childKey);
                    return '<label class="adm-perm-child"><input type="checkbox" data-perm="' + childKey + '" data-parent="' + mod.moduleId + '" ' + (childChecked ? 'checked' : '') + '> <i class="' + (child.icon || 'fas fa-circle') + '"></i> ' + this.escapeHtml(child.label) + '</label>';
                }).join('');

                return sectionHtml + `
                    <div class="adm-perm-module">
                        <label class="adm-perm-module-header">
                            <input type="checkbox" data-perm="${mod.moduleId}" data-type="module" ${moduleChecked ? 'checked' : ''}>
                            <i class="${mod.moduleIcon}"></i>
                            <strong>${this.escapeHtml(mod.moduleLabel)}</strong>
                        </label>
                        ${childrenHtml ? '<div class="adm-perm-children">' + childrenHtml + '</div>' : ''}
                    </div>
                `;
            }).join('');

            // Bind module checkbox to toggle its children
            grid.querySelectorAll('input[data-type="module"]').forEach(moduleCheckbox => {
                moduleCheckbox.addEventListener('change', () => {
                    const moduleId = moduleCheckbox.dataset.perm;
                    const children = grid.querySelectorAll('input[data-parent="' + moduleId + '"]');
                    children.forEach(c => { c.checked = moduleCheckbox.checked; });
                });
            });

            // Bind child checkbox to auto-check parent if any child is checked
            grid.querySelectorAll('input[data-parent]').forEach(childCheckbox => {
                childCheckbox.addEventListener('change', () => {
                    const parentId = childCheckbox.dataset.parent;
                    const siblings = grid.querySelectorAll('input[data-parent="' + parentId + '"]');
                    const anyChecked = Array.from(siblings).some(s => s.checked);
                    const moduleCheckbox = grid.querySelector('input[data-perm="' + parentId + '"][data-type="module"]');
                    if (moduleCheckbox) moduleCheckbox.checked = anyChecked;
                });
            });
        },

        toggleAllPermissions: function (selectAll) {
            const grid = document.getElementById('adm-permissions-grid');
            if (!grid) return;
            grid.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = selectAll; });
        },

        getSelectedPermissions: function () {
            const grid = document.getElementById('adm-permissions-grid');
            if (!grid) return [];
            const checked = [];
            grid.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                checked.push(cb.dataset.perm);
            });

            // Check if ALL are selected — if so, return empty array (meaning full access)
            const allCheckboxes = grid.querySelectorAll('input[type="checkbox"]');
            if (checked.length === allCheckboxes.length) return [];

            return checked;
        },

        openUserModal: function (user) {
            const isEdit = !!user;
            document.getElementById('adm-user-modal-title').innerHTML = isEdit
                ? '<i class="fas fa-edit"></i> Edit User'
                : '<i class="fas fa-user-plus"></i> Add New User';

            document.getElementById('adm-u-edit-id').value = isEdit ? user.id : '';
            document.getElementById('adm-u-name').value = isEdit ? (user.displayName || '') : '';
            document.getElementById('adm-u-email').value = isEdit ? (user.email || '') : '';
            document.getElementById('adm-u-phone').value = isEdit ? (user.phone || '') : '';
            document.getElementById('adm-u-role').value = isEdit ? (user.role || 'staff') : 'staff';
            document.getElementById('adm-u-business').value = isEdit ? (user.businessId || '') : (this.getBusinessId() || '');
            document.getElementById('adm-u-status').value = isEdit ? (user.status || 'active') : 'active';

            // Show/hide password field
            const pwGroup = document.getElementById('adm-password-group');
            if (pwGroup) pwGroup.style.display = isEdit ? 'none' : 'block';

            // Email field editable only on create
            const emailField = document.getElementById('adm-u-email');
            if (emailField) emailField.readOnly = isEdit;

            // Render permissions grid with existing permissions
            this.renderPermissionsGrid(isEdit ? (user.permissions || []) : []);

            // Load businesses into dropdown
            this.loadBusinessSelectOptions();

            document.getElementById('adm-user-modal').style.display = 'flex';
        },

        loadBusinessSelectOptions: async function () {
            const select = document.getElementById('adm-u-business');
            if (!select) return;

            // Preserve current value
            const currentVal = select.value;
            select.innerHTML = '<option value="">Select franchise</option>';

            try {
                // Both superadmin and admin can see all active franchises
                const snap = await window.db.collection('businesses').get();
                const businesses = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(b => b.isActive !== false)
                    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

                businesses.forEach(b => {
                    const opt = document.createElement('option');
                    opt.value = b.id;
                    opt.textContent = b.name || b.id;
                    select.appendChild(opt);
                });

                if (currentVal) select.value = currentVal;
            } catch (err) {
                console.error('Load business options error:', err);
            }
        },

        saveUser: async function () {
            const editId = document.getElementById('adm-u-edit-id')?.value;
            const isEdit = !!editId;

            const name = document.getElementById('adm-u-name')?.value?.trim();
            const email = document.getElementById('adm-u-email')?.value?.trim();
            const phone = document.getElementById('adm-u-phone')?.value?.trim();
            const role = document.getElementById('adm-u-role')?.value;
            const businessId = document.getElementById('adm-u-business')?.value;
            const status = document.getElementById('adm-u-status')?.value;
            const password = document.getElementById('adm-u-password')?.value;
            const permissions = this.getSelectedPermissions();

            if (!name) { this.showToast('Please enter a name.', 'error'); return; }
            if (!email) { this.showToast('Please enter an email.', 'error'); return; }
            if (!businessId) { this.showToast('Please select a franchise.', 'error'); return; }
            if (!isEdit && (!password || password.length < 6)) { this.showToast('Password must be at least 6 characters.', 'error'); return; }

            // For non-superadmin, prevent creating superadmin users
            if (!this.isSuperAdmin() && role === 'superadmin') {
                this.showToast('Only superadmins can create superadmin users.', 'error');
                return;
            }

            // Client-side permission checks for edits
            if (isEdit && !this.isSuperAdmin()) {
                const existingUser = allUsers.find(u => u.id === editId);
                const myBizId = PharmaFlow.Auth.userProfile ? PharmaFlow.Auth.userProfile.businessId : null;

                if (existingUser && existingUser.businessId !== myBizId) {
                    this.showToast('You can only edit users within your own franchise.', 'error');
                    return;
                }
                if (existingUser && existingUser.role === 'superadmin') {
                    this.showToast('Only superadmins can edit superadmin users.', 'error');
                    return;
                }
            }

            const btn = document.getElementById('adm-user-save');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

            try {
                if (isEdit) {
                    // UPDATE existing user profile in Firestore
                    // Protect master superadmin from role demotion
                    const masterEmail = (PharmaFlow.MASTER_EMAIL || 'admin@pharmaflow.com').toLowerCase();
                    const existingUser = allUsers.find(u => u.id === editId);
                    if (existingUser && existingUser.email && existingUser.email.toLowerCase() === masterEmail && role !== 'superadmin') {
                        this.showToast('The master superadmin role cannot be changed.', 'error');
                        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save User'; }
                        return;
                    }

                    const updateData = {
                        displayName: name,
                        phone: phone,
                        role: role,
                        businessId: businessId,
                        status: status,
                        permissions: permissions,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: PharmaFlow.Auth.userProfile ? (PharmaFlow.Auth.userProfile.displayName || PharmaFlow.Auth.userProfile.email) : 'Unknown'
                    };

                    await window.db.collection('users').doc(editId).update(updateData);
                    this.showToast('User updated successfully!');
                } else {
                    // CREATE new user via Firebase Auth + Firestore profile
                    // Use Firebase Auth REST API to create user without signing out current admin
                    const apiKey = PharmaFlow.firebaseConfig ? PharmaFlow.firebaseConfig.apiKey : null;
                    if (!apiKey) throw new Error('Firebase API key not found.');

                    const signUpUrl = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(apiKey);
                    const resp = await fetch(signUpUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email: email,
                            password: password,
                            returnSecureToken: false
                        })
                    });

                    const respData = await resp.json();
                    if (respData.error) {
                        const errMsg = respData.error.message || 'Failed to create auth account.';
                        throw new Error(errMsg === 'EMAIL_EXISTS' ? 'A user with this email already exists.' : errMsg);
                    }

                    const newUid = respData.localId;

                    // Create Firestore user profile
                    await window.db.collection('users').doc(newUid).set({
                        email: email,
                        displayName: name,
                        phone: phone,
                        role: role,
                        businessId: businessId,
                        status: status,
                        permissions: permissions,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdBy: PharmaFlow.Auth.userProfile ? (PharmaFlow.Auth.userProfile.displayName || PharmaFlow.Auth.userProfile.email) : 'Unknown'
                    });

                    this.showToast('User created successfully! They can now log in with: ' + email);
                }

                document.getElementById('adm-user-modal').style.display = 'none';
            } catch (err) {
                console.error('Save user error:', err);
                this.showToast('Error: ' + err.message, 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save User'; }
            }
        },

        /**
         * Check if the current user can edit a given target user
         */
        canEditUser: function (targetUser) {
            if (!targetUser) return false;
            const myUid = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
            // Can't edit yourself via the admin panel edit flow
            if (targetUser.id === myUid) return false;
            // Superadmin can edit anyone
            if (this.isSuperAdmin()) return true;
            // Admin can edit users in their own business (but not superadmins)
            if (this.isAdminOrAbove()) {
                const myBizId = PharmaFlow.Auth.userProfile ? PharmaFlow.Auth.userProfile.businessId : null;
                return targetUser.businessId === myBizId && targetUser.role !== 'superadmin';
            }
            return false;
        },

        subscribeUsers: function () {
            if (usersListener) usersListener();

            // Pre-load business names so the table renders synchronously
            window.db.collection('businesses').get().then(snap => {
                snap.docs.forEach(d => { bizNameCache[d.id] = d.data().name || d.id; });
                if (allUsers.length > 0) this.filterUsers();
            }).catch(err => console.error('Load business names error:', err));

            // Superadmin sees ALL users; admin sees only users in their own business
            let query;
            if (this.isSuperAdmin()) {
                query = window.db.collection('users');
            } else {
                const myBizId = PharmaFlow.Auth.userProfile ? PharmaFlow.Auth.userProfile.businessId : null;
                query = myBizId
                    ? window.db.collection('users').where('businessId', '==', myBizId)
                    : window.db.collection('users');
            }

            usersListener = query.onSnapshot(snap => {
                allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                allUsers.sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''));

                // Update bizNameCache for any new businessIds we haven't seen
                const unknownBizIds = [...new Set(allUsers.map(u => u.businessId).filter(id => id && !bizNameCache[id]))];
                if (unknownBizIds.length > 0) {
                    unknownBizIds.forEach(bizId => {
                        window.db.collection('businesses').doc(bizId).get().then(doc => {
                            if (doc.exists) bizNameCache[doc.id] = doc.data().name || doc.id;
                            this.filterUsers();
                        }).catch(() => {});
                    });
                }

                this.updateUserStats();
                this.filterUsers();
            }, err => {
                console.error('Users subscribe error:', err);
            });
        },

        loadBusinessesForFilter: async function () {
            const select = document.getElementById('adm-biz-filter');
            if (!select) return;

            try {
                const snap = await window.db.collection('businesses').get();
                snap.docs.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = d.data().name || d.id;
                    select.appendChild(opt);
                });
            } catch (err) {
                console.error('Load businesses for filter error:', err);
            }
        },

        updateUserStats: function () {
            const el = id => document.getElementById(id);
            if (el('adm-u-total')) el('adm-u-total').textContent = allUsers.length;
            if (el('adm-u-superadmin')) el('adm-u-superadmin').textContent = allUsers.filter(u => u.role === 'superadmin').length;
            if (el('adm-u-admin')) el('adm-u-admin').textContent = allUsers.filter(u => u.role === 'admin').length;
            if (el('adm-u-staff')) el('adm-u-staff').textContent = allUsers.filter(u => u.role === 'staff').length;
        },

        filterUsers: function () {
            const query = (document.getElementById('adm-user-search')?.value || '').toLowerCase();
            const roleFilter = document.getElementById('adm-role-filter')?.value || '';
            const bizFilter = document.getElementById('adm-biz-filter')?.value || '';

            filteredUsers = allUsers.filter(u => {
                if (roleFilter && u.role !== roleFilter) return false;
                if (bizFilter && u.businessId !== bizFilter) return false;
                if (query) {
                    const haystack = ((u.displayName || '') + ' ' + (u.email || '') + ' ' + (u.role || '') + ' ' + (u.phone || '')).toLowerCase();
                    return haystack.includes(query);
                }
                return true;
            });

            this.renderUsersTable();
        },

        renderUsersTable: function () {
            const tbody = document.getElementById('adm-users-tbody');
            if (!tbody) return;

            const start = (userCurrentPage - 1) * PAGE_SIZE;
            const pageData = filteredUsers.slice(start, start + PAGE_SIZE);

            if (pageData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="dda-loading"><i class="fas fa-inbox"></i> No users found</td></tr>';
                this.renderUsersPagination();
                return;
            }

            const myUid = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;

            tbody.innerHTML = pageData.map((u, i) => {
                const roleBadge = this.getRoleBadge(u.role);
                const isDisabled = u.status === 'disabled';
                const statusBadge = isDisabled
                    ? '<span class="ord-status-badge ord-status--cancelled">Suspended</span>'
                    : '<span class="ord-status-badge ord-status--approved">Active</span>';
                const permCount = (u.permissions && u.permissions.length > 0) ? u.permissions.length + ' custom' : 'Full access';
                const isMe = u.id === myUid;
                const canEdit = this.canEditUser(u);
                const canManage = canEdit;

                return `<tr${isMe ? ' style="background:var(--bg-tertiary,#f0fdf4)"' : ''}>
                    <td>${start + i + 1}</td>
                    <td>
                        <div class="adm-user-cell">
                            <div class="adm-user-avatar">${this.getInitials(u.displayName || u.email)}</div>
                            <div>
                                <strong>${this.escapeHtml(u.displayName || 'Unnamed')}</strong>
                                ${isMe ? ' <span class="exp-recurring-tag">You</span>' : ''}
                                ${u.phone ? '<br><small style="color:var(--text-tertiary)">' + this.escapeHtml(u.phone) + '</small>' : ''}
                            </div>
                        </div>
                    </td>
                    <td>${this.escapeHtml(u.email || '\u2014')}</td>
                    <td>${roleBadge}</td>
                    <td>${this.escapeHtml(bizNameCache[u.businessId] || u.businessId || '\u2014')}</td>
                    <td><span class="adm-perm-count">${permCount}</span></td>
                    <td>${statusBadge}</td>
                    <td>
                        <div class="adm-actions-cell">
                            <button class="sales-action-btn sales-action--view adm-view-user" data-id="${u.id}" title="View"><i class="fas fa-eye"></i></button>
                            ${canEdit ? '<button class="sales-action-btn adm-edit-user" data-id="' + u.id + '" title="Edit" style="background:#e0e7ff;color:#4338ca"><i class="fas fa-edit"></i></button>' : ''}
                            ${canManage ? '<button class="sales-action-btn adm-toggle-user" data-id="' + u.id + '" data-status="' + (u.status || 'active') + '" title="' + (isDisabled ? 'Reactivate' : 'Suspend') + '" style="background:' + (isDisabled ? '#dcfce7;color:#16a34a' : '#fef3c7;color:#92400e') + '"><i class="fas ' + (isDisabled ? 'fa-user-check' : 'fa-user-slash') + '"></i></button>' : ''}
                            ${canManage ? '<button class="sales-action-btn adm-delete-user" data-id="' + u.id + '" title="Delete" style="background:#fee2e2;color:#991b1b"><i class="fas fa-trash"></i></button>' : ''}
                        </div>
                    </td>
                </tr>`;
            }).join('');

            // Bind actions
            tbody.querySelectorAll('.adm-view-user').forEach(btn => {
                btn.addEventListener('click', () => {
                    const user = allUsers.find(u => u.id === btn.dataset.id);
                    if (user) this.viewUser(user, bizNameCache);
                });
            });
            tbody.querySelectorAll('.adm-edit-user').forEach(btn => {
                btn.addEventListener('click', () => {
                    const user = allUsers.find(u => u.id === btn.dataset.id);
                    if (user) this.openUserModal(user);
                });
            });
            tbody.querySelectorAll('.adm-toggle-user').forEach(btn => {
                btn.addEventListener('click', () => this.toggleUserStatus(btn.dataset.id, btn.dataset.status));
            });
            tbody.querySelectorAll('.adm-delete-user').forEach(btn => {
                btn.addEventListener('click', () => this.deleteUser(btn.dataset.id));
            });

            this.renderUsersPagination();
        },

        getRoleBadge: function (role) {
            const map = {
                'superadmin': '<span class="adm-role-badge adm-role--superadmin"><i class="fas fa-crown"></i> Super Admin</span>',
                'admin': '<span class="adm-role-badge adm-role--admin"><i class="fas fa-user-tie"></i> Admin</span>',
                'staff': '<span class="adm-role-badge adm-role--staff"><i class="fas fa-user"></i> Staff</span>'
            };
            return map[role] || '<span class="adm-role-badge adm-role--staff">' + (role || 'Unknown') + '</span>';
        },

        getInitials: function (name) {
            if (!name) return '?';
            return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        },

        viewUser: function (user, bizNames) {
            const modal = document.getElementById('adm-view-user-modal');
            const body = document.getElementById('adm-view-user-body');
            if (!modal || !body) return;

            const tree = buildPermissionTree();
            let permHtml = '<span style="color:#22c55e;font-weight:600">Full access (all modules)</span>';
            if (user.permissions && user.permissions.length > 0) {
                permHtml = user.permissions.map(p => {
                    if (p.includes(':')) {
                        const [modId, subId] = p.split(':');
                        const mod = tree.find(m => m.moduleId === modId);
                        const child = mod ? mod.children.find(c => c.id === subId) : null;
                        return '<span class="adm-perm-tag"><i class="' + (child ? child.icon : 'fas fa-circle') + '"></i> ' + this.escapeHtml(child ? child.label : subId) + '</span>';
                    } else {
                        const mod = tree.find(m => m.moduleId === p);
                        return '<span class="adm-perm-tag adm-perm-tag--module"><i class="' + (mod ? mod.moduleIcon : 'fas fa-circle') + '"></i> ' + this.escapeHtml(mod ? mod.moduleLabel : p) + '</span>';
                    }
                }).join(' ');
            }

            body.innerHTML = `
                <div class="adm-view-user-header">
                    <div class="adm-view-avatar-lg">${this.getInitials(user.displayName || user.email)}</div>
                    <div>
                        <h3 style="margin:0">${this.escapeHtml(user.displayName || 'Unnamed')}</h3>
                        <p style="margin:4px 0 0;color:var(--text-tertiary)">${this.escapeHtml(user.email || '')}</p>
                    </div>
                </div>
                <div class="dda-view-details" style="margin-top:16px">
                    <div class="dda-view-row"><span class="dda-view-label">Role</span><span class="dda-view-value">${this.getRoleBadge(user.role)}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Phone</span><span class="dda-view-value">${this.escapeHtml(user.phone || '—')}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Franchise</span><span class="dda-view-value">${this.escapeHtml(bizNames && bizNames[user.businessId] ? bizNames[user.businessId] : (user.businessId || '—'))}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Status</span><span class="dda-view-value">${user.status === 'disabled' ? '<span class="ord-status-badge ord-status--cancelled">Disabled</span>' : '<span class="ord-status-badge ord-status--approved">Active</span>'}</span></div>
                    <div class="dda-view-row"><span class="dda-view-label">Created By</span><span class="dda-view-value">${this.escapeHtml(user.createdBy || '—')}</span></div>
                </div>
                <div style="margin-top:16px">
                    <h4 style="margin:0 0 8px"><i class="fas fa-key"></i> Permissions</h4>
                    <div class="adm-perm-tags">${permHtml}</div>
                </div>
            `;

            modal.style.display = 'flex';
        },

        toggleUserStatus: async function (uid, currentStatus) {
            const user = allUsers.find(u => u.id === uid);
            if (!user) return;

            // Protect master superadmin from suspension
            const masterEmail = (PharmaFlow.MASTER_EMAIL || 'admin@pharmaflow.com').toLowerCase();
            if (user.email && user.email.toLowerCase() === masterEmail) {
                this.showToast('The master superadmin account cannot be suspended.', 'error');
                return;
            }

            const isSuspending = currentStatus !== 'disabled';
            const actionLabel = isSuspending ? 'Suspend' : 'Reactivate';

            if (!(await PharmaFlow.confirm(
                actionLabel + ' user "' + (user.displayName || user.email) + '"?' + (isSuspending ? ' They will not be able to log in.' : ' They will regain access to the system.'),
                { title: actionLabel + ' User', confirmText: 'Yes, ' + actionLabel, danger: isSuspending }
            ))) return;

            try {
                await window.db.collection('users').doc(uid).update({
                    status: isSuspending ? 'disabled' : 'active',
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.showToast('User ' + (isSuspending ? 'suspended' : 'reactivated') + ' successfully!');

                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'User ' + actionLabel + 'd',
                        description: 'User "' + (user.displayName || user.email) + '" was ' + actionLabel.toLowerCase() + 'd',
                        category: 'Admin',
                        status: isSuspending ? 'CRITICAL' : 'Completed'
                    });
                }
            } catch (err) {
                console.error('Toggle user status error:', err);
                this.showToast('Failed to ' + actionLabel.toLowerCase() + ' user.', 'error');
            }
        },

        deleteUser: async function (uid) {
            const user = allUsers.find(u => u.id === uid);
            if (!user) return;

            // Protect master superadmin from deletion
            const masterEmail = (PharmaFlow.MASTER_EMAIL || 'admin@pharmaflow.com').toLowerCase();
            if (user.email && user.email.toLowerCase() === masterEmail) {
                this.showToast('The master superadmin account cannot be deleted.', 'error');
                return;
            }

            if (!(await PharmaFlow.confirm('Delete user "' + (user.displayName || user.email) + '"? This removes their profile from the system. The Firebase Auth account will remain but they won\'t be able to access any business data.', { title: 'Delete User', confirmText: 'Delete', danger: true }))) return;

            try {
                await window.db.collection('users').doc(uid).delete();
                this.showToast('User profile deleted.');

                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'User Deleted',
                        description: 'User "' + (user.displayName || user.email) + '" profile deleted',
                        category: 'Admin',
                        status: 'CRITICAL'
                    });
                }
            } catch (err) {
                console.error('Delete user error:', err);
                this.showToast('Failed to delete user.', 'error');
            }
        },

        renderUsersPagination: function () {
            const container = document.getElementById('adm-users-pagination');
            if (!container) return;
            const totalItems = filteredUsers.length;
            const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
            if (totalPages <= 1) { container.innerHTML = ''; return; }

            const start = (userCurrentPage - 1) * PAGE_SIZE + 1;
            const end = Math.min(userCurrentPage * PAGE_SIZE, totalItems);
            let pagesHtml = '';
            const maxV = 5;
            let sp = Math.max(1, userCurrentPage - Math.floor(maxV / 2));
            let ep = Math.min(totalPages, sp + maxV - 1);
            if (ep - sp < maxV - 1) sp = Math.max(1, ep - maxV + 1);

            if (sp > 1) pagesHtml += '<button class="dda-page-btn" data-page="1">1</button>';
            if (sp > 2) pagesHtml += '<span class="dda-page-dots">...</span>';
            for (let p = sp; p <= ep; p++) {
                pagesHtml += '<button class="dda-page-btn' + (p === userCurrentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
            }
            if (ep < totalPages - 1) pagesHtml += '<span class="dda-page-dots">...</span>';
            if (ep < totalPages) pagesHtml += '<button class="dda-page-btn" data-page="' + totalPages + '">' + totalPages + '</button>';

            container.innerHTML = '<span class="dda-page-info">Showing ' + start + '-' + end + ' of ' + totalItems + '</span><div class="dda-page-controls"><button class="dda-page-btn" data-page="' + (userCurrentPage - 1) + '"' + (userCurrentPage === 1 ? ' disabled' : '') + '><i class="fas fa-chevron-left"></i></button>' + pagesHtml + '<button class="dda-page-btn" data-page="' + (userCurrentPage + 1) + '"' + (userCurrentPage === totalPages ? ' disabled' : '') + '><i class="fas fa-chevron-right"></i></button></div>';

            container.querySelectorAll('.dda-page-btn[data-page]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const page = parseInt(btn.dataset.page);
                    if (page >= 1 && page <= totalPages) { userCurrentPage = page; this.renderUsersTable(); }
                });
            });
        },

        // ═══════════════════════════════════════════════
        //  MANAGE FRANCHISES
        // ═══════════════════════════════════════════════

        renderManageFranchises: function (container) {
            this.cleanup();

            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-building"></i> Manage Franchises</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>Admin Panel</span>
                                <span>/</span><span>Manage Franchises</span>
                            </div>
                        </div>
                        <button class="dda-btn dda-btn--primary" id="adm-add-biz-btn">
                            <i class="fas fa-plus-circle"></i> New Franchise
                        </button>
                    </div>

                    <!-- Stats -->
                    <div class="dda-stats">
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon"><i class="fas fa-store"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="adm-biz-total">0</span>
                                <span class="dda-stat-label">Total Franchises</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-check-circle"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="adm-biz-active">0</span>
                                <span class="dda-stat-label">Active</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--danger"><i class="fas fa-times-circle"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="adm-biz-inactive">0</span>
                                <span class="dda-stat-label">Inactive</span>
                            </div>
                        </div>
                    </div>

                    <!-- Toolbar -->
                    <div class="dda-toolbar">
                        <div class="dda-search-box">
                            <i class="fas fa-search"></i>
                            <input type="text" id="adm-biz-search" placeholder="Search franchise name, address...">
                        </div>
                    </div>

                    <!-- Table -->
                    <div class="dda-table-wrap">
                        <table class="dda-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Franchise Name</th>
                                    <th>Address</th>
                                    <th>Phone</th>
                                    <th>License No.</th>
                                    <th>Users</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="adm-biz-tbody">
                                <tr><td colspan="8" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading franchises...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    <div class="dda-pagination" id="adm-biz-pagination"></div>
                </div>

                <!-- Add/Edit Franchise Modal -->
                <div class="dda-modal-overlay" id="adm-biz-modal" style="display:none">
                    <div class="dda-modal" style="max-width:700px">
                        <div class="dda-modal-header">
                            <h3 id="adm-biz-modal-title"><i class="fas fa-plus-circle"></i> New Franchise</h3>
                            <button class="dda-modal-close" id="adm-biz-modal-close">&times;</button>
                        </div>
                        <div class="dda-modal-body">
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Franchise Name <span class="required">*</span></label>
                                    <input type="text" id="adm-biz-name" placeholder="e.g., ABC Pharmacy - Branch 2">
                                </div>
                                <div class="dda-form-group">
                                    <label>License Number</label>
                                    <input type="text" id="adm-biz-license" placeholder="e.g., PHA/2024/001">
                                </div>
                            </div>
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Phone</label>
                                    <input type="text" id="adm-biz-phone" placeholder="+254 700 000 000">
                                </div>
                                <div class="dda-form-group">
                                    <label>Email</label>
                                    <input type="email" id="adm-biz-email" placeholder="branch@pharmacy.com">
                                </div>
                            </div>
                            <div class="dda-form-group">
                                <label>Address</label>
                                <input type="text" id="adm-biz-address" placeholder="e.g., Nairobi, Kenya">
                            </div>
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Status</label>
                                    <select id="adm-biz-status">
                                        <option value="active">Active</option>
                                        <option value="inactive">Inactive</option>
                                    </select>
                                </div>
                                <div class="dda-form-group">
                                    <label>Notes</label>
                                    <input type="text" id="adm-biz-notes" placeholder="Optional notes">
                                </div>
                            </div>

                            <!-- Assign Admin Section (only on create) -->
                            <div id="adm-biz-assign-section" class="adm-assign-section">
                                <div class="adm-assign-header">
                                    <h4><i class="fas fa-user-shield"></i> Assign Franchise Admin</h4>
                                </div>
                                <p class="adm-perm-hint">Assign an existing user or create a new admin account for this franchise.</p>
                                <div class="dda-form-group">
                                    <label>Assignment Type</label>
                                    <select id="adm-biz-assign-type">
                                        <option value="none">No assignment (assign later)</option>
                                        <option value="existing">Assign existing user</option>
                                        <option value="new">Create new admin user</option>
                                    </select>
                                </div>
                                <div id="adm-biz-assign-existing" style="display:none">
                                    <div class="dda-form-group">
                                        <label>Select User <span class="required">*</span></label>
                                        <select id="adm-biz-assign-user">
                                            <option value="">Select a user...</option>
                                        </select>
                                    </div>
                                    <div class="dda-form-group">
                                        <label>Role for this franchise</label>
                                        <select id="adm-biz-assign-role-existing">
                                            <option value="admin" selected>Admin</option>
                                            <option value="staff">Staff</option>
                                        </select>
                                    </div>
                                </div>
                                <div id="adm-biz-assign-new" style="display:none">
                                    <div class="dda-form-row">
                                        <div class="dda-form-group">
                                            <label>Full Name <span class="required">*</span></label>
                                            <input type="text" id="adm-biz-new-name" placeholder="e.g., John Doe">
                                        </div>
                                        <div class="dda-form-group">
                                            <label>Email <span class="required">*</span></label>
                                            <input type="email" id="adm-biz-new-email" placeholder="admin@pharmacy.com">
                                        </div>
                                    </div>
                                    <div class="dda-form-row">
                                        <div class="dda-form-group">
                                            <label>Phone</label>
                                            <input type="text" id="adm-biz-new-phone" placeholder="+254 700 000 000">
                                        </div>
                                        <div class="dda-form-group">
                                            <label>Role</label>
                                            <select id="adm-biz-assign-role-new">
                                                <option value="admin" selected>Admin</option>
                                                <option value="staff">Staff</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div class="dda-form-group">
                                        <label>Temporary Password <span class="required">*</span></label>
                                        <input type="password" id="adm-biz-new-password" placeholder="Min 6 characters">
                                        <small style="color:var(--text-tertiary)">User should change password after first login</small>
                                    </div>
                                </div>
                            </div>

                            <input type="hidden" id="adm-biz-edit-id">
                        </div>
                        <div class="dda-modal-footer">
                            <button class="dda-btn dda-btn--cancel" id="adm-biz-cancel">Cancel</button>
                            <button class="dda-btn dda-btn--primary" id="adm-biz-save"><i class="fas fa-save"></i> Save Franchise</button>
                        </div>
                    </div>
                </div>
            `;

            this.bindFranchiseEvents(container);
            this.subscribeFranchises();
        },

        bindFranchiseEvents: function (container) {
            document.getElementById('adm-biz-search')?.addEventListener('input', () => { bizCurrentPage = 1; this.filterFranchises(); });
            document.getElementById('adm-add-biz-btn')?.addEventListener('click', () => this.openFranchiseModal());

            document.getElementById('adm-biz-modal-close')?.addEventListener('click', () => { document.getElementById('adm-biz-modal').style.display = 'none'; });
            document.getElementById('adm-biz-cancel')?.addEventListener('click', () => { document.getElementById('adm-biz-modal').style.display = 'none'; });
            document.getElementById('adm-biz-save')?.addEventListener('click', () => this.saveFranchise());

            // Assignment type toggle
            document.getElementById('adm-biz-assign-type')?.addEventListener('change', function () {
                document.getElementById('adm-biz-assign-existing').style.display = this.value === 'existing' ? 'block' : 'none';
                document.getElementById('adm-biz-assign-new').style.display = this.value === 'new' ? 'block' : 'none';
            });

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });
        },

        openFranchiseModal: function (biz) {
            const isEdit = !!biz;
            document.getElementById('adm-biz-modal-title').innerHTML = isEdit
                ? '<i class="fas fa-edit"></i> Edit Franchise'
                : '<i class="fas fa-plus-circle"></i> New Franchise';

            document.getElementById('adm-biz-edit-id').value = isEdit ? biz.id : '';
            document.getElementById('adm-biz-name').value = isEdit ? (biz.name || '') : '';
            document.getElementById('adm-biz-license').value = isEdit ? (biz.licenseNumber || '') : '';
            document.getElementById('adm-biz-phone').value = isEdit ? (biz.phone || '') : '';
            document.getElementById('adm-biz-email').value = isEdit ? (biz.email || '') : '';
            document.getElementById('adm-biz-address').value = isEdit ? (biz.address || '') : '';
            document.getElementById('adm-biz-status').value = isEdit ? (biz.isActive === false ? 'inactive' : 'active') : 'active';
            document.getElementById('adm-biz-notes').value = isEdit ? (biz.notes || '') : '';

            // Show/hide assign admin section (only on create)
            const assignSection = document.getElementById('adm-biz-assign-section');
            if (assignSection) assignSection.style.display = isEdit ? 'none' : 'block';

            // Reset assignment fields
            const assignType = document.getElementById('adm-biz-assign-type');
            if (assignType) { assignType.value = 'none'; assignType.dispatchEvent(new Event('change')); }

            // Load existing users into assignment dropdown
            if (!isEdit) this.loadUsersForAssignment();

            document.getElementById('adm-biz-modal').style.display = 'flex';
        },

        loadUsersForAssignment: async function () {
            const select = document.getElementById('adm-biz-assign-user');
            if (!select) return;

            select.innerHTML = '<option value="">Select a user...</option>';

            try {
                const snap = await window.db.collection('users').get();
                const users = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(u => u.status !== 'disabled')
                    .sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''));

                users.forEach(u => {
                    const opt = document.createElement('option');
                    opt.value = u.id;
                    opt.textContent = (u.displayName || u.email) + ' (' + (u.role || 'staff') + ')';
                    select.appendChild(opt);
                });
            } catch (err) {
                console.error('Load users for assignment error:', err);
            }
        },

        saveFranchise: async function () {
            const editId = document.getElementById('adm-biz-edit-id')?.value;
            const isEdit = !!editId;

            const name = document.getElementById('adm-biz-name')?.value?.trim();
            if (!name) { this.showToast('Franchise name is required.', 'error'); return; }

            const data = {
                name: name,
                licenseNumber: document.getElementById('adm-biz-license')?.value?.trim() || '',
                phone: document.getElementById('adm-biz-phone')?.value?.trim() || '',
                email: document.getElementById('adm-biz-email')?.value?.trim() || '',
                address: document.getElementById('adm-biz-address')?.value?.trim() || '',
                isActive: document.getElementById('adm-biz-status')?.value !== 'inactive',
                notes: document.getElementById('adm-biz-notes')?.value?.trim() || ''
            };

            // Validate admin assignment fields before saving
            const assignType = !isEdit ? (document.getElementById('adm-biz-assign-type')?.value || 'none') : 'none';

            if (assignType === 'existing') {
                const userId = document.getElementById('adm-biz-assign-user')?.value;
                if (!userId) { this.showToast('Please select a user to assign.', 'error'); return; }
            }

            if (assignType === 'new') {
                const newName = document.getElementById('adm-biz-new-name')?.value?.trim();
                const newEmail = document.getElementById('adm-biz-new-email')?.value?.trim();
                const newPassword = document.getElementById('adm-biz-new-password')?.value;
                if (!newName) { this.showToast('Please enter the admin name.', 'error'); return; }
                if (!newEmail) { this.showToast('Please enter the admin email.', 'error'); return; }
                if (!newPassword || newPassword.length < 6) { this.showToast('Password must be at least 6 characters.', 'error'); return; }
            }

            const btn = document.getElementById('adm-biz-save');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

            try {
                let franchiseId;

                if (isEdit) {
                    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
                    await window.db.collection('businesses').doc(editId).update(data);
                    franchiseId = editId;
                    this.showToast('Franchise updated!');
                } else {
                    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                    const docRef = await window.db.collection('businesses').add(data);
                    franchiseId = docRef.id;
                }

                // Handle admin assignment for new franchises
                if (!isEdit && assignType === 'existing') {
                    const userId = document.getElementById('adm-biz-assign-user').value;
                    const role = document.getElementById('adm-biz-assign-role-existing')?.value || 'admin';
                    await window.db.collection('users').doc(userId).update({
                        businessId: franchiseId,
                        role: role,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: PharmaFlow.Auth.userProfile ? (PharmaFlow.Auth.userProfile.displayName || PharmaFlow.Auth.userProfile.email) : 'System'
                    });
                    this.showToast('Franchise created and user assigned!');
                } else if (!isEdit && assignType === 'new') {
                    const newName = document.getElementById('adm-biz-new-name').value.trim();
                    const newEmail = document.getElementById('adm-biz-new-email').value.trim();
                    const newPhone = document.getElementById('adm-biz-new-phone')?.value?.trim() || '';
                    const newPassword = document.getElementById('adm-biz-new-password').value;
                    const newRole = document.getElementById('adm-biz-assign-role-new')?.value || 'admin';

                    // Create Firebase Auth account via REST API
                    const apiKey = PharmaFlow.firebaseConfig ? PharmaFlow.firebaseConfig.apiKey : null;
                    if (!apiKey) throw new Error('Firebase API key not found.');

                    const signUpUrl = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(apiKey);
                    const resp = await fetch(signUpUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: newEmail, password: newPassword, returnSecureToken: false })
                    });

                    const respData = await resp.json();
                    if (respData.error) {
                        const errMsg = respData.error.message || 'Failed to create auth account.';
                        throw new Error(errMsg === 'EMAIL_EXISTS' ? 'A user with this email already exists.' : errMsg);
                    }

                    // Create Firestore user profile linked to this franchise
                    await window.db.collection('users').doc(respData.localId).set({
                        email: newEmail,
                        displayName: newName,
                        phone: newPhone,
                        role: newRole,
                        businessId: franchiseId,
                        status: 'active',
                        permissions: [],
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdBy: PharmaFlow.Auth.userProfile ? (PharmaFlow.Auth.userProfile.displayName || PharmaFlow.Auth.userProfile.email) : 'System'
                    });

                    this.showToast('Franchise created with new admin: ' + newEmail);
                } else if (!isEdit) {
                    this.showToast('Franchise created!');
                }

                document.getElementById('adm-biz-modal').style.display = 'none';
            } catch (err) {
                console.error('Save franchise error:', err);
                this.showToast('Failed: ' + err.message, 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class=\"fas fa-save\"></i> Save Franchise'; }
            }
        },

        subscribeFranchises: function () {
            if (businessesListener) businessesListener();
            if (bizUsersListener) bizUsersListener();

            let cachedBizUsers = [];

            const refreshCounts = () => {
                allBusinesses.forEach(b => {
                    b._userCount = cachedBizUsers.filter(u => u.businessId === b.id).length;
                });
                this.updateBizStats();
                this.filterFranchises();
            };

            businessesListener = window.db.collection('businesses').onSnapshot(snap => {
                allBusinesses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                allBusinesses.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                refreshCounts();
            }, err => {
                console.error('Businesses subscribe error:', err);
            });

            // Real-time listener on users to keep franchise user counts live
            bizUsersListener = window.db.collection('users').onSnapshot(snap => {
                cachedBizUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                refreshCounts();
            }, err => {
                console.error('Biz users count subscribe error:', err);
            });
        },

        updateBizStats: function () {
            const el = id => document.getElementById(id);
            if (el('adm-biz-total')) el('adm-biz-total').textContent = allBusinesses.length;
            if (el('adm-biz-active')) el('adm-biz-active').textContent = allBusinesses.filter(b => b.isActive !== false).length;
            if (el('adm-biz-inactive')) el('adm-biz-inactive').textContent = allBusinesses.filter(b => b.isActive === false).length;
        },

        filterFranchises: function () {
            const query = (document.getElementById('adm-biz-search')?.value || '').toLowerCase();

            filteredBusinesses = allBusinesses.filter(b => {
                if (query) {
                    const haystack = ((b.name || '') + ' ' + (b.address || '') + ' ' + (b.phone || '') + ' ' + (b.licenseNumber || '')).toLowerCase();
                    return haystack.includes(query);
                }
                return true;
            });

            this.renderFranchisesTable();
        },

        renderFranchisesTable: function () {
            const tbody = document.getElementById('adm-biz-tbody');
            if (!tbody) return;

            const start = (bizCurrentPage - 1) * PAGE_SIZE;
            const pageData = filteredBusinesses.slice(start, start + PAGE_SIZE);

            if (pageData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="dda-loading"><i class="fas fa-inbox"></i> No franchises found</td></tr>';
                this.renderBizPagination();
                return;
            }

            tbody.innerHTML = pageData.map((b, i) => {
                const statusBadge = b.isActive !== false
                    ? '<span class="ord-status-badge ord-status--approved">Active</span>'
                    : '<span class="ord-status-badge ord-status--cancelled">Inactive</span>';

                return `<tr>
                    <td>${start + i + 1}</td>
                    <td><strong>${this.escapeHtml(b.name || 'Unnamed')}</strong></td>
                    <td>${this.escapeHtml(b.address || '—')}</td>
                    <td>${this.escapeHtml(b.phone || '—')}</td>
                    <td>${this.escapeHtml(b.licenseNumber || '—')}</td>
                    <td><span class="adm-perm-count">${b._userCount || 0} users</span></td>
                    <td>${statusBadge}</td>
                    <td>
                        <div class="adm-actions-cell">
                            <button class="sales-action-btn adm-edit-biz" data-id="${b.id}" title="Edit" style="background:#e0e7ff;color:#4338ca"><i class="fas fa-edit"></i></button>
                            <button class="sales-action-btn adm-toggle-biz" data-id="${b.id}" data-active="${b.isActive !== false}" title="${b.isActive !== false ? 'Deactivate' : 'Activate'}" style="background:${b.isActive !== false ? '#fef3c7;color:#92400e' : '#dcfce7;color:#16a34a'}"><i class="fas ${b.isActive !== false ? 'fa-ban' : 'fa-check-circle'}"></i></button>
                            <button class="sales-action-btn adm-delete-biz" data-id="${b.id}" data-name="${this.escapeHtml(b.name || '')}" title="Delete" style="background:#fee2e2;color:#991b1b"><i class="fas fa-trash"></i></button>
                        </div>
                    </td>
                </tr>`;
            }).join('');

            tbody.querySelectorAll('.adm-edit-biz').forEach(btn => {
                btn.addEventListener('click', () => {
                    const biz = allBusinesses.find(b => b.id === btn.dataset.id);
                    if (biz) this.openFranchiseModal(biz);
                });
            });
            tbody.querySelectorAll('.adm-toggle-biz').forEach(btn => {
                btn.addEventListener('click', () => this.toggleFranchiseStatus(btn.dataset.id, btn.dataset.active === 'true'));
            });
            tbody.querySelectorAll('.adm-delete-biz').forEach(btn => {
                btn.addEventListener('click', () => this.deleteFranchise(btn.dataset.id, btn.dataset.name));
            });

            this.renderBizPagination();
        },

        toggleFranchiseStatus: async function (bizId, isCurrentlyActive) {
            const action = isCurrentlyActive ? 'deactivate' : 'activate';
            if (!(await PharmaFlow.confirm('Are you sure you want to ' + action + ' this franchise?', { title: action.charAt(0).toUpperCase() + action.slice(1) + ' Franchise', confirmText: 'Yes, ' + action.charAt(0).toUpperCase() + action.slice(1), danger: isCurrentlyActive }))) return;

            try {
                await window.db.collection('businesses').doc(bizId).update({
                    isActive: !isCurrentlyActive,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.showToast('Franchise ' + action + 'd!');
            } catch (err) {
                console.error('Toggle franchise error:', err);
                this.showToast('Failed to ' + action + ' franchise.', 'error');
            }
        },

        deleteFranchise: async function (bizId, bizName) {
            if (!(await PharmaFlow.confirm('Permanently delete franchise "' + (bizName || 'Unnamed') + '"? This cannot be undone. All users assigned to this franchise will lose access.', { title: 'Delete Franchise', confirmText: 'Yes, Delete', danger: true }))) return;

            try {
                // Unassign users from this franchise
                const usersSnap = await window.db.collection('users').where('businessId', '==', bizId).get();
                const batch = window.db.batch();
                usersSnap.docs.forEach(doc => {
                    batch.update(doc.ref, { businessId: '', status: 'disabled', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                });
                await batch.commit();

                // Delete the franchise document
                await window.db.collection('businesses').doc(bizId).delete();
                this.showToast('Franchise deleted and ' + usersSnap.size + ' user(s) unassigned.');

                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Franchise Deleted',
                        description: 'Franchise "' + (bizName || bizId) + '" deleted, ' + usersSnap.size + ' users unassigned',
                        category: 'Admin',
                        status: 'CRITICAL'
                    });
                }
            } catch (err) {
                console.error('Delete franchise error:', err);
                this.showToast('Failed to delete franchise: ' + err.message, 'error');
            }
        },

        renderBizPagination: function () {
            const container = document.getElementById('adm-biz-pagination');
            if (!container) return;
            const totalItems = filteredBusinesses.length;
            const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
            if (totalPages <= 1) { container.innerHTML = ''; return; }

            const start = (bizCurrentPage - 1) * PAGE_SIZE + 1;
            const end = Math.min(bizCurrentPage * PAGE_SIZE, totalItems);
            let pagesHtml = '';
            const maxV = 5;
            let sp = Math.max(1, bizCurrentPage - Math.floor(maxV / 2));
            let ep = Math.min(totalPages, sp + maxV - 1);
            if (ep - sp < maxV - 1) sp = Math.max(1, ep - maxV + 1);

            if (sp > 1) pagesHtml += '<button class="dda-page-btn" data-page="1">1</button>';
            if (sp > 2) pagesHtml += '<span class="dda-page-dots">...</span>';
            for (let p = sp; p <= ep; p++) {
                pagesHtml += '<button class="dda-page-btn' + (p === bizCurrentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
            }
            if (ep < totalPages - 1) pagesHtml += '<span class="dda-page-dots">...</span>';
            if (ep < totalPages) pagesHtml += '<button class="dda-page-btn" data-page="' + totalPages + '">' + totalPages + '</button>';

            container.innerHTML = '<span class="dda-page-info">Showing ' + start + '-' + end + ' of ' + totalItems + '</span><div class="dda-page-controls"><button class="dda-page-btn" data-page="' + (bizCurrentPage - 1) + '"' + (bizCurrentPage === 1 ? ' disabled' : '') + '><i class="fas fa-chevron-left"></i></button>' + pagesHtml + '<button class="dda-page-btn" data-page="' + (bizCurrentPage + 1) + '"' + (bizCurrentPage === totalPages ? ' disabled' : '') + '><i class="fas fa-chevron-right"></i></button></div>';

            container.querySelectorAll('.dda-page-btn[data-page]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const page = parseInt(btn.dataset.page);
                    if (page >= 1 && page <= totalPages) { bizCurrentPage = page; this.renderFranchisesTable(); }
                });
            });
        },

        // ═══════════════════════════════════════════════
        //  ADMIN ANALYTICS
        // ═══════════════════════════════════════════════

        renderAnalytics: function (container) {
            this.cleanup();

            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-chart-pie"></i> Admin Analytics</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>Admin Panel</span>
                                <span>/</span><span>Analytics</span>
                            </div>
                        </div>
                        <button class="dda-btn dda-btn--primary" id="anl-refresh-btn">
                            <i class="fas fa-arrows-rotate"></i> Refresh
                        </button>
                    </div>

                    <!-- Top-level Stats -->
                    <div class="dda-stats" id="anl-top-stats">
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon"><i class="fas fa-users"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="anl-total-users">0</span>
                                <span class="dda-stat-label">Total Users</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-store"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="anl-total-franchises">0</span>
                                <span class="dda-stat-label">Franchises</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-database"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="anl-total-docs">0</span>
                                <span class="dda-stat-label">Total Documents</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--danger"><i class="fas fa-fire"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="anl-active-listeners">0</span>
                                <span class="dda-stat-label">Active Listeners</span>
                            </div>
                        </div>
                    </div>

                    <!-- Per-Franchise Consumption Table -->
                    <div class="ord-card" style="margin-top:20px">
                        <div class="ord-card-header"><i class="fas fa-chart-bar"></i> Database Consumption by Franchise</div>
                        <div class="ord-card-body">
                            <div class="dda-table-wrap">
                                <table class="dda-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Franchise</th>
                                            <th>Users</th>
                                            <th>Sales</th>
                                            <th>Inventory</th>
                                            <th>Patients</th>
                                            <th>Expenses</th>
                                            <th>Orders</th>
                                            <th>Total Docs</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody id="anl-consumption-tbody">
                                        <tr><td colspan="10" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading analytics...</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <!-- Collections Breakdown -->
                    <div class="ord-card" style="margin-top:20px">
                        <div class="ord-card-header"><i class="fas fa-layer-group"></i> Global Collection Stats</div>
                        <div class="ord-card-body">
                            <div class="anl-collections-grid" id="anl-collections-grid">
                                <div class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading...</div>
                            </div>
                        </div>
                    </div>

                    <!-- User Activity Summary -->
                    <div class="ord-card" style="margin-top:20px">
                        <div class="ord-card-header"><i class="fas fa-users-rectangle"></i> User Distribution</div>
                        <div class="ord-card-body">
                            <div class="anl-user-dist" id="anl-user-dist">
                                <div class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading...</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });
            document.getElementById('anl-refresh-btn')?.addEventListener('click', () => this.loadAnalyticsData());
            this.loadAnalyticsData();
        },

        loadAnalyticsData: async function () {
            const tbody = document.getElementById('anl-consumption-tbody');
            const collectionsGrid = document.getElementById('anl-collections-grid');
            const userDist = document.getElementById('anl-user-dist');
            if (!tbody) return;

            try {
                // Load businesses
                const bizSnap = await window.db.collection('businesses').get();
                const businesses = bizSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                // Load users
                const usersSnap = await window.db.collection('users').get();
                const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

                let totalDocs = users.length + businesses.length;
                const collections = ['sales', 'inventory', 'patients', 'expenses', 'orders', 'prescriptions', 'wholesale_orders', 'activity_log', 'dda_register', 'medication_refills', 'patient_bills', 'suppliers'];
                const bizData = [];

                for (const biz of businesses) {
                    const row = { id: biz.id, name: biz.name || 'Unnamed', isActive: biz.isActive !== false, users: users.filter(u => u.businessId === biz.id).length, sales: 0, inventory: 0, patients: 0, expenses: 0, orders: 0, total: 0 };

                    const countPromises = collections.map(col =>
                        window.db.collection('businesses').doc(biz.id).collection(col).get()
                            .then(snap => ({ col, count: snap.size }))
                            .catch(() => ({ col, count: 0 }))
                    );

                    const counts = await Promise.all(countPromises);
                    let bizTotal = 0;
                    counts.forEach(c => {
                        bizTotal += c.count;
                        if (c.col === 'sales') row.sales = c.count;
                        else if (c.col === 'inventory') row.inventory = c.count;
                        else if (c.col === 'patients') row.patients = c.count;
                        else if (c.col === 'expenses') row.expenses = c.count;
                        else if (c.col === 'orders') row.orders = c.count;
                    });
                    row.total = bizTotal;
                    totalDocs += bizTotal;
                    bizData.push(row);
                }

                // Update top stats
                const el = id => document.getElementById(id);
                if (el('anl-total-users')) el('anl-total-users').textContent = users.length;
                if (el('anl-total-franchises')) el('anl-total-franchises').textContent = businesses.length;
                if (el('anl-total-docs')) el('anl-total-docs').textContent = totalDocs.toLocaleString();
                if (el('anl-active-listeners')) el('anl-active-listeners').textContent = businesses.length > 0 ? (businesses.length * 3 + 2) : 0;

                // Render consumption table
                if (bizData.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="10" class="dda-loading"><i class="fas fa-inbox"></i> No franchises found</td></tr>';
                } else {
                    tbody.innerHTML = bizData.map((r, i) => `<tr>
                        <td>${i + 1}</td>
                        <td><strong>${this.escapeHtml(r.name)}</strong></td>
                        <td>${r.users}</td>
                        <td>${r.sales.toLocaleString()}</td>
                        <td>${r.inventory.toLocaleString()}</td>
                        <td>${r.patients.toLocaleString()}</td>
                        <td>${r.expenses.toLocaleString()}</td>
                        <td>${r.orders.toLocaleString()}</td>
                        <td><strong>${r.total.toLocaleString()}</strong></td>
                        <td>${r.isActive ? '<span class="ord-status-badge ord-status--approved">Active</span>' : '<span class="ord-status-badge ord-status--cancelled">Inactive</span>'}</td>
                    </tr>`).join('');
                }

                // Global collections grid
                if (collectionsGrid) {
                    const globalCounts = {};
                    collections.forEach(c => { globalCounts[c] = 0; });
                    for (const biz of businesses) {
                        for (const col of collections) {
                            try {
                                const snap = await window.db.collection('businesses').doc(biz.id).collection(col).get();
                                globalCounts[col] += snap.size;
                            } catch (e) { /* skip */ }
                        }
                    }
                    const colIcons = { sales: 'fa-receipt', inventory: 'fa-boxes-stacked', patients: 'fa-hospital-user', expenses: 'fa-file-invoice-dollar', orders: 'fa-truck', prescriptions: 'fa-prescription', wholesale_orders: 'fa-cart-flatbed', activity_log: 'fa-list', dda_register: 'fa-shield-halved', medication_refills: 'fa-pills', patient_bills: 'fa-money-bill-wave', suppliers: 'fa-parachute-box' };

                    collectionsGrid.innerHTML = collections.map(col => {
                        const label = col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                        const icon = colIcons[col] || 'fa-database';
                        return `<div class="anl-col-card">
                            <div class="anl-col-icon"><i class="fas ${icon}"></i></div>
                            <div class="anl-col-info">
                                <span class="anl-col-value">${globalCounts[col].toLocaleString()}</span>
                                <span class="anl-col-label">${label}</span>
                            </div>
                        </div>`;
                    }).join('');
                }

                // User distribution
                if (userDist) {
                    const roleCounts = { superadmin: 0, admin: 0, staff: 0 };
                    const statusCounts = { active: 0, disabled: 0 };
                    users.forEach(u => {
                        roleCounts[u.role] = (roleCounts[u.role] || 0) + 1;
                        if (u.status === 'disabled') statusCounts.disabled++;
                        else statusCounts.active++;
                    });
                    userDist.innerHTML = `
                        <div class="anl-dist-grid">
                            <div class="anl-dist-section">
                                <h4><i class="fas fa-user-tag"></i> By Role</h4>
                                <div class="anl-dist-bars">
                                    ${Object.entries(roleCounts).map(([role, count]) => {
                                        const pct = users.length ? Math.round((count / users.length) * 100) : 0;
                                        const colors = { superadmin: '#f59e0b', admin: '#3b82f6', staff: '#10b981' };
                                        return `<div class="anl-dist-bar-row">
                                            <span class="anl-dist-label">${role.charAt(0).toUpperCase() + role.slice(1)}</span>
                                            <div class="anl-dist-bar"><div class="anl-dist-bar-fill" style="width:${pct}%;background:${colors[role] || '#6b7280'}"></div></div>
                                            <span class="anl-dist-count">${count} (${pct}%)</span>
                                        </div>`;
                                    }).join('')}
                                </div>
                            </div>
                            <div class="anl-dist-section">
                                <h4><i class="fas fa-toggle-on"></i> By Status</h4>
                                <div class="anl-dist-bars">
                                    <div class="anl-dist-bar-row">
                                        <span class="anl-dist-label">Active</span>
                                        <div class="anl-dist-bar"><div class="anl-dist-bar-fill" style="width:${users.length ? Math.round((statusCounts.active / users.length) * 100) : 0}%;background:#10b981"></div></div>
                                        <span class="anl-dist-count">${statusCounts.active}</span>
                                    </div>
                                    <div class="anl-dist-bar-row">
                                        <span class="anl-dist-label">Suspended</span>
                                        <div class="anl-dist-bar"><div class="anl-dist-bar-fill" style="width:${users.length ? Math.round((statusCounts.disabled / users.length) * 100) : 0}%;background:#ef4444"></div></div>
                                        <span class="anl-dist-count">${statusCounts.disabled}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }
            } catch (err) {
                console.error('Analytics error:', err);
                tbody.innerHTML = '<tr><td colspan="10" class="dda-loading" style="color:#ef4444"><i class="fas fa-exclamation-circle"></i> Failed to load analytics: ' + this.escapeHtml(err.message) + '</td></tr>';
            }
        },

        // ═══════════════════════════════════════════════
        //  FRANCHISE ALERTS & BILLING REMINDERS
        // ═══════════════════════════════════════════════

        renderFranchiseAlerts: function (container) {
            this.cleanup();

            container.innerHTML = `
                <div class="dda-module">
                    <div class="page-header">
                        <div>
                            <h2><i class="fas fa-bell-concierge"></i> Franchise Alerts</h2>
                            <div class="breadcrumb">
                                <a href="#" data-nav="dashboard">Home</a>
                                <span>/</span><span>Admin Panel</span>
                                <span>/</span><span>Franchise Alerts</span>
                            </div>
                        </div>
                        <button class="dda-btn dda-btn--primary" id="fal-send-alert-btn">
                            <i class="fas fa-paper-plane"></i> Send Alert
                        </button>
                    </div>

                    <!-- Stats -->
                    <div class="dda-stats">
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon"><i class="fas fa-envelope"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="fal-total-alerts">0</span>
                                <span class="dda-stat-label">Total Alerts</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--warn"><i class="fas fa-clock"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="fal-active-alerts">0</span>
                                <span class="dda-stat-label">Active Alerts</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--value"><i class="fas fa-robot"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="fal-auto-reminders">0</span>
                                <span class="dda-stat-label">Auto Reminders</span>
                            </div>
                        </div>
                        <div class="dda-stat-card">
                            <div class="dda-stat-icon dda-stat-icon--danger"><i class="fas fa-money-bill-wave"></i></div>
                            <div class="dda-stat-info">
                                <span class="dda-stat-value" id="fal-payment-due">0</span>
                                <span class="dda-stat-label">Payment Due</span>
                            </div>
                        </div>
                    </div>

                    <!-- Auto-Reminder Config Section -->
                    <div class="ord-card" style="margin-top:20px">
                        <div class="ord-card-header"><i class="fas fa-robot"></i> Automated Payment Reminders</div>
                        <div class="ord-card-body">
                            <div class="fal-auto-config">
                                <div class="fal-auto-row">
                                    <div class="fal-auto-toggle-wrap">
                                        <label class="fal-toggle">
                                            <input type="checkbox" id="fal-auto-enabled">
                                            <span class="fal-toggle-slider"></span>
                                        </label>
                                        <div>
                                            <strong>Enable Auto Reminders</strong>
                                            <p class="fal-auto-hint">Automatically sends scheduled reminders to all active franchises on the configured day each month (payments, downtime, security updates, etc.)</p>
                                        </div>
                                    </div>
                                    <div class="fal-auto-fields">
                                        <div class="dda-form-group">
                                            <label>Reminder Day of Month</label>
                                            <select id="fal-auto-day">
                                                ${Array.from({length: 28}, (_, i) => `<option value="${i + 1}">${i + 1}${['st','nd','rd'][i] || 'th'}</option>`).join('')}
                                            </select>
                                        </div>
                                        <div class="dda-form-group">
                                            <label>Reminder Type</label>
                                            <select id="fal-auto-type">
                                                <option value="payment_due">Payment Due</option>
                                                <option value="general">General Notice</option>
                                                <option value="warning">Warning</option>
                                                <option value="info">Information</option>
                                                <option value="downtime">Scheduled Downtime</option>
                                                <option value="security">Security Update</option>
                                                <option value="maintenance">Maintenance</option>
                                            </select>
                                        </div>
                                        <div class="dda-form-group">
                                            <label>Default Message</label>
                                            <input type="text" id="fal-auto-message" placeholder="e.g., Monthly payment due, Scheduled downtime, Security patch..." value="">
                                        </div>
                                        <div class="dda-form-group">
                                            <label>Amount (for payment reminders)</label>
                                            <input type="number" id="fal-auto-amount" placeholder="e.g., 5000" min="0">
                                        </div>
                                    </div>
                                </div>
                                <div class="fal-auto-actions">
                                    <button class="dda-btn dda-btn--primary" id="fal-save-auto"><i class="fas fa-save"></i> Save Auto-Reminder Settings</button>
                                    <button class="dda-btn dda-btn--cancel" id="fal-trigger-now"><i class="fas fa-bolt"></i> Send Reminder Now</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Alerts Table -->
                    <div class="ord-card" style="margin-top:20px">
                        <div class="ord-card-header"><i class="fas fa-list"></i> All Alerts</div>
                        <div class="ord-card-body">
                            <div class="dda-toolbar" style="margin-bottom:12px">
                                <div class="dda-search-box">
                                    <i class="fas fa-search"></i>
                                    <input type="text" id="fal-search" placeholder="Search alerts...">
                                </div>
                                <div class="dda-toolbar-actions">
                                    <select id="fal-status-filter">
                                        <option value="">All Statuses</option>
                                        <option value="active">Active</option>
                                        <option value="acknowledged">Acknowledged</option>
                                        <option value="dismissed">Dismissed</option>
                                        <option value="paid">Paid</option>
                                    </select>
                                </div>
                            </div>
                            <div class="dda-table-wrap">
                                <table class="dda-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Franchise</th>
                                            <th>Alert Type</th>
                                            <th>Message</th>
                                            <th>Amount</th>
                                            <th>Status</th>
                                            <th>Created</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody id="fal-alerts-tbody">
                                        <tr><td colspan="8" class="dda-loading"><i class="fas fa-spinner fa-spin"></i> Loading alerts...</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Send Alert Modal -->
                <div class="dda-modal-overlay" id="fal-alert-modal" style="display:none">
                    <div class="dda-modal" style="max-width:640px">
                        <div class="dda-modal-header">
                            <h3 id="fal-modal-title"><i class="fas fa-paper-plane"></i> Send Alert to Franchise</h3>
                            <button class="dda-modal-close" id="fal-modal-close">&times;</button>
                        </div>
                        <div class="dda-modal-body">
                            <div class="dda-form-group">
                                <label>Target Franchise <span class="required">*</span></label>
                                <select id="fal-target-biz">
                                    <option value="__all__">All Active Franchises</option>
                                </select>
                            </div>
                            <div class="dda-form-group">
                                <label>Alert Type <span class="required">*</span></label>
                                <select id="fal-alert-type">
                                    <option value="payment_due">Payment Due</option>
                                    <option value="general">General Notice</option>
                                    <option value="warning">Warning</option>
                                    <option value="info">Information</option>
                                    <option value="downtime">Scheduled Downtime</option>
                                    <option value="security">Security Update</option>
                                    <option value="maintenance">Maintenance</option>
                                </select>
                            </div>
                            <div class="dda-form-group">
                                <label>Message <span class="required">*</span></label>
                                <textarea id="fal-alert-message" rows="3" placeholder="Enter the alert message to display on their dashboard..."></textarea>
                            </div>
                            <div class="dda-form-row">
                                <div class="dda-form-group">
                                    <label>Amount (for payment alerts)</label>
                                    <input type="number" id="fal-alert-amount" placeholder="e.g., 5000" min="0">
                                </div>
                                <div class="dda-form-group">
                                    <label>Due Date</label>
                                    <input type="date" id="fal-alert-due-date">
                                </div>
                            </div>
                            <div class="dda-form-group">
                                <label class="checkbox-wrapper" style="display:flex;align-items:center;gap:8px;cursor:pointer">
                                    <input type="checkbox" id="fal-alert-show-pay" checked>
                                    <span>Show "Pay Now" button on dashboard</span>
                                </label>
                            </div>
                            <input type="hidden" id="fal-alert-edit-id">
                        </div>
                        <div class="dda-modal-footer">
                            <button class="dda-btn dda-btn--cancel" id="fal-modal-cancel">Cancel</button>
                            <button class="dda-btn dda-btn--primary" id="fal-modal-send"><i class="fas fa-paper-plane"></i> Send Alert</button>
                        </div>
                    </div>
                </div>
            `;

            this.bindAlertEvents(container);
            this.loadAutoReminderConfig();
            this.subscribeAlerts();
        },

        bindAlertEvents: function (container) {
            const dashLink = container.querySelector('[data-nav="dashboard"]');
            if (dashLink) dashLink.addEventListener('click', (e) => { e.preventDefault(); PharmaFlow.Sidebar.setActive('dashboard', null); });

            document.getElementById('fal-send-alert-btn')?.addEventListener('click', () => this.openAlertModal());
            document.getElementById('fal-modal-close')?.addEventListener('click', () => { document.getElementById('fal-alert-modal').style.display = 'none'; });
            document.getElementById('fal-modal-cancel')?.addEventListener('click', () => { document.getElementById('fal-alert-modal').style.display = 'none'; });
            document.getElementById('fal-modal-send')?.addEventListener('click', () => this.sendAlert());

            document.getElementById('fal-save-auto')?.addEventListener('click', () => this.saveAutoReminderConfig());
            document.getElementById('fal-trigger-now')?.addEventListener('click', () => this.triggerAutoRemindersNow());

            document.getElementById('fal-search')?.addEventListener('input', () => this.filterAlerts());
            document.getElementById('fal-status-filter')?.addEventListener('change', () => this.filterAlerts());
        },

        openAlertModal: async function (alert) {
            const isEdit = !!alert;
            document.getElementById('fal-modal-title').innerHTML = isEdit
                ? '<i class="fas fa-edit"></i> Edit Alert'
                : '<i class="fas fa-paper-plane"></i> Send Alert to Franchise';

            document.getElementById('fal-alert-edit-id').value = isEdit ? alert.id : '';
            document.getElementById('fal-alert-type').value = isEdit ? (alert.type || 'payment_due') : 'payment_due';
            document.getElementById('fal-alert-message').value = isEdit ? (alert.message || '') : '';
            document.getElementById('fal-alert-amount').value = isEdit ? (alert.amount || '') : '';
            document.getElementById('fal-alert-due-date').value = isEdit ? (alert.dueDate || '') : '';
            document.getElementById('fal-alert-show-pay').checked = isEdit ? (alert.showPayButton !== false) : true;

            // Load franchises into dropdown
            const select = document.getElementById('fal-target-biz');
            select.innerHTML = '<option value="__all__">All Active Franchises</option>';
            try {
                const snap = await window.db.collection('businesses').get();
                snap.docs.map(d => ({ id: d.id, ...d.data() }))
                    .filter(b => b.isActive !== false)
                    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                    .forEach(b => {
                        const opt = document.createElement('option');
                        opt.value = b.id;
                        opt.textContent = b.name || b.id;
                        select.appendChild(opt);
                    });
            } catch (e) { /* ok */ }

            if (isEdit && alert.businessId) select.value = alert.businessId;
            document.getElementById('fal-alert-modal').style.display = 'flex';
        },

        sendAlert: async function () {
            const targetBiz = document.getElementById('fal-target-biz')?.value;
            const type = document.getElementById('fal-alert-type')?.value;
            const message = document.getElementById('fal-alert-message')?.value?.trim();
            const amount = parseFloat(document.getElementById('fal-alert-amount')?.value) || 0;
            const dueDate = document.getElementById('fal-alert-due-date')?.value || '';
            const showPayButton = document.getElementById('fal-alert-show-pay')?.checked || false;
            const editId = document.getElementById('fal-alert-edit-id')?.value;

            if (!message) { this.showToast('Please enter a message.', 'error'); return; }

            const btn = document.getElementById('fal-modal-send');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...'; }

            try {
                if (editId) {
                    // Update existing alert
                    await window.db.collection('franchise_alerts').doc(editId).update({
                        type, message, amount, dueDate, showPayButton,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    this.showToast('Alert updated!');
                } else if (targetBiz === '__all__') {
                    // Send to all active franchises
                    const bizSnap = await window.db.collection('businesses').get();
                    const activeBiz = bizSnap.docs.filter(d => d.data().isActive !== false);
                    const batch = window.db.batch();
                    activeBiz.forEach(biz => {
                        const ref = window.db.collection('franchise_alerts').doc();
                        batch.set(ref, {
                            businessId: biz.id,
                            businessName: biz.data().name || biz.id,
                            type, message, amount, dueDate, showPayButton,
                            status: 'active',
                            source: 'manual',
                            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                            createdBy: PharmaFlow.Auth.userProfile ? (PharmaFlow.Auth.userProfile.displayName || PharmaFlow.Auth.userProfile.email) : 'System'
                        });
                    });
                    await batch.commit();
                    this.showToast('Alert sent to ' + activeBiz.length + ' franchise(s)!');
                } else {
                    // Send to single franchise
                    const bizDoc = await window.db.collection('businesses').doc(targetBiz).get();
                    await window.db.collection('franchise_alerts').add({
                        businessId: targetBiz,
                        businessName: bizDoc.exists ? (bizDoc.data().name || targetBiz) : targetBiz,
                        type, message, amount, dueDate, showPayButton,
                        status: 'active',
                        source: 'manual',
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdBy: PharmaFlow.Auth.userProfile ? (PharmaFlow.Auth.userProfile.displayName || PharmaFlow.Auth.userProfile.email) : 'System'
                    });
                    this.showToast('Alert sent!');
                }
                document.getElementById('fal-alert-modal').style.display = 'none';
            } catch (err) {
                console.error('Send alert error:', err);
                this.showToast('Failed: ' + err.message, 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Alert'; }
            }
        },

        subscribeAlerts: function () {
            if (alertsListener) alertsListener();

            alertsListener = window.db.collection('franchise_alerts')
                .onSnapshot(snap => {
                    this._allAlerts = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                        .sort((a, b) => {
                            const tA = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : 0;
                            const tB = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : 0;
                            return tB - tA;
                        });
                    this.updateAlertStats();
                    this.filterAlerts();
                }, err => {
                    console.error('Alerts subscribe error:', err);
                });
        },

        _allAlerts: [],

        updateAlertStats: function () {
            const el = id => document.getElementById(id);
            const alerts = this._allAlerts;
            if (el('fal-total-alerts')) el('fal-total-alerts').textContent = alerts.length;
            if (el('fal-active-alerts')) el('fal-active-alerts').textContent = alerts.filter(a => a.status === 'active').length;
            if (el('fal-auto-reminders')) el('fal-auto-reminders').textContent = alerts.filter(a => a.source === 'auto').length;
            if (el('fal-payment-due')) el('fal-payment-due').textContent = alerts.filter(a => a.type === 'payment_due' && a.status === 'active').length;
        },

        filterAlerts: function () {
            const query = (document.getElementById('fal-search')?.value || '').toLowerCase();
            const statusFilter = document.getElementById('fal-status-filter')?.value || '';

            const filtered = this._allAlerts.filter(a => {
                if (statusFilter && a.status !== statusFilter) return false;
                if (query) {
                    const hay = ((a.businessName || '') + ' ' + (a.message || '') + ' ' + (a.type || '')).toLowerCase();
                    return hay.includes(query);
                }
                return true;
            });

            this.renderAlertsTable(filtered);
        },

        renderAlertsTable: function (alerts) {
            const tbody = document.getElementById('fal-alerts-tbody');
            if (!tbody) return;

            if (alerts.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="dda-loading"><i class="fas fa-inbox"></i> No alerts found</td></tr>';
                return;
            }

            const typeLabels = { payment_due: 'Payment Due', general: 'General', warning: 'Warning', info: 'Information', downtime: 'Downtime', security: 'Security', maintenance: 'Maintenance' };
            const typeColors = { payment_due: '#dc2626', general: '#3b82f6', warning: '#f59e0b', info: '#6b7280', downtime: '#7c3aed', security: '#dc2626', maintenance: '#0891b2' };
            const statusBadges = {
                active: '<span class="ord-status-badge ord-status--pending">Active</span>',
                acknowledged: '<span class="ord-status-badge ord-status--approved" style="background:#dbeafe;color:#1e40af">Acknowledged</span>',
                dismissed: '<span class="ord-status-badge ord-status--cancelled">Dismissed</span>',
                paid: '<span class="ord-status-badge ord-status--approved">Paid</span>'
            };
            const getCurrency = () => PharmaFlow.Settings ? PharmaFlow.Settings.getCurrency() : 'KSH';

            tbody.innerHTML = alerts.map((a, i) => {
                const created = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate().toLocaleDateString() : new Date(a.createdAt).toLocaleDateString()) : '—';
                return `<tr>
                    <td>${i + 1}</td>
                    <td><strong>${this.escapeHtml(a.businessName || '—')}</strong></td>
                    <td><span style="color:${typeColors[a.type] || '#6b7280'};font-weight:600"><i class="fas ${a.type === 'payment_due' ? 'fa-money-bill' : a.type === 'warning' ? 'fa-exclamation-triangle' : a.type === 'downtime' ? 'fa-power-off' : a.type === 'security' ? 'fa-shield-halved' : a.type === 'maintenance' ? 'fa-wrench' : 'fa-info-circle'}"></i> ${typeLabels[a.type] || a.type}</span></td>
                    <td style="max-width:250px;white-space:normal">${this.escapeHtml(a.message || '—')}</td>
                    <td>${a.amount && a.type === 'payment_due' ? getCurrency() + ' ' + Number(a.amount).toLocaleString() : '—'}</td>
                    <td>${statusBadges[a.status] || '<span class="ord-status-badge">' + (a.status || 'unknown') + '</span>'}</td>
                    <td>${created}</td>
                    <td>
                        <div class="adm-actions-cell">
                            ${a.status === 'active' ? '<button class="sales-action-btn fal-dismiss-alert" data-id="' + a.id + '" title="Dismiss" style="background:#fef3c7;color:#92400e"><i class="fas fa-bell-slash"></i></button>' : ''}
                            ${a.status === 'active' && a.type === 'payment_due' ? '<button class="sales-action-btn fal-mark-paid" data-id="' + a.id + '" title="Mark Paid" style="background:#dcfce7;color:#16a34a"><i class="fas fa-check"></i></button>' : ''}
                            ${a.status === 'active' && a.type !== 'payment_due' ? '<button class="sales-action-btn fal-mark-ack" data-id="' + a.id + '" title="Mark Acknowledged" style="background:#dbeafe;color:#1e40af"><i class="fas fa-check-double"></i></button>' : ''}
                            <button class="sales-action-btn fal-delete-alert" data-id="${a.id}" title="Delete" style="background:#fee2e2;color:#991b1b"><i class="fas fa-trash"></i></button>
                        </div>
                    </td>
                </tr>`;
            }).join('');

            tbody.querySelectorAll('.fal-dismiss-alert').forEach(btn => {
                btn.addEventListener('click', () => this.updateAlertStatus(btn.dataset.id, 'dismissed'));
            });
            tbody.querySelectorAll('.fal-mark-paid').forEach(btn => {
                btn.addEventListener('click', () => this.updateAlertStatus(btn.dataset.id, 'paid'));
            });
            tbody.querySelectorAll('.fal-mark-ack').forEach(btn => {
                btn.addEventListener('click', () => this.updateAlertStatus(btn.dataset.id, 'acknowledged'));
            });
            tbody.querySelectorAll('.fal-delete-alert').forEach(btn => {
                btn.addEventListener('click', () => this.deleteAlert(btn.dataset.id));
            });
        },

        updateAlertStatus: async function (alertId, newStatus) {
            try {
                await window.db.collection('franchise_alerts').doc(alertId).update({
                    status: newStatus,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.showToast('Alert ' + newStatus + '!');
            } catch (err) {
                this.showToast('Failed: ' + err.message, 'error');
            }
        },

        deleteAlert: async function (alertId) {
            if (!(await PharmaFlow.confirm('Are you sure you want to delete this alert? This action cannot be undone.', { title: 'Delete Alert', confirmText: 'Delete', danger: true }))) return;
            try {
                await window.db.collection('franchise_alerts').doc(alertId).delete();
                this.showToast('Alert deleted.');
            } catch (err) {
                this.showToast('Failed: ' + err.message, 'error');
            }
        },

        // Auto-reminder config stored in a global doc
        loadAutoReminderConfig: async function () {
            try {
                const doc = await window.db.collection('system_config').doc('auto_reminders').get();
                if (doc.exists) {
                    const cfg = doc.data();
                    const enabledEl = document.getElementById('fal-auto-enabled');
                    const dayEl = document.getElementById('fal-auto-day');
                    const typeEl = document.getElementById('fal-auto-type');
                    const msgEl = document.getElementById('fal-auto-message');
                    const amtEl = document.getElementById('fal-auto-amount');
                    if (enabledEl) enabledEl.checked = cfg.enabled === true;
                    if (dayEl) dayEl.value = cfg.reminderDay || 5;
                    if (typeEl) typeEl.value = cfg.reminderType || 'payment_due';
                    if (msgEl && cfg.message) msgEl.value = cfg.message;
                    if (amtEl && cfg.amount) amtEl.value = cfg.amount;
                }
            } catch (err) {
                console.error('Load auto-reminder config error:', err);
            }
        },

        saveAutoReminderConfig: async function () {
            const enabled = document.getElementById('fal-auto-enabled')?.checked || false;
            const reminderDay = parseInt(document.getElementById('fal-auto-day')?.value) || 5;
            const reminderType = document.getElementById('fal-auto-type')?.value || 'payment_due';
            const message = document.getElementById('fal-auto-message')?.value?.trim() || 'Scheduled reminder from administration.';
            const amount = parseFloat(document.getElementById('fal-auto-amount')?.value) || 0;

            try {
                await window.db.collection('system_config').doc('auto_reminders').set({
                    enabled, reminderDay, reminderType, message, amount,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: PharmaFlow.Auth.userProfile ? (PharmaFlow.Auth.userProfile.displayName || PharmaFlow.Auth.userProfile.email) : 'System'
                }, { merge: true });
                this.showToast('Auto-reminder settings saved!');
            } catch (err) {
                console.error('Save auto-reminder error:', err);
                this.showToast('Failed: ' + err.message, 'error');
            }
        },

        triggerAutoRemindersNow: async function () {
            if (!(await PharmaFlow.confirm('Send this reminder to all active franchises right now?', { title: 'Send Reminders', confirmText: 'Send Now' }))) return;
            const reminderType = document.getElementById('fal-auto-type')?.value || 'payment_due';
            const message = document.getElementById('fal-auto-message')?.value?.trim() || 'Scheduled reminder from administration.';
            const amount = parseFloat(document.getElementById('fal-auto-amount')?.value) || 0;
            const isPayment = reminderType === 'payment_due';

            try {
                const bizSnap = await window.db.collection('businesses').get();
                const activeBiz = bizSnap.docs.filter(d => d.data().isActive !== false);
                const batch = window.db.batch();
                activeBiz.forEach(biz => {
                    const ref = window.db.collection('franchise_alerts').doc();
                    batch.set(ref, {
                        businessId: biz.id,
                        businessName: biz.data().name || biz.id,
                        type: reminderType,
                        message: message,
                        amount: isPayment ? amount : 0,
                        dueDate: '',
                        showPayButton: isPayment,
                        status: 'active',
                        source: 'auto',
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdBy: 'Auto Reminder'
                    });
                });
                await batch.commit();
                this.showToast('Reminders sent to ' + activeBiz.length + ' franchise(s)!');
            } catch (err) {
                this.showToast('Failed: ' + err.message, 'error');
            }
        },

        // Called on app init to check if auto reminders should fire today
        checkAutoReminders: async function () {
            try {
                const doc = await window.db.collection('system_config').doc('auto_reminders').get();
                if (!doc.exists || !doc.data().enabled) return;

                const cfg = doc.data();
                const today = new Date();
                const dayOfMonth = today.getDate();

                if (dayOfMonth !== (cfg.reminderDay || 5)) return;

                // Check if today's reminder was already sent
                const todayStr = today.toISOString().split('T')[0];
                if (cfg.lastAutoSent === todayStr) return;

                // Send reminders
                const rType = cfg.reminderType || 'payment_due';
                const isPayment = rType === 'payment_due';
                const bizSnap = await window.db.collection('businesses').get();
                const activeBiz = bizSnap.docs.filter(d => d.data().isActive !== false);
                const batch = window.db.batch();
                activeBiz.forEach(biz => {
                    const ref = window.db.collection('franchise_alerts').doc();
                    batch.set(ref, {
                        businessId: biz.id,
                        businessName: biz.data().name || biz.id,
                        type: rType,
                        message: cfg.message || 'Scheduled reminder from administration.',
                        amount: isPayment ? (cfg.amount || 0) : 0,
                        dueDate: '',
                        showPayButton: isPayment,
                        status: 'active',
                        source: 'auto',
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdBy: 'Auto Reminder'
                    });
                });
                await batch.commit();

                // Mark as sent today
                await window.db.collection('system_config').doc('auto_reminders').update({
                    lastAutoSent: todayStr
                });

                console.log('Auto-reminders sent to', activeBiz.length, 'franchises');
            } catch (err) {
                console.error('Auto-reminder check error:', err);
            }
        },

        // ═══════════════════════════════════════════════
        //  PERMISSION CHECK UTILITY (used by sidebar)
        // ═══════════════════════════════════════════════

        /**
         * Check if the current user has permission to access a module or sub-module.
         * @param {string} moduleId - The module ID
         * @param {string} [subModuleId] - Optional sub-module ID
         * @returns {boolean}
         */
        hasPermission: function (moduleId, subModuleId) {
            const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
            if (!profile) return false;

            // Superadmins always have full access
            if (profile.role === 'superadmin') return true;

            // If no permissions array or empty = full access (backward compatible)
            if (!profile.permissions || profile.permissions.length === 0) return true;

            // Check module permission
            const hasModule = profile.permissions.includes(moduleId);

            if (subModuleId) {
                // Check specific sub-module permission
                return profile.permissions.includes(moduleId + ':' + subModuleId);
            }

            // Check if user has the module itself OR any of its sub-modules
            if (hasModule) return true;
            return profile.permissions.some(p => p.startsWith(moduleId + ':'));
        }
    };

    window.PharmaFlow.AdminPanel = AdminPanel;
})();
