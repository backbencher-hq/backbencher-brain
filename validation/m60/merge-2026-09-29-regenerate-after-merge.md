# Artifacts that must be re-run after the 2026-09-29 laptop merge

`origin/main` gained 63 commits (c, csharp, clojure, elixir, erlang, fsharp, go,
ruby, zig, index, shared harness) while this laptop had 117 unpushed, and the two
sides had both regenerated the same generated artifacts. Seven conflicted.

## Rule applied

Took the **newer side** for all seven, and did not hand-merge any of them. A
generated artifact is a *measurement*, and two measurements of the same gate
cannot be unioned without inventing a run that never happened. `grammar-pins.json`
is the one that looks like a manifest and is not safe to union either: the digest
fields are the anti-hermeticity protection, and a hand-built file carrying digests
from two different runs is worse than either run's file.

Re-running was attempted and is not currently possible: `verify-grammar-pins.ts`
fails to parse its input on the merged tree (the error is a JSON parse, so it is
reading a conflicted or non-JSON file, not failing a check). That is itself worth
fixing, and it is why regeneration was not forced here.

## What each side held that the other did not

Measured by diffing the JSON leaf paths, not by line count:

| artifact | only-ours | only-theirs | resolution |
|---|---|---|---|
| `M14.0.F4.json` | 0 | 704 | theirs is a strict superset — nothing lost |
| `M14.0.F9.json` | 0 | 4 | theirs is a strict superset — nothing lost |
| `M14.0.F7.json` | 0 | 0 | identical key sets, values only |
| `M14.0.F8.json` | 0 | 0 | identical key sets, values only |
| `M14.0.F1.json` | 39 | 73 | **divergent** — different `deadLiteralRegister` adjudications |
| `grammar-pins.json` | 234 | 167 | **divergent** — ours had haskell `sha256`/`bytes`, theirs had haskell `copies/absent` + `sourceVsWasm/note` |
| `P1.json` | 354 | 36 | **divergent** — ours had more `surface/languages` and a `make` emitByLang, theirs had more `measuredSources/dirty` |

The four non-divergent ones are safe as merged. The three divergent ones record
genuinely different runs, and which one is correct for the merged tree is a
question only a re-run can answer. **`M14.0.F1.json`, `grammar-pins.json` and
`P1.json` should be regenerated before their numbers are quoted.**
