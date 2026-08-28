# PBE-174 Cloudflare Static Assets prototype

This is a non-production, representative storefront prototype. It stages the
homepage, Gallery, photo detail, their public scripts/styles, public visual
assets, and the exact tracked SQLite catalog. It deliberately excludes Owner,
Backstage, private media, source masters, credentials, deployment routes, and
custom domains.

Prepare it from the repository root:

```sh
python3 scripts/prepare_cloudflare_static_prototype.py
```

Validate without uploading:

```sh
npx wrangler versions upload --config experiments/pbe-174-cloudflare-static-assets/wrangler.jsonc --dry-run
```

Upload an inactive version with a preview alias:

```sh
npx wrangler versions upload --config experiments/pbe-174-cloudflare-static-assets/wrangler.jsonc --preview-alias pbe-174 --message "PBE-174 non-production static-host benchmark"
```

Do not run `wrangler deploy`, add a production route, or attach the
`photos-by-elie.com` domain under this ticket.
