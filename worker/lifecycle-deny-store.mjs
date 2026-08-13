const SCHEMA_VERSION = 3;
const CONTROL_ID = "global";
const MAX_BATCH = 100;
const MAX_BINDINGS_PER_BATCH = 400;
const MANIFEST_PAGE_SIZE = 500;
const MANIFEST_DIGEST_ALGORITHM = "sha256-chain-v1";

const clean = (value) => String(value || "").trim();
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const lifecycleError = (code, message, status = 503, details = undefined) =>
  Object.assign(new Error(message), { code, status, details });
const rowsFrom = async (statement) => {
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
};
const bytesToHex = (bytes) => [...new Uint8Array(bytes)]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");
const digestFor = async (value) => bytesToHex(await crypto.subtle.digest(
  "SHA-256",
  new TextEncoder().encode(JSON.stringify(value)),
));
const digestText = async (value) => bytesToHex(await crypto.subtle.digest(
  "SHA-256",
  new TextEncoder().encode(String(value)),
));
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort(compareText).map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
};
const canonicalDigestFor = async (value) => digestText(canonicalJson(value));

const normalizeBinding = (binding = {}) => ({
  bucket: clean(binding.bucket),
  objectKey: clean(binding.objectKey),
});

const normalizeMember = (item = {}, { requireBindings = true } = {}) => {
  const canonicalAssetId = clean(item.canonicalAssetId || item.assetId);
  const canonicalMediaId = clean(item.canonicalMediaId || item.mediaId);
  const bindings = (Array.isArray(item.bindings) ? item.bindings : [])
    .map(normalizeBinding)
    .sort((left, right) => compareText(`${left.bucket}\u0000${left.objectKey}`, `${right.bucket}\u0000${right.objectKey}`));
  if (!canonicalAssetId || !canonicalMediaId || (requireBindings && !bindings.length)
      || bindings.some((binding) => !binding.bucket || !binding.objectKey)) {
    throw lifecycleError("lifecycle_identity_invalid", "Lifecycle members require explicit canonical asset/media IDs and object bindings.", 400);
  }
  return { canonicalAssetId, canonicalMediaId, bindings };
};

const normalizeMembers = (items, options = {}) => {
  const members = (Array.isArray(items) ? items : []).map((item) => normalizeMember(item, options))
    .sort((left, right) => compareText(left.canonicalMediaId, right.canonicalMediaId));
  const maxMembers = Number(options.maxMembers || MAX_BATCH);
  if (!members.length || members.length > maxMembers) {
    throw lifecycleError("lifecycle_batch_invalid", `Lifecycle batches require 1 to ${maxMembers} members.`, 400);
  }
  const maxBindings = Number(options.maxBindings || MAX_BINDINGS_PER_BATCH);
  if (members.reduce((sum, member) => sum + member.bindings.length, 0) > maxBindings) {
    throw lifecycleError("lifecycle_batch_too_large", `Lifecycle batches support at most ${maxBindings} object bindings.`, 413);
  }
  const assets = new Set();
  const media = new Set();
  const objects = new Set();
  for (const member of members) {
    if (assets.has(member.canonicalAssetId) || media.has(member.canonicalMediaId)) {
      throw lifecycleError("lifecycle_batch_duplicate_identity", "Lifecycle batches cannot contain duplicate or ambiguous canonical IDs.", 409);
    }
    assets.add(member.canonicalAssetId);
    media.add(member.canonicalMediaId);
    for (const binding of member.bindings) {
      const key = `${binding.bucket}\u0000${binding.objectKey}`;
      if (objects.has(key)) throw lifecycleError("lifecycle_batch_duplicate_object", "Lifecycle batches cannot contain duplicate object bindings.", 409);
      objects.add(key);
    }
  }
  return members;
};

const operationEnvelope = ({ operationId, operation, denied, members }) => ({
  operationId: clean(operationId),
  operation: clean(operation).toLowerCase(),
  denied: denied !== false,
  members: members.map((member) => ({
    canonicalAssetId: member.canonicalAssetId,
    canonicalMediaId: member.canonicalMediaId,
    bindings: member.bindings,
  })),
});

const sqlPlaceholders = (values) => values.map(() => "?").join(",");

const manifestRowsForMembers = (members) => members.flatMap((member) => [
  ["identity", member.canonicalMediaId, member.canonicalAssetId, "", ""],
  ...member.bindings.map((binding) => [
    "binding", member.canonicalMediaId, "", binding.bucket, binding.objectKey,
  ]),
]).sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));

const createManifestAccumulator = async () => ({
  digest: await digestText(`pbe-lifecycle-manifest\u0000${MANIFEST_DIGEST_ALGORITHM}`),
  mediaCount: 0,
  bindingCount: 0,
});
const accumulateManifestRows = async (accumulator, rows) => {
  for (const row of rows) {
    accumulator.digest = await digestText(`${accumulator.digest}\n${JSON.stringify(row)}`);
    if (row[0] === "identity") accumulator.mediaCount += 1;
    else accumulator.bindingCount += 1;
  }
  return accumulator;
};
const manifestSummaryForAccumulator = (accumulator) => ({
  activationDigest: accumulator.digest,
  digestAlgorithm: MANIFEST_DIGEST_ALGORITHM,
  mediaCount: accumulator.mediaCount,
  bindingCount: accumulator.bindingCount,
  rowCount: accumulator.mediaCount + accumulator.bindingCount,
});
const manifestSummaryForRows = async (rows) => manifestSummaryForAccumulator(
  await accumulateManifestRows(await createManifestAccumulator(), rows)
);

export const summarizeLifecycleManifest = async (items) => {
  const source = Array.isArray(items) ? items : [];
  if (!source.length) throw lifecycleError("lifecycle_activation_invalid", "Activation requires a non-empty exact manifest.", 400);
  const members = source.map((item) => normalizeMember(item))
    .sort((left, right) => compareText(left.canonicalMediaId, right.canonicalMediaId));
  const assets = new Set();
  const media = new Set();
  const objects = new Set();
  for (const member of members) {
    if (assets.has(member.canonicalAssetId) || media.has(member.canonicalMediaId)) {
      throw lifecycleError("lifecycle_batch_duplicate_identity", "Lifecycle manifests cannot contain duplicate or ambiguous canonical IDs.", 409);
    }
    assets.add(member.canonicalAssetId);
    media.add(member.canonicalMediaId);
    for (const binding of member.bindings) {
      const key = `${binding.bucket}\u0000${binding.objectKey}`;
      if (objects.has(key)) throw lifecycleError("lifecycle_batch_duplicate_object", "Lifecycle manifests cannot contain duplicate object bindings.", 409);
      objects.add(key);
    }
  }
  const summary = await manifestSummaryForRows(manifestRowsForMembers(members));
  return {
    activationDigest: summary.activationDigest,
    digestAlgorithm: summary.digestAlgorithm,
    expectedMediaCount: summary.mediaCount,
    expectedBindingCount: summary.bindingCount,
    expectedRowCount: summary.rowCount,
  };
};

export const createD1LifecycleDenyStore = ({ database, now = () => new Date() } = {}) => {
  if (!database?.prepare || !database?.batch) throw new Error("createD1LifecycleDenyStore requires an ACCESS_DB D1 binding.");
  const controlRow = async () => {
    let row;
    try {
      row = await database.prepare(
        "SELECT schema_version, state FROM pbe_lifecycle_control WHERE control_id = ?"
      ).bind(CONTROL_ID).first();
    } catch (error) {
      throw lifecycleError("lifecycle_authority_unavailable", "Lifecycle migration or authority is unavailable; access is denied.", 503, {
        cause: error?.message || String(error),
      });
    }
    if (!row || Number(row.schema_version) !== SCHEMA_VERSION) {
      throw lifecycleError("lifecycle_authority_unavailable", "Lifecycle authority is not ready; access is denied.");
    }
    return row;
  };

  const assertReady = async () => {
    const row = await controlRow();
    if (row.state !== "ready") throw lifecycleError("lifecycle_authority_unavailable", "Lifecycle authority is not ready; access is denied.");
    return row;
  };

  const seedVisibleBatch = async ({ seedId, items }) => {
    const control = await controlRow();
    const id = clean(seedId);
    const members = normalizeMembers(items);
    if (!id) throw lifecycleError("lifecycle_seed_invalid", "A stable seed ID is required.", 400);
    const seedDigest = await canonicalDigestFor({
      seedId: id,
      members: members.map((member) => ({
        canonicalAssetId: member.canonicalAssetId,
        canonicalMediaId: member.canonicalMediaId,
        bindings: member.bindings,
      })),
    });
    const existingSeed = await database.prepare(`SELECT seed_digest, member_count
      FROM pbe_lifecycle_seed_batches WHERE seed_id = ?`).bind(id).first();
    if (existingSeed) {
      if (clean(existingSeed.seed_digest) !== seedDigest || Number(existingSeed.member_count) !== members.length) {
        throw lifecycleError("lifecycle_seed_conflict", "Lifecycle seed ID conflicts with its durable canonical batch.", 409);
      }
      return { seedId: id, seedDigest, memberCount: members.length };
    }
    if (control.state !== "blocked") throw lifecycleError("lifecycle_seed_closed", "Lifecycle seed is allowed only while the deny plane is blocked.", 409);
    const timestamp = now().toISOString();
    const statements = [database.prepare(`INSERT INTO pbe_lifecycle_seed_batches
      (seed_id, seed_digest, member_count, created_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM pbe_lifecycle_control WHERE control_id = ? AND state = 'blocked'
      )
      ON CONFLICT(seed_id) DO UPDATE SET
        seed_digest = CASE WHEN pbe_lifecycle_seed_batches.seed_digest = excluded.seed_digest
          THEN pbe_lifecycle_seed_batches.seed_digest ELSE NULL END`).bind(
      id, seedDigest, members.length, timestamp, CONTROL_ID,
    )];
    for (const member of members) {
      statements.push(database.prepare(`INSERT INTO pbe_lifecycle_media_identity
        (canonical_media_id, canonical_asset_id, created_at, updated_at)
        SELECT ?, ?, ?, ? WHERE EXISTS (
          SELECT 1 FROM pbe_lifecycle_control WHERE control_id = ? AND state = 'blocked'
        )
        ON CONFLICT(canonical_media_id) DO UPDATE SET
          canonical_asset_id = CASE WHEN pbe_lifecycle_media_identity.canonical_asset_id = excluded.canonical_asset_id
            THEN pbe_lifecycle_media_identity.canonical_asset_id ELSE NULL END,
          updated_at = excluded.updated_at`).bind(
        member.canonicalMediaId, member.canonicalAssetId, timestamp, timestamp, CONTROL_ID,
      ));
      for (const binding of member.bindings) {
        statements.push(database.prepare(`INSERT INTO pbe_lifecycle_media_bindings
          (bucket, object_key, canonical_media_id, created_at, updated_at)
          SELECT ?, ?, ?, ?, ? WHERE EXISTS (
            SELECT 1 FROM pbe_lifecycle_control WHERE control_id = ? AND state = 'blocked'
          )
          ON CONFLICT(bucket, object_key) DO UPDATE SET
            canonical_media_id = CASE WHEN pbe_lifecycle_media_bindings.canonical_media_id = excluded.canonical_media_id
              THEN pbe_lifecycle_media_bindings.canonical_media_id ELSE NULL END,
            updated_at = excluded.updated_at`).bind(
          binding.bucket, binding.objectKey, member.canonicalMediaId, timestamp, timestamp, CONTROL_ID,
        ));
      }
      statements.push(database.prepare(`INSERT INTO pbe_lifecycle_projection
        (canonical_media_id, canonical_asset_id, revision, denied, lifecycle_state, operation_id, operation_digest, receipt_id, updated_at)
        SELECT ?, ?, 0, 0, 'visible', ?, ?, ?, ? WHERE EXISTS (
          SELECT 1 FROM pbe_lifecycle_control WHERE control_id = ? AND state = 'blocked'
        )
        ON CONFLICT(canonical_media_id) DO UPDATE SET
          canonical_asset_id = CASE WHEN pbe_lifecycle_projection.canonical_asset_id = excluded.canonical_asset_id
            THEN pbe_lifecycle_projection.canonical_asset_id ELSE NULL END,
          updated_at = excluded.updated_at`).bind(
        member.canonicalMediaId, member.canonicalAssetId, `seed:${id}`, id,
        `seed:${id}:${member.canonicalMediaId}`, timestamp, CONTROL_ID,
      ));
    }
    await database.batch(statements);
    const durableSeed = await database.prepare(`SELECT seed_digest, member_count
      FROM pbe_lifecycle_seed_batches WHERE seed_id = ?`).bind(id).first();
    if (!durableSeed) {
      throw lifecycleError("lifecycle_seed_closed", "Lifecycle seed raced with activation and was rejected.", 409);
    }
    if (clean(durableSeed.seed_digest) !== seedDigest || Number(durableSeed.member_count) !== members.length) {
      throw lifecycleError("lifecycle_seed_conflict", "Lifecycle seed ID conflicts with its durable canonical batch.", 409);
    }
    return { seedId: id, seedDigest, memberCount: members.length };
  };

  const durableManifestSummary = async () => {
    const accumulator = await createManifestAccumulator();
    // "binding" sorts before "identity" in the canonical JSON-row order.
    for (let offset = 0; ; offset += MANIFEST_PAGE_SIZE) {
      const page = await rowsFrom(database.prepare(`SELECT 'binding' AS row_kind,
          canonical_media_id, '' AS canonical_asset_id, bucket, object_key
        FROM pbe_lifecycle_media_bindings
        ORDER BY canonical_media_id, bucket, object_key
        LIMIT ? OFFSET ?`).bind(MANIFEST_PAGE_SIZE, offset));
      await accumulateManifestRows(accumulator, page.map((row) => [
        "binding", clean(row.canonical_media_id), "", clean(row.bucket), clean(row.object_key),
      ]));
      if (page.length < MANIFEST_PAGE_SIZE) break;
    }
    for (let offset = 0; ; offset += MANIFEST_PAGE_SIZE) {
      const page = await rowsFrom(database.prepare(`SELECT 'identity' AS row_kind,
          canonical_media_id, canonical_asset_id, '' AS bucket, '' AS object_key
        FROM pbe_lifecycle_media_identity
        ORDER BY canonical_media_id
        LIMIT ? OFFSET ?`).bind(MANIFEST_PAGE_SIZE, offset));
      await accumulateManifestRows(accumulator, page.map((row) => [
        "identity", clean(row.canonical_media_id), clean(row.canonical_asset_id), "", "",
      ]));
      if (page.length < MANIFEST_PAGE_SIZE) break;
    }
    return manifestSummaryForAccumulator(accumulator);
  };

  const activate = async ({ activationId, activationDigest, expectedMediaCount, expectedBindingCount }) => {
    const control = await controlRow();
    const id = clean(activationId);
    const expectedDigest = clean(activationDigest).toLowerCase();
    const expectedMedia = Number(expectedMediaCount);
    const expectedBindings = Number(expectedBindingCount);
    if (!id || !/^[a-f0-9]{64}$/.test(expectedDigest)
        || !Number.isSafeInteger(expectedMedia) || expectedMedia < 1
        || !Number.isSafeInteger(expectedBindings) || expectedBindings < expectedMedia) {
      throw lifecycleError("lifecycle_activation_invalid", "Activation requires a stable ID, exact digest, and valid media/binding counts.", 400);
    }
    const existing = await database.prepare(`SELECT activation_digest, digest_algorithm, expected_media_count, expected_binding_count
      FROM pbe_lifecycle_activations WHERE activation_id = ?`).bind(id).first();
    if (existing) {
      if (existing.activation_digest !== expectedDigest
          || existing.digest_algorithm !== MANIFEST_DIGEST_ALGORITHM
          || Number(existing.expected_media_count) !== expectedMedia
          || Number(existing.expected_binding_count) !== expectedBindings) {
        throw lifecycleError("lifecycle_activation_conflict", "Activation ID conflicts with its durable manifest digest or counts.", 409);
      }
      return { activationId: id, activationDigest: expectedDigest, state: control.state, mediaCount: expectedMedia, bindingCount: expectedBindings };
    }
    if (control.state === "ready") throw lifecycleError("lifecycle_activation_conflict", "Lifecycle authority was activated by another manifest.", 409);
    const actual = await durableManifestSummary();
    if (actual.activationDigest !== expectedDigest
        || actual.mediaCount !== expectedMedia
        || actual.bindingCount !== expectedBindings) {
      throw lifecycleError("lifecycle_activation_coverage_mismatch", "Lifecycle seed rows do not exactly match the ordered activation manifest.", 409);
    }
    const timestamp = now().toISOString();
    await database.batch([
      database.prepare(`INSERT INTO pbe_lifecycle_activations
        (activation_id, activation_digest, digest_algorithm, expected_media_count, expected_binding_count, expected_row_count, activated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM pbe_lifecycle_media_identity) = ?
          AND (SELECT COUNT(*) FROM pbe_lifecycle_projection) = ?
          AND (SELECT COUNT(*) FROM pbe_lifecycle_projection WHERE denied = 0 AND revision = 0) = ?
          AND (SELECT COUNT(*) FROM pbe_lifecycle_media_bindings) = ?
          AND NOT EXISTS (
            SELECT 1 FROM pbe_lifecycle_projection projection
            LEFT JOIN pbe_lifecycle_media_identity identity
              ON identity.canonical_media_id = projection.canonical_media_id
             AND identity.canonical_asset_id = projection.canonical_asset_id
            WHERE identity.canonical_media_id IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM pbe_lifecycle_media_identity identity
            LEFT JOIN pbe_lifecycle_projection projection
              ON projection.canonical_media_id = identity.canonical_media_id
             AND projection.canonical_asset_id = identity.canonical_asset_id
            WHERE projection.canonical_media_id IS NULL
          )`).bind(
        id, expectedDigest, MANIFEST_DIGEST_ALGORITHM, expectedMedia, expectedBindings,
        expectedMedia + expectedBindings, timestamp,
        expectedMedia, expectedMedia, expectedMedia, expectedBindings,
      ),
      database.prepare(`UPDATE pbe_lifecycle_control SET state = 'ready', updated_at = ?
        WHERE control_id = ? AND state = 'blocked'
          AND EXISTS (SELECT 1 FROM pbe_lifecycle_activations WHERE activation_id = ? AND activation_digest = ?)`).bind(
        timestamp, CONTROL_ID, id, expectedDigest,
      ),
    ]);
    const durable = await database.prepare("SELECT state FROM pbe_lifecycle_control WHERE control_id = ?").bind(CONTROL_ID).first();
    const activation = await database.prepare("SELECT activation_digest FROM pbe_lifecycle_activations WHERE activation_id = ?").bind(id).first();
    if (durable?.state !== "ready" || activation?.activation_digest !== expectedDigest) {
      throw lifecycleError("lifecycle_activation_coverage_mismatch", "Lifecycle seed coverage does not match the explicit activation manifest.", 409);
    }
    return { activationId: id, activationDigest: expectedDigest, state: "ready", mediaCount: expectedMedia, bindingCount: expectedBindings };
  };

  const armBatch = async ({ operationId, requestKey, operation, denied, items }) => {
    await assertReady();
    const members = normalizeMembers(items);
    const envelope = operationEnvelope({ operationId: operationId || requestKey, operation, denied, members });
    if (!envelope.operationId || !["x", "empty", "restore", "tombstone-restore"].includes(envelope.operation)) {
      throw lifecycleError("lifecycle_barrier_invalid", "Lifecycle barrier operation is invalid.", 400);
    }
    const expectedDenied = ["x", "empty"].includes(envelope.operation);
    if (envelope.denied !== expectedDenied) {
      throw lifecycleError(
        "lifecycle_barrier_semantics_invalid",
        `Lifecycle ${envelope.operation} must set denied=${expectedDenied}.`,
        409,
      );
    }
    const operationDigest = await digestFor(envelope);
    const existingOperation = await database.prepare(`SELECT operation_id, operation_digest, operation, intended_denied,
      revision, member_count, state FROM pbe_lifecycle_operations WHERE operation_id = ?`).bind(envelope.operationId).first();
    if (existingOperation) {
      if (existingOperation.operation_digest !== operationDigest || Number(existingOperation.member_count) !== members.length) {
        throw lifecycleError("lifecycle_operation_conflict", "Lifecycle operation ID was already used with a different digest or membership.", 409);
      }
      let existingBarriers = await rowsFrom(database.prepare(`SELECT canonical_media_id, canonical_asset_id, revision
        FROM pbe_lifecycle_barriers WHERE operation_id = ? ORDER BY canonical_media_id`).bind(envelope.operationId));
      if (!existingBarriers.length && ["deployed_applied", "locally_acked"].includes(existingOperation.state)) {
        existingBarriers = await rowsFrom(database.prepare(`SELECT canonical_media_id, canonical_asset_id, revision
          FROM pbe_lifecycle_receipts WHERE operation_id = ? ORDER BY canonical_media_id`).bind(envelope.operationId));
      }
      if (existingBarriers.length !== members.length) throw lifecycleError("lifecycle_barrier_partial", "Lifecycle barrier replay found incomplete durable membership.", 503);
      return {
        operationId: existingOperation.operation_id,
        operationDigest: existingOperation.operation_digest,
        operation: existingOperation.operation,
        denied: Boolean(existingOperation.intended_denied),
        revision: Number(existingOperation.revision),
        state: existingOperation.state,
        members: existingBarriers.map((row) => ({
          canonicalMediaId: clean(row.canonical_media_id),
          canonicalAssetId: clean(row.canonical_asset_id),
          revision: Number(row.revision),
        })),
      };
    }
    const timestamp = now().toISOString();
    for (const member of members) {
      const identity = await database.prepare(`SELECT canonical_asset_id FROM pbe_lifecycle_media_identity
        WHERE canonical_media_id = ?`).bind(member.canonicalMediaId).first();
      const bindings = await rowsFrom(database.prepare(`SELECT bucket, object_key FROM pbe_lifecycle_media_bindings
        WHERE canonical_media_id = ? ORDER BY bucket, object_key`).bind(member.canonicalMediaId));
      const actualBindings = bindings.map((binding) => ({ bucket: clean(binding.bucket), objectKey: clean(binding.object_key) }));
      if (clean(identity?.canonical_asset_id) !== member.canonicalAssetId
          || JSON.stringify(actualBindings) !== JSON.stringify(member.bindings)) {
        throw lifecycleError("lifecycle_identity_conflict", "Lifecycle arm membership must exactly match the activated canonical manifest.", 409);
      }
    }
    const statements = [
      database.prepare(`UPDATE pbe_lifecycle_control SET fencing_epoch = fencing_epoch + 1, updated_at = ?
        WHERE control_id = ? AND NOT EXISTS (
          SELECT 1 FROM pbe_lifecycle_operations WHERE operation_id = ?
        )`).bind(timestamp, CONTROL_ID, envelope.operationId),
      database.prepare(`INSERT INTO pbe_lifecycle_operations
        (operation_id, operation_digest, operation, intended_denied, revision, member_count, state, created_at, updated_at)
        SELECT ?, ?, ?, ?, fencing_epoch, ?, 'armed', ?, ? FROM pbe_lifecycle_control WHERE control_id = ?
        ON CONFLICT(operation_id) DO UPDATE SET
          operation_digest = CASE WHEN pbe_lifecycle_operations.operation_digest = excluded.operation_digest
            THEN pbe_lifecycle_operations.operation_digest ELSE NULL END,
          updated_at = excluded.updated_at`).bind(
        envelope.operationId, operationDigest, envelope.operation, Number(envelope.denied), members.length,
        timestamp, timestamp, CONTROL_ID,
      ),
    ];
    for (const member of members) {
      statements.push(database.prepare(`INSERT INTO pbe_lifecycle_barriers
        (operation_id, operation_digest, canonical_media_id, canonical_asset_id, revision, intended_denied, armed_at)
        SELECT ?, ?, ?, ?, revision, intended_denied, ? FROM pbe_lifecycle_operations WHERE operation_id = ?
        ON CONFLICT(operation_id, canonical_media_id) DO UPDATE SET
          operation_digest = CASE WHEN pbe_lifecycle_barriers.operation_digest = excluded.operation_digest
            THEN pbe_lifecycle_barriers.operation_digest ELSE NULL END`).bind(
        envelope.operationId, operationDigest, member.canonicalMediaId, member.canonicalAssetId,
        timestamp, envelope.operationId,
      ));
    }
    try {
      await database.batch(statements);
    } catch (error) {
      throw lifecycleError("lifecycle_barrier_conflict", "Lifecycle barrier transaction conflicted and was rolled back in full.", 409, {
        cause: error?.message || String(error),
      });
    }
    const durable = await database.prepare(`SELECT operation_id, operation_digest, operation, intended_denied,
      revision, member_count, state FROM pbe_lifecycle_operations WHERE operation_id = ?`).bind(envelope.operationId).first();
    const barriers = await rowsFrom(database.prepare(`SELECT canonical_media_id, canonical_asset_id, revision
      FROM pbe_lifecycle_barriers WHERE operation_id = ? ORDER BY canonical_media_id`).bind(envelope.operationId));
    if (!durable || durable.operation_digest !== operationDigest || barriers.length !== members.length
        || durable.state !== "armed") {
      throw lifecycleError("lifecycle_barrier_partial", "Lifecycle barrier was not atomically armed in full.", 503);
    }
    return {
      operationId: durable.operation_id,
      operationDigest: durable.operation_digest,
      operation: durable.operation,
      denied: Boolean(durable.intended_denied),
      revision: Number(durable.revision),
      state: durable.state,
      members: barriers.map((row) => ({
        canonicalMediaId: clean(row.canonical_media_id),
        canonicalAssetId: clean(row.canonical_asset_id),
        revision: Number(row.revision),
      })),
    };
  };

  const applyBatch = async ({ operationId, requestKey, operationDigest, receipts }) => {
    await assertReady();
    const id = clean(operationId || requestKey);
    const digest = clean(operationDigest);
    const operationRow = await database.prepare(`SELECT operation_digest, operation, intended_denied, revision, member_count, state
      FROM pbe_lifecycle_operations WHERE operation_id = ?`).bind(id).first();
    if (!id || !digest || !operationRow || operationRow.operation_digest !== digest || operationRow.state === "aborted") {
      throw lifecycleError("lifecycle_receipt_conflict", "Lifecycle receipt does not match an armed operation.", 409);
    }
    const expectedLifecycleState = clean(operationRow.operation) === "x"
      ? "recoverable"
      : clean(operationRow.operation) === "empty"
        ? "tombstoned"
        : "restored";
    if ((Array.isArray(receipts) ? receipts : []).some(
      (receipt) => clean(receipt?.lifecycleState) !== expectedLifecycleState,
    )) {
      throw lifecycleError(
        "lifecycle_receipt_semantics_invalid",
        `Lifecycle receipts for ${clean(operationRow.operation)} must use ${expectedLifecycleState}.`,
        409,
      );
    }
    if (["deployed_applied", "locally_acked"].includes(operationRow.state)) {
      const existing = await rowsFrom(database.prepare(`SELECT receipt_id, canonical_media_id, revision, outcome
        FROM pbe_lifecycle_receipts WHERE operation_id = ? ORDER BY canonical_media_id`).bind(id));
      if (existing.length === Number(operationRow.member_count)) {
        return { operationId: id, operationDigest: digest, state: operationRow.state, receipts: existing };
      }
      throw lifecycleError("lifecycle_receipt_partial", "Applied lifecycle receipt membership is incomplete; access remains denied.", 503);
    }
    if (operationRow.state !== "locally_committed") {
      throw lifecycleError("lifecycle_local_commit_required", "Lifecycle apply requires durable local commit evidence.", 409);
    }
    const normalized = (Array.isArray(receipts) ? receipts : []).map((receipt) => ({
      receiptId: clean(receipt.receiptId),
      canonicalMediaId: clean(receipt.canonicalMediaId || receipt.mediaId),
      canonicalAssetId: clean(receipt.canonicalAssetId || receipt.assetId),
      revision: Number(receipt.revision),
      denied: receipt.denied !== false,
      lifecycleState: clean(receipt.lifecycleState),
    })).sort((left, right) => left.canonicalMediaId.localeCompare(right.canonicalMediaId));
    if (normalized.length !== Number(operationRow.member_count) || normalized.length > MAX_BATCH
        || normalized.some((item) => !item.receiptId || !item.canonicalMediaId || !item.canonicalAssetId
          || item.revision !== Number(operationRow.revision) || item.denied !== Boolean(operationRow.intended_denied)
          || !["recoverable", "tombstoned", "restored"].includes(item.lifecycleState))) {
      throw lifecycleError("lifecycle_receipt_partial", "Lifecycle receipts must exactly cover the armed batch.", 409);
    }
    const barriers = await rowsFrom(database.prepare(`SELECT canonical_media_id, canonical_asset_id, revision
      FROM pbe_lifecycle_barriers WHERE operation_id = ? ORDER BY canonical_media_id`).bind(id));
    if (barriers.length !== normalized.length || barriers.some((barrier, index) => (
      clean(barrier.canonical_media_id) !== normalized[index].canonicalMediaId
      || clean(barrier.canonical_asset_id) !== normalized[index].canonicalAssetId
      || Number(barrier.revision) !== normalized[index].revision
    ))) throw lifecycleError("lifecycle_receipt_partial", "Lifecycle receipts do not match the complete armed membership.", 409);

    const duplicateReceipts = new Set();
    for (const item of normalized) {
      if (duplicateReceipts.has(item.receiptId)) throw lifecycleError("lifecycle_receipt_duplicate", "Receipt IDs must be unique.", 409);
      duplicateReceipts.add(item.receiptId);
    }
    const timestamp = now().toISOString();
    const statements = [];
    for (const item of normalized) {
      statements.push(database.prepare(`INSERT INTO pbe_lifecycle_receipts
        (receipt_id, operation_id, operation_digest, canonical_media_id, canonical_asset_id, revision, denied, lifecycle_state, outcome, applied_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?,
          CASE
            WHEN current.revision IS NULL OR current.revision < ? THEN 'applied'
            WHEN current.revision = ? AND current.operation_digest = ? THEN 'duplicate'
            ELSE 'stale'
          END, ?
        FROM (SELECT 1) seed LEFT JOIN pbe_lifecycle_projection current ON current.canonical_media_id = ?
        ON CONFLICT(receipt_id) DO UPDATE SET
          operation_digest = CASE WHEN pbe_lifecycle_receipts.operation_digest = excluded.operation_digest
            THEN pbe_lifecycle_receipts.operation_digest ELSE NULL END`).bind(
        item.receiptId, id, digest, item.canonicalMediaId, item.canonicalAssetId, item.revision,
        Number(item.denied), item.lifecycleState, item.revision, item.revision, digest, timestamp, item.canonicalMediaId,
      ));
      statements.push(database.prepare(`INSERT INTO pbe_lifecycle_projection
        (canonical_media_id, canonical_asset_id, revision, denied, lifecycle_state, operation_id, operation_digest, receipt_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(canonical_media_id) DO UPDATE SET
          canonical_asset_id = CASE
            WHEN excluded.revision > pbe_lifecycle_projection.revision THEN excluded.canonical_asset_id
            WHEN excluded.revision = pbe_lifecycle_projection.revision
              AND excluded.operation_digest = pbe_lifecycle_projection.operation_digest THEN pbe_lifecycle_projection.canonical_asset_id
            WHEN excluded.revision = pbe_lifecycle_projection.revision THEN NULL
            ELSE pbe_lifecycle_projection.canonical_asset_id END,
          revision = CASE WHEN excluded.revision > pbe_lifecycle_projection.revision THEN excluded.revision ELSE pbe_lifecycle_projection.revision END,
          denied = CASE WHEN excluded.revision > pbe_lifecycle_projection.revision THEN excluded.denied ELSE pbe_lifecycle_projection.denied END,
          lifecycle_state = CASE WHEN excluded.revision > pbe_lifecycle_projection.revision THEN excluded.lifecycle_state ELSE pbe_lifecycle_projection.lifecycle_state END,
          operation_id = CASE WHEN excluded.revision > pbe_lifecycle_projection.revision THEN excluded.operation_id ELSE pbe_lifecycle_projection.operation_id END,
          operation_digest = CASE WHEN excluded.revision > pbe_lifecycle_projection.revision THEN excluded.operation_digest ELSE pbe_lifecycle_projection.operation_digest END,
          receipt_id = CASE WHEN excluded.revision > pbe_lifecycle_projection.revision THEN excluded.receipt_id ELSE pbe_lifecycle_projection.receipt_id END,
          updated_at = CASE WHEN excluded.revision > pbe_lifecycle_projection.revision THEN excluded.updated_at ELSE pbe_lifecycle_projection.updated_at END`).bind(
        item.canonicalMediaId, item.canonicalAssetId, item.revision, Number(item.denied), item.lifecycleState,
        id, digest, item.receiptId, timestamp,
      ));
    }
    statements.push(database.prepare("DELETE FROM pbe_lifecycle_barriers WHERE operation_id = ? AND operation_digest = ?").bind(id, digest));
    statements.push(database.prepare(`UPDATE pbe_lifecycle_operations SET state = 'deployed_applied', updated_at = ?
      WHERE operation_id = ? AND operation_digest = ? AND state IN ('armed', 'locally_committed', 'deployed_applied')`).bind(timestamp, id, digest));
    await database.batch(statements);
    const outcomes = await rowsFrom(database.prepare(`SELECT receipt_id, canonical_media_id, revision, outcome
      FROM pbe_lifecycle_receipts WHERE operation_id = ? ORDER BY canonical_media_id`).bind(id));
    if (outcomes.length !== normalized.length) throw lifecycleError("lifecycle_receipt_partial", "Lifecycle receipt transaction did not commit in full.", 503);
    return { operationId: id, operationDigest: digest, state: "deployed_applied", receipts: outcomes };
  };

  const markLocallyCommitted = async ({ operationId, operationDigest }) => {
    await assertReady();
    const id = clean(operationId);
    const digest = clean(operationDigest);
    const existing = await database.prepare(`SELECT state FROM pbe_lifecycle_operations
      WHERE operation_id = ? AND operation_digest = ?`).bind(id, digest).first();
    if (["deployed_applied", "locally_acked"].includes(clean(existing?.state))) {
      return { operationId: id, state: clean(existing.state) };
    }
    const timestamp = now().toISOString();
    const result = await database.prepare(`UPDATE pbe_lifecycle_operations SET state = 'locally_committed', updated_at = ?
      WHERE operation_id = ? AND operation_digest = ? AND state IN ('armed', 'locally_committed')`).bind(
      timestamp, id, digest,
    ).run();
    if (!result?.success || Number(result?.meta?.changes ?? result?.changes ?? 0) < 1) throw lifecycleError("lifecycle_operation_conflict", "Lifecycle operation could not be marked locally committed.", 409);
    return { operationId: id, state: "locally_committed" };
  };

  const acknowledge = async ({ operationId, operationDigest }) => {
    await assertReady();
    const timestamp = now().toISOString();
    const result = await database.prepare(`UPDATE pbe_lifecycle_operations SET state = 'locally_acked', updated_at = ?
      WHERE operation_id = ? AND operation_digest = ? AND state IN ('deployed_applied', 'locally_acked')`).bind(
      timestamp, clean(operationId), clean(operationDigest),
    ).run();
    if (!result?.success || Number(result?.meta?.changes ?? result?.changes ?? 0) < 1) throw lifecycleError("lifecycle_operation_conflict", "Lifecycle operation cannot be acknowledged before deployed apply.", 409);
    return { operationId: clean(operationId), state: "locally_acked" };
  };

  const abort = async ({ operationId, operationDigest, proof }) => {
    await assertReady();
    const id = clean(operationId);
    const digest = clean(operationDigest);
    const proofKind = clean(proof?.kind);
    const proofDigest = clean(proof?.proofDigest);
    const proofKeys = proof && typeof proof === "object" && !Array.isArray(proof)
      ? Object.keys(proof).sort(compareText)
      : [];
    const expectedProofKeys = [
      "armReceiptDigest", "kind", "localLifecycleState", "localMutationCommitted",
      "localMutationStatus", "operation", "operationDigest", "operationId", "proofDigest",
    ].sort(compareText);
    if (!id || !digest || proofKind !== "owner-sqlite-no-local-commit-v1"
        || !/^[a-f0-9]{64}$/.test(proofDigest)
        || proofKeys.length !== expectedProofKeys.length
        || proofKeys.some((key, index) => key !== expectedProofKeys[index])) {
      throw lifecycleError("lifecycle_abort_proof_required", "Abort requires durable proof that the local mutation never committed.", 409);
    }
    const operation = await database.prepare(`SELECT operation_id, operation_digest, operation, intended_denied,
      revision, member_count, state FROM pbe_lifecycle_operations WHERE operation_id = ?`).bind(id).first();
    if (!operation || clean(operation.operation_digest) !== digest) {
      throw lifecycleError("lifecycle_abort_conflict", "Only an armed, never locally committed operation may be aborted.", 409);
    }
    if (operation.state === "aborted") {
      const durableProof = await database.prepare(`SELECT proof_digest, proof_json
        FROM pbe_lifecycle_abort_proofs WHERE operation_id = ? AND operation_digest = ?`).bind(id, digest).first();
      if (clean(durableProof?.proof_digest) === proofDigest
          && clean(durableProof?.proof_json) === canonicalJson(proof)) {
        return { operationId: id, operationDigest: digest, state: "aborted", proof: { kind: proofKind, proofDigest } };
      }
      throw lifecycleError("lifecycle_abort_conflict", "The aborted operation has different durable proof.", 409);
    }
    if (operation.state !== "armed") {
      throw lifecycleError("lifecycle_abort_conflict", "Only an armed, never locally committed operation may be aborted.", 409);
    }
    const barriers = await rowsFrom(database.prepare(`SELECT canonical_media_id, canonical_asset_id, revision
      FROM pbe_lifecycle_barriers WHERE operation_id = ? ORDER BY canonical_media_id`).bind(id));
    if (barriers.length !== Number(operation.member_count)) {
      throw lifecycleError("lifecycle_abort_conflict", "Abort proof cannot cover an incomplete durable arm.", 409);
    }
    const armReceipt = {
      operationId: clean(operation.operation_id),
      operationDigest: clean(operation.operation_digest),
      operation: clean(operation.operation),
      denied: Boolean(operation.intended_denied),
      revision: Number(operation.revision),
      state: "armed",
      members: barriers.map((row) => ({
        canonicalMediaId: clean(row.canonical_media_id),
        canonicalAssetId: clean(row.canonical_asset_id),
        revision: Number(row.revision),
      })),
    };
    const expectedArmReceiptDigest = await canonicalDigestFor(armReceipt);
    const proofBody = {
      operationId: id,
      operationDigest: digest,
      operation: clean(operation.operation),
      localLifecycleState: "armed",
      localMutationStatus: clean(proof.localMutationStatus),
      armReceiptDigest: expectedArmReceiptDigest,
      localMutationCommitted: false,
    };
    const expectedProofDigest = await canonicalDigestFor(proofBody);
    if (clean(proof.operationId) !== id
        || clean(proof.operationDigest) !== digest
        || clean(proof.operation) !== clean(operation.operation)
        || proof.localLifecycleState !== "armed"
        || !["absent", "failed"].includes(proofBody.localMutationStatus)
        || proof.localMutationCommitted !== false
        || clean(proof.armReceiptDigest) !== expectedArmReceiptDigest
        || proofDigest !== expectedProofDigest) {
      throw lifecycleError("lifecycle_abort_proof_invalid", "Abort proof does not exactly match the durable armed operation.", 409);
    }
    const timestamp = now().toISOString();
    const proofJson = canonicalJson({ ...proofBody, kind: proofKind, proofDigest });
    await database.batch([
      database.prepare(`INSERT INTO pbe_lifecycle_abort_proofs
        (operation_id, operation_digest, proof_kind, proof_digest, proof_json, aborted_at)
        SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
          SELECT 1 FROM pbe_lifecycle_operations WHERE operation_id = ? AND operation_digest = ? AND state = 'armed'
        )`).bind(id, digest, proofKind, proofDigest, proofJson, timestamp, id, digest),
      database.prepare(`DELETE FROM pbe_lifecycle_barriers WHERE operation_id = ? AND operation_digest = ?
        AND EXISTS (SELECT 1 FROM pbe_lifecycle_operations WHERE operation_id = ? AND operation_digest = ? AND state = 'armed')`).bind(
        id, digest, id, digest,
      ),
      database.prepare(`UPDATE pbe_lifecycle_operations SET state = 'aborted', updated_at = ?
        WHERE operation_id = ? AND operation_digest = ? AND state = 'armed'`).bind(timestamp, id, digest),
    ]);
    const abortedOperation = await database.prepare("SELECT state FROM pbe_lifecycle_operations WHERE operation_id = ? AND operation_digest = ?")
      .bind(id, digest).first();
    const durableProof = await database.prepare("SELECT proof_digest FROM pbe_lifecycle_abort_proofs WHERE operation_id = ?").bind(id).first();
    if (abortedOperation?.state !== "aborted" || durableProof?.proof_digest !== proofDigest) throw lifecycleError("lifecycle_abort_conflict", "Only an armed, never locally committed operation may be aborted.", 409);
    return { operationId: id, operationDigest: digest, state: "aborted", proof: { kind: proofKind, proofDigest } };
  };

  const decisionsFor = async (mediaIds) => {
    await assertReady();
    const ids = [...new Set((Array.isArray(mediaIds) ? mediaIds : [mediaIds]).map(clean).filter(Boolean))];
    if (!ids.length || ids.length > MAX_BATCH) throw lifecycleError("lifecycle_query_invalid", `Lifecycle queries require 1 to ${MAX_BATCH} canonical media IDs.`, 400);
    const placeholders = sqlPlaceholders(ids);
    const rows = await rowsFrom(database.prepare(`SELECT identity.canonical_media_id,
        projection.revision, projection.denied, projection.lifecycle_state, projection.receipt_id,
        MAX(barrier.revision) AS barrier_revision
      FROM pbe_lifecycle_media_identity identity
      LEFT JOIN pbe_lifecycle_projection projection
        ON projection.canonical_media_id = identity.canonical_media_id
      LEFT JOIN pbe_lifecycle_barriers barrier
        ON barrier.canonical_media_id = identity.canonical_media_id
      WHERE identity.canonical_media_id IN (${placeholders})
      GROUP BY identity.canonical_media_id, projection.revision, projection.denied,
        projection.lifecycle_state, projection.receipt_id`).bind(...ids));
    const result = new Map(ids.map((id) => [id, {
      canonicalMediaId: id, denied: true, reason: "identity-missing", revision: null,
    }]));
    rows.forEach((row) => {
      const id = clean(row.canonical_media_id);
      const revision = row.revision == null ? null : Number(row.revision);
      const barrierRevision = row.barrier_revision == null ? null : Number(row.barrier_revision);
      if (revision == null) {
        result.set(id, { canonicalMediaId: id, denied: true, reason: "projection-missing", revision: null });
      } else if (barrierRevision != null && barrierRevision >= revision) {
        result.set(id, { canonicalMediaId: id, denied: true, reason: "barrier-armed", revision: barrierRevision });
      } else {
        result.set(id, {
          canonicalMediaId: id, denied: Boolean(row.denied), reason: row.lifecycle_state,
          revision, receiptId: clean(row.receipt_id),
        });
      }
    });
    return result;
  };

  const assertAllowed = async (mediaIds, context = "access") => {
    let decisions;
    try {
      decisions = await decisionsFor(mediaIds);
    } catch (error) {
      if (error?.code) throw error;
      throw lifecycleError("lifecycle_authority_unavailable", "Lifecycle authority is unavailable; access is denied.");
    }
    const denied = [...decisions.values()].filter((decision) => decision.denied);
    if (denied.length) throw lifecycleError("asset_lifecycle_denied", "One or more assets are unavailable.", 410, {
      context,
      mediaIds: denied.map((item) => item.canonicalMediaId),
      reasons: denied.map((item) => item.reason),
    });
    return true;
  };

  const assertObjectAllowed = async ({ bucket, objectKey, context = "media" }) => {
    await assertReady();
    const normalizedBucket = clean(bucket);
    const normalizedKey = clean(objectKey);
    if (!normalizedBucket || !normalizedKey) throw lifecycleError("lifecycle_object_binding_missing", "Media object binding is missing; access is denied.");
    const binding = await database.prepare(`SELECT canonical_media_id FROM pbe_lifecycle_media_bindings
      WHERE bucket = ? AND object_key = ?`).bind(normalizedBucket, normalizedKey).first();
    if (!binding?.canonical_media_id) throw lifecycleError("lifecycle_object_binding_missing", "Media object is not bound to a canonical media ID; access is denied.");
    await assertAllowed([binding.canonical_media_id], context);
    return { canonicalMediaId: clean(binding.canonical_media_id) };
  };

  const visibilityFor = async (mediaIds) => {
    const decisions = await decisionsFor(mediaIds);
    return [...decisions.values()].map((decision) => ({
      canonicalMediaId: decision.canonicalMediaId,
      visible: !decision.denied,
      revision: decision.revision,
    }));
  };

  const listDeniedAssetIds = async () => {
    await assertReady();
    const rows = await rowsFrom(database.prepare(`SELECT canonical_media_id FROM pbe_lifecycle_projection WHERE denied = 1
      UNION SELECT canonical_media_id FROM pbe_lifecycle_barriers ORDER BY canonical_media_id`));
    return [...new Set(rows.map((row) => clean(row.canonical_media_id)).filter(Boolean))];
  };

  return {
    ensureSchema: assertReady,
    seedVisibleBatch,
    activate,
    armBatch,
    markLocallyCommitted,
    applyBatch,
    acknowledge,
    abort,
    decisionsFor,
    visibilityFor,
    assertAllowed,
    assertObjectAllowed,
    listDeniedAssetIds,
  };
};
