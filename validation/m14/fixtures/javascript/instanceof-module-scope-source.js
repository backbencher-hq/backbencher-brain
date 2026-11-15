// R7 regression fixture — an `instanceof` with NO enclosing declaration is
// sourced to the MODULE, never to a placeholder literal.
//
// `extractInstanceofRefs.resolveSource` returned the literal `"global"` when it
// walked past every `class_declaration` / `function_declaration` /
// `generator_function_declaration` / `method_definition` / `variable_declarator`
// without finding a name — i.e. for a module-scope `if (x instanceof T)` written
// as a bare expression statement, which is the shape this file pins.
//
// Measured on REAL JavaScript, not only on recovery residue: 14 rows across
// lodash's 51 ES5 files and 1 on svelte. `"global"` is a string no file in
// either corpus contains, so it is standing rule R7 in the runtime half.
//
// The lane's own convention for "this read belongs to the module" is
// `method || owner || moduleName`, and every other emitter here already uses it:
// `exports` is sourced at `moduleName`, and the `uses` walk falls back to
// `moduleName` last. This file also pins the three shapes that DO have an
// enclosing declaration, because the guard must not swallow them.

if (typeof input !== "undefined" && input instanceof Widget) {
  // a module-scope `instanceof` with no declaration around it
}

const tagged = input instanceof Gadget;

function inside(x) {
  return x instanceof Panel;
}

class Holder {
  matches(v) {
    return v instanceof Crate;
  }
}

export { tagged, inside, Holder };