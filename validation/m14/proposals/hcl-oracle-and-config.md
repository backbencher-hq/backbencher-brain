# PROPOSAL (hcl) — the oracle is built and the row is measured; one config key stands between E/F and 8/8

**From:** hcl lane owner · **date:** 2026-10-17 · **branch:** `analyzers/ontology-laptop-b`
**Landed by this lane (in scope):** `script/m14/differential.ts` — `deriveHclEdges`, its dispatch branch,
the compared-label allowlist for hcl, and `LANG_REPOS.hcl`.
**Lead applies (your file):** one key in the hcl `LANG_CONFIGS` row → `perfKey`.
**Evidence:** every number below is measured on this tree; the hcl row is in
`validation/m14/differential-baseline.json` at this commit.

## 0 · WHY THE LANE COULD NOT BE MEASURED, AND WHAT IT COSTS TO FIX

Two mechanics, both found by reading rather than guessing:
1. **`LANG_REPOS` had no `hcl` entry.** `repoForSweep` reads `LANG_REPOS`; an unmapped lane is
   SKIPPED with `[lane] SKIP hcl: no corpus repo mapped in LANG_REPOS and none checked out`, so
   `--lang hcl` could never run. The checkout existed (`tf-aws-components`) but was declared only as
   hcl's `SECOND_CORPUS` entry — and a second corpus with no primary is a lane that never runs.
   **FIXED:** `LANG_REPOS.hcl = "tf-aws-components"` (with the reason written at the site). The
   `SECOND_CORPUS` entry naming the same checkout is now skipped by the harness's own
   `second !== primary` guard; a genuinely independent second HCL corpus does not exist on this box.
2. **No oracle.** 37 of 48 lanes have a `derive<Lane>Edges` + `if (lang === …)` branch; hcl had none,
   so even a mapped lane derived ZERO truth rows and the harness refused with *"derived ZERO truth
   edges"* — the correct refusal, because a 0/0 row is a fabrication. **BUILT:** `deriveHclEdges()`
   (§2), wired after the toml branch. `contains` is REFUSED (§3).

## 1 · THE ROW — `BB_CORPUS_ROOT=…/.corpus bun run script/m14/differential.ts --lang hcl --update-baseline`

```
[cold-pool] tf-aws-components:hcl: 60/60 fresh (rot 1, corpus 1809)
[tf-aws-components] hcl: files=60 tree-truth=1444 covered=1444 (100%) MISSING=0 |
  analyzer-edges=1272 unexplained=0 (0%) heuristic=0 hash=1bae8a312cc9c4a2
differential baseline updated (primary + second lanes): 1 lane(s) pinned/refreshed; drawn file sets pinned: 60
```
Baseline row written: `tf-aws-components:hcl` = `{missing: 0, unexplained: 0, heuristic: 0,
perf.avgMsPerFile: 5, sampleSetHash: 1bae8a312cc9c4a2}`.

**The mirror was confirmed before concluding anything** (your instruction): `.corpus` is a symlink farm
into `/home/ishaq2321/bb_tests/repositories` and `tf-aws-components` resolves to a real checkout
(1,809 admitted `.tf/.tfvars/.hcl/.tofu` files; `git rev-parse HEAD` = 1f74a966a0…).

Extra holdings, same oracle, no artifact written (probe mode):
| probe | files | truth | covered | missing | analyzer | unexplained |
|---|---|---|---|---|---|---|
| tf-aws-components, canonical sample | 60 | 1,444 | 1,444 (100%) | **0** | 1,272 | **0 (0%)** |
| tf-aws-components, large sample | 300 | 5,997 | 5,997 (100%) | 0 | 5,230 | 0 |
| `--repo docker` (docker-bake dialect) | 10 | 175 | 175 (100%) | 0 | 146 | 0 |
| `--repo terraform` (override-file dialect) | 60 | 232 | 232 (100%) | 0 | 213 | 0 |

## 2 · KINDS DERIVED (7) — what the oracle reads from the tree

`references` · `uses` · `exports` · `imports` · `calls` · `extends` · `overrides`.
The first four are HCL's dense surfaces: a dotted expression run (`var.x`, `module.y.out`,
`aws_instance.web.arn`) is a `references`; a run whose ROOT is a global builtin namespace
(`count`, `each`, `self`, `path`, `terraform` — no file can declare them) is a `uses`; a `module`
block's `source` is an `imports`; a document's top-level blocks/attributes are its `exports`. The last
three are the DIALECT constructs the contract now names (the three-kind audit is §4).

The oracle derives from the PARSE TREE and shares no code or table with the analyzer: fresh recursive
walk, recursion-local scope for loop variables (the analyzer's flat DFS needs a shadow COUNT for the
same rule), dialect tables written from the grammar, deferred joins for calls/inherits because a call
or a parent may be declared BELOW its site. What it necessarily shares is the SPELLING of a target —
the harness matches on label + LAST SEGMENT (`normTarget`), so `var.x` must be spelled the lane's
documented way or the row reads as a fabrication. Spelling = the contract; facts = derived twice.
**The first probe run already caught a real disagreement** — a `context.tf` holding `variable
"context"` exports `context#2` (the document reserves its own name), and the oracle's first draft
emitted the bare `context`: one MISSING + one UNEXPLAINED on the same block. Fixed by collecting
export names during the walk so the reservation applies by construction.

## 3 · KINDS REFUSED (1) — stated, not silently absent

**`contains`.** Its truth would be the parent's qualified path to the child's qualified path — a
projection of the analyzer's INDEX IDENTITY (Terraform address + sibling ordinal disambiguation),
which is not a semantic relation the tree does not already show. A second implementation would be a
transcription of the naming algorithm, and a transcription that drifts manufactures false MISSING
rows. The harness compares `contains` for php and zig only, so this costs the lane nothing it had.
Also refused BY THE ANALYZER, with counts (§4): 11,614 of the corpus's 11,618 `function_call` sites
(globals — `merge`, `length`, `provider::…` declare nothing), 0 unresolved `inherits` parents (all 53
resolve), 0 builtin-root override targets.

## 4 · THE THREE-KIND AUDIT — real references, or by-products? (counts + controls)

Census over **8,206 admitted files across 7 HCL corpora** (docker, terraform, tf-aws-components,
consul, packer, boundary, terragrunt), tree-only, plus the production analyzer over the 41 files that
contain any of the constructs:

| kind | construct, named | census (tree) | analyzer emits | refusal class | verdict |
|---|---|---|---|---|---|
| `calls` | a `function "name" { … }` declaration and a `name(…)` call **in the same file** (docker-bake spelling; Terraform 1.8+ `func` not read) | 1 declaration (`docker/docker-bake.hcl:56`), **11,618** `function_call` sites, **4** resolve in-file | **4** (site `function-call`) | **11,614 globals dropped** — the reason the rule exists: `merge`, `length`, `provider::test::is_true` declare nothing, so a `calls` edge to them is advice that cannot land | **REAL** declaration↔call relation; not a block reference (a resource/module reference is `references`, a different node shape) |
| `extends` | docker-bake `target "child" { inherits = ["parent", …] }` — bake MERGES the parent's attributes into the child | **44** sites, **53** names, **53/53 resolve** to a `target` declared in the same file; 8 files (all `docker/*docker-bake.hcl`) | **53** (site `inherits`) | an `inherits` attribute OUTSIDE a `target` block emits nothing (dialect gate, control below); an unresolved parent is dropped, never dangled | **REAL** inheritance between declarations; not "a nested block read as an override" (it is an ATTRIBUTE KEY that names other declarations) |
| `overrides` | Terraform override files: `override_resource` / `override_data` / `override_module` blocks whose `target` attribute names the declaration they REPLACE (the ordinary reference read is RETYPED, not duplicated) | **71** blocks in **33** files (all `terraform` repo), **68** carry a `target` → **68** paths, **0** builtin-root paths | **68** (site `override-target`) | a builtin root cannot be overridden (no declaration); the read is not ALSO emitted as `references` | **REAL** replacement relation; not "a nested block read as an override" (the block type is Terraform's own spelling, and only its `target` attribute participates) |

**Controls (4/4 refused as designed)** — the by-product shapes planted and measured at 0 edges:
`inherits` outside a `target` block → 0 `extends` · a global `merge(…)` with no in-file function
block → 0 `calls` · an override block whose `target` is `count.index` → 0 `overrides` · a declared
function never called → 0 `calls`.

**AUDIT VERDICT: all three are real references between declarations.** Each is gated to its dialect
construct, each has a measured refusal class (11,614 global calls; 0 unresolved parents; 0 builtin
override targets), and none is the "block reference read as a call / nested block read as an override"
shape the audit was asked to hunt. The one modelling fact worth keeping visible: `calls` and `extends`
exist in *docker-bake* HCL and `overrides` in *Terraform override files* — the grammar has no
production for any of them, which is exactly why a node-type inventory could not see them and why the
census had to be construct-based.

## 5 · WHAT THE LEAD APPLIES — ONE KEY → 8/8

`bun run script/m14/completeness-inventory.ts --lang hcl` today: **A/B/C/D/G/H pass; E and F fail**
with `no baseline floor row for terraform:hcl` / `no avgMsPerFile for terraform:hcl` — the row now
exists, under the repo key the harness writes:

```ts
// script/m14/completeness-inventory.ts, hcl row:
-    perfKey: "terraform:hcl",
+    perfKey: "tf-aws-components:hcl",
```
E then reads `{missing: 0, unexplained: 0}` (clean floor, no `floorResidual` needed) and F reads
`perf.avgMsPerFile: 5`. **The lane goes 8/8.**

Two notes, no action needed unless you disagree:
1. `differentialCheck: "differential-hcl"` stays — the scoped run correctly does NOT write
   `M14.0.F5.json` ("a scoped run would replace that claim with a smaller one"), so the F5 row appears
   on the next canonical sweep; section E reads the baseline, not F5.
2. The `SECOND_CORPUS.hcl = "tf-aws-components"` entry is now the same checkout as the primary: the
   harness skips it by construction. Kept rather than deleted because a lane row is a claim about a
   corpus and a redundant-but-true second entry is honest; a genuinely independent second HCL corpus
   does not exist on this box (stated in the comment at the mapping).

## 6 · WHAT I DID NOT DO

No `--update-baseline` on anything except the hcl lane (one scoped run, the one you asked for; it
pinned 1 lane / 60 drawn files). No edit to `completeness-inventory.ts`, `GATED_LANGS`, the firing log
or another lane's code. `tsc --noEmit` = 0.
