/**
 * Canonical inventory KPI math — loaded before dashboard.js & inventory.js.
 * Dashboard and Inventory UI both use this so totals never drift between screens.
 */
(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    /**
     * @param {Array<{ quantity?: number, sellingPrice?: number, reorderLevel?: number, expiryDate?: * }>} products
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

        list.forEach(function (p) {
            var qty = p.quantity || 0;
            var price = p.sellingPrice || 0;
            var reorderLevel = p.reorderLevel || 10;

            totalValue += qty * price;

            if (qty <= 0) outOfStock++;
            else if (qty <= reorderLevel) lowStock++;

            if (p.expiryDate) {
                var exp = p.expiryDate.toDate ? p.expiryDate.toDate() : new Date(p.expiryDate);
                if (exp <= thirtyDays && exp > now) expiringSoon++;
            }
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
