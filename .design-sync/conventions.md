## Booking Flash DS — conventions

This is the **Booking Flash Report NA** design system: 33 components built
from a real Ocean Network Express (ONE) booking-operations dashboard —
filter chips, status-colored data tables, KPI tiles, and alert/empty
states. It has no CSS-in-JS and no context providers to wrap: everything is
plain Tailwind utility classes on plain `<div>`/`<button>`/`<table>` markup.

### Setup — no provider, but dark mode needs a `.dark` wrapper class

No component reads from React context, so nothing needs wrapping to
render. Dark-mode variants (`dark:bg-…`, `dark:text-…`) are Tailwind's
`class`-strategy dark mode: they activate when an ancestor element carries
a literal `dark` class — never OS `prefers-color-scheme`. To build a
dark-mode screen, add `dark` to a wrapper:

```jsx
<div className={isDark ? 'dark' : ''}>
  <AppHeader title="Booking Flash Report NA" />
  {/* … */}
</div>
```

### Styling idiom — named Tailwind color tokens, not raw hex

Every brand/status/table color in this system has a **named Tailwind
class** — never reach for an arbitrary `bg-[#…]` hex when one of these
exists, and never invent a new hex for something this table already covers:

| Family | Classes | Meaning |
|---|---|---|
| Brand | `bg-brand` / `text-brand` / `border-brand`, `bg-brandDark` | ONE pink `#E5007D`; `brandDark` `#c2185b` is the Modal header accent |
| Row/record status | `bg-status-vms`, `bg-status-apFrozen`, `bg-status-apOnly`, `bg-status-noCall`, `bg-status-portExcluded` | Mirrors the source Excel's conditional formatting — these are business-meaningful, not decorative |
| Filter chips | `bg-chip-subTrade` (+ `dark:bg-chip-subTradeDark`), `bg-chip-coast`, `bg-chip-analyst`, `bg-chip-lane`, `bg-chip-saleWeek`, `bg-chip-yard` | One fixed color per slicer field — reuse the same color for the same field everywhere |
| Table chrome | `bg-table-head`, `bg-table-panel`, `bg-table-currentLaden`, `bg-table-totalTint`, `bg-table-inlandTint`, `bg-table-portTint`, `bg-table-bsaTint`, `bg-table-reeferFallback`, `bg-table-vcoFallback` | Column-group tints and the dark table header |
| Action buttons | `bg-action-export`, `bg-action-analyze`, `bg-action-warningBg` (+ `dark:bg-action-warningBgDark`) | Toolbar button accents — prefer `<Button variant="…">` over these directly |

Everything else (spacing, borders, shadows, radii) is stock Tailwind —
`border` + an explicit `border-black`/`dark:border-gray-600` pairing is
the convention for every bordered element (never rely on Tailwind's
default border color). Typography: `text-[11px]`/`text-[12px]` for chip
and badge labels, `text-xs` for table cells, `text-sm` for buttons and
body copy, `text-lg`+ for titles — see the scale documented at the bottom
of `tokens/tokens.css`.

### Where the real styles live

Read `styles.css` (imports `_ds_bundle.css`, which holds every component
rule and the token custom-properties) before styling anything new — it's
the actual compiled output, always more current than this summary. The
token source of truth (names + exact hex, with the reasoning behind each)
is `tokens/tokens.css`.

### Building with it

```jsx
<FilterBar onClear={handleClear}>
  <SlicerGroup label="Sub Trade">
    <SlicerChip color="subTrade" selected={filter === 'PNW'} onClick={() => setFilter('PNW')}>
      PNW
    </SlicerChip>
    <SlicerChip color="subTrade" selected={filter === 'SCAL'} onClick={() => setFilter('SCAL')}>
      SCAL
    </SlicerChip>
  </SlicerGroup>
</FilterBar>
```

Compose `Table` + `TableHead` + `TableRow` (`status="apFrozen"` etc.) +
`TableCell` (`tint="…"`) for any status-colored data grid — see
`components/tables/Table/Table.html` for a full worked pivot-table example.
