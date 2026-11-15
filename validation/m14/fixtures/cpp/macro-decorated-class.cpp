// D15: a class whose HEAD is decorated by a macro is still a class.
//
// Taken from the measured fmt site `test/gtest/gmock-gtest-all.cc`, where gtest
// writes every one of its classes as a macro-decorated head:
//
//     class GTEST_API_ UnitTestImpl { ... };
//
// The grammar cannot read that, and what it does instead is worse than giving up —
// it recovers the whole declaration as a FUNCTION:
//
//     function_definition
//       class_specifier "class GTEST_API_"
//         type_identifier "GTEST_API_"   <- the specifier's `name` field is the MACRO
//       identifier "UnitTestImpl"        <- the real class name, a bare SIBLING
//       compound_statement "{ ... }"     <- the class BODY
//
// so the specifier carries no body of its own, the forward-declaration rule declines
// it, and the class is never published. MEASURED before the fix across the five
// pinned C++ corpora: 93 macro-decorated class declarations, 5 published, 88 lost.
// In this one file `UnitTestImpl` was published at `902-902` — the constructor's own
// declaration line — and owned 91 edges spread over lines 902-1354.

// The defect case. MEASURED: before the fix this published `constructor` at 902-902
// and no `UnitTestImpl` class at all.
class GTEST_API_ UnitTestImpl {
 public:
  explicit UnitTestImpl(UnitTest* parent);
  int value() const;

 private:
  int cached_;
};

// A struct spelling, to pin that the rule is about the HEAD not the keyword.
struct STDCALL_DECL Reporter {
  int count;
};

// THE D11 CONTROL, and the reason the all-caps test is load-bearing rather than
// tidy. `class Widget f();` also has a `class_specifier` as the `type` field of a
// `function_definition`, and its compound_statement is a body too — so a detector
// that stopped at "specifier with no body of its own" would swallow this, publish a
// class named `Widget` that already exists above, and re-own the body. The two differ
// exactly as the gate states it: here the specifier's `name` is `Widget`, a class
// name, not a macro; and `f` sits inside a `function_declarator`, never as a bare
// sibling of the specifier.
class Widget {
 public:
  class Widget* f();
};

// A plain class, whose body the analyzer already owned correctly.
class Plain {
 public:
  int m() const;
};

// A lowercase struct. `struct thing_lowercase` is NOT a macro spelling, so nothing
// about it should be read as a decorated head — it is here so that a detector
// loosened to "any specifier with no body of its own" is caught even when the
// following identifier happens to be lowercase.
struct thing_lowercase {
  int y;
};