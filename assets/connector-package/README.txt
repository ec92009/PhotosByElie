PhotosByElie Mac Connector
==========================

This legacy Owner-only package is retired from normal use. Signed PhotosByElie
Backstage owns the connector and starts bounded work only when an authorized
Owner action needs it. Do not run the installer for ordinary operation.

The package remains only as a deliberate rollback rehearsal while PBB-106
soaks. Set `PBE_ENABLE_LEGACY_CONNECTOR_LAUNCHAGENT=1` explicitly before
running the command, and remove the LaunchAgent again after the rehearsal.
Apple Photos access belongs to the signed PhotosByElie Backstage app; this
package does not install a second Photos helper or request a second Photos
permission identity.

1. For normal operation, open PhotosByElie Backstage and grant it Full Photos access if
   macOS asks. Backstage must be running for PhotoKit work; connector jobs fail
   closed when the signed app is unavailable.
2. For rollback-only rehearsal, run the command from a terminal with the explicit
   environment opt-in, then confirm the Mac appears as online on the authenticated
   Owner page.

The download does not contain a connector token. Each Mac must use its own
revocable credential. During rollback only, the connector exposes this Mac's
connector id on a localhost-only status endpoint so the Owner page can target
the Mac you are using. The first package is intended for Elie's David and Max
Macs. Distribution beyond those vetted Macs should use an Apple-signed and
notarized package.
