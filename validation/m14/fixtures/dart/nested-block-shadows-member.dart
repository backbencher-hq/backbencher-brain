// One name, `value`, read four times in three SCOPES, and the analyzer must tell all three
// apart: a declaration in the function BODY, a declaration in a NESTED BLOCK that shadows
// it, and a read of the enclosing class's FIELD.
//
//   run()          reads `value` at 48, 51 and 53 — all three are the body local, because
//                  `var value = 1;` on line 47 shadows the field for the whole body.
//   readsMember()  reads `value` at 57 — there is no local in this function, so this one
//                  IS the field.
//
// The three local reads are also the fixture's dedup pin: they collapse to ONE edge (the
// first read's line, 48), so the count below is 1 without any read being lost silently —
// an edge at 51 or 53 is what a broken dedup looks like.
//
// This is the shape the `collectDartLocals` skip rests on. The skip at
// real-dart-analyzer.ts:1858 declines to re-walk a block whose subtree a strict ancestor
// already collected, on the argument that S(n) is a subset of the ancestor's already-merged
// set and so adds no name. That argument has a direction, and both directions fail loudly:
//
//   - skipping when `insideCollected` is TRUE (the shipped behaviour) must not change output;
//     if the ancestor's merge were not a superset, the nested block's local would stop
//     suppressing and line 51 would gain a spurious FIELD edge (`uses run -> Box.value`).
//
//   - skipping when `insideCollected` is FALSE — the guard inverted — drops the BODY's own
//     declarations, because the body is where collection happens first. Nothing is lost for
//     a name that is re-declared inside a nested block, which is why the nested declaration
//     alone is a WEAK fixture. The body-level declaration on line 47 is what carries it: with
//     the guard inverted, line 48 stops being a local read and the `uses` count goes 1 -> 2.
//
// Both failures move ONE number, `expectRelationshipCount`, which is why the count has a
// note naming the direction each failure moves it.
//
// 2026-10-08 — THIS FILE WAS FIXED, and the reason is recorded because the defect it was
// fixed for is one this programme keeps finding in its own instruments. As first committed,
// the file's code began with the local declaration, so the field was shadowed for the WHOLE
// body and the file contained NO member read at all — while its rationale said "two local
// reads and one member read … tell them apart", and its two `forbidRelationships` rows named
// lines 20 and 22, which are comment lines in the committed file. The fixture therefore
// PASSED while asserting nothing about the property it was named for, and its forbids could
// not fire. `readsMember()` (line 56) and the forbids in the expectation file are the repair:
// the member read is now present, and the refusal is stated against a spelling the analyzer
// really can produce (`uses readsMember -> value` unqualified).

class Box {
  int value = 0;

  void run() {
    var value = 1;
    print(value);
    {
      var value = 2;
      print(value);
    }
    print(value);
  }

  void readsMember() {
    print(value);
  }
}
