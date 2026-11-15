// fixture: dart/callsite-lines-825 — M60 line contract (#929 lineage).
//
// dart emitted NO line_number on any relationship before this round: MEASURED
// 42,310 edges over a 240-file draw of both pinned corpora (proxichall's
// symlink target + dart-http), 0 of them lined. Every trap below is valid Dart,
// each is the site of a REAL edge, and each is a place where the construct's
// START line is a line the edge's name is NOT written on:
//
//   1. a WRAPPED import/export/part: the directive keyword starts the
//      statement and the uri literal is written on the following line;
//   2. a WRAPPED field type: `final void Function(int a,\n int b) _wrapped;`
//      — the declaration starts at the type, the member name is written last
//      (the exact shape of cronet_http's generated jni_bindings.dart, where
//      this class was first measured: 148 of 32,016 edges on a 120-file draw);
//   3. a WRAPPED method signature: the return type is on its own line;
//   4. a WRAPPED heritage clause: `class Figure` / `extends Base` /
//      `implements Shape` are three different lines;
//   5. a WRAPPED override: `@override`, the return type and the signature are
//      three different lines, and only the signature's line names the edge;
//   6. a RECEIVER-CONTINUED call: `.` does not end a statement, so
//      `counter\n    .acquire()` parses and the statement starts on the line
//      before the callee;
//   7. a WRAPPED named-constructor call and a WRAPPED factory redirection:
//      `Counter\n    .named(2)` and `factory Reporter() =\n    _Reporter;`.
import
    'dart:async';

export
    'src/api.dart';

part
    'src/widgets.dart';

class Shape {
  double area() => 0.0;
}

class Base {
  double area() => 0.0;
}

class Figure
    extends Base
    implements Shape {
  final void Function(int a,
      int b) _wrapped;

  double
      perimeter(
    int sides,
  ) => sides.toDouble();

  @override
  double
      area() => 3.0;

  int total = 0;
}

class Counter {
  Counter.named(int v) : value = v;

  final int value;

  int acquire() => value;
}

abstract class Reporter {
  factory Reporter() =
      _Reporter;
}

class _Reporter implements Reporter {}

const int gTotal = 1;

class Ledger {
  final List<int> xs = [1, 2];

  int total = 0;

  int firstOf() => xs[0];

  String label(int value) => 'total=$gTotal value=$value';

  void spinAll(int flag) {
    total = flag;
    final first = firstOf();
    this.total = first;
    _wrapped(1, 2);
    xs
      ..add(first)
      ..clear();
  }
}

int run(Counter counter, Ledger ledger) {
  final made = Counter
      .named(2);
  ledger.spinAll(made.value);
  return counter
      .acquire();
}
