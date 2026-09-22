# PBB-190 — Library-qualified Photos preview identity

The Friends and Family Gallery screenshot in build356 shows unavailable preview cards beside working images. Read-only Owner inspection found96 library-qualified cloud identifiers, all with exact canonical cloud-ID counterparts. The resolver originally rejected the optional library qualifier before asking PhotoKit to resolve the identity.

The repair accepts a bounded absolute .photoslibrary qualifier, preserves the full serialized identity for PhotoKit, and tries its exact three-component cloud identity as a fallback. It does not access the library path, use filenames as identity, merge records, or rewrite fixture decisions. Relative paths, URLs, traversal, control/format characters and oversized inputs remain invalid.

## Failed candidates and release-mode regression

Candidates357–359 passed430debug tests and signing but failed installed preview verification. They were not published. Diagnostic candidate360 confirmed that the 121-byte qualified identifiers reached the resolver intact but produced no lookup candidates. Optimized tests reproduced the failure (six failed expectations); debug and isolated parser checks had passed.

Predicate diagnostics then identified the rejection: the method-reference control-character check reported ordinary paths as containing controls in the package release build. The final implementation checks Unicode scalar categories explicitly and removes the temporary lookup diagnostics. No claim is made about the underlying compiler/Foundation cause beyond this observed difference.

Candidate v266.4/build361 validation and installed receipt follow.

The full optimized suite exposed the same method-reference validation failure at both CustomerPhotoLinkSQLiteStore call sites (15 failed expectations across customer-link tests). The identical explicit Unicode-category correction is applied there; this preserves the existing rejection of controls and format characters.

## Verified release receipt — 2026-09-23 01:21 CEST

- Source:38d32068 on release/backstage, pushed to origin.
- All430 tests in32 suites pass in release configuration. Earlier debug suite also passed430; the release suite was necessary to catch this defect.
- Signed v266.4/build361 installed at /Applications/PhotosByElie Backstage.app. Strict deep codesign verification passed; signer Apple Development: Elie Cohen (L9958JSM92). Normal quit/install/relaunch used; previous installations retained in the local rollback directory.
- Installed Friends and Family Gallery: bounded IMG_436 search returned24 records. Previously unavailable IMG_4369,4368,4367,4366,4365,4364,4362 cards all rendered. Scrolling to the lower row showed IMG_4362 sharpen from its initial thumbnail to the idle high-definition preview. No unavailable cards remained in this24-record verification window.
- This verifies the reported group, not every one of the96 qualified identities in the database. Duplicate records remain distinct; this repair changes resolution only.
- Existing signed-runtime900px/1800px watermarked preview smoke passed.
- Published archive and update manifest through the standard publisher, with publisher read-back verification. Public archive:https://download.photos-by-elie.com/backstage/releases/PhotosByElie-Backstage-v266.4-build-361.zip . Earlier failed candidates357–360 were not published.
- Temporary IMG_436 search removed; Friends and Family / Culling — Undecided filters restored. No hide/pick/approve/upload/generation action used for verification. Normal startup Photos discovery ran during relaunches.
