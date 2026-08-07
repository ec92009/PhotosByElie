# PhotosByElie Backstage native app

SwiftPM remains the release build and command-line test source of truth.

## Control CLI

The release executable has a non-UI control mode for supported remote checks:

```sh
scripts/backstage-control.zsh health --pretty
scripts/backstage-control.zsh doctor --pretty
scripts/backstage-control.zsh release verify --pretty
scripts/backstage-control.zsh photos health --pretty
scripts/backstage-control.zsh photos authorize --pretty
scripts/backstage-control.zsh real-estate originals preflight \
  --gallery corine-real-estate \
  --items-file /path/to/items.json \
  --pretty
```

The wrapper invokes the installed app binary with `--control`, preserving the
Backstage bundle identity for PhotoKit/TCC inspection. Responses are JSON with
`schemaVersion`, `ok`, release/helper metadata, authorization state, connector
identity, and an actionable `message`. The health commands are read-only and
never invoke Computer Use or open the Backstage UI. `release verify` checks the
Backstage/helper release path without requiring first-run Photos/TCC access.
`health`, `doctor`, and `photos health` include that access gate.
`photos authorize` is an explicit PhotoKit permission request and reports the
standard macOS prompt
result without automating the prompt. Exit code `0` means local readiness, `2`
means a readiness check failed or one or more originals are unavailable, `1`
means an authentication/API failure, and `64` means invalid CLI arguments.

The Real Estate preflight uses the installed Backstage Owner device credential
to renew a short-lived Bearer session and call only the read-only preflight
endpoint. Its items file is a JSON array; every item requires `photoId` and
`albumSlug`, while `sourceFile`, `title`, and `sortIndex` are optional. The
command never creates a download token, order, email, client message, or gallery
change. Owner Bearer credentials are not accepted by the separate download-
session endpoint.

## Xcode Canvas

Open [`PhotosByElieBackstage.xcodeproj`](PhotosByElieBackstage.xcodeproj) in
Xcode. Keep the **PhotosByElieBackstage** scheme and **My Mac** destination
selected. Do not open only the package folder for Canvas work: Xcode 26.6 can
render those package previews, but it does not expose their source-selection
map.

The native project supplies the `ENABLE_DEBUG_DYLIB` app host required for
Selectable mode. It compiles the production Backstage UI sources directly into
that app because Xcode 26.6 stops source selection at framework boundaries;
OwnerCore remains a dependency framework.

The Canvas executable has its own `com.photosbyelie.backstage.canvas` bundle
identity and an inert one-pixel scene. It never constructs the production app,
so Canvas refreshes cannot check the production Keychain session, start Photos
synchronization, or run a workspace task. Xcode injects only the selected
`#Preview` into that process.

Use the focused production-component previews when editing in Canvas:

- `CullingCanvasControls.swift` — **Culling — Controls**
- `ReviewCanvasInspector.swift` — **T/K — Inspector**
- `UploadHeaderView.swift` — **Uploads — Header**

These are the same components used by the production workspaces, not preview
copies. Their controls expose **Modify in Source Editor** and respond to a
Canvas double-click. The full-workspace previews remain useful for layout, but
Xcode 26.6 treats those very large view bodies as opaque Canvas elements.

The project is generated from [`project.yml`](project.yml):

```sh
cd native/PhotosByElieBackstage
xcodegen generate
```

After changing build targets or version metadata, regenerate the project and
commit both `project.yml` and `PhotosByElieBackstage.xcodeproj`.
