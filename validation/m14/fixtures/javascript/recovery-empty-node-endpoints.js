// R7 regression fixture, RECOVERY half — the shapes that really produce a
// zero-length node, and the real reads that must survive beside them.
//
// `empty-endpoints-refused` pins the invariant on clean input. This file pins it
// on the input that actually triggered it: TypeScript syntax in a `.js` file,
// which tree-sitter does not reject — it PARSES, and its recovery leaves
// zero-length `identifier` / `property_identifier` nodes behind. Probed on the
// pinned wasm, each shape below yields exactly one empty named node:
//
//   line  7  `declare const c10: number[]`  -> identifier@7   (empty)
//   line 12  `exports. = 1`                 -> property_identifier@12 (empty)
//   line 17  `` `a${ }b` ``                  -> identifier@17  (empty)
//
// Every construct is a DELIBERATE reproduction, not valid JavaScript, and the
// declarations around it are ordinary: the point is that one unrepresentable
// token must not cost the file its other edges. `readBoth` still reads `alpha`
// and `beta`; `greet` still reads `name`. Before the terminal guard, line 7's
// recovery node published `uses <module> -> ""` and line 17's published
// `uses greet -> ""`, so a consumer counting targets had a row for no name.

declare const c10: number[];

function readBoth(alpha, beta) {
  return alpha + beta;
}

exports. = 1;

function greet(name) {
  return "hello ${ }" + name;
}

const sum = readBoth(1, 2);
exports.sum = sum;