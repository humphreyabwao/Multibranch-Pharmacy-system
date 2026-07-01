const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
    constructor() {
        this.textContent = '';
        this.innerHTML = '';
    }
}

const context = {
    console,
    Intl,
    Math,
    Number,
    String,
    Date,
    localStorage: {
        getItem() { return null; }
    },
    document: {
        createElement() { return new FakeElement(); },
        querySelector() { return null; }
    },
    window: {
        PharmaFlow: {
            Settings: {
                getBusinessName() { return 'Sugar Pharmacy'; },
                formatCurrency(value) { return 'KSH ' + Number(value || 0).toFixed(2); }
            }
        }
    }
};
context.window.window = context.window;
context.window.document = context.document;
context.window.localStorage = context.localStorage;
context.PharmaFlow = context.window.PharmaFlow;

vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'human-resource.js'), 'utf8');
vm.runInContext(source, context);

const HR = context.window.PharmaFlow.HumanResource;

assert.strictEqual(HR.staffCodePrefix(), 'SUG');

{
    const pending = {
        grossPay: 50000,
        totalMonthPay: 50000,
        cashBalancePayable: 30000,
        paymentConfirmed: false,
        status: 'pending-payment'
    };
    assert.strictEqual(HR.payrollBalancePayable(pending), 30000);
    assert.strictEqual(HR.payrollTotalPaidForMonth(pending), 20000);
}

{
    const paid = {
        grossPay: 50000,
        totalMonthPay: 50000,
        cashBalancePayable: 30000,
        paymentConfirmed: true,
        status: 'paid'
    };
    assert.strictEqual(HR.payrollBalancePayable(paid), 30000);
    assert.strictEqual(HR.payrollTotalPaidForMonth(paid), 50000);
}

{
    const deductions = HR.calculateStatutoryDeductions(50000);
    assert.ok(deductions.total > 0);
    assert.strictEqual(deductions.total, HR.roundMoney(deductions.nssf + deductions.shif + deductions.housingLevy + deductions.paye));
}

assert.strictEqual(HR.formatDateTime(null), '-');
assert.notStrictEqual(HR.formatDateTime('2026-07-01T10:30:00.000Z'), '-');

console.log('Human resource payroll scenarios passed.');
