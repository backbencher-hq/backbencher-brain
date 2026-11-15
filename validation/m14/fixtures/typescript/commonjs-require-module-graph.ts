// CommonJS `require()` is a module dependency in exactly the sense `import()` is,
// and the module graph must say so. Three shapes carry a dependency, and each was
// silent in this lane at different times:
//
//   require("./m")                 the plain call form
//   const { a } = require("./m")   a DESTRUCTURING binding takes named members,
//                                  not the default \u2014 the twin's J4 rule, which the
//                                  javascript lane once hardcoded as `true` and so
//                                  flagged every require as a default import
//   import m = require("./m")      TypeScript's own spelling of the same thing,
//                                  which parses to an `import_require_clause`
//                                  whose path is an ordinary named child rather
//                                  than the statement's `source` field
//
// And one shape must NOT be read as a dependency: `foo.require("m")` is somebody
// else's method, so it stays a call and contributes no import.
//
// `imports` is the second-largest edge class in this lane (measured: 2,692 edges
// over 600 tracked files, 6.9% of the graph output, and the largest class with no
// independent cross-check), so a dependency that is silently missing is a hole in
// impact analysis rather than a cosmetic gap. This repository's own build shims
// use `require` \u2014 `require("bun:sqlite")`, `require("better-sqlite3")`.
//
// Authored BEFORE the analyzer run.
const cjs = require("./cjs-module");
const { named } = require("./named-module");
const destructuredDefault = require("./default-module");

// TypeScript's spelling: the path lives in an `import_require_clause`, not in the
// statement's `source` field, so reading only the field skips the whole form.
import aliased = require("./aliased-module");

// A dynamic import is the same kind of dependency.
const lazy = import("./lazy-module");

// NOT a dependency: a member call on somebody else's object.
class Loader {
  require(_name: string): unknown {
    return null;
  }
}
const viaMethod = new Loader().require("./not-a-module");

export { cjs, named, destructuredDefault, aliased, lazy, viaMethod };
