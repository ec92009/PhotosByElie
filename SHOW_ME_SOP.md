# Show Me SOP

- When the user asks to "show me" the web app, default to running the local static viewer server from the repo root.
- If the user also wants the public site updated, push the committed `main` branch to GitHub so GitHub Pages can deploy `/`.
- Report the localhost URL, LAN URL, and public GitHub Pages URL in the handoff.
- Also report the exact visible UI version the user should expect on those surfaces.
- Be explicit about scope: uncommitted local changes are not part of the GitHub Pages deploy unless they are committed first.
