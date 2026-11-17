// JS-twin parity fixture: a NAMED function expression is its own read actor.
//
// `const inner = function handler() { ... }` is a real runtime function named `handler`. The
// javascript twin has rebound the reads inside it to `handler` since its calls walk was written
// (and its uses walk was measured 53 + 77 rows wrong before it caught up); this twin only
// consulted the variable declarator, so every read and call inside `handler` was charged to
// `outer` — a name that does not contain the read.
//
// The ANONYMOUS function expression beside it is the control: with no name of its own it keeps
// the enclosing actor, exactly as the twin does. A fix that rebound anonymous expressions too
// would pass the positive checks below and fail the control's `forbid`.
const outerRead = (_x: number): number => 0
let offset = 1

function outer(): number {
  const inner = function handler(x: number): number {
    outerRead(x)
    return x + offset
  }
  const anon = function (x: number): number {
    return outerRead(x) + offset
  }
  return inner(1) + anon(2)
}

export { outer, offset }
