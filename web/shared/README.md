# Shared

Shared frontend assets live here.

- `scripts/`: cross-page scripts
- `vendor/`: third-party libraries
- `media/`: shared images and videos
- `fonts/`: shared font assets
- `styles/`: shared stylesheet files

Legacy public asset paths may continue to exist until page references are fully migrated.

Historical pages promoted out of `web/before/` should consume shared assets from
this directory instead of continuing to depend on anonymous legacy paths.
