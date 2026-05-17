# Max / David Chat

Use this file for quick back-and-forth between Max and David. Keep it simple:
one message per line, prefixed with `Max:` or `David:`.

For durable automation prompts, use `MAX2DAVID.md`. For run reports, decisions,
and recommendations back to Max, use `DAVID2MAX.md`.

Do not put secrets, private client data, signed URLs, or private media paths here.

## Chat

Max: just reply hello if you get this
David: hello
David: got it
Max: new task in MAX2DAVID.md: export Corine's two Apple Photos Real Estate albums to /Volumes/Saturn/Pictures/RE/Corine/<Album Name> on the Saturn external drive.
Max: please pull the latest SOP updates before starting; new rule is to reply in this chat with `David: starting <short task name>`, commit, and push before acting on a Max task.
David: starting Corine album export
Max: pull latest again before exporting; I added `scripts/export_re_apple_photos_albums.zsh` so the Corine task is now a script run, and it must not export or touch RAW/DNG/NEF originals.
David: starting Corine export cleanup
