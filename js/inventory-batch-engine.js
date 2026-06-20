/**
 * PharmaFlow canonical inventory batch engine.
 *
 * Rules:
 * - FEFO first (earliest expiry), FIFO as the tie-breaker (oldest received).
 * - Expired batches are never sellable.
 * - Every consumption returns exact batch allocations and a reconciled quantity.
 * - This file is intentionally pure so the same scenarios can be tested in Node.
 */
(function (root, factory) {
    const engine = factory();
    if (typeof module === 'object' && module.exports) module.exports = engine;
    root.PharmaFlow = root.PharmaFlow || {};
    root.PharmaFlow.InventoryBatchEngine = engine;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function integer(value) {
        return Math.max(0, Math.trunc(Number(value) || 0));
    }

    function money(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : (Number(fallback) || 0);
    }

    function dateValue(value, fallback) {
        if (!value) return fallback;
        const date = value.toDate ? value.toDate() : new Date(value);
        const time = date && !Number.isNaN(date.getTime()) ? date.getTime() : fallback;
        return time;
    }

    function expiryCutoff(value, fallback) {
        if (!value) return fallback;
        const date = value.toDate ? value.toDate() : new Date(value);
        if (!date || Number.isNaN(date.getTime())) return fallback;
        date.setHours(23, 59, 59, 999);
        return date.getTime();
    }

    function isExpired(value, now) {
        if (!value) return false;
        return expiryCutoff(value, Number.POSITIVE_INFINITY) < (now == null ? Date.now() : now);
    }

    function compareFefoFifo(a, b) {
        const expiryDiff = dateValue(a.expiryDate, Number.POSITIVE_INFINITY)
            - dateValue(b.expiryDate, Number.POSITIVE_INFINITY);
        if (expiryDiff) return expiryDiff;
        const receivedDiff = dateValue(a.addedAt, 0) - dateValue(b.addedAt, 0);
        if (receivedDiff) return receivedDiff;
        return String(a.batchNumber || '').localeCompare(String(b.batchNumber || ''));
    }

    function normalize(product) {
        product = product || {};
        const productQty = integer(product.quantity);
        const buyingPrice = money(product.buyingPrice);
        const sellingPrice = money(product.sellingPrice);
        const minimumSellPrice = money(product.minimumSellPrice, buyingPrice);
        let batches = Array.isArray(product.stockBatches)
            ? product.stockBatches.map(function (batch) {
                return {
                    ...batch,
                    batchNumber: String(batch.batchNumber || product.batchNumber || product.sku || ''),
                    quantity: integer(batch.quantity),
                    buyingPrice: money(batch.buyingPrice, buyingPrice),
                    sellingPrice: money(batch.sellingPrice, sellingPrice),
                    minimumSellPrice: money(batch.minimumSellPrice, minimumSellPrice)
                };
            }).filter(function (batch) { return batch.quantity > 0; })
            : [];

        if (!batches.length && productQty > 0) {
            batches = [{
                batchNumber: String(product.batchNumber || product.sku || ''),
                quantity: productQty,
                expiryDate: product.expiryDate || null,
                buyingPrice: buyingPrice,
                sellingPrice: sellingPrice,
                minimumSellPrice: minimumSellPrice,
                addedAt: product.createdAt || product.updatedAt || null,
                legacy: true
            }];
        }
        return batches.sort(compareFefoFifo);
    }

    function quantityOf(batches) {
        return (batches || []).reduce(function (sum, batch) {
            return sum + integer(batch.quantity);
        }, 0);
    }

    function canonicalBatches(product) {
        const storedLimit = integer(product && product.quantity);
        if (!storedLimit) return [];
        let remaining = storedLimit;
        const canonical = [];
        normalize(product).forEach(function (batch) {
            if (remaining <= 0) return;
            const quantity = Math.min(integer(batch.quantity), remaining);
            if (quantity > 0) canonical.push({ ...batch, quantity: quantity });
            remaining -= quantity;
        });
        return canonical;
    }

    function sellableBatches(product, now) {
        return canonicalBatches(product).filter(function (batch) {
            return batch.quantity > 0 && !isExpired(batch.expiryDate, now);
        });
    }

    function sellableQuantity(product, now) {
        return quantityOf(sellableBatches(product, now));
    }

    function primaryBatch(batches, now) {
        const available = (batches || []).filter(function (batch) {
            return integer(batch.quantity) > 0 && !isExpired(batch.expiryDate, now);
        }).sort(compareFefoFifo);
        return available[0] || null;
    }

    function consume(product, requestedQty, now) {
        const requested = integer(requestedQty);
        if (requested < 1) throw new Error('Quantity must be at least 1.');

        const batches = canonicalBatches(product);
        const available = batches.filter(function (batch) {
            return !isExpired(batch.expiryDate, now);
        }).sort(compareFefoFifo);
        const quantityBefore = quantityOf(available);
        if (quantityOf(available) < requested) {
            throw new Error('Only ' + quantityOf(available) + ' sellable unit(s) available for ' + (product.name || 'this product') + '.');
        }

        let remaining = requested;
        const allocations = [];
        available.forEach(function (availableBatch) {
            if (remaining <= 0) return;
            const used = Math.min(integer(availableBatch.quantity), remaining);
            if (!used) return;
            const sourceBatch = batches.find(function (batch) {
                return String(batch.batchNumber || '') === String(availableBatch.batchNumber || '')
                    && dateValue(batch.expiryDate, null) === dateValue(availableBatch.expiryDate, null)
                    && dateValue(batch.addedAt, null) === dateValue(availableBatch.addedAt, null)
                    && integer(batch.quantity) >= used;
            });
            if (!sourceBatch) throw new Error('Batch allocation changed. Refresh and retry.');
            sourceBatch.quantity -= used;
            remaining -= used;
            allocations.push({
                batchNumber: sourceBatch.batchNumber || '',
                quantity: used,
                expiryDate: sourceBatch.expiryDate || null,
                buyingPrice: money(sourceBatch.buyingPrice),
                sellingPrice: money(sourceBatch.sellingPrice),
                minimumSellPrice: money(sourceBatch.minimumSellPrice, sourceBatch.buyingPrice),
                addedAt: sourceBatch.addedAt || null
            });
        });

        const updatedBatches = batches.filter(function (batch) {
            return integer(batch.quantity) > 0;
        }).sort(compareFefoFifo);
        const primary = primaryBatch(updatedBatches, now);
        return {
            allocations: allocations,
            updatedBatches: updatedBatches,
            quantityBefore: quantityBefore,
            quantityAfter: quantityOf(updatedBatches),
            sellableAfter: Math.max(0, quantityBefore - requested),
            primaryBatch: primary
        };
    }

    function appendBatch(product, batch) {
        const batches = normalize(product);
        const normalized = {
            ...batch,
            batchNumber: String(batch.batchNumber || product.sku || ''),
            quantity: integer(batch.quantity),
            buyingPrice: money(batch.buyingPrice, product.buyingPrice),
            sellingPrice: money(batch.sellingPrice, product.sellingPrice),
            minimumSellPrice: money(batch.minimumSellPrice, batch.buyingPrice || product.buyingPrice),
            addedAt: batch.addedAt || new Date().toISOString()
        };
        if (!normalized.batchNumber) throw new Error('Batch number is required.');
        if (normalized.quantity < 1) throw new Error('Batch quantity must be at least 1.');
        if (isExpired(normalized.expiryDate)) throw new Error('Cannot add a batch that has already expired.');
        const expiry = dateValue(normalized.expiryDate, null);
        const matching = batches.find(function (existing) {
            return String(existing.batchNumber || '') === normalized.batchNumber
                && dateValue(existing.expiryDate, null) === expiry
                && money(existing.buyingPrice) === normalized.buyingPrice
                && money(existing.sellingPrice) === normalized.sellingPrice;
        });
        if (matching) {
            matching.quantity = integer(matching.quantity) + normalized.quantity;
            matching.minimumSellPrice = normalized.minimumSellPrice;
        } else {
            batches.push(normalized);
        }
        batches.sort(compareFefoFifo);
        return {
            updatedBatches: batches,
            quantityAfter: quantityOf(batches),
            primaryBatch: primaryBatch(batches)
        };
    }

    function restore(product, allocations, metadata) {
        const batches = normalize(product);
        (allocations || []).forEach(function (allocation) {
            const qty = integer(allocation.quantity);
            if (!qty) return;
            const batchNumber = String(allocation.batchNumber || product.batchNumber || product.sku || '');
            const expiryMs = dateValue(allocation.expiryDate, null);
            const existing = batches.find(function (batch) {
                return String(batch.batchNumber || '') === batchNumber
                    && dateValue(batch.expiryDate, null) === expiryMs;
            });
            if (existing) {
                existing.quantity = integer(existing.quantity) + qty;
            } else {
                batches.push({
                    batchNumber: batchNumber,
                    quantity: qty,
                    expiryDate: allocation.expiryDate || null,
                    buyingPrice: money(allocation.buyingPrice, product.buyingPrice),
                    sellingPrice: money(allocation.sellingPrice, product.sellingPrice),
                    minimumSellPrice: money(allocation.minimumSellPrice, allocation.buyingPrice || product.buyingPrice),
                    addedAt: allocation.addedAt || new Date().toISOString(),
                    source: metadata && metadata.source ? metadata.source : 'stock_restore',
                    sourceId: metadata && metadata.sourceId ? metadata.sourceId : ''
                });
            }
        });
        batches.sort(compareFefoFifo);
        return {
            updatedBatches: batches,
            quantityAfter: quantityOf(batches),
            primaryBatch: primaryBatch(batches)
        };
    }

    function inspect(product, now) {
        const batches = normalize(product);
        const batchQuantity = quantityOf(batches);
        const storedQuantity = integer(product && product.quantity);
        const sellable = batches.filter(function (batch) {
            return !isExpired(batch.expiryDate, now);
        }).reduce(function (sum, batch) { return sum + integer(batch.quantity); }, 0);
        const expired = batchQuantity - sellable;
        const duplicateBatchNumbers = [];
        const seen = {};
        batches.forEach(function (batch) {
            const key = String(batch.batchNumber || '').trim();
            if (!key) return;
            if (seen[key]) duplicateBatchNumbers.push(key);
            seen[key] = true;
        });
        return {
            storedQuantity: storedQuantity,
            batchQuantity: batchQuantity,
            sellableQuantity: sellable,
            expiredQuantity: expired,
            quantityMismatch: storedQuantity !== batchQuantity,
            duplicateBatchNumbers: Array.from(new Set(duplicateBatchNumbers)),
            batches: batches
        };
    }

    function reconcileHistory(entries, currentQty) {
        const history = (entries || []).map(function (entry) {
            return { ...entry };
        }).sort(function (a, b) {
            const timeDiff = dateValue(a.createdAt || a.updatedAt, 0) - dateValue(b.createdAt || b.updatedAt, 0);
            return timeDiff || String(a.id || '').localeCompare(String(b.id || ''));
        });

        if (!history.length) {
            const current = integer(currentQty);
            return {
                openingQty: current,
                expectedQty: current,
                ledgerBreaks: 0,
                source: 'current baseline'
            };
        }

        const first = history[0];
        const firstPrevious = Number(first.previousQty);
        const firstNext = Number(first.newQty);
        const firstAdded = integer(first._addedQty != null ? first._addedQty : first.addedQty);
        const firstRemoved = integer(first._removedQty != null ? first._removedQty : first.removedQty);
        let openingQty = Number.isFinite(firstPrevious)
            ? integer(firstPrevious)
            : (Number.isFinite(firstNext) ? Math.max(0, integer(firstNext) - firstAdded + firstRemoved) : 0);
        let runningQty = openingQty;
        let ledgerBreaks = 0;

        history.forEach(function (entry) {
            const previous = Number(entry.previousQty);
            const next = Number(entry.newQty);
            const hasPrevious = Number.isFinite(previous);
            const hasNext = Number.isFinite(next);
            if (hasPrevious && integer(previous) !== runningQty) {
                ledgerBreaks++;
                runningQty = integer(previous);
            }
            if (hasNext) {
                runningQty = integer(next);
            } else {
                const added = integer(entry._addedQty != null ? entry._addedQty : entry.addedQty);
                const removed = integer(entry._removedQty != null ? entry._removedQty : entry.removedQty);
                runningQty = Math.max(0, runningQty + added - removed);
            }
        });

        return {
            openingQty: openingQty,
            expectedQty: runningQty,
            ledgerBreaks: ledgerBreaks,
            source: 'movement ledger'
        };
    }

    return {
        integer: integer,
        expiryCutoff: expiryCutoff,
        isExpired: isExpired,
        compareFefoFifo: compareFefoFifo,
        normalize: normalize,
        canonicalBatches: canonicalBatches,
        quantityOf: quantityOf,
        sellableBatches: sellableBatches,
        sellableQuantity: sellableQuantity,
        primaryBatch: primaryBatch,
        consume: consume,
        appendBatch: appendBatch,
        restore: restore,
        inspect: inspect,
        reconcileHistory: reconcileHistory
    };
});
