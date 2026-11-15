// D7 (#962): a specifier's name arrives as a `qualified_identifier`, and the
// analyzer read names only from a DIRECT `type_identifier` child — so the class
// published as `anonymous`, the analyzer's own no-name sentinel.
//
// TWO ARMS, TWO DIFFERENT RULES, because the C++ grammar is not the same in both.
//
// ── ARM A: a qualified name is a real name ─────────────────────────────────
//
// An explicit specialization names the template it specializes, qualified:
//
//   namespace fmt {
//     template <typename T, typename Char> struct formatter { … };
//     template <>
//     struct fmt::formatter<mine, char> : formatter<mine, char> { … };
//   }
//
// The grammar hands the analyzer `struct_specifier[name=qualified_identifier]`, and
// `findChild(node, "type_identifier")` is a direct-child scan, so the name was
// invisible and the class published as `anonymous` — with its members owned by
// `anonymous`, sitting next to correctly-named siblings. The rule is CPPD1's leaf:
// `fmt::formatter` names `formatter`. 26 sites over 1,722 real C++ files.
//
// ── ARM B: an enum has NO qualified name, so this one is an attribute ──────
//
// C++23 `enum class [[=fmt::as_identifiers]] color { … }`. The `[[=…]]` has no node
// type, so the grammar ERROR-recovers and the attribute's qualified_identifier
// lands in the `name` field:
//
//   declaration [ERR] [type=enum_specifier declarator=init_declarator]
//     enum_specifier [ERR] [name=qualified_identifier] "enum class [[=fmt::as_identifiers"
//       ERROR [ERR] "[[="
//       qualified_identifier "fmt::as_identifiers"   <- the ATTRIBUTE
//     ERROR [ERR] "]]"
//     init_declarator [declarator=identifier value=initializer_list] "color { … }"
//       identifier "color"                            <- the REAL declared name
//
// Three things went wrong at once in fmt/test/enum-test.cc:24: the enum published
// as `anonymous`, a PHANTOM `variable "color"` took the name, and every enumerator
// in the enum was lost. 22 sites over the corpus.
//
// NOT CLAIMED: the enumerators stay lost. The `enum_specifier` node ends before
// `{ red, green, blue }`, so the grammar never produced them. Recovering them would
// mean re-parsing source text, which this analyzer's contract forbids.

namespace outer {

// Arm A's primary template — declared so the qualified specialization below is valid.
template <typename T, typename Char>
struct formatter {
    auto format(const T&) const -> std::basic_string<Char>;
};

// ARM A: a qualified explicit specialization.
template <>
struct outer::formatter<int, char> : formatter<int, char> {
    auto format(const int& v) const -> std::basic_string<char>;
};

// Arm A's CONTROL: the same specialization written UNQUALIFIED, which is the shape
// CPPD1 already handled. Both must publish the same name — a rule that only fixed
// the qualified spelling would leave this one broken, and one that only fixed this
// one would have been invisible.
template <>
struct formatter<long, char> : formatter<long, char> {
    auto format(const long& v) const -> std::basic_string<char>;
};

}  // namespace outer

namespace outer {

// ARM B: the C++23 attribute. `color` is the declared name; `fmt::as_identifiers`
// is the attribute and must never become a name.
enum class [[=as_identifiers]] color { red, green, blue };
enum [[=as_identifiers]] unscoped_color { unscoped_red, unscoped_green };

// ARM B, second spelling: the attribute QUALIFIED, which the grammar hands over as
// a `qualified_identifier` in the name field rather than a bare `type_identifier`.
// The first cut of the fix tested the name field's TYPE and so caught only one of
// these two — which is why both are here. Measured: 19 sites qualified, 3
// unqualified, over the real corpora.
enum class [[=outer::as_identifiers]] qualified_attr_enum { qa, qb };

// ARM B, with an explicit underlying type: the enum node also ends before the
// `: unsigned char`, so the recovery has even more to swallow. Present in the real
// corpus (fmt/test/enum-test.cc:27) and pinned here because it is the shape most
// likely to differ from the two above.
enum class [[=as_identifiers]] fixed_underlying : unsigned char { low = 1, high = 2 };

// ARM B's CONTROL: a genuinely UNNAMED enum, which must still publish as
// `anonymous`. This is what makes the forbids meaningful — if the fix had simply
// stopped publishing `anonymous` for enums, this line would go missing and the gate
// would trade a fabrication for a loss.
enum { buffer_size = 512 };

// A named enum with no attribute at all — the shape that already worked, pinned so
// the attribute rule cannot be over-broad enough to catch it.
enum class plain_enum { one, two };

// The annotated enum's own enumerators, spelled at namespace scope so the test does
// not depend on the members the grammar lost inside the attribute form.
constexpr int red_value = 0;

}  // namespace outer
