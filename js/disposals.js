/**
 * PharmaFlow - Inventory Disposals
 * Automatically quarantines expired batches and records damaged/broken stock.
 */
(function () {
    'use strict';

    window.PharmaFlow = window.PharmaFlow || {};

    let inventoryUnsub = null;
    let disposalsUnsub = null;
    let inventory = [];
    let disposals = [];
    let syncPromise = null;
    let lastSyncAt = 0;

    const Disposals = {
        cleanup: function () {
            if (inventoryUnsub) { inventoryUnsub(); inventoryUnsub = null; }
            if (disposalsUnsub) { disposalsUnsub(); disposalsUnsub = null; }
            inventory = [];
            disposals = [];
        },

        getBusinessId: function () {
            return PharmaFlow.Auth && PharmaFlow.Auth.getBusinessId ? PharmaFlow.Auth.getBusinessId() : null;
        },

        getUserName: function () {
            const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
            return profile ? (profile.displayName || profile.email || 'User') : 'User';
        },

        getUserIdentity: function () {
            const profile = PharmaFlow.Auth ? PharmaFlow.Auth.userProfile : null;
            const authUser = window.auth && window.auth.currentUser ? window.auth.currentUser : null;
            return {
                name: profile?.displayName || authUser?.displayName || profile?.email || authUser?.email || 'User',
                email: profile?.email || authUser?.email || '',
                uid: authUser?.uid || profile?.uid || ''
            };
        },

        escapeHtml: function (value) {
            const el = document.createElement('div');
            el.textContent = value == null ? '' : String(value);
            return el.innerHTML;
        },

        formatDate: function (value) {
            if (!value) return '—';
            const date = value.toDate ? value.toDate() : (value.seconds ? new Date(value.seconds * 1000) : new Date(value));
            if (isNaN(date.getTime())) return '—';
            return date.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
        },

        formatCurrency: function (value) {
            if (PharmaFlow.Settings && PharmaFlow.Settings.formatCurrency) return PharmaFlow.Settings.formatCurrency(value || 0);
            return 'KES ' + (Number(value || 0)).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },

        toDate: function (value) {
            if (!value) return null;
            const date = value.toDate ? value.toDate() : (value.seconds ? new Date(value.seconds * 1000) : new Date(value));
            return isNaN(date.getTime()) ? null : date;
        },

        isExpired: function (value) {
            const date = this.toDate(value);
            return !!date && date.getTime() <= Date.now();
        },

        getBatches: function (product) {
            if (Array.isArray(product && product.stockBatches) && product.stockBatches.length) {
                return product.stockBatches.map(batch => ({
                    ...batch,
                    quantity: Math.max(0, parseInt(batch.quantity, 10) || 0),
                    buyingPrice: parseFloat(batch.buyingPrice) || parseFloat(product.buyingPrice) || 0,
                    sellingPrice: parseFloat(batch.sellingPrice) || parseFloat(product.sellingPrice) || 0
                }));
            }
            if (product && (product.quantity || product.batchNumber || product.expiryDate)) {
                return [{
                    batchNumber: product.batchNumber || '',
                    quantity: Math.max(0, parseInt(product.quantity, 10) || 0),
                    expiryDate: product.expiryDate || null,
                    buyingPrice: parseFloat(product.buyingPrice) || 0,
                    sellingPrice: parseFloat(product.sellingPrice) || 0,
                    minimumSellPrice: parseFloat(product.minimumSellPrice) || parseFloat(product.buyingPrice) || 0,
                    addedAt: product.createdAt || product.updatedAt || null,
                    legacy: true
                }];
            }
            return [];
        },

        batchIdentity: function (batch, index) {
            const raw = [
                batch.batchNumber || 'batch',
                this.toDate(batch.expiryDate)?.getTime() || 'no-expiry',
                batch.addedAt && batch.addedAt.toDate ? batch.addedAt.toDate().getTime() : String(batch.addedAt || ''),
                index
            ].join('|');
            let hash = 5381;
            for (let i = 0; i < raw.length; i++) hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
            return (hash >>> 0).toString(36);
        },

        getPrimaryBatch: function (batches) {
            const available = (batches || [])
                .filter(batch => (parseInt(batch.quantity, 10) || 0) > 0)
                .sort((a, b) => {
                    const da = this.toDate(a.expiryDate);
                    const db = this.toDate(b.expiryDate);
                    return (da ? da.getTime() : Number.POSITIVE_INFINITY) - (db ? db.getTime() : Number.POSITIVE_INFINITY);
                });
            return available[0] || null;
        },

        syncExpiredInventory: function (businessId, options) {
            businessId = businessId || this.getBusinessId();
            if (!businessId || !window.db) return Promise.resolve({ movedBatches: 0, movedUnits: 0 });
            const force = options && options.force;
            if (!force && Date.now() - lastSyncAt < 45000) return syncPromise || Promise.resolve({ movedBatches: 0, movedUnits: 0 });
            if (syncPromise) return syncPromise;

            syncPromise = (async () => {
                lastSyncAt = Date.now();
                const inventoryRef = getBusinessCollection(businessId, 'inventory');
                const disposalRef = getBusinessCollection(businessId, 'disposals');
                const stockHistoryRef = getBusinessCollection(businessId, 'stock_history');
                const snapshot = await inventoryRef.get();
                let movedBatches = 0;
                let movedUnits = 0;

                for (const productDoc of snapshot.docs) {
                    const initial = { id: productDoc.id, ...productDoc.data() };
                    if (!this.getBatches(initial).some(batch => batch.quantity > 0 && this.isExpired(batch.expiryDate))) continue;

                    const result = await window.db.runTransaction(async transaction => {
                        const freshSnap = await transaction.get(inventoryRef.doc(productDoc.id));
                        if (!freshSnap.exists) return { batches: 0, units: 0 };
                        const product = { id: freshSnap.id, ...freshSnap.data() };
                        const batches = this.getBatches(product);
                        const expired = [];
                        const remaining = [];

                        batches.forEach((batch, index) => {
                            if (batch.quantity > 0 && this.isExpired(batch.expiryDate)) {
                                expired.push({ ...batch, _index: index, _key: this.batchIdentity(batch, index) });
                            } else if (batch.quantity > 0) {
                                remaining.push(batch);
                            }
                        });
                        if (!expired.length) return { batches: 0, units: 0 };

                        const disposalDocs = [];
                        for (const batch of expired) {
                            const ref = disposalRef.doc('expired_' + product.id + '_' + batch._key);
                            const existing = await transaction.get(ref);
                            disposalDocs.push({ ref, existing, batch });
                        }

                        const expiredQty = expired.reduce((sum, batch) => sum + batch.quantity, 0);
                        const nextQty = remaining.reduce((sum, batch) => sum + (parseInt(batch.quantity, 10) || 0), 0);
                        const primary = this.getPrimaryBatch(remaining);
                        const now = new Date().toISOString();

                        disposalDocs.forEach(({ ref, existing, batch }) => {
                            if (existing.exists) return;
                            transaction.set(ref, {
                                productId: product.id,
                                productName: product.name || '',
                                sku: product.sku || '',
                                category: product.category || '',
                                drugType: product.drugType || '',
                                batchNumber: batch.batchNumber || '',
                                expiryDate: batch.expiryDate || null,
                                quantity: batch.quantity,
                                buyingPrice: batch.buyingPrice || 0,
                                sellingPrice: batch.sellingPrice || 0,
                                lossValue: (batch.buyingPrice || 0) * batch.quantity,
                                reason: 'expired',
                                source: 'automatic',
                                status: 'pending',
                                detectedAt: now,
                                createdAt: now,
                                recordedBy: 'System expiry monitor'
                            });
                        });

                        transaction.update(freshSnap.ref, {
                            quantity: nextQty,
                            stockBatches: remaining,
                            batchNumber: primary ? (primary.batchNumber || '') : '',
                            expiryDate: primary ? (primary.expiryDate || null) : null,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        transaction.set(stockHistoryRef.doc(), {
                            productId: product.id,
                            productName: product.name || '',
                            sku: product.sku || '',
                            category: product.category || '',
                            type: 'expired_quarantine',
                            previousQty: parseInt(product.quantity, 10) || 0,
                            removedQty: expiredQty,
                            newQty: nextQty,
                            batchNumbers: expired.map(batch => batch.batchNumber || '').filter(Boolean),
                            reason: 'expired',
                            addedBy: 'System expiry monitor',
                            createdAt: now
                        });
                        return { batches: expired.length, units: expiredQty };
                    });
                    movedBatches += result.batches;
                    movedUnits += result.units;
                }
                return { movedBatches, movedUnits };
            })().finally(() => { syncPromise = null; });

            return syncPromise;
        },

        renderOverview: function (container) {
            this.cleanup();
            container.innerHTML = this.shellHtml('Expired & Pending Disposal', 'Automatically quarantined expired batches and unresolved disposal items', `
                <div class="dsp-stats" id="dsp-stats"></div>
                <div class="dsp-toolbar">
                    <div class="dsp-search"><i class="fas fa-search"></i><input id="dsp-search" placeholder="Search product, SKU, batch or reason"></div>
                    <button class="btn btn-outline" id="dsp-sync-expired"><i class="fas fa-arrows-rotate"></i> Scan Inventory</button>
                </div>
                <div class="dsp-card">
                    <div class="dsp-card-head"><div><h3>Pending disposal</h3><small>Stock here is already removed from sellable inventory</small></div></div>
                    <div class="dsp-table-wrap">${this.tableHtml('dsp-pending-body')}</div>
                </div>
                <div id="dsp-modal-root"></div>
            `);
            document.getElementById('dsp-search')?.addEventListener('input', () => this.renderPendingRows());
            document.getElementById('dsp-sync-expired')?.addEventListener('click', () => this.runManualSync());
            this.subscribe(true);
        },

        renderRecord: function (container) {
            this.cleanup();
            container.innerHTML = this.shellHtml('Record Damaged Stock', 'Move broken, contaminated, recalled, or otherwise unusable stock out of inventory', `
                <div class="dsp-entry-layout">
                    <form class="dsp-card dsp-form" id="dsp-damage-form">
                        <div class="dsp-card-head"><div><h3>New disposal entry</h3><small>The selected quantity will be deducted immediately</small></div><span class="dsp-pill">Stock adjustment</span></div>
                        <div class="dsp-form-grid">
                            <label class="dsp-field-full">Search inventory product
                                <div class="dsp-product-picker">
                                    <div class="dsp-product-search">
                                        <span class="dsp-product-search-icon"><i class="fas fa-search"></i></span>
                                        <input id="dsp-product-search" autocomplete="off" placeholder="Search medicine, SKU or batch number">
                                        <span class="dsp-product-search-hint">Type to search</span>
                                    </div>
                                    <input id="dsp-product" type="hidden" required>
                                    <div class="dsp-product-results" id="dsp-product-results"></div>
                                    <div class="dsp-product-selected" id="dsp-product-selected"><i class="fas fa-box-open"></i><span>Search and select an inventory product</span></div>
                                </div>
                            </label>
                            <label class="dsp-field-full">Batch<select id="dsp-batch" required><option value="">Select a product first</option></select></label>
                            <label>Reason<select id="dsp-reason" required><option value="broken">Broken</option><option value="damaged">Damaged</option><option value="contaminated">Contaminated</option><option value="recalled">Recalled</option><option value="spillage">Spillage</option><option value="other">Other</option></select></label>
                            <label>Quantity<input id="dsp-quantity" type="number" min="1" step="1" required></label>
                            <div class="dsp-field-full dsp-quantity-preview" id="dsp-quantity-preview">
                                <div><span>Clean stock now</span><strong>0</strong></div>
                                <i class="fas fa-arrow-right"></i>
                                <div><span>Clean after removal</span><strong>0</strong></div>
                                <div class="is-broken"><span>Broken / quarantined</span><strong>0</strong></div>
                            </div>
                            <label class="dsp-field-full">Notes<textarea id="dsp-notes" rows="4" placeholder="Describe what happened, reference number, witnesses, etc."></textarea></label>
                        </div>
                        <div class="dsp-actions"><button class="btn btn-danger" type="submit"><i class="fas fa-box-archive"></i> Remove from Inventory</button></div>
                    </form>
                    <div class="dsp-card dsp-guide">
                        <i class="fas fa-shield-halved"></i>
                        <h3>Safe disposal workflow</h3>
                        <ol><li>Select the exact product and batch.</li><li>Enter only the unusable quantity.</li><li>The stock is quarantined immediately.</li><li>Complete physical disposal from the pending list.</li></ol>
                    </div>
                </div>
            `);
            document.getElementById('dsp-product-search')?.addEventListener('input', () => this.renderProductSearchResults());
            document.getElementById('dsp-batch')?.addEventListener('change', () => this.updateDamagePreview());
            document.getElementById('dsp-quantity')?.addEventListener('input', () => this.updateDamagePreview());
            document.getElementById('dsp-damage-form')?.addEventListener('submit', event => this.recordDamage(event));
            this.subscribe(false);
        },

        renderHistory: function (container) {
            this.cleanup();
            container.innerHTML = this.shellHtml('Disposal History', 'Completed and pending disposal audit trail', `
                <div class="dsp-toolbar">
                    <div class="dsp-search"><i class="fas fa-search"></i><input id="dsp-history-search" placeholder="Search disposal history"></div>
                    <select id="dsp-history-status"><option value="">All statuses</option><option value="pending">Pending</option><option value="disposed">Disposed</option></select>
                    <select id="dsp-history-reason"><option value="">All reasons</option><option value="expired">Expired</option><option value="broken">Broken</option><option value="damaged">Damaged</option><option value="contaminated">Contaminated</option><option value="recalled">Recalled</option><option value="spillage">Spillage</option><option value="other">Other</option></select>
                </div>
                <div class="dsp-card"><div class="dsp-table-wrap">${this.tableHtml('dsp-history-body')}</div></div>
            `);
            ['dsp-history-search', 'dsp-history-status', 'dsp-history-reason'].forEach(id => {
                document.getElementById(id)?.addEventListener(id.includes('search') ? 'input' : 'change', () => this.renderHistoryRows());
            });
            this.subscribe(false);
        },

        shellHtml: function (title, subtitle, body) {
            return `<div class="dsp-module">
                <div class="page-header"><div><h2><i class="fas fa-trash-can-arrow-up"></i> ${this.escapeHtml(title)}</h2><div class="breadcrumb"><a href="#" data-nav="dashboard">Home</a><span>/</span><span>Disposals</span></div><p class="dsp-subtitle">${this.escapeHtml(subtitle)}</p></div></div>
                ${body}
            </div>`;
        },

        tableHtml: function (bodyId) {
            return `<table class="dsp-table"><thead><tr><th>Product</th><th>Batch</th><th>Reason</th><th>Qty</th><th>Loss value</th><th>Expiry</th><th>Status</th><th>Disposed by</th><th>Action</th></tr></thead><tbody id="${bodyId}"><tr><td colspan="9" class="dsp-empty"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr></tbody></table>`;
        },

        subscribe: function (syncExpired) {
            const businessId = this.getBusinessId();
            if (!businessId) return this.showToast('No business is assigned to this user.', 'error');
            const inventoryRef = getBusinessCollection(businessId, 'inventory');
            const disposalRef = getBusinessCollection(businessId, 'disposals');

            inventoryUnsub = inventoryRef.onSnapshot(snapshot => {
                inventory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                this.populateProductOptions();
                if (syncExpired) {
                    this.syncExpiredInventory(businessId).catch(err => {
                        console.error('Expired stock sync failed:', err);
                        this.showToast('Expired stock scan failed.', 'error');
                    });
                }
            });
            disposalsUnsub = disposalRef.onSnapshot(snapshot => {
                disposals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                    .sort((a, b) => String(b.createdAt || b.detectedAt || '').localeCompare(String(a.createdAt || a.detectedAt || '')));
                this.renderStats();
                this.renderPendingRows();
                this.renderHistoryRows();
                this.renderSelectedProduct();
                this.updateDamagePreview();
            });
        },

        populateProductOptions: function () {
            const hidden = document.getElementById('dsp-product');
            if (!hidden) return;
            if (hidden.value && !inventory.some(product => product.id === hidden.value)) hidden.value = '';
            this.renderProductSearchResults();
            this.renderSelectedProduct();
            this.populateBatchOptions();
        },

        getSearchableProducts: function () {
            return inventory
                .filter(product => this.getBatches(product).some(batch => batch.quantity > 0 && !this.isExpired(batch.expiryDate)))
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        },

        renderProductSearchResults: function () {
            const input = document.getElementById('dsp-product-search');
            const results = document.getElementById('dsp-product-results');
            if (!input || !results) return;
            const query = input.value.trim().toLowerCase();
            if (!query) {
                results.innerHTML = '';
                results.classList.remove('show');
                return;
            }
            const matches = this.getSearchableProducts().filter(product => {
                const batchText = this.getBatches(product).map(batch => batch.batchNumber || '').join(' ');
                return [product.name, product.genericName, product.sku, product.category, product.manufacturer, batchText]
                    .join(' ').toLowerCase().includes(query);
            }).slice(0, 12);
            results.innerHTML = matches.length ? `
                <div class="dsp-product-results-head">
                    <span><i class="fas fa-boxes-stacked"></i> Inventory matches</span>
                    <small>${matches.length} found</small>
                </div>
                ${matches.map(product => {
                const clean = this.getBatches(product)
                    .filter(batch => batch.quantity > 0 && !this.isExpired(batch.expiryDate))
                    .reduce((sum, batch) => sum + batch.quantity, 0);
                const batches = this.getBatches(product).filter(batch => batch.quantity > 0 && !this.isExpired(batch.expiryDate));
                const nextBatch = batches.sort((a, b) => {
                    const da = this.toDate(a.expiryDate);
                    const db = this.toDate(b.expiryDate);
                    return (da ? da.getTime() : Number.POSITIVE_INFINITY) - (db ? db.getTime() : Number.POSITIVE_INFINITY);
                })[0];
                return `<button type="button" data-dsp-product-result="${this.escapeHtml(product.id)}">
                    <span class="dsp-product-result-icon"><i class="fas fa-capsules"></i></span>
                    <span class="dsp-product-result-main">
                        <strong>${this.escapeHtml(product.name || 'Product')}</strong>
                        <small>${this.escapeHtml(product.genericName || product.category || 'Inventory product')}</small>
                        <span class="dsp-product-result-meta">
                            <code>${this.escapeHtml(product.sku || 'No SKU')}</code>
                            ${nextBatch && nextBatch.batchNumber ? `<em>Batch ${this.escapeHtml(nextBatch.batchNumber)}</em>` : ''}
                        </span>
                    </span>
                    <span class="dsp-product-result-stock">
                        <strong>${clean}</strong>
                        <small>clean unit${clean === 1 ? '' : 's'}</small>
                        <i class="fas fa-chevron-right"></i>
                    </span>
                </button>`;
            }).join('')}` : '<div class="dsp-product-no-results"><i class="fas fa-magnifying-glass-minus"></i><strong>No inventory matches</strong><small>Try a product name, SKU, category, or batch number.</small></div>';
            results.classList.add('show');
            results.querySelectorAll('[data-dsp-product-result]').forEach(button => {
                button.addEventListener('click', () => this.selectProduct(button.dataset.dspProductResult));
            });
        },

        selectProduct: function (productId) {
            const hidden = document.getElementById('dsp-product');
            const input = document.getElementById('dsp-product-search');
            const results = document.getElementById('dsp-product-results');
            const product = inventory.find(item => item.id === productId);
            if (!hidden || !product) return;
            hidden.value = productId;
            if (input) input.value = product.name || product.sku || '';
            if (results) { results.innerHTML = ''; results.classList.remove('show'); }
            this.renderSelectedProduct();
            this.populateBatchOptions();
        },

        renderSelectedProduct: function () {
            const productId = document.getElementById('dsp-product')?.value;
            const container = document.getElementById('dsp-product-selected');
            if (!container) return;
            const product = inventory.find(item => item.id === productId);
            if (!product) {
                container.innerHTML = '<i class="fas fa-box-open"></i><span>Search and select an inventory product</span>';
                container.classList.remove('has-product');
                return;
            }
            const clean = this.getBatches(product)
                .filter(batch => batch.quantity > 0 && !this.isExpired(batch.expiryDate))
                .reduce((sum, batch) => sum + batch.quantity, 0);
            const quarantined = disposals
                .filter(item => item.productId === product.id && (item.status || 'pending') === 'pending')
                .reduce((sum, item) => sum + (parseInt(item.quantity, 10) || 0), 0);
            container.innerHTML = `<i class="fas fa-circle-check"></i><span><strong>${this.escapeHtml(product.name || 'Product')}</strong><small>${this.escapeHtml(product.sku || 'No SKU')} · ${clean} clean · ${quarantined} quarantined</small></span>`;
            container.classList.add('has-product');
        },

        populateBatchOptions: function () {
            const productId = document.getElementById('dsp-product')?.value;
            const select = document.getElementById('dsp-batch');
            if (!select) return;
            const product = inventory.find(item => item.id === productId);
            if (!product) {
                select.innerHTML = '<option value="">Select a product first</option>';
                return;
            }
            const batches = this.getBatches(product)
                .map((batch, index) => ({ ...batch, key: this.batchIdentity(batch, index) }))
                .filter(batch => batch.quantity > 0 && !this.isExpired(batch.expiryDate));
            select.innerHTML = '<option value="">Select batch</option>' + batches.map(batch =>
                `<option value="${batch.key}">${this.escapeHtml(batch.batchNumber || 'Unnumbered batch')} — ${batch.quantity} units — expires ${this.formatDate(batch.expiryDate)}</option>`
            ).join('');
            this.updateDamagePreview();
        },

        updateDamagePreview: function () {
            const preview = document.getElementById('dsp-quantity-preview');
            if (!preview) return;
            const productId = document.getElementById('dsp-product')?.value;
            const batchKey = document.getElementById('dsp-batch')?.value;
            const removeQty = Math.max(0, parseInt(document.getElementById('dsp-quantity')?.value, 10) || 0);
            const product = inventory.find(item => item.id === productId);
            const batches = product ? this.getBatches(product) : [];
            const clean = batches.filter(batch => batch.quantity > 0 && !this.isExpired(batch.expiryDate))
                .reduce((sum, batch) => sum + batch.quantity, 0);
            const selectedBatch = batches.find((batch, index) => this.batchIdentity(batch, index) === batchKey);
            const validRemoval = selectedBatch ? Math.min(removeQty, selectedBatch.quantity) : 0;
            const broken = disposals
                .filter(item => item.productId === productId && (item.status || 'pending') === 'pending')
                .reduce((sum, item) => sum + (parseInt(item.quantity, 10) || 0), 0);
            const values = preview.querySelectorAll('strong');
            if (values[0]) values[0].textContent = clean;
            if (values[1]) values[1].textContent = Math.max(0, clean - validRemoval);
            if (values[2]) values[2].textContent = broken + validRemoval;
            const quantityInput = document.getElementById('dsp-quantity');
            if (quantityInput) quantityInput.max = selectedBatch ? selectedBatch.quantity : '';
        },

        recordDamage: async function (event) {
            event.preventDefault();
            const businessId = this.getBusinessId();
            const productId = document.getElementById('dsp-product')?.value;
            const batchKey = document.getElementById('dsp-batch')?.value;
            const reason = document.getElementById('dsp-reason')?.value || 'damaged';
            const quantity = Math.max(0, parseInt(document.getElementById('dsp-quantity')?.value, 10) || 0);
            const notes = (document.getElementById('dsp-notes')?.value || '').trim();
            if (!businessId || !productId || !batchKey || quantity < 1) return this.showToast('Select a product, batch, and quantity.', 'error');

            const button = event.target.querySelector('button[type="submit"]');
            if (button) { button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Recording...'; }
            try {
                const inventoryRef = getBusinessCollection(businessId, 'inventory').doc(productId);
                const disposalRef = getBusinessCollection(businessId, 'disposals').doc();
                const stockHistoryRef = getBusinessCollection(businessId, 'stock_history').doc();
                const user = this.getUserName();

                await window.db.runTransaction(async transaction => {
                    const snapshot = await transaction.get(inventoryRef);
                    if (!snapshot.exists) throw new Error('Product no longer exists.');
                    const product = { id: snapshot.id, ...snapshot.data() };
                    const batches = this.getBatches(product);
                    const index = batches.findIndex((batch, i) => this.batchIdentity(batch, i) === batchKey);
                    if (index < 0) throw new Error('The selected batch has changed. Please select it again.');
                    const batch = batches[index];
                    if (this.isExpired(batch.expiryDate)) throw new Error('This batch has expired and is being moved automatically.');
                    if (quantity > batch.quantity) throw new Error('Only ' + batch.quantity + ' units are available in this batch.');

                    batches[index] = { ...batch, quantity: batch.quantity - quantity };
                    const remaining = batches.filter(item => item.quantity > 0);
                    const nextQty = remaining.reduce((sum, item) => sum + item.quantity, 0);
                    const primary = this.getPrimaryBatch(remaining);
                    const now = new Date().toISOString();

                    transaction.update(inventoryRef, {
                        quantity: nextQty,
                        stockBatches: remaining,
                        batchNumber: primary ? (primary.batchNumber || '') : '',
                        expiryDate: primary ? (primary.expiryDate || null) : null,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    transaction.set(disposalRef, {
                        productId: product.id,
                        productName: product.name || '',
                        sku: product.sku || '',
                        category: product.category || '',
                        drugType: product.drugType || '',
                        batchNumber: batch.batchNumber || '',
                        expiryDate: batch.expiryDate || null,
                        quantity,
                        buyingPrice: batch.buyingPrice || 0,
                        sellingPrice: batch.sellingPrice || 0,
                        lossValue: (batch.buyingPrice || 0) * quantity,
                        reason,
                        notes,
                        source: 'manual',
                        status: 'pending',
                        createdAt: now,
                        recordedBy: user
                    });
                    transaction.set(stockHistoryRef, {
                        productId: product.id,
                        productName: product.name || '',
                        sku: product.sku || '',
                        category: product.category || '',
                        type: 'disposal_quarantine',
                        previousQty: parseInt(product.quantity, 10) || 0,
                        removedQty: quantity,
                        newQty: nextQty,
                        batchNumber: batch.batchNumber || '',
                        reason,
                        notes,
                        addedBy: user,
                        createdAt: now
                    });
                });

                if (PharmaFlow.ActivityLog) {
                    PharmaFlow.ActivityLog.log({
                        title: 'Stock Quarantined',
                        description: quantity + ' unit(s) moved to disposal as ' + reason,
                        category: 'Inventory',
                        status: 'WARNING',
                        metadata: { productId, quantity, reason }
                    });
                }
                event.target.reset();
                const hidden = document.getElementById('dsp-product');
                if (hidden) hidden.value = '';
                this.renderSelectedProduct();
                this.populateProductOptions();
                this.updateDamagePreview();
                this.showToast('Stock removed from inventory and added to pending disposal.');
            } catch (err) {
                this.showToast(err.message || 'Failed to record disposal.', 'error');
            } finally {
                if (button) { button.disabled = false; button.innerHTML = '<i class="fas fa-box-archive"></i> Remove from Inventory'; }
            }
        },

        renderStats: function () {
            const container = document.getElementById('dsp-stats');
            if (!container) return;
            const pending = disposals.filter(item => item.status !== 'disposed');
            const expired = pending.filter(item => item.reason === 'expired');
            const units = pending.reduce((sum, item) => sum + (parseInt(item.quantity, 10) || 0), 0);
            const loss = pending.reduce((sum, item) => sum + (parseFloat(item.lossValue) || 0), 0);
            container.innerHTML = `
                ${this.statHtml('fa-hourglass-half', pending.length, 'Pending records', 'amber')}
                ${this.statHtml('fa-calendar-xmark', expired.length, 'Expired batches', 'red')}
                ${this.statHtml('fa-boxes-stacked', units, 'Quarantined units', 'blue')}
                ${this.statHtml('fa-money-bill-trend-up', this.formatCurrency(loss), 'Estimated loss', 'slate')}
            `;
        },

        statHtml: function (icon, value, label, tone) {
            return `<div class="dsp-stat dsp-stat--${tone}"><i class="fas ${icon}"></i><div><strong>${this.escapeHtml(value)}</strong><span>${this.escapeHtml(label)}</span></div></div>`;
        },

        filteredRows: function (pendingOnly) {
            const searchId = pendingOnly ? 'dsp-search' : 'dsp-history-search';
            const query = (document.getElementById(searchId)?.value || '').trim().toLowerCase();
            const status = pendingOnly ? 'pending' : (document.getElementById('dsp-history-status')?.value || '');
            const reason = pendingOnly ? '' : (document.getElementById('dsp-history-reason')?.value || '');
            return disposals.filter(item => {
                const itemStatus = item.status || 'pending';
                if (status && itemStatus !== status) return false;
                if (reason && item.reason !== reason) return false;
                if (query && ![item.productName, item.sku, item.batchNumber, item.reason, item.notes, item.recordedBy, item.disposedBy, item.disposedByEmail].join(' ').toLowerCase().includes(query)) return false;
                return true;
            });
        },

        renderPendingRows: function () {
            this.renderRows('dsp-pending-body', this.filteredRows(true), true);
        },

        renderHistoryRows: function () {
            this.renderRows('dsp-history-body', this.filteredRows(false), false);
        },

        renderRows: function (bodyId, rows, pendingView) {
            const body = document.getElementById(bodyId);
            if (!body) return;
            if (!rows.length) {
                body.innerHTML = '<tr><td colspan="9" class="dsp-empty"><i class="fas fa-circle-check"></i> No disposal records found</td></tr>';
                return;
            }
            body.innerHTML = rows.map(item => {
                const status = item.status || 'pending';
                return `<tr>
                    <td><strong>${this.escapeHtml(item.productName || 'Product')}</strong><small>${this.escapeHtml(item.sku || '')}</small></td>
                    <td><code>${this.escapeHtml(item.batchNumber || '—')}</code></td>
                    <td><span class="dsp-reason dsp-reason--${this.escapeHtml(item.reason || 'other')}">${this.escapeHtml((item.reason || 'other').replace(/_/g, ' '))}</span></td>
                    <td><strong>${parseInt(item.quantity, 10) || 0}</strong></td>
                    <td>${this.formatCurrency(item.lossValue || 0)}</td>
                    <td>${this.formatDate(item.expiryDate)}</td>
                    <td><span class="dsp-status dsp-status--${status}">${this.escapeHtml(status)}</span></td>
                    <td>${status === 'disposed' ? `<span class="dsp-disposed-by"><i class="fas fa-user-check"></i><span><strong>${this.escapeHtml(item.disposedBy || 'User')}</strong>${item.disposedByEmail ? `<small>${this.escapeHtml(item.disposedByEmail)}</small>` : ''}</span></span>` : '<span class="dsp-not-disposed">—</span>'}</td>
                    <td>${status !== 'disposed' ? `<button class="btn btn-sm btn-primary" data-dsp-finalize="${this.escapeHtml(item.id)}"><i class="fas fa-check"></i> Complete</button>` : `<small>${this.formatDate(item.disposedAt)}</small>`}</td>
                </tr>`;
            }).join('');
            body.querySelectorAll('[data-dsp-finalize]').forEach(button => {
                button.addEventListener('click', () => this.openFinalizeModal(button.dataset.dspFinalize));
            });
        },

        openFinalizeModal: function (id) {
            const item = disposals.find(entry => entry.id === id);
            if (!item) return;
            const quantity = parseInt(item.quantity, 10) || 0;
            const reason = (item.reason || 'other').replace(/_/g, ' ');
            const today = new Date().toISOString().split('T')[0];
            const disposer = this.getUserIdentity();
            let root = document.getElementById('dsp-modal-root');
            if (!root) {
                root = document.createElement('div');
                root.id = 'dsp-modal-root';
                document.body.appendChild(root);
            }

            root.innerHTML = `<div class="dsp-modal show" role="dialog" aria-modal="true" aria-labelledby="dsp-finalize-title">
                <div class="dsp-modal-card dsp-finalize-modal">
                    <div class="dsp-finalize-head">
                        <div class="dsp-finalize-head__icon"><i class="fas fa-shield-halved"></i></div>
                        <div class="dsp-finalize-head__copy">
                            <span class="dsp-finalize-eyebrow">Final disposal record</span>
                            <h3 id="dsp-finalize-title">Complete physical disposal</h3>
                            <p>Confirm how this quarantined stock was safely disposed.</p>
                        </div>
                        <button type="button" class="dsp-modal-close" id="dsp-modal-close" aria-label="Close completion modal">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <div class="dsp-finalize-body">
                        <section class="dsp-finalize-summary" aria-label="Disposal summary">
                            <div class="dsp-finalize-product">
                                <span class="dsp-finalize-product__icon"><i class="fas fa-capsules"></i></span>
                                <div>
                                    <strong>${this.escapeHtml(item.productName || 'Product')}</strong>
                                    <small>${this.escapeHtml(item.sku || 'No SKU')} &middot; Batch ${this.escapeHtml(item.batchNumber || 'Not recorded')}</small>
                                </div>
                                <span class="dsp-reason dsp-reason--${this.escapeHtml(item.reason || 'other')}">${this.escapeHtml(reason)}</span>
                            </div>
                            <div class="dsp-finalize-facts">
                                <div><span>Quantity</span><strong>${quantity} unit${quantity === 1 ? '' : 's'}</strong></div>
                                <div><span>Estimated loss</span><strong>${this.formatCurrency(item.lossValue || 0)}</strong></div>
                                <div><span>Expiry date</span><strong>${this.formatDate(item.expiryDate)}</strong></div>
                                <div><span>Disposed by</span><strong title="${this.escapeHtml(disposer.email)}">${this.escapeHtml(disposer.name)}</strong></div>
                            </div>
                        </section>

                        <div class="dsp-finalize-notice">
                            <i class="fas fa-circle-info"></i>
                            <p><strong>This action closes the record.</strong> It remains available in disposal history for audit and compliance review.</p>
                        </div>

                        <div class="dsp-finalize-form">
                            <label>
                                <span><i class="fas fa-truck-ramp-box"></i> Disposal method</span>
                                <select id="dsp-method">
                                    <option value="licensed_collector">Licensed waste collector</option>
                                    <option value="supplier_return">Returned to supplier</option>
                                    <option value="incineration">Incineration</option>
                                    <option value="destruction">Controlled destruction</option>
                                    <option value="other">Other</option>
                                </select>
                            </label>
                            <label>
                                <span><i class="fas fa-calendar-check"></i> Disposal date</span>
                                <input id="dsp-date" type="date" value="${today}" max="${today}">
                            </label>
                            <label class="dsp-field-full">
                                <span><i class="fas fa-file-signature"></i> Completion notes <em>Optional</em></span>
                                <textarea id="dsp-final-notes" rows="4" placeholder="Add certificate number, collector details, witnesses, or other supporting information"></textarea>
                                <small>Include any reference details that may be useful during an audit.</small>
                            </label>
                        </div>
                    </div>

                    <div class="dsp-finalize-actions">
                        <button type="button" class="btn btn-outline" id="dsp-modal-cancel">Keep Pending</button>
                        <button type="button" class="btn btn-primary dsp-finalize-confirm" id="dsp-modal-confirm">
                            <i class="fas fa-check-circle"></i>
                            <span><strong>Mark as Disposed</strong><small>Complete this disposal record</small></span>
                        </button>
                    </div>
                </div>
            </div>`;

            const handleKeydown = event => {
                if (event.key === 'Escape') close();
            };
            const close = () => {
                document.removeEventListener('keydown', handleKeydown);
                root.innerHTML = '';
            };

            document.addEventListener('keydown', handleKeydown);
            document.getElementById('dsp-modal-close')?.addEventListener('click', close);
            document.getElementById('dsp-modal-cancel')?.addEventListener('click', close);
            document.getElementById('dsp-modal-confirm')?.addEventListener('click', () => this.finalizeDisposal(id, close));
            root.querySelector('.dsp-modal')?.addEventListener('click', event => {
                if (event.target.classList.contains('dsp-modal')) close();
            });
            document.getElementById('dsp-method')?.focus();
        },

        finalizeDisposal: async function (id, close) {
            const businessId = this.getBusinessId();
            const disposer = this.getUserIdentity();
            const button = document.getElementById('dsp-modal-confirm');
            if (button) { button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
            try {
                await getBusinessCollection(businessId, 'disposals').doc(id).update({
                    status: 'disposed',
                    disposalMethod: document.getElementById('dsp-method')?.value || 'other',
                    disposalDate: document.getElementById('dsp-date')?.value || '',
                    disposalNotes: (document.getElementById('dsp-final-notes')?.value || '').trim(),
                    disposedBy: disposer.name,
                    disposedByEmail: disposer.email,
                    disposedByUid: disposer.uid,
                    disposedAt: new Date().toISOString(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                close();
                this.showToast('Disposal completed and retained in the audit history.');
            } catch (err) {
                this.showToast('Failed to complete disposal: ' + (err.message || err), 'error');
                if (button) {
                    button.disabled = false;
                    button.innerHTML = '<i class="fas fa-check-circle"></i><span><strong>Mark as Disposed</strong><small>Complete this disposal record</small></span>';
                }
            }
        },

        runManualSync: async function () {
            const button = document.getElementById('dsp-sync-expired');
            if (button) { button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning...'; }
            try {
                const result = await this.syncExpiredInventory(this.getBusinessId(), { force: true });
                this.showToast(result.movedBatches ? ('Moved ' + result.movedUnits + ' expired unit(s) from ' + result.movedBatches + ' batch(es).') : 'No new expired batches found.');
            } catch (err) {
                this.showToast('Expired stock scan failed: ' + (err.message || err), 'error');
            } finally {
                if (button) { button.disabled = false; button.innerHTML = '<i class="fas fa-arrows-rotate"></i> Scan Inventory'; }
            }
        },

        showToast: function (message, type) {
            const old = document.querySelector('.dsp-toast');
            if (old) old.remove();
            const toast = document.createElement('div');
            toast.className = 'dsp-toast' + (type === 'error' ? ' dsp-toast--error' : '');
            toast.innerHTML = '<i class="fas ' + (type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check') + '"></i> ' + this.escapeHtml(message);
            document.body.appendChild(toast);
            setTimeout(() => toast.classList.add('show'), 10);
            setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 250); }, 3500);
        }
    };

    window.PharmaFlow.Disposals = Disposals;
})();
