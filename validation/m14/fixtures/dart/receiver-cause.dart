// dart/receiver-cause — WHY A TARGET STAYED A BARE MEMBER NAME.
//
// The marker `receiverCause` is produced inside `qualifiedTarget`, at the moment the
// qualification is decided, so the four cases below are the four null-returning branches in
// order. The fixture pins one of each plus a resolved control, because a cut that reports a
// cause on rows that RESOLVED would make the decomposition meaningless.

import 'package:remote/remote.dart';

class Base {
  int shared() => 1;
}

class Child extends Base {
  int own = 2;

  // (A) receiverMemberOutsideRun — the type IS visible in this file and does not declare the
  // member, so the DECLARING type (a superclass outside the run) is what the run cannot name.
  void missingMember() {
    vanish();
  }

  // (B) receiverTypeUnknown — a lowercase receiver whose declared type this run did not resolve:
  // a VALUE, and no spelling at this site reaches a declaration.
  void unseenType(ExternalThing ext) {
    ext.frob();
  }

  // (B2) receiverTypeOutsideRun — a CAPITALIZED head: the type's NAME is written here, so the
  // target can be spelled `ExternalThing.make` even though this run cannot see the type.
  void typeOutsideRun() {
    ExternalThing.make();
  }

  // (C) receiverUnnamed — there is no owner name at the site at all.
  void unnamedHead() {
    configure().finish();
  }

  // (D) THE CONTROL — both ends are in this file, so these must stay WITHOUT a `receiverCause`.
  void resolved() {
    this.shared();
    own = own + 1;
  }
}

ExternalThing configure() => ExternalThing();
