// ONTOLOGY/D25 — a constructor is not callable, and a class body is not a body.
//
// Two facts of [class.ctor] / [class.mem] that the analyzer can read off the tree:
//
//   1. No member of a class may have the same name as the class itself. So inside
//      class `C`, the only thing spelled `C` is `C`'s own constructor.
//   2. A class body DECLARES; it does not execute. `X(args);` at class scope is a
//      constructor DECLARATION and `X(args) : m(0) {}` is a constructor DEFINITION.
//      Neither is a call and neither has a body to call from.
//
// In a well-formed class body the grammar says so: `Ctor();` parses as
// `declaration[declarator=function_declarator]`, which the analyzer publishes as a
// `constructor` symbol. But a MACRO-DECORATED class head — `class LIB_API Widget {`
// — is recovered as a `function_definition` whose specifier carries no body of its
// own and whose PARENT's `compound_statement` IS the body, and that compound
// statement is in ERROR. Inside it, the bare `Ctor(...)` is recovered as
// `expression_statement > call_expression`, or one level deeper as a
// `call_expression` inside an `ERROR` under an access-specifier `labeled_statement`.
//
// The analyzer published `calls C -> C` for those: an edge asserting that a class
// with no body calls itself. Measured over the two pinned C++ corpora (162
// candidate files, 128 admitted as cpp): 9 such rows over 6 files, and every one of
// the nine is a constructor — `reporter.h:131` `BenchmarkReporter();`,
// `reporter.h:189` `JSONReporter() : first_report_(true) {}`, `state.h:172`
// `State(std::string name, …)`, `sysinfo.h:49` `CPUInfo();`, `sysinfo.h:61`
// `SystemInfo();`, `mutex.h:106` `MutexLock(Mutex& m) ACQUIRE(m) :
// ml_(m.native_handle()) {}`, `perf_counters.h:138` `PerfCounters(const
// std::vector<std::string>& …`, `perf_counters.h:154`
// `PerfCountersMeasurement(…)`, `benchmark_api.h:219` `FunctionBenchmark(const
// std::string& name, Function* func)`.
//
// The CONTROLS below are the other direction, and they are why the discriminator
// reads `parentContext.kind === class` rather than "source === target":
//
//   - `Widget::measure()` calling `measure()` IS a call, from a METHOD.
//   - `MutexLock(Mutex& m) : ml_(m.native_handle()) {}` carries a REAL member call
//     in its member-initialiser, on the same source line as the constructor whose
//     own call is suppressed.
//   - `static Widget Null() { return Widget(); }` constructs a temporary inside a
//     method body: a real construction, not a class-scope declaration.

// ---- shape 1: the constructor is an `expression_statement` in the body --------

class LIB_API Widget {
 public:
  Widget();
  Widget(int seed, int scale);

  int measure() { return measure(); }

 private:
  int seed_;
  int scale_;
};

// ---- shape 2: the constructor sits under an access-specifier `labeled_statement`

class LIB_API Gadget {
 public:
  Gadget();
  int count() const { return count_; }

 protected:
  int count_;
};

// ---- CONTROL: a real member call in a member-initialiser, same class ---------

class LIB_API MutexLock {
 public:
  explicit MutexLock(Handle& m) : native_(m.native_handle()) {}
  Handle& native_handle() { return native_; }

 private:
  Handle native_;
};

// ---- CONTROL: a real self-named call from a METHOD ----------------------------

class LIB_API Plain {
 public:
  static Plain Null() { return Plain(); }
  int step() { return step(); }
};

// ---- CONTROL: a WELL-FORMED (undecorated) class body -------------------------
// `Direct();` parses as `declaration[declarator=function_declarator]` here, so the
// analyzer publishes a `constructor` symbol and never entered the branch D25 guards.

class Direct {
 public:
  Direct();
  int field() { return 1; }
};

int main() {
  Widget w(1, 2);
  return w.measure();
}