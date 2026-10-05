# U2-DOC-ENGINE-PATCH.diff — the ONE defect this lane found that lives outside its files

**Status** — patch authored, applied, typechecked and measured GREEN on branch
`lsp/8`; **reverted before commit** because `src/intelligence/**` is not this
lane's to change. Apply with:

```text
git apply script/m28/U2-DOC-ENGINE-PATCH.diff
npx tsx script/m28/verify-surface-parity.ts    # was 38/39 with the leak; becomes 39/39
```

## The defect (§15.4 "Human text is human")

`bb_doc` is a tool a developer reads. Its signature renderer is a SECOND
implementation, private to `src/intelligence/documentation/doc-engine.ts`
(`renderSignature` at the module level and `formatParameters` below it), not the
owner at `src/lsp/signature.ts`. The two disagree on every stored shape that is
not the analyzer's happy path. Measured over the nine stored shapes
`script/m28/verify-surface-parity.ts` probes, by seeding each one into the
fixture index and reading the markdown line a reader sees:

| stored `parameters` | `bb_doc` renders | the owner renders |
|---|---|---|
| `[{"name":"names","type":"string[]"}]` (the shape 82.8% of real rows carry) | `method count(names: string[])` | same — the one case they agree on |
| `{"name":"names","type":"string[]"}` (a JSON OBJECT) | `method count({"name":"names","type":"string[]"})` | `method count(…)` |
| `[{"type":"string[]"}]` (entry with no name) | `method count(?): string[]` | `method count(…)` |
| `[{"name":"names"}]` (entry with no type) | `method count(names)` | `method count(names: unknown)` |
| `[1,2,3]` (array of non-objects) | `method count` | `method count(…)` |
| `(int a, int b)` (already-rendered text) | `method count((int a, int b))` | `method count(int a, int b)` |
| `[]` | `method count` | `method count()` |

Three §15.4 violations, not one:

1. **Raw JSON in human text.** A stored object reaches a developer as
   `{"name":"names","type":"string[]"}`. That is serialization, not a signature.
2. **A guessed parameter name.** `[{"type":"string[]"}]` renders `?: string[]` —
   the `?` is a name the index never stored, invented by the renderer.
3. **A false absence.** `[1,2,3]` and a vanished `[{"type":"…"}]` render a bare
   `method count`, which reads as "this function takes no arguments". §15.4's
   mirror of the m63 CL1 lesson: absence that over-claims is worse than an
   absence that is declared.

## Why the fix DELEGATES rather than patches

The m63 CL1 lesson is that the COPY is what breaks: patching branches of a second
renderer means the next stored shape meets it first. The patch deletes
`formatParameters`'s decision table and calls the owner's
`renderParameterList`, and makes the local `renderSignature` a thin adapter over
the owner's `renderSignature`. That also inherits the owner's declared rules for
free — a class never renders a parameter list, an unresolvable type renders the
`unknown` marker, rest/implicit parameters follow the source language's
notation, and a non-array JSON value renders `(…)`.

One declared consequence the owner of that file should decide on: the patch
passes `String(symbol.language ?? "")`, and the symbol queries select
`s.*, f.path, f.relative_path` without `f.language`, so the language is always
`""` and the owner's declared TS/JS fallback notation applies. Adding
`f.language` to those SELECTs would switch Java/Kotlin/Groovy/Scala documents to
their own notation — the better answer, and a visible change to every generated
document, so it is left as the file owner's decision rather than smuggled in here.

## What the gate says without this patch

`script/m28/verify-surface-parity.ts` → **U2: KNOWN-GAP (38/39 passed,
5/5 mutants observed)**, the single failure being
`U2 §15.4: no bb_doc signature renders raw JSON into human text (all 9 stored
shapes) — 1 leak(s)`.