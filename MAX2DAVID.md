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
