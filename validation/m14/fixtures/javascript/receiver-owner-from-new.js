/*
** task iteration 3: THE RECEIVER'S CONSTRUCTED TYPE, read off the initialiser, carried as `metadata.owner`.
**
** JavaScript states a receiver's type in exactly one syntactic form: `const c = new Widget()`. The
** analyzer records that type on the member call (`c.run()` -> `meta.owner = "Widget"`), and the store's
** member-owner pass (`src/ast/member-owner-resolution.ts`) uses it to bind the member INSIDE Widget.
** MEASURED END-TO-END through the production index (`indexProjectParallel`): two classes each declaring
** `run()` — Foo and Bar — made `c.run()` bind to `Bar.run` (the lexicographically-first declaration)
** WITHOUT this metadata and to `Foo.run` (the intended one) WITH it.
**
** THE CONTROLS: a receiver whose initialiser is not `new` (`const d = make()`) states no type and must
** carry no owner; and the two same-named constructors in one file are a conflict the collector refuses
** rather than guesses (that rule is pinned by inspection in the source, not by a row here).
*/
class Widget {
  run() {
    return 1;
  }
  other() {
    return 2;
  }
}

const c = new Widget();
c.run();

function make() {
  return new Widget();
}
const d = make();
d.other();
