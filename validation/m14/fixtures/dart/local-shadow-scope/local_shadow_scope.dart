// LOCAL SHADOWING — TWO DISTINCT DECLARATIONS THAT SHARE A NAME.
//
// The Lead's condition on the interpolation fix, and it is a real one: the family's relationship
// dedup key is `type|source|target|confidence` and it CARRIES NO LINE (`DARTD7`), so two reads of
// two DIFFERENT declarations that happen to share a name collapse into one row. That is a
// resolution loss wearing a dedup's clothes.
//
// THE MEASURED SHAPE (the Lead's condition, verbatim): "a dedup that merges two distinct
// declarations is a resolution LOSS wearing a dedup's clothes."
//
//     void f(int p) {
//       final x = 1;
//       print(x);          // reads the OUTER x
//       {
//         final x = 2;
//         print(x);        // reads the INNER x — a DIFFERENT declaration
//       }
//     }
//
// Dart's rule: an inner scope SHADOWS an outer binding of the same name, and the inner
// declaration is a DIFFERENT declaration. Two rows, because they are two facts.
//
// WHY THE BINDING SPELLING IS THE RIGHT TARGET SPELLING HERE: both reads spell
// `<callable>\u0000<name>` — the family's spelling for a local read — and the CALLABLE is the
// enclosing function, so the two reads of `x` in the SAME function are the same string. The
// dedup key therefore cannot tell them apart, and the second is lost.
//
// THE FIX is to make the key carry the LINE for the rows where the line IS the fact — a local
// read's line IS the read site, so two reads at different lines are two facts, and two reads at
// the SAME line are the same fact and must still collapse.
library local_shadow_scope;

class Shadowed {
  void f(int p) {
    final x = 1;
    print(x);
    {
      final x = 2;
      print(x);
    }
  }

  // THE SAME NAME, IN TWO METHODS OF THE SAME CLASS — the callable differs, so the binding
  // spelling already separates them. This is the CONTROL: a fix that broke the callable part
  // of the spelling would fail here.
  void g() {
    final x = 3;
    print(x);
  }

  // A SECOND DECLARATION OF THE SAME NAME, IN A DIFFERENT METHOD — so a scope that resolved
  // to the WRONG declaration would name a line that EXISTS but is not this one. The
  // resolution-identity pin (`script/m14/dart-binding-resolution-identity.ts`) reads the
  // declaration each row binds to and asserts the exact SET, so "a row that resolves to a
  // declaration of the same name in the wrong place" is caught and not merely "a row that
  // resolves to something".
  void h() {
    final x = 4;
    print(x);
  }
}
