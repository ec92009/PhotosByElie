# Photos By Elie North Star

Last updated: 2026-08-27

## Purpose

Photos By Elie should become a cloud-managed photo business and private sharing system.

The overarching goal is to make money from the enterprise. Product choices, workflow investments, and polish should be judged by whether they improve revenue, conversion, repeat sales, client delivery, customer trust, or market learning.

The main near-term asset is Elie's Apple Photos library of 57K+ photos. Many of those photos may be usable for the public gallery and store, so finishing intake, curation, metadata, publication, and protected sale/download paths for that library has priority over hypothetical future verticals.

Elie can photograph travel, art, Real Estate, family, or events; decide who may see what; publish safely; sell downloads where appropriate; deliver Real Estate PDFs/videos; and manage Owner workflows from Backstage on any enrolled Mac rather than being tied to one specific Mac.

"Finished" does not mean no future ideas. It means the system is dependable enough to use in real life without Codex babysitting every step.

## Commercial Compass

- Optimize the offer around revenue, not technical completeness for its own sake.
- Prioritize the Apple Photos intake-to-sellable-gallery pipeline because it unlocks the largest real inventory already available.
- Treat the public photo store, Real Estate delivery, family/private sharing, and event sales as offers that can be tested and improved.
- Treat Real Estate, family sharing, and private event sales as valuable future offers, but secondary to making the existing photo library discoverable, curated, protected, and purchasable.
- Perform market research where possible: comparable photo-download pricing, Real Estate media packages, private event gallery norms, buyer search behavior, SEO demand, and competitor positioning.
- Prefer work that helps answer commercial questions: what sells, to whom, at what price, through which access model, and with what friction.
- Use analytics, checkout rehearsals, client feedback, and real buyer behavior to refine pricing, packaging, gallery presentation, and permissions.
- Keep security and trust as commercial requirements: unpaid downloads, confused access, or weak privacy directly damage the business.

## Finished Means

1. **Public Photo Site**
   - All publishable photos are browsable by gallery, search, metadata, and mobile.
   - Purchasable items are clearly available on desktop and phone.
   - The Apple Photos intake pipeline can turn usable photos from the 57K+ library into curated public catalog entries without one-off heroics.
   - Watermarked previews are public where appropriate.
   - Full-resolution originals are protected.

2. **Commerce**
   - Visitors can buy downloads reliably.
   - Paid users get secure download links and 30-day re-downloads.
   - Unpaid users cannot guess, scrape, or bypass download access.
   - Refund, license, and support language is clear enough to handle real customers.

3. **Real Estate Workflow**
   - Elie can shoot a property, import/select photos, publish a private client gallery, and generate PDF/video deliverables.
   - Client access is scoped to the correct property/gallery.
   - Outputs are cloud-tracked with status, durable links, and failure detail.
   - Local machines are connectors for source import/export, not the permanent control center.

4. **Family And Friends Sharing**
   - Family galleries can include photos that are not public or commercial.
   - Access can be granted by invite, password/link, or Google-style identity.
   - Family groups can have circles such as direct kin, in-laws, and friends.
   - Tombstoned/private material can be revisited safely without accidentally publishing it.

5. **Private Event Sharing And Sales**
   - Event attendees can access a private gallery.
   - Event organizers can invite attendees when allowed.
   - Attendees can buy or download allowed items.
   - Event access does not leak into other galleries or admin powers.

6. **Owner In Backstage**
   - PhotosByElie Backstage is the sole Owner workspace and may run on any enrolled Mac.
   - PBE is a customer-facing web application. It does not expose Owner navigation, provisioning, review, culling, metadata, upload, publication, fixture, lifecycle, or mutation controls.
   - Backstage may open a customer-safe PBE URL to inspect the experience as a visitor or authorized customer. That link carries no Owner capability and cannot upgrade browser authority.
   - Max, David, Curie, or another enrolled Mac may host local source connectors without changing the authoritative fixture or writer. Connectors provide bounded access to Apple Photos and local files; they do not serve a browser Owner workspace.
   - Backstage stores enrolled credentials in macOS Keychain. Enrollment, revocation, and rotation are native Backstage operations rather than PBE browser features.
   - Elie can switch Macs without losing cloud-backed workflow and audit state.

7. **Access And Roles**
   - Roles are clear: Owner/Admin, Real Estate client, event attendee, family, regular buyer, and unregistered visitor.
   - Permissions are attached to galleries/groups, not hardcoded guesses.
   - Invites, memberships, revokes, and audit logs are understandable.
   - Break-glass admin remains available.

8. **Security**
   - Private media and paid downloads are not publicly enumerable.
   - R2/private originals are only exposed through authorized Worker paths.
   - Role and gallery access decisions are tested.
   - Payment/download flows are covered by automated and manual smoke tests.
   - Secrets are out of git.

9. **Visibility**
   - The public site has SEO metadata, Open Graph images, sitemap/canonical URLs, and useful gallery landing pages.
   - Strong collections are curated first.
   - The site can be discovered by people searching for travel, art, and photo downloads.
   - Public-facing text feels intentional, not like an internal tool escaped into daylight.
   - Market research informs offers, pricing, gallery positioning, and SEO priorities.

10. **Operations**
    - There is a compact health dashboard for catalog, R2 coverage, uploads, blocked items, and recent jobs.
    - Common fixes have supported commands instead of ad hoc SQL.
    - Backups, handoff notes, and tickets make the project recoverable.
    - A fresh machine can contribute without relying on tribal memory.

## Wish List

- Sell Elie's camera-made travel and art downloads from a polished mobile-friendly public site; keep AI-generated image archives outside the commercial storefront.
- Finish Apple Photos intake so the 57K+ photo library becomes real sellable inventory, not a dormant archive.
- Publish Real Estate client galleries with PDF/video deliverables.
- Share family/private galleries safely.
- Sell private event downloads with controlled access.
- Manage access, roles, galleries, invites, and workflow state from Backstage on an enrolled Mac.
- Use local connector machines only when hardware/local files are truly required.
- Make every paid/private asset path security-reviewed.
- Improve public discovery and SEO.
- Research and optimize offers so the project can produce real revenue.
- Keep one repo for coherence, while separating buyer app and owner app conceptually.
- Turn "Codex knows how" into durable buttons, commands, tests, and docs.

## Goal Statement

Photos By Elie is finished when Elie can independently run five real workflows end to end:

1. Intake, curate, publish, and sell usable photos from the Apple Photos library.
2. Publish and sell a public photo download.
3. Shoot and deliver a Real Estate property gallery with PDF/video.
4. Share a family/friends gallery privately.
5. Publish a private paid event gallery.

Customer and client portions of all five workflows should work from a normal browser with secure access control, mobile usability, cloud-backed state, and no unpaid access to protected originals. Owner decisions and mutations run only in PhotosByElie Backstage on an enrolled Mac. PBE remains a customer-facing web application, and even a Backstage-opened customer preview carries no Owner authority.

PBB-128 tracks remaining native acceptance outside this boundary. PBE-164's
customer-only cutover was accepted in production on 2026-08-27 with separate
source, signed-release, installed-app, and public-site receipts. That completed
cutover does not retire the restricted enrollment and recovery surface tracked
by PBB-133, or claim private and fixture-wide customer-link coverage that still
requires exact delivery evidence.

## Deviation Check

When planning or implementing Photos By Elie work, use this document as the project compass.

Warn Elie when proposed work appears to drift away from this North Star, especially when it:

- Adds local-only workflow state instead of cloud-backed or connector-backed state.
- Improves internal tooling while leaving public/mobile/customer workflows blocked.
- Bypasses role/access/security boundaries for convenience.
- Creates one-off SQL/file/manual fixes where a supported command or UI is needed.
- Prioritizes polish before the four real end-to-end workflows are usable.
- Makes protected media easier to expose, enumerate, or download without payment/access.
- Treats the project as an engineering playground while postponing offer clarity, market research, pricing, conversion, or sales paths.

Deviation is allowed when intentional. The habit is to name it clearly before wandering too far.
