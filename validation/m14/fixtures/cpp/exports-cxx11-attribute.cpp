// M14 ONTOLOGY — `exports`, the C++11 `[[...]]` SPELLING, and why this fixture
// exists separately from `cpp/exports-visibility-attribute`.
//
// That fixture pins the two VENDOR KEYWORD spellings:
//   __declspec(dllexport)                        (MSVC)
//   __attribute__((visibility("default")))       (GCC/Clang ELF)
// and both are BLANKED by `src/ast/engine.ts` before the parser sees them, so the
// production entry cannot deliver either (measured: 0 `exports` rows over 929
// corpus files; 1 row when the same analyzer is run over the un-blanked text).
//
// This fixture pins the spelling the STANDARD defines, which the engine does NOT
// blank, so it is the arm that can reach production today:
//
//   [[gnu::visibility("default")]]   C++11 attribute syntax, GCC/Clang
//   [[msvc::dllexport]]              C++11 attribute syntax, MSVC
//
// Measured shape on the pinned fork — the NAME is the LAST identifier of the
// `attribute`, the vendor prefix is not part of it, and the argument lives in the
// attribute's own `argument_list`:
//
//   attribute_declaration "[[gnu::visibility(\"default\")]]"
//     attribute "gnu::visibility(\"default\")"
//       identifier "gnu"            <- vendor
//       identifier "visibility"     <- the attribute NAME
//       argument_list > string_content "default"
//
// CORPUS POPULATION, and it is stated rather than implied: over the 912 cpp files
// of cpp-example + cpp-sample + fmt + googletest + nlohmann-json there are 308
// `attribute_declaration` nodes and the corpus's histogram is `nodiscard` 285,
// `maybe_unused` 9, `noreturn` 8, `deprecated` 6 — and ZERO `visibility` or
// `dllexport`. So this arm adds 0 edges on that corpus and every positive row here
// is a fixture-only measurement. That is the honest shape of the finding: the
// LANGUAGE has the construct and the grammar reads it, the corpus at hand does not
// use it, and the two spellings the corpus DOES use are erased upstream of the
// analyzer. A sample of one repository is a fact about the sample.

// POSITIVE: the visibility form, at file scope, on a function.
[[gnu::visibility("default")]] void exported_free_function(void);

// POSITIVE: the MSVC form, at file scope, on a function.
[[msvc::dllexport]] void exported_msvc_function(void);

// POSITIVE: on a CLASS, written between the keyword and the name.
struct [[gnu::visibility("default")]] ExportedClass {
    int field;
};

// POSITIVE: on a MEMBER, which publishes an `Owner.member` endpoint so an
// exported member is not confused with a same-named file-scope entity.
struct Holder {
    [[gnu::visibility("default")]] void exported_member(void) { }
    void plain_member(void) { }
};

// NEGATIVE, and it is the corpus's real population: none of these four attribute
// names is an export, and a rule that read "this declaration carries an
// attribute" instead of the attribute's NAME would manufacture four edges per
// class here. 285 of the corpus's 308 `[[...]]` attributes are `nodiscard`.
[[nodiscard]] int nodiscard_function(void);
[[maybe_unused]] void maybe_unused_function(void) { }
[[noreturn]] void noreturn_function(void);
[[deprecated]] void deprecated_function(void);

// NEGATIVE: `visibility("hidden")` is the OPPOSITE of exported. Same attribute,
// same argument shape, opposite meaning — the arm that separates them is the
// STRING, read from the argument_list node.
[[gnu::visibility("hidden")]] void not_exported_hidden(void);

// NEGATIVE: `visibility` spelled with a different argument is neither export nor
// hide; it is an attribute this analyzer does not claim to understand.
[[gnu::visibility("protected")]] void not_exported_other(void);

// NEGATIVE: `extern "C"` is language LINKAGE, not export. It changes the symbol
// name the linker sees and says nothing about visibility, so an analyzer that
// conflated the two would claim every C-ABI function exports from a shared
// library.
extern "C" void c_linkage_not_export(void);

// NEGATIVE: `dllimport` is the opposite direction — this translation unit
// imports the symbol from another module.
__declspec(dllimport) void imported_from_another_module(void);