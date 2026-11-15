// M49 W1 (#768) binding-site contract fixture — authored before the analyzer run.
//
// A binding site is a DEFINITION, never a read. The #744 bare-read walk listed
// declaration NAMES as the only definition positions, so every other binding
// position fabricated `uses @0.6`: import bindings, parameters, arrow params,
// catch params, destructuring targets and export aliases. The JS F5 oracle
// mirrored the same gate list, so the lane agreed on the wrong contract
// (collusion blind spot) — a svelte fixture caught it first.

import Default from "./d";
import { named, other as alias } from "./n";
import * as ns from "./s";

const base = { count: 0 };

// Genuine reads (so this fixture cannot pass vacuously).
export function reader(flag) {
  return base.count + flag;
}

// Parameters are bindings; this body reads neither.
export function binder(alpha, beta) {
  return 1;
}

// Catch parameter is a binding; the body reads neither it nor alpha.
export function catcher() {
  try {
    reader(1);
  } catch (err) {}
  return 0;
}

// Destructuring targets are bindings (shorthand, alias, rest).
export const destructured = ({ first, second: renamed, ...third }) => 1;

// Array-pattern targets are bindings; the RHS literals are not identifiers.
export const [one, two] = [1, 2];

// Pattern DEFAULT: `value` binds, `seed` is genuinely read on the right.
export function defaults(seed, value = seed) {
  return 1;
}

// Export aliases: `named` is an imported binding, `reexported` is an alias
// word that is not a symbol at all (fabricated target pre-fix).
export { named as reexported };
