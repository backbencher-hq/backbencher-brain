# Unversioned files recovered before the workspace was erased

Two artifacts were found outside the repository, in the workspace, on the day the
local checkout and its corpora were deleted. Neither had ever been committed and
neither had a copy anywhere on the remote. They are preserved here because they are
backbencher work, not because they were part of any lane's current state.

They are deliberately **not** in their original locations.

## `call-edge-is-not-a-macro-953.c`

Found at `~/ishaq/validation/m14/fixtures/c/call-edge-is-not-a-macro-953.c`.

A C fixture with no `.expectation.json` beside it. All 37 committed C fixtures are
paired, and `run-fixtures.ts` discovers fixtures by expectation, so committing this
file into `validation/m14/fixtures/c/` would have introduced an orphan the runner
does not expect — at best ignored, at worst a failure in the F3 gate. It therefore
lives here until someone can say what it was pinning.

Nothing in the repository referenced it: no file mentions
`call-edge-is-not-a-macro-953`. That is consistent with an abandoned experiment
rather than a lost round, but it cannot be confirmed from here.

**To use it:** move it to `validation/m14/fixtures/c/` and author the expectation
against current analyzer behaviour, noting in the fixture commit that the
expectation was authored after the fact rather than before observing the analyzer.

## `c-lane-handoff-2026-10-01.txt`

Found at `~/ishaq/temp.txt`.

A 246-line handoff document for the C analyzer lane, exported 2026-10-01 against
branch head `dc996631`. The string `C LANE HANDOFF` appears in **no** committed
file, so the document itself was never versioned.

Its subject matter is partly superseded: `reviews/c/` now holds `master-review.md`,
`deepest-review.md`, `holy-c-second-review.md` and `third-review.md`, and the C lane
continued to commit after the export. Treat this as a snapshot of the lane's state
at `dc996631`, not as current guidance.

Kept as a plain `.txt` so it cannot be mistaken for a fixture or a spec.