# PROPOSAL — the YAML F5 oracle is BUILT and MEASURED (missing=0 both corpora; 9 unexplained, all named)

**For the Lead.** `script/m14/differential.ts` now carries the four pieces the lane was missing. One command was
run, exactly the one briefed, alone, with `--update-baseline`:

```
BB_CORPUS_ROOT=/home/ishaq2321/mcp/backbencher-brain/.corpus bun run script/m14/differential.ts --lang yaml --update-baseline
[kubernetes] yaml: files=60 tree-truth=15594 covered=15594 (100%) MISSING=0 | analyzer-edges=12349 unexplained=9 (0.1%) hash=e16a7ffe
[ansible]    yaml: files=60 tree-truth=14314 covered=14314 (100%) MISSING=0 | analyzer-edges=13812 unexplained=0  (0%)  hash=c9d0e1b5
```

## WHAT WAS ADDED (three wiring points + one truth function)
1. **`LANGS.yaml`** — the lane was not merely truth-less: it was not a lane at all. Lanes are built from
   `Object.keys(LANGS)`, and yaml had no entry, so `--lang yaml` measured nothing.
2. **`deriveYamlEdges(root, relPath)`** — derived from the parse tree, sharing no rule table, key set, path helper or
   resolver with `RealYamlAnalyzer`. Handles multi-document streams, `[i]` sequence identity, `#n` duplicate-key
   identity, `<owner>#anchor` anchor identity, and the contract's document naming (`dirScope.stem`, `#n` for doc n>1).
3. **The `if (lang === "yaml")` truth push** beside the bash/toml/json branches.
4. **The comparable-label arm** — `["contains", "references", "imports", "uses", "calls", "exports"]` added to the
   analyzer-edge allowlist. **This was load-bearing and invisible:** the first probe with a fully working oracle read
   `covered=0 (0%) MISSING=3079 … analyzer-edges=0`, because the allowlist did not admit yaml and dropped EVERY
   analyzer edge before comparison. It is the #910 (c imports) / G7 (groovy uses) / powershell gap in its fifth
   direction, and a 0% row is indistinguishable from a catastrophic regression without reading the allowlist.

## DERIVED / REFUSED (full detail in the oracle header and YAML-STATE.md)
Derived from the tree: contains, extends (merge `<<`), uses (non-merge alias), overrides (duplicate keys).
Derived from the contract's documented conventions: references (`$ref` pointers resolved against the oracle's own
index, tag types), imports (tag includes, Ansible keyword includes, step-level `uses:`), calls (job-level `uses:`),
exports (OpenAPI `components.*` of an openapi/swagger document).
Refused with reasons: **implements / instantiates** (RULED grammar-absence, YAML-D10/D11). **The k8s resource-reference
and Compose `depends_on` families** — key-set conventions whose transcription from the analyzer would make the oracle a
mirror; they arrive as unexplained edges carrying their own `metadata.relationshipType` markers.

## THE 9 UNEXPLAINED — ALL ONE REFUSED FAMILY, NAMED
`references` on `staging/src/k8s.io/api/testdata/v1.35.0/*.after_roundtrip.yaml` (placeholder payloads):
`configMapKeyRef` → deployment name · `spec.serviceAccountName` → `serviceAccountNameValue` ·
`volumes[].persistentVolumeClaim.claimName` → `claimNameValue` · `secretName` → `secretNameValue` ·
`cluster/addons/metadata-agent/…/metadata-agent.yaml` L31 → `metadata-agent#2` (document-scoped object-name reference).
All five are `yaml_resource_ref`-class k8s conventions — the exact family refused on independence grounds.
**Not tuned to zero**, per the brief.

## THE TWO DECISIONS THIS LEAVES THE LEAD
1. **Section E/F state:** `ansible:yaml` is pinned 0/0 by this run (perf 24.4 ms/file). `kubernetes:yaml` was
   **refused pinning by the harness's own #870 rule** — "a lane carrying its own missing/unexplained is never pinned".
   So the lane can now be *measured*, but its E row is either an accepted residual (`floorResidual: {missing:0,
   unexplained:9, ruling: "k8s resource-reference family not modelled by the F5 oracle"}`) or closed by giving that
   family an independent rule.
2. **If the family is to be derived**, it should be a *documented convention table in the oracle* (key → shape), not
   the analyzer's constants copied across; otherwise the independence property that makes F5 mean anything is lost.
