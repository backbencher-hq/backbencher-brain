// D17/D27/D18: the DECORATED HEAD — a macro standing where a return type stands.
//
// C++ writes ABI/no-inline/deprecation decoration as a macro in the type position,
// and every shape below is measured on the nlohmann/doctest corpora (`returnType`
// rows: 121 symbols over 465 files published a MACRO SPELLING as a C++ return type
// before this fixture's fix, and a macro name resolves to nothing — it is not an
// overload-resolution input, it is a spelling no compiler accepts as a type).
//
//   1  LIB_API void Shutdown();            grammar splits decorator from type itself
//                                          (`macro_prefixed_type_specifier`)
//   2  LIB_API\nunsigned   long   long  C()  the declared type is REBUILT from the
//                                          specifier's non-macro children, whose
//                                          alignment padding must not survive (D27)
//   3  LIB_NONNULL(1)\nLIB_UNUSED\nchar* f()  the decorator's own parens swallowed the
//                                          type and the declarator: the real type is
//                                          the recovery's own record of where it went
//   4  LIB_API String operator+(…);        the grammar REJOINS the type to the NAME as
//                                          a phantom qualifier (empty `::`), so the
//                                          prefix of the qualified name IS the type
//   5  LIB_NONNULL(3)\nSink(…) : Base(…)   a CONSTRUCTOR's decorated head: the
//                                          recovery holds the macro's argument and the
//                                          real declarator, then the base-class
//                                          initializer as a DECOY declarator — and a
//                                          constructor states NO type at all
//
// The controls are the reason this is not spelled "some all-caps macro in type
// position": `HANDLE_CTX` is a TYPEDEF (`typedef void* HANDLE_CTX;`) whose name the
// spelling alone cannot tell from a decorator, a decorated declaration still earns
// its own symbol and field, and a macro INVOCATION recovered as a declarator is a
// STATEMENT — the recovery may only be entered for a declaration.

#define LIB_API __attribute__((visibility("default")))
#define LIB_NONNULL(n) __attribute__((nonnull(n)))
#define LIB_UNUSED __attribute__((warn_unused_result))

typedef void* HANDLE_CTX;

class String {};

// 1 + 2: the specifier the grammar splits ITSELF, and the alignment padding of a type
// written with irregular spacing.
LIB_API void Shutdown();
LIB_API
unsigned   long   long  Counter();

// 3: the second decorator and the type, both swallowed by the first macro's parens.
LIB_NONNULL(1)
LIB_UNUSED
char* first_char(int offset);

// 4: `LIB_API String operator+(…)` — `String` is the type, not a scope, and the empty
// `::` separator the grammar wrote between them is the evidence.
LIB_API String operator+(const String& lhs, const String& rhs);

class Base {
 public:
  Base(int id, const char* what) : id_(id), what_(what) {}
 private:
  int id_;
  const char* what_;
};

// 5: the constructor. `Base(id, what)` is the decoy the recovery reads as a declarator
// (`function_declarator[field_identifier Base]`), which is how the pre-fix reader
// published `method Sink.Base` — a member named after the class's own BASE, with no
// parameters and a body it does not have — while the constructor stayed unpublished.
class Sink : public Base {
 public:
  LIB_NONNULL(3)
  Sink(int id, const char* what) : Base(id, what) {}
};

// CONTROL 1: an all-caps TYPEDEF is a real type. The spelling alone can never be the
// decorator test — the marker rule's own measurement (exports-marker-910) found 43
// false positives for that and lists `HANDLE`/`DWORD`/`WORD` among them.
HANDLE_CTX OpenContext();

// CONTROL 2: no decorator anywhere, so the declared type is published verbatim.
std::string Plain();

// CONTROL 3: a macro INVOCATION recovered INTO a declaration-shaped node. A
// preprocessor-split method body recovers as the CALL's own declarator — measured at
// nlohmann json.hpp:3499 —
//   field_declaration[type_identifier, parenthesized_declarator[ERROR[identifier(ptr),
//                     function_declarator(convert())]]]
// and the descent that reads a declared name out of a recovery may only be entered for
// a declaration: this one states no type and defines nothing, so the call must not be
// published as a function. (The `property fallback` row this same shape leaves behind
// is a PRE-EXISTING reading of the field branch, unrelated to the head, and is
// deliberately not pinned here either way.)
#define PROBE_SPLIT 0

class Split {
 public:
  int measure(const char* ptr, int fallback) const
#if PROBE_SPLIT
  = delete;
#else
  {
    return lookup(ptr.convert(), fallback);
  }
#endif
};

// CONTROL 4: the real member of the name the gate protects still publishes.
struct Probe {
  const char* getHairColor() const { return "blue"; }
};
