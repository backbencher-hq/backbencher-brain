# Precision ledger — bb_lsp per-language, per-feature truth (M29.R4)

Inputs hash `8931c8b984e5eecc0b5614bdded30364c51cb685` (deterministic: byte-identical regeneration is the drift gate. The hash covers the evidence's semantic content; declared volatile run metadata — commit, generation time, seal — is excluded, so an upstream re-run does not report a false "stale". Run record with commit + timestamp lives in validation/m29/results/R4.json).

> This document is **generated** from evidence files. A hand edit breaks the drift gate (`script/m29/verify-precision-ledger.ts`). Claim levels are computed by the R1 binding from recorded evidence — they cannot be edited up. Staleness policy: any input-evidence change makes this stale until regenerated.

**Row set:** 52 owner-approved languages across waves 1, 2, 3 — every language named by a sealed wave approval record has a row, and the wave column names the record that admitted it. A language with no recorded S5 leg reads I0 (declared absence).

| language | claim | wave | conformance | hover | tier | def | refs | docSym | wsSym | absence | callHier | budget | diff missing/unexplained | ms/file | tiers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| java | I3 | 1 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 10.9 | 2 |
| javascript | I3 | 1 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 279.4 | 3 |
| kotlin | I3 | 1 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 41.8 | 4 |
| python | I3 | 1 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 45.7 | 5 |
| scala | I3 | 1 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 3.8 | 3 |
| typescript | I3 | 1 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 113.1 | 3 |
| c | I3 | 2 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 203.8 | 4 |
| cpp | I3 | 2 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 154.1 | 3 |
| go | I3 | 2 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 36.4 | 5 |
| groovy | I3 | 2 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 17.7 | 2 |
| rust | I3 | 2 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 80.9 | 4 |
| svelte | I3 | 2 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 11.3 | 3 |
| vue | I3 | 2 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 142.1 | 4 |
| zig | I3 | 2 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 85.5 | 4 |
| bash | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 3.6 | 3 |
| clean | I0 | 3 | FAIL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ?/? | ? | ? |
| clojure | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 9.6 | 3 |
| csharp | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 91.2 | 5 |
| css | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 6.4 | 3 |
| dart | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 91.7 | 3 |
| elixir | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 20.1 | 5 |
| erlang | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 8 | 4 |
| fsharp | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 39.8 | 4 |
| graphql | I0 | 3 | FAIL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ?/? | ? | ? |
| haskell | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 11.1 | 3 |
| hcl | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 5 | 5 |
| html | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 1.8 | 3 |
| json | I0 | 3 | FAIL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ?/? | ? | ? |
| julia | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 83/434 | 722 | 3 |
| lua | I0 | 3 | FAIL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ?/? | ? | ? |
| make | I1 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | 0/0 | 5.8 | 14 |
| markdown | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 2.2 | 3 |
| matlab | I0 | 3 | FAIL | — | — | — | — | — | ✅ | ✅ | — | ✅ | ?/? | ? | ? |
| nim | I0 | 3 | FAIL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ?/? | ? | ? |
| perl | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 17 | 4 |
| php | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 8.7 | 3 |
| powershell | I0 | 3 | FAIL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ?/? | ? | ? |
| protobuf | I0 | 3 | FAIL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ?/? | ? | ? |
| r | I0 | 3 | FAIL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ?/? | ? | ? |
| ruby | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 3.9 | 3 |
| sass | I0 | 3 | FAIL | — | ✅ | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | ?/? | ? | ? |
| scss | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 56/3 | 21.691 | 3 |
| solidity | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 6.4 | 4 |
| sql | I0 | 3 | FAIL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ?/? | ? | ? |
| swift | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 38.8 | 4 |
| terraform | I0 | 3 | FAIL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ?/? | ? | ? |
| toml | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 0.1 | 2 |
| tsx | I0 | 3 | FAIL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ?/? | ? | ? |
| vb | I0 | 3 | FAIL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ?/? | ? | ? |
| vba | I0 | 3 | FAIL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ?/? | ? | ? |
| xml | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 3.1 | 4 |
| yaml | I2 | 3 | pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 0/0 | 31.459 | 5 |

**Giant scale (R3):** hover p95 8.69ms over 59000 files (revision 7f29ef266ea621a9); in-editor 8.13ms; cold median 1404ms; evidence-tier inferred ratio 41.2% -> 0% (R5 fix, mutant-gated). Evidence: validation/m29/results/R3.json.

## Limitations (declared)

- Differential floors are M14's committed baselines (named repo per language), not the full ecosystem — the numbers are floors, not upper bounds.
- Per-language warm p95 is measured over the wave fixture pack (real index, real server), not over giant-scale workspaces; the scale row (R3) covers the giant regime separately.
- The row set is the union of the sealed owner-approved wave records (waves 1, 2, 3; authority: the wave-<N>-approval records under validation/m29/results/). The wave column names the record that admitted a language.
- A language whose S5 leg has not run yet keeps the lowest claim (I0) with a declared absence — no approved row is omitted and no claim is assumed.
- S1 reads the committed #419 SPEC ledger, so a language absent from that ledger reads I0 even when its S5 leg is verified; the absence is a ledger gap, not a leg failure.

## Evidence paths

- java (wave 1): S5 validation/m29/results/wave-java.json (status verified); S6 validation/m29/results/wave-editor-java.json (status verified)
- javascript (wave 1): S5 validation/m29/results/wave-javascript.json (status verified); S6 validation/m29/results/wave-editor-javascript.json (status verified)
- kotlin (wave 1): S5 validation/m29/results/wave-kotlin.json (status verified); S6 validation/m29/results/wave-editor-kotlin.json (status verified)
- python (wave 1): S5 validation/m29/results/wave-python.json (status verified); S6 validation/m29/results/wave-editor-python.json (status verified)
- scala (wave 1): S5 validation/m29/results/wave-scala.json (status verified); S6 validation/m29/results/wave-editor-scala.json (status verified)
- typescript (wave 1): S5 validation/m29/results/wave-typescript.json (status verified); S6 validation/m29/results/wave-editor-typescript.json (status verified)
- c (wave 2): S5 validation/m29/results/wave-c.json (status verified); S6 validation/m29/results/wave-editor-c.json (status verified)
- cpp (wave 2): S5 validation/m29/results/wave-cpp.json (status verified); S6 validation/m29/results/wave-editor-cpp.json (status verified)
- go (wave 2): S5 validation/m29/results/wave-go.json (status verified); S6 validation/m29/results/wave-editor-go.json (status verified)
- groovy (wave 2): S5 validation/m29/results/wave-groovy.json (status verified); S6 validation/m29/results/wave-editor-groovy.json (status verified)
- rust (wave 2): S5 validation/m29/results/wave-rust.json (status verified); S6 validation/m29/results/wave-editor-rust.json (status verified)
- svelte (wave 2): S5 validation/m29/results/wave-svelte.json (status verified); S6 validation/m29/results/wave-editor-svelte.json (status verified)
- vue (wave 2): S5 validation/m29/results/wave-vue.json (status verified); S6 validation/m29/results/wave-editor-vue.json (status verified)
- zig (wave 2): S5 validation/m29/results/wave-zig.json (status verified); S6 validation/m29/results/wave-editor-zig.json (status verified)
- bash (wave 3): S5 validation/m29/results/wave-bash.json (status verified); S6 absent (declared)
- clean (wave 3): S5 validation/m29/results/wave-clean.json (status verified); S6 absent (declared)
- clojure (wave 3): S5 validation/m29/results/wave-clojure.json (status verified); S6 absent (declared)
- csharp (wave 3): S5 validation/m29/results/wave-csharp.json (status verified); S6 absent (declared)
- css (wave 3): S5 validation/m29/results/wave-css.json (status verified); S6 absent (declared)
- dart (wave 3): S5 validation/m29/results/wave-dart.json (status verified); S6 absent (declared)
- elixir (wave 3): S5 validation/m29/results/wave-elixir.json (status verified); S6 absent (declared)
- erlang (wave 3): S5 validation/m29/results/wave-erlang.json (status verified); S6 absent (declared)
- fsharp (wave 3): S5 validation/m29/results/wave-fsharp.json (status verified); S6 absent (declared)
- graphql (wave 3): S5 validation/m29/results/wave-graphql.json (status verified); S6 absent (declared)
- haskell (wave 3): S5 validation/m29/results/wave-haskell.json (status verified); S6 absent (declared)
- hcl (wave 3): S5 validation/m29/results/wave-hcl.json (status verified); S6 absent (declared)
- html (wave 3): S5 validation/m29/results/wave-html.json (status verified); S6 absent (declared)
- json (wave 3): S5 validation/m29/results/wave-json.json (status verified); S6 absent (declared)
- julia (wave 3): S5 validation/m29/results/wave-julia.json (status verified); S6 absent (declared)
- lua (wave 3): S5 validation/m29/results/wave-lua.json (status verified); S6 absent (declared)
- make (wave 3): S5 validation/m29/results/wave-make.json (status failed); S6 absent (declared)
- markdown (wave 3): S5 validation/m29/results/wave-markdown.json (status verified); S6 absent (declared)
- matlab (wave 3): S5 validation/m29/results/wave-matlab.json (status failed); S6 absent (declared)
- nim (wave 3): S5 validation/m29/results/wave-nim.json (status verified); S6 absent (declared)
- perl (wave 3): S5 validation/m29/results/wave-perl.json (status verified); S6 absent (declared)
- php (wave 3): S5 validation/m29/results/wave-php.json (status verified); S6 absent (declared)
- powershell (wave 3): S5 validation/m29/results/wave-powershell.json (status verified); S6 absent (declared)
- protobuf (wave 3): S5 validation/m29/results/wave-protobuf.json (status verified); S6 absent (declared)
- r (wave 3): S5 validation/m29/results/wave-r.json (status verified); S6 absent (declared)
- ruby (wave 3): S5 validation/m29/results/wave-ruby.json (status verified); S6 absent (declared)
- sass (wave 3): S5 validation/m29/results/wave-sass.json (status failed); S6 absent (declared)
- scss (wave 3): S5 validation/m29/results/wave-scss.json (status verified); S6 absent (declared)
- solidity (wave 3): S5 validation/m29/results/wave-solidity.json (status verified); S6 absent (declared)
- sql (wave 3): S5 validation/m29/results/wave-sql.json (status verified); S6 absent (declared)
- swift (wave 3): S5 validation/m29/results/wave-swift.json (status verified); S6 absent (declared)
- terraform (wave 3): S5 validation/m29/results/wave-terraform.json (status verified); S6 absent (declared)
- toml (wave 3): S5 validation/m29/results/wave-toml.json (status verified); S6 absent (declared)
- tsx (wave 3): S5 validation/m29/results/wave-tsx.json (status verified); S6 absent (declared)
- vb (wave 3): S5 validation/m29/results/wave-vb.json (status verified); S6 absent (declared)
- vba (wave 3): S5 validation/m29/results/wave-vba.json (status verified); S6 absent (declared)
- xml (wave 3): S5 validation/m29/results/wave-xml.json (status verified); S6 absent (declared)
- yaml (wave 3): S5 validation/m29/results/wave-yaml.json (status verified); S6 absent (declared)

