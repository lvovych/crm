# Supplier interface review

Run from the repository root with Node 24 after installing the repository dependencies:

```sh
node node_modules/vite/bin/vite.js --config scripts/supplier-ui-review/vite.config.mjs
```

Open http://127.0.0.1:4175/suppliers. This local harness renders the production supplier
list/detail pages and editor, picker, archive and import-preview components. Server
actions, navigation and the application header are replaced with synthetic fixtures.
Edits persist only in the tab's sessionStorage. No database or Carbook connection is
used. Open a fresh tab for a clean fixture set. Do not deploy this harness.

## Browser checks completed on 2026-11-03

- Active/archive filtering, query pagination and visible pagination controls.
- Create and edit; explicit zero-day terms; contact and bank account round-trip.
- Archive confirmation and restore.
- Picker preserves an already archived selection; new choices are active; contact
  details identify results; clearing selection preserves the legacy text field.
- Upload `preview.json` on `/suppliers/import`: review counts, duplicate candidates,
  excluded records and period appear; no apply/migration action exists.
- Desktop and 390 × 844 layouts: table scrolls inside its container, pagination stays
  visible, editor has no page-wide horizontal overflow.
- Final clean desktop list has no browser console errors.

The browser review found and fixed table overflow/pagination visibility, wrapping
of editor type controls and missing picker loading/error/contact feedback. Picker
regression tests cover rejected searches, archived selection and disabled rollout.

This checks interface behavior with mocked actions, not deployed Next.js routing,
authentication or production database persistence. Those remain deployment checks.
Fixtures contain no real supplier data. `invalid.json` is available for manual
validation experiments; server-side validation is covered by the unit suite.
