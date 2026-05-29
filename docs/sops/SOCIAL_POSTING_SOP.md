# PhotosByElie Social Posting SOP

Use this workflow when the `pbe-daily-social-posts` automation prepares social packages and the current browser session is already authenticated.

## Source Rules

- Use only public PhotosByElie catalog data, public R2 preview URLs, and existing watermarked social/export assets.
- Do not use private masters, unwatermarked private renders, buyer downloads, Owner-only metadata, ignored Owner review JSON, passwords, tokens, cookies, or API secrets in public posts.
- Prepare a first-party PhotosByElie destination before posting. Prefer a campaign page; use a gallery URL only when a campaign is unnecessary or cannot be generated safely.
- After adding or changing campaign manifests under `assets/campaigns/`, run `npm run campaigns:index` so the homepage pinned collections shelf is refreshed newest-first before publishing social links.
- Pinterest packages must contain exactly 5 images. Facebook and Instagram packages should contain 5 to 10 images.

## Facebook Page Post In Built-In Browser

1. Open the Photos By Elie Facebook Page in the Built-in Browser and confirm the active identity is the Page before posting.
2. Open the Page composer.
3. Insert the platform caption and first-party PhotosByElie URL.
4. If Facebook creates a misleading link preview, remove only the preview; keep the URL in the caption.
5. Upload/paste the staged watermarked images from `socials/Facebook/YYYY-MM-DD/<theme>/images/`.
6. Verify the composer still shows the intended caption, image count, and Page identity.
7. Click through Facebook's post settings and click the final `Post` only after action-time confirmation.
8. Dismiss post-publish prompts such as messaging, ads, or alternate share formats unless the user explicitly asks for them.
9. Verify the Page post is visible and record the post/permalink when available.

## Facebook Personal Repost

Use this to share a fresh Photos By Elie Page post from Elie Cohen's personal account.

1. Switch back to the personal account.
2. Open the fresh Page post permalink directly when possible. This avoids accidentally selecting an older post's action row after scrolling.
3. Click the post's `Send this to friends or post it on your profile.` control, then choose `Share to Feed`.
4. Use this evergreen personal caption unless the user asks for a different text:

```text
Je viens de publier de nouvelles photos sur ma page Photos By Elie. Venez jeter un coup d'oeil.
```

5. In the personal `Write post` share modal, prefer DOM CUA targeting over OS-level keystrokes:

```js
const visible = await tab.dom_cua.get_visible_dom();
// In the visible DOM, find the contenteditable role="textbox" inside the
// Write post dialog, not the comment textbox beneath the original post.
await tab.dom_cua.click({ node_id: "<write-post-textbox-node-id>" });
await tab.dom_cua.keypress({ keys: ["ControlOrMeta", "A"] });
await tab.dom_cua.keypress({ keys: ["Backspace"] });
await tab.dom_cua.type({
  text: "Je viens de publier de nouvelles photos sur ma page Photos By Elie. Venez jeter un coup d'oeil."
});
```

6. Verify the exact caption appears in `tab.playwright.domSnapshot()` before clicking `Share`.
7. Click the final `Share` only after action-time confirmation from the user.
8. Verify the personal profile contains the caption and shared Photos By Elie post card.

Notes from the 2026-05-26 run:

- The Page composer accepted the normal caption path, but the personal share modal used a nested rich-text `contenteditable` widget that resisted normal `fill`, `type`, and OS-level paste attempts.
- Browser viewport coordinates and macOS screen coordinates can differ inside Codex. Do not use `cliclick` coordinates unless they have been confirmed against a current full-screen screenshot.
- `tab.dom_cua.get_visible_dom()` exposed the reliable node id for the personal share modal textbox. `tab.dom_cua.type()` then inserted the ASCII evergreen caption correctly.
- Verify with the DOM snapshot, not only the visual modal, before pressing the final publish/share button.
