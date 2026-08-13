# Backstage update contract

PBE-134 defines the safe local update boundary for the private macOS Backstage
operator app. The update path is deliberately separate from the public Owner
gallery, Photos Bridge write-back, fixture state, and `Owner.sqlite`.

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
| `downloadURL` | The approved HTTPS artifact URL. The app does not infer or invent this URL. |
| `fileSize` | Exact archive byte count. |
| `sha256` | Exact 64-character SHA-256 digest of the downloaded archive. |
| `trust.teamIdentifier` | Expected Apple Developer team identifier. |
| `trust.signingIdentity` | Expected non-ad-hoc signing identity/authority. |
| `trust.designatedRequirement` | Expected macOS designated requirement expression. |

The `version`, `build`, bundle identifier, trust metadata, size, and digest must
be generated from the same real signed artifact. A release tool must refuse to
write a manifest when the artifact is missing, ad-hoc signed, unsigned, has a
different bundle identity, or cannot be verified by `codesign --verify
--deep --strict`.

The repository currently has no approved cloud manifest endpoint, published
Backstage archive, or production rollback/install mechanism. Therefore the
signed app must not contain a guessed production URL, and local tests use only
injected HTTPS fixture URLs. Configuring `PBEBackstageUpdateManifestURL` in a
future signed build is a release-owner decision, not a local default.

## State and safety

The native state model distinguishes `checking`, `current`, `updateAvailable`,
`downloading` with received/total bytes, `verified`, and `failed`. A failed
state includes recovery guidance. A downgrade, incompatible minimum OS, wrong
bundle identity, invalid manifest, size mismatch, SHA-256 mismatch, archive
shape mismatch, or signature/trust mismatch fails closed.

Downloads are written below the app's user cache directory in a unique,
isolated review directory. A rejected temporary download is removed; after
verification, the archive and extracted app remain there for review. The updater
has no install, overwrite, launch, Keychain,
Photos, connector, Owner database, fixture, catalog, upload, or publication
operation. Installation and rollback remain separate, explicit mechanisms that
must be designed and accepted before production use.

Verification checks, in order:

1. The configured manifest endpoint and the manifest artifact URL are HTTPS.
2. The release is newer and compatible with the running stable bundle identity.
3. The downloaded archive has the exact declared byte count and SHA-256.
4. The archive contains one app bundle with the declared bundle ID, version,
   and build.
5. `codesign` verifies the bundle, team identifier, signing authority, and
   designated requirement. For an installed app bundle, the manifest trust
   values must also match the running app's trust values; a signer change is
   blocked rather than silently risking new Photos/TCC or Keychain identity.

Only after all five checks does Backstage show `verified` and offer to reveal
the isolated artifact for a separately reviewed manual action.
