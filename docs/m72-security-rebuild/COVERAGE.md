# M72 coverage — which analyzers the security engine actually scans

Measured by `npx tsx script/m72/coverage-matrix.ts` (evidence:
`validation/m72/results/coverage-matrix.json`). Regenerate after any tier change.

## Headline

```
analyzers=53  registry=53  (scan 0 / leads 38 / unsupported 15)
specs loaded=37  leadsWithSpec=38/38  leadsPassingOracle=38/38
```

**Every lead-tier language has a spec, and every one of them passes its own
vulnerable/clean fixture pair through the real engine.** No spec exists without a
registry row, and no registry language is missing from the analyzer set. That is
the direct answer to "does it apply to all applicable languages?" — for the 38 the
engine can scan, yes, with no drift.

## How the 15 `unsupported` were tested (evidence, not assertion)

For each unsupported language, a real sample file was parsed with the production
parser (`parseFile`) and its symbol kinds inspected. The question is whether the
analyzer emits **executable units** (function/method bodies) or only data/config
nodes — a language whose symbols are all properties and config keys has no
source→sink surface no matter what text appears inside it.

| language | symbols emitted | executable units? | verdict |
|---|---|---|---|
| css | module, type | no | data/text |
| scss | module, type, class, variable | no | data/text |
| sass | (parser) | no | data/text |
| html | module, variable | no | markup (script blocks are extracted separately) |
| xml | class, property | no | data |
| json | property, module | no | data |
| yaml | module, property, variable | no | data |
| toml | module, namespace, property | no | data |
| markdown | type | no | prose |
| sql | module, class, property | no | sink *language*, not an execution context |
| graphql | class, property | no | schema |
| hcl | module, class, property | no | config |
| terraform | (as hcl) | no | config |
| protobuf | interface, method, class, property | **schema declarations** | schema |
| **make** | **module, function** | **yes — recipes are shell** | **GAP — see below** |

### The `make` gap (honest correction)

`make` was initially recorded as "build recipes are shell text; make is not parsed
as an execution context". That is **wrong**: the parser emits a `function` symbol
per recipe, and its body is real shell. Verified body extraction:

```
symbols: module Makefile (1-6), constant CMD (1-2), function run (2-6)
run body: "run:\n\t@echo \"$(CMD)\"\n\tsh -c \"$(CMD)\"\n"
```

A recipe can absolutely carry `$(VAR)` → `sh -c`, which is command injection.
`make` therefore belongs in `leads`, not `unsupported`, and needs a spec with:

- source: `$(VAR)` / `${VAR}` make-variable expansion (the make analogue of an env read)
- sink: `sh -c` / `bash -c` / `eval` inside a recipe, `$(shell ...)`
- sanitizer: none standard — declared as a limit

This is a **known gap**, recorded here rather than silently left at `unsupported`.
`protobuf` is different: it emits `method`/`interface` nodes, but those are schema
declarations with no body and no runtime dispatch, so there is no source→sink
surface — that one stays `unsupported` with this evidence.

## What still blocks a per-family `scan` promotion

Coverage is now complete for the `leads` tier. Promotion to `scan` is blocked by
the same measured absence as before: **recall is unmeasurable on this host**
(198/199 corpora are shallow single-commit snapshots; see
`validation/m72/oracle/cve/README.md`). Coverage ≠ proof.
