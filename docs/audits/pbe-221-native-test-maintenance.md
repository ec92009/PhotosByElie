# PBE-221 native parity assertion maintenance

The integrated checkout reproduced exactly two failures in the unchanged
`scripts/native_culling_parity_test.py` baseline. The full run passed 32
pretests and 288 main Node tests, then 487 of 489 Python tests. The failing
methods were `test_window_and_preview_layout_persist_between_launches` and
`test_culling_preview_is_bounded_and_collapsible`.

Commit `b09b6b9f3458ee3c3c0689157d4b8338ede71343` deliberately replaced the
model-private culling/review preference constants with
`BackstagePanelPreferenceKey.cullingInspectorVisible` and
`BackstagePanelPreferenceKey.reviewInspectorVisible`. The model still reads
and writes these independent preferences. `BackstageWindowState.swift` retains
their exact stored strings, `PhotosByElieBackstage.cullingPreviewPanelVisible`
and `PhotosByElieBackstage.reviewPreviewPanelVisible`. Native source is
byte-identical to the prepared baseline in this integration.

The maintenance patch updates those four obsolete symbol assertions and adds
checks for both exact persisted key strings. All window, bounded preview,
collapse, independent visibility, focus and layout assertions remain present.
The native implementation is unchanged.

Verification on 2026-11-17

- Before maintenance, the isolated Python native parity suite ran 68 tests with
  exactly the same two failures.
- After maintenance, all 68 tests passed.
- `swift test --filter previewPanelVisibilityPersistsByWorkspace` built the
  native test targets and passed the existing behavior test using an isolated
  UserDefaults suite and `InertPhotoLibrary`. Gallery hidden and Review visible
  survive construction of a new model independently.
- Private logs are in `tmp/pbe-221-evidence/`. This source/test receipt establishes
  no installed native release or production behavior.
