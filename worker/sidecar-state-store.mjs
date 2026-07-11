const SCHEMA = "photosbyelie.sidecarDecision.v1";
const VALID_COLORS = new Set(["", "red", "yellow", "green", "blue", "purple"]);
const VALID_PICK_STATES = new Set(["undecided", "picked", "rejected", "hidden"]);
const VALID_METADATA_STATES = new Set(["unreviewed", "proposed", "approved", "rework", "blocked"]);

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

const defaultNow = () => new Date();
const defaultRandomUUID = () => crypto.randomUUID();

const cleanAssetId = (value) => String(value || "").trim().slice(0, 512);
const cleanText = (value, limit = 4000) => String(value || "").trim().slice(0, limit);
const cleanTimestamp = (value, fallback = "") => cleanText(value, 80) || fallback;

const uniqueCleanAssetIds = (values) => [...new Set((Array.isArray(values) ? values : [])
  .map(cleanAssetId)
  .filter(Boolean))]
  .slice(0, 1000);

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const cleanKeywords = (value) => {
  const source = Array.isArray(value) ? value : parseJsonArray(value);
  return [...new Set(source
    .map((item) => cleanText(item, 120))
    .filter(Boolean))]
    .slice(0, 80);
};

const integerIn = (value, allowed, fallback) => {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return allowed.has(number) ? number : fallback;
};

const normalizeColor = (value, fallback = "") => {
  const color = cleanText(value, 24).toLowerCase();
  return VALID_COLORS.has(color) ? color : fallback;
};

const normalizePickState = (value, fallback = "undecided") => {
  const state = cleanText(value, 24).toLowerCase();
  return VALID_PICK_STATES.has(state) ? state : fallback;
};

const normalizeMetadataState = (value, fallback = "unreviewed") => {
  const state = cleanText(value, 24).toLowerCase();
  return VALID_METADATA_STATES.has(state) ? state : fallback;
};

const defaultDecision = (assetId = "") => ({
  schema: SCHEMA,
  assetId,
  rating: 0,
  color: "",
  pickState: "undecided",
  metadataState: "unreviewed",
  title: "",
  keywords: [],
  reworkCategory: "",
  reworkComment: "",
  metadataAiRung: "",
  metadataAiEvidence: [],
  metadataAiNote: "",
  tombstoneState: "",
  tombstoneReason: "",
  tombstonedAt: "",
  pendingSyncCount: 0,
  lastAction: "",
  updatedAt: "",
});

const normalizeDecision = (payload = {}, current = null, timestamp = "") => {
  const source = payload.state && typeof payload.state === "object"
    ? payload.state
    : (payload.decision && typeof payload.decision === "object" ? payload.decision : payload);
  const assetId = cleanAssetId(payload.assetId || payload.asset_id || source.assetId || source.asset_id || current?.assetId);
  if (!assetId) {
    throw Object.assign(new Error("assetId is required."), { status: 400, code: "sidecar_asset_id_required" });
  }
  const base = current ? defaultDecision(assetId) : defaultDecision(assetId);
  const fallback = current ? { ...base, ...current, assetId } : base;
  return {
    ...fallback,
    schema: SCHEMA,
    assetId,
    rating: integerIn(source.rating ?? source.value ?? fallback.rating, new Set([0, 1, 2, 3, 4, 5]), fallback.rating),
    color: normalizeColor(source.color ?? fallback.color, fallback.color),
    pickState: normalizePickState(source.pickState ?? source.pick_state ?? fallback.pickState, fallback.pickState),
    metadataState: normalizeMetadataState(source.metadataState ?? source.metadata_state ?? fallback.metadataState, fallback.metadataState),
    title: cleanText(source.title ?? fallback.title, 500),
    keywords: cleanKeywords(source.keywords ?? source.keywords_json ?? fallback.keywords),
    reworkCategory: cleanText(source.reworkCategory ?? source.rework_category ?? fallback.reworkCategory, 120),
    reworkComment: cleanText(source.reworkComment ?? source.rework_comment ?? fallback.reworkComment, 2000),
    metadataAiRung: cleanText(source.metadataAiRung ?? source.metadata_ai_rung ?? fallback.metadataAiRung, 120),
    metadataAiEvidence: cleanKeywords(source.metadataAiEvidence ?? source.metadata_ai_evidence ?? fallback.metadataAiEvidence),
    metadataAiNote: cleanText(source.metadataAiNote ?? source.metadata_ai_note ?? fallback.metadataAiNote, 2000),
    tombstoneState: cleanText(source.tombstoneState ?? source.tombstone_state ?? fallback.tombstoneState, 32).toLowerCase(),
    tombstoneReason: cleanText(source.tombstoneReason ?? source.tombstone_reason ?? fallback.tombstoneReason, 500),
    tombstonedAt: cleanTimestamp(source.tombstonedAt ?? source.tombstoned_at ?? fallback.tombstonedAt),
    pendingSyncCount: Math.max(0, Number(source.pendingSyncCount ?? source.pending_sync_count ?? fallback.pendingSyncCount) || 0),
    lastAction: cleanText(source.lastAction ?? source.last_action ?? fallback.lastAction, 80),
    updatedAt: cleanTimestamp(source.updatedAt ?? source.updated_at, timestamp || fallback.updatedAt),
  };
};

const metadataValuesFromPayload = (payload, fallback) => ({
  title: Object.hasOwn(payload, "title") ? cleanText(payload.title, 500) : fallback.title,
  keywords: Object.hasOwn(payload, "keywords") ? cleanKeywords(payload.keywords) : cleanKeywords(fallback.keywords),
});

const applyDecisionAction = (current, payload = {}, timestamp = "") => {
  const assetId = cleanAssetId(payload.assetId || payload.asset_id || payload.localIdentifier || current?.assetId);
  if (!assetId) {
    throw Object.assign(new Error("assetId is required."), { status: 400, code: "sidecar_asset_id_required" });
  }
  const action = cleanText(payload.action || payload.decision, 80).toLowerCase();
  const before = normalizeDecision({ assetId, state: current || {} }, null, timestamp);
  const after = { ...before, keywords: cleanKeywords(before.keywords), metadataAiEvidence: cleanKeywords(before.metadataAiEvidence) };
  const changedFamilies = new Set();

  if (action === "rating") {
    after.rating = integerIn(payload.rating ?? payload.value, new Set([0, 1, 2, 3, 4, 5]), -1);
    if (after.rating < 0) throw Object.assign(new Error("rating must be between 0 and 5."), { status: 400, code: "invalid_sidecar_rating" });
    changedFamilies.add("rating");
  } else if (action === "color") {
    after.color = normalizeColor(payload.color ?? payload.value, "__invalid__");
    if (after.color === "__invalid__") throw Object.assign(new Error("color must be red, yellow, green, blue, purple, or blank."), { status: 400, code: "invalid_sidecar_color" });
    changedFamilies.add("color");
  } else if (action === "pick") {
    after.pickState = "picked";
    changedFamilies.add("pick_state");
  } else if (action === "unpick") {
    after.pickState = "undecided";
    changedFamilies.add("pick_state");
  } else if (action === "restore") {
    after.pickState = "undecided";
    if (after.metadataState === "blocked") {
      after.metadataState = "unreviewed";
      changedFamilies.add("metadata");
    }
    if (after.tombstoneState === "active") {
      after.tombstoneState = "restored";
      changedFamilies.add("tombstone");
    }
    changedFamilies.add("pick_state");
  } else if (action === "reject") {
    after.pickState = "rejected";
    changedFamilies.add("pick_state");
  } else if (action === "hide") {
    after.pickState = "hidden";
    changedFamilies.add("pick_state");
  } else if (action === "tombstone") {
    after.pickState = "rejected";
    after.metadataState = "blocked";
    after.reworkCategory = "";
    after.reworkComment = "";
    after.metadataAiRung = "";
    after.metadataAiEvidence = [];
    after.metadataAiNote = "";
    after.tombstoneState = "active";
    after.tombstoneReason = cleanText(payload.reason, 500);
    after.tombstonedAt = timestamp;
    changedFamilies.add("metadata");
    changedFamilies.add("pick_state");
    changedFamilies.add("tombstone");
  } else if (action === "approve") {
    const metadata = metadataValuesFromPayload(payload, after);
    after.pickState = "picked";
    after.metadataState = "approved";
    after.title = metadata.title;
    after.keywords = metadata.keywords;
    after.reworkCategory = "";
    after.reworkComment = "";
    after.metadataAiRung = cleanText(payload.metadataAiRung ?? payload.metadata_ai_rung ?? after.metadataAiRung, 120);
    after.metadataAiEvidence = cleanKeywords(payload.metadataAiEvidence ?? payload.metadata_ai_evidence ?? after.metadataAiEvidence);
    after.metadataAiNote = cleanText(payload.metadataAiNote ?? payload.metadata_ai_note ?? after.metadataAiNote, 2000);
    changedFamilies.add("metadata");
    changedFamilies.add("pick_state");
  } else if (action === "metadata") {
    const metadata = metadataValuesFromPayload(payload, after);
    after.title = metadata.title;
    after.keywords = metadata.keywords;
    after.metadataState = normalizeMetadataState(payload.metadataState ?? payload.metadata_state ?? "proposed", "__invalid__");
    if (after.metadataState === "__invalid__") throw Object.assign(new Error("metadataState is invalid."), { status: 400, code: "invalid_sidecar_metadata_state" });
    after.metadataAiRung = cleanText(payload.metadataAiRung ?? payload.metadata_ai_rung ?? after.metadataAiRung, 120);
    after.metadataAiEvidence = cleanKeywords(payload.metadataAiEvidence ?? payload.metadata_ai_evidence ?? after.metadataAiEvidence);
    after.metadataAiNote = cleanText(payload.metadataAiNote ?? payload.metadata_ai_note ?? after.metadataAiNote, 2000);
    if (after.metadataState === "rework") {
      after.reworkCategory = cleanText(payload.reworkCategory ?? payload.rework_category, 120);
      after.reworkComment = cleanText(payload.reworkComment ?? payload.rework_comment, 2000);
      after.metadataAiRung = "";
      after.metadataAiEvidence = [];
      after.metadataAiNote = "";
    } else if (after.metadataState !== "blocked") {
      after.reworkCategory = "";
      after.reworkComment = "";
    }
    changedFamilies.add("metadata");
  } else if (action === "metadata-rework") {
    const metadata = metadataValuesFromPayload(payload, after);
    after.title = metadata.title;
    after.keywords = metadata.keywords;
    after.metadataState = "rework";
    after.reworkCategory = cleanText(payload.reworkCategory ?? payload.rework_category, 120);
    after.reworkComment = cleanText(payload.reworkComment ?? payload.rework_comment, 2000);
    if (after.reworkComment && !after.reworkCategory) after.reworkCategory = "other";
    after.metadataAiRung = "";
    after.metadataAiEvidence = [];
    after.metadataAiNote = "";
    changedFamilies.add("metadata");
  } else {
    throw Object.assign(new Error("Unsupported Sidecar action."), { status: 400, code: "unsupported_sidecar_action" });
  }

  after.lastAction = action;
  after.updatedAt = timestamp;
  return {
    assetId,
    before,
    state: normalizeDecision({ assetId, state: after }, null, timestamp),
    changedFamilies: [...changedFamilies].sort(),
  };
};

const rowToDecision = (row = {}) => normalizeDecision({
  assetId: row.asset_id,
  rating: row.rating,
  color: row.color,
  pickState: row.pick_state,
  metadataState: row.metadata_state,
  title: row.title,
  keywords: parseJsonArray(row.keywords_json),
  reworkCategory: row.rework_category,
  reworkComment: row.rework_comment,
  metadataAiRung: row.metadata_ai_rung,
  metadataAiEvidence: parseJsonArray(row.metadata_ai_evidence_json),
  metadataAiNote: row.metadata_ai_note,
  tombstoneState: row.tombstone_state,
  tombstoneReason: row.tombstone_reason,
  tombstonedAt: row.tombstoned_at,
  pendingSyncCount: row.pending_sync_count,
  lastAction: row.last_action,
  updatedAt: row.updated_at,
}, null, row.updated_at || "");

const DECISION_UPSERT_SQL = `
  INSERT INTO pbe_sidecar_decisions (
    asset_id, rating, color, pick_state, metadata_state, title, keywords_json,
    rework_category, rework_comment, metadata_ai_rung, metadata_ai_evidence_json, metadata_ai_note,
    tombstone_state, tombstone_reason, tombstoned_at, pending_sync_count,
    last_action, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(asset_id) DO UPDATE SET
    rating = excluded.rating,
    color = excluded.color,
    pick_state = excluded.pick_state,
    metadata_state = excluded.metadata_state,
    title = excluded.title,
    keywords_json = excluded.keywords_json,
    rework_category = excluded.rework_category,
    rework_comment = excluded.rework_comment,
    metadata_ai_rung = excluded.metadata_ai_rung,
    metadata_ai_evidence_json = excluded.metadata_ai_evidence_json,
    metadata_ai_note = excluded.metadata_ai_note,
    tombstone_state = excluded.tombstone_state,
    tombstone_reason = excluded.tombstone_reason,
    tombstoned_at = excluded.tombstoned_at,
    pending_sync_count = excluded.pending_sync_count,
    last_action = excluded.last_action,
    updated_at = excluded.updated_at
`;

const bindDecision = (statement, decision, createdAt = "") => statement.bind(
  decision.assetId,
  decision.rating,
  decision.color,
  decision.pickState,
  decision.metadataState,
  decision.title,
  JSON.stringify(decision.keywords || []),
  decision.reworkCategory,
  decision.reworkComment,
  decision.metadataAiRung,
  JSON.stringify(decision.metadataAiEvidence || []),
  decision.metadataAiNote,
  decision.tombstoneState,
  decision.tombstoneReason,
  decision.tombstonedAt,
  decision.pendingSyncCount,
  decision.lastAction,
  createdAt || decision.updatedAt,
  decision.updatedAt
);

const d1All = async (statement) => {
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
};

const d1First = async (statement) => {
  if (typeof statement.first === "function") return statement.first();
  const rows = await d1All(statement);
  return rows[0] || null;
};

const actorForEvent = (context = {}) => ({
  actorKind: cleanText(context.actorKind || context.kind || "", 40),
  actorId: cleanText(context.actorId || context.id || context.email || "", 200),
});

export const createMemorySidecarStateStore = ({
  now = defaultNow,
  randomUUID = defaultRandomUUID,
} = {}) => {
  const decisions = new Map();
  const events = [];

  const getDecision = async (assetId) => clone(decisions.get(cleanAssetId(assetId))) || null;
  const putDecision = async (payload, context = {}) => {
    const timestamp = cleanTimestamp(context.timestamp, now().toISOString());
    const assetId = cleanAssetId(payload.assetId || payload.asset_id || payload.state?.assetId || payload.state?.asset_id);
    const current = assetId ? decisions.get(assetId) : null;
    const decision = normalizeDecision(payload, current, timestamp);
    decisions.set(decision.assetId, clone(decision));
    return clone(decision);
  };
  const queryDecisions = async ({ assetIds = [] } = {}) => {
    const rows = {};
    for (const assetId of uniqueCleanAssetIds(assetIds)) {
      const decision = await getDecision(assetId);
      if (decision) rows[assetId] = decision;
    }
    return rows;
  };
  const putDecisions = async (payloads = [], context = {}) => {
    const items = [];
    for (const payload of payloads) {
      items.push(await putDecision(payload, context));
    }
    return items;
  };
  const applyDecision = async (payload, context = {}) => {
    const timestamp = cleanTimestamp(context.timestamp, now().toISOString());
    const current = await getDecision(payload.assetId || payload.asset_id || payload.localIdentifier);
    const result = applyDecisionAction(current, payload, timestamp);
    const decision = await putDecision({ assetId: result.assetId, state: result.state }, context);
    const actor = actorForEvent(context);
    events.unshift({
      id: `sidecar-event-${randomUUID().replace(/[^a-z0-9-]/gi, "").slice(0, 48)}`,
      assetId: result.assetId,
      action: decision.lastAction,
      changedFamilies: result.changedFamilies,
      actorKind: actor.actorKind,
      actorId: actor.actorId,
      before: result.before,
      after: decision,
      createdAt: timestamp,
    });
    return { ...result, state: decision };
  };
  const applyDecisions = async (payloads = [], context = {}) => {
    const items = [];
    for (const payload of payloads) items.push(await applyDecision(payload, context));
    return items;
  };

  return {
    getDecision,
    queryDecisions,
    putDecision,
    putDecisions,
    applyDecision,
    applyDecisions,
    _debug: { decisions, events },
  };
};

export const createD1SidecarStateStore = ({
  database,
  now = defaultNow,
  randomUUID = defaultRandomUUID,
} = {}) => {
  if (!database) throw new Error("createD1SidecarStateStore requires a D1 database binding.");

  const getDecision = async (assetId) => {
    const clean = cleanAssetId(assetId);
    if (!clean) return null;
    const row = await d1First(database.prepare("SELECT * FROM pbe_sidecar_decisions WHERE asset_id = ?").bind(clean));
    return row ? rowToDecision(row) : null;
  };

  const putDecision = async (payload, context = {}) => {
    const timestamp = cleanTimestamp(context.timestamp, now().toISOString());
    const assetId = cleanAssetId(payload.assetId || payload.asset_id || payload.state?.assetId || payload.state?.asset_id);
    const current = assetId ? await getDecision(assetId) : null;
    const decision = normalizeDecision(payload, current, timestamp);
    await bindDecision(database.prepare(DECISION_UPSERT_SQL), decision, current?.createdAt || timestamp).run();
    return decision;
  };

  const queryDecisions = async ({ assetIds = [] } = {}) => {
    const rowsByAssetId = {};
    const cleanIds = uniqueCleanAssetIds(assetIds);
    for (let start = 0; start < cleanIds.length; start += 400) {
      const chunk = cleanIds.slice(start, start + 400);
      if (!chunk.length) continue;
      const placeholders = chunk.map(() => "?").join(",");
      const rows = await d1All(database.prepare(`
        SELECT * FROM pbe_sidecar_decisions
        WHERE asset_id IN (${placeholders})
      `).bind(...chunk));
      for (const row of rows) {
        const decision = rowToDecision(row);
        rowsByAssetId[decision.assetId] = decision;
      }
    }
    return rowsByAssetId;
  };

  const putDecisions = async (payloads = [], context = {}) => {
    const timestamp = cleanTimestamp(context.timestamp, now().toISOString());
    const items = payloads.map((payload) => normalizeDecision(payload, null, timestamp));
    if (!items.length) return [];
    if (typeof database.batch !== "function") {
      const fallback = [];
      for (const item of items) {
        fallback.push(await putDecision(item, context));
      }
      return fallback;
    }
    for (let start = 0; start < items.length; start += 100) {
      const chunk = items.slice(start, start + 100);
      await database.batch(chunk.map((decision) => (
        bindDecision(database.prepare(DECISION_UPSERT_SQL), decision, decision.updatedAt || timestamp)
      )));
    }
    return items;
  };

  const applyDecision = async (payload, context = {}) => {
    const timestamp = cleanTimestamp(context.timestamp, now().toISOString());
    const current = await getDecision(payload.assetId || payload.asset_id || payload.localIdentifier);
    const result = applyDecisionAction(current, payload, timestamp);
    const decision = await putDecision({ assetId: result.assetId, state: result.state }, { ...context, timestamp });
    const actor = actorForEvent(context);
    await database.prepare(`
      INSERT INTO pbe_sidecar_decision_events (
        id, asset_id, action, changed_families_json, actor_kind, actor_id, before_json, after_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `sidecar-event-${randomUUID().replace(/[^a-z0-9-]/gi, "").slice(0, 48)}`,
      result.assetId,
      decision.lastAction,
      JSON.stringify(result.changedFamilies),
      actor.actorKind,
      actor.actorId,
      JSON.stringify(result.before),
      JSON.stringify(decision),
      timestamp
    ).run();
    return { ...result, state: decision };
  };
  const applyDecisions = async (payloads = [], context = {}) => {
    const cleanPayloads = (Array.isArray(payloads) ? payloads : []).filter((payload) => payload && typeof payload === "object");
    if (!cleanPayloads.length) return [];
    if (typeof database.batch !== "function") {
      const fallback = [];
      for (const payload of cleanPayloads) fallback.push(await applyDecision(payload, context));
      return fallback;
    }

    const timestamp = cleanTimestamp(context.timestamp, now().toISOString());
    const assetIds = cleanPayloads.map((payload) => payload.assetId || payload.asset_id || payload.localIdentifier);
    const currentByAssetId = new Map(Object.entries(await queryDecisions({ assetIds })));
    const actor = actorForEvent(context);
    const results = [];
    for (const payload of cleanPayloads) {
      const assetId = cleanAssetId(payload.assetId || payload.asset_id || payload.localIdentifier);
      const result = applyDecisionAction(currentByAssetId.get(assetId) || null, payload, timestamp);
      const decision = normalizeDecision({ assetId: result.assetId, state: result.state }, currentByAssetId.get(assetId) || null, timestamp);
      currentByAssetId.set(result.assetId, decision);
      results.push({ ...result, state: decision });
    }

    const finalByAssetId = new Map(results.map((result) => [result.assetId, result.state]));
    const statements = [...finalByAssetId.values()].map((decision) => (
      bindDecision(database.prepare(DECISION_UPSERT_SQL), decision, timestamp)
    ));
    for (const result of results) {
      statements.push(database.prepare(`
        INSERT INTO pbe_sidecar_decision_events (
          id, asset_id, action, changed_families_json, actor_kind, actor_id, before_json, after_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `sidecar-event-${randomUUID().replace(/[^a-z0-9-]/gi, "").slice(0, 48)}`,
        result.assetId,
        result.state.lastAction,
        JSON.stringify(result.changedFamilies),
        actor.actorKind,
        actor.actorId,
        JSON.stringify(result.before),
        JSON.stringify(result.state),
        timestamp
      ));
    }
    for (let start = 0; start < statements.length; start += 100) {
      await database.batch(statements.slice(start, start + 100));
    }
    return results;
  };

  return {
    getDecision,
    queryDecisions,
    putDecision,
    putDecisions,
    applyDecision,
    applyDecisions,
  };
};
