/**
 * Canonical inventory KPI math — loaded before dashboard.js & inventory.js.
 * Dashboard and Inventory UI both use this so totals never drift between screens.
 */
(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    /**
     * @param {Array<{ quantity?: number, sellingPrice?: number, stockBatches?: Array, reorderLevel?: number, expiryDate?: * }>} products
     * @returns {{ totalProducts: number, totalValue: number, outOfStock: number, lowStock: number, expiringSoon: number }}
     */
    PharmaFlow.computeInventoryStats = function (products) {
        var list = products || [];
        var now = new Date();
        var thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        var totalValue = 0;
        var outOfStock = 0;
        var lowStock = 0;
        var expiringSoon = 0;

        function batchPricedValue(p, field) {
            var engine = window.PharmaFlow && window.PharmaFlow.InventoryBatchEngine;
            var productQty = engine ? engine.sellableQuantity(p) : Math.max(0, parseInt(p.quantity, 10) || 0);
            if (!productQty) return 0;
            var fallback = parseFloat(p[field]) || 0;
            var batches = engine ? engine.sellableBatches(p) : (Array.isArray(p.stockBatches) ? p.stockBatches : []);
            if (!batches.length) return productQty * fallback;

            var assigned = 0;
            var value = 0;
            batches.forEach(function (batch) {
                if (assigned >= productQty) return;
                var qty = Math.max(0, parseInt(batch.quantity, 10) || 0);
                var used = Math.min(qty, productQty - assigned);
                var price = parseFloat(batch[field]);
                value += used * (isFinite(price) ? price : fallback);
                assigned += used;
            });
            if (assigned < productQty) value += (productQty - assigned) * fallback;
            return value;
        }

        list.forEach(function (p) {
            var engine = window.PharmaFlow && window.PharmaFlow.InventoryBatchEngine;
            var qty = engine ? engine.sellableQuantity(p) : (p.quantity || 0);
            var reorderLevel = p.reorderLevel || 10;

            totalValue += batchPricedValue(p, 'sellingPrice');

            if (qty <= 0) outOfStock++;
            else if (qty <= reorderLevel) lowStock++;

            var batches = engine ? engine.sellableBatches(p) : [];
            var hasExpiringBatch = batches.some(function (batch) {
                if (!batch.expiryDate) return false;
                var exp = batch.expiryDate.toDate ? batch.expiryDate.toDate() : new Date(batch.expiryDate);
                return exp <= thirtyDays && exp > now;
            });
            if (!engine && p.expiryDate) {
                var exp = p.expiryDate.toDate ? p.expiryDate.toDate() : new Date(p.expiryDate);
                hasExpiringBatch = exp <= thirtyDays && exp > now;
            }
            if (hasExpiringBatch) expiringSoon++;
        });

        return {
            totalProducts: list.length,
            totalValue: totalValue,
            outOfStock: outOfStock,
            lowStock: lowStock,
            expiringSoon: expiringSoon
        };
    };
})();
