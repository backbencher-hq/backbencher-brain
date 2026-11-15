// M59.A7 (#825), cpp lane — a relationship's line belongs to the node that
// NAMES it, and the mirror must repeat that same value (M60.P1/#873).
//
// Before this round the cpp analyzer emitted NO `line_number` on any row: the
// Calls and Instantiates rows carried only a `metadata.line` mirror, and the
// uses/extends/overrides/contains/references rows carried nothing at all, so
// "jump to the call site" had no line to jump to (#870: a member read reported
// at line 0 in the fmt lane).
//
// The four traps below are the shapes where the obvious node is the wrong one.
// Every expectation is written against the source text of THIS file.
//
// 1. A call takes the CALLEE LEAF, not the call node: a `call_expression` starts
//    at its RECEIVER, so a receiver that ends on an earlier line (L33-34) would
//    stamp the call one line early — `size` is written on L34, not L33.
// 2. `new` takes the CONSTRUCTED TYPE, not the `new_expression`: the keyword sits
//    on the line above it (L38-39), and the type is what the edge names.
// 3. A member read takes the FIELD LEAF (L44) — the row that carried no line at
//    all before this round (#870).
// 4. A `contains` takes the CHILD's own line, so it can never disagree with the
//    symbol range it mirrors (`Widget->size` at L25).
#include <vector>

struct Widget {
  int size() const { return 1; }
};

int callOneLine(Widget* w) {
  return w->size();
}

int callMultiLine(Widget* w) {
  return w
    ->size();
}

Widget* makeIt() {
  Widget* w = new
    Widget();
  return w;
}

int readField(Widget* w) {
  return w->value;
}
