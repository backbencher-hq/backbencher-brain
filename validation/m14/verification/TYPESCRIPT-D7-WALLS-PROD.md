# TYPESCRIPT — D7 RECEIVER WALL, WHOLE-POPULATION LEDGER (2026-11-18)

The D7 bar forbids leaving a wall merely NAMED: every class must end in **RESOLVED / CLAIMED /
INSTRUMENT GAP / RULED UNDECIDABLE** with a **count** and a **falsifier**. This page is that ledger.
It replaces the missing `TYPESCRIPT-D7-WALLS-PROD.md` the older pages cite.

## 0 · What the wall is

`metadata.owner` is the receiver channel: when the syntax proves a member call's receiver type, the
analyzer publishes `owner` + `ownerEvidence` and the store binds the member inside THAT class instead
of by bare name. The channel cannot be complete — TypeScript's type of an arbitrary expression is
flow-sensitive and cross-file, while this analyzer is per-file and syntax-only — so the unowned rows
are the wall. The lane's contract (recorded in `real-typescript-analyzer.ts`) is: state an owner only
when a SYNTACTIC form states the type; otherwise carry `typescriptUnresolvedReceiver` so the store
WITHDRAWS the name binding. The wall question is therefore not "why is the graph incomplete" but
"for each unowned member call, is a type stated anywhere the analyzer could read".

## 1 · Measured populations (both printed by their instruments, neither extrapolated)

| instrument | population | calls | member calls | owner-carrying | share |
|---|---|---|---|---|---|
| `ts-receiver-wall-probe.ts --max-files 1500` | 1,500 of 17,350 admitted files, 41 repos, stride 12, 0 parse failures | 40,709 | 19,811 | 1,939 | 9.8% of member calls |
| `ts-owner-coverage.ts --max-files 1500` | 1,500 of 13,830 `ts`-only admitted files, 39 repos | 47,251 | 23,978 | 3,099 | 12.9% of member calls |
| whole-population arm (`typescript-arm-final-2026-11-18.log`, owner-channel line) | 17,350 files / 41 repos, 992,652 edges | — | — | 30,298 rows carried `metadata.owner` (16,496 resolved, 13,802 declined) | — |

The two 1,500-file runs differ because the wall probe admits the lane's whole extension set
(`ts,tsx,mts,cts` → 17,350) while owner-coverage's historical CLI admits `ts` only (13,830); both
print their own population, so neither share is presented as the other's. The whole-population
owner count is the arm's, over the whole admitted set.

## 2 · The wall partition (1,500-file stride; 17,872 unowned member calls)

Coarse partition (the probe's own W-classes, mutually exclusive):

| class | rows | share | meaning |
|---|---|---|---|
| **W0** no identifier root | 6,762 | 37.8% | the receiver expression has no name at all — a call result (`f().x`), a literal, a template |
| **W1** the file binds the name | 7,183 | 40.2% | the root IS a name this file binds (local/param/`this`/import) but the file states no type for it |
| **W2** the project declares it | 2 | 0.0% | a cross-file receiver-typing class could point at a declaration |
| **W3** the project declares it nowhere | 3,925 | 22.0% | SDK / third-party / global member — a vocabulary question, not a type-in-file question |

Cause breakdown (the probe's per-cause classes, all 17,872 rows, sums exactly):

| count | share | cause |
|---|---|---|
| 6,762 | 37.8% | receiver root is not a plain identifier (W0) |
| 6,501 | 36.4% | receiver is a LOCAL with no type stated in this file |
| 1,691 | 9.5% | receiver is an IMPORTED BINDING — the type lives in another file / node_modules |
| 1,328 | 7.4% | receiver is `this`; the field's type is not stated (or the field is untyped) |
| 835 | 4.7% | receiver is a CHAIN off a root (depth ≥ 2) |
| 301 | 1.7% | receiver's type is an IMPORTED CLASS named here, declared elsewhere (no member set here) |
| 206 | 1.2% | chain off a TYPED root (one hop reads the root's type, not the member's) |
| 202 | 1.1% | receiver's type is GENERIC over a type parameter (concrete type is the caller's) |
| 27 | 0.2% | **probable-defect class** — the probe says the file states this name's type and no owner was carried |
| 19 | 0.1% | receiver's type is a TYPE ALIAS (no member set of its own) |

## 3 · Dispositions — every class ends in one of the four states

| class | count | disposition | argument / falsifier |
|---|---|---|---|
| W0 no nameable root | 6,762 | **RULED UNDECIDABLE** | There is no name to type; stating an owner would mean inferring the RETURN TYPE of an arbitrary call expression, i.e. flow-sensitive inference the syntax-only contract excludes. FALSIFIER: a W0 row whose receiver expression is a bare name or a syntactically typed form — the probe's root extractor would have to be wrong, and its samples (`.… -> map`) show the empty root. |
| W1 file binds the name | 7,183 | **RESOLVED-WHERE-SYNTACTIC / RULED UNDECIDABLE BEYOND** | The lane implements twelve syntactic evidence classes (assignment, annotation, param, this, cast, factory, element, generic, destructured, class-static, enum, class-static) and each is compiler-gated; the residual W1 rows are flows the syntax does not state (unannotated factory returns, chained locals, conditional initialization). FALSIFIER: a construct that writes a BARE type annotation for the receiver name and still publishes no owner — the probe tests exactly that with its AST rule, and §4 reports the 27 rows it found. |
| W2 project declares it | 2 | **CLAIMED / NOT WORTH A RUNG — by arithmetic** | Cross-file receiver typing (index-assisted member sets) can move AT MOST these 2 rows on a 1,500-file stride: the owner share would move 9.8% → 9.81%. The rung exists (the project index can carry declarations) but its measured upper bound is 0.0% of the wall; spending a campaign rung on it would be a rounding exercise, so it is ruled with the count. FALSIFIER: a cross-file run that finds more W2 rows than the probe's `repoDeclaredTypes` test, or W2 > 1% on another corpus. |
| W3 declares nowhere | 3,925 | **CLAIMED — vocabulary/external channel, not receiver typing** | These are SDK/third-party/global members. The honest store channel is an EXTERNAL claim (`package-scope-claim.ts` precedent, `metadata.isExternalTarget`), not a fabricated owner: no project declaration exists to bind inside. The lane already claims the external bindings it can prove from imports (arm: 210,877 verified external claims + 3,474 unverifiable); an SDK receiver's member is external by construction and the claim requires knowing the package — the vocabulary rung is measured here and left to the claim channel by design. FALSIFIER: a W3 root that a project declaration actually declares (the probe's key space says otherwise), or an external claim the project refutes (`extFAIL` — the arm reads 0). |
| type-alias receiver / generic / chain classes | 19 + 202 + 206 + 301 | **RESOLVED-BY-RULE** | Each has a named cause in the breakdown and is a deliberate non-owner: a type alias has no member set; a generic's concrete type is the caller's argument; a chain's member type is one hop beyond the stated root; an imported class's member set is not in this file. FALSIFIER: any of them producing an owner today — the probe classifies them as unowned precisely because the analyzer declines. |
| **27-row probable-defect class** | 27 | **INSTRUMENT GAP (probe over-attribution), with residual risk stated** | The probe's "file states the type" test keys on the chain's ROOT, while the call sits on an intermediate result. 3 of 27 sampled rows (gql-federation `internals-js/src/operations.ts:787/899/1409`) are all the same shape: `fragments: NamedFragments` is typed, but the call is `fragments.get(name)!.fragmentUsages()` — the receiver is `get()`'s result, not `fragments`. The analyzer correctly declines. The probe should test the ACTUAL receiver node; until it does, this class is an instrument boundary, not a proven analyzer miss. FALSIFIER: any one of the 27 whose receiver is the typed binding itself — that would be a real miss and the class would move to RESOLVED-WHERE-STATED. |

## 4 · The falsifier, as a measurement

The wall probe prints, beside the wall, `THE FALSIFIER: N rows where the file STATES the receiver's
type and no owner was carried`. On the 1,500-file stride that reads **27** (0.15% of the wall). The
27 rows are all in one corpus repo (gql-federation) and the 3 sampled are the call-result chain
above; the instrument's own root extractor is what makes the test over-broad. This is recorded
rather than rounded away because the D7 bar is about honesty, not about a clean number.

## 5 · What moved this round, and what did not

- **Moved:** the uses half of the channel (reads now carry `owner`/`ownerEvidence`; 264/5,055 on the
  wall-probe population, 366/5,955 on the owner-coverage population) — before 2026-11-17 it was 0.
- **Moved:** the claim-pass order — binding claims now own their rows, so the owner channel is not
  competing with the project-index pass for the same rows (measured in
  `typescript-claim-class-probe*.log`).
- **Not moved, deliberately:** no flow-sensitive inference, no cross-file member sets (W2 = 2 rows
  arithmetic above), no fabricated owners for W3 (external claim channel instead).

## 6 · Evidence

- `validation/m14/measurements/typescript-wall-1500-final.log` (partition, causes, falsifier list)
- `validation/m14/measurements/typescript-owner-coverage-1500-final.log` (evidence-class split)
- `validation/m14/measurements/typescript-arm-final-2026-11-18.log` (whole-population owner channel:
  30,298 owner rows, 16,496 resolved, 13,802 declined)
- `script/m14/ts-receiver-wall-probe.ts`, `script/m14/ts-owner-coverage.ts`,
  `script/m14/package-scope-claim.ts`
- Fixtures: `uses-owner-channel`, `receiver-owner-from-new`, `owner-class-*` (each evidence class)
