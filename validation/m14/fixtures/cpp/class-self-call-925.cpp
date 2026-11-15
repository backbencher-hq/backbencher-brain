// D25 — a CLASS CALLING ITSELF is a fabrication, and the CONTROL that gives the
// rule its meaning is a method calling itself a few lines below.
//
// Two rules of the language are violated at once by `calls C -> C` sourced at a
// class:
//
//   [class.mem]  a class body DECLARES; it does not execute. A `call_expression`
//                at class scope is not a call.
//   [class.ctor] no member of a class may have the class's own name — the only
//                such member is the constructor, which is not callable and has no
//                body to call from.
//
// THE SHAPE, and it is worth stating where it comes from because the production
// path CREATES it: `src/ast/engine.ts` blanks `__attribute__((...))` out of C/C++
// content before the parser sees it, so
//
//   struct BENCHMARK_EXPORT CPUInfo {          // BENCHMARK_EXPORT expands to
//     int n;                                    // __attribute__((visibility("default")))
//    private:
//     CPUInfo();                               // <- the constructor DECLARATION
//   };
//
// reaches the grammar as `struct <spaces> CPUInfo { … }` — a BARE TOKEN between
// `struct` and the name. That is `macro_prefixed_type_specifier` territory, the
// grammar recovers a `function_definition` whose declarator is the macro and whose
// body is the class body, and the constructor declaration inside it comes back as
// an expression statement. Measured on cpp-example/include/benchmark/sysinfo.h: the
// row `calls CPUInfo -> CPUInfo` at line 49 existed until this rule, alongside
// `calls CPUInfo -> BENCHMARK_DISALLOW_COPY_AND_ASSIGN` on the next line, which is
// the tell — a class cannot call itself and it cannot call a macro either.
//
// MEASURED over the 912 cpp corpus files, by counting `calls` rows where
// source === target and classifying the source symbol's kind:
//
//     1,455  calls rows with source === target, before the rule
//         923  sourced at a METHOD   — real recursion, all survive
//         450  sourced at a FUNCTION — real recursion, all survive
//          80  sourced at a CLASS    — fabrications, removed
//           2  sourced at a VARIABLE — `BenchmarkReporter` at reporter.h:131, the
//                                    same recovery publishing the head as a
//                                    variable; removed
//
//     1,373  after the rule: 82 fabrications gone, 0 real rows lost. Sites:
//     sysinfo.h:49 and :61, mutex.h:106, perf_counters.h:138 and :154,
//     reporter.h:131 and :189, state.h:172, benchmark_api.h:219 — nine files, each
//     counted twice because the corpus holds cpp-example and its clone cpp-sample.

// NEGATIVE ARM 1: the measured shape. A bare token between `struct` and the name.
struct CPUInfoAlpha {
    int n;
  private:
    CPUInfoAlpha();
};

// NEGATIVE ARM 2: the same on a `class`, and with the declaration and the fields
// on one line, which is the sysinfo.h spelling.
struct BENCHMARK_EXPORT CPUInfoBeta { int n; private: CPUInfoBeta(); };

// NEGATIVE ARM 3: `class` rather than `struct`.
class DECORATED CPUInfoGamma { int n; private: CPUInfoGamma(); };

// THE CONTROL. `Runner::run` calls `run` — real recursion from a METHOD, published
// with source `run`, and it must survive a rule that keys on the callee spelling.
// A suite that only counted the removed rows would not notice its removal.
struct Runner {
    int depth;
    void run(int n) {
        if (n > 0) run(n - 1);      // recursion: a member calling itself
    }
};

// THE CONTROL, second form: a free FUNCTION calling itself. 450 corpus rows are
// this shape and every one must survive.
int descend(int n) {
    if (n <= 0) return 0;
    return descend(n - 1);          // recursion: a function calling itself
}

// THE CONTROL, third form, and it is the one that decides the discriminator.
// `Widget fresh;` inside `Widget::make` involves the class name as an OBJECT, not a
// callee — and a member function may default-construct a temporary, so a legal call
// can sit inside a class's lexical extent with the class's name in it. The
// enclosing scope of that call is the METHOD `make`, which is exactly why the rule
// is stated over the scope's kind and not over the text.
struct Widget {
    int field;
    void make(void) {
        Widget fresh;              // an object, not a call
        (void)fresh.field;
    }
};