const SCHEMA_VERSION = 4;
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

  const durableManifestRows = async () => {
    const rows = [];
    // "binding" sorts before "identity" in the canonical JSON-row order.
    for (let offset = 0; ; offset += MANIFEST_PAGE_SIZE) {
      const page = await rowsFrom(database.prepare(`SELECT 'binding' AS row_kind,
          canonical_media_id, '' AS canonical_asset_id, bucket, object_key
        FROM pbe_lifecycle_media_bindings
        ORDER BY canonical_media_id, bucket, object_key
        LIMIT ? OFFSET ?`).bind(MANIFEST_PAGE_SIZE, offset));
      rows.push(...page.map((row) => [
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
      rows.push(...page.map((row) => [
        "identity", clean(row.canonical_media_id), clean(row.canonical_asset_id), "", "",
      ]));
      if (page.length < MANIFEST_PAGE_SIZE) break;
    }
    return rows;
  };

  const durableManifestSummary = async () => manifestSummaryForRows(await durableManifestRows());

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

  const reconcileManifest = async ({
    repairId,
    actorId,
    previousActivationId,
    previousActivationDigest,
    previousMediaCount,
    previousBindingCount,
    activationId,
    activationDigest,
    expectedMediaCount,
    expectedBindingCount,
    seedId,
    seedDigest,
    items,
  }) => {
    const control = await database.prepare(
      "SELECT control_id, schema_version, state, fencing_epoch FROM pbe_lifecycle_control WHERE control_id = ?"
    ).bind(CONTROL_ID).first();
    if (!control || Number(control.schema_version) !== SCHEMA_VERSION) {
      throw lifecycleError("lifecycle_authority_unavailable", "Lifecycle authority is not ready; access is denied.");
    }
    if (control.state !== "ready") {
      throw lifecycleError("lifecycle_reconciliation_unavailable", "Lifecycle manifest reconciliation requires a ready authority.", 409);
    }
    const id = clean(repairId);
    const actor = clean(actorId);
    const previousId = clean(previousActivationId);
    const previousDigest = clean(previousActivationDigest).toLowerCase();
    const nextId = clean(activationId);
    const nextDigest = clean(activationDigest).toLowerCase();
    const newSeedId = clean(seedId);
    const providedSeedDigest = clean(seedDigest).toLowerCase();
    const previousMedia = Number(previousMediaCount);
    const previousBindings = Number(previousBindingCount);
    const nextMedia = Number(expectedMediaCount);
    const nextBindings = Number(expectedBindingCount);
    const members = normalizeMembers(items, { maxMembers: MAX_BATCH, maxBindings: MAX_BINDINGS_PER_BATCH });
    const memberPayload = members.map((member) => ({
      canonicalAssetId: member.canonicalAssetId,
      canonicalMediaId: member.canonicalMediaId,
      bindings: member.bindings,
    }));
    if (!id || !actor || !previousId || !/^[a-f0-9]{64}$/.test(previousDigest)
        || !nextId || !/^[a-f0-9]{64}$/.test(nextDigest) || !newSeedId
        || !/^[a-f0-9]{64}$/.test(providedSeedDigest)
        || !Number.isSafeInteger(previousMedia) || previousMedia < 1
        || !Number.isSafeInteger(previousBindings) || previousBindings < previousMedia
        || !Number.isSafeInteger(nextMedia) || nextMedia < 1
        || !Number.isSafeInteger(nextBindings) || nextBindings < nextMedia
        || nextId === previousId) {
      throw lifecycleError("lifecycle_reconciliation_invalid", "Lifecycle reconciliation requires exact previous and resulting manifest identities and counts.", 400);
    }
    const expectedSeedDigest = await canonicalDigestFor({ seedId: newSeedId, members: memberPayload });
    if (providedSeedDigest !== expectedSeedDigest) {
      throw lifecycleError("lifecycle_reconciliation_conflict", "Lifecycle reconciliation seed digest does not match its canonical member batch.", 409);
    }
    if (nextMedia !== previousMedia + members.length
        || nextBindings !== previousBindings + members.reduce((sum, member) => sum + member.bindings.length, 0)) {
      throw lifecycleError("lifecycle_reconciliation_conflict", "Lifecycle reconciliation must be an exact extend-only manifest change.", 409);
    }

    const repairEnvelope = {
      repairId: id,
      previousActivationId: previousId,
      previousActivationDigest: previousDigest,
      previousMediaCount: previousMedia,
      previousBindingCount: previousBindings,
      activationId: nextId,
      activationDigest: nextDigest,
      expectedMediaCount: nextMedia,
      expectedBindingCount: nextBindings,
      seedId: newSeedId,
      seedDigest: providedSeedDigest,
      members: memberPayload,
    };
    const repairDigest = await canonicalDigestFor(repairEnvelope);
    const existingRepair = await database.prepare(`SELECT repair_id, repair_digest, actor_id,
        previous_fencing_epoch, new_fencing_epoch, activation_id, activation_digest,
        media_count, binding_count, added_media_count, added_binding_count, seed_id,
        seed_digest, state FROM pbe_lifecycle_manifest_reconciliations WHERE repair_id = ?`).bind(id).first();
    if (existingRepair) {
      if (clean(existingRepair.repair_digest) !== repairDigest
          || clean(existingRepair.activation_id) !== nextId
          || clean(existingRepair.activation_digest) !== nextDigest
          || clean(existingRepair.seed_id) !== newSeedId
          || clean(existingRepair.seed_digest) !== providedSeedDigest) {
        throw lifecycleError("lifecycle_reconciliation_conflict", "Lifecycle repair ID conflicts with a different durable manifest extension.", 409);
      }
      return {
        repairId: clean(existingRepair.repair_id),
        repairDigest,
        activationId: clean(existingRepair.activation_id),
        activationDigest: clean(existingRepair.activation_digest),
        state: clean(existingRepair.state),
        mediaCount: Number(existingRepair.media_count),
        bindingCount: Number(existingRepair.binding_count),
        addedMediaCount: Number(existingRepair.added_media_count),
        addedBindingCount: Number(existingRepair.added_binding_count),
        seedId: clean(existingRepair.seed_id),
        seedDigest: clean(existingRepair.seed_digest),
        fencingEpoch: Number(existingRepair.new_fencing_epoch),
      };
    }

    const existingActivation = await database.prepare(`SELECT activation_id, activation_digest,
        expected_media_count, expected_binding_count FROM pbe_lifecycle_activations WHERE activation_id = ?`).bind(previousId).first();
    if (!existingActivation
        || clean(existingActivation.activation_digest) !== previousDigest
        || Number(existingActivation.expected_media_count) !== previousMedia
        || Number(existingActivation.expected_binding_count) !== previousBindings) {
      throw lifecycleError("lifecycle_reconciliation_conflict", "The previous lifecycle activation no longer matches the requested repair baseline.", 409);
    }
    if (await database.prepare("SELECT 1 FROM pbe_lifecycle_activations WHERE activation_id = ? OR activation_digest = ? LIMIT 1")
      .bind(nextId, nextDigest).first()) {
      throw lifecycleError("lifecycle_reconciliation_conflict", "The resulting lifecycle activation identity is already in use.", 409);
    }
    const currentRows = await durableManifestRows();
    const currentSummary = await manifestSummaryForRows(currentRows);
    if (currentSummary.activationDigest !== previousDigest
        || currentSummary.mediaCount !== previousMedia
        || currentSummary.bindingCount !== previousBindings) {
      throw lifecycleError("lifecycle_reconciliation_conflict", "The durable lifecycle rows no longer match the requested repair baseline.", 409);
    }
    const existingSeed = await database.prepare("SELECT seed_digest, member_count FROM pbe_lifecycle_seed_batches WHERE seed_id = ?")
      .bind(newSeedId).first();
    if (existingSeed && (clean(existingSeed.seed_digest) !== providedSeedDigest || Number(existingSeed.member_count) !== members.length)) {
      throw lifecycleError("lifecycle_reconciliation_conflict", "The lifecycle repair seed ID is already used by a different member batch.", 409);
    }

    const placeholders = members.map(() => "?").join(",");
    const existingIdentities = await rowsFrom(database.prepare(
      `SELECT canonical_media_id, canonical_asset_id FROM pbe_lifecycle_media_identity WHERE canonical_media_id IN (${placeholders})`
    ).bind(...members.map((member) => member.canonicalMediaId)));
    if (existingIdentities.length) {
      throw lifecycleError("lifecycle_reconciliation_conflict", "Lifecycle repair members must be absent from the existing canonical identity manifest.", 409);
    }
    for (const member of members) {
      for (const binding of member.bindings) {
        const existingBinding = await database.prepare(
          "SELECT canonical_media_id FROM pbe_lifecycle_media_bindings WHERE bucket = ? AND object_key = ?"
        ).bind(binding.bucket, binding.objectKey).first();
        if (existingBinding) {
          throw lifecycleError("lifecycle_reconciliation_conflict", "Lifecycle repair contains an object binding already owned by another canonical media ID.", 409);
        }
      }
    }

    const addedRows = manifestRowsForMembers(members);
    const expectedRows = [
      ...currentRows.filter((row) => row[0] === "binding"),
      ...addedRows.filter((row) => row[0] === "binding"),
    ].sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
    expectedRows.push(
      ...[
        ...currentRows.filter((row) => row[0] === "identity"),
        ...addedRows.filter((row) => row[0] === "identity"),
      ].sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right))),
    );
    const expectedSummary = await manifestSummaryForRows(expectedRows);
    if (expectedSummary.activationDigest !== nextDigest
        || expectedSummary.mediaCount !== nextMedia
        || expectedSummary.bindingCount !== nextBindings) {
      throw lifecycleError("lifecycle_reconciliation_conflict", "The resulting lifecycle manifest digest or coverage does not match the requested repair.", 409);
    }

    const timestamp = now().toISOString();
    const previousEpoch = Number(control.fencing_epoch);
    const newEpoch = previousEpoch + 1;
    const statements = [
      database.prepare(`UPDATE pbe_lifecycle_control SET state = 'blocked', fencing_epoch = ?, updated_at = ?
        WHERE control_id = ? AND state = 'ready' AND fencing_epoch = ?`).bind(newEpoch, timestamp, CONTROL_ID, previousEpoch),
    ];
    if (!existingSeed) {
      statements.push(database.prepare(`INSERT INTO pbe_lifecycle_seed_batches
        (seed_id, seed_digest, member_count, created_at) VALUES (?, ?, ?, ?)`).bind(
        newSeedId, providedSeedDigest, members.length, timestamp,
      ));
    }
    for (const member of members) {
      statements.push(database.prepare(`INSERT INTO pbe_lifecycle_media_identity
        (canonical_media_id, canonical_asset_id, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .bind(member.canonicalMediaId, member.canonicalAssetId, timestamp, timestamp));
      for (const binding of member.bindings) {
        statements.push(database.prepare(`INSERT INTO pbe_lifecycle_media_bindings
          (bucket, object_key, canonical_media_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
          .bind(binding.bucket, binding.objectKey, member.canonicalMediaId, timestamp, timestamp));
      }
      statements.push(database.prepare(`INSERT INTO pbe_lifecycle_projection
        (canonical_media_id, canonical_asset_id, revision, denied, lifecycle_state, operation_id, operation_digest, receipt_id, updated_at)
        VALUES (?, ?, 0, 0, 'visible', ?, ?, ?, ?)`)
        .bind(member.canonicalMediaId, member.canonicalAssetId, `repair:${id}`, repairDigest, `repair:${id}:${member.canonicalMediaId}`, timestamp));
    }
    statements.push(database.prepare(`UPDATE pbe_lifecycle_activations SET activation_id = ?, activation_digest = ?,
        expected_media_count = ?, expected_binding_count = ?, expected_row_count = ?, activated_at = ?
      WHERE activation_id = ? AND activation_digest = ? AND expected_media_count = ? AND expected_binding_count = ?`)
      .bind(nextId, nextDigest, nextMedia, nextBindings, nextMedia + nextBindings, timestamp,
        previousId, previousDigest, previousMedia, previousBindings));
    statements.push(database.prepare(`INSERT INTO pbe_lifecycle_manifest_reconciliations
      (repair_id, repair_digest, actor_id, previous_fencing_epoch, new_fencing_epoch,
       previous_activation_id, previous_activation_digest, previous_media_count, previous_binding_count,
       activation_id, activation_digest, media_count, binding_count, added_media_count,
       added_binding_count, seed_id, seed_digest, state, created_at, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?, ?)`)
      .bind(id, repairDigest, actor, previousEpoch, newEpoch, previousId, previousDigest, previousMedia,
        previousBindings, nextId, nextDigest, nextMedia, nextBindings, members.length,
        members.reduce((sum, member) => sum + member.bindings.length, 0), newSeedId, providedSeedDigest, timestamp, timestamp));
    statements.push(database.prepare(`UPDATE pbe_lifecycle_control SET state = 'ready', updated_at = ?
      WHERE control_id = ? AND state = 'blocked' AND fencing_epoch = ?`).bind(timestamp, CONTROL_ID, newEpoch));
    await database.batch(statements);

    const durableControl = await database.prepare("SELECT state, fencing_epoch FROM pbe_lifecycle_control WHERE control_id = ?")
      .bind(CONTROL_ID).first();
    const durableActivation = await database.prepare(`SELECT activation_id, activation_digest, expected_media_count, expected_binding_count
      FROM pbe_lifecycle_activations WHERE activation_id = ?`).bind(nextId).first();
    if (durableControl?.state !== "ready" || Number(durableControl.fencing_epoch) !== newEpoch
        || clean(durableActivation?.activation_digest) !== nextDigest
        || Number(durableActivation?.expected_media_count) !== nextMedia
        || Number(durableActivation?.expected_binding_count) !== nextBindings) {
      throw lifecycleError("lifecycle_reconciliation_partial", "Lifecycle manifest reconciliation did not commit its complete ready authority.", 503);
    }
    return {
      repairId: id,
      repairDigest,
      activationId: nextId,
      activationDigest: nextDigest,
      state: "applied",
      mediaCount: nextMedia,
      bindingCount: nextBindings,
      addedMediaCount: members.length,
      addedBindingCount: members.reduce((sum, member) => sum + member.bindings.length, 0),
      seedId: newSeedId,
      seedDigest: providedSeedDigest,
      fencingEpoch: newEpoch,
    };
  };

  const fulfillmentFor = async (orderId) => {
    await assertReady();
    const id = clean(orderId);
    if (!id) throw lifecycleError("lifecycle_fulfillment_invalid", "A stable order ID is required.", 400);
    const row = await database.prepare(`SELECT order_id, fence_digest, state, lifecycle_operation_id,
      created_at, updated_at FROM pbe_lifecycle_fulfillments WHERE order_id = ?`).bind(id).first();
    if (!row) return null;
    return {
      orderId: clean(row.order_id),
      fenceDigest: clean(row.fence_digest),
      state: clean(row.state),
      lifecycleOperationId: clean(row.lifecycle_operation_id),
      createdAt: clean(row.created_at),
      updatedAt: clean(row.updated_at),
    };
  };

  const commitFulfillmentReady = async ({ orderId, mediaIds, fence }) => {
    await assertReady();
    const id = clean(orderId);
    const normalizedIds = [...new Set((Array.isArray(mediaIds) ? mediaIds : [mediaIds]).map(clean).filter(Boolean))]
      .sort(compareText);
    const fenceMedia = (Array.isArray(fence?.media) ? fence.media : []).map((item) => ({
      canonicalMediaId: clean(item?.canonicalMediaId),
      revision: Number(item?.revision),
      receiptId: clean(item?.receiptId),
    })).sort((left, right) => compareText(left.canonicalMediaId, right.canonicalMediaId));
    const fenceDigest = clean(fence?.digest);
    if (!id || !normalizedIds.length || normalizedIds.length > MAX_BATCH
        || !/^[a-f0-9]{64}$/.test(fenceDigest)
        || fenceMedia.length !== normalizedIds.length
        || fenceMedia.some((item, index) => item.canonicalMediaId !== normalizedIds[index]
          || !Number.isSafeInteger(item.revision) || item.revision < 0 || !item.receiptId)
        || await canonicalDigestFor(fenceMedia) !== fenceDigest) {
      throw lifecycleError("lifecycle_fulfillment_invalid", "Fulfillment requires an exact current lifecycle fence.", 400);
    }
    const existing = await fulfillmentFor(id);
    if (existing) {
      if (existing.fenceDigest !== fenceDigest) {
        throw lifecycleError("lifecycle_fulfillment_conflict", "Order fulfillment was already settled against a different lifecycle fence.", 409);
      }
      return existing;
    }
    const timestamp = now().toISOString();
    const intentStatements = [database.prepare(`INSERT INTO pbe_lifecycle_fulfillment_intents
      (order_id, fence_digest, member_count, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(order_id) DO NOTHING`).bind(id, fenceDigest, fenceMedia.length, timestamp)];
    for (const item of fenceMedia) {
      intentStatements.push(database.prepare(`INSERT INTO pbe_lifecycle_fulfillment_intent_media
        (order_id, canonical_media_id, revision, receipt_id)
        SELECT ?, ?, ?, ? WHERE EXISTS (
          SELECT 1 FROM pbe_lifecycle_fulfillment_intents WHERE order_id = ? AND fence_digest = ?
        ) ON CONFLICT(order_id, canonical_media_id) DO NOTHING`).bind(
        id, item.canonicalMediaId, item.revision, item.receiptId, id, fenceDigest));
    }
    await database.batch(intentStatements);
    const intent = await database.prepare(`SELECT fence_digest, member_count
      FROM pbe_lifecycle_fulfillment_intents WHERE order_id = ?`).bind(id).first();
    const intentMedia = await rowsFrom(database.prepare(`SELECT canonical_media_id, revision, receipt_id
      FROM pbe_lifecycle_fulfillment_intent_media WHERE order_id = ? ORDER BY canonical_media_id`).bind(id));
    if (clean(intent?.fence_digest) !== fenceDigest || Number(intent?.member_count) !== fenceMedia.length
        || intentMedia.length !== fenceMedia.length
        || intentMedia.some((item, index) => clean(item.canonical_media_id) !== fenceMedia[index].canonicalMediaId
          || Number(item.revision) !== fenceMedia[index].revision
          || clean(item.receipt_id) !== fenceMedia[index].receiptId)) {
      throw lifecycleError("lifecycle_fulfillment_conflict", "Order fulfillment intent conflicts with its exact lifecycle fence.", 409);
    }
    await database.batch([
      database.prepare(`INSERT INTO pbe_lifecycle_fulfillments
        (order_id, fence_digest, state, lifecycle_operation_id, created_at, updated_at)
        SELECT intent.order_id, intent.fence_digest, 'ready', '', ?, ?
        FROM pbe_lifecycle_fulfillment_intents intent
        WHERE intent.order_id = ? AND intent.fence_digest = ?
          AND intent.member_count = (SELECT COUNT(*) FROM pbe_lifecycle_fulfillment_intent_media WHERE order_id = intent.order_id)
          AND NOT EXISTS (
            SELECT 1 FROM pbe_lifecycle_fulfillment_intent_media member
            LEFT JOIN pbe_lifecycle_projection projection
              ON projection.canonical_media_id = member.canonical_media_id
            WHERE member.order_id = intent.order_id
              AND (projection.canonical_media_id IS NULL OR projection.denied != 0
                OR projection.revision != member.revision OR projection.receipt_id != member.receipt_id)
          )
          AND NOT EXISTS (
            SELECT 1 FROM pbe_lifecycle_fulfillment_intent_media member
            JOIN pbe_lifecycle_barriers barrier ON barrier.canonical_media_id = member.canonical_media_id
            WHERE member.order_id = intent.order_id
          )
        ON CONFLICT(order_id) DO NOTHING`).bind(timestamp, timestamp, id, fenceDigest),
      database.prepare(`INSERT INTO pbe_lifecycle_fulfillment_media
        (order_id, canonical_media_id, revision, receipt_id)
        SELECT member.order_id, member.canonical_media_id, member.revision, member.receipt_id
        FROM pbe_lifecycle_fulfillment_intent_media member
        WHERE member.order_id = ? AND EXISTS (
          SELECT 1 FROM pbe_lifecycle_fulfillments fulfillment
          WHERE fulfillment.order_id = member.order_id AND fulfillment.fence_digest = ? AND fulfillment.state = 'ready'
        ) ON CONFLICT(order_id, canonical_media_id) DO NOTHING`).bind(id, fenceDigest),
    ]);
    const durable = await fulfillmentFor(id);
    const members = await rowsFrom(database.prepare(`SELECT canonical_media_id, revision, receipt_id
      FROM pbe_lifecycle_fulfillment_media WHERE order_id = ? ORDER BY canonical_media_id`).bind(id));
    if (!durable || durable.state !== "ready" || durable.fenceDigest !== fenceDigest
        || members.length !== fenceMedia.length
        || members.some((item, index) => clean(item.canonical_media_id) !== fenceMedia[index].canonicalMediaId
          || Number(item.revision) !== fenceMedia[index].revision
          || clean(item.receipt_id) !== fenceMedia[index].receiptId)) {
      throw lifecycleError("lifecycle_fence_changed", "Lifecycle state changed before fulfillment could be settled; access is denied.", 409);
    }
    return durable;
  };

  const authorizeDownloadCapability = async ({ orderId, token }) => {
    await assertReady();
    const id = clean(orderId);
    const rawToken = clean(token);
    if (!id || !rawToken) throw lifecycleError("lifecycle_download_capability_invalid", "Download capability identity is incomplete.", 400);
    const tokenDigest = await digestText(rawToken);
    const timestamp = now().toISOString();
    await database.batch([database.prepare(`INSERT INTO pbe_lifecycle_download_capabilities
      (token_digest, order_id, fence_digest, created_at)
      SELECT ?, fulfillment.order_id, fulfillment.fence_digest, ?
      FROM pbe_lifecycle_fulfillments fulfillment
      WHERE fulfillment.order_id = ? AND fulfillment.state = 'ready'
        AND NOT EXISTS (
          SELECT 1 FROM pbe_lifecycle_fulfillment_media media
          JOIN pbe_lifecycle_barriers barrier ON barrier.canonical_media_id = media.canonical_media_id
          WHERE media.order_id = fulfillment.order_id
        )
      ON CONFLICT(token_digest) DO NOTHING`).bind(tokenDigest, timestamp, id)]);
    const row = await database.prepare(`SELECT capability.order_id, capability.fence_digest, fulfillment.state
      FROM pbe_lifecycle_download_capabilities capability
      JOIN pbe_lifecycle_fulfillments fulfillment ON fulfillment.order_id = capability.order_id
      WHERE capability.token_digest = ?`).bind(tokenDigest).first();
    if (clean(row?.order_id) !== id || clean(row?.state) !== "ready") {
      throw lifecycleError("lifecycle_download_capability_denied", "Download capability cannot be authorized by the current fulfillment settlement.", 409);
    }
    return { orderId: id, tokenDigest, fenceDigest: clean(row.fence_digest), state: "ready" };
  };

  const assertDownloadCapability = async ({ orderId, token }) => {
    await assertReady();
    const id = clean(orderId);
    const rawToken = clean(token);
    if (!id || !rawToken) throw lifecycleError("lifecycle_download_capability_denied", "Download capability identity is incomplete.", 410);
    const tokenDigest = await digestText(rawToken);
    const row = await database.prepare(`SELECT capability.order_id, fulfillment.state
      FROM pbe_lifecycle_download_capabilities capability
      JOIN pbe_lifecycle_fulfillments fulfillment ON fulfillment.order_id = capability.order_id
      WHERE capability.token_digest = ?`).bind(tokenDigest).first();
    if (clean(row?.order_id) !== id || clean(row?.state) !== "ready") {
      throw lifecycleError("lifecycle_download_capability_denied", "Download capability is not authorized by a ready fulfillment settlement.", 410);
    }
    return { orderId: id, tokenDigest, state: "ready" };
  };

  const claimEmailDispatch = async ({ orderId, idempotencyKey }) => {
    await assertReady();
    const id = clean(orderId);
    const key = clean(idempotencyKey);
    if (!id || !key) throw lifecycleError("lifecycle_email_dispatch_invalid", "Email dispatch identity is incomplete.", 400);
    const dispatchDigest = await digestText(key);
    const timestamp = now().toISOString();
    await database.batch([database.prepare(`INSERT INTO pbe_lifecycle_email_dispatches
      (dispatch_digest, order_id, fence_digest, state, provider_message_id, created_at, updated_at)
      SELECT ?, fulfillment.order_id, fulfillment.fence_digest, 'claimed', '', ?, ?
      FROM pbe_lifecycle_fulfillments fulfillment
      WHERE fulfillment.order_id = ? AND fulfillment.state = 'ready'
        AND NOT EXISTS (
          SELECT 1 FROM pbe_lifecycle_fulfillment_media media
          JOIN pbe_lifecycle_barriers barrier ON barrier.canonical_media_id = media.canonical_media_id
          WHERE media.order_id = fulfillment.order_id
        ) ON CONFLICT(dispatch_digest) DO NOTHING`).bind(dispatchDigest, timestamp, timestamp, id)]);
    const row = await database.prepare(`SELECT dispatch.order_id, dispatch.fence_digest, dispatch.state, fulfillment.state AS fulfillment_state
      FROM pbe_lifecycle_email_dispatches dispatch
      JOIN pbe_lifecycle_fulfillments fulfillment ON fulfillment.order_id = dispatch.order_id
      WHERE dispatch.dispatch_digest = ?`).bind(dispatchDigest).first();
    if (clean(row?.order_id) !== id || clean(row?.fulfillment_state) !== "ready") {
      throw lifecycleError("lifecycle_email_dispatch_denied", "Email dispatch cannot be claimed by the current fulfillment settlement.", 409);
    }
    return { orderId: id, dispatchDigest, fenceDigest: clean(row.fence_digest), state: clean(row.state) };
  };

  const completeEmailDispatch = async ({ orderId, idempotencyKey, outcome, providerMessageId = "" }) => {
    await assertReady();
    const id = clean(orderId);
    const key = clean(idempotencyKey);
    const state = clean(outcome);
    if (!id || !key || !["sent", "failed"].includes(state)) {
      throw lifecycleError("lifecycle_email_dispatch_invalid", "Email dispatch completion is invalid.", 400);
    }
    const dispatchDigest = await digestText(key);
    const timestamp = now().toISOString();
    const result = await database.prepare(`UPDATE pbe_lifecycle_email_dispatches
      SET state = ?, provider_message_id = ?, updated_at = ?
      WHERE dispatch_digest = ? AND order_id = ?
        AND (state = 'claimed' OR state = ? OR (? = 'sent' AND state = 'failed'))`)
      .bind(state, clean(providerMessageId), timestamp, dispatchDigest, id, state, state).run();
    if (!result?.success || Number(result?.meta?.changes ?? result?.changes ?? 0) < 1) {
      throw lifecycleError("lifecycle_email_dispatch_conflict", "Email dispatch claim is missing or conflicts with this completion.", 409);
    }
    return { orderId: id, dispatchDigest, state };
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
      if (envelope.denied) {
        statements.push(database.prepare(`UPDATE pbe_lifecycle_fulfillments
          SET state = 'blocked_pending_lifecycle', lifecycle_operation_id = ?, updated_at = ?
          WHERE state IN ('ready', 'blocked_pending_lifecycle') AND order_id IN (
            SELECT order_id FROM pbe_lifecycle_fulfillment_media WHERE canonical_media_id = ?
          )`).bind(envelope.operationId, timestamp, member.canonicalMediaId));
      }
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
    if (["deployed_applied", "locally_acked"].includes(operationRow.state)) {
      const existing = await rowsFrom(database.prepare(`SELECT receipt_id, canonical_media_id, canonical_asset_id,
          revision, denied, lifecycle_state, outcome
        FROM pbe_lifecycle_receipts WHERE operation_id = ? ORDER BY canonical_media_id`).bind(id));
      if (existing.length !== Number(operationRow.member_count)) {
        throw lifecycleError("lifecycle_receipt_partial", "Applied lifecycle receipt membership is incomplete; access remains denied.", 503);
      }
      const conflicts = existing.some((item, index) => (
        clean(item.receipt_id) !== normalized[index].receiptId
        || clean(item.canonical_media_id) !== normalized[index].canonicalMediaId
        || clean(item.canonical_asset_id) !== normalized[index].canonicalAssetId
        || Number(item.revision) !== normalized[index].revision
        || Boolean(item.denied) !== normalized[index].denied
        || clean(item.lifecycle_state) !== normalized[index].lifecycleState
      ));
      if (conflicts) {
        throw lifecycleError("lifecycle_receipt_conflict", "Lifecycle receipt replay conflicts with the durable applied receipt set.", 409);
      }
      return { operationId: id, operationDigest: digest, state: operationRow.state, receipts: existing };
    }
    if (operationRow.state !== "locally_committed") {
      throw lifecycleError("lifecycle_local_commit_required", "Lifecycle apply requires durable local commit evidence.", 409);
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
      if (Boolean(operationRow.intended_denied)) {
        statements.push(database.prepare(`UPDATE pbe_lifecycle_fulfillments
          SET state = 'manual_refund_review', lifecycle_operation_id = ?, updated_at = ?
          WHERE state IN ('ready', 'blocked_pending_lifecycle') AND order_id IN (
            SELECT order_id FROM pbe_lifecycle_fulfillment_media WHERE canonical_media_id = ?
          )`).bind(id, timestamp, item.canonicalMediaId));
      }
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
      database.prepare(`UPDATE pbe_lifecycle_fulfillments
        SET state = 'ready', lifecycle_operation_id = '', updated_at = ?
        WHERE state = 'blocked_pending_lifecycle'
          AND NOT EXISTS (
            SELECT 1 FROM pbe_lifecycle_fulfillment_media media
            JOIN pbe_lifecycle_barriers barrier ON barrier.canonical_media_id = media.canonical_media_id
            WHERE media.order_id = pbe_lifecycle_fulfillments.order_id
              AND NOT (barrier.operation_id = ? AND barrier.operation_digest = ?)
          )
          AND NOT EXISTS (
            SELECT 1 FROM pbe_lifecycle_fulfillment_media media
            JOIN pbe_lifecycle_projection projection ON projection.canonical_media_id = media.canonical_media_id
            WHERE media.order_id = pbe_lifecycle_fulfillments.order_id AND projection.denied = 1
          )`).bind(timestamp, id, digest),
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

  const assertAllowed = async (mediaIds, context = "access", expectedFence = null) => {
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
    const fence = {
      media: [...decisions.values()].map((decision) => ({
        canonicalMediaId: decision.canonicalMediaId,
        revision: decision.revision,
        receiptId: decision.receiptId || "",
      })).sort((left, right) => left.canonicalMediaId.localeCompare(right.canonicalMediaId)),
    };
    fence.digest = await canonicalDigestFor(fence.media);
    if (expectedFence?.digest && clean(expectedFence.digest) !== fence.digest) {
      throw lifecycleError("lifecycle_fence_changed", "Lifecycle state changed during the protected operation; access is denied.", 409, {
        context,
      });
    }
    return fence;
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
    reconcileManifest,
    commitFulfillmentReady,
    fulfillmentFor,
    authorizeDownloadCapability,
    assertDownloadCapability,
    claimEmailDispatch,
    completeEmailDispatch,
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
