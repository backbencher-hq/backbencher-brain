// J9 (2026-09-30) — a `#private` NAME IS NEVER A PROTOTYPE MEMBER.
//
// The lane's override rule has two passes. Pass 1 is closed-world: if the base is
// declared in this file and declares a same-named member, the override is verified
// at 0.95. Pass 3 fires only when the base is NOT declared here and the companion
// index has no opinion, and it emits at 0.5 with `reasonCode: "first-parent-guess"`.
//
// 0.5 is the right tier for a true edge whose BASE is unknown. It was the wrong
// tier for an edge that is false by the language's own definition: a `#name` is
// class-scoped, installed on each instance at construction and never present on the
// prototype, so no base can declare it and no subclass can shadow it. "The base is
// unknown" says nothing about whether the name could be a member of ANY base.
//
// Measured over the full 3,369-file corpus, pass 3 produced 50 override edges
// naming a builtin base, six of which were private names the language rules out:
// URLSearchParams.#update_url, Map.#read_all, Map.#source, Set.#init, Set.#source,
// Date.#init. Date's ONLY override edge in the corpus was a private field, so the
// guard removes that base entirely.
//
// This fixture pins BOTH directions, because the cheap way to "fix" this is to drop
// the whole pass-3 branch — and that would delete 44 rows that are honest 0.5
// suspicion about real prototype methods. A private name must be silent; a public
// one against an unresolvable base must still be emitted, at 0.5.

class Widget extends Map {
  // Private field: MUST NOT produce an override, though `Map` has no such member
  // and `#size` is a name the base could never carry.
  #source = null;

  // Private METHOD: same rule, and it is a method rather than a field, so this also
  // covers the method-shaped path rather than only the field-shaped one.
  #read_all() {
    return this.#source;
  }

  // A PUBLIC method against a base that is not declared in this file. The base is
  // unknown to this file, so this is honest 0.5 suspicion and MUST still be emitted:
  // `Map` really does have `get`, so the row is very likely true — which is exactly
  // the case the 0.5 tier exists for.
  get(key) {
    return this.#read_all() ? key : undefined;
  }

  // A custom-element-style callback. Kept here to document what this fixture does
  // NOT decide: a hook the browser invokes is not a prototype member either, but
  // that is a DOM fact rather than a JavaScript one, and J9 records it as an open
  // design question rather than settling it here.
  connectedCallback() {}
}

export { Widget };
