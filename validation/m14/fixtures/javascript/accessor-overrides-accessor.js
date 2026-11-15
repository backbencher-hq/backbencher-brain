// J10 (2026-09-30) — an ACCESSOR PAIR IS A PROTOTYPE MEMBER, and a subclass
// accessor DOES shadow the base accessor of the same name.
//
// The lane kinded `get x()` / `set x(v)` as `property` (a declared contract other
// lanes and fixtures read) and scoped `overrides` to Methods and Constructors, so
// it emitted nothing for an accessor that shadowed a base accessor. That was a
// real omission, not a convenience: accessor pairs live on the prototype exactly
// like methods do, so `class A extends B { get x() {} }` overrides `B`'s `x`.
//
// The gap was found by building the J9 oracle and reading its MISSING rows —
// 12 of them, all in `svelte/src/reactivity/url.js`, where `class SvelteURL extends
// URL` re-declares twelve `URL.prototype` members as accessor pairs. So this is
// not a corner case: it is 12 real overrides in one corpus file that the lane
// recorded as zero.
//
// THE PAIR IS ONE OVERRIDE. `get x()` and `set x(v)` shadow the SAME base slot,
// so the two symbols must collapse to ONE edge. This is the half of the fix that
// is easy to get wrong: deduping only the verified in-file branch doubled every
// accessor guess instead, and it was visible only because the accessor pair is
// what made two rows for one override stand out in `url.js` (line 77 and line 81).
//
// KINDS ARE UNCHANGED. `hash` is still `property` here — widening `overrides`
// does not touch the symbol contract, it only widens which members participate.

class SvelteURL extends URL {
  // MUST produce exactly ONE `overrides SvelteURL.hash -> URL.hash`, not two.
  get hash() {
    return super.hash;
  }

  set hash(value) {
    super.hash = value;
  }

  // `URL` has no such member, so the builtin prototype chain refuses this one.
  // The accessor shape alone is not sufficient; the member must actually exist.
  get notAUrlMember() {
    return undefined;
  }

  // A method still behaves as before, unchanged by this fix.
  toString() {
    return super.toString();
  }
}

// A private accessor is still silent: `#name` is class-scoped, so J9's rule
// outranks J10's widening. Both rules hold at once.
class Widget extends Map {
  #source = null;

  get #secret() {
    return this.#source;
  }
}

export { SvelteURL, Widget };