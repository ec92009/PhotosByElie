# PBE-197 passive deliverable views

PBE-194 already rejects the original self-JSON/HTML manifest pointer exploit.
This change independently completes the passive-output contract: PDF, MP4,
WebM and ZIP are the exact allowed MIME types for their product types. Uploads
and transcoder results validate before storage; bound reads validate stored
object MIME before views, downloads, capability creation and redemption.
Unknown or active MIME fails closed. ZIP always downloads as an attachment.

Responses carry nosniff and enforced CSP:
`sandbox allow-same-origin; script-src 'none'; base-uri 'none'; form-action 'none'`.
The sandbox does not allow scripts or forms. Same-origin is retained because
an opaque media origin prevented legitimate video playback in browser testing.

Verification: the new passive-policy regression fails against the prior module
and passes after the fix. Tests cover active MIME variants, descriptor override,
HTML-looking bytes under every passive type, view/head/download and bearer links,
persisted active MIME and invalid transcoder output. 97 focused Worker tests pass;
full source tests passed 343 Node +489 Python before the final CSP compatibility
adjustment, then focused tests passed again. Wrangler deployment dry-run passed.
Independent source review found no bypass and requested PDF compatibility proof.

Actual Chromium-based in-app browser fixtures with final headers: a valid PDF
rendered its text, a generated MP4 played to 0:02/0:02, and an HTML fixture stayed
at “Script blocked by sandbox” instead of executing its DOM mutation/beacon.
The initial opaque sandbox blocked video; final policy corrected it. These were
local synthetic fixtures, not private/customer media or production requests.
Other browsers and deployed response headers have not been verified.

Deployment remains the existing unattended Worker gate, together with PBE-194
and PBE-196 migration ordering. No production change is claimed.
