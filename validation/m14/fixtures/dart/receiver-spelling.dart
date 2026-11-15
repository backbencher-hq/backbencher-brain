// THE RECEIVER-TYPE SPELLING — the row shape this fixture pins, and every boundary of it.
//
// The change under test is ONE branch of `qualifiedTarget`: a bare member whose receiver's type the
// run cannot see used to drop its owner and keep the leaf; it now spells `<Type>.<member>` and
// attaches `baseBeyondRunScope: <Type>`, the declared cause whose contract is "the run that wrote
// this edge could not look the owner up". The fixture has to hold the shape AND its boundaries,
// because a spelling that fires one case too widely changes thousands of rows silently.

// A — a CAPITALIZED head whose type is not declared in this file: the spelling fires, and the
//     target names the type the source wrote instead of the bare leaf.
void typeOutsideRun() {
  ExternalThing.make();
}

// B — THE SAME CLASS OF ROW REACHED THROUGH A DECLARATION. `ext` is a local with an explicit type,
//     so the run knows the type name even though the site wrote a VALUE. This is the half of
//     `receiverTypeOutsideRun` that is not "written at the site", and it is why the class was never
//     only about capitalized literals.
void typedLocal() {
  ExternalThing ext = ExternalThing.make();
  ext.frob();
}

// C — a LOWERCASE head: a local whose type NOTHING names. The first draft of this fixture wrote
//     `var ext = ExternalThing.make();` and the dump showed the row SPELLED — the analyzer infers a
//     `var` local's type from its initializer's callee, so that shape belongs to case B and its
//     presence here would have pinned the wrong boundary. The local must take its value from
//     something that names no type at all.
void untypedLocal(List<dynamic> args) {
  var ext = args.first;
  ext.frob();
}

// D — a capitalized head naming an SDK type (no `import 'dart:core'` needed; it is implicit). The
//     spelling fires here too, and the resulting row is the one an index cannot have: the owner is
//     outside every population this corpus holds.
void sdkType() {
  String value = '';
  value.trim();
}

// E — CONTROL: the type IS visible in this file and declares the member, so the visible-type path
//     resolves it. The new branch must not touch this row — a spelling that overran the boundary
//     would name `Local.own` where the analyzer already had the answer.
class Local {
  void own() {}

  void callOwn() {
    own();
  }
}

// F — the type is visible in this file and does NOT declare the member, so the DECLARING type is
//     elsewhere: this is `receiverMemberOutsideRun`, deliberately NOT spelled this round (the
//     project cannot declare `Bare.missingMember`, because `Bare` is declared here and does not).
class Bare {
  void other() {}
}

void memberOutsideRun() {
  Bare b = Bare();
  b.missingMember();
}
