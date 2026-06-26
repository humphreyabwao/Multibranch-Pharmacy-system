const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeClassList {
    constructor() {
        this.values = new Set();
    }
    add(value) { this.values.add(value); }
    remove(value) { this.values.delete(value); }
    contains(value) { return this.values.has(value); }
}

class FakeElement {
    constructor() {
        this.classList = new FakeClassList();
        this.attributes = {};
        this.textContent = '';
        this.children = [];
        this.innerHTML = '';
        this.disabled = false;
    }
    addEventListener() {}
    appendChild(child) { this.children.push(child); }
    setAttribute(name, value) { this.attributes[name] = value; }
    get offsetWidth() { return 1; }
}

function createContext() {
    const elements = {
        'login-error': new FakeElement(),
        'login-error-text': new FakeElement(),
        'login-error-actions': new FakeElement(),
        'login-success': new FakeElement(),
        'login-btn': new FakeElement(),
        'login-btn-default': new FakeElement(),
        'login-btn-loading': new FakeElement()
    };
    elements['login-error'].classList.add('login-hidden');
    elements['login-success'].classList.add('login-hidden');

    const storage = new Map();
    const context = {
        console: Object.assign(Object.create(console), { warn() {} }),
        Set,
        CustomEvent: function CustomEvent(type, options) {
            this.type = type;
            this.detail = options && options.detail;
        },
        localStorage: {
            get length() { return storage.size; },
            key(index) { return Array.from(storage.keys())[index] || null; },
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        },
        sessionStorage: {
            get length() { return 0; },
            key() { return null; },
            getItem() { return null; },
            setItem() {},
            removeItem() {}
        },
        document: {
            readyState: 'loading',
            addEventListener() {},
            getElementById(id) { return elements[id] || null; },
            createElement() { return new FakeElement(); },
            querySelectorAll() { return []; }
        },
        window: {
            location: {
                pathname: '/login.html',
                replace(url) { this.replacedWith = url; }
            },
            addEventListener() {},
            dispatchEvent() {},
            PharmaFlow: {
                USER_ROLES: {
                    SUPERADMIN: 'superadmin',
                    ADMIN: 'admin',
                    STAFF: 'staff'
                }
            }
        },
        firebase: {
            auth: {
                Auth: {
                    Persistence: {
                        LOCAL: 'local',
                        SESSION: 'session'
                    }
                }
            }
        }
    };
    context.window.window = context.window;
    context.window.document = context.document;
    context.window.auth = null;
    context.PharmaFlow = context.window.PharmaFlow;
    context.__elements = elements;
    vm.createContext(context);
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'auth.js' });
    return context;
}

function loadApp(context) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'app.js' });
}

async function assertSuspendedProfileRejected(profile, expectedMessage) {
    const context = createContext();
    let businessRead = false;
    context.window.db = {
        collection(name) {
            return {
                doc(id) {
                    return {
                        async get() {
                            if (name === 'users') {
                                return {
                                    exists: true,
                                    id,
                                    data() { return profile; }
                                };
                            }
                            businessRead = true;
                            return {
                                exists: true,
                                data() { return { isActive: true }; }
                            };
                        }
                    };
                }
            };
        }
    };

    await assert.rejects(
        () => context.window.PharmaFlow.Auth.loadUserProfile('uid-1'),
        /ACCOUNT_SUSPENDED/
    );
    assert.strictEqual(businessRead, false, 'suspended accounts should be rejected before franchise reads');
    assert.strictEqual(context.window.PharmaFlow.Auth.getAccountSuspensionMessage(profile), expectedMessage);
}

(async () => {
    await assertSuspendedProfileRejected(
        { role: 'admin', businessId: 'tenant-a', status: 'disabled', email: 'admin@example.com' },
        'Your account has been suspended. Please contact your administrator.'
    );

    await assertSuspendedProfileRejected(
        { role: 'superadmin', status: 'suspended', suspensionReason: 'Policy review', email: 'owner@example.com' },
        'Your account has been suspended. Reason: Policy review'
    );

    const context = createContext();
    let signedOut = false;
    context.window.auth = {
        async signOut() {
            signedOut = true;
        }
    };

    await context.window.PharmaFlow.Auth.denyAccess('Your account has been suspended. Please contact your administrator.');
    assert.strictEqual(signedOut, true, 'blocked login session must be closed');
    assert.strictEqual(
        context.__elements['login-error-text'].textContent,
        'Your account has been suspended. Please contact your administrator.'
    );
    assert.strictEqual(context.__elements['login-error'].classList.contains('login-hidden'), false);
    assert.strictEqual(context.__elements['login-success'].classList.contains('login-hidden'), true);

    assert.strictEqual(
        context.window.PharmaFlow.Auth.parseAuthError({ code: 'auth/user-disabled' }),
        'This account has been suspended. Contact your administrator.'
    );

    const branchContext = createContext();
    const inactiveBranch = {
        isActive: false,
        deactivationStatus: 'overdue',
        deactivationReason: 'Monthly subscription payment is overdue',
        deactivationAmount: 4500,
        deactivationCurrency: 'KES',
        deactivationTillNumber: '123456',
        deactivationPaybillNumber: '654321',
        deactivationAccountNumber: 'BR-001',
        deactivationPaymentNumber: '0712345678',
        deactivationPaymentInstructions: 'Send confirmation to admin.',
        deactivationShowPayNow: true
    };
    branchContext.window.db = {
        collection(name) {
            return {
                doc(id) {
                    return {
                        async get() {
                            if (name === 'users') {
                                return {
                                    exists: true,
                                    id,
                                    data() {
                                        return {
                                            role: 'admin',
                                            businessId: 'tenant-a',
                                            status: 'active',
                                            email: 'branch@example.com'
                                        };
                                    }
                                };
                            }
                            return {
                                exists: true,
                                data() { return inactiveBranch; }
                            };
                        }
                    };
                }
            };
        }
    };
    await assert.rejects(
        () => branchContext.window.PharmaFlow.Auth.loadUserProfile('uid-2'),
        /FRANCHISE_INACTIVE/
    );
    const storedMessage = branchContext.localStorage.getItem('pf_login_error');
    assert(storedMessage.includes('This franchise has been deactivated.'));
    assert(storedMessage.includes('Status: Overdue.'));
    assert(storedMessage.includes('Amount due: KES 4,500.00.'));
    assert(storedMessage.includes('Till: 123456.'));
    assert(storedMessage.includes('Paybill: 654321, Account: BR-001.'));

    branchContext.window.PharmaFlow.Auth.showLoginError(storedMessage);
    assert.strictEqual(branchContext.__elements['login-error-actions'].classList.contains('login-hidden'), false);
    assert.strictEqual(branchContext.__elements['login-error-actions'].children.length, 2, 'Pay Now details and button should render');

    const realtimeContext = createContext();
    loadApp(realtimeContext);
    let signedOutRealtime = false;
    let snapshotHandler = null;
    realtimeContext.window.PharmaFlow.Auth.userProfile = {
        role: 'admin',
        businessId: 'tenant-a',
        status: 'active'
    };
    realtimeContext.window.PharmaFlow.Auth.signOut = async function signOut() {
        signedOutRealtime = true;
    };
    realtimeContext.window.db = {
        collection(name) {
            assert.strictEqual(name, 'businesses');
            return {
                doc(id) {
                    assert.strictEqual(id, 'tenant-a');
                    return {
                        onSnapshot(handler) {
                            snapshotHandler = handler;
                            return () => {};
                        }
                    };
                }
            };
        }
    };
    realtimeContext.window.PharmaFlow.App.startBusinessStatusWatcher('tenant-a');
    assert(snapshotHandler, 'business status watcher should subscribe to the franchise document');
    snapshotHandler({
        exists: true,
        data() { return inactiveBranch; }
    });
    assert.strictEqual(signedOutRealtime, true, 'inactive franchise snapshot should sign out assigned users');
    assert(realtimeContext.localStorage.getItem('pf_login_error').includes('This franchise has been deactivated.'));
    assert(realtimeContext.localStorage.getItem('pf_login_error_detail').includes('"showPayNow":true'));

    console.log('Auth suspension scenarios passed.');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
