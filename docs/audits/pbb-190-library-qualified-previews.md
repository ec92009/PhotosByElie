# PBB-190 — Library-qualified Photos preview identity

The Friends and Family Gallery screenshot in build356 shows unavailable preview cards beside working images. Read-only Owner inspection found96 library-qualified cloud identifiers, all with exact canonical cloud-ID counterparts. The resolver originally rejected the optional library qualifier before asking PhotoKit to resolve the identity.

The repair accepts a bounded absolute .photoslibrary qualifier, preserves the full serialized identity for PhotoKit, and tries its exact three-component cloud identity as a fallback. It does not access the library path, use filenames as identity, merge records, or rewrite fixture decisions. Relative paths, URLs, traversal, control/format characters and oversized inputs remain invalid.

## Failed candidates and release-mode regression

Candidates357–359 passed430debug tests and signing but failed installed preview verification. They were not published. Diagnostic candidate360 confirmed that the 121-byte qualified identifiers reached the resolver intact but produced no lookup candidates. Optimized tests reproduced the failure (six failed expectations); debug and isolated parser checks had passed.

Predicate diagnostics then identified the rejection: the method-reference control-character check reported ordinary paths as containing controls in the package release build. The final implementation checks Unicode scalar categories explicitly and removes the temporary lookup diagnostics. No claim is made about the underlying compiler/Foundation cause beyond this observed difference.

Candidate v266.4/build361 validation and installed receipt follow.

The full optimized suite exposed the same method-reference validation failure at both CustomerPhotoLinkSQLiteStore call sites (15 failed expectations across customer-link tests). The identical explicit Unicode-category correction is applied there; this preserves the existing rejection of controls and format characters.
