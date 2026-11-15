// dart/dedup-first-producer — WHAT THE STORE KEEPS WHEN ONE KEY HAS SEVERAL PRODUCERS.
//
// DARTD7 (real-dart-analyzer.ts:1147) collapses rows on `type|source|target|confidence` and keeps
// the FIRST row per key. The line number is deliberately NOT in the key, so the surviving row's
// `line_number` is whichever producer the walk reached first — and any change that moves the walk,
// or that retargets a row so that a key gains or loses producers, can change WHICH line the store
// reports for an edge no rule changed.
//
// That is not hypothetical: it is what arm14's falsified cell turned out to be. The typed-receiver
// change is a pure RETARGET per write site (three rewrites, net 0 rows, on
// `dart/typed-receiver-heads`), and it still moved the corpus edge total by +1,727, because
// retargeting changes which rows are first and which keys exist at all. Measured on 374 real files
// at fixed HEAD (`e6cc8db0a^` vs `e6cc8db0a`, only the analyzer swapped): 9 files change count, in
// BOTH directions, and on `icon_button_test.dart` a key that BOTH arms produce survives at a
// different line — `calls main -> WidgetTester.getSize` at 3,597 in the pre-fix arm and 448 after.
//
// THIS FIXTURE IS THE MINIATURE, and it pins the two behaviours that had no pin at all:
//   (A) THREE sites of one key => ONE row, at the FIRST site's line.
//   (B) A file can hold BOTH the bare and the spelled key for one member and one source: the bare
//       row is not superseded by the spelled one, they are two keys, and both survive.
//   (C) THE COLLAPSE: a typed METHOD parameter's read and a typed CLOSURE parameter's read of the
//       same member in the same enclosing function are ONE key, so the closure's read (which the
//       typed-receiver change retargeted into that key) ADDS NOTHING to the count — it only decides
//       the line if it happens to be walked first. This is the class that made the corpus total
//       move while every per-site rule stayed a rewrite.

class Element {
  int id = 0;
  void poke() {}
}

void sink(Object? o) {}

// (A) one key, three producers. All three spell `Element.poke` — the receiver is a typed METHOD
// parameter and was typed before the typed-receiver change, so this pins DARTD7 alone.
void threeSites(Element element) {
  element.poke();
  element.poke();
  element.poke();
}

// (B) bare and spelled, one source, one file. The closure parameter is untyped and STAYS bare
// (the type is not written in the source); the method parameter spells. Two keys, two rows.
void bareAndSpelled(Element element) {
  sink(() {
    (element) {
      element.poke();
    };
  });
  element.poke();
}

// (C) THE COLLAPSE. Two DIFFERENT declarations both spell `Element.poke` in this one source: the
// method parameter (typed before the change) and the closure parameter (typed BY the change). One
// key, so one row — and the count cannot show that the closure was retargeted at all.
void collapses(Element element) {
  element.poke();
  sink(() {
    (Element inner) {
      inner.poke();
    };
  });
}
