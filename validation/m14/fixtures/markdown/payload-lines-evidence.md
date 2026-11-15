# Every edge carries a 1-based line and an evidence class

Both were absent from this lane. `line_number` was missing on all 9,132
relationships the analyzer emitted over its own pinned corpus — 35 of 41 analyzers
publish it, and `context.mdInlineLines`, which the engine computes for exactly
this purpose, was read by nobody. `evidenceClass` was missing too, and because
the read-time derivation in `graph-core.ts` does not list `contains` among the
structural types, the heading hierarchy was rendered to readers as `inferred` —
"a guess, treat as a hint, never as fact" — for edges that are a direct AST
parent/child relation.

## Structural edges carry structural

This heading owns the paragraph below, and therefore the link in it.

An [inline link](https://example.com/payload) resolves a destination.

```python
print("payload")
```

## Both classes, on named edges

| Column | Value |
| --- | --- |
| one | two |

A [reference link][pl] resolves a definition.

[pl]: https://example.com/pl
