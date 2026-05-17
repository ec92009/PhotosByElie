# Max to David Automation Handoff

Use this file for instructions prepared on Max for David, the always-on machine. David should treat these as automation prompts or recurring job specs, then report results in `DAVID2MAX.md`. Use `MAX_DAVID_CHAT.md` for quick acknowledgements and short coordination messages.

## Operating Rules

- Repo: `/Users/ecohen/Dev/PhotosByElie`
- Run from the repo root.
- Start every automation run with:

```bash
cd /Users/ecohen/Dev/PhotosByElie
git pull --ff-only origin main
```

- Do not rewrite image/JPG metadata.
- Do not use the keyword blacklist to filter photos. It only removes useless keyword strings from generated metadata.
- If an automation creates tracked changes, run validation before committing.
- Use commit prefix `photosbyelie:`.
- Push successful commits to `main`.
- Record what happened in `DAVID2MAX.md`.

## 2026-05-17 Install Max Instruction Poller

Prompt for David:

```text
In /Users/ecohen/Dev/PhotosByElie, pull latest main, read docs/sops/MAX_DAVID_SYNC_SOP.md and HANDOFF.md, then run zsh scripts/install_david_instruction_poll.zsh. Confirm in DAVID2MAX.md that the LaunchAgent was installed, the poll log exists, and David will poll GitHub/MAX2DAVID.md at the top of every minute. Do not change Owner.sqlite during this acknowledgement.
```

## 2026-05-13 R2-Only Preview Cleanup

Prompt for David:

```text
In /Users/ecohen/Dev/PhotosByElie, pull main and mirror Max's R2-only preview cleanup. Public and localhost gallery previews must resolve from R2/CDN keys only, never from local preview folders.

Specific cleanup target:
- Remove any `assets/expo` and `assets/reserve` directories from the David checkout if present. These folders are retired and should not be recreated.
- Remove Hidden preview image payload too: delete `assets/hidden/**/*.jpg`, `.DS_Store`, and per-country `.gitkeep` placeholders. Keep `assets/hidden/hidden-blacklist.json` and `assets/hidden/hidden-data.json` as JSON state only.
- Keep R2 object keys such as `expo/<photo-id>_900.jpg` and `expo/<photo-id>_1800.jpg`; those are bucket keys, not local paths.
- Remove or flag any code that serves, fetches, syncs, or validates browser previews from `assets/expo` or `assets/reserve`.
- `photos-data.js`, `home-data.js`, `worker/photos-catalog.generated.mjs`, Hidden data, review queues, and sidecar files should not contain local `./assets/expo/...`, `./assets/reserve/...`, or `./assets/hidden/...` preview URLs.
- Do not rewrite JPG/source embedded metadata.
- After cleanup, run `rg -n "\\./assets/(expo|reserve|hidden)|assets/(expo|reserve|hidden)/.*\\.jpg|localPreview|legacyPublicPreview" . --glob '!node_modules/**' --glob '!.git/**' --glob '!tmp/**'` and explain any remaining hits. Hits for `assets/expo-manifest.json`, `assets/hidden/hidden-blacklist.json`, `assets/hidden/hidden-data.json`, or R2 keys like `expo/<id>_900.jpg` are okay; local preview folder paths are not.
- Run `npm test` and `npm run validate`, then append results to `DAVID2MAX.md`.
```

## 2026-05-13 Complete R2 Preview Audit And Backfill

Prompt for David:

```text
In /Users/ecohen/Dev/PhotosByElie, pull main and run a complete public-preview R2 audit/backfill across the current public catalog. Max has no `tmp/import-cache`, so do this on David only.

Do not restore local preview folders. Do not commit JPGs. Upload missing baked-watermark previews to R2 under the existing public keys.

Known missing USA gallery previews from Max's v74.11 smoke check, but do not stop at these:
- expo/20180731-1238-42139-523fc863bd_900.jpg
- expo/20180731-1227-42017-4a4d4f3d8a_900.jpg
- expo/20180731-1226-42081-faf34323e9_900.jpg
- expo/20180731-1156-42014-420ac2b2d2_900.jpg
- expo/20161018-1611-15583-ebcf17ac43_900.jpg
- expo/20161005-0851-16297-832c828571_900.jpg
- expo/20160927-1606-16583-39cfdc87d1_900.jpg
- expo/20160927-0851-20718-57ee626a89_900.jpg
- expo/20160926-0800-20396-30b40cffa4_900.jpg
- expo/20160916-1609-06444-6a9e325351_900.jpg

Complete sweep requirements:
1. Build the expected public preview key list from `photos-data.js` or `assets/media-sidecar.json`: every public catalog photo with `media.publicPreview.allowed !== false` should have both `galleryKey` (`_900.jpg`) and `detailKey` (`_1800.jpg`).
2. HEAD each expected key at `https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev/<key>` and produce a missing list.
3. Confirm David has `tmp/import-cache/manifest.json` and derivative files for the missing IDs. If derivative files are missing but source files exist, regenerate the baked-watermark previews into `tmp/import-cache`; do not write them to `assets/expo`, `assets/reserve`, or `assets/hidden`.
4. Use `scripts/sync_r2_media.py` or the existing R2 upload path to upload all missing public previews to `photosbyelie-public`.
5. Re-run the HEAD audit after upload and confirm all expected public preview URLs return HTTP 200. If any remain missing, report exact keys and why.
6. Run `npm run validate`.
7. Append a dated note to `DAVID2MAX.md` with: expected key count, initial missing count, uploaded count, final missing count, any source/cache gaps, and validation result.
```

## Automation 1: Daily Repository Health Check

Schedule: daily, morning Madrid time.

Prompt for David:

```text
In /Users/ecohen/Dev/PhotosByElie, pull main, run npm test and npm run validate. If both pass and there are no generated changes, append a short dated note to DAVID2MAX.md saying the health check passed. If there are failures, append the failing command, key error lines, and suggested next action. Do not modify code to fix failures in this automation.
```

Expected output in `DAVID2MAX.md`:

```text
## YYYY-MM-DD Daily Health Check

- Commit checked:
- npm test:
- npm run validate:
- Notes:
```

## Automation 2: Weekly Social Content Candidate List

Schedule: weekly, Monday morning Madrid time.

Prompt for David:

```text
In /Users/ecohen/Dev/PhotosByElie, inspect the current public catalog metadata and prepare 10 candidate social posts for Instagram/Facebook. Prefer strong location, architecture, color, travel, and archive-story images. Do not change site code or image files. Append the candidates to DAVID2MAX.md with photo id, collection, title, suggested caption, and suggested platform. Keep captions concise and non-salesy.
```

Expected output in `DAVID2MAX.md`:

```text
## YYYY-MM-DD Social Candidates

1. Photo:
   Collection:
   Title:
   Site URL:
   Platform:
   Caption:
   Why this one:
```

## Automation 3: Weekly Social Caption Draft Batch

Schedule: weekly, Tuesday morning Madrid time.

Prompt for David:

```text
In /Users/ecohen/Dev/PhotosByElie, draft captions for 5 strong public-catalog photos. For each photo, write one concise Instagram caption, one warmer Facebook caption, and one Reddit-safe discussion prompt with no sales language and no link unless the target subreddit explicitly allows links. Do not post anything. Do not change image files. Append the batch to DAVID2MAX.md.
```

Expected output in `DAVID2MAX.md`:

```text
## YYYY-MM-DD Social Caption Drafts

1. Photo:
   Collection:
   Title:
   Instagram:
   Facebook:
   Reddit-safe prompt:
   Notes:
```

## Automation 4: Monthly Social Theme Calendar

Schedule: first day of each month, morning Madrid time.

Prompt for David:

```text
In /Users/ecohen/Dev/PhotosByElie, create a 4-week social content calendar for Photos By Elie. Use themes such as Paris architecture, Portugal light, Spain color/geometry, AI archive curiosities, details you might miss, and available digital download/licensing. Keep the plan practical: 3-4 posts per week, with suggested platform, theme, photo angle, and CTA tone. Do not modify site code or image files. Append the calendar to DAVID2MAX.md.
```

Expected output in `DAVID2MAX.md`:

```text
## YYYY-MM-DD Monthly Social Theme Calendar

- Week 1:
- Week 2:
- Week 3:
- Week 4:
```

## Automation 5: Monthly Reddit Community Watchlist

Schedule: monthly, first Wednesday morning Madrid time.

Prompt for David:

```text
Research and maintain a Reddit community watchlist for photography, travel, city/location, art, and licensing-related communities. For each subreddit, record the self-promotion/link policy, what kind of non-promotional participation would fit, possible post angle, and risk level. Do not post, comment, or message moderators. Append findings to DAVID2MAX.md.
```

Expected output in `DAVID2MAX.md`:

```text
## YYYY-MM-DD Reddit Community Watchlist

1. Subreddit:
   Rule summary:
   Link/self-promo policy:
   Good participation angle:
   Risk level:
```

## Automation 6: Weekly Social Asset Export Queue

Schedule: weekly, Wednesday morning Madrid time.

Prompt for David:

```text
In /Users/ecohen/Dev/PhotosByElie, identify 10 public-catalog photos that would work well as square, 4:5 portrait, story, reel, or carousel assets. Do not crop, export, or edit images. Append a queue to DAVID2MAX.md with photo id, collection, title, suggested format, and why the crop/story would work.
```

Expected output in `DAVID2MAX.md`:

```text
## YYYY-MM-DD Social Asset Queue

1. Photo:
   Collection:
   Title:
   Suggested format:
   Why:
```

## Automation 7: Weekly Social Content Gap Review

Schedule: weekly, Friday morning Madrid time.

Prompt for David:

```text
Review the latest social candidates, captions, and calendars in DAVID2MAX.md. Identify gaps or imbalance: too much AI, not enough travel, repeated countries, generic captions, too many sales CTAs, too few sales CTAs, or missing strongest collections. Append a short recommendation list to DAVID2MAX.md. Do not modify code or image files.
```

Expected output in `DAVID2MAX.md`:

```text
## YYYY-MM-DD Social Content Gap Review

- Balance:
- Repetition:
- Sales tone:
- Recommended next posts:
```

## Automation 8: Weekly Social Performance Log

Schedule: weekly, after Max has posted manually and pasted/entered available metrics.

Prompt for David:

```text
If social performance data has been added to DAVID2MAX.md or another tracked handoff note, summarize it by platform, post/photo id, likes, comments, saves, shares, clicks, and lessons. Do not invent metrics. If no metrics are available, append a short note saying no performance data was provided yet.
```

Expected output in `DAVID2MAX.md`:

```text
## YYYY-MM-DD Social Performance Log

- Posts reviewed:
- Best performer:
- Weakest performer:
- Lessons:
- Next action:
```

## Automation 9: Monthly Keyword Noise Review

Schedule: monthly, first day of the month, morning Madrid time.

Prompt for David:

```text
In /Users/ecohen/Dev/PhotosByElie, count the most common remaining keyword metadata tokens excluding assets/owner-actions/keyword-blacklist.json. Suggest 20 likely useless keyword candidates, but do not edit the blacklist. Append a numbered list to DAVID2MAX.md with counts and a one-line reason for each suggestion.
```

Expected output in `DAVID2MAX.md`:

```text
## YYYY-MM-DD Keyword Noise Review

1. keyword — count — reason
```

## Automation 10: Nightly Title/Keyword Review Queue

Schedule: nightly at 02:00 Madrid time on David.

Goal:

Prepare a human-review page for improving weak photo titles and keyword metadata. David must not apply the proposed metadata changes directly. Owner/Max reviews the page, approves changes, and only then should approved metadata be applied.

Batch rules:

- Work from newest photos backward in time.
- Each night, select the most recent 100 photos that do not already have the metadata flag `Title_Keywords_Reviewed`.
- Use capture date/sort metadata when available; otherwise fall back to current catalog order or filename date.
- Skip photos already carrying `Title_Keywords_Reviewed` so the next run moves to the next older batch.
- If fewer than 100 unreviewed photos remain, prepare whatever remains.

Metadata rules:

- Review only catalog/manifest metadata.
- Do not rewrite JPG/source embedded metadata.
- Do not modify public preview images, private masters, or private render files.
- Do not use the keyword blacklist to filter photos. The keyword blacklist only blocks useless keyword strings from metadata.
- Proposed keywords must avoid entries from `assets/owner-actions/keyword-blacklist.json`.
- After Owner approval, the approved catalog metadata should add `Title_Keywords_Reviewed` as the review flag so that photo is skipped in future nightly batches.

First implementation prompt for David:

```text
In /Users/ecohen/Dev/PhotosByElie, design and implement a nightly Owner review workflow for title/keyword cleanup. Create a generated review page or localhost Owner page that lists the next 100 newest photos missing the metadata flag Title_Keywords_Reviewed. For each photo, show thumbnail, current title, current keywords, proposed improved title, proposed improved keywords, and enough source metadata to judge the proposal. Save proposals in a tracked owner-action metadata file, not in image files. Do not auto-apply proposals. Add a clear Owner approval path for later green-lighting changes. Validate, commit, push, and report the page URL/path and proposal file in DAVID2MAX.md.
```

Recurring nightly prompt for David after the workflow exists:

```text
In /Users/ecohen/Dev/PhotosByElie, pull main and generate the next nightly Title/Keywords review batch: newest 100 photos without Title_Keywords_Reviewed. Refresh the review page/proposal metadata for Owner review only. Do not apply metadata changes and do not rewrite JPG/source metadata. Commit and push the updated review/proposal files if they changed. Append a short dated report to DAVID2MAX.md with batch size, newest/oldest capture date in the batch, proposal file path, review page path/URL, and any photos skipped because metadata was insufficient.
```

Expected output in `DAVID2MAX.md`:

```text
## YYYY-MM-DD Nightly Title/Keyword Review Queue

- Batch size:
- Newest photo/date:
- Oldest photo/date:
- Proposal file:
- Review page:
- Photos skipped:
- Commit pushed:
- Notes:
```

## 2026-05-17 Corine Apple Photos Album Export

Prompt for David:

```text
In /Users/ecohen/Dev/PhotosByElie, pull latest main. Export Corine's two Apple Photos Real Estate albums from Apple Photos on David to the Saturn external drive.

Albums:
- RE 2026 La Concha 1 Apt 8AB1
- RE 2026 La Concha 2 Apt 8A5

Destination folders:
- /Volumes/Saturn/Pictures/RE/Corine/RE 2026 La Concha 1 Apt 8AB1
- /Volumes/Saturn/Pictures/RE/Corine/RE 2026 La Concha 2 Apt 8A5

Requirements:
1. Treat this as an Apple Photos export task only. Do not modify Photos library records, image metadata, public catalog files, Owner.sqlite, or R2 objects.
2. Create the destination folders if needed, under `/Volumes/Saturn/Pictures/RE/Corine/`.
3. Preserve original filenames and file extensions where possible. If Photos export tooling creates collisions, keep all files and report the collision handling.
4. Prefer the highest-quality export available from Apple Photos for each album item. Do not watermark these Real Estate sources.
5. Do not commit exported image files, checksum manifests, or private client media.
6. After export, verify each destination folder exists and count files by extension plus total bytes.
7. Append a dated report to DAVID2MAX.md with:
   - album name
   - destination path
   - exported file count
   - extension breakdown
   - total bytes
   - any missing/unexportable items
   - exact command/tooling used
8. If you can safely compute hashes without taking too long, write an ignored checksum manifest under `.review-logs/corine-real-estate-export/` and mention its path. Do not commit the exported image files or checksum manifest.

Do not commit anything unless you only update DAVID2MAX.md with the report. Push DAVID2MAX.md if you update it.
```
