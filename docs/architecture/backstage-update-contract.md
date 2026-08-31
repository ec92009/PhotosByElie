# Backstage update contract

PBE-134 defines the safe local update boundary for the private macOS Backstage
operator app. The update path is deliberately separate from the public Owner
gallery, Backstage's PhotoKit write-back, fixture state, and `Owner.sqlite`.

PBB-92 makes Backstage and its embedded PhotoKit capability one release unit.
The updater must never install, restore, or launch a standalone Photos Bridge
artifact. A cold launch recoverably retires any legacy live Bridge bundle,
including `.previous` and `.rollback` siblings.

## Manifest

The authoritative release service must publish one HTTPS JSON manifest with
these fields:

| Field | Requirement |
| --- | --- |
| `schemaVersion` | Integer `1`. Unknown schemas fail closed. |
| `product` | Exactly `PhotosByElie Backstage`. |
| `bundleIdentifier` | Exactly `com.photosbyelie.backstage`. This is the stable Photos/TCC/Keychain identity. |
| `version` | Dotted numeric visible release version, from the signed artifact's `CFBundleShortVersionString`. |
| `build` | Numeric build, from the signed artifact's `CFBundleVersion`. |
| `minimumOSVersion` | Dotted numeric macOS minimum, checked before download. |
| `releaseNotes` | Human-readable notes shown before download. |
| `artifactFormat` | Exactly `zip`; the archive must contain exactly one Backstage `.app` bundle. |
| `architectures` | New official releases are exactly `arm64` (Apple silicon only). Legacy universal `arm64` + `x86_64` manifests remain readable for rollback compatibility. |
| `downloadURL` | The approved HTTPS artifact URL. The app does not infer or invent this URL. |
| `fileSize` | Exact archive byte count, from 1 byte through the hard 1 GiB archive ceiling. |
| `sha256` | Exact 64-character SHA-256 digest of the downloaded archive. |
| `trust.teamIdentifier` | Expected Apple Developer team identifier. |
| `trust.signingIdentity` | Expected non-ad-hoc signing identity/authority. |
| `trust.designatedRequirement` | Expected macOS designated requirement expression. |

The `version`, `build`, bundle identifier, trust metadata, size, and digest must
be generated from the same real signed artifact. A release tool must refuse to
write a manifest when the artifact is missing, ad-hoc signed, unsigned, has a
different bundle identity, is not the current arm64 Apple-silicon release
slice, or cannot be verified by `codesign --verify
--deep --strict`.

The approved production manifest is
`https://download.photos-by-elie.com/backstage/releases/latest.json`. Signed
release builds embed that exact URL as `PBEBackstageUpdateManifestURL`.
Cloudflare serves only `latest.json` and immutable archives named
`PhotosByElie-Backstage-v<version>-build-<build>.zip` below that release path;
other release object names are not public routes.

`scripts/publish_backstage_release.zsh` verifies the signed app, creates the
archive and manifest from the same bytes, uploads and re-reads the immutable
archive first, preserves the previous manifest as immutable rollback history,
and writes `latest.json` last. A failure before that final write leaves clients
on the previous verified release. Discovery of a newer compatible manifest
immediately starts one bounded download and verification pass; concurrent
checks cannot replace or duplicate it. Installation remains a separate operator
action after verification: pressing **Install and run new version** starts the
guarded installer immediately, without a second confirmation dialog or Finder
review step. It stages a complete copy beside the canonical app, repeats
archive, Info.plist, version/build, signature, and designated-requirement
checks, preserves the incumbent signed app below the private Backstage rollback
directory, atomically exchanges the staged app into `/Applications/PhotosByElie
Backstage.app`, launches that canonical new app, and closes the older copy only
after macOS confirms the new process started.

Before replacement, the installer inventories only exact hidden
`.PhotosByElie Backstage.install-<UUID>.app` siblings. It retains recent
signature-verified stages as potentially active, retains wrong-identity or
invalid-signature paths as unsafe, and removes only old stages whose Backstage
identity and release trust both verify. A failed reconciliation leaves the
canonical app and rollback untouched. After a successful exchange, failure to
remove the displaced incumbent is surfaced with its exact audit path instead
of being silently ignored. Cleanup restores owner-write permission only on
directories inside that exact verified installer-owned stage so the sealed,
read-only Owner runtime cannot strand a partially removed app bundle.

## State and safety

The native state model distinguishes `checking`, `current`, the transient
`updateAvailable` handoff, `downloading` with received/total bytes, `verified`,
`installing`, `installed`, and `failed`. A newer compatible release moves from
the handoff directly into one automatic download; the handler-level operation
latch rejects concurrent checks or download starts. A failed state includes
recovery guidance. A downgrade,
incompatible minimum OS, wrong bundle identity, invalid manifest, size
mismatch, SHA-256 mismatch, archive shape mismatch, signature/trust mismatch,
or staging/install verification failure fails closed.

Downloads start automatically after compatible update discovery and stream
through a fixed 64 KiB buffer directly into a file below the
app's user cache directory in a unique, isolated review directory. The transport
rejects a declared HTTP length or streamed byte that exceeds either the manifest
size or the hard 1 GiB archive ceiling; it never accumulates the complete archive
in `Data`. A rejected partial or temporary download is removed; after
verification, the archive and extracted app remain there for review. The
download-and-verify path has no install, overwrite, launch, Keychain, Photos,
connector, Owner database, fixture, catalog, upload, or publication operation.
After verification, the explicit **Install and run new version** button is the
installation boundary; the separate installer does not add another modal. It
may copy and atomically exchange only the canonical Backstage app, retain one
verified rollback bundle, then launch the canonical replacement and terminate
the older copy only after launch succeeds. It never
touches Photos, Keychain, connector, Owner database, fixture, catalog, upload,
or publication state. Any staging or verification failure leaves the
incumbent app untouched; any failed post-swap verification atomically restores
it. If installation succeeds but macOS cannot start the new app, the old copy
stays open and shows the canonical app path for manual recovery.

Verification checks, in order:

1. The configured manifest endpoint and the manifest artifact URL are HTTPS.
2. The release is newer and compatible with the running stable bundle identity.
3. The downloaded archive has the exact declared byte count and an incrementally
   computed SHA-256.
4. Before extraction, bounded `zipinfo` central-directory inspection rejects
   unsafe paths, more than 50,000 entries, multiple top-level app bundles, and
   per-entry or cumulative declared expansion above 4 GiB. The bounded listing
   itself may not exceed 16 MiB.
5. After extraction and before signature verification, a filesystem walk again
   enforces the 50,000-entry and 4 GiB regular-file ceilings, rejects unsupported
   entry types, and rejects links that resolve outside the isolated directory.
   The archive must yield one app bundle with the declared bundle ID, version,
   and build.
6. `codesign` verifies the bundle, team identifier, signing authority, and
   designated requirement. For an installed app bundle, the manifest trust
   values must also match the running app's trust values; a signer change is
   blocked rather than silently risking new Photos/TCC or Keychain identity.

Any download, inspection, extraction, tree-validation, checksum, or signature
failure removes the unique temporary directory. Only after all six checks does
Backstage show `verified`. The operator presses **Install and run new version**
to enter the canonical installer and launch handoff without another confirmation
or intermediary click. Finder replacement is not the supported installation
path.

## Connector runtime materialization

Backstage's release path materializes the bounded connector runtime into a new
versioned directory below `~/Library/Application Support/PhotosByElie`. It
copies file bytes rather than preserving links, refuses any tracked symlink or
non-regular source entry, records exact paths, sizes, modes, and SHA-256 hashes
in a runtime manifest, and makes the complete snapshot read-only. There is no
LaunchAgent installer or separately downloadable connector package.

Mutable project data remains under the stable configured `repoRoot`. Executable
code, imports, and helper launches use the separate `runtimeRoot`; the mode-600
connector config does not record the source checkout used to create that
snapshot. Release validation runs the runtime's local `--status` check before
activation, and every connector start validates manifest coverage,
hashes, modes, required files, and the absence of symlinks or unmanifested
files. Status validation performs no Worker request and exposes no credential.

Replacing a runtime remains part of the signed Backstage release gate. The
release path does not silently delete an older runtime, and bounded launches
never create a login item or persistent background service.
