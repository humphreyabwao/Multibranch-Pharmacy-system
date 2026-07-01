const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
    constructor() {
        this.children = [];
        this.dataset = {};
        this.className = '';
        this.textContent = '';
        this._innerHTML = '';
    }
    set innerHTML(value) { this._innerHTML = value; }
    get innerHTML() { return this._innerHTML; }
    appendChild(child) { this.children.push(child); }
    addEventListener() {}
    querySelectorAll() { return []; }
}

function snapshot(rows) {
    return {
        forEach(callback) {
            rows.forEach((row, index) => {
                callback({
                    id: row.id || String(index + 1),
                    data() { return row; }
                });
            });
        }
    };
}

function queryFor(rows, failures, label) {
    return {
        where() { return this; },
        orderBy() { return this; },
        limit() { return this; },
        async get() {
            if (failures.has(label)) throw new Error('planned failure: ' + label);
            return snapshot(rows[label] || []);
        }
    };
}

const elements = {
    'sidebar-nav': new FakeElement(),
    'sidebar-nav-footer': new FakeElement(),
    'gs-body': new FakeElement()
};

const context = {
    console: Object.assign(Object.create(console), { warn() {} }),
    Set,
    Date,
    Intl,
    setTimeout() {},
    clearTimeout() {},
    cancelAnimationFrame() {},
    requestAnimationFrame(fn) { return fn(); },
    CustomEvent: function CustomEvent(type, options) {
        this.type = type;
        this.detail = options && options.detail;
    },
    localStorage: {
        getItem() { return null; },
        setItem() {},
        removeItem() {}
    },
    sessionStorage: {
        getItem() { return null; },
        setItem() {},
        removeItem() {}
    },
    document: {
        readyState: 'loading',
        addEventListener() {},
        removeEventListener() {},
        getElementById(id) { return elements[id] || null; },
        createElement() { return new FakeElement(); },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        body: new FakeElement()
    },
    window: {
        location: { pathname: '/index.html' },
        innerWidth: 1280,
        addEventListener() {},
        dispatchEvent() {},
        PharmaFlow: {
            USER_ROLES: {
                SUPERADMIN: 'superadmin',
                ADMIN: 'admin',
                STAFF: 'staff'
            }
        }
    }
};
context.window.window = context.window;
context.window.document = context.document;
context.PharmaFlow = context.window.PharmaFlow;

vm.createContext(context);

for (const file of ['auth.js', 'sidebar.js', 'dashboard.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
    vm.runInContext(source, context, { filename: file });
}

const { Auth, Sidebar, Dashboard } = context.window.PharmaFlow;
Auth.userProfile = { role: 'superadmin', businessId: 'tenant-a', permissions: [], permissionsConfigured: false };
Auth.authorizationReady = true;
Sidebar.authorizationReady = true;

const modules = Dashboard._getSearchableModules();
assert(
    modules.some(item => item.module === 'pharmacy' && item.sub === 'customers'),
    'Pharmacy Customers must be searchable as a module target'
);
assert(
    modules.some(item => item.module === 'branch-portal' && item.sub === 'branch-certificates'),
    'Branch Portal certificates must be searchable as a module target'
);
assert(
    Dashboard._matchModuleKeywords('customers').some(item => item.module === 'pharmacy' && item.sub === 'customers'),
    'customer keyword should match the Pharmacy Customers tab'
);

const rows = {
    inventory: [{ id: 'panadol', name: 'Panadol', sku: 'PAN-500', quantity: 5, sellingPrice: 10 }],
    patients: [{ id: 'pt-1', patientId: 'PT-1', fullName: 'Amina Patient', phone: '0711000000' }],
    sales: [{ id: 'sale-1', saleId: 'S-1', customerName: 'Amina Retail', customerPhone: '0722000000', total: 150, createdAt: '2026-06-01T10:00:00.000Z' }],
    suppliers: [{ id: 'sup-1', name: 'Amina Supplies', contactPerson: 'Buyer', phone: '0733000000' }],
    expenses: [],
    wholesale_orders: [],
    prescriptions: [],
    orders: [{ id: 'po-1', orderId: 'PO-1', supplierName: 'Amina Supplies', totalAmount: 250, status: 'pending' }],
    medication_refills: [],
    dda_register: [],
    disposals: [],
    patient_bills: [],
    patient_records: [],
    riders: [],
    client_leads: [{ id: 'lead-1', name: 'Amina Clinic', businessName: 'Clinic', phone: '0744000000' }],
    tickets: [{ id: 'ticket-1', ticketId: 'T-1', subject: 'Amina issue', status: 'open', createdAt: '2026-06-01T10:00:00.000Z' }],
    activity_log: [],
    stock_history: [],
    message_history: [],
    branch_finance_docs: [{ id: 'bill-1', docNumber: 'AMINA-BILL', billingMonth: 'June 2026', amount: 500, status: 'issued' }],
    branch_communications: [],
    branch_contracts: [],
    branch_certificates: [{ id: 'cert-1', title: 'Amina License', authority: 'Board', status: 'active' }]
};
const failures = new Set(['activity_log']);

context.getBusinessCollection = function getBusinessCollection(businessId, collectionName) {
    assert.strictEqual(businessId, 'tenant-a');
    return queryFor(rows, failures, collectionName);
};

context.window.db = {
    collection(collectionName) {
        return queryFor(rows, failures, collectionName);
    }
};

Dashboard.performSearch('amina', 'tenant-a').then(() => {
    const html = elements['gs-body'].innerHTML;
    assert(html.includes('Pharmacy Customers'), 'sales customer matches should route to Pharmacy Customers');
    assert(html.includes('Purchase Orders'), 'purchase orders should be included');
    assert(html.includes('Support Tickets'), 'support tickets should be included');
    assert(html.includes('Branch Documents'), 'branch finance documents should be included');
    assert(html.includes('Branch Certificates'), 'branch certificates should be included');
    assert(!html.includes('Activity Logs'), 'failed collection should be skipped without killing search');

    const duplicated = [
        { type: 'x', title: 'Same', subtitle: 'One', navigate: { module: 'dashboard', sub: null } },
        { type: 'x', title: 'Same', subtitle: 'One', navigate: { module: 'dashboard', sub: null } },
        { type: 'x', title: 'Different', subtitle: 'One', navigate: { module: 'dashboard', sub: null } }
    ];
    assert.strictEqual(Dashboard._dedupeSearchResults(duplicated).length, 2);

    console.log('Dashboard search scenarios passed.');
}).catch(err => {
    console.error(err);
    process.exit(1);
});
