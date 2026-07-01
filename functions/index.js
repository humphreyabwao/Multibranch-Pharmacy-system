"use strict";

const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");

admin.initializeApp();

const SUPABASE_SERVICE_ROLE_KEY = defineSecret("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_URL = defineString("SUPABASE_URL");

const ALLOWED_COLLECTIONS = new Set([
  "inventory",
  "sales",
  "stock_history",
  "orders",
  "wholesale_orders",
  "dda_register",
  "expenses",
  "hr_payroll",
  "hr_advances",
  "patient_bills",
  "patient_records",
  "disposals"
]);

const ALLOWED_OPERATIONS = new Set(["add", "set", "update", "delete"]);

function sendJson(res, status, body) {
  res.status(status).set("Cache-Control", "no-store").json(body);
}

function getSupabaseRestBase() {
  const raw = (SUPABASE_URL.value() || "").trim();
  if (!raw) throw new Error("SUPABASE_URL is not configured");
  return raw.replace(/\/+$/, "").replace(/\/rest\/v1$/, "") + "/rest/v1";
}

function assertSafeId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function sanitizeWrite(write) {
  if (!write || typeof write !== "object") throw new Error("Invalid write");
  assertSafeId(write.businessId, "businessId");
  assertSafeId(write.collectionName, "collectionName");
  if (!ALLOWED_COLLECTIONS.has(write.collectionName)) throw new Error("Collection is not fallback-enabled");
  if (!ALLOWED_OPERATIONS.has(write.operation)) throw new Error("Unsupported operation");
  if (write.docId !== null && write.docId !== undefined) assertSafeId(String(write.docId), "docId");

  return {
    business_id: write.businessId,
    collection_name: write.collectionName,
    document_id: write.docId ? String(write.docId) : null,
    source_path: typeof write.sourcePath === "string" ? write.sourcePath.slice(0, 600) : null,
    operation: write.operation,
    merge_write: !!write.merge,
    payload: write.data === undefined ? null : write.data,
    firebase_error: write.firebaseError || null,
    sync_status: "pending_firebase",
    client_created_at: write.clientCreatedAt || null
  };
}

async function verifyUser(req, businessIds) {
  const authHeader = req.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Missing Firebase auth token");
  const decoded = await admin.auth().verifyIdToken(match[1]);
  const profileSnap = await admin.firestore().collection("users").doc(decoded.uid).get();
  if (!profileSnap.exists) throw new Error("User profile not found");

  const profile = profileSnap.data() || {};
  const isSuperadmin = profile.role === "superadmin" || decoded.email === "admin@pharmaflow.com";
  if (!isSuperadmin) {
    const userBusinessId = profile.businessId || profile.business || null;
    businessIds.forEach((businessId) => {
      if (businessId !== userBusinessId) throw new Error("Business access denied");
    });
  }

  return {
    uid: decoded.uid,
    email: decoded.email || null,
    role: profile.role || null,
    businessId: profile.businessId || null,
    isSuperadmin
  };
}

async function insertFallbackRows(rows, actor) {
  const now = new Date().toISOString();
  const payload = rows.map((row) => ({
    ...row,
    actor_uid: actor.uid,
    actor_email: actor.email,
    actor_role: actor.role,
    received_at: now,
    updated_at: now
  }));

  const response = await fetch(`${getSupabaseRestBase()}/fallback_records`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY.value()}`,
      "apikey": SUPABASE_SERVICE_ROLE_KEY.value(),
      "Prefer": "return=representation"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase write failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function readFallbackRows(businessId, collectionName) {
  const params = new URLSearchParams({
    business_id: `eq.${businessId}`,
    collection_name: `eq.${collectionName}`,
    sync_status: "eq.pending_firebase",
    order: "received_at.asc",
    limit: "500"
  });

  const response = await fetch(`${getSupabaseRestBase()}/fallback_records?${params.toString()}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY.value()}`,
      "apikey": SUPABASE_SERVICE_ROLE_KEY.value(),
      "Cache-Control": "no-store"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase read failed: ${response.status} ${text}`);
  }

  return response.json();
}

exports.supabaseFallbackWrite = onRequest(
  {
    region: "us-central1",
    secrets: [SUPABASE_SERVICE_ROLE_KEY],
    cors: false,
    timeoutSeconds: 30,
    maxInstances: 20
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
      const body = req.body || {};
      const writes = body.mode === "batch" ? body.writes : [body.write];
      if (!Array.isArray(writes) || !writes.length || writes.length > 250) {
        return sendJson(res, 400, { error: "Invalid fallback write payload" });
      }

      const rows = writes.map(sanitizeWrite);
      const businessIds = new Set(rows.map((row) => row.business_id));
      const actor = await verifyUser(req, businessIds);
      const inserted = await insertFallbackRows(rows, actor);
      sendJson(res, 200, { ok: true, count: rows.length, inserted });
    } catch (error) {
      console.error("supabaseFallbackWrite failed", error);
      sendJson(res, 400, { error: error.message || "Fallback write failed" });
    }
  }
);

exports.supabaseFallbackRead = onRequest(
  {
    region: "us-central1",
    secrets: [SUPABASE_SERVICE_ROLE_KEY],
    cors: false,
    timeoutSeconds: 30,
    maxInstances: 20
  },
  async (req, res) => {
    try {
      if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
      const businessId = String(req.query.businessId || "");
      const collectionName = String(req.query.collectionName || "");
      assertSafeId(businessId, "businessId");
      assertSafeId(collectionName, "collectionName");
      if (!ALLOWED_COLLECTIONS.has(collectionName)) {
        return sendJson(res, 400, { error: "Collection is not fallback-enabled" });
      }

      await verifyUser(req, new Set([businessId]));
      const rows = await readFallbackRows(businessId, collectionName);
      sendJson(res, 200, { ok: true, rows });
    } catch (error) {
      console.error("supabaseFallbackRead failed", error);
      sendJson(res, 400, { error: error.message || "Fallback read failed" });
    }
  }
);
