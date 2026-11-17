/** Connector-only, receipt-backed correction of untouched legacy self IDs.
 * Media IDs, all object bindings, approvals and lifecycle denials are unchanged.
 * The connector must independently prove the current Owner source/approval and
 * exact public-preview bytes. This is not a generic identity overwrite route.
 */
export async function reconcileLegacyIdentity(input, deps) {
  const { database, manifestRows, summarizeRows, digest, now } = deps;
  const fail = (message, status = 409) => {
    throw Object.assign(new Error(message), { code: "legacy_identity_reconciliation_conflict", status });
  };
  const text = (value, max) => typeof value === "string" && value === value.trim()
    && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (!input || !text(input.actorId, 256) || !text(input.repairId, 128) || !/^[a-zA-Z0-9._-]{1,128}$/.test(input.repairId)
      || typeof input.prepareOnly !== "boolean" || !Array.isArray(input.items)
      || input.items.length < 1 || input.items.length > 20) fail("An explicit bounded connector repair is required.", 400);
  const items = input.items.map((item) => {
    if (!item || !text(item.canonicalMediaId, 128) || !/^[a-zA-Z0-9._-]{1,128}$/.test(item.canonicalMediaId)
        || item.previousAssetId !== item.canonicalMediaId
        || !text(item.canonicalAssetId, 256) || item.canonicalAssetId === item.previousAssetId
        || !hash(item.sourceSha256) || !hash(item.authoritySha256)
        || !Array.isArray(item.bindings) || item.bindings.length !== 2) {
      fail("Only exact legacy self-ID corrections with source and Owner proof are accepted.", 400);
    }
    const bindings = item.bindings.map((binding) => {
      if (!binding || binding.bucket !== "public" || typeof binding.objectKey !== "string") fail("Only exact public previews are accepted.", 400);
      return { bucket: "public", objectKey: binding.objectKey };
    }).sort((a, b) => a.objectKey < b.objectKey ? -1 : a.objectKey > b.objectKey ? 1 : 0);
    const keys = bindings.map((b) => b.objectKey);
    if (!keys.includes(`expo/${item.canonicalMediaId}_900.jpg`) || !keys.includes(`expo/${item.canonicalMediaId}_1800.jpg`)) {
      fail("Preview keys must match the unchanged media identity.", 400);
    }
    return { canonicalMediaId: item.canonicalMediaId, previousAssetId: item.previousAssetId,
      canonicalAssetId: item.canonicalAssetId, sourceSha256: item.sourceSha256,
      authoritySha256: item.authoritySha256, bindings };
  }).sort((a, b) => a.canonicalMediaId < b.canonicalMediaId ? -1 : a.canonicalMediaId > b.canonicalMediaId ? 1 : 0);
  if (new Set(items.map((r) => r.canonicalMediaId)).size !== items.length
      || new Set(items.map((r) => r.canonicalAssetId)).size !== items.length
      || items.some((r) => items.some((s) => r.canonicalAssetId === s.previousAssetId))) fail("Ambiguous or duplicate identity mapping.", 400);
  const repairId = input.repairId;
  const requestDigest = await digest({ repairId, items });
  const existing = await database.prepare("SELECT * FROM pbe_lifecycle_identity_reconciliations WHERE repair_id=?").bind(repairId).first();
  if (existing) {
    if (existing.request_digest !== requestDigest || existing.actor_id !== input.actorId) fail("Repair ID belongs to different inputs or connector.");
    const envelope = JSON.parse(existing.envelope_json);
    if (!input.prepareOnly && (!input.envelope || await digest(input.envelope) !== await digest(envelope))) fail("Applied repair envelope differs.");
    return input.prepareOnly ? { schema: "photosbyelie.legacyIdentityRepairPlan.v1", readOnly: true, state: "applied", envelope }
      : JSON.parse(existing.receipt_json);
  }
  const control = () => database.prepare("SELECT * FROM pbe_lifecycle_control WHERE control_id='global'").first();
  const start = await control();
  if (start?.schema_version !== 4 || start.state !== "ready") fail("Lifecycle authority is unavailable.", 503);
  const activations = (await database.prepare("SELECT * FROM pbe_lifecycle_activations LIMIT 2").all()).results;
  if (activations?.length !== 1) fail("Unambiguous manifest authority is required.");
  const previous = activations[0];
  const expected = [];
  for (const item of items) {
    const identity = await database.prepare("SELECT canonical_asset_id FROM pbe_lifecycle_media_identity WHERE canonical_media_id=?").bind(item.canonicalMediaId).first();
    const projection = await database.prepare("SELECT * FROM pbe_lifecycle_projection WHERE canonical_media_id=?").bind(item.canonicalMediaId).first();
    if (identity?.canonical_asset_id !== item.previousAssetId || projection?.canonical_asset_id !== item.previousAssetId
        || projection.revision !== 0 || projection.denied !== 0 || projection.lifecycle_state !== "visible") {
      fail("Only an untouched, visible legacy self-ID may be corrected; denials and history remain protected.");
    }
    // D1 limits compound SELECT terms more tightly than desktop SQLite.
    // Independent EXISTS predicates retain every refusal without a UNION chain.
    if (await database.prepare(`SELECT 1 WHERE
        EXISTS (SELECT 1 FROM pbe_lifecycle_media_identity WHERE canonical_asset_id=?)
        OR EXISTS (SELECT 1 FROM pbe_lifecycle_projection WHERE canonical_asset_id=? AND canonical_media_id<>?)
        OR EXISTS (SELECT 1 FROM pbe_lifecycle_barriers WHERE canonical_media_id=? OR canonical_asset_id IN (?,?))
        OR EXISTS (SELECT 1 FROM pbe_lifecycle_receipts WHERE canonical_media_id=?)
        OR EXISTS (SELECT 1 FROM pbe_lifecycle_fulfillment_intent_media WHERE canonical_media_id=?)
        OR EXISTS (SELECT 1 FROM pbe_lifecycle_fulfillment_media WHERE canonical_media_id=?)`)
      .bind(item.canonicalAssetId, item.canonicalAssetId, item.canonicalMediaId, item.canonicalMediaId,
        item.previousAssetId, item.canonicalAssetId, item.canonicalMediaId, item.canonicalMediaId, item.canonicalMediaId).first()) {
      fail("Identity ownership, lifecycle work/history or paid fulfillment prevents this repair.");
    }
    for (const binding of item.bindings) {
      const owner = await database.prepare("SELECT canonical_media_id FROM pbe_lifecycle_media_bindings WHERE bucket='public' AND object_key=?").bind(binding.objectKey).first();
      if (owner?.canonical_media_id !== item.canonicalMediaId) fail("Preview binding is missing or belongs to another media item.");
    }
    expected.push({ ...item, previousReceiptId: projection.receipt_id });
  }
  const rows = await manifestRows();
  const baseline = await summarizeRows(rows);
  if (baseline.activationDigest !== previous.activation_digest || baseline.mediaCount !== previous.expected_media_count
      || baseline.bindingCount !== previous.expected_binding_count) fail("Manifest authority changed or is inconsistent.");
  const mappings = new Map(items.map((r) => [r.canonicalMediaId, r]));
  const changed = rows.map((row) => row[0] === "identity" && mappings.has(row[1])
    ? [row[0], row[1], mappings.get(row[1]).canonicalAssetId, row[3], row[4]] : row);
  const next = await summarizeRows(changed);
  const finish = await control();
  if (finish?.state !== "ready" || finish.fencing_epoch !== start.fencing_epoch) fail("Lifecycle changed during preparation.");
  const envelope = { schema: "photosbyelie.legacyIdentityRepairEnvelope.v1", repairId, requestDigest,
    actorId: input.actorId, items: expected, previousFencingEpoch: start.fencing_epoch,
    previousActivationId: previous.activation_id, previousActivationDigest: previous.activation_digest,
    activationId: `legacy-identity:${repairId}`, activationDigest: next.activationDigest,
    mediaCount: baseline.mediaCount, bindingCount: baseline.bindingCount };
  if (input.prepareOnly) return { schema: "photosbyelie.legacyIdentityRepairPlan.v1", readOnly: true, state: "prepared", envelope };
  if (!input.envelope || await digest(input.envelope) !== await digest(envelope)) fail("Prepared repair is stale or changed; reconcile before retrying.");
  const timestamp = now().toISOString();
  const epoch = start.fencing_epoch + 1;
  const receipt = { schema: "photosbyelie.legacyIdentityRepairReceipt.v1", repairId, requestDigest,
    state: "applied", actorId: input.actorId, correctedMediaCount: items.length,
    activationId: envelope.activationId, activationDigest: envelope.activationDigest,
    mediaCount: baseline.mediaCount, bindingCount: baseline.bindingCount, fencingEpoch: epoch, appliedAt: timestamp };
  const statements = [database.prepare(`INSERT INTO pbe_lifecycle_identity_reconciliations
      (repair_id,request_digest,actor_id,envelope_json,receipt_json,applied_at) VALUES (?, ?,
        CASE WHEN EXISTS (SELECT 1 FROM pbe_lifecycle_control WHERE control_id='global'
          AND state='ready' AND schema_version=4 AND fencing_epoch=?) THEN ? ELSE NULL END,?,?,?)`)
    .bind(repairId, requestDigest, start.fencing_epoch, input.actorId, JSON.stringify(envelope), JSON.stringify(receipt), timestamp),
    database.prepare(`UPDATE pbe_lifecycle_control SET
      state=CASE WHEN state='ready' AND schema_version=4 AND fencing_epoch=? THEN 'blocked' ELSE NULL END,
      fencing_epoch=?,updated_at=? WHERE control_id='global'`).bind(start.fencing_epoch, epoch, timestamp)];
  for (const item of expected) {
    // A NOT NULL failure aborts the whole D1 batch if *any* per-item fence changed.
    statements.push(database.prepare(`UPDATE pbe_lifecycle_control SET state=CASE WHEN
        EXISTS (SELECT 1 FROM pbe_lifecycle_media_identity WHERE canonical_media_id=? AND canonical_asset_id=?)
        AND EXISTS (SELECT 1 FROM pbe_lifecycle_projection WHERE canonical_media_id=? AND canonical_asset_id=?
          AND revision=0 AND denied=0 AND lifecycle_state='visible' AND receipt_id=?)
        AND NOT EXISTS (SELECT 1 FROM pbe_lifecycle_media_identity WHERE canonical_asset_id=?)
        AND NOT EXISTS (SELECT 1 FROM pbe_lifecycle_projection WHERE canonical_asset_id=? AND canonical_media_id<>?)
        AND NOT EXISTS (SELECT 1 FROM pbe_lifecycle_barriers WHERE canonical_media_id=? OR canonical_asset_id IN (?,?))
        AND NOT EXISTS (SELECT 1 FROM pbe_lifecycle_receipts WHERE canonical_media_id=?)
        AND NOT EXISTS (SELECT 1 FROM pbe_lifecycle_fulfillment_intent_media WHERE canonical_media_id=?)
        AND NOT EXISTS (SELECT 1 FROM pbe_lifecycle_fulfillment_media WHERE canonical_media_id=?)
        AND (SELECT count(*) FROM pbe_lifecycle_media_bindings WHERE bucket='public' AND canonical_media_id=?
          AND object_key IN (?,?))=2 THEN state ELSE NULL END WHERE control_id='global'`)
      .bind(item.canonicalMediaId, item.previousAssetId, item.canonicalMediaId, item.previousAssetId, item.previousReceiptId,
        item.canonicalAssetId, item.canonicalAssetId, item.canonicalMediaId, item.canonicalMediaId,
        item.previousAssetId, item.canonicalAssetId, item.canonicalMediaId, item.canonicalMediaId, item.canonicalMediaId,
        item.canonicalMediaId, ...item.bindings.map((r) => r.objectKey)));
    statements.push(database.prepare("UPDATE pbe_lifecycle_media_identity SET canonical_asset_id=?,updated_at=? WHERE canonical_media_id=?")
      .bind(item.canonicalAssetId, timestamp, item.canonicalMediaId));
    statements.push(database.prepare(`UPDATE pbe_lifecycle_projection SET canonical_asset_id=?,revision=?,
        operation_id=?,operation_digest=?,receipt_id=?,updated_at=? WHERE canonical_media_id=?`)
      .bind(item.canonicalAssetId, epoch, `legacy-identity:${repairId}`, requestDigest,
        `legacy-identity:${requestDigest}:${item.canonicalMediaId}`, timestamp, item.canonicalMediaId));
  }
  statements.push(database.prepare(`UPDATE pbe_lifecycle_activations SET activation_id=?,
      activation_digest=CASE WHEN activation_digest=? AND expected_media_count=? AND expected_binding_count=?
        THEN ? ELSE NULL END,activated_at=? WHERE activation_id=?`)
    .bind(envelope.activationId, envelope.previousActivationDigest, baseline.mediaCount, baseline.bindingCount,
      envelope.activationDigest, timestamp, envelope.previousActivationId));
  statements.push(database.prepare(`UPDATE pbe_lifecycle_control SET state=CASE WHEN
      fencing_epoch=? AND state='blocked' AND EXISTS (SELECT 1 FROM pbe_lifecycle_activations WHERE activation_id=?
        AND activation_digest=?) THEN 'ready' ELSE NULL END,updated_at=? WHERE control_id='global'`)
    .bind(epoch, envelope.activationId, envelope.activationDigest, timestamp));
  await database.batch(statements);
  return receipt;
}
