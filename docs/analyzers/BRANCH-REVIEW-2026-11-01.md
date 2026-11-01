# Branch review — 587 refs, and the plan to leave exactly one branch

**Date:** 2026-11-01 · **State reviewed:** local `analyzers/ontology-laptop-b` / remote
`analyzers/ontology-laptop-b-campaign` @ `71851adea` (50/50 lanes DONE, tag `certified-50-lanes`) ·
`origin/main` @ `612b9855c` (2026-10-15) · **remote:** `origin` only.

This is a read-only review. Nothing has been merged or deleted. It exists so the cleanup can be done
one branch at a time with a written reason per ref, and so a future session can re-run the census
instead of trusting this page.

**Re-run the census at any time:**

```bash
bun script/m14/branch-review.mjs             # human table, every ref classified
bun script/m14/branch-review.mjs --markdown  # markdown tables for a page like this one
```

---

## 1. Why ancestry is not the test

The history was rewritten three times (agent-attribution footers, author emails, squash re-commits).
The consequence is measured, not assumed: a branch whose work is already in `main` can still show
commits "ahead" of it, and a branch whose work is *not* in `main` can share a tip with one that is.
**Ancestry (`git merge-base --is-ancestor`) therefore answers the wrong question.** The test used
here is content: does the tip carry **files that the surviving line does not have**
(`git diff --diff-filter=A <surviving> <tip>`)? A tip that adds no file outside
`script/m14/tmp/` and `*.superseded-*.md` cannot be carrying product work. Two consequences of that
choice are deliberate:

- `*.superseded-<sha>.md` files are the residue of the rewrites and are NOT treated as work.
- `script/m14/tmp/*` probes are scratch and are NOT treated as work.

## 2. Census

**587 refs (39 local + 548 remote) name only 358 distinct commits.** The difference is duplicate
names for the same snapshots.

| class | tips | refs | meaning |
|---|---|---|---|
| `DUPLICATE-TIP` | 131 | 360 | the same commit under several refs; deleting the extras loses nothing |
| `MERGED-INTO-MAIN` | 17 | 17 | tip is an ancestor of `origin/main` |
| `MERGED-INTO-CAMPAIGN` | 7 | 7 | tip is an ancestor of the campaign line |
| `SUPERSEDED-BEHIND` | 100 | 100 | adds no file the surviving line lacks; largely *behind* `main` (its deletions dwarf its insertions) |
| `ADDS-DOCS-ONLY` | 86 | 86 | its only extra files are docs / superseded residue |
| `UNIQUE-CODE` | **17** | **17** | **adds `src/` or `script/` files the surviving line lacks — the only list that needs a human decision** |

So 570 of 587 refs are duplicates or superseded. The cleanup question is those **17 tips**, and within
them, four distinct kinds.

## 3. The 17 unique-code tips, by kind

### A. Product code that exists on NO surviving line — must be reconciled, not deleted

| branch | date | added code | what it is |
|---|---|---|---|
| `origin/fix/hover-parse-cost` (+ `origin/rescue/fix-hover-parse-cost`, same tip family) | 10-07 | `src/lsp/hover_cache.ts`, `script/m24/{profile-hover.mjs,verify-hover-latency.ts,verify-layout-cache.ts}` | cross-request, content-addressed **layout cache** for hover (LSP perf work) |
| `origin/archive/all-local-work` | 10-21 | `script/evidence-batch.ts`, `script/evidence-batches.json`, `script/lib/batch-worktree.ts`, `script/lib/depth-emits-consistency.ts` … (24 files) | manual **evidence batching** harness |

Verified absent from both `origin/main` and the campaign line:
`src/lsp/hover_cache.ts` — `main: no`, `campaign: no`; `script/evidence-batch.ts` — `no / no`.
**These two branches are the only places that work exists.** They must be merged (or their files
copied to a branch that survives) BEFORE any deletion.

### B. Pre-campaign campaign lines — superseded by the 50-lane line, archive before deleting

| branch | date | added code | note |
|---|---|---|---|
| `origin/analyzers/ontology-laptop-b-merged` | 10-22 | 351 `script/m13/*` + lane scripts; 1,916 commits ahead of main | predecessor merge of the laptop-B campaign. Our campaign line is 432 commits ahead of it; its extra scripts are m13 viz tooling |
| `origin/analyzers/ontology-laptop-b` | 10-18 | 75 `script/m13/*` + lane scripts | older still |

`script/m13/emit-viz-full.mts` is already present on the campaign line, so at least part of the m13
tooling survives through the campaign. **Action:** file-level diff these two against the campaign line
and `main`; move anything product-shaped into the surviving branch; tag the tips; delete the refs.

### C. Per-lane probe scripts — archive, they were the instruments of finished lanes

Ten tips (`origin/laptopA/analyzer/*`, `origin/rescue/svelte-ruled-gate`, `origin/analyzer/JAVASCRIPT_FIX2`):
`script/m14/*-probe.mts`, `script/m60/*-census.mts`, `script/cpp-review/*`, one `census-*.json`.
These are lane measurement instruments from October. The lanes are DONE and their instruments are in
the campaign line (`script/m14/**`). **Action:** tag, delete; nothing to merge.

### D. Scratch — delete

`origin/safety/coagent-inflight-0929` (09-29): `script/m14/tmp-drop.ts`, `script/m14/tmp-py-diff-run.ts`.
**Action:** delete, no tag needed.

## 4. Non-branch state that must be cleared first

| item | count | action |
|---|---|---|
| worktrees | 8 non-prunable (plus 3 prunable entries) | **remove before deleting branches** — two of them check out branches that are on the delete list: `$HOME/mcp/bb-lanes/bash` (`analyzer/BASH`) and `$HOME/mcp/bb-lanes/clean` (`analyzer/CLEAN`); the rest are detached `.tmp-*` trees. `git worktree remove <path>`; `git worktree prune` for the prunable ones |
| stash | 1 (`WIP on analyzers/ontology-laptop-b: 5549db712 HTML extFAIL … FIXED`) | it is a real fix description; export it (`git stash show -p > docs/analyzers/STASH-html-fixture.2026-11-01.patch`) or apply it, then drop — a stash is not a durable home |
| tags | 15 | keep the 4 genuine archives and `certified-50-lanes`; the `safety/*`, `premerge/*` ones are history and can stay (tags cost nothing and are the cheapest safety net) |
| remote refs | 548 | delete in batches **after** the archive tags exist for every tip being removed |

## 5. The plan to ONE branch

**Survivor: `main`.** The campaign line merges into it; every other ref is deleted or tagged.

| phase | action | exit check |
|---|---|---|
| 0 | **wait for the other laptop's push** (owner is pushing all its work first) | remote `main` (or the named branch) is current |
| 1 | re-run `bun script/m14/branch-review.mjs` on the NEW state | the 17 UNIQUE-CODE tips are re-derived; nothing is trusted from this page |
| 2 | reconcile A (hover cache, evidence-batch): merge the two branches, or copy their files onto the campaign line; run the gates | the added files exist on the surviving line; build + 50-lane gate green |
| 3 | merge the campaign line into `main` (one merge; preview showed **0 conflicts under `src/`**, 229 measurement-file conflicts under `validation/m24`, `m25`, `script/m14`…) | 50-lane gate green on the merged tree |
| 4 | tag every tip that is about to disappear: `git tag archive/<branch>-<sha> <sha>` (annotated, with the branch name and date in the message) | `git tag | wc -l` = old 15 + one per deleted tip |
| 5 | delete remote refs in batches: `git push origin --delete <ref>`; then local branches; then `git worktree prune` | `git for-each-ref refs/remotes/origin | wc -l` = 1 |
| 6 | final: local + remote each hold exactly **one branch** (`main`) plus tags | `git branch -a` lists `main` only |

**Safeguards, in order:** (1) nothing is deleted before it has a tag unless it is a `DUPLICATE-TIP` or
`SUPERSEDED-BEHIND`; (2) no `git gc --prune=now` until phases 4–5 are verified; (3) the campaign line is
preserved as `certified-50-lanes` (already pushed) through the whole operation; (4) every deletion batch
is a separate command that can be re-run — the review tool is read-only and idempotent.

## 6. What this review does NOT decide

- **Which branch the other laptop pushes to** — that decides the survivor; if it is not `main`, the
  survivor name changes in phase 5 and nothing else does.
- Whether the owner wants the archive tags kept forever or dropped after a month.
- Whether `local-main`, `pending/local-main-36` and the `rescue/*` refs carry content worth more than a
  tag — this review classifies them `SUPERSEDED-BEHIND`/`ADDS-DOCS-ONLY`, but the owner's memory of the
  three rewrites may name a payload this content test cannot see (a rewrite can make real work look
  stale). If the owner names one, it moves to phase 2 rather than phase 5.
