# protobuf — the lane verdict

Owner: **protobuf-lane** (reassigned 2026-10-11 under the 8-teammate cap; the name and history are this
lane's). Analyzer: `src/ast/real-protobuf-analyzer.ts`. Corpus: **847 admitted `.proto` files across 21
repositories** (the router maps `proto` alone; 7,703 tracked-but-absent, 0 over the 1 MB cap).

Two causes have been closed or priced on this lane, and they are **different kinds of work**: one was a
claim about a FILE, the other is a rule about a DECLARATION. Both were measured before anything was
emitted, and the second is **not yet live**.

## 1. The `imports` file claim — CLOSED (`f26b53674`)

An `import "path/to/other.proto"` target is a PATH, and the key space answers a path only when it
happens to name a declared module, so the whole column read unresolved. The shared guard
(`src/ast/file-claim.ts`) closes the part the project can confirm:

| | resolved | unresolved | extOK | extFAIL |
|---|---|---|---|---|
| before | 0 | 1,574 | 0 | 0 |
| after | 0 | **1,270** | **304** | **0** |

Whole population (847/847), `incoming-gate.ts protobuf proto 0`. Priced first on the same population —
304 of 1,574 name a file the admitted list carries, cross-tab exact in both directions (0 would be
refuted) — and the residue is a ruled class: the well-known imports (`google/protobuf/timestamp.proto`
130, k8s.io `generated.proto` 74/73/73, `google/protobuf/any.proto` 67) that this corpus does not carry.

`exports` is deliberately NOT claimed: public re-exports carry the same path spelling, but that column
was never priced, and an unmeasured claim is what this lane refuses to write.

## 2. The `INDEX_SPEC` route — PRICED AND REACHING, **NOT YET LIVE** (`a4ccd91b0`)

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

### WHAT IS STILL MISSING — stated because the change is INERT without it

1. **`src/ast/parallel-indexer.ts`** (shared file, awaiting the Lead's slot): three additions at
   `PROJECT_INDEX_EXTENSIONS` — the `.proto` entry, `wasmByLang.protobuf` (the wasm already ships), and
   `specByLang.protobuf = PROTOBUF_DECLARATION_SPEC` imported from this analyzer.
2. **`script/m14/incoming-gate.ts`** needs two lines to be able to measure this lane's row with an
   index: `INDEX_SPECS` carries `dart` alone and `projectIndexesFor` selects
   `lang === "dart" ? DART : SOLIDITY`. **Without it the lane's own gate row cannot show the change at
   all** — the falsifier above is a probe, not the gate, and that distinction is the point.

Until both land, `PROTOBUF_DECLARATION_SPEC` is **exported, priced and reaching in a probe, and cited by
nothing in production**. If the existence check turns out not to reach the 38 once the index is wired
end to end, say so and leave it open: a gap that stays visible beats a type emitted to close a row.

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
