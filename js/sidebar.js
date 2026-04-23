/**
 * PharmaFlow - Sidebar Module
 * Renders the sidebar navigation with modules, sub-modules, and role-based visibility.
 * Sub-modules are designed to render as tabs in the content area (handled by router.js).
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    /**
     * Sidebar navigation configuration.
     * Each item defines:
     *   - id: unique identifier used for routing
     *   - label: display text
     *   - icon: Font Awesome icon class
     *   - roles: array of roles that can see this item (empty = all roles)
     *   - children: sub-modules (rendered as tabs in content area)
     *   - section: optional section title above the item
     */
    const NAV_CONFIG = [
        {
            id: 'dashboard',
            label: 'Dashboard',
            icon: 'fas fa-th-large',
            roles: [],
            section: 'Main',
            children: []
        },
        {
            id: 'pharmacy',
            label: 'Pharmacy',
            icon: 'fas fa-clinic-medical',
            roles: [],
            children: [
                { id: 'pos', label: 'POS', icon: 'fas fa-cash-register' },
                { id: 'todays-sales', label: "Today's Sales", icon: 'fas fa-chart-line' },
                { id: 'all-sales', label: 'All Sales', icon: 'fas fa-receipt' },
                { id: 'customers', label: 'Customers', icon: 'fas fa-users' },
                { id: 'prescription', label: 'Prescription', icon: 'fas fa-prescription' }
            ]
        },
        {
            id: 'inventory',
            label: 'Inventory',
            icon: 'fas fa-boxes-stacked',
            roles: [],
            section: 'Stock Management',
            children: [
                { id: 'view-inventory', label: 'View Inventory', icon: 'fas fa-warehouse' },
                { id: 'add-inventory', label: 'Add Inventory', icon: 'fas fa-plus-circle' }
            ]
        },
        {
            id: 'dda-register',
            label: 'DDA Register',
            icon: 'fas fa-book-medical',
            roles: [],
            children: [
                { id: 'view-register', label: 'View Register', icon: 'fas fa-list-alt' },
                { id: 'dda-sales', label: 'DDA Sales', icon: 'fas fa-file-invoice-dollar' },
                { id: 'dda-prescriptions', label: 'Prescriptions', icon: 'fas fa-file-prescription' }
            ]
        },
        {
            id: 'medication-refill',
            label: 'Medication Refill',
            icon: 'fas fa-pills',
            roles: [],
            children: [
                { id: 'refill-overview', label: 'Overview', icon: 'fas fa-chart-pie' },
                { id: 'add-refill', label: 'Add Refill', icon: 'fas fa-plus-circle' },
                { id: 'manage-refills', label: 'Manage Refills', icon: 'fas fa-tasks' },
                { id: 'refill-reminders', label: 'Reminders', icon: 'fas fa-bell' }
            ]
        },
        {
            id: 'my-orders',
            label: 'My Orders',
            icon: 'fas fa-clipboard-list',
            roles: [],
            children: [
                { id: 'create-order', label: 'Create Order', icon: 'fas fa-plus' },
                { id: 'manage-orders', label: 'Manage Orders', icon: 'fas fa-tasks' },
                { id: 'order-history', label: 'Order History', icon: 'fas fa-history' },
                { id: 'stock-history', label: 'Stock History', icon: 'fas fa-layer-group' }
            ]
        },
        {
            id: 'supplier',
            label: 'Supplier',
            icon: 'fas fa-truck-field',
            roles: [],
            section: 'Procurement',
            children: []
        },
        {
            id: 'wholesale',
            label: 'Wholesale',
            icon: 'fas fa-store',
            roles: [],
            children: [
                { id: 'create-wholesale', label: 'Create Wholesale', icon: 'fas fa-plus' },
                { id: 'manage-wholesale', label: 'Manage Wholesale', icon: 'fas fa-list' },
                { id: 'client-leads', label: 'Client Leads', icon: 'fas fa-users-gear' },
                { id: 'riders', label: 'Riders', icon: 'fas fa-motorcycle' }
            ]
        },
        {
            id: 'patients',
            label: 'Patients',
            icon: 'fas fa-hospital-user',
            roles: [],
            section: 'People',
            children: [
                { id: 'add-patient', label: 'Add Patient', icon: 'fas fa-user-plus' },
                { id: 'manage-patients', label: 'Manage Patients', icon: 'fas fa-users' },
                { id: 'patient-billing', label: 'Patient Billing', icon: 'fas fa-file-invoice' },
                { id: 'manage-billing', label: 'Manage Billing', icon: 'fas fa-file-invoice-dollar' }
            ]
        },
        {
            id: 'expenses',
            label: 'Expenses',
            icon: 'fas fa-money-bill-wave',
            roles: [],
            section: 'Finance',
            children: [
                { id: 'add-expense', label: 'Add Expense', icon: 'fas fa-plus' },
                { id: 'manage-expenses', label: 'Manage Expenses', icon: 'fas fa-list' }
            ]
        },
        {
            id: 'reports',
            label: 'Reports',
            icon: 'fas fa-chart-bar',
            roles: [],
            children: [
                { id: 'reports-overview', label: 'Overview', icon: 'fas fa-chart-pie' },
                { id: 'sales-reports', label: 'Sales Reports', icon: 'fas fa-cash-register' },
                { id: 'inventory-reports', label: 'Inventory Reports', icon: 'fas fa-boxes-stacked' },
                { id: 'financial-reports', label: 'Financial Reports', icon: 'fas fa-file-invoice-dollar' },
                { id: 'generate-report', label: 'Generate Report', icon: 'fas fa-file-export' }
            ]
        },
        {
            id: 'accounts',
            label: 'Accounts',
            icon: 'fas fa-calculator',
            roles: [],
            children: [
                { id: 'accounts-overview', label: 'Overview', icon: 'fas fa-tachometer-alt' },
                { id: 'income-tracking', label: 'Income', icon: 'fas fa-arrow-up' },
                { id: 'expense-tracking', label: 'Expenses', icon: 'fas fa-arrow-down' },
                { id: 'reconciliation', label: 'Reconciliation', icon: 'fas fa-balance-scale' },
                { id: 'profit-loss', label: 'Profit & Loss', icon: 'fas fa-chart-line' }
            ]
        },
        {
            id: 'activity-log',
            label: 'Activity Log',
            icon: 'fas fa-clock-rotate-left',
            roles: ['superadmin', 'admin'],
            section: 'Administration',
            children: [
                { id: 'all-activities', label: 'All Activities', icon: 'fas fa-list' },
                { id: 'user-activities', label: 'User Activities', icon: 'fas fa-user-clock' },
                { id: 'system-alerts', label: 'System Alerts', icon: 'fas fa-exclamation-triangle' }
            ]
        },
        {
            id: 'admin-panel',
            label: 'Admin Panel',
            icon: 'fas fa-shield-halved',
            roles: ['superadmin'],
            children: [
                { id: 'admin-dashboard', label: 'Admin Dashboard', icon: 'fas fa-tachometer-alt', roles: ['superadmin'] },
                { id: 'manage-users', label: 'Manage Users', icon: 'fas fa-users-cog', roles: ['superadmin'] },
                { id: 'manage-franchises', label: 'Manage Franchises', icon: 'fas fa-building', roles: ['superadmin'] },
                { id: 'admin-analytics', label: 'Analytics', icon: 'fas fa-chart-pie', roles: ['superadmin'] },
                { id: 'franchise-alerts', label: 'Franchise Alerts', icon: 'fas fa-bell-concierge', roles: ['superadmin'] },
                { id: 'pricing-page', label: 'Pricing Page', icon: 'fas fa-tags', roles: ['superadmin'] }
            ]
        }
    ];

    // Settings is always at the bottom (rendered in sidebar-footer)
    const SETTINGS_NAV = {
        id: 'settings',
        label: 'Settings',
        icon: 'fas fa-gear',
        roles: [],
        children: [
            { id: 'my-profile', label: 'My Profile', icon: 'fas fa-user-circle' },
            { id: 'business-profile', label: 'Business Profile', icon: 'fas fa-building', roles: ['superadmin', 'admin'] },
            { id: 'receipts-invoices', label: 'Receipts & Invoices', icon: 'fas fa-file-invoice', roles: ['superadmin', 'admin'] },
            { id: 'notifications-settings', label: 'Notifications', icon: 'fas fa-bell' },
            { id: 'system-settings', label: 'System', icon: 'fas fa-sliders-h', roles: ['superadmin', 'admin'] }
        ]
    };

    const Sidebar = {
        activeModuleId: null,
        activeSubModuleId: null,
        expandedModules: new Set(),
        isCollapsed: false,
        _currentRole: null,

        /**
         * Initialize sidebar
         */
        init: function () {
            this.render();
            this.renderSettings();
            this.bindToggle();

            window.addEventListener('beforeunload', () => {
                this.saveState();
            });
        },

        /**
         * Render sidebar navigation items
         */
        render: function (userRole) {
            const nav = document.getElementById('sidebar-nav');
            if (!nav) return;

            nav.innerHTML = '';

            NAV_CONFIG.forEach(item => {
                // Role-based visibility: hide role-restricted items if no role yet or role doesn't match
                if (item.roles && item.roles.length > 0) {
                    if (!userRole || !item.roles.includes(userRole)) return;
                }

                // Permission-based visibility (uses AdminPanel.hasPermission if available)
                if (PharmaFlow.AdminPanel && PharmaFlow.AdminPanel.hasPermission && userRole) {
                    if (!PharmaFlow.AdminPanel.hasPermission(item.id)) return;
                }

                // Filter children by role and permission
                let visibleChildren = (item.children || []).filter(child => {
                    // Child-level role restriction: hide if no role yet or role doesn't match
                    if (child.roles && child.roles.length > 0) {
                        if (!userRole || !child.roles.includes(userRole)) return false;
                    }
                    // Child-level permission restriction
                    if (PharmaFlow.AdminPanel && PharmaFlow.AdminPanel.hasPermission && userRole) {
                        if (!PharmaFlow.AdminPanel.hasPermission(item.id, child.id)) return false;
                    }
                    return true;
                });

                // Section title
                if (item.section) {
                    const sectionEl = document.createElement('div');
                    sectionEl.className = 'nav-section-title';
                    sectionEl.textContent = item.section;
                    nav.appendChild(sectionEl);
                }

                const hasChildren = visibleChildren.length > 0;

                // Nav item
                const navItem = document.createElement('div');
                navItem.className = 'nav-item' + (this.activeModuleId === item.id ? ' active' : '');
                navItem.dataset.moduleId = item.id;
                navItem.innerHTML = `
                    <i class="${item.icon}"></i>
                    <span class="nav-item-text">${item.label}</span>
                    ${hasChildren ? '<i class="fas fa-chevron-right nav-item-arrow' + (this.expandedModules.has(item.id) ? ' rotated' : '') + '"></i>' : ''}
                `;

                navItem.addEventListener('click', () => {
                    if (hasChildren) {
                        this.toggleExpand(item.id);
                        // Navigate to first visible child
                        this.setActive(item.id, visibleChildren[0].id);
                    } else {
                        this.setActive(item.id, null);
                    }
                });

                nav.appendChild(navItem);

                // Sub-nav (for visual hierarchy in sidebar, but tabs render in content area)
                if (hasChildren) {
                    const subNav = document.createElement('div');
                    subNav.className = 'sub-nav' + (this.expandedModules.has(item.id) ? ' open' : '');
                    subNav.dataset.parentId = item.id;

                    visibleChildren.forEach(child => {
                        const subItem = document.createElement('div');
                        subItem.className = 'nav-item' + (this.activeSubModuleId === child.id ? ' active' : '');
                        subItem.dataset.moduleId = item.id;
                        subItem.dataset.subModuleId = child.id;
                        subItem.innerHTML = `
                            <i class="${child.icon}"></i>
                            <span class="nav-item-text">${child.label}</span>
                        `;

                        subItem.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.setActive(item.id, child.id);
                        });

                        subNav.appendChild(subItem);
                    });

                    nav.appendChild(subNav);
                }
            });
        },

        /**
         * Render settings item in the footer
         */
        renderSettings: function () {
            const footerNav = document.getElementById('sidebar-nav-footer');
            if (!footerNav) return;

            footerNav.innerHTML = '';

            const navItem = document.createElement('div');
            navItem.className = 'nav-item' + (this.activeModuleId === SETTINGS_NAV.id ? ' active' : '');
            navItem.dataset.moduleId = SETTINGS_NAV.id;
            navItem.innerHTML = `
                <i class="${SETTINGS_NAV.icon}"></i>
                <span class="nav-item-text">${SETTINGS_NAV.label}</span>
            `;

            navItem.addEventListener('click', () => {
                this.setActive(SETTINGS_NAV.id, null);
            });

            footerNav.appendChild(navItem);
        },

        /**
         * Toggle expand/collapse of a module with children
         */
        toggleExpand: function (moduleId) {
            if (this.expandedModules.has(moduleId)) {
                this.expandedModules.delete(moduleId);
            } else {
                this.expandedModules.add(moduleId);
            }

            // Toggle arrow rotation
            const arrow = document.querySelector(`.nav-item[data-module-id="${moduleId}"] .nav-item-arrow`);
            if (arrow) {
                arrow.classList.toggle('rotated', this.expandedModules.has(moduleId));
            }

            // Toggle sub-nav visibility
            const subNav = document.querySelector(`.sub-nav[data-parent-id="${moduleId}"]`);
            if (subNav) {
                subNav.classList.toggle('open', this.expandedModules.has(moduleId));
            }
        },

        /**
         * Set active module/sub-module
         */
        setActive: function (moduleId, subModuleId) {
            this.activeModuleId = moduleId;
            this.activeSubModuleId = subModuleId;

            // Expand parent if navigating to a child
            if (subModuleId) {
                this.expandedModules.add(moduleId);
            }

            // Update sidebar visual state
            this.updateActiveState();

            // Save state
            this.saveState();

            // Notify router
            window.dispatchEvent(new CustomEvent('navigate', {
                detail: {
                    moduleId: moduleId,
                    subModuleId: subModuleId
                }
            }));
        },

        /**
         * Update visual active state on nav items
         */
        updateActiveState: function () {
            // Remove all active states
            document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
                el.classList.remove('active');
            });

            // Set active on current module
            const moduleItem = document.querySelector(`.nav-item[data-module-id="${this.activeModuleId}"]:not([data-sub-module-id])`);
            if (moduleItem) {
                moduleItem.classList.add('active');
            }

            // Set active on current sub-module
            if (this.activeSubModuleId) {
                const subItem = document.querySelector(`.nav-item[data-sub-module-id="${this.activeSubModuleId}"]`);
                if (subItem) {
                    subItem.classList.add('active');
                }
            }

            // Update expanded sub-navs
            document.querySelectorAll('.sub-nav').forEach(subNav => {
                const parentId = subNav.dataset.parentId;
                subNav.classList.toggle('open', this.expandedModules.has(parentId));
            });

            // Update arrows
            document.querySelectorAll('.nav-item-arrow').forEach(arrow => {
                const parentItem = arrow.closest('.nav-item');
                if (parentItem) {
                    arrow.classList.toggle('rotated', this.expandedModules.has(parentItem.dataset.moduleId));
                }
            });
        },

        /**
         * Bind sidebar toggle (collapse/expand)
         */
        bindToggle: function () {
            const toggleBtn = document.getElementById('sidebar-toggle');
            if (!toggleBtn) return;

            toggleBtn.addEventListener('click', () => {
                this.isCollapsed = !this.isCollapsed;
                const sidebar = document.getElementById('sidebar');
                if (sidebar) {
                    sidebar.classList.toggle('collapsed', this.isCollapsed);
                }

                // On mobile, toggle mobile-open
                if (window.innerWidth <= 768) {
                    sidebar.classList.toggle('mobile-open');
                    document.getElementById('overlay').classList.toggle('show');
                }

                localStorage.setItem('pf_sidebar_collapsed', this.isCollapsed);
            });
        },

        /**
         * Get navigation config for a module (used by router for tabs)
         */
        getModuleConfig: function (moduleId) {
            const item = NAV_CONFIG.find(i => i.id === moduleId);
            if (item) return item;
            if (moduleId === SETTINGS_NAV.id) return SETTINGS_NAV;
            return null;
        },

        /**
         * Get all nav config
         */
        getNavConfig: function () {
            return NAV_CONFIG;
        },

        /**
         * Save sidebar state to localStorage
         */
        saveState: function () {
            const state = {
                activeModuleId: this.activeModuleId,
                activeSubModuleId: this.activeSubModuleId,
                expandedModules: Array.from(this.expandedModules)
            };
            localStorage.setItem('pf_sidebar_state', JSON.stringify(state));
        },

        /**
         * Restore sidebar state from localStorage
         */
        restoreState: function () {
            // Restore collapsed state
            const collapsed = localStorage.getItem('pf_sidebar_collapsed');
            if (collapsed === 'true' && window.innerWidth > 768) {
                this.isCollapsed = true;
                const sidebar = document.getElementById('sidebar');
                if (sidebar) sidebar.classList.add('collapsed');
            }

            // Restore navigation state
            const stateStr = localStorage.getItem('pf_sidebar_state');
            if (stateStr) {
                try {
                    const state = JSON.parse(stateStr);
                    this.activeModuleId = state.activeModuleId;
                    this.activeSubModuleId = state.activeSubModuleId;
                    this.expandedModules = new Set(state.expandedModules || []);
                    this.updateActiveState();

                    // Trigger navigation to restore last page
                    if (this.activeModuleId) {
                        window.dispatchEvent(new CustomEvent('navigate', {
                            detail: {
                                moduleId: this.activeModuleId,
                                subModuleId: this.activeSubModuleId
                            }
                        }));
                    }
                } catch (e) {
                    // Invalid state — default to dashboard
                    this.setActive('dashboard', null);
                }
            } else {
                // No saved state — default to dashboard
                this.setActive('dashboard', null);
            }
        },

        /**
         * Re-render sidebar based on user role (called after auth ready)
         */
        updateForRole: function (role) {
            this._currentRole = role;

            this.render(role);
            this.renderSettings();
            this.restoreState();
            this.updateActiveState();
        }
    };

    window.PharmaFlow.Sidebar = Sidebar;
    window.PharmaFlow.NAV_CONFIG = NAV_CONFIG;
    window.PharmaFlow.SETTINGS_NAV = SETTINGS_NAV;
})();
