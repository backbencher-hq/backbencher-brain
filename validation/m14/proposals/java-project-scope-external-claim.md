# PROPOSAL (java) — a PROJECT-SCOPE external claim for the bare-name mass, now that the index exists

**From:** java lane owner · **date:** 2026-10-17 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** `script/m14/**` (Lead-owned) and, optionally, `src/ast/project-index.ts` — this lane cannot edit either.
**Evidence:** `validation/m14/verification/JAVA-STATE.md` §1/§7, gate cap 400 (`incoming-gate.ts java java 400`).

## THE CAUSE, COUNTED (cap 400; whole-population shape is the same)

`unresolved 23,976` after the overrides fix. Every remaining bucket is a name **the project does not
declare** — JDK / Eclipse / a sibling outside the sample:

```
references 12,693 · calls 7,886 · uses 1,627 · instantiates 1,090 · extends 271 · imports 263 · implements 146
```

`JAVA-RESIDUAL.md` ruled this NOT DOABLE because a per-file analyzer lacks the project key space and
`markExternalTargets` refuses the unprovable "probably the platform type" claim. **That premise is now
obsolete**: `JAVA_DECLARATION_SPEC` exists (`src/ast/project-index.ts`, `d5385c960`), `.java` is in
production's `PROJECT_INDEX_EXTENSIONS` (`parallel-indexer.ts:1648`), and the gate already hands
`{ projectIndex }` to `parseFile` under `--index` (`incoming-gate.ts:918-919`). In production the index is
built per repository over **all** the project's files, so "the project declares no such name" is a
VERIFIABLE statement there, not a heuristic.

## WHY IT CANNOT LAND FROM THE ANALYZER ALONE

The gate's `projectIndexesFor(lang, files)` builds each repo's index from the **sampled** file list
(`incoming-gate.ts:699-757`); its own header says `--index` over a sample "is not a project index". Marking
bare names external on a sampled index would be refuted by declarations in unsampled files of the same
repo — i.e. it would raise `extFAIL`, the must-not-rise column. A claim that fails only because the
instrument is partial is not shippable.

## THE ASK — one of these, either is enough

1. **Full-repo indexing in a sampled run** (preferred): in `projectIndexesFor`, index the repository's
   whole admitted file set (discovery already knows it — `git ls-files` + the same extension filter),
   while still parsing only the sample. The index is then closed per repo and the gate's key space can
   stay sampled; the claim is verified by the index, so a sampled-key-space refutation cannot occur.
2. **An explicit completeness bit**: a `ProjectIndex` completion boolean (set true only when the builder was
   given the full project file set, false for any sample), passed through `deserializeProjectIndex`.
   The analyzer will read it and claim ONLY when true; sampled runs stay byte-identical.

## THE ANALYZER RULE, READY TO IMPLEMENT ONCE (1) OR (2) EXISTS

In `markExternalTargets` (current file ~:3970), for a target that is a **plain identifier** (no dot, no
separator) and is not in `symbols` for this file, add `isExternalTarget: true` when BOTH:
- `context.projectIndex` is present and closed (per (1)/(2)); and
- `context.projectIndex.symbolNames` does **not** contain the name (and, for a dotted target, its OWNER
  does not — matching the arbiter's `targetOwner` refutation key).

Do **not** touch `imports` (the arbiter's `importPath` claim already handles dotted module paths) and do
not touch the binding family. No new metadata key, no new claim kind: this rides the existing `owner`
claim and its `verifyExternalClaim`, so `extOK`/`extFAIL` keep their meaning.

## ACCEPTANCE (both arms, stated as one)

- whole-population `--index` run (11,152 files): `extFAIL` stays **0**; `arbitraryTwin` stays
  **3,960 at cap 400 / unchanged at population**; `unresolved` falls by N; `extOK` rises by exactly N;
  `resolved`, `collRes`, `amb(decl)` do not fall.
- **CONTROL:** a two-file repo where the project declares a type with the same name as a JDK type
  (`Map.java` + a file reading `Map`) must NOT be marked — the claim flips to refuted if the rule is
  wrong. This is the same control `JAVA-EXTFAIL-CENSUS.md` §2 used for the arbiter.
- fixtures: java 59 pass / 4 fail before and after (no fixture reads a project index today).
- sampled `--index` arm: byte-identical to its pre-change value if ask (2) is chosen (the bit is false).

## WHAT THIS DOES NOT DO

It does not resolve anything: a verified external claim is not a resolution, and clause 1 accepts it as
"a claim the project verifies" by design. It removes no ambiguity — the 651 ambiguous overrides and the
overload collisions stay owned by the separate override-base proposal and the referee's arity question.
