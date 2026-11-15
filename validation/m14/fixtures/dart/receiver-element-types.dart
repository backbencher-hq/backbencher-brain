// CONTAINER ELEMENT TYPES — a written type argument is EVIDENCE, and it is what types an UNTYPED
// for-in variable.
//
// `for (final e in xs)` writes no type for `e`. The old analyzer therefore published `e.load()`
// as a bare leaf with `receiverCause: receiverTypeUnknown`, although `xs`'s own declaration says
// `List<Repo>` two tokens away. The container's ELEMENT type is writing evidence of exactly the
// same class as a declared local (`annotation`), so it may be used — and only where it is written:
//
//   `List<Repo> xs`  ->  for (final r in xs) { r.load(); }   -> `Repo.load`, owner Repo
//   `Iterable<Repo> it` -> the same inference through the Iterable container
//   `dynamic xs`     ->  for (final z in xs) { ... }         -> NO inference (nothing written)
//
// The `dynamic` parameter is the boundary in the other direction: `dynamic` is the ABSENCE of a
// type, not a declaration, so it may never become `metadata.owner` — the store's resolver would
// look up a class-like declaration named `dynamic` and fail. (Measured before this fixture: a
// `dynamic d` parameter already emitted `owner: "dynamic"` on `d.foo`; that is fixed here.)
//
// The TYPED form (`for (final Repo r in xs)`) keeps working through the existing typed-for-in
// collector and is unaffected by the inference branch.

class Repo {
  void load() {}

  int count = 0;
}

void typedIterable(List<Repo> xs, Iterable<Repo> it) {
  xs.length;
  for (final r in xs) {
    r.load();
    print(r.count);
  }
  for (final q in it) {
    q.load();
  }
}

void dyn(dynamic d) {
  d.foo;
}

void untypedIterable(dynamic xs) {
  for (final z in xs) {
    z.load();
  }
}

void typedForInStillWorks(List<Repo> ys) {
  for (final Repo r in ys) {
    r.load();
  }
}

// MAP VIEWS — `Map<K, V>` writes BOTH element types, and the two views iterate different ones:
// `for (e in byId.values)` writes `V` on `e`; `for (k in byId.keys)` writes `K` on `k`. Before this,
// both loop variables were untyped (receiverTypeUnknown) although both types are written in the
// map's own type arguments. Same evidence class as the containers above: the type was WRITTEN.
void mapViews(Map<String, Repo> byId) {
  for (final r in byId.values) {
    r.load();
  }
  for (final k in byId.keys) {
    final n = k.length;
  }
}

// FUTURE AWAIT — `final repo = await pending;` where `pending` is `Future<Repo>`: the awaited
// value's type is the future's type argument, written two tokens away. `repo.load()` used to be a
// bare leaf with receiverTypeUnknown; the same narrowness applies (only an `await` of a variable
// whose type is written as a Future container).
Future<Repo> pendingRepo() async {
  return Repo();
}

Future<void> awaitRepo(Future<Repo> pending) async {
  final repo = await pending;
  repo.load();
}
