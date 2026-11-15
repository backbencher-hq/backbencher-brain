// JD3 regression fixture — a member's owner is whatever the language NAMES.
//
// `scopeOwnerName` reported CLASS scopes only, and only `class_declaration`
// pushed one, so every member of an OBJECT LITERAL and every member of a CLASS
// EXPRESSION came out ownerless — and `addContainmentRelationships` gates on
// `ownerName`, so those members produced no containment edge at all. Measured
// (M60 review JD3): 308 of 2,833 symbols (10.9%) on a 400-file production draw.
//
// The three NAMED container forms are pinned here, one per binding shape:
//   - a const-bound object literal          (`api`)
//   - a const-bound class expression        (`K`)
//   - an assignment-bound class expression  (`SvelteElement`) — the form a
//     custom-element base is actually written in, and the one the first cut of
//     the fix missed (20 members still ownerless on the corpus draw).
//
// The UNNAMED form is pinned as silence, not as a gap: a literal passed as a
// call argument names nothing, so the language permits no containment edge and
// the analyzer must not invent an owner for it.

const api = {
  run() {
    return step();
  },
};

const K = class {
  helper() {
    return step();
  }
};

let SvelteElement;
SvelteElement = class {
  attach() {
    return step();
  }
};

step();

runSomeFactory({
  inline() {
    return step();
  },
});

function step() {
  return 1;
}

function runSomeFactory(x) {
  return x;
}
