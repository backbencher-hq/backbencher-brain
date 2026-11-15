// `references` — a declaration MENTIONS A TYPE. Authored BEFORE the analyzer run.
//
// WHY THIS FIXTURE EXISTS
//
// Dart is statically typed and this analyzer published no edge for a single type
// mention. `final Wallet w = ...`, `Wallet copy()`, `List<Wallet>`, `x as Wallet`,
// `x is Wallet`, `typedef WalletList = List<Wallet>`, `extension E on Wallet` —
// every one of those is a fact about the type graph, derivable from the grammar
// alone, and all of it was unread. The type POSITION is grammatical: the parser
// has a dedicated node (`type_identifier`) that never appears where a value
// identifier appears, so "this names a type" is a parse fact and not a
// capitalization convention.
//
// The boundary this fixture holds is RESOLUTION, and it is the whole design.
// Measured over 1,000 corpus files in 5 repositories: 75,769 type mentions
// outside heritage clauses, of which 3,460 (4.57%) name a type the same file
// declares. The other 95.43% name `String`, `Widget`, `Future` — real types in
// `dart:core` and the Flutter SDK, declared in files a per-file run has not read.
// So `references` publishes a mention only when the name binds to a type this run
// can see, and the pins below FORBID the unresolvable majority. An edge to a name
// no symbol in the index can bind is the shape `bb_graph` and `bb_impact` turn
// into wrong answers, and a narrow graph that is true beats a wide graph that is
// not.
//
// WHAT IS *NOT* PINNED AS A REFERENCE, each for a stated reason, and each of them
// a place where a plausible-looking widening would double-count a fact the lane
// already publishes under another label:
//
//   - `class Derived extends Wallet` / `implements Wallet` / `with Loggable` —
//     already `extends` / `implements` / `uses`. FORBIDDEN below.
//   - `Derived(...)`, `new Derived()`, `const Derived()`, `factory X.y() = Z;` —
//     already `instantiates`. FORBIDDEN below.
//   - `class Box<T>` DECLARES a type variable; `T value;` mentions the VARIABLE.
//     FORBIDDEN below, and `Base<T extends Wallet>` pins the positive half: the
//     BOUND names a real type and does publish.
//   - `extension on Wallet {}` is an UNNAMED extension published under its target
//     type's name, so without a self-reference rule it publishes
//     `Wallet references Wallet`. FORBIDDEN below.
//   - `dynamic` is Dart's IMPLICIT type: the absence of a type, not a dependency
//     on a declared one. FORBIDDEN below.
//
// SOURCE ATTRIBUTION follows the lane's existing rule for a non-function context
// (DARTD9): the innermost PUBLISHED declaration that mentions the type. A local
// variable is not published as a symbol, so its type mention belongs to the
// function that contains it (DARTD8) — pinned at `consume` below.

class Wallet {
  final String walletId;
  final int balance;

  const Wallet(this.walletId, this.balance);

  // POSITIVE 1 — a RETURN type (`function_signature`).
  Wallet copy() => Wallet(walletId, balance);

  // POSITIVE 2 — a PARAMETER type (`formal_parameter` / `normal_parameter_type`).
  // The pin is on `reconcile`, whose parameter mentions BOTH a project type and
  // an SDK type, so the resolution gate is visible in the same row: `Wallet` is
  // declared in this file and `Remote` is not declared anywhere in it.
  Wallet reconcile(Wallet incoming, String note) => incoming;

  // POSITIVE 3 — a TYPE ARGUMENT (`type_arguments`).
  List<Wallet> recent() => <Wallet>[];

  // POSITIVE 4 — a type in a CONSTRUCTOR's parameter list. The SOURCE is the
  // family name `constructor` (the lane contract: constructors are published as
  // `constructor`, with the named segment in metadata), which is why the pin's
  // `from` is not `adopted`. Pinned because a source-attribution change that
  // started naming the segment would split one constructor's edges across two
  // source names, while every `contains` row for it says `constructor`.
  Wallet.adopted({required Wallet previous}) : walletId = previous.walletId;

  // POSITIVE 5 — a CAST and a TYPE TEST (`type_cast` / `type_test`).
  bool isSame(Object other) => other is Wallet && (other as Wallet).walletId == walletId;

  // POSITIVE 6 — an `on T` CATCH clause (`try_statement`).
  int attempt(Object raw) {
    try {
      return (raw as Wallet).balance;
    } on Wallet catch (e) {
      return 0;
    }
  }

  // POSITIVE 7 — a RECORD FIELD TYPE (`record_type_field`).
  ({Wallet last, Wallet first}) pair() => (last: this, first: this);
}

class Derived extends Wallet {
  Derived(super.walletId, super.balance);

  // FORBIDDEN: `super.walletId` is a SUPER PARAMETER, and the base it names is
  // already published as `Derived extends Wallet`. If the pass read
  // `super_formal_parameter`, this file would carry the same base twice.
}

// FORBIDDEN: heritage in all three spellings. `extends Wallet` is `extends`,
// `implements Wallet` is `implements`, and `with Loggable` is `uses`. Publishing
// any of them a second time as `references` would make the graph count one
// inheritance fact twice — the same defect class as a mislabel, in the other
// direction.
mixin Loggable {
  void log() {}
}

class Mixed extends Wallet with Loggable implements Wallet {
  Mixed(super.walletId, super.balance);
}

// FORBIDDEN: construction. `Derived` is instantiated here, and the analyzer
// already publishes `Derived(...)` as `instantiates`. A `references` edge to the
// same type would claim a DEPENDENCY where the code says CONSTRUCTION.
class Builds extends Wallet {
  Builds(String id, int b) : super(id, b);

  Derived make() => Derived(walletId, balance);

  // CONSTRUCTION WITHOUT A MENTION. `buildOnly` constructs a `Wallet` and names no
  // type at all, so the construction is `instantiates` and there is nothing for
  // `references` to say. A pass that read CALL SITES as type mentions would add
  // `buildOnly references Wallet` here, and the fact that `Wallet` is declared in
  // this file is what makes that mistake easy to make.
  buildOnly() => Wallet('b', 2);

  Widget undeclared() => throw UnimplementedError();
}

// POSITIVE 8 — a TYPE BOUND (`class Box<T extends Wallet>` names a real type) and
// FORBIDDEN — the type VARIABLE itself. `class Box<T extends Wallet>` DECLARES T;
// `T value;` and `T get()` MENTION T, and T is not a declared type. If the pass
// published either, a generic class would appear to depend on a type it invented.
class Box<T extends Wallet> {
  final T value;

  Box(this.value);

  T get() => value;

  void put(T next) {
    value = next;
  }
}

// THE ROW THAT MAKES THE TYPE-VARIABLE FORBIDS ABOVE LOOSE-BOUNDED.
//
// `class T` at the bottom of this file is a REAL declared type, so the resolution
// gate alone does NOT stop `Shadowed` from being published as depending on it: the
// name resolves, to the wrong declaration. Only the ancestor walk that asks
// "did an enclosing declaration introduce this name as a TYPE PARAMETER?" refuses
// the row. `class Box<T extends Wallet>` cannot see the difference, because nothing
// in this file is called `T` — so without this pair, deleting the whole shadow
// check leaves every other pin in this file green.
class Shadowed<T extends Shadowed> {
  T? cached;

  Shadowed? outer;

  Shadowed.cache(T value) : cached = value;
}

class T {}

// POSITIVE 9 — a TYPEDEF. The alias is a published symbol (`WalletList`, kind
// `type`) and `List<Wallet>` mentions `Wallet`, so the edge belongs to the ALIAS,
// not to the file. The file-basename source would be the giveaway: a type
// dependency attributed to a file is a claim about a module that declares
// nothing.
typedef WalletList = List<Wallet>;

// POSITIVE 10 — a NAMED extension's `on` clause. An extension's target type is
// mentioned by the declaration itself and no other label carries it.
extension WalletListX on Wallet {
  bool get rich => balance > 0;
}

// FORBIDDEN: an UNNAMED extension. It is published under its target type's name
// (`Wallet`, kind `extension`), so `extension on Wallet` names Wallet while the
// source is also Wallet — a self-dependency, which is not a dependency. This is
// the pin that keeps a name-resolution shortcut from publishing `Wallet
// references Wallet`.
extension on Wallet {
  String get label => walletId;
}

enum Kind {
  pending,
  settled,
}

// The `dynamic raw` parameter is load-bearing for the `dynamic` forbid below:
// without it, that row would be pinning an edge this fixture never writes, and an
// assertion about text the file does not contain cannot fail.
//
// POSITIVE 11 — a parameter type naming a declared ENUM, plus POSITIVE 12 — a
// local declaration's type, which folds into the enclosing function because a
// local is not a published symbol (DARTD8).
void consume(Kind kind, dynamic raw) {
  final Wallet w = Wallet('a', 1);
  final List<Wallet> all = <Wallet>[];
  final closure = (Wallet inner) => inner.balance;
  for (final Wallet child in all) {
    print(child);
  }
  print(kind);
  print(closure(w));
  print(raw);
}
