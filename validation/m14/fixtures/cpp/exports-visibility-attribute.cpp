// M14 ONTOLOGY — `exports`: the export attribute, read structurally.
//
// WHICH SPELLING EXISTS IS A MEASUREMENT, not a preference, and the census
// (`script/cpp-review/ontology-census.ts`) took all three arms apart:
//
//   1. `__declspec(dllexport)` — MSVC. The grammar keeps the paren group as an
//      `ms_declspec_modifier` node whose named children are the attribute names,
//      so the spelling is a node. Measured: 0 declarations in the corpus spell it
//      inline, and 11 `#define X __declspec(dllexport)` definitions hide it behind
//      a macro — which is how both fmt (`FMT_API`), googletest (`GTEST_API_`),
//      nlohmann-json (`JSON_HEDLEY_PUBLIC`) and this lane's own corpus
//      (`EXPORT_ATTR`) actually do it.
//   2. `__attribute__((visibility("default")))` — GCC/Clang ELF. An
//      `attribute_specifier` holding an `argument_list` whose `call_expression`
//      names `visibility` with a `"default"` string. Measured: exactly 1 site in
//      the corpus, in a file named `test/static-export-test/library.cc` — a file
//      whose entire purpose is to export a symbol this way.
//   3. C++20 modules (`export module M;`, `export import base;`). MEASURED
//      ABSENT from the pinned grammar: 0 `export`, `module_declaration`,
//      `import_declaration` and `module_import` nodes across 182 node types, and
//      the syntax ERROR-recovers into `declaration[declarator=module, type=export]`
//      — a recovery artifact, not an export. Ruled for this parser, with the
//      count.
//
// So arms 1 and 2 are read here. Arm 3 is reported, not faked. The
// macro-mediated arm (1 behind a `#define`) needs macro expansion, which is a
// DECLARED limitation of this lane (M14-HONESTY-CONTRACT §3 lists "macro /
// template expansion boundaries (c, cpp, rust, hcl)"), so its population is
// reported with its count rather than resolved.
__declspec(dllexport) int msvc_exported(int x) { return x; }

// NEGATIVE: the OPPOSITE spelling. `dllimport` says this translation unit
// imports the symbol from another module, and `visibility("hidden")` says the
// opposite of default visibility. Neither is an export.
__declspec(dllimport) int from_another_module(void);
__attribute__((visibility("hidden"))) int not_exported(void) { return 0; }

// NEGATIVE: a bare `__attribute__` with no visibility in it is not an export —
// the attribute must be the visibility one AND its argument must be `default`.
__attribute__((unused)) int annotated_but_not_exported(void) { return 0; }

__attribute__((visibility("default"))) int gcc_exported(int y) { return y + 1; }

// NEGATIVE: `visibility` CALLED with a different argument is not an export.
int spoof(int v) { return visibility(v); }

// An exported CLASS. `__declspec` sits on the specifier, before the name, so the
// edge's line is the class NAME's line and not the attribute's.
class __declspec(dllexport) ExportedClass {
public:
    int member(void) const { return 0; }
};

// An exported class MEMBER. The target is `Owner.member`, the same endpoint
// convention `overrides` already uses, so an exported member is not confused
// with a same-named file-scope entity.
class WithExportedMember {
public:
    __declspec(dllexport) int exported_method(void);
    int plain_method(void) const { return 0; }
};

// NEGATIVE: an exported member is not ALSO a file-scope name. Two classes may
// each export a method called `same_name`, and that is two edges because the
// targets differ — the one-edge-per-pair rule is keyed on the pair.
class Alpha {
public:
    __declspec(dllexport) int same_name(void);
};

class Beta {
public:
    __declspec(dllexport) int same_name(void);
};

// NEGATIVE: a member exported through the MACRO spelling is not emitted. This
// is the limitation arm, stated as an assertion so the boundary is a measured
// contract rather than an omission somebody re-derives.
#define BENCHMARK_EXPORT __declspec(dllexport)
BENCHMARK_EXPORT int exported_through_a_macro(void) { return 0; }