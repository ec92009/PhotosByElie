# Max to David Automation Handoff

Use this file for instructions prepared on Max for David, the always-on machine. David should treat these as automation prompts or recurring job specs, then report results in `DAVID2MAX.md`.

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
- Proposed titles must be meaningfully better than camera/file placeholders. Do not treat titles such as `D5H 2946`, `DSC 1234`, bare dates, or other filename-derived labels as acceptable improved titles.
- Proposed keywords must be useful review candidates, not just the collection/country alone. Prefer location, venue, city, subject, architecture/art/nature/travel cues, source folder context, and existing reliable metadata.
- If there is not enough catalog/source metadata to make a useful proposal, keep the photo in the review page but mark the proposal as `needs_owner_context` with a short reason instead of inventing metadata.
- Keep the Owner approval page compact: one photo per row with four columns only: preview, old title/keywords, proposed title/keywords, and approval checkbox. Source/camera metadata may remain in the proposal JSON for auditing, but should not clutter the main approval UI.
- Before committing a generated batch, inspect the first screen of the review page. If the first visible proposals are mostly unchanged filename titles or one-word country-only keyword lists, fix the generator/prompt and regenerate before reporting success.
- After Owner approval, the approved catalog metadata should add `Title_Keywords_Reviewed` as the review flag so that photo is skipped in future nightly batches.

First implementation prompt for David:

```text
In /Users/ecohen/Dev/PhotosByElie, design and implement a nightly Owner review workflow for title/keyword cleanup. Create a generated review page or localhost Owner page that lists the next 100 newest photos missing the metadata flag Title_Keywords_Reviewed. The Owner page should use one row per photo with four columns only: preview, old title/keywords, proposed title/keywords, and approval checkbox. The generated proposals must not merely preserve filename-style titles such as D5H 2946 or propose only a country keyword; use reliable source path, capture, gallery, existing title, and metadata context to produce useful review candidates, or mark the item needs_owner_context in the proposal JSON when metadata is insufficient. Save proposals in a tracked owner-action metadata file, not in image files. Do not auto-apply proposals. Add a clear Owner approval path for later green-lighting changes. Validate, commit, push, and report the page URL/path and proposal file in DAVID2MAX.md.
```

Recurring nightly prompt for David after the workflow exists:

```text
In /Users/ecohen/Dev/PhotosByElie, pull main and generate the next nightly Title/Keywords review batch: newest 100 photos without Title_Keywords_Reviewed. Refresh the review page/proposal metadata for Owner review only. The Owner page should stay compact: one row per photo with four columns only: preview, old title/keywords, proposed title/keywords, and approval checkbox. Proposed titles must improve filename-style placeholders, and proposed keywords must not be country-only filler. Use reliable source folder/path, capture date, gallery, current title, current keywords, and other catalog metadata; when that context is insufficient, mark the item needs_owner_context with a concise reason in the proposal JSON rather than inventing facts. Open the review page locally and inspect the first visible screen before committing; if proposals are mostly unchanged filenames or one-word country-only keyword lists, fix the generator/prompt and regenerate. Do not apply metadata changes and do not rewrite JPG/source metadata. Commit and push the updated review/proposal files if they changed. Append a short dated report to DAVID2MAX.md with batch size, newest/oldest capture date in the batch, proposal file path, review page path/URL, and any photos skipped/flagged because metadata was insufficient.
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
