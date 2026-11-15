// A get/set pair is ONE property in TypeScript's type system, and the CLASS
// path already ruled it that way: its body pre-pass keeps the last declaration
// of each name, so `class C { get size(){}; set size(v){} }` has always
// produced a single `size`.
//
// The object-literal path had no such pass, so the same declaration written as
// an object literal produced TWO `size` symbols sharing one owner, and — because
// containment emits one `contains` row per member symbol — TWO IDENTICAL
// `contains o -> size` rows. A duplicate symbol with an ambiguous name, and a
// duplicated graph edge that inflates degree counts for every consumer.
//
// The second half of the pin is the reason the fix is shaped the way it is: the
// skipped getter's body must still be walked, or collapsing the pair would trade
// a duplicate for a missing edge. `compute()` is called from the GETTER, and
// pre-fix the call is attributed to the owner `o`, so it must still be there
// after the collapse.
//
// Authored BEFORE the analyzer run.
export const o = {
  get size(): number {
    return compute();
  },
  set size(v: number) {
    this._v = v;
  },
};

function compute(): number {
  return 1;
}
