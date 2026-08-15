PhotosByElie Mac Connector
==========================

This Owner-only package installs the background PhotosByElie connector on a
vetted Mac. Apple Photos access belongs to the signed PhotosByElie Backstage
app; this package does not install a second Photos helper or request a second
Photos permission identity.

1. Move the unzipped folder somewhere you can keep temporarily.
2. Double-click "Install PhotosByElie Connector.command".
3. Paste the separate connector token issued for this Mac when prompted.
4. Open PhotosByElie Backstage on the Mac and grant it Full Photos access if
   macOS asks. Backstage must be running for PhotoKit work; connector jobs fail
   closed when the signed app is unavailable.
5. Confirm the Mac appears as online on the authenticated Owner page.

The download does not contain a connector token. Each Mac must use its own
revocable credential. The connector also exposes this Mac's connector id on a
localhost-only status endpoint so the Owner page can target the Mac you are
using. The first package is intended for Elie's David and Max Macs. Distribution
beyond those vetted Macs should use an Apple-signed and notarized package.
