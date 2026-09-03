# Merge Notes — Unmerged Laptop Streams (as of 2026-09-02)

## State of the world (verified)

| Stream | Where it lives | Pushed? | Branch/Commits |
|---|---|---|---|
| M31 Doc Truth + M21/M14 follow-ups (this laptop, "laptop A") | local `main` | ✅ backup pushed | `backup/laptop-a-main-2026-09-02` @ `ff5fa10` (60 commits: 26×M31, 23×M21, 9×M14) |
| M30/32/33 (other laptop, "laptop B") | laptop B local only | ❌ nothing pushed | remote has ONLY `main` @ `3318ef9` |
| M24–29 (third engineer) | their machine | ❌ not visible here | — |

**Note:** the backup branch includes laptop A's 9 committed M14 commits (co-agent's analyzer work). The co-agent's *uncommitted* working-tree changes are NOT covered by any push — commit or stash before relying on the backup.

## Verified conflict hotspots (file-level)

1. **`package.json`** — laptop A: `verify` chain ends `&& npm run docs:verify`; `docs:verify` chains 9 M31 gates. Laptop B (M30/32/33): will add their gates to the same chains + `man`/`bin` fields.
   **Resolution:** union both gate lists; keep exactly one terminal `&& npm run docs:verify` (or extend the docs chain itself — do not create two terminal doc gates).
2. **`src/cli/index.ts`** — laptop A touched it (M22/M23 indexer UX). Laptop B's M30.S2 (first-run hook on `bb index`) and M33 (version/unknown-command UX) will touch the same command dispatcher.
   **Resolution:** merge B's hooks *after* A's dispatcher changes; both sides' gates must pass post-merge.
3. **`EMBEDDINGS.md`, `README.md`** — laptop B (M30.H1, M33.H1) rewrites these; laptop A did **not** touch them. Low risk.
4. **`src/mcp/tool-handlers.ts` / `tool-validation.ts`** — laptop A changed them (T1 corpus fixes: visualize target validation, patterns confidenceThreshold). B's work is CLI-side, but the **tool-mode corpus baseline** pins observed behavior — any B change to tool output shape will trip `CORPUS CHECK` (by design: regenerate the baseline from the merged tree and review the diff before committing it).
5. **`docs/tools/*.md` + `docs/TOOLS_OVERVIEW.md`** — gated byte-exact by the M31 generator. If B's M30/M32 changes any tool's contract, docs must be regenerated (`npm run docs:generate`) or the byte gate fails (by design).

## Merge-day procedure (acceptance gate = the M31 chain)

Run on the machine doing the merge, after `npm install`:

```bash
# 0. Verify the merged tree typechecks
npx tsc --noEmit -p tsconfig.json

# 1. Regenerate gated docs if any tool contract changed in the merge
npm run docs:generate   # review `git diff docs/` — content changes must be explainable

# 2. THE ACCEPTANCE GATE (every doc/behavior drift is named)
npm run docs:verify

# 3. If tool output shape changed: refresh + review the behavioral baseline
bun run script/m31/tool-mode-corpus.ts            # writes .fresh + regenerates baseline only with review
# then re-run step 2 — CORPUS CHECK must PASS against the reviewed baseline

# 4. Full quality gate (now includes docs:verify as its last step)
npm run verify

# 5. Re-stamp M31 evidence at the merge commit (explicit, never implicit)
BB_M31_EVIDENCE=1 bun run script/m31/verify-governance.ts
BB_M31_EVIDENCE=1 bun run script/m31/verify-gate-selftest.ts
BB_M31_EVIDENCE=1 bun run script/m31/tool-mode-corpus.ts --check
BB_M31_EVIDENCE=1 bun run script/m31/verify-tool-docs-deep.ts
BB_M31_EVIDENCE=1 bun run script/m31/verify-bb-docs-truth.ts
BB_M31_EVIDENCE=1 bun run script/m31/verify-tools-overview.ts
BB_M31_EVIDENCE=1 bun run script/m31/verify-closure.ts
bun run script/m31/sync-ledger.ts
# ledger must show all six M31 issues verified at the merge commit
```

**Rule:** a merge is not done while any gate is red. A red gate after merge means the merge changed documented behavior — fix, or consciously regenerate the evidence with the change reviewed. Never hand-edit `validation/m31/*`.

## Laptop B's pre-merge homework (do before merging)

1. Push laptop B's work to `backup/laptop-b-main-<date>` — same single-disk risk laptop A just retired.
2. Close or update M30/32/33 issues on GitHub (they are still OPEN despite the work being done locally) with evidence comments, mirroring laptop A's practice — the issue tracker currently undercounts reality.
3. If M30/M32/M33 changed any `bb_*` tool's output shape or contract: expect step 2/3 above to flag it, and review those diffs carefully — that is the gates working, not failing.

## Recommended merge order

Either order works; **merge laptop B first** (M30/32/33 are user-facing and their issues are still open — closing them needs the merged evidence), then laptop A's branch on top, then run the full procedure once. Alternative (A first) is fine but B's CLI work will then need the second pass anyway.

## M35 post-merge acceptance probe

M35 "Read-Path Staleness Honesty" (GitHub milestone #35, created 2026-09-03 on laptop A) adds read-path staleness gates to `npm run verify` — they run in this procedure automatically. Once M35.C1 (#585) delivers `script/m35/staleness-corpus.ts --check`, it becomes the designated merge-day acceptance step for staleness behavior: it proves staleness reporting survived the merge, per tool, per language family. Delivered (M35.C1, #585): `script/m35/staleness-corpus.ts --check` is wired into `npm run verify` and MUST be green before the merge is declared done.
