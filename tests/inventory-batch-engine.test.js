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

// Receiving stock preserves all existing physical batches even when the legacy product total drifted.
{
    const result = engine.appendBatch({
        quantity: 1,
        stockBatches: [
            { batchNumber: 'A', quantity: 1, expiryDate: future },
            { batchNumber: 'B', quantity: 1, expiryDate: later }
        ]
    }, { batchNumber: 'C', quantity: 2, expiryDate: later });
    assert.strictEqual(result.quantityAfter, 4);
    assert.strictEqual(result.updatedBatches.reduce((sum, batch) => sum + batch.quantity, 0), 4);
}

// An expiry date remains valid through the end of that calendar day.
{
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const midday = new Date(today);
    midday.setHours(12, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    assert.strictEqual(engine.isExpired(today, midday.getTime()), false);
    assert.strictEqual(engine.isExpired(yesterday, midday.getTime()), true);
}

// Newly received batches cannot already be expired.
{
    assert.throws(() => engine.appendBatch({ quantity: 0, stockBatches: [] }, {
        batchNumber: 'PAST',
        quantity: 1,
        expiryDate: expired
    }), /already expired/);
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

// Gross margin is calculated against selling price, per batch.
{
    assert.strictEqual(engine.marginPercentage(60, 100), 40);
    assert.strictEqual(engine.marginPercentage(100, 80), -25);
    assert.strictEqual(engine.marginPercentage(10, 0), 0);
}

// Markup is calculated against cost, matching the common pharmacy interpretation.
{
    assert.strictEqual(engine.markupPercentage(100, 150), 50);
    assert.strictEqual(engine.markupPercentage(100, 80), -20);
    assert.strictEqual(engine.markupPercentage(0, 100), 0);
    assert.strictEqual(engine.markupPercentage(245.39, 330).toFixed(1), '34.5');
    assert.strictEqual(engine.marginPercentage(245.39, 330).toFixed(1), '25.6');
}

// Editing a product updates the current FEFO batch expiry and prices.
{
    const changedExpiry = '2098-06-30T00:00:00.000Z';
    const result = engine.updatePrimaryBatch(product([
        { batchNumber: 'LATER', quantity: 4, expiryDate: later, buyingPrice: 5, sellingPrice: 10 },
        { batchNumber: 'CURRENT', quantity: 3, expiryDate: future, buyingPrice: 6, sellingPrice: 12 }
    ]), {
        expiryDate: changedExpiry,
        buyingPrice: 8,
        sellingPrice: 20,
        minimumSellPrice: 9
    });
    const updated = result.updatedBatches.find(batch => batch.batchNumber === 'CURRENT');
    assert.strictEqual(updated.expiryDate, changedExpiry);
    assert.strictEqual(updated.buyingPrice, 8);
    assert.strictEqual(updated.sellingPrice, 20);
    assert.strictEqual(updated.minimumSellPrice, 9);
    assert.strictEqual(result.quantityAfter, 7);
}

// An expired batch can have an incorrectly entered expiry corrected.
{
    const result = engine.updatePrimaryBatch(product([
        { batchNumber: 'EXPIRED', quantity: 2, expiryDate: expired, buyingPrice: 5, sellingPrice: 10 }
    ]), { expiryDate: future });
    assert.strictEqual(result.updatedBatch.expiryDate, future);
    assert.strictEqual(result.primaryBatch.batchNumber, 'EXPIRED');
}

// Restoring a cancelled sale also preserves pre-existing batches when totals had drifted.
{
    const restored = engine.restore({
        quantity: 1,
        stockBatches: [
            { batchNumber: 'A', quantity: 1, expiryDate: future },
            { batchNumber: 'B', quantity: 1, expiryDate: later }
        ]
    }, [{ batchNumber: 'C', quantity: 1, expiryDate: later }]);
    assert.strictEqual(restored.quantityAfter, 3);
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

// Reconciliation keeps a legacy opening balance and applies every movement in order.
{
    const ledger = engine.reconcileHistory([
        { id: '1', createdAt: '2026-01-01', previousQty: 10, addedQty: 5, newQty: 15 },
        { id: '2', createdAt: '2026-01-02', previousQty: 15, removedQty: 3, newQty: 12 },
        { id: '3', createdAt: '2026-01-03', previousQty: 12, removedQty: 2, newQty: 10 }
    ], 10);
    assert.strictEqual(ledger.openingQty, 10);
    assert.strictEqual(ledger.expectedQty, 10);
    assert.strictEqual(ledger.ledgerBreaks, 0);
}

// Missing links in stock history are surfaced even when a later checkpoint restores the total.
{
    const ledger = engine.reconcileHistory([
        { id: '1', createdAt: '2026-01-01', previousQty: 5, addedQty: 5, newQty: 10 },
        { id: '2', createdAt: '2026-01-02', previousQty: 8, removedQty: 1, newQty: 7 }
    ], 7);
    assert.strictEqual(ledger.expectedQty, 7);
    assert.strictEqual(ledger.ledgerBreaks, 1);
}

// A product without history uses its current stored quantity as a neutral baseline.
{
    const ledger = engine.reconcileHistory([], 6);
    assert.strictEqual(ledger.expectedQty, 6);
    assert.strictEqual(ledger.source, 'current baseline');
}

console.log('Inventory batch engine scenarios passed.');
