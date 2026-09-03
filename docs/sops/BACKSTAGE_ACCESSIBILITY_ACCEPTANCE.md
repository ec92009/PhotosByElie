# Backstage installed accessibility acceptance

Use this checklist after the automated read-only installed-app smoke passes. It covers behavior that runtime tree inspection cannot establish on its own.

## Automated gate

1. Build, sign, and install the intended Backstage version and build.
2. Run `native/PhotosByElieBackstage/scripts/run-installed-accessibility-smoke.zsh`.
3. Confirm all twelve sidebar surfaces pass, Command-A reaches the guarded Gallery handler, and busy, selected, disabled, and safe-failure states are exposed.
4. Confirm the harness reopens Backstage normally and no Photos, Owner, fixture, publication, upload, delivery, update, or cloud action was created.

## VoiceOver and keyboard gate

1. Turn on VoiceOver with Command-F5 and start at the Backstage window.
2. Move through the fixture picker, Sidebar, current workspace, and toolbar. Confirm the spoken order follows the visible order and does not jump into hidden panels.
3. Navigate to Gallery, Review, Waste Basket, Uploads, Client Delivery, Storage Maintenance, and Updates. Confirm each page announces its heading and every primary control has a useful name, state, and explanation.
4. In Gallery and Review, confirm the selected card or row is announced as selected. Confirm disabled actions say they are dimmed and busy feedback says it is in progress.
5. Expand and collapse one disclosure group. Confirm VoiceOver announces its expanded and collapsed state.
6. With no text field focused, press Command-A in Gallery, Review, Waste Basket, and Uploads. Confirm it selects only the loaded items. With a text field focused, confirm it selects text instead.
7. Exercise one non-destructive keyboard action and its matching pointer control. Confirm both produce the same immediate feedback and disabled/busy behavior.
8. Open and cancel one confirmation dialog using only the keyboard. Confirm focus enters the dialog, the title and consequences are announced, Escape cancels, and focus returns to the invoking control.
9. Turn VoiceOver off with Command-F5 and record the installed version/build plus any failures in the ticket receipt.

The automated launch argument is private to the harness. A normal launch never enters smoke mode.
