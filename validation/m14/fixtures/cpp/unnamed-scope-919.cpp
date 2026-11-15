// ONTOLOGY/D21 + D20 — a construct C++ writes WITHOUT A NAME must publish no
// symbol, and declining it must not drop its body.
//
// THE DEFECT (D19). `namespace { … }`, `union { … } name;`, `struct { … } name;`
// and `enum { … };` are ordinary C++ and C++ spells NO name at those positions.
// The analyzer published the literal string `anonymous` for every one of them, which
// is not a name any C++ program contains. Measured over the two pinned C++ corpora
// (162 candidate files): 133 symbols named `anonymous` — 92 namespaces, 39
// classes/structs/unions, 2 enums — over 65 files, and 1,611 relationship rows with
// that string as an endpoint:
//
//   contains  537 rows (519 with it as SOURCE, 20 as TARGET)
//   calls     882 rows  (all as SOURCE)
//   uses      191 rows  (all as SOURCE)
//   instantiates  1 row
//
// Every one of the 882 `calls` rows was an edge out of a name that 92 DIFFERENT
// scopes share, so `bb_graph` on `anonymous` merged unrelated scopes and `bb_impact`
// could not say which one broke. The 20 `contains` rows with it as TARGET are the
// R7 placeholder-literal endpoint the ontology workstream's definition of done
// forbids outright.
//
// The rule now refuses to publish, and the members are walked with the ENCLOSING
// scope. That is not a consolation prize — it is where C++ says they live: an
// unnamed namespace has an implicit using-directive in its enclosing scope
// ([namespace.unnamed]), and an anonymous union's members are members of the
// enclosing class by definition ([class.union.anon]).
//
// PROBED IN BOTH DIRECTIONS first, because "declined" and "lost" are identical on a
// symbol count. All 41 non-namespace `anonymous` symbols sit on a line whose text
// after the `class`/`struct`/`union` keyword carries NO identifier — 0 carry a name
// that failed to resolve — so nothing real is deleted by the refusal.
//
// THE DEFECT D19 EXPOSED (D20). Declining a class specifier walks its children with
// a loop bounded by `namedChildCount` that indexed `node.child(i)` — the FULL child
// list. For a class specifier the first `namedChildCount` children are the
// `class`/`struct`/`union` keyword and the `{`, and the `field_declaration_list`
// that holds every member comes AFTER them, so the body was never walked at all.
// On the first D19 run this deleted 154 real member symbols of anonymous unions in
// `sqlite/src/sqliteInt.h` (`xLegacy`, `xV2`, `isInterrupted`, `pHash`,
// `addColOffset`, …). The accessor is now matched to the bound.
//
// The same mismatch existed at two other decline sites and is fixed with them; the
// third (`returnTypeIsClassDefinition`) is reachable WITHOUT D19 and is covered by
// `ReturnByLocalClassDefinition` at the bottom.

// ---- 1. an UNNAMED NAMESPACE at file scope, and one nested in a real namespace --

namespace {
int fileScopeHelper(int seed) { return seed + 1; }
}

namespace outer {
namespace {
int nestedHelper(int seed) { return seed + 2; }
}  // namespace
}  // namespace outer

// CONTROL: a NAMED namespace publishes and owns exactly as before. Without this row
// the fixture would also pass against an analyzer that published no namespace at all.
namespace named {
int namedHelper(int seed) { return seed + 3; }
}

// ---- 2. an ANONYMOUS UNION inside a struct: its members belong to the STRUCT ----

struct Packet {
  int sequence;
  union {
    void (*onText)(int code);
    int (*onBinary)(int code, int flags);
  };
  int length;
};

// ---- 3. an ANONYMOUS STRUCT inside a union, and an ANONYMOUS ENUM ------------

struct Tagged {
  enum { kNone, kText, kBinary };
  union {
    struct { int offset; int length; } text;
    struct { const char* pointer; int size; } binary;
  };
};

// ---- 4. a KEYWORD-SPIKED class head, which the D1 rule declines ----------------
//
// `class final` is not legal C++ — it is what the grammar's recovery produces for a
// damaged head. D1 already refuses to publish a class under a keyword spelling, and
// that decline walks the body through the same accessor, so this pins the body.

class final {
 public:
  int recovered(int seed) { return seed + 4; }
};

// ---- 5. D20's THIRD SITE, which needs no D19 to be reachable -------------------
//
// A function whose RETURN TYPE is a class definition:
// `Widget Widget::make() { … }` where the declarator chain recovered a specifier.
// `returnTypeIsClassDefinition` declines the node and re-walks its children, which
// through the mismatched accessor meant the whole function BODY was skipped: the
// reads inside it were attributed to whatever scope happened to be open.

struct Widget {
  int id;
  Widget MakeWidget(int seed) {
    int local = seed * 2;
    return Widget{local};
  }
};

// ---- 5b. D20's THIRD SITE, the shape that actually trips it ------------------
//
// `returnTypeIsClassDefinition` fires when a `function_definition`'s `type` FIELD is
// a class/struct/union specifier that carries a `field_declaration_list` — which
// happens when a nested class is written in the return-type position. That is the
// only shape in this fixture that reaches the third decline path, and without it the
// third D20 mismatch would be a rule with no fixture behind it.

struct Maker {
  struct Nested {
    int id;
  } MakeNested(int seed) {
    int local = seed * 3;
    return Nested{local};
  }
};

// ---- 6. the DECLARED-anonymous-typedef residual, pinned as DOCUMENTED ---------
//
// `typedef struct { … } Name;` gives the struct no name of its own, so D19 declines
// it and its members have no named owner in this analyzer. The typedef alias `Name`
// IS published (as a `type`), so the fact is not lost — it is just not a `contains`
// edge. This row exists so the limitation is a PIN rather than a note, and so a
// future change that starts attributing these members is caught as a behaviour
// change on purpose rather than by accident.

typedef struct {
  int handle;
  int flags;
} Alias;

int useAlias(Alias value) { return value.handle; }
