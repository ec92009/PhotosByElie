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
   Platform:
   Caption:
   Why this one:
```

## Automation 3: Monthly Keyword Noise Review

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
