/**
 * PharmaFlow secure fallback database bridge.
 *
 * This file intentionally contains no Supabase URL or API key. The browser
 * sends authenticated fallback write requests to Firebase Functions, and the
 * server-side function writes to Supabase with private credentials.
 */
(function () {
    'use strict';

    var PharmaFlow = window.PharmaFlow = window.PharmaFlow || {};
    var HEAVY_COLLECTIONS = {
        inventory: true,
        sales: true,
        stock_history: true,
        orders: true,
        wholesale_orders: true,
        dda_register: true,
        expenses: true,
        hr_payroll: true,
        hr_advances: true,
        patient_bills: true,
        patient_records: true,
        disposals: true
    };

    var FALLBACKABLE_CODES = {
        'resource-exhausted': true,
        'deadline-exceeded': true,
        'unavailable': true,
        'aborted': true,
        'internal': true,
        'unknown': true
    };

    function isEnabledCollection(collectionName) {
        return !!HEAVY_COLLECTIONS[collectionName];
    }

    function isFallbackableError(error) {
        if (!error) return false;
        var code = String(error.code || '').toLowerCase();
        var message = String(error.message || '').toLowerCase();
        return !!FALLBACKABLE_CODES[code] ||
            message.indexOf('quota') !== -1 ||
            message.indexOf('resource exhausted') !== -1 ||
            message.indexOf('deadline') !== -1 ||
            message.indexOf('unavailable') !== -1 ||
            message.indexOf('network') !== -1 ||
            message.indexOf('failed to fetch') !== -1;
    }

    function pathParts(refOrPath) {
        var path = typeof refOrPath === 'string' ? refOrPath : (refOrPath && refOrPath.path) || '';
        var parts = path.split('/').filter(Boolean);
        if (parts[0] !== 'businesses' || !parts[1] || !parts[2]) return null;
        return {
            path: path,
            businessId: parts[1],
            collection: parts[2],
            docId: parts[3] || null
        };
    }

    function normalize(value, seen) {
        if (value === undefined) return null;
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
        if (value instanceof Date) {
            return { __type: 'date', value: value.toISOString() };
        }
        if (value && typeof value.toDate === 'function') {
            try {
                return { __type: 'firestore_timestamp', value: value.toDate().toISOString() };
            } catch (e) {
                return { __type: 'firestore_timestamp', value: String(value) };
            }
        }
        if (value && value.constructor && /FieldValue/i.test(value.constructor.name || '')) {
            return { __type: 'firestore_field_value', value: String(value) };
        }
        if (Array.isArray(value)) {
            return value.map(function (item) { return normalize(item, seen); });
        }
        if (typeof value === 'object') {
            seen = seen || [];
            if (seen.indexOf(value) !== -1) return '[Circular]';
            seen.push(value);
            var output = {};
            Object.keys(value).forEach(function (key) {
                output[key] = normalize(value[key], seen.slice());
            });
            return output;
        }
        return String(value);
    }

    async function getAuthToken() {
        if (!window.auth || !window.auth.currentUser) {
            throw new Error('Fallback write blocked: authenticated user is required');
        }
        return window.auth.currentUser.getIdToken();
    }

    async function postFallback(payload) {
        var token = await getAuthToken();
        var response = await fetch('/api/fallback/write', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            var text = await response.text().catch(function () { return ''; });
            throw new Error('Supabase fallback rejected write: ' + response.status + ' ' + text);
        }
        return response.json().catch(function () { return { ok: true }; });
    }

    async function readFallbackRows(businessId, collectionName) {
        var token = await getAuthToken();
        var url = '/api/fallback/read?businessId=' + encodeURIComponent(businessId) +
            '&collectionName=' + encodeURIComponent(collectionName);
        var response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!response.ok) return [];
        var data = await response.json().catch(function () { return null; });
        return data && Array.isArray(data.rows) ? data.rows : [];
    }

    function showQuietStatus() {
        try {
            if (window.PharmaFlow && PharmaFlow.App && typeof PharmaFlow.App.showToast === 'function') {
                PharmaFlow.App.showToast('Saved securely. Syncing to primary database when available.', 'info');
            }
        } catch (e) { /* quiet fallback */ }
    }

    async function writeFallback(operation) {
        var meta = pathParts(operation.path);
        if (!meta || !isEnabledCollection(meta.collection)) throw operation.error || new Error('Unsupported fallback collection');
        var payload = {
            businessId: meta.businessId,
            collectionName: meta.collection,
            docId: operation.docId || meta.docId,
            sourcePath: meta.path,
            operation: operation.operation,
            merge: !!operation.merge,
            data: normalize(operation.data || null),
            firebaseError: operation.error ? {
                code: operation.error.code || null,
                message: operation.error.message || String(operation.error)
            } : null,
            clientCreatedAt: new Date().toISOString()
        };
        await postFallback({ mode: 'single', write: payload });
        cacheFallbackRow({
            business_id: payload.businessId,
            collection_name: payload.collectionName,
            document_id: payload.docId,
            operation: payload.operation,
            merge_write: payload.merge,
            payload: payload.data,
            sync_status: 'pending_firebase',
            received_at: new Date().toISOString()
        });
        showQuietStatus();
        return { fallback: true, payload: payload };
    }

    async function writeFallbackBatch(records, error) {
        var writes = records.map(function (record) {
            var meta = pathParts(record.path);
            if (!meta || !isEnabledCollection(meta.collection)) return null;
            return {
                businessId: meta.businessId,
                collectionName: meta.collection,
                docId: record.docId || meta.docId,
                sourcePath: meta.path,
                operation: record.operation,
                merge: !!record.merge,
                data: normalize(record.data || null),
                firebaseError: error ? { code: error.code || null, message: error.message || String(error) } : null,
                clientCreatedAt: new Date().toISOString()
            };
        }).filter(Boolean);
        if (!writes.length) throw error || new Error('No supported fallback writes in batch');
        await postFallback({ mode: 'batch', writes: writes });
        writes.forEach(function (payload) {
            cacheFallbackRow({
                business_id: payload.businessId,
                collection_name: payload.collectionName,
                document_id: payload.docId,
                operation: payload.operation,
                merge_write: payload.merge,
                payload: payload.data,
                sync_status: 'pending_firebase',
                received_at: new Date().toISOString()
            });
        });
        showQuietStatus();
        return { fallback: true, count: writes.length };
    }

    var fallbackCache = {};

    function cacheKey(businessId, collectionName) {
        return businessId + '/' + collectionName;
    }

    function cacheFallbackRow(row) {
        if (!row || !row.business_id || !row.collection_name) return;
        var key = cacheKey(row.business_id, row.collection_name);
        fallbackCache[key] = fallbackCache[key] || [];
        fallbackCache[key].push(row);
    }

    function revive(value) {
        if (!value || typeof value !== 'object') return value;
        if (value.__type === 'date' || value.__type === 'firestore_timestamp') {
            var date = new Date(value.value);
            return isNaN(date.getTime()) ? value.value : date;
        }
        if (value.__type === 'firestore_field_value') return null;
        if (Array.isArray(value)) return value.map(revive);
        var output = {};
        Object.keys(value).forEach(function (key) { output[key] = revive(value[key]); });
        return output;
    }

    function fallbackDoc(row) {
        var docId = row.document_id || row.id || ('fallback_' + Math.random().toString(36).slice(2));
        var payload = revive(row.payload || {});
        if (payload && typeof payload === 'object') {
            payload.id = payload.id || docId;
            payload.docId = payload.docId || docId;
            payload._fallbackProvider = 'supabase';
            payload._syncStatus = row.sync_status || 'pending_firebase';
        }
        return {
            id: docId,
            ref: { id: docId, path: row.source_path || '', __fallback: true },
            exists: row.operation !== 'delete',
            metadata: { fromCache: false, hasPendingWrites: true },
            data: function () { return payload; }
        };
    }

    function mergeSnapshots(firebaseSnapshot, rows) {
        var docsById = {};
        var docs = [];
        if (firebaseSnapshot && firebaseSnapshot.docs) {
            firebaseSnapshot.docs.forEach(function (doc) {
                docsById[doc.id] = doc;
                docs.push(doc);
            });
        }
        rows.forEach(function (row) {
            var id = row.document_id || row.id;
            if (!id) return;
            if (row.operation === 'delete') {
                if (docsById[id]) {
                    docs = docs.filter(function (doc) { return doc.id !== id; });
                    delete docsById[id];
                }
                return;
            }
            var doc = fallbackDoc(row);
            if (docsById[id]) {
                docs = docs.map(function (existing) { return existing.id === id ? doc : existing; });
            } else {
                docs.push(doc);
            }
            docsById[id] = doc;
        });
        return {
            docs: docs,
            empty: docs.length === 0,
            size: docs.length,
            metadata: firebaseSnapshot ? firebaseSnapshot.metadata : { fromCache: false, hasPendingWrites: false },
            forEach: function (callback) { docs.forEach(callback); },
            docChanges: function () { return firebaseSnapshot && firebaseSnapshot.docChanges ? firebaseSnapshot.docChanges() : []; }
        };
    }

    async function getMergedSnapshot(realQuery, businessId, collectionName) {
        var firebaseSnapshot = await realQuery.get();
        var key = cacheKey(businessId, collectionName);
        var remoteRows = await readFallbackRows(businessId, collectionName).catch(function () { return []; });
        fallbackCache[key] = remoteRows.concat(fallbackCache[key] || []);
        return mergeSnapshots(firebaseSnapshot, fallbackCache[key]);
    }

    function wrapQueryRef(realQuery, businessId, collectionName) {
        if (!realQuery || !isEnabledCollection(collectionName)) return realQuery;
        return new Proxy(realQuery, {
            get: function (target, prop) {
                if (prop === 'get') {
                    return function () { return getMergedSnapshot(target, businessId, collectionName); };
                }
                if (prop === 'onSnapshot') {
                    return function (success, failure) {
                        var latestFirebaseSnapshot = null;
                        var stopped = false;
                        var deliver = async function () {
                            if (stopped || typeof success !== 'function') return;
                            var key = cacheKey(businessId, collectionName);
                            var remoteRows = await readFallbackRows(businessId, collectionName).catch(function () { return []; });
                            fallbackCache[key] = remoteRows.concat(fallbackCache[key] || []);
                            success(mergeSnapshots(latestFirebaseSnapshot, fallbackCache[key]));
                        };
                        var unsubscribe = target.onSnapshot(function (snapshot) {
                            latestFirebaseSnapshot = snapshot;
                            deliver();
                        }, failure);
                        var timer = setInterval(deliver, 15000);
                        deliver();
                        return function () {
                            stopped = true;
                            clearInterval(timer);
                            if (typeof unsubscribe === 'function') unsubscribe();
                        };
                    };
                }
                var queryMethods = { where: true, orderBy: true, limit: true, startAfter: true, startAt: true, endBefore: true, endAt: true };
                if (queryMethods[prop]) {
                    return function () {
                        return wrapQueryRef(target[prop].apply(target, arguments), businessId, collectionName);
                    };
                }
                var value = target[prop];
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
    }

    function wrapDocRef(realRef, collectionName) {
        if (!realRef || !isEnabledCollection(collectionName)) return realRef;
        return new Proxy(realRef, {
            get: function (target, prop) {
                if (prop === 'set') {
                    return async function (data, options) {
            try {
                            return await target.set(data, options);
            } catch (error) {
                if (!isFallbackableError(error)) throw error;
                return writeFallback({
                                path: target.path,
                                docId: target.id,
                    operation: 'set',
                    merge: !!(options && options.merge),
                    data: data,
                    error: error
                });
            }
                    };
                }
                if (prop === 'update') {
                    return async function (data) {
            try {
                            return await target.update.apply(target, arguments);
            } catch (error) {
                if (!isFallbackableError(error)) throw error;
                return writeFallback({
                                path: target.path,
                                docId: target.id,
                    operation: 'update',
                    data: data,
                    error: error
                });
            }
                    };
                }
                if (prop === 'delete') {
                    return async function () {
            try {
                            return await target.delete();
            } catch (error) {
                if (!isFallbackableError(error)) throw error;
                return writeFallback({
                                path: target.path,
                                docId: target.id,
                    operation: 'delete',
                    data: null,
                    error: error
                });
            }
                    };
                }
                var value = target[prop];
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
    }

    function wrapCollectionRef(realCollection, businessId, collectionName) {
        if (!realCollection || !isEnabledCollection(collectionName)) return realCollection;
        return new Proxy(wrapQueryRef(realCollection, businessId, collectionName), {
            get: function (target, prop) {
                if (prop === 'doc') {
                    return function (docId) {
                        return wrapDocRef(docId ? target.doc(docId) : target.doc(), collectionName);
                    };
                }
                if (prop === 'add') {
                    return async function (data) {
                        var ref = target.doc();
            try {
                await ref.set(data);
                return ref;
            } catch (error) {
                if (!isFallbackableError(error)) throw error;
                await writeFallback({
                    path: ref.path,
                    docId: ref.id,
                    operation: 'add',
                    data: data,
                    error: error
                });
                return ref;
            }
                    };
                }
                if (prop === '__fallbackWrapped') return true;
                if (prop === '__businessId') return businessId;
                if (prop === '__collectionName') return collectionName;
                var queryMethods = { where: true, orderBy: true, limit: true, startAfter: true, startAt: true, endBefore: true, endAt: true };
                if (queryMethods[prop]) {
                    return function () {
                        return wrapQueryRef(target[prop].apply(target, arguments), businessId, collectionName);
                    };
                }
                var value = target[prop];
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
    }

    function installDbGuards() {
        if (!window.db || window.db.__supabaseFallbackGuarded) return;

        var originalBatch = window.db.batch.bind(window.db);
        window.db.batch = function () {
            var realBatch = originalBatch();
            var records = [];
            return {
                set: function (ref, data, options) {
                    records.push({ operation: 'set', path: ref.path, docId: ref.id, data: data, merge: !!(options && options.merge) });
                    realBatch.set(ref, data, options);
                    return this;
                },
                update: function (ref, data) {
                    records.push({ operation: 'update', path: ref.path, docId: ref.id, data: data });
                    realBatch.update.apply(realBatch, arguments);
                    return this;
                },
                delete: function (ref) {
                    records.push({ operation: 'delete', path: ref.path, docId: ref.id, data: null });
                    realBatch.delete(ref);
                    return this;
                },
                commit: async function () {
                    try {
                        return await realBatch.commit();
                    } catch (error) {
                        if (!isFallbackableError(error)) throw error;
                        return writeFallbackBatch(records, error);
                    }
                }
            };
        };

        var originalRunTransaction = window.db.runTransaction.bind(window.db);
        window.db.runTransaction = async function (updateFunction) {
            try {
                return await originalRunTransaction(updateFunction);
            } catch (error) {
                if (!isFallbackableError(error)) throw error;
                var records = [];
                var recorder = {
                    get: function (ref) { return ref.get(); },
                    set: function (ref, data, options) {
                        records.push({ operation: 'set', path: ref.path, docId: ref.id, data: data, merge: !!(options && options.merge) });
                        return recorder;
                    },
                    update: function (ref, data) {
                        records.push({ operation: 'update', path: ref.path, docId: ref.id, data: data });
                        return recorder;
                    },
                    delete: function (ref) {
                        records.push({ operation: 'delete', path: ref.path, docId: ref.id, data: null });
                        return recorder;
                    }
                };
                var result = await updateFunction(recorder);
                await writeFallbackBatch(records, error);
                return result;
            }
        };

        window.db.__supabaseFallbackGuarded = true;
    }

    PharmaFlow.SupabaseFallback = {
        isEnabledCollection: isEnabledCollection,
        isFallbackableError: isFallbackableError,
        wrapCollectionRef: wrapCollectionRef,
        wrapDocRef: wrapDocRef,
        installDbGuards: installDbGuards,
        writeFallback: writeFallback,
        writeFallbackBatch: writeFallbackBatch
    };

    window.addEventListener('firebase-ready', installDbGuards);
})();
