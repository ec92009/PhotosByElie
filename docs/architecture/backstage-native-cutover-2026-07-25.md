# Backstage native-only cutover evidence

Date: 2026-07-25

Release: `v147.6`

Epic: `PBB-19`

## Result

PhotosByElie Backstage is the sole visible operator application on Max.
Photos Bridge remains installed as a signed, headless PhotoKit helper. The
former Owner and Sidecar applications are no longer visible in
`/Users/ecohen/Applications`, and the obsolete Sidecar web listener is not
running.

Public buyer pages and private Real Estate delivery pages remain independent
web applications. `Owner.sqlite` remains the private curation source of truth.

## Verified gates

- Backstage release `0.2.0` build `3` is installed at
  `/Users/ecohen/Applications/PhotosByElie Backstage.app`.
- Photos Bridge is installed at
  `/Users/ecohen/Applications/PhotosByElie Photos Bridge.app` with
  `LSUIElement=true`; it has no normal operator window or Dock presence.
- The legacy Max connector status service is absent from port `8766`; normal
  Owner work is now launched on demand by signed Backstage.
- The obsolete Sidecar listener is absent from port `8011`.
- `/photosbyelie/open-sidecar` returns `410` unless the explicit
  `PBE_ENABLE_LEGACY_SIDECAR=1` rehearsal rollback flag is present.
- The legacy `PhotosByElie Owner.app` and `PhotosByElie Sidecar.app` bundles
  are absent from the visible Applications folder.
- A read-only cutover audit passes all of the above gates.
- The native parity rehearsal passes, including guarded public/private hashes,
  action atomicity, fixture placement, culling, metadata, delivery, and
  rollback assertions.
- `npm test`: 155 Node tests and 123 Python tests pass.
- `swift test`: 28 tests pass.
- `npm run validate`: passes with the generated Swift contract current at
  35 operations and 10 schemas.
- GitHub Pages published the exact `v147.6` commit, and direct production
  smokes returned HTTP 200 with the `v147.6` badge for home, gallery, photo,
  Owner, ACS, and Real Estate.

Photos Bridge permission was verified through its signed LaunchServices
identity after the cutover. The installed headless helper reported
`photoAccess=authorized`, and a read-only album inventory completed
successfully. A missing or revoked permission remains a blocking health result;
no raw helper executable or alternate writer is used.

## Reversible retirement

The retired application bundles were moved, not deleted, to:

`/Users/ecohen/Library/Application Support/PhotosByElie/Legacy Operator Apps/2026-07-25/`

That directory contains a manifest recording the archived bundles, hashes, and
bundle identities. A rollback therefore consists of:

1. restore the archived application bundle required for the rehearsal;
2. set `PBE_ENABLE_LEGACY_SIDECAR=1` only for the connector process involved;
3. restart the connector;
4. run the read-only cutover audit and the native parity rehearsal again;
5. remove the flag and return to the native-only state.

The browser Owner compatibility code is also preserved behind the documented
`data-owner-writer` gate. No historical state was deleted during cutover.

## Operational checks

Run the inventory:

```bash
python3 scripts/native_backstage_cutover_audit.py
```

Run the representative rehearsal:

```bash
python3 scripts/native_owner_parity_rehearsal.py
```

Run the full repository gates:

```bash
npm test
npm run validate
(cd native/PhotosByElieBackstage && swift test)
```
