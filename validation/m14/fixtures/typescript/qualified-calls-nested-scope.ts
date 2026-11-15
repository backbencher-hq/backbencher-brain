// `qualified_calls` is the dotted-call-path payload on a symbol. The walk that
// fills it used to STOP at every nested function, so:
//
//   1. a call inside a callback was missing from the payload while the GRAPH
//      carried the edge — `items.map(i => helper())` emitted `outer->helper`
//      and listed only `items.map`. The payload and the graph disagreed about
//      the same call, and the javascript twin (which rebinds per function)
//      listed both.
//   2. deleting that boundary alone would have been wrong the other way: a
//      nested `function inner(){}` IS a symbol, so its calls would land on
//      BOTH symbols.
//
// The contract pinned here: a call belongs to the symbol that lexically owns
// it — the nearest enclosing symbol, not the symbol the walk started from, and
// not the module. A callback with no symbol of its own keeps the enclosing
// symbol; a nested function with a symbol keeps its own.
//
// Authored BEFORE the analyzer run: the pre-fix payload was measured by probe
// (items.map only / helper on both symbols) before these pins were written.
export function helper(): number {
  return 1;
}

// 1. the call inside a CALLBACK is this symbol's (the callback has no symbol).
export function outer(items: number[]): number[] {
  return items.map((i) => helper() + i);
}

// 2. a nested function IS a symbol: its call belongs to `inner`, NOT to
//    `outer` — the anti-pollution direction an includes-only pin cannot catch.
export function enclosing(): number {
  function inner(): number {
    return helper();
  }
  return inner();
}

// 3. mixed: the outer call and the callback's call, plus a call inside an
//    object-literal method, all resolve to the right owner.
export function mixed(rows: any[]): unknown {
  const helper2 = {
    save(row: any) {
      return row.client.persist(row.id);
    },
  };
  return rows.map((r) => helper2.save(r));
}

// 4. dedup: one path, listed once (the family contract is a set of paths; the
//    pre-fix payload carried a multiset — `path.join` four times for four
//    sibling statements).
export function repeated(a: string, b: string, c: string): string {
  const j1 = a;
  const j2 = b;
  const j3 = c;
  return j1 + j2 + j3;
}

// 5. a same-named method on two classes must not cross-contaminate: each
//    payload lists its own body only.
export class Alpha {
  alphaOnly(): number {
    return helper();
  }
}

export class Beta {
  betaOnly(): number {
    return helper();
  }
}
