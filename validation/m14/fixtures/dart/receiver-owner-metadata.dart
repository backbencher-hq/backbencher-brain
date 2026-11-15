// RECEIVER OWNERSHIP — `metadata.owner` + `metadata.ownerEvidence`, the STORE's channel.
//
// The store already resolves calls/uses rows by owner: `src/ast/member-owner-resolution.ts`
// (`claimOwnerCarryingTargets` + `resolveMemberTargetsByOwner`) reads `metadata.owner`,
// requires exactly ONE class-like owner (class|interface|trait|enum — NOT dart mixin/extension),
// filters the member candidates by kind, walks the owner's ancestors through
// `brain_symbol.super_types`, and WITHDRAWS the row's name binding when the owner cannot verify
// it. The analyzer's job is to state the type the receiver is STATICALLY KNOWN to have, with the
// EVIDENCE CLASS that says how the source said so — never to invent one.
//
// THE FOUR EVIDENCE CLASSES, one shape each:
//   param       `void useParam(Repo r) { r.load(); }`          signature parameter type
//   field       `class Holder { final Repo repo; ... repo.load(); }`
//   annotation  `final Repo r2 = Repo(); r2.load();`           a WRITTEN local type
//   assignment  `final r3 = Repo(); r3.load();`                a type from the INITIALIZER
//
// WHY THIS IS SAFE AS ADDITIVE METADATA: the target spelling is unchanged, so no edge moves.
// What moves is what a store-side resolver can do with a row whose target is a bare leaf: the
// `receiverMemberOutsideRun` class has a known owner but no in-file member declaration, and the
// owner channel is the mechanism built for exactly that row.
//
// WHAT MUST *NOT* CARRY AN OWNER, and is forbidden in the expectation:
//   * `this`/`super` receivers — the target spelling already names the owner and "the enclosing
//     class" is not one of the four evidence classes;
//   * a receiver whose type the source never wrote and whose initializer does not construct one
//     (`var x = make(); x.go();`) — nothing at the site names a type, so an owner would be a
//     guess. A WRONG owner is worse than none: the resolver WITHDRAWS the name binding on an
//     owner-carrying row, so a fabricated owner would destroy a resolution that works today.

class Repo {
  void load() {}
  int count = 0;
}

class Holder {
  final Repo repo = Repo();

  void run() {
    repo.load();
    repo.count;
  }
}

class SelfRead {
  void helper() {}

  void run() {
    this.helper();
  }
}

void useParam(Repo r) {
  r.load();
  r.count;
}

void useAnnotated() {
  final Repo r2 = Repo();
  r2.load();
}

void useAssigned() {
  final r3 = Repo();
  r3.load();
}

// A parameter whose type is NOT declared in this fixture: the owner is still exactly known
// (the type name is written in the signature), while the target cannot resolve in-file — the
// `baseBeyondRunScope` spelling carries the claim and the owner channel carries the type.
void useExternal(HttpClient c) {
  c.close();
}

// NO OWNER: the type is not written and the initializer is a call, not a construction.
void useUnknown() {
  final x = makeThing();
  x.go();
}

Object makeThing() => Object();

// ── NON-CLASS-LIKE TYPES ARE NOT USABLE OWNERS ────────────────────────────────────────────────
// The store's resolver accepts exactly one CLASS-LIKE owner (class | interface | trait | enum).
// A dart `mixin`, `extension` or `typedef` is not class-like to that rule, so naming one as
// `metadata.owner` would make the resolver DECLINE and WITHDRAW the row's binding — a wrong owner
// is worse than none, and the contract says so. These receivers are statically known; the owner
// channel simply must not claim a type the resolver cannot use. (A type declared OUTSIDE the file
// keeps its owner: no kind is known here, and that external case is the channel's purpose.)

typedef Coord = ({int x, int y});

mixin Loggy {
  void logIt() {}
}

extension CoordX on Coord {
  int get doubled => x * 2;
}

class NonClassRecv {
  final Coord coord = (x: 1, y: 2);
  Loggy? loggy;

  void run() {
    print(coord.x);
    loggy?.logIt();
  }
}
