const assert = require('assert');
const engine = require('../js/inventory-batch-engine.js');

const future = '2099-12-31T00:00:00.000Z';
const later = '2100-12-31T00:00:00.000Z';
const expired = '2020-01-01T00:00:00.000Z';

function product(batches) {
    return {
        name: 'Test medicine',
        quantity: batches.reduce((sum, batch) => sum + batch.quantity, 0),
        buyingPrice: 5,
        sellingPrice: 10,
        stockBatches: batches
    };
}

// Expired and duplicate historical rows cannot inflate the live sellable count.
{
    const drifted = {
        quantity: 2,
        stockBatches: [
            { batchNumber: 'OLD', quantity: 1, expiryDate: expired },
            { batchNumber: 'CLEAN', quantity: 2, expiryDate: future }
        ]
    };
    assert.strictEqual(engine.sellableQuantity(drifted), 1);
    assert.deepStrictEqual(engine.sellableBatches(drifted).map(batch => [batch.batchNumber, batch.quantity]), [['CLEAN', 1]]);
}

// FEFO: earliest expiry moves first.
{
    const result = engine.consume(product([
        { batchNumber: 'LATE', quantity: 5, expiryDate: later, addedAt: '2025-01-01' },
        { batchNumber: 'EARLY', quantity: 3, expiryDate: future, addedAt: '2025-02-01' }
    ]), 4);
    assert.deepStrictEqual(result.allocations.map(x => [x.batchNumber, x.quantity]), [
        ['EARLY', 3],
        ['LATE', 1]
    ]);
    assert.strictEqual(result.quantityAfter, 4);
}

// FIFO tie-break: same expiry, oldest receipt first.
{
    const result = engine.consume(product([
        { batchNumber: 'NEW', quantity: 4, expiryDate: future, addedAt: '2026-02-01' },
        { batchNumber: 'OLD', quantity: 4, expiryDate: future, addedAt: '2026-01-01' }
    ]), 2);
    assert.strictEqual(result.allocations[0].batchNumber, 'OLD');
}

// Expired stock cannot be sold and remains separate.
{
    const p = product([
        { batchNumber: 'EXPIRED', quantity: 8, expiryDate: expired },
        { batchNumber: 'CLEAN', quantity: 2, expiryDate: future }
    ]);
    assert.strictEqual(engine.sellableQuantity(p), 2);
    assert.throws(() => engine.consume(p, 3), /Only 2 sellable/);
}

// Append always reconciles the product quantity to the batch sum.
{
    const result = engine.appendBatch(product([
        { batchNumber: 'A', quantity: 2, expiryDate: future }
    ]), { batchNumber: 'B', quantity: 5, expiryDate: later });
    assert.strictEqual(result.quantityAfter, 7);
    assert.strictEqual(result.primaryBatch.batchNumber, 'A');
}

// Receiving the exact same physical batch merges instead of duplicating it.
{
    const result = engine.appendBatch(product([
        { batchNumber: 'SAME', quantity: 2, expiryDate: future, buyingPrice: 5, sellingPrice: 10 }
    ]), { batchNumber: 'SAME', quantity: 3, expiryDate: future, buyingPrice: 5, sellingPrice: 10 });
    assert.strictEqual(result.updatedBatches.length, 1);
    assert.strictEqual(result.updatedBatches[0].quantity, 5);
}

// Integrity inspection catches drift and duplicate batches.
{
    const result = engine.inspect({
        quantity: 99,
        stockBatches: [
            { batchNumber: 'DUP', quantity: 2, expiryDate: future },
            { batchNumber: 'DUP', quantity: 3, expiryDate: later }
        ]
    });
    assert.strictEqual(result.quantityMismatch, true);
    assert.deepStrictEqual(result.duplicateBatchNumbers, ['DUP']);
}

// Exact allocations can be restored without losing batch identity.
{
    const p = product([{ batchNumber: 'A', quantity: 1, expiryDate: future }]);
    const restored = engine.restore(p, [{
        batchNumber: 'A',
        quantity: 2,
        expiryDate: future,
        buyingPrice: 5,
        sellingPrice: 10
    }]);
    assert.strictEqual(restored.quantityAfter, 3);
    assert.strictEqual(restored.updatedBatches[0].quantity, 3);
}

// Sellable stock is conservative when legacy product and batch totals disagree.
{
    const drifted = {
        name: 'Drifted product',
        quantity: 1,
        stockBatches: [
            { batchNumber: 'B1', quantity: 1, expiryDate: future },
            { batchNumber: 'B2', quantity: 1, expiryDate: later }
        ]
    };
    assert.strictEqual(engine.sellableQuantity(drifted), 1);
    assert.strictEqual(engine.sellableBatches(drifted).reduce((sum, batch) => sum + batch.quantity, 0), 1);
    assert.throws(() => engine.consume(drifted, 2), /Only 1 sellable/);
    const sold = engine.consume(drifted, 1);
    assert.strictEqual(sold.quantityAfter, 0);
    assert.strictEqual(sold.sellableAfter, 0);
}

console.log('Inventory batch engine scenarios passed.');
