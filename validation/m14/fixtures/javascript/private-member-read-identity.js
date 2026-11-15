// M49 W13 regression fixture — a PRIVATE member `#x` and a plain binding `x`
// must not share a dedup key.
//
// The member-segment key was `${source}.${seg}`, and a private segment's text
// is literal `#x` — so the key became `${source}.#` + `x`, BYTE-IDENTICAL to the
// bare-read / chain-root key of the plain identifier `x` (`${source}.#` + `x`).
// Whichever came first claimed it. Measured on the real svelte corpus —
// `packages/svelte/src/reactivity/set.js`: the class field initializer
// `#update_version = update_version || -1` (line 52) reads the IMPORTED
// binding `update_version` first, claiming key `SvelteSet.#update_version`, so
// the genuine read `this.#update_version` (line 88) was dropped as a duplicate
// — the first javascript-lane MISSING edge W12's 400-file measurement
// registered. `#version`/`#size` survived only because no plain binding of
// those names is read in the same container, which is why the defect hid.
//
// Contract: the read of a private member emits the `#`-spelled target; the
// same-named bare read emits its own edge; neither suppresses the other.

const update_version = 5;
const version = 7;

class Store {
  #version = 0;
  #update_version = update_version || -1;

  read() {
    return update_version === this.#update_version ? this.#version : version;
  }
}
