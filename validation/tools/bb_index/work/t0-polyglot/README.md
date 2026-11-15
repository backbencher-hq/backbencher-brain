# Polyglot fixtures (M26.A1, issue #615)

Minimal deterministic projects for proving the cross-language chain with rows
the REAL indexer wrote (not seeded rows):

- `java-scala/` — Scala calls into Java (`Warehouse.currentStock` -> `Inventory.getStock`).
  Exercises the INSERT-TIME resolution path (java file parses before scala,
  so targets exist in the db when the scala relationships are inserted).
- `ts-js/` — TypeScript calls into JavaScript (`checkout.total` -> `pricing.basePrice`).
  Exercises the LATE-RESOLUTION path (forward reference: `pricing.js` sorts
  after `checkout.ts`, so the edge is stored unresolved and resolved by the
  post-processing `resolveRelationships` pass).

Both paths must flag `is_cross_language=1` with `bridge_mechanism =
name-resolution`. Gated by `script/m26/verify-polyglot-e2e.ts`.
