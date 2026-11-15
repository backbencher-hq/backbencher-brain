// ONTOLOGY `exports`, and the `returnType` defect that shares its nodes.
//
// C++ before C++20 has no `export` keyword, so the construct that means "this
// declaration is part of the library's public ABI" is a CONVENTION written as a
// macro in the declaration-specifier position:
//
//     LIB_EXPORT void Shutdown();              <- exported
//     LIB_EXPORT class Reporter { … };          <- exported
//     LIB_ALWAYS_INLINE std::string join(int); <- decorated, NOT exported
//     typedef void* HANDLE;                    <- an all-caps TYPE, not a macro
//
// The rule reads an underscore-delimited COMPONENT of the macro's name —
// EXPORT / EXPORTS / EXPORTABLE / API / DLLEXPORT / VISIBILITY / PUBLIC_API —
// which is what CMake's `generate_export_header`, autotools and abseil's
// `ABSL_EXPORT` all produce. It is deliberately NOT "some all-caps macro in type
// position": over the two pinned C++ corpora that would have fired on 118 sites
// and been wrong on 43 of them (BENCHMARK_ALWAYS_INLINE 17, BENCHMARK_UNUSED 4,
// HANDLE 3, DWORD 3, BENCHMARK_NORETURN 2, WORD 2, …), and an `exports` edge
// pointing at `LIB_ALWAYS_INLINE` asserts an ABI fact that is false.
//
// FOUR head shapes are measured on the corpus, and each is pinned here because
// the first cut of the reader handled one of them and silently mis-named the
// other three:
//
//   A1  class LIB_EXPORT Base { … }                       -> name is a bare sibling
//   A2  class LIB_EXPORT Reporter : public LIB_EXPORT Base { … }
//       ERROR("Reporter : public LIB_EXPORT")              -> the NAME is in the ERROR
//       identifier("Base")                                 -> this is the BASE
//   A3  class LIB_EXPORT Sealed final { … }                -> ERROR("final") is a KEYWORD
//   A4  class LIB_EXPORT ALIGNED Thing { … }               -> ERROR("Thing") is the NAME,
//                                                            the sibling is a 2nd MARKER
//
// The same nodes are why `returnType` is pinned: on shape B the marker is read as
// the declaration's `type` field, so the node's whole text is `LIB_EXPORT void`,
// and publishing that verbatim gave ONE C++ function two different return types in
// one index — the header said `LIB_EXPORT void` and its out-of-line definition in
// the .cpp said `void`. 87 such rows over the two pinned corpora.

#define LIB_EXPORT __attribute__((visibility("default")))
#define LIB_API __declspec(dllexport)
// The body is deliberately SIMPLE. `#define X inline
// __attribute__((always_inline))` parses to a bare `preproc_arg` with no
// `preproc_def` at all — the `__attribute__((...))` breaks the preprocessor rule
// — so the analyzer never sees the DECLARATION and cannot tell the marker from a
// typedef. That is a grammar limitation (the R2 family: a `#define` the recovery
// destroyed), not an analyzer rule, and pinning it here would pin a limitation as
// if it were a decision. The rule's roster test needs the `#define`, so the
// fixture supplies a body the grammar can read.
#define LIB_ALWAYS_INLINE inline
#define LIB_INTERNAL __attribute__((visibility("hidden")))

typedef void* HANDLE;

LIB_EXPORT void Shutdown();
LIB_EXPORT std::string Version();
LIB_ALWAYS_INLINE std::string join(int a);
std::string Plain();

// D27: the declared type of a `macro_prefixed_type_specifier` is its non-macro
// children's text JOINED, and the join has to normalise the whitespace — a type
// written across lines or with alignment padding is a real C++ spelling and its
// irregular spacing must not reach `returnType`, which is an
// overload-resolution input rather than a display field. `Counter` below is
// `unsigned   long   long`; the published type is `unsigned long long`.
LIB_EXPORT
unsigned   long   long  Counter();

namespace lib {

class LIB_EXPORT Base {
 public:
  virtual ~Base() = default;
  virtual int compute(int seed) const = 0;
};

// A2: the base clause. `Reporter` is the class, `Base` is what it extends, and the
// class must not be published under its base's name.
class LIB_EXPORT Reporter : public LIB_EXPORT Base {
 public:
  int compute(int seed) const override;
};

// A3: a trailing specifier keyword. `final` is a keyword, not a name.
class LIB_EXPORT Sealed final {
 public:
  int compute(int seed) const;
};

// A4: a SECOND head marker before the name.
class LIB_EXPORT ALIGNED Thing {
 public:
  int compute(int seed) const;
};

// NEGATIVE CONTROL: `LIB_INTERNAL` is `visibility("hidden")` — the OPPOSITE of an
// export — and its name carries no export component either.
class LIB_INTERNAL Hidden {
 public:
  int compute(int seed) const;
};

}  // namespace lib

std::string Version() { return "1.0"; }
std::string Plain() { return ""; }
std::string join(int a) { return std::to_string(a); }
unsigned long long Counter() { return 0; }

int lib::Reporter::compute(int seed) const { return seed + 1; }
int lib::Sealed::compute(int seed) const { return seed + 2; }
int lib::Thing::compute(int seed) const { return seed + 3; }
int lib::Hidden::compute(int seed) const { return seed + 4; }