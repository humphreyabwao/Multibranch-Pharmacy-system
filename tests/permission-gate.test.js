const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const listeners = {};
const timers = [];
const testConsole = Object.assign(Object.create(console), {
    warn() {}
});
class FakeElement {
    constructor() {
        this.children = [];
        this.dataset = {};
        this.className = '';
        this.textContent = '';
        this._innerHTML = '';
    }
    set innerHTML(value) {
        this._innerHTML = value;
        if (value === '') this.children = [];
    }
    get innerHTML() { return this._innerHTML; }
    appendChild(child) { this.children.push(child); }
    addEventListener() {}
}
const elements = {
    'sidebar-nav': new FakeElement(),
    'sidebar-nav-footer': new FakeElement()
};
const context = {
    console: testConsole,
    Set,
    setTimeout(handler) {
        timers.push(handler);
        return handler;
    },
    clearTimeout(handler) {
        const index = timers.indexOf(handler);
        if (index >= 0) timers.splice(index, 1);
    },
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
        addEventListener(type, handler) { listeners[type] = handler; },
        getElementById(id) { return elements[id] || null; },
        createElement() { return new FakeElement(); },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    },
    window: {
        location: { pathname: '/index.html' },
        innerWidth: 1280,
        addEventListener(type, handler) { listeners[type] = handler; },
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

for (const file of ['auth.js', 'sidebar.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
    vm.runInContext(source, context, { filename: file });
}

const Auth = context.window.PharmaFlow.Auth;
const Sidebar = context.window.PharmaFlow.Sidebar;

function setProfile(profile, ready = true) {
    Auth.userProfile = profile;
    Auth.authorizationReady = ready;
    Sidebar.authorizationReady = ready;
}

setProfile({ role: 'admin', permissions: ['inventory', 'inventory:view-inventory'], permissionsConfigured: true });
assert.strictEqual(Auth.canAccess('inventory'), true);
assert.strictEqual(Auth.canAccess('inventory', 'view-inventory'), true);
assert.strictEqual(Auth.canAccess('inventory', 'add-inventory'), false);
assert.strictEqual(Sidebar.canAccess('admin-panel'), false);
assert.strictEqual(Sidebar.canAccess('pharmacy'), false);
assert.strictEqual(Auth.getBusinessId(), null, 'a tenant-less profile cannot resolve a workspace');
Sidebar.render('admin');
assert.deepStrictEqual(
    elements['sidebar-nav'].children.filter(item => item.dataset.moduleId).map(item => item.dataset.moduleId),
    ['inventory'],
    'only explicitly assigned modules should be rendered'
);

setProfile({ role: 'staff', permissions: [], permissionsConfigured: true });
assert.strictEqual(Auth.canAccess('dashboard'), false);
assert.strictEqual(Sidebar.getFirstAccessibleTarget(), null);
Sidebar.render('staff');
assert.strictEqual(elements['sidebar-nav'].children.length, 0, 'explicitly empty permissions render no modules');

setProfile({
    role: 'admin',
    businessId: 'tenant-a',
    permissions: ['dashboard'],
    permissionsConfigured: true
});
context.window.PharmaFlow.selectedBusinessId = 'tenant-b';
assert.strictEqual(Auth.getBusinessId(), 'tenant-a', 'browser state cannot switch a franchise user');
assert.strictEqual(Auth.canAccessBusiness('tenant-a'), true);
assert.strictEqual(Auth.canAccessBusiness('tenant-b'), false);
assert.strictEqual(Auth.setActiveBusinessId('tenant-b'), false);
assert.strictEqual(context.window.PharmaFlow.selectedBusinessId, null);
assert.throws(() => Auth.assertBusinessAccess('tenant-b'), /TENANT_ACCESS_DENIED/);
assert.strictEqual(Auth.canAccessBusiness('tenant/a'), false, 'path-like tenant IDs are rejected');
assert.strictEqual(
    Auth.authorizationFingerprint({
        role: 'admin',
        businessId: 'tenant-a',
        permissionsConfigured: true,
        permissions: ['inventory', 'dashboard']
    }),
    Auth.authorizationFingerprint({
        role: 'admin',
        businessId: 'tenant-a',
        permissionsConfigured: true,
        permissions: ['dashboard', 'inventory']
    }),
    'permission ordering must not cause false authorization changes'
);
assert.notStrictEqual(
    Auth.authorizationFingerprint({ role: 'admin', businessId: 'tenant-a', permissions: [] }),
    Auth.authorizationFingerprint({ role: 'admin', businessId: 'tenant-b', permissions: [] }),
    'tenant reassignment must be detected immediately'
);

setProfile({ role: 'admin', permissions: [] });
assert.strictEqual(Auth.canAccess('dashboard'), true, 'legacy unconfigured profiles retain access');

setProfile({ role: 'superadmin', permissions: [], permissionsConfigured: true });
assert.strictEqual(Sidebar.canAccess('admin-panel'), true);
assert.strictEqual(Auth.setActiveBusinessId('tenant-b'), true);
assert.strictEqual(Auth.getBusinessId(), 'tenant-b');

setProfile({ role: 'admin', permissions: ['dashboard'], permissionsConfigured: true }, false);
assert.strictEqual(Auth.canAccess('dashboard'), false, 'authorization must fail closed before profile verification');
assert.strictEqual(Sidebar.canAccess('dashboard'), false);
Sidebar.render('admin');
assert.strictEqual(elements['sidebar-nav'].children.length, 0, 'pre-authorization sidebar stays empty');

let currentSnapshot = null;
let onSnapshotCount = 0;
let unsubscribeCount = 0;
context.window.db = {
    collection(name) {
        assert.strictEqual(name, 'system_config');
        return {
            doc(id) {
                assert.strictEqual(id, 'module_tags');
                return {
                    onSnapshot(success, error) {
                        onSnapshotCount += 1;
                        currentSnapshot = { success, error };
                        return () => { unsubscribeCount += 1; };
                    }
                };
            }
        };
    }
};

setProfile({ role: 'admin', permissions: ['dashboard'], permissionsConfigured: true });
Sidebar.updateForRole('admin');
assert.strictEqual(onSnapshotCount, 1, 'module tag listener should start after authorization');
currentSnapshot.success({
    exists: true,
    data() { return { tags: { dashboard: 'new' } }; }
});
assert.strictEqual(Sidebar.getModuleTag('dashboard'), 'new');

currentSnapshot.error(new Error('transient listener failure'));
assert.strictEqual(Sidebar._moduleTagsListener, null, 'listener handle must clear after errors');
assert.strictEqual(unsubscribeCount, 1, 'failed listener must be detached');
assert.strictEqual(timers.length, 1, 'listener errors should schedule a retry');
timers.shift()();
assert.strictEqual(onSnapshotCount, 2, 'retry should re-open the module tag listener');

Sidebar.lock();
assert.strictEqual(Sidebar._moduleTagsListener, null, 'lock must detach module tag listener');
assert.strictEqual(unsubscribeCount, 2, 'lock should unsubscribe the active module tag listener');
assert.deepStrictEqual(Object.keys(Sidebar._moduleTags), [], 'lock clears cached module tags');

console.log('Permission gate scenarios passed.');
