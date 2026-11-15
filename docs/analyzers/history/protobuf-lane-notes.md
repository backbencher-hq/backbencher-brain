# protobuf — the lane verdict

Owner: **protobuf-lane** (reassigned 2026-10-11 under the 8-teammate cap; the name and history are this
lane's). Analyzer: `src/ast/real-protobuf-analyzer.ts`. Corpus: **847 admitted `.proto` files across 21
repositories** (the router maps `proto` alone; 7,703 tracked-but-absent, 0 over the 1 MB cap).

Two causes have been closed or priced on this lane, and they are **different kinds of work**: one was a
claim about a FILE, the other is a rule about a DECLARATION. Both were measured before anything was
emitted, and the second is **not yet live**.

## 0. STATE OF THIS PAGE, 2026-10-11 after the landing

**The INDEX_SPEC route is LIVE** (`06a33afdb`): `parallel-indexer.ts` builds a per-project `.proto`
index and the gate can measure it (`--index`). **The file claim is no longer 304** — the widening
(`4930d6afa`) took it to **993 of r-lane's measured 1,061 ceiling**. Both changes are recorded below in
the order they happened, including the two attempts that failed and the measurement that refuted this
lane's own earlier ceiling, because the sequence is the evidence.

## 1. The `imports` file claim — CLOSED, THEN WIDENED (`f26b53674`, `4930d6afa`)

An `import "path/to/other.proto"` target is a PATH, and the key space answers a path only when it
happens to name a declared module, so the whole column read unresolved. The shared guard
(`src/ast/file-claim.ts`) closes the part the project can confirm:

| | resolved | unresolved | extOK | extFAIL |
|---|---|---|---|---|
| before | 0 | 1,574 | 0 | 0 |
| after | 0 | **1,270** | **304** | **0** |

Whole population (847/847), `incoming-gate.ts protobuf proto 0`. **THE FOLLOW-UP IS THE IMPORTANT PART:
that 304 was NOT the ceiling.** r-lane's `probe-imports-split`, adopted and re-run (`3de81697e`), prices
the claimable subset at **1,061 (67.4%)** with three arms — ROOT-RELATIVE, FILE-RELATIVE and **SUFFIX** —
because a protobuf import path is written relative to an IMPORT ROOT that may be any directory above the
file. The widening (`4930d6afa`) walks the file's ancestor directories as import roots:

| | imports unresolved | extOK | extFAIL |
|---|---|---|---|
| after the first pass (`f26b53674`) | 1,270 | 304 | 0 |
| **after the widening (`4930d6afa`)** | **581** | **993** | **0** |

**993 of 1,061**; the 68 shortfall is the part of SUFFIX that matches an admitted file not under any
ancestor of the importing file, which a per-file analyzer cannot reach without a project file list. The
residue is a ruled class: the well-known imports (`google/protobuf/timestamp.proto` 130, k8s.io
`generated.proto` 74/73/73, `google/protobuf/any.proto` 67) that this corpus does not carry.

`exports` is deliberately NOT claimed: public re-exports carry the same path spelling, but that column
was never priced, and an unmeasured claim is what this lane refuses to write.

## 2. The `INDEX_SPEC` route — PRICED, REACHING, and **LIVE since `06a33afdb`**

### The defect, and why the rule must not be softened

`resolveViaImports` builds the right candidate — `${package}.${Type}` — and then discards it at a guard
that asks whether the candidate's package-derived DIRECTORY is one this file imports. That guard is
**correct given what it can see**: consul's `proto/private/pbcommon/common.proto` declares
`package hashicorp.consul.internal.common`, so the directory `private/pbcommon` does not mirror the
package `hashicorp/consul/internal/common`, and a rule that accepted the candidate unchecked would be a
guess that can silently re-point an edge (the shape julia measured at a 1.0% ceiling).

**A low ceiling from a rule that GUESSES is a ruling; one that reaches an EXISTING declaration is a
fix.** So the fix is not to soften the rule but to give it something to see, and what it needs to see is
the project's own key space. That is the `INDEX_SPEC` route: production builds a per-project index of
the `.proto` declarations and hands it to the analyzer through `context.projectIndex.symbolNames`.

### THE PRICE (condition 1), measured — `tools/index-spec-pricing.mts`

| | names | cost |
|---|---|---|
| Solidity default (what a table entry uses today — `specByLang` has no protobuf entry) | **0** | 11–32 s |
| **`PROTOBUF_DECLARATION_SPEC`** | **8,048** | **~15–25 s for the whole corpus (≈18 ms/file)** |

An entry without a spec **indexes the right shape and holds nothing** — which is the dart situation one
layer down (a spec that exists and is unreachable). The cost is paid ONCE per project run, before
workers dispatch; per-repo maximum ≈8 s (kubernetes, 135 protos).

**TWO TRAPS, EACH OF WHICH COST A MEASUREMENT RUN:**
1. the grammar puts NO declaration name in a `name` field — `message Foo { }` is a `message` node whose
   first named child is `message_name` (`enum`/`rpc`/`service` likewise), so the index's generic
   `childForFieldName("name")` extractor reads "" and a `typeNodes`-only spec holds nothing;
2. **`package` is a SIBLING of the declaration, not an ancestor** (`source_file > (syntax, package,
   import…, message…)`), so an upward walk never sees it. The first resolver produced 6,377 BARE names
   and the candidate read ABSENT while the index looked healthy.

### THE FALSIFIER AND THE NEGATIVE CONTROL (condition 3) — `tools/index-reach-falsifier.mts`

Every admitted file parsed TWICE, with and without the index, diffed by `(type, source, target, line)`:

* **38 edges change** (38 gained, 38 lost — the same rows re-pointed) to declarations that exist:
  `hashicorp.consul.internal.common.EnterpriseMeta`, `…connect.IssuedCert`, `…connect.CARoots`,
  `…config.Config`.
* **THE 43 THAT USED TO BE QUOTED HERE WAS A DIFFERENT MEASUREMENT.** 43 is the SIZE OF THE SHAPE
  (edges whose candidate the directory guard discards); 38 is what the arm actually REACHES. The gap is
  edges of that shape that already resolve another way or never reach the arm. Both numbers are real and
  they answer different questions; the code quotes the checkable one.
* **NEGATIVE CONTROL: the seven declared-nowhere names** (`xds.data.orca.v3.OrcaLoadReport`,
  `sls.asfd.asfd.{JsonFormat,CustomType}`, `grpc.testing.duplicate.{EchoRequest,EchoResponse}`,
  `github.com.hashicorp.go.kms.wrapping.v2.types.BlobInfo`) **changed with the index: 0.**
  My first version of this control was WRONG — it flagged *presence* of those names, which is just the
  files' own unresolved spellings, and reported seven over-reaches that were seven unchanged rows. The
  control now tests BINDING.

### Condition 2 — the check is IN the guard

Re-read rather than assumed: the existence check lives inside the same guard that refuses the directory
mismatch (`if (!importDirs.has(dir)) { … if (projectNames?.has(candidate)) return candidate; continue }`),
not in a wrapper around it, and it returns the candidate only when the project publishes it.

### THE LANDING (`06a33afdb`) — and the gate row that proves it

The three additions to `parallel-indexer.ts` and the two lines in `incoming-gate.ts` are in. The gate now
builds **21 repo indexes over 847 files** and passes them as `{ projectIndex }` exactly as production
does, and its row over the whole admitted population moves exactly as the probe predicted:

```
                      uses resolved   uses unresolved   unresolved total
  without --index          11,446            971              2,245
  WITH    --index          11,484            933              2,207     <- +38 / -38
```
Cost: **≈15–25 s per corpus, once per project run before workers dispatch** — never per file or per edge.
A non-protobuf lane's row is unchanged by the gate edit (`toml` 13 / 318 / 0, identical TOTAL).

**Still open, and not hidden:** the 68-edge shortfall to r-lane's SUFFIX ceiling, the six `uses` classes
of `probe-uses-split` (9,761 same-file-one · 92 same-file-multi · 2,658 cross-file-only · 971
no-candidate), and every number in this page that a store run has not confirmed.

### The 68 shortfall, CLASSIFIED (`tools/suffix-gap-classify.mts`)

r-lane's SUFFIX arm matches ANY admitted file whose path ends with `/<import>`. This lane reaches
ROOT-RELATIVE, FILE-RELATIVE and every ANCESTOR DIRECTORY of the importing file. The difference is
measured, not characterised:

```
   imports edges                                    1,574
   claimed by this lane's arm                         993
   reachable ONLY by the SUFFIX arm (the gap)          68
   reachable by NEITHER (the ruled residue)           513
   of the gap: under an ancestor the arm already tried   0  ·  elsewhere entirely  68
```

**THE 68 ARE A DECLARED BOUNDARY OF PER-FILE ANALYSIS, and the reason is structural rather than a
failure to try.** Every one of them is imported from a file whose ancestors do not contain the match:
consul's `proto/private/pbconfigentry/config_entry.proto` imports `annotations/ratelimit/ratelimit.proto`,
which lives in `proto-public/` — a SIBLING source root, not an ancestor. The same shape recurs 25 times
for `vendor/github.com/gogo/protobuf/gogoproto/gogo.proto`. No bounded ancestor walk reaches a sibling
tree, so the only route is knowing the PROJECT'S FILE LIST.

**AND THE ANALYZER DOES NOT HAVE IT.** `ProjectIndex` carries `typeKinds`, `typeMembers`, `typeBases`,
`symbolNames`, `damagedFiles` and `stats` — **no file paths**, so the index that this lane just made live
cannot answer "which file ends with this import either". Enumerating the project from inside a per-file
analyzer would be unbounded AND would re-implement the indexer's discovery rules (gitignore, the size
cap, extension admission) — the class of error this programme keeps finding, in the one place that has
no business holding it.

**A BOUNDED RULE DOES EXIST, AND IT IS PRICED RATHER THAN BUILT** (a shared-interface change, so it is
reported): give `ProjectIndex` the repo-relative file paths it already reads (`stats.files`), and the arm
becomes "an indexed path ending with `/<import>`". Across all 1,574 imports, **772 have exactly ONE
admitted suffix match and 3 have more than one** (`movie.proto` matches three vendored copies), so such a
rule would reach the gap and would have to CHOOSE in 0.4% of cases. **IF IT IS EVER BUILT, THOSE CASES ARE
REFUSED, NOT TIE-BROKEN** — a rule that picks one of three `movie.proto` copies re-introduces the
arbitrary pick this programme measured at **37,318 of 49,729** collision-bound selections going to the
WRONG symbol, and a refusal in 0.4% of cases is cheap where a guess is not.

**RULED 2026-10-11: NOT BUILT**, and the ruling has a reachable falsifier rather than a preference —
`tools/sibling-root-census.mts` counts, per lane, how many imports resolve under NO ancestor but DO
resolve under the project's file list:

| lane | files (sample/pop) | path-shaped edges | SIBLING (this shape) |
|---|---|---|---|
| protobuf | 847/847 full | 1,574 | **68 (4.3%)** |
| graphql | 1,145/1,911 | 141 | **0** |
| zig | 491/3,844 | 3,003 | **0** |

**One lane, 68 times; two other lanes zero** — the opposite of the "two or more lanes in the thousands"
that would flip the trade. The census is valid only for lanes using the path-fold arithmetic: **toml and
php read 0 reached and those zeros are ARTEFACTS** (their claims are a manifest-in-directory and a
`__DIR__` substitution, neither implemented there), so their rows are excluded rather than counted as
absence. Cost of the build: a path set per indexed lane riding the serialized index into every worker;
cheap at build time, but a shared interface and payload change affecting every indexed language.

## 3. Instruments

| instrument | what it answers |
|---|---|
| `tools/index-spec-pricing.mts` | the cost and the name count of an index spec, against the Solidity default |
| `tools/index-reach-falsifier.mts` | which edges the index actually changes, and whether the declared-nowhere names bind |
| `tools/protobuf-spec.ts` | the spec as a fixture artefact, while the landing is priced |

## 4. What is NOT claimed

- The 38-edge reach is measured **in a probe that builds the index per repo**; it is not yet a gate row,
  and no store run has been taken for this change. Store figures predating the five indexer landings
  (`140be2f01`, `63a888b03`, `ac2445a27`, `47a45a72c`, `3a701937c`) are not baselines: `extractLeaf` and
  key selection both changed bindings.
- The lane's own residual after the file claim is **1,270 unresolved imports** plus the wider "names
  nothing" population; nothing here closes those, and no ruling is offered for them yet.
