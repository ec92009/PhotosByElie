# Conversation Summary

Date: 2026-05-02

## Scope

Built and iterated on the Photos By Elie static GitHub Pages site at `/Users/ecohen/Dev/PhotosByElie`, then kept the hub mirror in `/Users/ecohen/Dev/Webapps/PhotosByElie` synced. The work used By Elie's look and feel, including the carousel structure and spaniel companion behavior.

## Site Structure

- Created a standalone PhotosByElie site published at `https://ec92009.github.io/PhotosByElie/`.
- Added the site to the Webapps hub at `https://ec92009.github.io/Webapps/`.
- Added collection pages for France, USA, Spain, Mexico, and AI.
- Kept AI as the final collection in the carousel and shared data order.
- Refactored collection pages into thin HTML shells rendered by shared `photos-data.js` and `photo-gallery.js`.
- Added reusable `photo.html` detail pages for each photo.
- Added `basket.html` for a static localStorage basket.

## Basket Behavior

- The basket is now the source of truth for photo resolution selections.
- Detail pages start with no resolution checked unless the photo is already in the basket.
- Checking or unchecking a resolution on detail immediately updates the basket; there is no Add/Update Basket button.
- The detail page provides a Basket navigation button.
- A photo appears once in the basket; adding or revisiting the same photo cannot duplicate charges.
- Basket rows show thumbnails, all four resolution checkboxes, selected states, per-photo totals, and overall total.
- Unchecking all resolutions for a photo removes it from the basket.
- Checkout remains a mocked email handoff.

## Leonardo Images

- The initially inspected folder `~/Pictures/Leonardo/2023/07/12` was empty.
- Going up to `~/Pictures/Leonardo/2023` found images in February through June, with none in July or August.
- Added eight resized Leonardo-generated JPGs from `~/Pictures/Leonardo/2023/06/08/UPSCALE` to `assets/ai/`.
- The AI gallery now uses those real images instead of CSS-only mock thumbnails.

## Versioning And Deployment

- Versioning follows the MailAssist canonical SOP with local PhotosByElie adaptation.
- Current visible version after this conversation: `v63.9`.
- Commits were pushed to both `ec92009/PhotosByElie` and `ec92009/Webapps`.
- GitHub Pages deployments were checked after each push.

## Current Live URLs

- PhotosByElie: `https://ec92009.github.io/PhotosByElie/?v=63.9`
- AI gallery: `https://ec92009.github.io/PhotosByElie/ai.html?v=63.9`
- Example detail: `https://ec92009.github.io/PhotosByElie/photo.html?id=ai-1&v=63.9`
- Basket: `https://ec92009.github.io/PhotosByElie/basket.html?v=63.9`
- Hub: `https://ec92009.github.io/Webapps/?v=63.9`
