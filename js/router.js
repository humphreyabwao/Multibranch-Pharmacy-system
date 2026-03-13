/**
 * PharmaFlow - Router Module
 * Handles navigation between modules and sub-modules.
 * Renders content tabs for modules with sub-modules.
 * Each module/sub-module page is left blank (placeholder).
 */

(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    const Router = {
        currentModuleId: null,
        currentSubModuleId: null,

        /**
         * Initialize router — listen for navigation events
         */
        init: function () {
            window.addEventListener('navigate', (e) => {
                const { moduleId, subModuleId } = e.detail;
                this.navigateTo(moduleId, subModuleId);
            });
        },

        /**
         * Cleanup a module's listeners/state
         */
        _cleanupModule: function (modId) {
            if (!modId) return;
            switch (modId) {
                case 'dashboard': if (PharmaFlow.Dashboard) PharmaFlow.Dashboard.cleanup(); break;
                case 'inventory': if (PharmaFlow.Inventory) PharmaFlow.Inventory.cleanup(); break;
                case 'pharmacy':
                    if (PharmaFlow.POS) PharmaFlow.POS.cleanup();
                    if (PharmaFlow.TodaysSales) PharmaFlow.TodaysSales.cleanup();
                    if (PharmaFlow.AllSales) PharmaFlow.AllSales.cleanup();
                    break;
                case 'dda-register': if (PharmaFlow.DdaRegister) PharmaFlow.DdaRegister.cleanup(); break;
                case 'supplier': if (PharmaFlow.Supplier) PharmaFlow.Supplier.cleanup(); break;
                case 'my-orders': if (PharmaFlow.MyOrders) PharmaFlow.MyOrders.cleanup(); break;
                case 'expenses': if (PharmaFlow.Expense) PharmaFlow.Expense.cleanup(); break;
                case 'admin-panel': if (PharmaFlow.AdminPanel) PharmaFlow.AdminPanel.cleanup(); break;
                case 'wholesale': if (PharmaFlow.Wholesale) PharmaFlow.Wholesale.cleanup(); break;
                case 'patients': if (PharmaFlow.Patients) PharmaFlow.Patients.cleanup(); break;
                case 'reports': if (PharmaFlow.Reports) PharmaFlow.Reports.cleanup(); break;
                case 'accounts': if (PharmaFlow.Accounts) PharmaFlow.Accounts.cleanup(); break;
                case 'activity-log': if (PharmaFlow.ActivityLog) PharmaFlow.ActivityLog.cleanup(); break;
                case 'medication-refill': if (PharmaFlow.MedicationRefill) PharmaFlow.MedicationRefill.cleanup(); break;
                case 'settings': if (PharmaFlow.Settings) PharmaFlow.Settings.cleanup(); break;
            }
        },

        /**
         * Navigate to a module/sub-module
         */
        navigateTo: function (moduleId, subModuleId) {
            // Cleanup previous module listeners (always cleanup, even on same-module re-render for franchise switching)
            this._cleanupModule(this.currentModuleId);

            this.currentModuleId = moduleId;
            this.currentSubModuleId = subModuleId;

            const moduleConfig = PharmaFlow.Sidebar.getModuleConfig(moduleId);
            if (!moduleConfig) return;

            const hasChildren = moduleConfig.children && moduleConfig.children.length > 0;

            // Render tabs if module has sub-modules
            this.renderTabs(moduleConfig, subModuleId);

            // Render page content
            if (hasChildren && subModuleId) {
                const child = moduleConfig.children.find(c => c.id === subModuleId);
                this.renderPage(moduleConfig, child);
            } else if (hasChildren) {
                // Default to first child
                const firstChild = moduleConfig.children[0];
                this.currentSubModuleId = firstChild.id;
                this.renderTabs(moduleConfig, firstChild.id);
                this.renderPage(moduleConfig, firstChild);
            } else {
                this.renderPage(moduleConfig, null);
            }
        },

        /**
         * Render content tabs for a module with sub-modules
         */
        renderTabs: function (moduleConfig, activeSubId) {
            const tabsContainer = document.getElementById('content-tabs');
            if (!tabsContainer) return;

            const hasChildren = moduleConfig.children && moduleConfig.children.length > 0;

            if (!hasChildren) {
                tabsContainer.style.display = 'none';
                tabsContainer.innerHTML = '';
                return;
            }

            // Filter children by role and permission
            const userRole = PharmaFlow.Auth && PharmaFlow.Auth.userProfile ? PharmaFlow.Auth.userProfile.role : null;
            const visibleChildren = moduleConfig.children.filter(child => {
                if (child.roles && child.roles.length > 0 && userRole) {
                    if (!child.roles.includes(userRole)) return false;
                }
                if (PharmaFlow.AdminPanel && PharmaFlow.AdminPanel.hasPermission) {
                    if (!PharmaFlow.AdminPanel.hasPermission(moduleConfig.id, child.id)) return false;
                }
                return true;
            });

            if (visibleChildren.length === 0) {
                tabsContainer.style.display = 'none';
                tabsContainer.innerHTML = '';
                return;
            }

            tabsContainer.style.display = 'flex';
            tabsContainer.innerHTML = '';

            visibleChildren.forEach(child => {
                const tab = document.createElement('div');
                tab.className = 'content-tab' + (child.id === activeSubId ? ' active' : '');
                tab.dataset.subModuleId = child.id;
                tab.innerHTML = `<i class="${child.icon}"></i><span>${child.label}</span>`;

                tab.addEventListener('click', () => {
                    this.currentSubModuleId = child.id;

                    // Update sidebar active state
                    PharmaFlow.Sidebar.activeSubModuleId = child.id;
                    PharmaFlow.Sidebar.updateActiveState();
                    PharmaFlow.Sidebar.saveState();

                    // Update tabs
                    tabsContainer.querySelectorAll('.content-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');

                    // Render page
                    this.renderPage(moduleConfig, child);
                });

                tabsContainer.appendChild(tab);
            });
        },

        /**
         * Render page content
         */
        renderPage: function (moduleConfig, subModule) {
            const contentBody = document.getElementById('content-body');
            if (!contentBody) return;

            // Dashboard has its own renderer
            if (moduleConfig.id === 'dashboard' && PharmaFlow.Dashboard) {
                PharmaFlow.Dashboard.render(contentBody);
                return;
            }

            // Inventory module
            if (moduleConfig.id === 'inventory' && PharmaFlow.Inventory) {
                const subId = subModule ? subModule.id : 'view-inventory';
                if (subId === 'add-inventory') {
                    PharmaFlow.Inventory.renderAdd(contentBody);
                } else {
                    PharmaFlow.Inventory.renderView(contentBody);
                }
                return;
            }

            // Pharmacy module (POS, Today's Sales, All Sales)
            if (moduleConfig.id === 'pharmacy') {
                const subId = subModule ? subModule.id : 'pos';
                // Cleanup previous pharmacy sub-module
                if (PharmaFlow.POS) PharmaFlow.POS.cleanup();
                if (PharmaFlow.TodaysSales) PharmaFlow.TodaysSales.cleanup();
                if (PharmaFlow.AllSales) PharmaFlow.AllSales.cleanup();
                if (PharmaFlow.Prescription) PharmaFlow.Prescription.cleanup();

                if (subId === 'pos' && PharmaFlow.POS) {
                    PharmaFlow.POS.render(contentBody);
                    return;
                }
                if (subId === 'todays-sales' && PharmaFlow.TodaysSales) {
                    PharmaFlow.TodaysSales.render(contentBody);
                    return;
                }
                if (subId === 'all-sales' && PharmaFlow.AllSales) {
                    PharmaFlow.AllSales.render(contentBody);
                    return;
                }
                if (subId === 'prescription' && PharmaFlow.Prescription) {
                    PharmaFlow.Prescription.render(contentBody);
                    return;
                }
            }

            // DDA Register module
            if (moduleConfig.id === 'dda-register' && PharmaFlow.DdaRegister) {
                const subId = subModule ? subModule.id : 'view-register';
                PharmaFlow.DdaRegister.cleanup();

                if (subId === 'view-register') {
                    PharmaFlow.DdaRegister.renderView(contentBody);
                    return;
                }
                if (subId === 'dda-sales') {
                    PharmaFlow.DdaRegister.renderSales(contentBody);
                    return;
                }
                if (subId === 'dda-prescriptions') {
                    PharmaFlow.DdaRegister.renderPrescriptions(contentBody);
                    return;
                }
            }

            // Supplier module
            if (moduleConfig.id === 'supplier' && PharmaFlow.Supplier) {
                PharmaFlow.Supplier.render(contentBody);
                return;
            }

            // My Orders module
            if (moduleConfig.id === 'my-orders' && PharmaFlow.MyOrders) {
                const subId = subModule ? subModule.id : 'create-order';
                PharmaFlow.MyOrders.cleanup();

                if (subId === 'create-order') {
                    PharmaFlow.MyOrders.renderCreate(contentBody);
                    return;
                }
                if (subId === 'manage-orders') {
                    PharmaFlow.MyOrders.renderManage(contentBody);
                    return;
                }
                if (subId === 'order-history') {
                    PharmaFlow.MyOrders.renderOrderHistory(contentBody);
                    return;
                }
                if (subId === 'stock-history') {
                    PharmaFlow.MyOrders.renderStockHistory(contentBody);
                    return;
                }
            }

            // Expenses module
            if (moduleConfig.id === 'expenses' && PharmaFlow.Expense) {
                const subId = subModule ? subModule.id : 'add-expense';
                PharmaFlow.Expense.cleanup();

                if (subId === 'add-expense') {
                    PharmaFlow.Expense.renderAdd(contentBody);
                    return;
                }
                if (subId === 'manage-expenses') {
                    PharmaFlow.Expense.renderManage(contentBody);
                    return;
                }
            }

            // Wholesale module
            if (moduleConfig.id === 'wholesale' && PharmaFlow.Wholesale) {
                const subId = subModule ? subModule.id : 'create-wholesale';
                PharmaFlow.Wholesale.cleanup();

                if (subId === 'create-wholesale') {
                    PharmaFlow.Wholesale.renderCreate(contentBody);
                    return;
                }
                if (subId === 'manage-wholesale') {
                    PharmaFlow.Wholesale.renderManage(contentBody);
                    return;
                }
                if (subId === 'client-leads') {
                    PharmaFlow.Wholesale.renderClientLeads(contentBody);
                    return;
                }
                if (subId === 'riders') {
                    PharmaFlow.Wholesale.renderRiders(contentBody);
                    return;
                }
            }

            // Patients module
            if (moduleConfig.id === 'patients' && PharmaFlow.Patients) {
                const subId = subModule ? subModule.id : 'add-patient';
                PharmaFlow.Patients.cleanup();

                if (subId === 'add-patient') {
                    PharmaFlow.Patients.renderAdd(contentBody);
                    return;
                }
                if (subId === 'manage-patients') {
                    PharmaFlow.Patients.renderManage(contentBody);
                    return;
                }
                if (subId === 'patient-billing') {
                    PharmaFlow.Patients.renderBilling(contentBody);
                    return;
                }
                if (subId === 'manage-billing') {
                    PharmaFlow.Patients.renderManageBilling(contentBody);
                    return;
                }
            }

            // Reports module
            if (moduleConfig.id === 'reports' && PharmaFlow.Reports) {
                const subId = subModule ? subModule.id : 'reports-overview';
                PharmaFlow.Reports.cleanup();

                if (subId === 'reports-overview') { PharmaFlow.Reports.renderOverview(contentBody); return; }
                if (subId === 'sales-reports') { PharmaFlow.Reports.renderSales(contentBody); return; }
                if (subId === 'inventory-reports') { PharmaFlow.Reports.renderInventory(contentBody); return; }
                if (subId === 'financial-reports') { PharmaFlow.Reports.renderFinancial(contentBody); return; }
                if (subId === 'generate-report') { PharmaFlow.Reports.renderGenerate(contentBody); return; }
            }

            // Accounts module
            if (moduleConfig.id === 'accounts' && PharmaFlow.Accounts) {
                const subId = subModule ? subModule.id : 'accounts-overview';
                PharmaFlow.Accounts.cleanup();

                if (subId === 'accounts-overview') { PharmaFlow.Accounts.renderOverview(contentBody); return; }
                if (subId === 'income-tracking') { PharmaFlow.Accounts.renderIncome(contentBody); return; }
                if (subId === 'expense-tracking') { PharmaFlow.Accounts.renderExpenses(contentBody); return; }
                if (subId === 'reconciliation') { PharmaFlow.Accounts.renderReconciliation(contentBody); return; }
                if (subId === 'profit-loss') { PharmaFlow.Accounts.renderProfitLoss(contentBody); return; }
            }

            // Activity Log module
            if (moduleConfig.id === 'activity-log' && PharmaFlow.ActivityLog) {
                const subId = subModule ? subModule.id : 'all-activities';
                PharmaFlow.ActivityLog.cleanup();

                if (subId === 'all-activities') { PharmaFlow.ActivityLog.renderAll(contentBody); return; }
                if (subId === 'user-activities') { PharmaFlow.ActivityLog.renderUserActivities(contentBody); return; }
                if (subId === 'system-alerts') { PharmaFlow.ActivityLog.renderAlerts(contentBody); return; }
            }

            // Medication Refill module
            if (moduleConfig.id === 'medication-refill' && PharmaFlow.MedicationRefill) {
                const subId = subModule ? subModule.id : 'refill-overview';
                PharmaFlow.MedicationRefill.cleanup();

                if (subId === 'refill-overview') { PharmaFlow.MedicationRefill.renderOverview(contentBody); return; }
                if (subId === 'add-refill') { PharmaFlow.MedicationRefill.renderAdd(contentBody); return; }
                if (subId === 'manage-refills') { PharmaFlow.MedicationRefill.renderManage(contentBody); return; }
                if (subId === 'refill-reminders') { PharmaFlow.MedicationRefill.renderReminders(contentBody); return; }
            }

            // Settings module
            if (moduleConfig.id === 'settings' && PharmaFlow.Settings) {
                const subId = subModule ? subModule.id : 'my-profile';
                PharmaFlow.Settings.cleanup();

                if (subId === 'my-profile') { PharmaFlow.Settings.renderProfile(contentBody); return; }
                if (subId === 'business-profile') { PharmaFlow.Settings.renderBusiness(contentBody); return; }
                if (subId === 'receipts-invoices') { PharmaFlow.Settings.renderReceipts(contentBody); return; }
                if (subId === 'notifications-settings') { PharmaFlow.Settings.renderNotifications(contentBody); return; }
                if (subId === 'system-settings') { PharmaFlow.Settings.renderSystem(contentBody); return; }
            }

            // Admin Panel module
            if (moduleConfig.id === 'admin-panel' && PharmaFlow.AdminPanel) {
                const subId = subModule ? subModule.id : 'admin-dashboard';
                PharmaFlow.AdminPanel.cleanup();

                if (subId === 'admin-dashboard') {
                    PharmaFlow.AdminPanel.renderDashboard(contentBody);
                    return;
                }
                if (subId === 'manage-users') {
                    PharmaFlow.AdminPanel.renderManageUsers(contentBody);
                    return;
                }
                if (subId === 'manage-franchises') {
                    PharmaFlow.AdminPanel.renderManageFranchises(contentBody);
                    return;
                }
                if (subId === 'admin-analytics') {
                    PharmaFlow.AdminPanel.renderAnalytics(contentBody);
                    return;
                }
                if (subId === 'franchise-alerts') {
                    PharmaFlow.AdminPanel.renderFranchiseAlerts(contentBody);
                    return;
                }
            }

            const pageName = subModule ? subModule.label : moduleConfig.label;
            const pageIcon = subModule ? subModule.icon : moduleConfig.icon;
            const moduleLabel = moduleConfig.label;

            // Build breadcrumb
            let breadcrumbHtml = `<a href="#" data-nav="dashboard">Home</a><span>/</span>`;
            breadcrumbHtml += `<span>${moduleLabel}</span>`;
            if (subModule) {
                breadcrumbHtml += `<span>/</span><span>${subModule.label}</span>`;
            }

            contentBody.innerHTML = `
                <div class="page-header">
                    <div>
                        <h2>${pageName}</h2>
                        <div class="breadcrumb">${breadcrumbHtml}</div>
                    </div>
                </div>
                <div class="card">
                    <div class="page-placeholder">
                        <i class="${pageIcon}"></i>
                        <h2>${pageName}</h2>
                        <p>This module is ready for implementation.</p>
                    </div>
                </div>
            `;

            // Bind breadcrumb navigation
            const dashboardLink = contentBody.querySelector('[data-nav="dashboard"]');
            if (dashboardLink) {
                dashboardLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    PharmaFlow.Sidebar.setActive('dashboard', null);
                });
            }
        }
    };

    window.PharmaFlow.Router = Router;
})();
