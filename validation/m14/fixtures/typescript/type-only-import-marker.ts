/**
 * `import type` must be VISIBLE on the edge it already produces.
 *
 * TypeScript erases a type-only import at compile time, so it is a type
 * dependency and not a runtime one. The specifiers were already emitted as
 * `imports` edges before this fixture existed — 271 of 271 element-plus files
 * with a type-only import produced one — but nothing on the edge said which
 * kind it was, so a consumer could not tell a type dependency from a runtime
 * one without re-reading the source. This pins the marker on both sides: the
 * type-only statement carries it, the value statement does not.
 *
 * The `forbid` entry is the half that matters. A pin alone is satisfied by an
 * analyzer that sets the marker unconditionally, which would be worse than the
 * state this fixes: it would assert that every import is erased.
 */
import type { Config } from "./config";
import { helper } from "./helper";
import type * as ns from "./ns";
import def, { type Only, value } from "./mixed";

export const probe: Config = { a: 1 };
export const used = [helper, def, value];
export type Aliased = ns.Inner | Only;
