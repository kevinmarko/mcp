# Booking Flash DS — sync notes

## Repo shape

This repo is the **Booking Flash Report** app (a single ~5,300-line HTML file,
`booking_flash_report_na_Kevin_1.10_AUTO_REFRESH.html`, using in-browser
Babel + Tailwind CDN, no build step) — it is not itself a design-system
repo. `design-system/` is a **new package built for this sync**, faithfully
carrying the report's visual language (colors, spacing, typography,
component boundaries) into a real, buildable React component library. See
`.claude/plans/eventual-fluttering-pnueli.md` in this session's plan history
for the full component catalog this was built from.

## Path resolution gotcha (cfg.cssEntry / cfg.tsconfig / cfg.srcDir)

`package-build.mjs` resolves **all** of `cfg.cssEntry`, `cfg.tsconfig`, and
`cfg.srcDir` relative to `PKG_DIR` (the directory containing the built
entry's nearest `package.json` — here, `design-system/`), **not** the repo
root. Config values are `"dist/styles.css"`, `"tsconfig.json"`, `"src"` —
NOT prefixed with `design-system/`. Getting this wrong doesn't fail loudly
for `srcDir` (it silently falls back to trying `'src'` next in the
built-in list and happens to still find `design-system/src`) but does print
`! cssEntry: ... not found — skipped` / `! tsconfig: ... not found —
skipped` for those two fields.

## Preview Tailwind classes need a FULL design-system rebuild, not just preview-rebuild.mjs

`design-system/dist/styles.css` is built once by `npm run build` (Tailwind
CLI scanning `src/**/*.tsx` **and** `../.design-sync/previews/**/*.tsx` —
see the `content` array in `design-system/tailwind.config.js`) and then
copied into the bundle by `package-build.mjs`. `lib/preview-rebuild.mjs`
(the fast, single-component tool subagents/scoped fixes are supposed to
use) only recompiles the preview's **JS** — it does NOT re-run the Tailwind
CLI. So: any time an authored preview introduces a Tailwind class that
doesn't already appear somewhere in `design-system/src/**`, you MUST run
`cd design-system && npm run build` (regenerates `dist/styles.css`) **and**
a full `node .ds-sync/package-build.mjs` (not the scoped preview-rebuild)
before the class will actually render. Two previews (Tooltip, Popover) hit
this during authoring — silently blank/clipped padding until traced back to
missing CSS rules, not a component bug.

## Known render caveat — Modal (`AnalyzeOpen` cell)

`Modal` uses `position: fixed; inset: 0` for its backdrop (the standard,
correct pattern for a full-viewport modal). The review-capture harness
wraps `cardMode: "single"` renders in a `.ds-single` element that has
`transform: translateZ(0)` applied (a GPU-acceleration hack) — a CSS
transform creates a new containing block for `position: fixed` descendants,
so inside the review capture ONLY, the modal backdrop centers itself
against that wrapper `div` instead of the real viewport, and its sticky
header renders above the captured frame. **This is a review-tool artifact,
not a component defect** — `Modal` renders normally in every other context
(the actual claude.ai/design canvas has no such transformed ancestor). Graded
`good` on the visible body/footer content (styled, complete, plausible);
see `.design-sync/.cache/review/Modal.grade.json` for the note. If a future
resync's render check ever flags Modal as `bad`/blank, re-check this
hypothesis before assuming a real regression.

## Sandbox: render-check / capture need network + `dangerouslyDisableSandbox`

`package-validate.mjs`'s render check and `package-capture.mjs` both start a
local HTTP server for headless Chromium to load pages from. In a sandboxed
shell this fails with `EPERM: operation not permitted 127.0.0.1` — rerun
both commands with the sandbox disabled.

## Deliberately not ported 1:1

The source report's POL Booking Flash and Detail Flash tables (row-span
merging across Trade/Sub Trade/Service, blank-spacer rows between Sale-Week
groups, business-rule cell coloring like util-gap flags and `**ALERT` text
parsing) are app logic, not design-system material. The shipped primitives
(`Table`/`TableHead`/`TableRow`/`TableCell` with `status`/`tint` variants,
`ColumnFilterInput`) give the design agent everything it needs to build
tables that *look* like those reports, without shipping the bespoke
merge/spacer algorithm as a "component." Don't read this as a scope gap on
a future re-sync — it's intentional (see the plan's §1.4).

## Re-sync risks

- `design-system/dist/` and `.design-sync/previews/**`'s introduced classes
  are the two things that silently go stale if someone edits a preview
  `.tsx` and reruns only the scoped `preview-rebuild.mjs` — always follow
  with a full `npm run build` + `package-build.mjs` (see gotcha above)
  before trusting a re-capture.
- The `Modal` render caveat above is a standing, expected warn — don't
  "fix" it by changing the component's positioning strategy; it's correct.
- No `docsDir`/`docsMap` is configured — every `.prompt.md` is synthesized
  from the `.d.ts` + JSDoc + authored preview, not a hand-written doc. Fine
  for this repo (there's no separate docs source to point at), but worth
  knowing if a future sync expects `[DOCS_UNMAPPED]` to mean something is
  missing — it's expected for all 33 components.
- `design-system/package.json` has no real npm registry publish target
  (`"private": true`); the DS is synced from its local build only.
