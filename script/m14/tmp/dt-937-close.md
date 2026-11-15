**CLOSED — fixed at `12da50ee`; the analyzer was not touched.**

The prescan now accepts `extension_type_declaration` as a constructor-owning container (name via `childForFieldName("name")` / first `identifier`), mirroring DARTD21 and the oracle's existing extension-type branch.

Same file (`native_cupertino_bindings.dart`), after: analyzer-only **0**, oracle-only **0** (`script/m14/tmp/dt-extent-triage.ts`).

FULL extent, after — `bun script/m14/differential.ts --repo dart-http --sample 400`, 335/335 files, sample hash `2dee60fd89aee7be` (the **same** drawn set as the red draw, so a strict same-files before/after):

```
before: tree-truth=13628 covered=13627 (100%) MISSING=1 | analyzer-edges=12708 unexplained=27 (0.2%) heuristic=0
after : tree-truth=13654 covered=13654 (100%) MISSING=0 | analyzer-edges=12708 unexplained=0 (0%)   heuristic=0
```

Truth `13,628 → 13,654` (+27 named-constructor `instantiates` inside `extension type` containers, −1 keyword `calls -> as`) with the analyzer's edge count **unmoved at 12,708**: the truth instrument learned to explain edges the analyzer had been emitting correctly all along.
