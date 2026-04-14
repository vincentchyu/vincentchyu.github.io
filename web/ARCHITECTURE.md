# Web Architecture

This directory is the canonical frontend source and static-asset tree for the
main site. Historical public URLs are preserved through compatibility shims in
`web/before/`.

## Ownership map

- `home/`: homepage-owned assets and scripts used by the root `index.html`
- `tools/`: developer tools page source
- `photography/`: photography site and generated data
- `admin/`: photo admin frontend
- `legacy/`: historical compatibility layer
- `shared/`: shared scripts, media, fonts, styles, and vendor files

## Canonical URLs

- `/index.html` remains the homepage entrypoint
- `/web/tools/` is the developer tools entrypoint
- `/web/photography/` remains the photography entrypoint
- `/web/admin/` remains the admin entrypoint
- `/web/legacy/timeline/`, `/web/legacy/home/`, and `/web/legacy/pages/*` host archived pages

## Compatibility rule

- `web/before/` is now a redirect-and-compatibility layer
- old public entry pages under `web/before/` should redirect to their canonical
  `web/` destinations
- shared assets that are still needed by historical pages belong under
  `web/shared/`
