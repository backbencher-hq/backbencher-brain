// THE SAME LOCAL, READ TWICE — the "no silent loss" invariant from the OTHER side.
//
// The shadow-scope fixture pins that two reads of two DIFFERENT declarations that share a name
// are two facts. This one pins the inverse: two reads of the SAME declaration are two facts TOO,
// and — the point of it — they must resolve to the SAME declaration.
//
// THE QUESTION THIS ANSWERS. A local read's spelling is `<callable>\u0000<name>`, and the CALLABLE
// is the enclosing function. So two reads of the same local in the same function spell IDENTICALLY.
// The dedup key is `type|source|target|confidence` and it carried NO LINE, so the two reads
// collapsed into one — and the fix that gives the line to the key for a `localBinding` row must
// NOT have broken the other direction: it must not make the arbiter's job harder by giving it
// two rows that could resolve to DIFFERENT declarations.
//
// THE ANSWER IS THAT THEY CANNOT. Both rows carry the SAME target string, so the arbiter's
// binding verification reads the same name and reaches the same binding for both. The line is
// the READ SITE, not part of the binding's identity — which is exactly why the line belongs in
// the DEDUP key and NOT in the target.
//
// A fix that had put the line INTO THE TARGET would pass the shadow-scope fixture (two different
// names, two different targets) and fail THIS one (the same name, two different targets) — and
// the arbiter would then be asked to verify two different bindings for one local. So the two
// fixtures together pin the cut from both sides.
library local_read_same_declaration;

class SameLocal {
  void f(int p) {
    final x = 1;
    print(x);
    print(x);
  }

  // THE CONTROL — the same name in a DIFFERENT method. The callable differs, so the binding
  // spelling already separates it, and it is unaffected by anything the dedup key does.
  void g() {
    final x = 2;
    print(x);
  }
}
