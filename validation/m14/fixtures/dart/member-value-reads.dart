// DT-A: named construction wins over the dangling leaf call (in-file
// knowledge); static methods and unknown cross-file `X.y()` stay calls.
// DT-B: heritage aliases resolve (`_i1.Base` -> Base, never `_i1`).
// DT-C: redirect targets resolve (`= _i1.Impl.make` -> Impl).
// DT-D: super()/this() initializer redirections instantiate.
// DT-F: member reads (`this.`/`obj.`/`C.`/`?.`/`..`/subscript/interp);
// writes (`=` LHS, cascade `=`) never read.
mixin M on _i1.Base {}

class C extends _i1.Smart with _i2.Mixin implements _i3.Iface {
  int count = 0;
  static int total = 0;

  C();
  C.named(int n);

  static C create() => C();

  factory C.made() = _i1.Impl.make;
  factory C.plain() = Impl;

  void useAll(C other, List<int> xs, Map<String, int> m) {
    var h = C.named(1);
    var t = C.named;
    var p = pri.Foo(2);
    var c = C.create();
    var x = count;
    var y = this.count;
    var z = other.count;
    var s = C.total;
    var w = other.count + x;
    var q = xs[0];
    xs[1] = 5;
    var b = m['k'];
    var g = 'hello $y and ${w + 1} and ${other.count}';
    items..add(1)..clear();
    var n = items..length;
    A? v = maybeValue();
    var u = v?.count;
    v?.bump();
  }

  void writeOnly(C c, List<int> xs) {
    c.slot = 1;
    q2..slot = 2;
    xs[3] = 4;
  }
}

class B extends A {
  B() : super(1);
  B.named() : super.named(2);
  B.second() : this.named(0);
}

class UsesStatic {
  void m() {
    X.y();
  }
}
