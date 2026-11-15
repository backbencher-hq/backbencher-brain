// owner-scope-shadowing — TWO FUNCTIONS THAT EACH BIND THE SAME NAME MUST NOT KILL EACH OTHER.
//
// THE DEFECT THIS FIXTURE PINS (measured 2026-10-19, whole-population arm):
//   `collectLocalReceiverTypes` records a receiver's type in ONE file-wide map
//   (`locals`), and its `record()` rule is "a second declaration of the name with a DIFFERENT
//   type drops the name entirely" — a rule written for SHADOWING WITHIN ONE SCOPE. Applied
//   FILE-WIDE, two unrelated functions that each bind `result` (or `client`, or `state`) with
//   different types DELETE each other's entry, and the receiver rows in BOTH functions lose their
//   owner.
//
//   MEASURED INSTANCE (gql-federation/composition-js/src/merging/merge.ts): four `result`
//   bindings in one file — `const result: Sources<R>` (line 128), `const result: Sources<T>`
//   (139), `const result = new FieldMergeContext(sources)` (1691), `let result = \`{ … }\`` (4402).
//   The first two have DIFFERENT types, so `record()` conflicts on `result`, deletes it, and the
//   row `result.setOverrideWithUnknownTarget(idx)` (line 1773) carries NO owner — although
//   `result` there is `new FieldMergeContext(sources)`, a class DECLARED IN THE SAME FILE
//   (line 177), which is exactly the `assignment` evidence class.
//
// THE FIXTURE'S TWO DIRECTIONS:
//   1. POSITIVE — `first()` binds `shared` as a `Widget`; `second()` binds `shared` as a `Gadget`.
//      Each row must carry ITS OWN owner (`Widget` in the first, `Gadget` in the second). Under the
//      file-wide rule, `second()`'s different type CONFLICTS on `shared` and BOTH rows lose their
//      owner — so this row FAILS before the fix and PASSES after it.
//   2. NEGATIVE — a receiver whose type is NOT stated anywhere must carry NO owner. This pins the
//      ABSENT case so a fix that "makes the owner appear" by guessing cannot pass: the fix must
//      make the RIGHT owner appear, not more owners.

export class Widget {
  widgetOnly(): void {}
}
export class Gadget {
  gadgetOnly(): void {}
}

export function first(): void {
  const shared = new Widget()
  shared.widgetOnly()
}

export function second(): void {
  const shared = new Gadget()
  shared.gadgetOnly()
}

// THE NEGATIVE CONTROL: `untyped` is never given a type, so `untyped.anything()` must carry no
// owner. A fix that invents an owner fails here.
export function third(): void {
  const untyped = makeSomething()
  untyped.anything()
}

declare function makeSomething(): { anything(): void }
