// #743 cpp port: a BARE identifier macro in the declaration specifier.
//
// Every decorated shape below was MEASURED to cost the whole declaration before
// the rule landed — the struct and each of its members vanished, or the function
// did — AND to mint a phantom symbol named after the macro (`variable struct`,
// `variable enum`, `variable class`). The `friend` and `::` sections pin the two
// traps the port had to avoid:
//
//   * `ns::sink(1)` must stay a CALL. Ported verbatim from C, the rule made this
//     an already-clean file parse as a DECLARATION of a function named `::sink`,
//     because cpp's scope resolution has an OPTIONAL scope so `A::B` is readable
//     as the qualified type `A::B` or as macro `A` decorating `::B`.
//   * `ns::Type qualifiedVar;` must keep its qualified TYPE, not become a macro
//     decoration of `::Type`.
//
// Comment, not directive: the macro definitions are deliberately absent so the
// identifiers stay plain tokens, which is what the corpus looks like before the
// preprocessor has run.

#define EXPORT_API
#define NLOHMANN_DECL

EXPORT_API void exportedFn(void);

EXPORT_API struct Decorated {
  int firstField;
  int secondField;
};

EXPORT_API int decoratedInt;

static EXPORT_API int staticExported(void);

NLOHMANN_DECL struct Templated {
  int onlyField;
};

namespace ns {
struct Type {
  int member;
};
void sink(int value);
}  // namespace ns

int callSite(void) {
  ns::sink(1);
  ns::Type qualifiedVar;
  return qualifiedVar.member;
}
