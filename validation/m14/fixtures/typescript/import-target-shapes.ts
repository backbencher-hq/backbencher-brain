// Every shape a module can DEPEND on, and the name each one is asked for.
//
// The `imports` label had no oracle anywhere in the instrument, so this lane's
// dependency edges were stored and compared against nothing: an invented module,
// a dropped dependency, or a wrong local name would all have read green. The
// oracle (`oracles/typescript-imports-exports.ts`) is what found the gap this
// fixture pins — see the rationale in the expectation.
//
// The rule: the target is `<specifier>:<name>`, and the name is what an INJECTOR
// asks the module for, so an ALIAS is not part of it. `import { a as b }` asks
// the module for `a`; `b` is what THIS file calls it. Anything that depends on
// the module as a whole rather than by name — a namespace import, a
// side-effect-only import, a `require`, a dynamic `import()` — publishes `*`,
// because nothing was asked for by name.

import "./side-effect.css";
import "@scope/pkg/styles";
import * as ns from "./namespace";
import { alpha, beta as renamed } from "./named";
import defaultExport from "./default";
import { transpile } = require("./legacy");

export const usesAll = [ns, alpha, renamed, defaultExport, transpile];
