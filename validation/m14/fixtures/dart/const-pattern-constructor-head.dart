// THE CONST-PATTERN HEAD WAS READ WITH ITS ARGUMENTS ATTACHED, AND `.new` WENT DOWN THE WRONG ARM.
//
// The `qualified`-under-`constant_pattern` branch reads its head off the NODE TEXT
// (`n.text.split(".")`), not through `headNameText`, so `GenericClass<int>.new` arrived as
// `GenericClass<int>` — and every test below that point is a question about the type's NAME:
//
//   * `isCapitalized(head)` — true either way, which is why the row was emitted at all;
//   * `namedCtors.has("GenericClass<int>.new")` — false, so the DT-A construction arm was missed;
//   * `qualifiedTarget("GenericClass<int>", "new")` — the type is not VISIBLE under that spelling,
//     so the capitalized branch spelled the target and attached the claim
//     `baseBeyondRunScope: "GenericClass<int>"`.
//
// That claim is refuted by construction. Property 3 of the claim contract requires an
// identifier-SHAPED base that IS the target's own owner, and `GenericClass<int>` is neither — the
// gate's own self-test (`incoming-gate.ts`) refuses a non-identifier base outright. Measured over
// the whole dart population (arm9, 33,738 files): `causeFAIL` 0 -> 3, and all three are this row,
// in three dart-sdk files that each DECLARE `class GenericClass<T>` themselves — so the run held
// the very owner the claim said it could not reach, which is also what the bucket-3 oracle
// independently reports as its "base declared in the emitting file" class.
//
// TWO FIXES, ONE HEAD. `typeNameWithoutArguments` strips the argument run (balanced, and closing at
// the end of the segment) so the tests and the claim all see `GenericClass`; and a `.new` segment
// takes the SAME arm a named constructor already takes, because `.new` is the unnamed
// constructor's own spelling — the rule this lane already states in `isRealConstructor`
// (`lead === "new" || lead === owner`). Left on the member-read arm, `.new` published
// `uses -> new`: a bare leaf no project declares and no source wrote. The parser shows the same
// constructor as a construction one bracket away, where `case const GenericClass<int>.new():` (the
// INVOCATION form) already publishes `instantiates -> GenericClass` through the calls pass — so
// before the fix the identical constructor published its class when invoked and a bogus member when
// torn off.
//
// MEASURED, shape by shape, in the fixture's own functions (pre-fix -> post-fix):
//
//   case Holder<int>.new:                      uses -> Holder<int>.new   claim Holder<int>
//                                              -> instantiates -> Holder
//   case Holder<Map<String, int>>.new:         uses -> Holder<Map<String, int>>.new  claim ...
//                                              -> instantiates -> Holder
//   case Holder<List<Map<String, int>>>.new:   uses -> Holder<List<Map<String, int>>>.new
//                                              -> instantiates -> Holder
//   case Plain.new:                            uses -> new   (receiverMemberOutsideRun)
//                                              -> instantiates -> Plain
//   case prefix.Holder<int>.new:               uses -> Holder<int>.new
//                                              -> instantiates -> Holder
//   case ExternalGeneric<int>.new:             uses -> ExternalGeneric<int>.new  claim ...
//                                              -> instantiates -> ExternalGeneric
//
// The nested cases are the ones that pin the WALK rather than the strip: a rule that stopped at the
// first `>` would publish `Holder<Map<String, int` as the type name, and a rule that demanded no
// nesting would leave the head alone and publish the whole text as the target. Both are forbidden
// below.
//
// WHAT DOES NOT REACH THIS BRANCH, measured rather than assumed: `Holder<int>.value` and
// `Holder<int>.named` — a generic head with an ordinary member or a named constructor — parse to
// node shapes that never enter the branch (no `qualified` under a `constant_pattern`), in both the
// pre- and post-fix analyzer. `.new` is the only spelling in the population that arrives with its
// arguments attached; a text scan finds 12 such lines in 3 dart-sdk files and none elsewhere.
//
// Authored BEFORE the analyzer run, from the shapes measured above.
class Holder<T> {
  static const int value = 1;

  const Holder();

  const Holder.named();
}

class Plain {
  const Plain();
}

class Foo {
  const Foo();

  const Foo.named();
}

// THE CORE PIN: a generic head on a DECLARED type — the exact shape of all three refuted corpus
// rows. `Holder` is declared here, so a claim that the type is beyond the run is false by
// inspection.
void genericNew(Object x) {
  switch (x) {
    case Holder<int>.new:
      print(0);
  }
}

// THE WALK PIN: nested arguments. `Map<String, int>` is a balanced run inside the outer one.
void nestedNew(Object x) {
  switch (x) {
    case Holder<Map<String, int>>.new:
      print(1);
  }
}

// THE WALK PIN, one level deeper, so a stripper that handles exactly one nesting level is
// distinguishable from one that walks the run.
void deepNestedNew(Object x) {
  switch (x) {
    case Holder<List<Map<String, int>>>.new:
      print(2);
  }
}

// THE FABRICATED LEAF: a NON-generic head. Pre-fix this published `uses -> new` with
// `receiverMemberOutsideRun` — a member name no project declares.
void plainNew(Object x) {
  switch (x) {
    case Plain.new:
      print(3);
  }
}

// THE PREFIX FORM: `prefix.Holder<int>.new` — the head is the segment before the member, so the
// prefix is not part of it and the target must be `Holder`, not `prefix.Holder`.
void prefixedNew(Object x, Object prefix) {
  switch (x) {
    case prefix.Holder<int>.new:
      print(4);
  }
}

// A TYPE THIS RUN CANNOT SEE, and the boundary the fix must NOT cross on the claim side: the
// target is spelled with the normalized name and NO `baseBeyondRunScope` claim is attached,
// because a constructor reference is a construction and not a member read of an unreachable owner.
void externalNew(Object x) {
  switch (x) {
    case ExternalGeneric<int>.new:
      print(5);
  }
}

// THE ARM IT SHARES: a named constructor still instantiates its class, unchanged, and still
// carries `isNamedConstructor` — not the new `isConstructorReference`. The two flags are separate
// on purpose: `.new` is the UNNAMED constructor, so a consumer counting named constructions must
// not count it.
void namedCtor(Object x) {
  switch (x) {
    case Foo.named:
      print(6);
  }
}

// THE BOUNDARY THAT MUST NOT MOVE: a LOWERCASE head names a VALUE whose type the run did not
// resolve. There is no type name at the site, so nothing is spelled (no claim) and the cut still
// reports `receiverTypeUnknown`. A normalizer that fired on this row would spell `box` — the
// value's own name — as if it were a type.
void valueHead(Object x, Object box) {
  switch (x) {
    case box.value:
      print(7);
  }
}

// The same text in an EXPRESSION position, i.e. the shape the calls/selector passes already read.
// Pinned so a fix that widened the branch instead of normalizing the head is visible: this row's
// behaviour must not change.
void expressionForm(Object x) {
  final f = Holder<int>.new;
  print(f);
}
