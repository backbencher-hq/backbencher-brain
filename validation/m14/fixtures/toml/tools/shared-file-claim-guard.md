# The shared file claim — the guard, and the three candidate rules it must not absorb

**Status: PROPOSED, unlanded.** The patch is `shared-file-claim-guard.patch` (adds
`src/ast/file-claim.ts`, 134 lines, `git apply`-able); the module itself is committed here as
`file-claim.ts` and its control is `file-claim.selftest.mts` (**15 pass, 0 fail**; the repo's own
`npx tsc --noEmit` includes it and exits 0). It is written from the measurement below, not from taste.

## The evidence the guard is the shape of

`imports-claim-pricing.mts --files=200` priced the claim across five lanes BEFORE one was emitted
(labelled stride sample; protobuf 847 and clean 312 are fully measured). Two passes, and the first
answer was **no**:

| pass | candidates restricted by | VERIFY | REFUTE |
|---|---|---|---|
| 1 | shape only (a path on disk) | 3,921 | **392** — zig 368, scss 24 |
| 2 | shape **+ the lane's own admitted extension** | 3,921 | **0** |

Every refutation was an extension the lane's population cannot hold: `build.zig.zon` (a package
manifest, not a `.zig` source) and `_all.sass` (`.sass` routes to language `sass`, NOT to the scss
lane). **The admitted-extension clause lives INSIDE the guard**, because a file claim is a statement
the project can check and the gate checks a claim BEFORE the count: a wrongly-attached claim does not
merely fail to help, it BREAKS an edge that would otherwise resolve. `extFAIL` must stay 0.

## The guard

```ts
fileClaimForTarget({
  projectRoot, filePath, written,
  admittedExtensions,          // REQUIRED: the lane's admitted list, no dots, lowercase
  extraCandidates,             // optional: lane arithmetic, already folded
  magicConstants,              // optional: { __DIR__: dir, __FILE__: filePath }
}): string | null              // the project-relative POSIX path, or null
```

Clauses, each with a control that fails if the clause is dropped (`file-claim.selftest.mts`):

1. **shape** — not a URL, not absolute, no glob/whitespace/shell characters;
2. **fold** — resolve against the file's own directory and the root; a `..` that leaves the project
   returns null rather than clamping;
3. **admitted extension** — the candidate's extension must be in the lane's OWN list (the clause that
   took 392 → 0);
4. **existence** — `statSync` says it is a file;
5. **magic constants** — substituted longest-key-first, so `dirname(__FILE__)` is resolved before
   `__FILE__` (the php case).

**Null is the safe answer.** The guard never returns a path it did not confirm.

**A control found a bug in MY TEST, not in the guard:** `foldProjectPath("a/b/", "../../x")` returns
`x`, because the base is repo-relative — consuming it lands on the project root, which is still inside
the project. Escaping needs MORE `..` than the base has segments, and that case returns null. Both are
now asserted, with the reasoning, rather than one of them being quietly wrong.

## The three candidate rules that must NOT be shared

A shared arithmetic would have silently mis-bound **clean**, whose targets are `Module:item` and not
paths at all. The lane that owns each analyzer owns its arithmetic:

| lane | candidate arithmetic | ceiling (sample) |
|---|---|---|
| protobuf, graphql, zig, json, toml | fold the written path against the file dir and the root | 304 · 134 · 2,300 · (json, toml already land) |
| scss | the specifier as written, plus `_partial` and `.scss` spellings and a directory `_index.scss`; **drop `.sass` candidates** (another language) | 754 |
| clean | `Module:item` → the MODULE, `.` → `/`, tried as `<mod>.icl` and `<mod>.dcl` — the `:item` suffix must be REMOVED for the claim to be about a file | 429 |

## Adoption, per owning lane

```ts
// at the end of analyze(), beside the lane's other post-passes
const claim = fileClaimForTarget({
  projectRoot, filePath, written: String(r.target ?? ""),
  admittedExtensions: ["proto"],            // the lane's own list, from the ROUTER
  extraCandidates: [],                      // scss/clean supply theirs here
})
if (claim !== null) md.importProjectFile = claim
```

`projectRoot` must reach the analyzer — for a worker that means `pool-worker.ts`'s `contextFor`,
which `a82e4134d` fixed for php/toml and which is the same fix for these lanes.

**The admitted-extension list must come from `src/ast/language-detection.ts`**, not from a guess:
`.sass` → language `sass`, `.zon` → nothing, `.gql` → graphql. Four lanes this session measured a
fraction of their own language by assuming an extension list.

## Post-landing verification (the falsifier, RUN-able)

1. re-run `imports-claim-pricing.mts` and confirm the per-lane VERIFY counts are unchanged;
2. run the lane's `residual-gate` row and confirm **`extFAIL` stays 0** and `unresolved` falls by
   about the ceiling;
3. run `file-claim.selftest.mts` — 15/15.

If a lane's `extFAIL` moves off 0, this guard is wrong for that lane's population and the lane's
admitted list is the first thing to check.

## The residue, ruled (unchanged by this guard)

4,503 edges name no admitted file: the well-known protos (`google/protobuf/timestamp.proto` 130,
k8s.io `generated.proto` 74/73/73), Clean's stdlib (`StdEnv:*` 52), **bare zig module names** (`std`,
`builtin`, `root` — a different shape from a path), non-admitted extensions, and non-paths. Shape,
mechanism, count and falsifier RUN are in `imports-claim-pricing.json`; the guard does not touch it,
and a ruling that absorbed it would be a fix that does not exist.

## Degraded rows, stated because the residual gate does not draw the line

2 analyzer timeouts in 4,386 files returned a **BASIC PARSE RESULT** rather than the analyzer's output
(Lead's `FALLBACK ROWS` block catches `metadata.method === "regex"`; there is no marker for this third
category). Any residual column must state every instrument whose rows it contains, not just the one it
was fixed for.
