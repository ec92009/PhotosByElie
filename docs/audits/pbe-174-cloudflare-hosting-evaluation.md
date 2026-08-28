# PBE-174 Cloudflare hosting evaluation

## Recommendation

Retain GitHub Pages for the public PhotosByElie storefront and catalog. The
equivalent Cloudflare Workers Static Assets prototype did not improve transport
or browser-visible Gallery startup from Madrid, and it introduced additional
compression and cross-origin integration work. A production cutover ticket is
not justified by the measured evidence.

## Equivalent prototype

The non-production prototype contained 68 allowlisted public files and no
Owner-private paths, source masters, credentials, routes, or custom domains.
The tracked catalog, current GitHub Pages catalog, and Cloudflare-served catalog
all had the same SHA-256:

`efecb290b7b5990ca8791fd81fafcaf549625aa924686775c66b922b6f612579`

The prototype used the same ten-minute public cache lifetime as GitHub Pages
and returned `X-Robots-Tag: noindex`. The browser exercise initially found one
missing public dynamic module in the staging allowlist. It was added, covered
by the allowlist test, and verified remotely before the final sample.

## Measurements

The final transport sample used seven unique-query cold requests and seven
same-URL warm requests per target. Values below are median total milliseconds:

| Target | GitHub cold | GitHub warm | Cloudflare cold | Cloudflare warm |
| --- | ---: | ---: | ---: | ---: |
| Gallery HTML | 62.150 | 63.120 | 162.136 | 123.308 |
| 1.38 MiB catalog | 186.842 | 200.146 | 237.259 | 260.440 |

A real Chromium run then loaded the France Gallery five times per host and
waited for all 24 initial cards. GitHub Pages reached the cold visible Gallery
in 4,891 ms and had a 3,524 ms warm median. Cloudflare reached it in 4,999 ms
and had a 3,726 ms warm median. The 108 ms cold difference is insignificant
beside the common client-side work; the Cloudflare warm result was 202 ms
slower, not faster.

The production browser received the first catalog in 314,053 encoded bytes.
Workers Static Assets transferred 1,446,188 bytes for the same decoded catalog,
because the prototype did not content-encode the SQLite response while GitHub
Pages served it with gzip. Browser caching eliminated later catalog transfers
on both hosts, but did not remove the common SQLite parse, query, and Gallery
render cost.

## Operational findings

- GitHub Pages was console-clean. The prototype rendered the same 24 cards but
  the unapproved preview origin was correctly rejected by production analytics
  and authentication CORS policy. A real migration would require a coordinated
  origin/custom-domain change across those services.
- Cloudflare version uploads provided an inactive immutable version, preview
  alias, exact asset hash verification, and an explicit later deployment step.
  This is a sound atomic release and rollback model, but not a user-visible win
  for this storefront.
- An R2-only catalog path was not built. With no Static Assets host gain, moving
  only the same catalog payload to another cross-origin object endpoint would
  add CORS and ownership complexity without reducing download or client work.
- The existing GitHub source-of-truth and ten-minute cache behavior remain
  simpler. Cloudflare would add Worker/version ownership and coordinated origin
  configuration without evidence of improved reliability or speed.

Cloudflare references used for the prototype boundary:

- <https://developers.cloudflare.com/workers/static-assets/>
- <https://developers.cloudflare.com/workers/static-assets/headers/>
- <https://developers.cloudflare.com/workers/versions-and-deployments/>
- <https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/>

## Higher-value next work

The useful optimization target is the payload and client path: partition or
lazy-load the catalog, reduce the initial SQLite snapshot, and measure parse,
query, and card-render time directly. Reconsider hosting only after that work
leaves a material network-bound remainder.

## Safety and evidence

No production route, custom domain, DNS, GitHub Pages setting, Worker service,
catalog row, Owner database, credential, or private media was changed. The
aggregate machine-readable receipt is
`docs/rehearsals/pbe-174-cloudflare-prototype.json`; it contains no row-level or
private data. After the final checks, the exact non-production prototype Worker
was deleted. Its preview returns 404 and Cloudflare reports that the Worker no
longer exists; production remained unchanged.
