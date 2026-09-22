# PBB-190 — Library-qualified Photos preview identity

The Friends and Family Gallery screenshot in build356 shows Photo unavailable cards beside working images with the same filenames. Read-only Owner inspection found96 library-qualified cloud IDs, all96 with an exact canonical cloud-ID counterpart. The native cloud resolver rejected a fourth colon component before PhotoKit lookup, so these cards could not resolve even when the canonical record could.

The resolver now validates a bounded optional absolute .photoslibrary qualifier and passes the full stored cloud identity to PhotoKit first, then tries its exact three-component form. The path is never accessed. It rejects relative paths, URLs, traversal, control characters and oversized inputs. Original database keys, duplicate records, fixture decisions, titles/keywords, approval/upload state and Photos originals are unchanged. It does not substitute photos by filename or guess missing local identities.

Verification and installed receipt follow. Candidate v266.1/build358.

All430Swift tests in32suites pass, including qualified identity preservation and ordered canonical fallback, distinct-identity preservation, malformed suffix rejection, and existing Gallery/Review/source-resolution regressions. Live photo resolution is still to be verified after installation.

Candidate357 passed tests but failed installed verification: the same IMG_4369 card remained unavailable after explicit Retry. It was not published. Candidate358 preserves the complete PhotoKit serialization, including its library qualifier, before canonical fallback.

Candidate358 also failed installed verification. Candidate359 applies the same direct fetch then cloud mapping path to both full and canonical identifiers, addressing the bypass of direct lookup for the canonical fallback. No failed candidate has been published.
