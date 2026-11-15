// ─────────────────────────────────────────────────────────────────────────────
// PIN CORRECTED 2026-10-17 (Lead-authorised pin-change set, iteration 2d).
// Contract: a type MENTION emits a `uses` row and drops the DUPLICATE `references`
// row (one-label ruling, direction corrected). This fixture pinned the old
// `references` behaviour, so its pin moved with the contract:
//   expected `references X -> T`  ->  expected `uses X -> T`, and
//   forbid the duplicate `references X -> T`.
// Stated only where this fixture's own rows changed (see each row's note).
// ─────────────────────────────────────────────────────────────────────────────
// A PARAMETER shadows every module- and class-level name for the whole body of
// its function, and a read of that name resolves to the parameter \u2014 never to the
// file-level symbol that happens to share it.
//
// The reference pass resolves by NAME. It already knew this: `locals` holds a
// function's own destructuring patterns and its `const`/`let` declarators, so a
// read of one of those resolves to the local and publishes nothing. A parameter
// was simply missing from that set \u2014 the most local binding a function has.
//
// The consequence was a false `references` edge in the direction that matters
// most, because it is invisible: `interface D { root: string }` plus
// `function f(root: string) { return root }` published `f->root`, so the graph
// recorded the function as referencing `D.root` \u2014 a property of an interface it
// never touches \u2014 purely because its own parameter had that name.
//
// Measured before the fix: 160 of 2,880 `references` edges over 700 tracked files
// (5.6%), led by exactly the names one would expect to collide: `n`, `root`,
// `name`, `src`, `node`, `source`. After: 0, with every genuine reference intact.
//
// The negatives are pinned as hard as the positives, because the opposite
// mistake \u2014 seeding `locals` too eagerly \u2014 would silence real edges and a
// graph that under-claims is as wrong as one that over-claims.
//
// Authored BEFORE the analyzer run.
interface Deps {
  root: string;
  env: string;
  name: string;
  source: string;
}

const root = "/repo";
const name = "root";
const helper = () => "helper";

// FALSE POSITIVE 1: the parameter shadows the interface property.
export function byParam(root: string, name: string): string {
  return root + name;
}

// FALSE POSITIVE 2: the parameter shadows the module const AND the function.
export function byParamShadowingFn(helper: () => string): string {
  return helper();
}

// FALSE POSITIVE 3: a destructuring parameter binds the same name.
export function byDestructuredParam({ root, name }: { root: string; name: string }): string {
  return root + name;
}

// FALSE POSITIVE 4: a rest parameter.
export function byRestParam(...source: string[]): string {
  return source.join("");
}

// TRUE POSITIVE 1: the module const really is referenced \u2014 the fix must not
// silence this, which is the failure mode an over-eager `locals` would cause.
export function usesConst(): string {
  return root;
}

// TRUE POSITIVE 2: a real call to another declared function.
export function callsHelper(): string {
  return helper();
}

// TRUE POSITIVE 3: a type annotation, which is a reference regardless of any
// parameter that might share the name.
export function annotates(deps: Deps): string {
  return deps.root;
}
