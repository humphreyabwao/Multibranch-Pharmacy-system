const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const deleted = Symbol('delete');
const timestamp = Symbol('serverTimestamp');

const context = {
    console,
    window: {
        PharmaFlow: {
            NAV_CONFIG: [],
            SETTINGS_NAV: null,
            Auth: {
                userProfile: {
                    displayName: 'Super Admin',
                    email: 'admin@example.com'
                }
            }
        },
        addEventListener() {}
    },
    document: {
        readyState: 'loading',
        addEventListener() {},
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() { return {}; }
    },
    firebase: {
        firestore: {
            FieldValue: {
                delete() { return deleted; },
                serverTimestamp() { return timestamp; }
            }
        },
        auth() {
            return { currentUser: { uid: 'superadmin' } };
        }
    }
};
context.window.window = context.window;
context.window.document = context.document;
context.PharmaFlow = context.window.PharmaFlow;
vm.createContext(context);

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-panel.js'), 'utf8');
vm.runInContext(source, context, { filename: 'admin-panel.js' });

const update = context.window.PharmaFlow.AdminPanel.buildFranchiseReactivationUpdate();

assert.strictEqual(update.isActive, true);
assert.strictEqual(update.billingStatus, 'active');
assert.strictEqual(update.updatedAt, timestamp);

[
    'deactivationStatus',
    'suspensionReason',
    'inactiveReason',
    'deactivationReason',
    'deactivationAmount',
    'deactivationCurrency',
    'deactivationTillNumber',
    'deactivationPaybillNumber',
    'deactivationAccountNumber',
    'deactivationPaymentNumber',
    'deactivationPaymentInstructions',
    'deactivationPaymentUrl',
    'deactivationShowPayNow',
    'deactivatedAt',
    'deactivatedBy',
    'suspendedAt',
    'suspendedBy'
].forEach(field => {
    assert.strictEqual(update[field], deleted, field + ' must be cleared on reactivation');
});

console.log('Admin franchise flow scenarios passed.');
