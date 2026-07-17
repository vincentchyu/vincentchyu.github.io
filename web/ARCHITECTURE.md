# Web Architecture

This directory is the canonical frontend source and static-asset tree for the
main site. Historical public URLs are preserved through compatibility shims in
`web/before/`.

## Ownership map

- `home/`: homepage-owned assets and scripts used by the root `index.html`
- `tools/`: developer tools page source
- `media/`: NeoDB-powered media journal page and generated per-category JSON
- `photography/`: photography site and generated data
- `admin/`: photo admin frontend
- `legacy/`: historical compatibility layer
- `shared/`: shared scripts, media, fonts, styles, site shell, and vendor files

## Canonical URLs

- `/index.html` remains the homepage entrypoint
- `/web/media/` is the media journal entrypoint
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

## Shared site shell

- Public pages should use `web/shared/styles/site-shell.css` and
  `web/shared/scripts/site-shell.js` for the canonical `VINCENT CHYU` header
- The canonical primary navigation is `HOME`, `MEDIA JOURNAL`, `PORTFOLIO`,
  `SONIC LENS`, `DEVELOPER TOOLS`, `ABOUT ME`, `CONTACT`
- Page-local navigation should stay secondary to this shared shell
