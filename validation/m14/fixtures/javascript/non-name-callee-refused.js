// §2 regression fixture — a `calls` TARGET must be a NAME.
//
// The guard this pins tested TOKEN MEMBERSHIP (length > 100, newline, backtick,
// `${`, `{`/`}`/`;`/`=`) as a proxy for "this leaf is error-recovery garbage". A
// proxy for a name test is not a name test: a callee written as a parenthesised or
// conditional expression contains NONE of those tokens, so the callee's own SOURCE
// TEXT was published in the `target` field — the field the graph reads as a symbol
// name. Each line below reproduces one shape, and the two calls above them are the
// positive controls: the fix must not cost the analyzer a single real call.
//
// SIX OF THE SEVEN SHAPES ARE PRE-FIX ARMS, and the seventh is NOT — measured by
// reverting only this guard in a copy of the analyzer and re-running this suite:
// `(fn)`, `(0, helper.other)`, `(cond ? a : b)`, `define()`, `"text"` and `[]` were
// all published as targets, and the IIFE below was not, because its braces trip the
// old `hasBraceEquals` clause. That row is therefore a CONTRACT pin (an IIFE callee
// has no name and must never be published), not evidence the old guard missed it —
// stated because a fixture that claims an arm it does not have is the defect this
// lane keeps finding in other people's notes.
//
// Measured on the corpora, not inferred from the shape (instrument:
// script/m14/js-ontology/js-callee-shape-census.ts): 31 of 31,973 `calls` rows on
// svelte and 550 of 22,210 on the ts corpus carried source text. This file is the
// only place the class is pinned, because no fixture existed — which is why the
// class survived a lane that had already shipped a terminal guard for the
// neighbouring one (an empty endpoint is empty; a callee full of punctuation is
// not, and only a name test can tell the two apart).
//
// `this.#tick()` is the control that makes the rule a SHAPE test rather than an
// alphanumeric filter: 123 svelte rows are private-method calls, and a filter
// without a `#` clause would have deleted all of them to remove the 31.
import { helper } from "./helper.js"

function direct(fn, cond, a, b) {
  fn()                             // positive: calls fn
  helper.save(1)                   // positive: calls save — the member leaf, not the chain
  const one = (fn)()               // was calls "(fn)"
  const two = (0, helper.other)()  // was calls "(0, helper.other)" — the TS interop shape
  const three = (cond ? a : b)()   // was calls "(cond ? a : b)"
  const four = (function () {})()  // was calls "(function () {})" — an IIFE callee
  const five = define()()          // was calls "define()" — a call-expression callee
  const six = "text"()             // was calls "\"text\""
  const seven = []()               // was calls "[]"
  return [one, two, three, four, five, six, seven]
}

class Counter {
  #n = 0
  #tick() {
    this.#n += 1
    return this.#n
  }
  bump() {
    return this.#tick()  // positive: calls "#tick" — the `#` clause is load-bearing
  }
}
