// dart/typed-receiver-heads — READING THE TYPE THE SOURCE WRITES, on the forms that were missed.
//
// The receiver-cut pricing measured where the dart lane's ambiguity lives and found that 34.6 % of
// the typing gap has the receiver's type written in its own file; two of the forms carrying it were
// never read at all, both through the production path (probe:
// .tmp-probe/dartgate/typed-head-probe.mts):
//
//   ANONYMOUS CLOSURE PARAMETERS. A closure is `function_expression parameters:
//   (formal_parameter_list …) body: (function_expression_body …)`, so the body's PREVIOUS NAMED
//   SIBLING is the list itself — and `extractParameters` searched for a list CHILD inside the node
//   it was handed, so it found nothing and `element.poke()` published a bare `poke` with
//   `receiverCause: receiverTypeUnknown` while the identical METHOD parameter published
//   `Element.poke`. A local function was never affected: its body's sibling is a real
//   `function_signature`.
//
//   TYPED for-in VARIABLES. `for (Element e in xs)` writes the type in the source and
//   `collectDartLocalTypes` did not look at `for_loop_parts` at all, so the loop variable stayed a
//   bound name with no type.
//
// Both reads are of a type the SOURCE writes. Nothing here infers one, and the two forms that name
// no type (`var`/`final` without a type, and Dart 3 pattern bindings, which DARTGAP1 re-scoped by
// measurement) are pinned as DECLINES so a later change cannot quietly start guessing.

class Element {
  int id = 0;
  void poke() {}
}

Element make() => Element();
void sink(Object? o) {}

// (A) CONTROL — a METHOD parameter. Read off the signature sibling and typed BEFORE this change, so
// it is the shape the fix had to leave untouched.
void methodParam(Element element) {
  element.poke();
}

void closures() {
  // (B) THE FIX, block body. Before: `calls -> poke` with `receiverCause: receiverTypeUnknown`.
  sink(() {
    (Element element) {
      element.poke();
      sink(element.id);
    };
  });

  // (C) THE FIX, expression body — same node, `function_expression_body`.
  sink(<Element>[].map((Element element) => element.id));
}

// (D) THE SECOND FIX — a TYPED for-in variable, at the three spellings the grammar gives it.
Future<void> loops(List<Element> elements, Stream<Element> stream) async {
  for (Element element in elements) {
    element.poke();
  }
  for (final Element element in elements) {
    element.poke();
  }
  await for (final Element element in stream) {
    element.poke();
  }
}

void controls() {
  // (F) CONTROL — `var` names nothing, so an untyped closure parameter must STAY bare.
  sink(<Element>[].map((element) => element.id));

  // (G) CONTROL — the same for a for-in variable spelled `var`.
  for (var element in <Element>[]) {
    element.poke();
  }

  // (H) CONTROL — Dart 3 pattern bindings are DARTGAP1's bucket, not this one: the pattern's
  // `element` must stay untyped even though a type is written inside the record pattern.
  for (final (int n, Element element) in <(int, Element)>[]) {
    element.poke();
  }
}
