// fixture: typescript/index-signature-lines
// Disastrous-review ruling (2026-09-18): an index signature's member is named
// `[key]` — brackets included — in BOTH the symbol and its contains edge, so
// the two can never disagree, and the bracketed form cannot collide with a
// real property named `key`. The name's writeline (13) carries `key`, so
// navigation lands correctly. Tier A cannot check bracketed tokens by shape
// rule (notCheckable, never a failure); this pin locks the agreement itself.
class Dict {
  [key: string]: unknown;
}
