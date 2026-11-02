# tests/fixtures/identifiers

`space_analyst.csv` is a read-only copy of `app/tests/fixtures/golden_full/space_analyst.csv` from the Max Laden generator repo
(`~/Max-Laden-genn-main`), which mirrors Booking Flash's own Sheet tab `Space_Analyst` (gid 1828622870): the lane map
`Lane,Dir,Trade,Sub_Trade,Region,Analyst,Revenue_Lane,IB_DIR,Notes`. 49 data lines: 48 lanes (EXE appears twice, once per direction)
and a last blank-lane line that carries only an analyst, which `BFShared.buildLaneMap` skips.
Source: docs/RESEARCH_BUILDOUT_PLAN.md section 4a, row X-2. Copy it again from the source rather than editing it here.
VPT may copy this folder as its own identifier fixtures.
