// decorator-emission — a decorator is `decorates`, not `references`.
//
// The construct the ten stored values could not spell: `@sealed` is applied TO the declaration
// below it; no value in the ten says that, and `references` said something else (the symbol's
// body mentions this name). The owner admitted `decorates` for it (src/ast/types.ts). Three facts
// are pinned here and each has a forbid beside it, because a pin that cannot fail proves nothing:
//
//   1. the row exists with the right SOURCE (the decorated declaration) and TARGET (the
//      decorator's NAME leaf) — and NOT under the old `references` label;
//   2. the decorator's ARGUMENT is not a row: `@Get("/items")` names `Get`, never `/items`;
//   3. the decorator invocation is not a CALL by the declaration that carries it.
function sealed(target: unknown): void {
  void target
}

function Get(path: string) {
  void path
  return function (target: unknown, key: string): void {
    void target
    void key
  }
}

@sealed
export class Api {
  @Get("/items")
  list(): number {
    return 1
  }
}
