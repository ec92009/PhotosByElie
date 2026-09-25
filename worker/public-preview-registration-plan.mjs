/** Read-only preparation for the existing connector-owned reconciliation writer.
 * Never returns the global manifest or private bindings. The connector must
 * independently verify current Owner approval and exact R2 bytes before apply.
 */
export async function preparePublicPreviewRegistration(input, deps) {
  const { database, normalizeMembers, manifestRows, summarizeRows, memberRows, digest } = deps;
  const fail = (message, code = "public_preview_registration_conflict", status = 409) => {
    throw Object.assign(new Error(message), { code, status });
  };
  const repairId = String(input.repairId || "").trim();
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(repairId) || !input.actorId) {
    fail("An authenticated connector and stable repair ID are required.", "public_preview_registration_invalid", 400);
  }
  if (!Array.isArray(input.items) || input.items.some((item) => !item || typeof item !== "object"
      || typeof item.canonicalAssetId !== "string" || typeof item.canonicalMediaId !== "string"
      || !Array.isArray(item.bindings) || item.bindings.some((binding) => !binding
        || typeof binding.bucket !== "string" || typeof binding.objectKey !== "string"))) {
    fail("Explicit canonical identities and public bindings are required.", "public_preview_registration_invalid", 400);
  }
  const items = normalizeMembers(input.items, { maxMembers: 20, maxBindings: 40 });
  for (const item of items) {
    const keys = item.bindings.map((binding) => binding.objectKey);
    if (item.canonicalAssetId.length > 256 || !/^[a-zA-Z0-9._-]{1,128}$/.test(item.canonicalMediaId)
        || keys.length !== 2 || item.bindings.some((binding) => binding.bucket !== "public")
        || !keys.includes(`expo/${item.canonicalMediaId}_900.jpg`)
        || !keys.includes(`expo/${item.canonicalMediaId}_1800.jpg`)) {
      fail("Only the exact canonical public 900/1800 JPEG pair can be prepared.", "public_preview_registration_invalid", 400);
    }
  }
  const seedId = `public-preview:${repairId}`;
  const seedDigest = await digest({ seedId, members: items });
  const control = () => database.prepare(`SELECT schema_version,state,fencing_epoch
    FROM pbe_lifecycle_control WHERE control_id='global'`).first();
  const start = await control();
  if (Number(start?.schema_version) !== 4 || start.state !== "ready") {
    fail("Lifecycle authority is not ready.", "lifecycle_authority_unavailable", 503);
  }
  const existing = await database.prepare(`SELECT * FROM pbe_lifecycle_manifest_reconciliations
    WHERE repair_id=?`).bind(repairId).first();
  if (existing) {
    if (existing.seed_id !== seedId || existing.seed_digest !== seedDigest) {
      fail("The repair ID already belongs to different exact public previews.");
    }
    // Return the original envelope, even after unrelated registrations advanced
    // the manifest. Replaying it retrieves the original durable applied receipt.
    return { schema: "photosbyelie.publicPreviewRegistrationPlan.v1", readOnly: true,
      state: "applied", envelope: {
        repairId, previousActivationId: existing.previous_activation_id,
        previousActivationDigest: existing.previous_activation_digest,
        previousMediaCount: Number(existing.previous_media_count),
        previousBindingCount: Number(existing.previous_binding_count),
        activationId: existing.activation_id, activationDigest: existing.activation_digest,
        expectedMediaCount: Number(existing.media_count), expectedBindingCount: Number(existing.binding_count),
        seedId, seedDigest, items,
      } };
  }
  const wanted = JSON.stringify(items.map((item) => ({ asset: item.canonicalAssetId, media: item.canonicalMediaId })));
  const conflict = await database.prepare(`WITH wanted AS (
      SELECT json_extract(value,'$.asset') asset,json_extract(value,'$.media') media FROM json_each(?)
    ) SELECT 1 FROM wanted w WHERE
      EXISTS (SELECT 1 FROM pbe_lifecycle_media_identity i WHERE i.canonical_media_id=w.media OR i.canonical_asset_id=w.asset)
      OR EXISTS (SELECT 1 FROM pbe_lifecycle_projection p WHERE p.canonical_media_id=w.media OR p.canonical_asset_id=w.asset)
      OR EXISTS (SELECT 1 FROM pbe_lifecycle_barriers b WHERE b.canonical_media_id=w.media OR b.canonical_asset_id=w.asset)
    LIMIT 1`).bind(wanted).first();
  if (conflict) fail("An identity, projection or barrier already exists. Verify or reconcile it; never register another identity.");
  for (const item of items) {
    for (const binding of item.bindings) {
      if (await database.prepare(`SELECT 1 FROM pbe_lifecycle_media_bindings
        WHERE bucket='public' AND object_key=?`).bind(binding.objectKey).first()) {
        fail("A requested preview already has an owner. Existing bindings are never reassigned.");
      }
    }
  }
  const activations = (await database.prepare(`SELECT activation_id,activation_digest,
    expected_media_count,expected_binding_count FROM pbe_lifecycle_activations LIMIT 2`).all()).results;
  if (activations?.length !== 1) fail("An unambiguous activation baseline is required.");
  const previous = activations[0];
  const rows = await manifestRows();
  const current = await summarizeRows(rows);
  if (current.activationDigest !== previous.activation_digest
      || current.mediaCount !== Number(previous.expected_media_count)
      || current.bindingCount !== Number(previous.expected_binding_count)) {
    fail("The manifest changed while preparing registration; safely prepare again.");
  }
  const added = memberRows(items);
  const sorted = [...rows, ...added].sort((left, right) => {
    const a = JSON.stringify(left), b = JSON.stringify(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const next = await summarizeRows(sorted);
  const end = await control();
  if (end?.state !== "ready" || Number(end.fencing_epoch) !== Number(start.fencing_epoch)) {
    fail("Lifecycle changed while preparing registration; no write was made.");
  }
  return { schema: "photosbyelie.publicPreviewRegistrationPlan.v1", readOnly: true,
    state: "prepared", envelope: {
      repairId, previousActivationId: previous.activation_id,
      previousActivationDigest: previous.activation_digest,
      previousMediaCount: current.mediaCount, previousBindingCount: current.bindingCount,
      activationId: `public-preview:${repairId}`, activationDigest: next.activationDigest,
      expectedMediaCount: next.mediaCount, expectedBindingCount: next.bindingCount,
      seedId, seedDigest, items,
    } };
}
