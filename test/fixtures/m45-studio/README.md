# m45-studio — "Ledgerline" demo corpus

A small but genuine TypeScript commerce domain authored as the filming
subject for M45's demo films (D1). Every symbol, relationship, and hover
shown on camera is produced by the real bb indexer and the real bb_lsp
server running against this directory — nothing about the footage is
mocked.

Design intent (why it films well):

- `Money` is a genuine hub type — used by pricing, orders, models, and
  routing, so its rich hover shows a wide, cross-file usage graph.
- `OrderService.place` is called from `orders-router` and instantiated in
  `app.ts`, so hover/connect data spans files the way real code does.
- Failure paths return `Result` instead of throwing — realistic domain
  code, not a toy.

Rules:

- The corpus is indexed from `src/` (the README and configs are not part
  of the indexed graph).
- Any film claiming behavior must be able to re-derive its claims from a
  fresh index of this directory at the pinned commit.
