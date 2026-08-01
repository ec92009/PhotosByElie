# PhotosByElie Backstage native app

SwiftPM remains the release build and command-line test source of truth.

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
