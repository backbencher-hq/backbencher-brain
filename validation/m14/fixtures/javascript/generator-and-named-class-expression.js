// X10 + X11 (2026-09-28) — two defects found by PROBING declaration forms that
// the construct census had DECLARED but never probed. The dispositions existed,
// so the forms looked covered; nothing had ever asked the analyzer what it did
// with them.
//
// X10: a generator EXPRESSION. The grammar's node name is `generator_function`,
// and none of this analyzer's three function-value checks listed it. Measured
// before the fix: `const f = function() {}` published f:function and
// `const h = () => {}` published h:function, while `const g = function*() {}`
// published g:constant. One language rule — a const bound to a function value is
// a Function — answered two ways by shape.
//
// X11: a NAMED class expression. The member owner preferred the expression's own
// name over its binding, so `contains Inner->m` pointed at a name no symbol
// carried. The ANONYMOUS form was already right (`const E = class {…}` ->
// `contains E->m`), which is what makes this a defect: the same construct gave
// two answers depending on whether the author named the expression. It also
// contradicted the lane's own ruling (design_decision 30) that a class expression
// emits no Class symbol because the BINDING is its identity — so the edge named
// the one thing the ruling says is not emitted.
//
// The binding `D` is deliberately still a Constant, not a Class: that is
// decision 30, and this fixture pins it rather than changing it.

function* declaredGen() {
  yield 1;
}

const genExpr = function* () {
  yield 2;
};

const asyncGenExpr = async function* () {
  yield 3;
};

const plainExpr = function () {
  return 4;
};

const arrowExpr = () => 5;

// Named class expression: the member is owned by the BINDING (D), never by the
// expression's own name (Inner), which no symbol carries.
function helper() {
  return 6;
}

const D = class Inner {
  ownMethod() {
    return helper();
  }
};

// The anonymous form, pinned alongside so the two cannot drift apart again.
const E = class {
  anonMethod() {
    return 7;
  }
};

class Plain {
  declaredMethod() {
    return 8;
  }
}

export { declaredGen, genExpr, asyncGenExpr, plainExpr, arrowExpr, D, E, Plain };
