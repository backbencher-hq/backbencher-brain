// THE RECEIVER-TYPING WALKER GAPS — the four shapes the closure-verifiable residual names
// (validation/m14/verification/CPP-RECEIVER-TYPING.md §3e, and the 7,913-row named residual the
// ledger carries as "second receiver wave (closure-verifiable coverage gap) · 7,913 · ~1.1 %").
//
// THE SHAPES, one per line of the ruling: a typed local declared where the analyzer's per-function
// written-type table does not reach it, and a member body whose class scope is not on the scope
// stack. EVERY shape below emits its `calls` row TODAY — what the wave adds is the RECEIVER
// EVIDENCE on the row (metadata.owner), and a fix that changed a row would break this fixture.
struct Widget {
  void draw();
  void ok();
};

void forRange() { for (Widget w : widgets()) { w.draw(); } }
void forInit() { for (Widget w = makeWidget(); w.ok();) { w.draw(); } }
void ifInit() { if (Widget w = makeWidget()) { w.draw(); } }
void multiDeclarator() { Widget a, b; a.draw(); b.draw(); }
void Widget::outOfLine() { draw(); }
void Widget::withLambda() { auto l = []{ draw(); }; l(); }

// THE NEGATIVE: a receiver whose type NOTHING declares. The row is emitted — the analyzer never
// suppresses a call site because it cannot type it — and it must carry NO owner, because the
// emission rule requires the index to declare the leaf under an owner the index knows.
void unknownOwner() { Unknown u; u.draw(); }
