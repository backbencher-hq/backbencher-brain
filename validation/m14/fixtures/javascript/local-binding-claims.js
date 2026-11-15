// LOCAL-BINDING CLAIMS — the family separator spelling, with the negative controls that matter.
//
// A name the FILE binds lexically is published as `${edge.source}\u0000${name}` with
// metadata.localBinding, so the arbiter verifies the SPELLING (gate `bindOK` column) instead of
// letting the store bind the bare name to an unrelated same-named declaration. Nothing here is a
// resolution: binding rows are a claim class and are never merged into `resolved`.
//
// POSITIVE: parameter read · const read · nested function-declaration call · local function
// expression call · `new` of a locally bound class expression · `instanceof` a local type ·
// catch binding · `var` hoisted out of a block · destructured parameter names.
// NEGATIVE: a MODULE-SCOPE declaration is a published symbol and gets NO binding claim (the edge
// may resolve normally); an IMPORT binding and a `require(...)` binding belong to the
// imported-binding seam class and get NO local claim.

import { importedThing } from "./module.js";

function outer() {
  const count = 1;
  function helper() {
    return count;
  }
  return helper() + count;
}

function readsParam(param) {
  return param;
}

function destructured({ alpha, beta: renamed }) {
  return alpha + renamed;
}

function callSite() {
  const fn = function () {
    return 1;
  };
  return fn();
}

function instantiateSite() {
  const Local = class {};
  return new Local();
}

function instanceofSite() {
  function LocalType() {}
  return {} instanceof LocalType;
}

function catches() {
  try {
    throw 1;
  } catch (err) {
    return err;
  }
}

function varHoist() {
  if (true) {
    var hoisted = 1;
  }
  return hoisted;
}

class UsesThis {
  method() {
    const local = 1;
    return local;
  }
}

const moduleConstant = 42;

function readsModule() {
  return moduleConstant;
}

function readsImport() {
  return importedThing;
}

function readsRequire() {
  const fsMod = require("fs");
  return fsMod;
}
