# PBB-190 — Library-qualified Photos preview identity

The Friends and Family Gallery screenshot in build356 shows Photo unavailable cards beside working images with the same filenames. Read-only Owner inspection found96 library-qualified cloud IDs, all96 with an exact canonical cloud-ID counterpart. The native cloud resolver rejected a fourth colon component before PhotoKit lookup, so these cards could not resolve even when the canonical record could.

The resolver now validates a bounded optional absolute .photoslibrary qualifier and sends the exact three-component cloud identity to PhotoKit. The path is never accessed. It rejects relative paths, URLs, traversal, control characters and oversized inputs. Original database keys, duplicate records, fixture decisions, titles/keywords, approval/upload state and Photos originals are unchanged. It does not substitute photos by filename or guess missing local identities.

Verification and installed receipt follow. Candidate v266.0/build357.

All430Swift tests in32suites pass, including qualified identity normalization, distinct-identity preservation, malformed suffix rejection, and existing Gallery/Review/source-resolution regressions. Live photo resolution is still to be verified after installation.
