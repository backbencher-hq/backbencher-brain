function stringIncludes(str: string, val: string): boolean {
  return str.indexOf(val) !== -1
}

// Strip `<`, `>`, `"`, and `'` characters from an include-path node text
// (`<vector>` → `vector`, `"Service.h"` → `Service.h`). Pure-String scan —
// replaces the legacy `/[<>"']/g` regex used for include-path extraction.
function stripIncludeChars(text: string): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c !== "<" && c !== ">" && c !== '"' && c !== "'") out += c
  }
  return out
}

// Strip a leading access-specifier keyword from a base-class node text
// (`private Repository` → `Repository`). Pure-String scan — replaces the
// legacy `/^public\s+|^protected\s+|^private\s+/` regex.
function stripAccessSpecifier(text: string): string {
  const lower = text.toLowerCase()
  if (lower.startsWith("public")) return text.slice("public".length).trim()
  if (lower.startsWith("protected")) return text.slice("protected".length).trim()
  if (lower.startsWith("private")) return text.slice("private".length).trim()
  return text.trim()
}

/**
 * D6: the last `::` segment of a type expression, with template arguments and
 * whitespace already out of the way — the base-class leaf the `extends` target
 * must be (CPPD4: template ARGUMENTS are arguments, never the inherited base).
 *
 * This replaces the lane's last two regexes, `/::|\s+/`, which the M12 regex
 * census has been recording as `needs_review` while
 * `docs/analyzers/real-cpp-analyzer.md` claimed the analyzer had **zero** regex
 * usages. The census was right and the doc was wrong; a doc that under-reports
 * its own analyzer's text rules is worse than the rules, because it is the
 * artifact a reviewer trusts instead of re-measuring.
 *
 * Pure-String, and it is a SEGMENT split rather than a regex split on purpose:
 * a qualifier is a run of non-separator characters, and the answer is the last
 * one. Single pass, no allocation beyond the segments it keeps.
 */
function lastScopeSegment(text: string): string {
  let start = 0
  let out = ""
  for (let i = 0; i <= text.length; i++) {
    // The sentinel at i === length is a separator, so a name with no separator
    // in it at all (the common `class D : public B`) still lands in `out`.
    const atEnd = i === text.length
    const c = atEnd ? ":" : text[i]
    // `::` is a two-character separator; a lone `:` and any whitespace also end
    // a segment (the recovery shapes write `> :: value , int >`).
    const isSep = c === ":" || c === " " || c === "\t" || c === "\n" || c === "\r"
    if (isSep) {
      if (i > start) out = text.slice(start, i)
      start = i + 1
    }
  }
  return out
}

/**
 * D2: the base-class name an `extends` edge may name, or `null` when the base
 * cannot be named — which is the case the analyzer had been publishing anyway.
 *
 * A class cannot inherit from itself. Two real shapes both collapse to the
 * class's own name once the qualifier and the template arguments are removed,
 * and both were emitted as `X extends X` (49 rows over 1,722 real C++ files):
 *
 *   template <unsigned N> struct priority_tag : priority_tag<N - 1> {};
 *   //  -> priority_tag extends priority_tag   (a different INSTANTIATION)
 *
 *   namespace nlohmann { namespace detail {
 *     template <typename T> struct char_traits : std::char_traits<T> {};
 *   }}
 *   //  -> char_traits extends char_traits   (a DIFFERENT CLASS, in std)
 *
 * The second is the worse of the two: the inheritance is real, and the leaf
 * clean that produced the impossible edge is the same clean that threw away the
 * one piece of information the edge carried — which class was inherited from.
 * The override resolver already refused these bases (`if (base === startCls)
 * continue`, with this exact reasoning); the EDGE they were derived from did
 * not. One rule, both places.
 *
 * So the ruling is not "skip self-inheritance" — it is that a base whose leaf
 * equals the derived class's own name has lost the evidence that told them
 * apart, and an edge built on lost evidence is not a weaker edge, it is no
 * edge. Nothing is published, and the class's own base list omits it too, so
 * no override chain can be resolved through a base that does not exist.
 *
 * Exported so the F5 oracle derives `extends` truth with the SAME rule rather
 * than a second copy of the leaf clean and a second answer about the self case
 * (#916's lesson — a copied rule is a second answer, and the two sides
 * cancelling out of every count is how a wrong edge survives a year of gates).
 */
export function extendsTargetName(baseText: string, className: string): string | null {
  const leafOf = (raw: string): string => {
    let t = stripAccessSpecifier(raw)
    const lt = t.indexOf("<")
    if (lt !== -1) t = t.slice(0, lt).trim()
    return lastScopeSegment(t)
  }
  const leaf = leafOf(baseText)
  if (!leaf) return null
  // The class's own name is compared in the SAME namespace the base is compared
  // in, and that is the whole point of the rule. Two callers spell a class
  // differently for a good reason — the analyzer reads the CPPD1 `template_type`
  // base name (`formatter`) while the F5 oracle keeps the head spelling
  // (`formatter<std::byte, Char>`) — and comparing those two literally would let
  // `formatter<std::byte, Char> : formatter<…>` through, re-introducing the
  // impossible self-inheritance the rule exists to refuse. `formatter<std::byte,
  // Char>` IS a `formatter`: a specialization is not a different class in the
  // only sense this edge cares about, which is "did I inherit from myself".
  if (leaf === leafOf(className)) return null
  return leaf
}

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * #919: a MACRO-DECLARED BODY — a call-shaped macro standing as the whole
 * heading of a block, where the pinned cpp grammar read the heading as an
 * `expression_statement` whose terminator is MISSING and left the block as a
 * SIBLING `compound_statement`:
 *
 *   TEST(format_test, enum) { EXPECT_EQ(fmt::format("{}", foo), "0"); }
 *   TEST_CASE("iterator class") { SECTION("copy assignment") { … } }
 *   JSON_INTERNAL_CATCH (out_of_range&) { … }
 *
 * The cpp sibling of #917 (the c lane's macro-wrapped heading). Because no
 * `function_definition` exists, the body was inside NO function scope: its
 * locals published as FILE-SCOPE symbols (`variable j`, `variable it` in
 * nlohmann-json's tests, 1,890 of them across 14 files) and every read in the
 * body was attributed to `global` (7,402 edges).
 *
 * The SHAPE is evidence, not a heuristic: a call-shaped statement at namespace
 * scope is not valid C++, and the MISSING terminator is the grammar's own
 * record of the recovery — a real `;` never produces this node. Both arms are
 * required (the missing terminator AND a sibling block), and the rule is
 * exported so the F5 oracle walks the same evidence rather than a copy of it
 * (#916's lesson: leaving truth behind converts the recovery into fabrication).
 *
 * The caller owns the CONTEXT gate (`enclosingFunctionScope() === null`), which
 * is what keeps the shape honest where it is legal code: inside a function body
 * a call statement followed by a block IS valid C++, and there the enclosing
 * function already owns the reads.
 */
export function macroDeclaredBody(body: Node): {
  heading: Node
  macroName: string
  nameNode: Node
} | null {
  if (!body || body.type !== "compound_statement") return null
  // Step back over the recovery's own separators (the same two siblings the c
  // lane's `wrappedBodyAfter` steps over), then require the heading shape.
  let heading: Node | null = body.previousSibling
  for (let i = 0; heading && i < 2 && (heading.isMissing || heading.type === ";"); i++) {
    heading = heading.previousSibling
  }
  if (!heading || heading.type !== "expression_statement") return null
  let missing = false
  for (let i = 0; i < heading.childCount; i++) {
    const c = heading.child(i)
    if (c && c.isMissing) { missing = true; break }
  }
  if (!missing) return null
  const call = heading.namedChild(0)
  if (!call || call.type !== "call_expression") return null
  const macro = call.childForFieldName("function")
  if (!macro || macro.type !== "identifier") return null
  const macroName = macro.text.trim()
  if (!macroName) return null
  return { heading, macroName, nameNode: macro }
}

/**
 * #919: the text the source WRITES for a macro invocation — from the macro's
 * name to the close of its own top-level paren group.
 *
 * Structural slicing is not enough here, and that is measured, not assumed:
 * where recovery swallows the body (and the next heading) into an argument list,
 * `arguments.endIndex` runs far past the heading — nlohmann's
 * `unit-serialization.cpp` has a `TEST_CASE_TEMPLATE(...)` statement spanning
 * lines 169..186 whose real body is left as a SIBLING at 187, so a slice to the
 * argument list's end publishes the body as the definition's NAME. Matching the
 * paren group instead yields exactly what the source writes:
 * `TEST_CASE_TEMPLATE("serialization for extreme integer values", T, int32_t,
 * uint32_t, int64_t, uint64_t)`.
 *
 * The scan skips string/char literals and comments (either can carry parens),
 * is bounded, and REFUSES (null) when the group never closes, when a `{`/`}`/`;`
 * appears before the opening paren (the invocation is not there at all), or when
 * the cap is hit — a heading that cannot be read is never published damaged.
 */
// Character classes as code-point comparisons, not regexes: the M49.R2 census
// keeps every regex in the analyzers accounted for, and an identifier test is
// not worth an entry (the project's direction is fewer text rules, not more).
function isIdentifierChar(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95
}

/**
 * #919: join a multi-line heading into ONE name without touching in-line
 * spacing. Only a line break (with the horizontal whitespace around it) becomes
 * a single space, so a single-line heading is returned byte-for-byte and a
 * string literal inside it (`TEST_CASE("a  b")`) keeps its own text exactly.
 */
function joinHeadingLines(text: string): string {
  let out = ""
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === "\n") {
      while (out.length > 0 && (out[out.length - 1] === " " || out[out.length - 1] === "\t" || out[out.length - 1] === "\r")) out = out.slice(0, -1)
      out += " "
      i++
      while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\r")) i++
      continue
    }
    out += c
    i++
  }
  return out.trim()
}

/**
 * #924: C++ keywords that name a BUILTIN TYPE. As in the C lane
 * (`C_SPECIFIER_KEYWORDS`), a callee spelled with one of these is a functional
 * cast, never a call: the language has no identifier by that name, so publishing
 * a `calls` edge to it is a fabrication no consumer can resolve. Contextual
 * keywords are deliberately ABSENT — `final`, `override`, `import` and friends
 * are legal identifiers and remain callable.
 */
export const CPP_BUILTIN_TYPE_KEYWORDS: Set<string> = new Set([
  "void", "bool", "char", "char8_t", "char16_t", "char32_t", "wchar_t",
  "short", "int", "long", "float", "double", "signed", "unsigned", "auto",
])

/**
 * D1: EVERY C++ keyword, ISO 14882 [lex.name] through C++23, plus the standard
 * preprocessor operators. #924 enumerated one class of impossible callee — a
 * builtin TYPE keyword, 17 sites over two corpora — and closed it. The full-corpus
 * register then found the class is much larger and the enumeration was the defect,
 * not the fix: **5,496 `calls` edges to keywords** over 1,502 real C++ files,
 * led by `static_cast` (4,812) and `reinterpret_cast` (472), and including
 * `if` (25), `for` (4) and `switch` (6) as CALL TARGETS — a control-flow keyword
 * is not a callee in any language, so those are not a near-miss but a fabrication
 * with no reading at all. Measured per name in
 * `validation/m14/results/cpp-defect-register.json`.
 *
 * The ruling is the C lane's (`C_KEYWORDS`), and it is the same sentence: C++ has
 * no identifier spelled `static_cast`, so a name that is spelled that way names
 * nothing a consumer can resolve, at ANY extraction point — call target, `uses`
 * target, or declared symbol name. One set, three gates, one impossibility.
 *
 * Why the shapes reach here at all: the grammar classifies a cast's operator as
 * an `identifier` callee (`static_cast<int>(x)` is
 * `call_expression[function=template_function[name=identifier(static_cast)]]`),
 * and its ERROR recovery manufactures `call_expression` nodes out of statements
 * whose head is a keyword. The recovery is real; the NAME it yields is not.
 *
 * Contextual keywords are deliberately ABSENT — `final`, `override`, `import`,
 * `concept`(as an identifier is reserved in C++20 but the analyzer's corpora
 * never spell a callable that way), `requires`, `co_await` keep their legal-
 * identifier readings. `operator` is present but only as the EXACT spelling:
 * `operator=`, `operator()` and `operator[]` are ordinary C++ function names and
 * are not in this set, so the analyzer's operator overloads are untouched.
 */
export const CPP_KEYWORDS: Set<string> = new Set([
  // declarations, types, specifiers
  "alignas", "auto", "bool", "char", "char8_t", "char16_t", "char32_t", "class",
  "const", "consteval", "constexpr", "constinit", "decltype", "double", "enum",
  "explicit", "export", "extern", "float", "friend", "inline", "int", "long",
  "mutable", "namespace", "register", "short", "signed", "static", "struct",
  "template", "thread_local", "typedef", "typeid", "typename", "union",
  "unsigned", "using", "virtual", "void", "volatile", "wchar_t",
  // control flow
  "break", "case", "catch", "co_await", "co_return", "co_yield", "continue",
  "default", "do", "else", "for", "goto", "if", "return", "switch", "throw",
  "try", "while",
  // expressions — the CAST family is what #924's type-only set missed
  "const_cast", "delete", "dynamic_cast", "new", "noexcept", "nullptr",
  "reinterpret_cast", "sizeof", "static_assert", "static_cast", "this", "true",
  "false", "operator", "requires", "concept",
  // access
  "private", "protected", "public",
  // alternative tokens (ISO 14882 [lex.digraph], [lex.alternative])
  "and", "and_eq", "bitand", "bitor", "compl", "not", "not_eq", "or", "or_eq",
  "xor", "xor_eq",
  // implementation-reserved spellings and the standard preprocessor operators.
  // None of these is a user-spellable identifier either, and each was measured
  // producing an edge on the corpora (`defined` 34, `__has_include` 42,
  // `__has_cpp_attribute` 6).
  "defined", "__has_include", "__has_cpp_attribute", "asm", "__asm", "__asm__",
  "__declspec", "__attribute__", "__attribute", "__inline", "__inline__",
  "__forceinline", "__restrict", "__restrict__", "__extension__", "__typeof__",
  "__typeof", "__cdecl", "__stdcall", "__thiscall", "__vectorcall", "__int8",
  "__int16", "__int32", "__int64", "__forceinline__", "__declspec__",
  "__builtin_offsetof", "__builtin_va_arg", "__builtin_types_compatible_p",
  "__func__", "__FUNCTION__", "__PRETTY_FUNCTION__",
])

/**
 * D1 (second gate position): is this text a name C++ can spell?
 *
 * Exported because the F5 oracle must answer the SAME question with the SAME set
 * — #916's lesson (leaving truth behind converts a recovery into a fabrication).
 * Kept as a function rather than inlined at the three call sites so the
 * membership test and its justification live in one place.
 */
export function isCppSpelledName(text: string | null | undefined): boolean {
  if (!text) return false
  return !CPP_KEYWORDS.has(text)
}

/**
 * D4: the name the SOURCE writes for a declarator whose `declarator` field the
 * grammar's ERROR recovery displaced — or `null` when the field cannot be read
 * at all, which means nothing is published.
 *
 * A macro access-specifier label is legal C++ and has no node type:
 *
 *   JSON_PRIVATE_UNLESS_TESTED:              <- nlohmann/json.hpp:36
 *     /// iterator as signed integer type
 *     difference_type m_it = (…min)();       <- the REAL declaration
 *
 * The grammar reads the label as a `type`, so the declarator field lands on the
 * TYPE, and the real name is pushed into an adjacent ERROR:
 *
 *   field_declaration [ERR] [type=type_identifier(LABEL), ERROR(":"), comment,
 *                        declarator=field_identifier(difference_type),
 *                        ERROR(identifier(m_it)), "=", init, ";"]
 *
 * The analyzer read the declarator field faithfully and published a `property`
 * named `difference_type` — a name that is a TYPE, colliding with the real
 * `using difference_type = std::ptrdiff_t;` alias in the same class (which is
 * what produced a duplicate `contains` edge), while the declaration that
 * actually exists, `m_it`, was absent from the graph entirely. 10 sites over
 * 1,722 real C++ files; 5 of them are this exact shape with a real, recoverable
 * name.
 *
 * The ruling is that the recovery record is EVIDENCE, not noise. A declarator
 * immediately followed by an ERROR that holds exactly one bare identifier, at a
 * later offset, is the grammar's own account of where the name went. Two
 * deliberate narrownesses keep it from becoming a guess:
 *
 *   - the ERROR must hold EXACTLY ONE named child, and it must be a bare
 *     `identifier` — an expression, a member access or a nested declarator is
 *     soup, and a name is not read out of soup;
 *   - the recovered name must still be a name C++ can spell (`isCppSpelledName`),
 *     which disposes of the `>::value, int >::type = 0 >` template-soup sites
 *     whose ERROR holds `int`.
 *
 * When there is no such identifier the declarator names nothing, and `null` here
 * means the caller publishes no symbol — the C-family CGD19 rule, applied where
 * the grammar has told us outright that it does not know.
 *
 * Exported for the F5 oracle, for #916's reason.
 *
 * The node passed in is the DECLARATION (`field_declaration` / `declaration`);
 * the rule reads the `declarator` field off it and looks at THAT node's
 * siblings, because the displaced name sits beside the declarator inside the
 * declaration — not beside the declaration itself.
 */
export function recoveredDeclaredName(declNode: Node): Node | null {
  if (!declNode.hasError) return null
  const declared: Node | null = declNode.childForFieldName?.("declarator") ?? null
  if (!declared) return null
  let next: Node | null = declared.nextSibling
  // Step over the separators the recovery leaves between the two.
  while (next && (next.isMissing || !next.isNamed)) next = next.nextSibling
  if (!next || next.type !== "ERROR" || next.namedChildCount !== 1) return null
  const inner: Node | null = next.namedChild(0)
  if (!inner || inner.type !== "identifier") return null
  if (inner.startIndex <= declared.startIndex) return null
  if (!isCppSpelledName(inner.text)) return null
  return inner
}

/**
 * D7, arm A: the declared name of a `class`/`struct`/`union` specifier, read from
 * the grammar's `name` FIELD rather than from a direct `type_identifier` child.
 *
 * `findChild(node, "type_identifier")` is a DIRECT-child scan, so a name the
 * grammar hands over as a `qualified_identifier` was invisible to it and the class
 * published as `anonymous` — the analyzer's deliberate no-name sentinel, so the
 * row was not merely wrong but ambiguous with the sentinel. Measured 26 sites over
 * 1,722 real C++ files, all of the same legal C++ shape:
 *
 *   template <>
 *   struct fmt::formatter<explicitly_convertible_to_std_string_view>
 *       : formatter<std::string_view> { auto format(…) const; };
 *   //  -> class "anonymous" + method format owner=anonymous
 *   //     while three sibling `formatter` classes publish correctly
 *
 * A `class_specifier` DOES have a qualified name — an explicit specialization names
 * the template it specializes — so the rule is the CPPD1 leaf: the last `::`
 * segment, which is `formatter`. This is the same problem CPPD1's existing
 * `template_type` fallback was written for; a `qualified_identifier` is that
 * problem arriving by a different route, and the two now share one descent.
 *
 * Returns null when nothing legible is there, so the caller can refuse rather than
 * invent. Exported for the F5 oracle (#916's reason).
 */
export function specifierDeclaredName(spec: Node): string | null {
  const leafOf = (n: Node | null, depth = 0): string | null => {
    if (!n || depth > 8) return null
    if (n.type === "type_identifier" || n.type === "identifier") {
      return isCppSpelledName(n.text) ? n.text : null
    }
    if (n.type === "template_type") {
      const tn: Node | null = n.childForFieldName?.("name") ?? null
      if (tn) return leafOf(tn, depth + 1)
      const lt = n.text.indexOf("<")
      return lt > 0 ? n.text.slice(0, lt).trim() : null
    }
    if (n.type === "qualified_identifier") {
      // right-leaning: qualified_identifier[ns X, ::, qualified_identifier[…, type_identifier]]
      return leafOf(n.namedChild(n.namedChildCount - 1), depth + 1)
    }
    return null
  }
  const nameField: Node | null = spec.childForFieldName?.("name") ?? null
  if (nameField) {
    if (nameField.type === "type_identifier" || nameField.type === "identifier") {
      return isCppSpelledName(nameField.text) ? nameField.text : null
    }
    if (nameField.type === "qualified_identifier" || nameField.type === "template_type") {
      return leafOf(nameField)
    }
  }
  return null
}

/**
 * D7, arm B: the declared name of an `enum` whose `name` field holds a C++23
 * attribute instead — `enum class [[=fmt::as_identifiers]] color { … }`.
 *
 * **An `enum_specifier` has no qualified name in C++.** `enum class ns::E` is not
 * valid C++; you write `namespace ns { enum class E; }`. So a `::`-qualified path
 * sitting in an enum's `name` slot is the grammar's account of something else, and
 * the measurement says what: 22 sites over 1,722 real C++ files, every one of them
 * this attribute, and every one of them published as `anonymous` while the real
 * name was pushed into the enclosing declaration:
 *
 *   declaration [ERR] [type=enum_specifier declarator=init_declarator]
 *     enum_specifier [ERR] [name=qualified_identifier] "enum class [[=fmt::as_identifiers"
 *       ERROR [ERR] "[[="
 *       qualified_identifier "fmt::as_identifiers"     <- the ATTRIBUTE, in the name slot
 *     ERROR [ERR] "]]"
 *     init_declarator [declarator=identifier value=initializer_list] "color { … }"
 *       identifier "color"                              <- the REAL declared name
 *
 * The rule is deliberately narrow, because the alternative is a guess: the name
 * field must be a `qualified_identifier` (the disqualifying evidence), the parent
 * must be a declaration, and the declaration's declarator must be an
 * `init_declarator` whose own declarator is a bare `identifier`. Anything less and
 * the answer is null, and the caller publishes no name rather than the attribute's.
 *
 * The same identifier is the reason the declaration branch must NOT also publish it
 * as a `variable`: the recovery displaced the enum's name, and publishing it twice
 * is how `fmt/test/enum-test.cc:24` ended up with both `variable "color"` and
 * `enum "anonymous"`. Exported for the F5 oracle.
 */
export function attributeDisplacedEnumName(enumSpec: Node): string | null {
  // The discriminator is NOT the spelling of the attribute — it is where the
  // declaration put the real name. Both attribute spellings were measured and they
  // reach the analyzer differently:
  //
  //   [[=fmt::as_identifiers]]  -> name field = qualified_identifier("fmt::as_identifiers")
  //   [[=as_identifiers]]       -> name field = type_identifier("as_identifiers")
  //
  // so a test on the name field's TYPE catches one and misses the other — and the
  // first cut of this fix did exactly that, publishing `enum as_identifiers` while
  // the real name `color` went out as a phantom variable. What both shapes share is
  // that the grammar could not place the enum and read the rest of the declaration
  // as a brace-initialized VARIABLE: the real name is a bare `identifier` in the
  // enclosing declaration's `init_declarator`, starting after the enum's own end.
  // That is the evidence, and it is what the rule reads.
  //
  // The narrowness is what keeps it from being a guess: the parent must be a
  // declaration, the declarator must be an `init_declarator`, its declarator must be
  // a bare `identifier`, and that identifier must start after the enum node ends. A
  // well-placed `enum class E : int { … };` is an `enum_specifier` in statement
  // position with no enclosing declaration, so it cannot match.
  const decl: Node | null = enumSpec.parent ?? null
  if (!decl || (decl.type !== "declaration" && decl.type !== "field_declaration")) return null
  const outer: Node | null = decl.childForFieldName?.("declarator") ?? null
  if (!outer || outer.type !== "init_declarator") return null
  const id: Node | null = outer.childForFieldName?.("declarator") ?? null
  if (!id || id.type !== "identifier") return null
  if (id.startIndex <= enumSpec.endIndex) return null
  return isCppSpelledName(id.text) ? id.text : null
}

/**
 * #924: the NAME and the OWNER of a `qualified_identifier` standing as a
 * declarator's own name. The grammar splits two very different shapes into the
 * SAME node, and the separator token is what tells them apart:
 *
 *   `void MyClass::method(int)`
 *     qid[ns MyClass, `::`, identifier method]                  REAL join
 *   `FMT_API std::system_error vwindows_error(int)`
 *     qid[ns std, `::`, qid[ns system_error, ``, identifier vwindows_error]]
 *                                                      PHANTOM join ("")
 *
 * With a macro standing before the return type, the grammar cannot place the
 * type and rejoins it to the name as extra qualifier segments — separated by
 * whitespace only, which is why the qid's separator slot carries a `::` token
 * with EMPTY text. A real scope join always carries the token itself.
 *
 * Reading the outer qid's last segment as the name (the old rule) published
 * `system_error vwindows_error` — a name no consumer can resolve — and read
 * `system_error` as the owning SCOPE, putting the function in a class that
 * does not exist. 33 such names across the two pinned cpp corpora, plus 5
 * genuine qualified declarators (`SocketWriter::MakeConnection`) whose name
 * kept its owner inline.
 *
 * The rule is exported so the F5 oracle reads the SAME evidence rather than a
 * copy of it (#916's lesson; see `macroDeclaredBody`).
 */
export function qualifiedDeclaratorLeaf(qid: Node): { nameNode: Node; scopeQid: Node | null } | null {
  // Nested qualification nests RIGHT-leaning (qid[ns Outer, qid[ns Inner, m]]),
  // so the name leaf is the last named child of the DEEPEST qid.
  let leaf: Node = qid
  while (true) {
    const last = leaf.namedChild(leaf.namedChildCount - 1)
    if (last && last.type === "qualified_identifier") leaf = last
    else break
  }
  const nameNode = leaf.namedChild(leaf.namedChildCount - 1)
  if (!nameNode) return null
  // A qualifier is a real OWNER only when the token joining it to the name
  // exists. The phantom join is the grammar's own record of the misplaced type.
  let realJoin = false
  for (let i = 0; i < leaf.childCount; i++) {
    const c = leaf.child(i)
    if (c && !c.isNamed && c.type === "::") {
      realJoin = c.text === "::"
      break
    }
  }
  return { nameNode, scopeQid: realJoin ? leaf : null }
}

/**
 * CPPD15 (#612 family round): a TEMPLATE WRAPPER does not change WHOSE
 * declarator name this is. In an explicit specialization the declared name is
 * wrapped in `template_function`, so the identifier's own parent is not a
 * declarator at all:
 *
 *   template <> constexpr auto num_bits<native_int128>() -> int { … }
 *   // identifier(num_bits) < template_function < function_declarator
 *
 * and the leftmost-declarator rule therefore read the DECLARED name as a value
 * read. That is the shape that minted the false `uses num_bits` on BOTH sides
 * of the fmt lane — the two sides agreed on a wrong answer, which is why no
 * fixture, mutant or depth draw ever caught it: the analyzer emitted the read
 * and the oracle derived the same read, so they cancelled out of every count.
 * Measured at the fmt full extent: 7 covered reads (fmt format.h `num_bits`/
 * `digits10`, printf.h `find`, gtest.h `GenerateNamesRecursively`, one-arg.cc
 * `from_repr`, fuzzer-common.h `assign_from_buf`, format-impl-test.cc
 * `run_double_tests`) existed ONLY because a specialization's own name was read
 * as a use. The declared entity is not a use of itself (the general rule this
 * mirrors, `Node` declared before an initializer is a declaration), so the name
 * is a DECLARATION POSITION — on both sides.
 *
 * Deliberately narrow: only the NAME of a template-wrapped declarator — not
 * every identifier under a declarator's surface, which would kill real reads
 * such as an array-size argument (`char buffer[num_bits<UInt>()]` is a CALL, so
 * its callee leaf belongs to the calls branch, and
 * `Sha1ToString(const uint8_t Sha1[kSHA1NumBytes])` is a genuine oracle-derived
 * read of a file-scope constant). The template wrapper's span must BE the
 * declarator's name span, which is what distinguishes
 * `template_function < function_declarator` (the declared name) from a
 * `template_function` anywhere else in an expression.
 *
 * Exported so the F5 oracle classifies it with the SAME rule rather than a copy
 * (#916's lesson; see `macroDeclaredBody`).
 */
export function templateWrappedDeclaratorName(nameNode: Node): boolean {
  const p = nameNode.parent
  if (!p) return false
  if (p.type !== "template_function" && p.type !== "template_method" && p.type !== "dependent_name") return false
  const gp = p.parent
  if (!gp || (gp.type !== "function_declarator" && gp.type !== "abstract_function_declarator")) return false
  // The span compared is the WRAPPER's: a function declarator's `declarator`
  // field IS the template_function (`num_bits<native_int128>`), while this node
  // is the identifier inside it.
  const decl = gp.childForFieldName?.("declarator")
  return !!decl && decl.startIndex === p.startIndex && decl.endIndex === p.endIndex
}

export function macroInvocationText(content: string, nameStart: number): string | null {
  const CAP = 4000
  let i = nameStart
  while (i < content.length && isIdentifierChar(content.charCodeAt(i))) i++
  const end = Math.min(content.length, i + CAP)
  let open = -1
  while (i < end) {
    const c = content[i]
    if (c === "(") { open = i; break }
    if (c === "/" && content[i + 1] === "/") { const nl = content.indexOf("\n", i); if (nl < 0) return null; i = nl + 1; continue }
    if (c === "/" && content[i + 1] === "*") { const cl = content.indexOf("*/", i); if (cl < 0) return null; i = cl + 2; continue }
    if (c === "{" || c === "}" || c === ";") return null
    i++
  }
  if (open < 0) return null
  let depth = 0
  for (let k = open; k < end; k++) {
    const c = content[k]
    if (c === '"' || c === "'") {
      k++
      while (k < end) {
        if (content[k] === "\\") { k += 2; continue }
        if (content[k] === c) break
        k++
      }
      continue
    }
    if (c === "/" && content[k + 1] === "/") { const nl = content.indexOf("\n", k); if (nl < 0) return null; k = nl; continue }
    if (c === "/" && content[k + 1] === "*") { const cl = content.indexOf("*/", k); if (cl < 0) return null; k = cl + 1; continue }
    if (c === "(") depth++
    else if (c === ")") {
      depth--
      if (depth === 0) {
        // LINE JOINS ONLY: a heading written across several lines becomes one
        // name (`TEST_CASE_TEMPLATE("checking forward-iterators", T, // NOLINT(…)\n
        // std::string, …)`), while a single-line heading stays verbatim —
        // in-line spacing is preserved, so a literal inside the heading
        // (`TEST_CASE("a  b")`) keeps its own text exactly.
        const text = joinHeadingLines(content.slice(nameStart, k + 1))
        return text || null
      }
    }
  }
  return null
}

export class RealCppAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const patterns: Record<string, boolean> = {}
    const frameworks: Record<string, boolean> = {}
    let memorySafetyScore = 100

    // PER-FILE state - the old version stored registries on `this`, which
    // LEAKED ACROSS FILES when analyzer instances are reused by parallel
    // indexing: identical source in a later file lost its Uses edges
    // entirely (proven by probe), and virtual registries contaminated
    // unrelated files.
    const usesSeen = new Set<string>()
    // D3: the same set discipline for `references`. An `#include` is a
    // compile-time DEPENDENCY, and a file that writes `#include <vector>` six
    // times depends on `vector` once — six identical `global -> vector` rows
    // were 87 excess rows over 554 real C++ files (the top pairs:
    // `global algorithm` x6, `global cstdint` x6, `global string` x6). The
    // `imports` ARRAY keeps every occurrence, because a consumer counting
    // include directives wants the count; the GRAPH keeps the dependency, which
    // is what an edge means. Same split the family makes for `uses`.
    const referencesSeen = new Set<string>()
    let fileDecisions = 0
    const classVirtuals = new Map<string, Map<string, string[]>>()
    const pendingOverrides: Array<{ cls: string; method: string; params: string; line?: number }> = []
    const classBases = new Map<string, string[]>()

    // CP1 (cpp review) bare-read resolution sets. C++ has no runtime —
    // every bare `identifier` that names a file-visible VALUE is a Uses
    // edge (the analyzer previously emitted none at all: `return g;`
    // produced zero edges). Bounded like the C family: ownerless
    // file-scope Variable/Function/EnumMember/Constant, namespace members
    // (visible inside their namespace or via using-directives), class
    // members (visible inside member functions), and file-scope
    // using-declarations. Qualified reads (ns::x), types, and anything
    // locally bound stay silent — recorded limitations, not fabrications.
    const fileScopeValues = new Set<string>()
    const namespaceValues = new Map<string, Set<string>>()
    const classMembers = new Map<string, Set<string>>()
    const usedNamespaces = new Set<string>()
    // Out-of-line definitions (`void Foo::bar() {}`) resolve their scope
    // AFTER the walk: class scope -> member, known namespace -> namespaced
    // value, unknown (header-defined) scope -> file-visible value.
    const pendingQualified: Array<{ name: string; scope: string }> = []
    {
      const pre: Array<{ n: Node; ns: string[]; inFn: boolean; inClass: string | null }> = [
        { n: rootNode, ns: [], inFn: false, inClass: null },
      ]
      const addValue = (name: string, ns: string[], cls: string | null): void => {
        // D1, ROSTER GATE. This is the single funnel for every name the bare-read
        // resolver (`isResolvableRead`) can resolve — file scope, namespace
        // members and class members all land here, and `isResolvableRead` reads
        // only these three maps. A keyword that entered the roster would turn
        // every read of it into a `uses` edge (measured: `uses -> void`, 5
        // sites). A keyword names no value, so it never enters.
        if (!isCppSpelledName(name)) return
        if (!name) return
        if (cls) {
          let s = classMembers.get(cls)
          if (!s) { s = new Set(); classMembers.set(cls, s) }
          s.add(name)
          return
        }
        if (ns.length > 0) {
          const top = ns[ns.length - 1]
          let s = namespaceValues.get(top)
          if (!s) { s = new Set(); namespaceValues.set(top, s) }
          s.add(name)
          return
        }
        fileScopeValues.add(name)
      }
      const leftmostId = (n: Node | null): string | null => {
        let cur = n
        while (cur) {
          // D1: same impossibility as `addValue` — this walk is the pre-pass's
          // own declarator read, and a keyword terminator is a macro or a
          // damaged region, never the leftmost declarator of a real binding.
          if (cur.type === "identifier" || cur.type === "field_identifier") {
            return isCppSpelledName(cur.text) ? cur.text : null
          }
          cur = cur.childForFieldName("declarator") || cur.namedChild(0)
        }
        return null
      }
      while (pre.length > 0) {
        const { n, ns, inFn, inClass } = pre.pop()!
        const t = n.type
        if (t === "namespace_definition") {
          const nm = this.childText(n, "namespace_identifier")
          if (nm && nm !== "anonymous") {
            for (let i = n.namedChildCount - 1; i >= 0; i--) {
              const c = n.namedChild(i)
              if (c) pre.push({ n: c, ns: [...ns, nm], inFn, inClass })
            }
            continue
          }
        } else if (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier") {
          // CPPD1 parity (main walk + oracle): explicit/partial
          // specialization names live in template_type
          // (`FlatTupleElemBase<T, I>`), not a bare type_identifier.
          // Without the fallback the members misattribute to the enclosing
          // namespace/file scope (fmt differential: oracle-only file-scope
          // Matcher + swapped generator member sets).
          const nm =
            this.childText(n, "type_identifier") ||
            (() => {
              const tt = this.findChild(n, "template_type")
              if (!tt) return null
              const tn =
                tt.childForFieldName?.("name") ||
                this.findChild(tt, "type_identifier") ||
                this.findChild(tt, "qualified_identifier")
              if (tn?.text) return tn.text
              const lt = tt.text.indexOf("<")
              return lt > 0 ? tt.text.slice(0, lt).trim() : null
            })()
          const body = this.findChild(n, "class_body") || this.findChild(n, "field_declaration_list")
          if (nm && body) {
            for (let i = n.namedChildCount - 1; i >= 0; i--) {
              const c = n.namedChild(i)
              if (c) pre.push({ n: c, ns, inFn, inClass: nm })
            }
            continue
          }
        } else if (t === "function_definition") {
          // The defined name is a file-visible VALUE (callbacks read as
          // values); out-of-line `Foo::bar` defines a MEMBER of Foo.
          // CP2: macro-function shapes (`TEST(a, b) {...}`) define no real
          // function — their names must not enter resolution (else the
          // ERROR-recovered fragments of sibling macro sites read as uses).
          const det = this.getFunctionDetails(n)
          if (det && !det.isDestructor && !det.name.startsWith("operator") && !this.isMacroFunctionShape(n, det.name)) {
            // D5, ROSTER: a CONSTRUCTOR is not a callable value. `Handle(int)`
            // defines a name that spells the class, and C++ never lets you call
            // it unqualified — you write `Handle h(1)`, which is a construction,
            // not a call. The roster here is the resolution source for bare
            // reads, so admitting the constructor made the class name itself
            // resolvable as a value: `Handle parent_handle(7);` published
            // `uses Handle -> Handle` at confidence 1.0, an edge asserting that
            // the class reads itself. The test is the name against the class it
            // is declared in, which is exactly what a constructor is.
            const isCtor = (inClass !== null && det.name === inClass) || (det.scope !== undefined && det.name === det.scope)
            if (!isCtor) {
              if (det.scope) pendingQualified.push({ name: det.name, scope: det.scope })
              else if (!inFn) addValue(det.name, ns, inClass)
            }
          }
          for (let i = n.namedChildCount - 1; i >= 0; i--) {
            const c = n.namedChild(i)
            if (c) pre.push({ n: c, ns, inFn: true, inClass })
          }
          continue
        } else if (t === "compound_statement" && macroDeclaredBody(n)) {
          // #919: a macro-declared body is a FUNCTION body (the analyzed
          // sibling of the `function_definition` branch above). Every
          // declaration inside it is function-local (execution artifact), so
          // the file-scope value roster must not learn its locals — that
          // roster is what resolved the phantom `uses -> j`/`it` edges in
          // nlohmann-json's tests and made the analyzer and truth agree on a
          // wrong answer. Mirrored on the oracle side from the same rule.
          for (let i = n.namedChildCount - 1; i >= 0; i--) {
            const c = n.namedChild(i)
            if (c) pre.push({ n: c, ns, inFn: true, inClass })
          }
          continue
        } else if (!inFn && (t === "declaration" || t === "field_declaration")) {
          // File/namespace/class-scope value bindings (init_declarator
          // leftmost + bare declarators). Function prototypes contribute
          // their NAME (a callable value); their PARAMETERS never do (HC6
          // class: prototype params are not file-scope declarations).
          // CP6: a file-scope structured binding (`auto [x, y] = p;`)
          // declares EVERY name (the leftmost rule would register x only).
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c) continue
            if (c.type === "init_declarator" && c.namedChild(0)?.type === "structured_binding_declarator") {
              const sb = c.namedChild(0)!
              for (let k = 0; k < sb.namedChildCount; k++) {
                const b = sb.namedChild(k)
                if (b && (b.type === "identifier" || b.type === "field_identifier")) addValue(b.text, ns, inClass)
              }
            } else if (c.type === "init_declarator" || c.type === "identifier" || c.type === "field_identifier" ||
                c.type === "pointer_declarator" || c.type === "reference_declarator" || c.type === "array_declarator") {
              const nm = leftmostId(c)
              if (nm) addValue(nm, ns, inClass)
            } else if (c.type === "function_declarator") {
              const nm = leftmostId(c)
              if (nm) addValue(nm, ns, inClass)
            }
          }
        } else if (!inFn && t === "enumerator") {
          const nm = this.childText(n, "identifier")
          // Enum members are global constants (C parity) — visible anywhere.
          // Routed through `addValue` so the D1 roster gate applies to this path
          // too (an enumerator cannot be spelled with a keyword, so one that is
          // is recovery, and a keyword in the roster fabricates `uses` edges).
          if (nm) addValue(nm, [], null)
        } else if (t === "using_declaration" && !inFn && !inClass) {
          const txt = n.text
          if (txt.indexOf("using namespace") !== -1) {
            const tgt = this.findChild(n, "qualified_identifier") || this.findChild(n, "identifier")
            if (tgt) usedNamespaces.add(tgt.text.split("::").filter(Boolean).join("::"))
          } else {
            const leaf = this.findChild(n, "qualified_identifier") || this.findChild(n, "identifier")
            if (leaf) {
              const segs = leaf.text.split("::").filter(Boolean)
              if (segs.length > 0) addValue(segs[segs.length - 1], [], null)
            }
          }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) pre.push({ n: c, ns, inFn, inClass })
        }
      }
      // Flush out-of-line scopes now that every class/namespace is known.
      for (const q of pendingQualified) {
        if (classMembers.has(q.scope)) addValue(q.name, [], q.scope)
        else if (namespaceValues.has(q.scope)) addValue(q.name, [q.scope], null)
        else addValue(q.name, [], null)
      }
    }

    interface Scope {
      node: Node
      name: string
      kind: ASTEngine.SymbolKind
      visibility: "public" | "private" | "protected"
      isTemplate: boolean
      isAbstract: boolean
      symbolRef?: ASTEngine.UniversalSymbol
      friends?: string[]
      // CP1 (cpp review): names bound by this function scope (parameters at
      // entry + local declaration bindings in walk order) — a shadowing local
      // suppresses the file/member read. Flow-sensitive like the C family:
      // reads before any binding still resolve outward.
      locals?: Set<string>
      // CP5 (second review): the owning class of an OUT-OF-LINE definition
      // (`void Foo::bar() {}` pushes a Method scope named `bar`, so the
      // Class entry that inline methods resolve through is absent and bare
      // member reads stayed silent on both sides). Set from the definition's
      // explicit scope; looked up in classMembers with the same key the
      // pre-pass flush uses (exact match — nested `A::B::m` scopes stay a
      // documented limitation, same as the flush).
      classScope?: string
    }

    const scopeStack: Scope[] = []

    interface StackItem {
      node: Node
      parentContext?: Scope
      isExit?: boolean
    }

    const stack: StackItem[] = [{ node: rootNode }]

    // CP1 helpers (bare-read discipline). All name-level; mirrors the C
    // family's CGD-gates where they exist, documented where C++ differs.
    const DECL_PARENT_TYPES = new Set([
      "declaration", "field_declaration", "parameter_declaration",
      "init_declarator", "function_declarator", "pointer_declarator",
      "reference_declarator", "array_declarator", "abstract_pointer_declarator",
      "abstract_array_declarator", "abstract_function_declarator",
      "enumerator", "using_declaration", "alias_declaration",
      "optional_parameter_declaration", "type_parameter_declaration",
      // CP6 (second review): `auto [x, y]` bindings declare (see the
      // carve-out in isDeclarationPosition — all names, not first-only).
      "structured_binding_declarator",
      // F6 audit: `template_type_parameter` / `template_value_parameter` are
      // NOT types in the pinned tree-sitter-cpp grammar — template parameters
      // parse as `type_parameter_declaration` (`typename T` / `class T`) and
      // `parameter_declaration` / `optional_parameter_declaration`
      // (`int N`, `int N = M`), all live in this set above. Removed.
    ])
    // Leftmost-identifier declarator walk (C isDeclaringChainLeftmost
    // contract): `int x = g;` declares x, reads g.
    const isDeclaringChainLeftmost = (node: Node): boolean => {
      const p = node.parent
      if (!p || !p.type.endsWith("declarator")) return false
      let cur: Node | null = p
      while (cur) {
        if (cur.type === "identifier" || cur.type === "field_identifier") {
          return cur.startIndex === node.startIndex
        }
        let next: Node | null = null
        for (let k = 0; k < cur.namedChildCount; k++) {
          const c = cur.namedChild(k)
          if (c && (c.type.endsWith("declarator") || c.type === "identifier" || c.type === "field_identifier")) {
            next = c
            break
          }
        }
        cur = next
      }
      return false
    }
    const isDeclarationPosition = (node: Node): boolean => {
      const p = node.parent
      if (!p) return false
      // CPPD15/CPPD16: a template wrapper does not change WHOSE declarator name
      // this is — see `templateWrappedDeclaratorName` (exported: the F5 oracle
      // reads the same rule). Two shapes, one rule: nlohmann's ERROR-recovered
      // `push_back(typename object_t::value_type(std::move(key.get_ref<string_t&>()), …));`
      // parses as a declaration whose parameter carries
      // `key.get_ref<string_t&>()` as a function_declarator (so `get_ref` NAMES a
      // declared function), and fmt's explicit specializations carry the defined
      // entity's own name inside the same wrapper
      // (`template <> auto num_bits<native_int128>() -> int`).
      if (templateWrappedDeclaratorName(node)) return true
      // Template value-parameter defaults: only the FIRST identifier child
      // declares (`template <int N = M>`: N declares, M reads).
      // F6 audit: only the real template-parameter nodes belong here. The
      // former `template_type_parameter` / `template_value_parameter` names
      // never occur in the pinned grammar; `parameter_declaration` (bare
      // `int N`) is deliberately NOT listed — its single identifier needs no
      // first-only rule, and `optional_parameter_declaration` (`int N = M`)
      // gives N-declares / M-reads via the first-identifier rule below.
      if (p.type === "optional_parameter_declaration" || p.type === "type_parameter_declaration") {
        for (let k = 0; k < p.namedChildCount; k++) {
          const c = p.namedChild(k)
          if (c && (c.type === "identifier" || c.type === "field_identifier")) {
            return c.startIndex === node.startIndex
          }
        }
        return false
      }
      // CP8 (second review): member/EnUM declarator segments. A
      // field_declaration or enumerator with a bare identifier value
      // (`int x = LIMIT;`, `A = LIMIT`) has NO init_declarator wrapper —
      // the whole declarator is flat, so the generic rule below treated
      // the VALUE as declaring and the read stayed silent on both sides.
      // Segment rule over ALL children (anonymous `,`/`;` split segments;
      // `=`/`:`/`{` switch a segment from declaring to reading): the first
      // identifier-ish child of a fresh segment declares, the rest read.
      // `int x = G, y = 2` → x declares, G reads, y declares. Multi-name
      // `int x, y;` still declares both (one segment each). Residual: two
      // declarators sharing one flat segment cannot occur (a comma always
      // splits), so the rule is exact for this grammar.
      if (p.type === "field_declaration" || p.type === "enumerator") {
        let fresh = true
        let foundFirst = false
        for (let k = 0; k < p.childCount; k++) {
          const c = p.child(k)
          if (!c) continue
          if (!c.isNamed) {
            if (c.type === "," || c.type === ";") { fresh = true; foundFirst = false }
            else if (c.type === "=" || c.type === ":" || c.type === "{") fresh = false
            continue
          }
          if (c.type === "identifier" || c.type === "field_identifier") {
            if (!foundFirst && fresh) {
              if (c.startIndex === node.startIndex && c.endIndex === node.endIndex) return true
              foundFirst = true
            } else {
              if (c.startIndex === node.startIndex && c.endIndex === node.endIndex) return false
            }
          }
        }
        return false
      }
      if (!DECL_PARENT_TYPES.has(p.type)) return false
      // CP6 (second review): structured bindings declare EVERY name
      // (`auto [x, y] = p` binds x AND y — not first-only). The initializer
      // is a SIBLING under init_declarator (or the range under
      // for_range_loop), never under this node, so a blanket true is exact.
      // Must precede the endsWith-declarator branch below: that rule is
      // first-only and would bind x while leaking y as a read.
      if (p.type === "structured_binding_declarator") return true
      if (p.type.endsWith("declarator") || p.type === "init_declarator") {
        return isDeclaringChainLeftmost(node)
      }
      return true
    }
    // Directive text (CGD11 contract): identifiers under preproc_* with no
    // code container between are textual (`#ifdef FEAT`), never reads.
    // Macro bodies (preproc_arg blob) are likewise never walked as code.
    const isPreprocText = (node: Node): boolean => {
      let cur: Node | null = node.parent
      while (cur) {
        const t: string = cur.type
        if (t.includes("statement") || t.includes("declaration") || t.includes("declarator") ||
            t.includes("specifier") || t.includes("enumerator") || t.includes("compound") ||
            t.includes("argument_list") || t.includes("init") || t.includes("expression") ||
            t.includes("function_definition") || t.includes("class_body") || t.includes("field_declaration_list")) return false
        if (t.startsWith("preproc_")) return true
        cur = cur.parent
      }
      return false
    }
    const hasFriendAncestor = (node: Node): boolean => {
      let cur: Node | null = node.parent
      while (cur) {
        if (cur.type === "friend_declaration") return true
        cur = cur.parent
      }
      return false
    }
    // Qualified reads (`ns::x`, `Foo::y`) resolve through scopes the
    // single-TU graph cannot see — recorded limitation, stays silent.
    const hasQualifiedAncestor = (node: Node): boolean => {
      let cur: Node | null = node.parent
      while (cur) {
        const t: string = cur.type
        if (t === "qualified_identifier") return true
        if (t.includes("statement") || t.includes("declaration") || t.includes("declarator") ||
            t.includes("expression") || t.includes("function_definition") || t.includes("field_declaration_list") ||
            t.includes("class_body") || t.includes("argument_list")) return false
        cur = cur.parent
      }
      return false
    }
    // Attribute names (`[[maybe_unused]]`) never name values.
    const hasAttributeAncestor = (node: Node): boolean => {
      let cur: Node | null = node.parent
      while (cur) {
        const t: string = cur.type
        if (t === "attribute" || t === "attribute_declaration" || t === "attribute_specifier") return true
        if (t.includes("statement") || t.includes("declaration") || t.includes("function_definition") ||
            t.includes("expression") || t.includes("class_body")) return false
        cur = cur.parent
      }
      return false
    }
    // CP1 callee climb: the callee of a call is a call, never a use —
    // including through template wrappers (`f<T>()`), dependent names
    // (`x.template m<T>()`) and defense parentheses (`(f)(x)`, the Windows
    // min/max idiom the calls branch already unwraps). Without the climb,
    // every explicit-template call emitted calls+uses for one target.
    // CPPD14: the span of a member leaf, seen THROUGH template wrappers.
    // `key.get_ref<string_t&>()` parses as identifier(get_ref) < template_function
    // < field_expression < call_expression, so the member-leaf guard (which tests
    // the identifier's own parent for the field role) missed it and the identifier
    // was published as a bare value read — `uses push_back -> get_ref`, an edge the
    // oracle does not derive and the analyzer only hid before behind an accidental
    // local binding. The calls branch does not own the site either (the callee is a
    // field_expression, so isCallCallee stops short and the oracle derives no call),
    // so the oracle-consistent outcome is silence: the member leaf is owned by the
    // field path, and a template argument list does not change whose leaf it is.
    const memberLeafTop = (node: Node): Node => {
      let top: Node = node
      let p: Node | null = node.parent
      while (p && (p.type === "template_function" || p.type === "template_method" || p.type === "dependent_name")) {
        top = p
        p = p.parent
      }
      return top
    }
    const isMemberLeaf = (node: Node): boolean => {
      const top = memberLeafTop(node)
      const p = top.parent
      if (!p || p.type !== "field_expression") return false
      const field = p.childForFieldName("field")
      return !!field && field.startIndex === top.startIndex
    }
    const isCallCallee = (node: Node): boolean => {
      let top: Node = node
      let p: Node | null = node.parent
      while (p && (p.type === "template_function" || p.type === "template_method" ||
          p.type === "dependent_name" || p.type === "parenthesized_expression")) {
        top = p
        p = p.parent
      }
      if (!p || p.type !== "call_expression") return false
      const fnField = p.childForFieldName("function")
      if (fnField) return fnField.startIndex === top.startIndex && fnField.endIndex >= top.endIndex
      const first = p.namedChild(0)
      return !!first && first.startIndex === top.startIndex && first.endIndex >= top.endIndex
    }
    // CP1: is this the defined FUNCTION's own declarator name (not a
    // parameter)? It declares the entity, never a local — binding it
    // would self-shadow same-named overload reads (oracle parity).
    const isFunctionOwnName = (node: Node): boolean => {
      let up: Node | null = node.parent
      while (up) {
        if (up.type === "parameter_list" || up.type === "parameter_declaration") return false
        if (up.type === "function_declarator" && up.parent && up.parent.type === "function_definition") return true
        up = up.parent
      }
      return false
    }
    // Enclosing function scope for locals lookup (lambdas have no scope —
    // their bodies read the enclosing function's bindings, correctly).
    const enclosingFunctionScope = (): any | null => {
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        const s = scopeStack[i]
        if (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method ||
            s.kind === ASTEngine.SymbolKind.Constructor) return s
      }
      return null
    }
    // D5: is the enclosing scope a function body? One predicate for the three
    // places that need it — the function branch (a nested `function_definition` is
    // a local direct-initialization, never a definition), and the two alias
    // spellings (`using X = Y;` and `typedef Y X;`, which are the same
    // block-scoped construct under the same CGD20 rule).
    //
    // It reads the SCOPE, not the tree: a Function/Method/Constructor
    // `parentContext` means the walk is inside a body, which is the fact the
    // rules are about. `classScope` (an out-of-line `Foo::bar`) is deliberately
    // NOT consulted — that is a class member's scope, and a member of `Foo` is
    // not a local of anything.
    const ownerIsFunctionScope = (ctx: Scope | undefined): boolean =>
      !!ctx && (ctx.kind === ASTEngine.SymbolKind.Function ||
        ctx.kind === ASTEngine.SymbolKind.Method ||
        ctx.kind === ASTEngine.SymbolKind.Constructor)
    // CP1 resolution: file-scope value, enclosing-class member,
    // enclosing/used-namespace member, or global enum member.
    const isResolvableRead = (name: string): boolean => {
      if (fileScopeValues.has(name)) return true
      const enclosingNs: string[] = []
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        const s = scopeStack[i]
        if (s.kind === ASTEngine.SymbolKind.Class || s.kind === ASTEngine.SymbolKind.Struct) {
          const mm = classMembers.get(s.name)
          if (mm && mm.has(name)) return true
        }
        // CP5: out-of-line member scope carries its class (see Scope).
        if (
          (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Method ||
            s.kind === ASTEngine.SymbolKind.Constructor) && s.classScope
        ) {
          const mm = classMembers.get(s.classScope)
          if (mm && mm.has(name)) return true
        }
        if (s.kind === ASTEngine.SymbolKind.Namespace && s.name !== "anonymous") enclosingNs.push(s.name)
      }
      for (const ns of enclosingNs) {
        const nm = namespaceValues.get(ns)
        if (nm && nm.has(name)) return true
      }
      for (const used of usedNamespaces) {
        const nm = namespaceValues.get(used)
        if (nm && nm.has(name)) return true
      }
      return false
    }
    // Parameter names of one declarator (K&R n/a in C++).
    // CPPD12: the DECLARED name of a declarator, down the declarator CHAIN
    // (pointer/reference/array/parenthesized wrappers, `(*fp)(int)`) and NEVER from
    // the initializer. The extraction it replaces was `findChild(d, "identifier")` —
    // a SHALLOW, document-order lookup — and an `init_declarator`'s named children
    // are [declarator, initializer], so `int *p = g;` yielded `g`. That single wrong
    // name propagated twice: the local was BOUND as `g` (suppressing every read of
    // the real `g` — nlohmann-json full extent lost `uses -> environ`, whose read is
    // `char **Environ = environ;`), and the symbol was PUBLISHED as `g`. Where the
    // declarator was wrapped with no initializer the old lookup found nothing at
    // all, so `char **environ;` and `int a[4];` published no symbol either.
    const declaredNameNode = (node: Node | null): Node | null => {
      let cur: Node | null = node
      while (cur) {
        if (cur.type === "identifier" || cur.type === "field_identifier") {
          // D1, DECLARED-NAME GATE. This is the single choke point every
          // declared name in the analyzer passes through (`declaredValueName`,
          // `declaratorParamNames`, the field/variable branch, the lambda and
          // catch bindings), so the invariant is structural rather than a
          // convention repeated at each push site: a DECLARED name is one the
          // source spells as an identifier, and C++ has no identifier spelled
          // with a keyword. What actually arrives here is the grammar's
          // recovery — measured `friend` (property), `noexcept` (function),
          // `for`/`switch` (method) and `static_cast` (variable) as published
          // symbol names over the real corpora. A keyword declarator is a
          // macro or a damaged region, never a declaration.
          if (!isCppSpelledName(cur.text)) return null
          return cur
        }
        // CPPD12b: the chain must never NAME A FUNCTION where a value is expected.
        // A function declarator whose own declarator is a bare name declares a
        // function (`void JSON_ASSERT(int);`), so descending through it is how the
        // first cut of this fix minted `variable:assert_invariant`,
        // `property:JSON_ASSERT`, `variable:dump` … from ERROR-recovered macro
        // statements — and one of those new names made `key.get_ref<string_t&>()`
        // resolvable, adding three fabricated `push_back -> get_ref` uses edges at
        // the nlohmann-json full extent. Measured at json_v3_10_5.hpp:7701: the
        // `JSON_ASSERT(...)` statement is folded INTO the preceding field_declaration
        // as a second declarator, reached through a parenthesized_declarator — so the
        // guard has to sit at every step, not on the top declarator only. A function
        // POINTER is still a value: its inner step is a parenthesized/pointer
        // declarator, never a bare name.
        if (cur.type === "function_declarator" || cur.type === "abstract_function_declarator") {
          const inner: Node | null = cur.childForFieldName?.("declarator") ?? null
          if (!inner || inner.type === "identifier" || inner.type === "field_identifier" ||
              inner.type === "qualified_identifier" || inner.type === "operator_name" ||
              inner.type === "destructor_name" || inner.type === "type_identifier") {
            return null
          }
        }
        const viaField: Node | null = cur.childForFieldName?.("declarator") ?? null
        let next: Node | null = viaField
        if (!next) {
          for (let k = 0; k < cur.namedChildCount; k++) {
            const c = cur.namedChild(k)
            if (c && (c.type.endsWith("declarator") || c.type === "identifier" || c.type === "field_identifier")) { next = c; break }
          }
        }
        cur = next
      }
      return null
    }
    // CPPD12b: the declared name of a VALUE declaration — never a function's. The
    // chain walk above reaches a function name through `function_declarator`
    // (`void JSON_ASSERT(int);` names JSON_ASSERT), and publishing that as a
    // variable is wrong. It is also how the first cut of this fix leaked: the
    // fallback below fires precisely where the function branch did NOT (macro-shaped
    // and ERROR-recovered declarations), so it minted `variable:assert_invariant`,
    // `property:JSON_ASSERT`, `variable:dump` … and one of those new names made
    // `key.get_ref<string_t&>()` resolvable, adding three fabricated uses edges
    // (`push_back -> get_ref`) at the nlohmann full extent. A function-pointer
    // variable (`int (*fp)(int);`) is still a VALUE: its function_declarator's
    // declarator is a parenthesized/pointer declarator, not a bare name.
    const declaredValueName = (node: Node | null): Node | null => {
      const decl: Node | null = node?.childForFieldName?.("declarator") ?? null
      if (!decl) return null
      if (decl.type === "function_declarator" || decl.type === "abstract_function_declarator") {
        const inner: Node | null = decl.childForFieldName?.("declarator") ?? null
        if (!inner || inner.type === "identifier" || inner.type === "field_identifier" ||
            inner.type === "qualified_identifier" || inner.type === "operator_name" || inner.type === "destructor_name") {
          return null
        }
      }
      return declaredNameNode(decl)
    }
    const declaratorParamNames = (decl: Node | null): string[] => {
      const out: string[] = []
      if (!decl) return out
      const walk: Node[] = [decl]
      while (walk.length > 0) {
        const m = walk.pop()!
        // CPPD13: the DECLARED NAME of a parameter comes off the declarator
        // chain, never off the default value (`declaredNameNode`). The old
        // extraction was the same shallow, document-order lookup CPPD12 fixed for
        // variables, so a parameter whose declarator is wrapped published the
        // wrong name or none at all.
        //
        // This roster is deliberately `parameter_declaration` ONLY. A defaulted
        // parameter (`optional_parameter_declaration`, `const bool strict = true`)
        // is bound by the shared declaration-position rule at its own node in walk
        // order, exactly like every other declaring occurrence in this analyzer
        // (measured: fixture cpp/wrapped-declarator-names-612 pins `no uses ->
        // strict` for all three spellings of the same parameter, and CPPD17/18's
        // wrapped declarators were the only shape where that binding failed — for
        // a different reason, a missing function scope). Pre-binding optional
        // parameters here would move the binding EARLIER than the parameter's own
        // declaration node, which changes flow-sensitive results for shapes like
        // `void f(int a = b, int b = 1)` where the default legitimately reads an
        // outer `b`; the walk-order rule is the one the family contract describes.
        if (m.type === "parameter_declaration") {
          const nm = declaredNameNode(m)
          if (nm) out.push(nm.text)
          continue
        }
        for (let k = 0; k < m.namedChildCount; k++) {
          const c = m.namedChild(k)
          if (c) walk.push(c)
        }
      }
      return out
    }

    /**
     * M60.P1: the PUBLISHED parameter list, as the family's `Parameter[]`.
     *
     * The lane already read every parameter's name — `declaratorParamNames`
     * above, for the local-binding roster — and threw the rest away. The
     * declared payload field `parameters` was therefore never produced, which
     * the M60 payload-seam matrix recorded as a DEAD emit cell
     * (`UniversalSymbol.parameters`, 20 of 33 languages alive, cpp not among
     * them) while this analyzer's own documentation claimed the row was
     * supported. The data was in hand the whole time; the field was simply
     * never filled.
     *
     * Each parameter is read the way the C++ signature reads, from the
     * `parameter_declaration`'s own type/declarator split — never from a
     * document-order scan of its text:
     *
     *   - `type`           the declaration-specifier, which INCLUDES the
     *                      declarator's own prefix operators — the slice is taken
     *                      at the NAME node, not at the declarator, because a
     *                      `reference_declarator`'s text is `& b` and its start
     *                      index points at the `&`. Slicing at the declarator
     *                      (the shape `buildParamSig` used) turns
     *                      `const std::string& b` into `const std::string` and
     *                      `const char* p` into `const char`, which is a WRONG
     *                      type and not a cosmetic one.
     *   - `name`           the declarator's declared name (CPPD12/CPPD13)
     *   - `defaultValue`   the `default_value` field, when the grammar gives one
     *   - `isOptional`     a defaulted parameter is optional at the call site;
     *                      C++ has no other optionality. The default itself is
     *                      NOT a binding — it is read by the walk-order
     *                      declaration-position rule at its own node, so
     *                      pre-binding it here would move the binding EARLIER
     *                      than the parameter's own declaration node and change
     *                      flow-sensitive results for a shape like
     *                      `void f(int a = b, int b = 1)`, where the default
     *                      legitimately reads an outer `b`.
     *
     * Both parameter node types are read, and the difference between them IS the
     * optionality: `parameter_declaration` (`int a`) and
     * `optional_parameter_declaration` (`int c = 3`) are distinct nodes in this
     * grammar, which is why the NAME roster above is deliberately
     * `parameter_declaration`-only.
     */
    const declaratorParameters = (decl: Node | null): ASTEngine.Parameter[] => {
      const out: ASTEngine.Parameter[] = []
      if (!decl) return out
      const paramsNode: Node | null = decl.childForFieldName?.("parameters") ?? this.findChild(decl, "parameter_list") ?? null
      if (!paramsNode) return out
      for (let i = 0; i < paramsNode.namedChildCount; i++) {
        const p = paramsNode.namedChild(i)
        if (!p) continue
        if (p.type === "comment") continue
        // A variadic `...` is a parameter with no name and no type; the family
        // shape has no slot for it, and inventing one would be a name a consumer
        // cannot resolve.
        if (p.type === "variadic_parameter_declaration") continue
        if (p.type !== "parameter_declaration" && p.type !== "optional_parameter_declaration") continue
        const nameNode = declaredNameNode(p)
        if (!nameNode) continue
        // type = everything the parameter writes BEFORE the name, which keeps
        // the `*`/`&`/`&&` that belong to the declarator's own prefix.
        const cut = nameNode.startIndex - p.startIndex
        const type = cut > 0 ? p.text.slice(0, cut).trim() : ""
        const param: ASTEngine.Parameter = { name: nameNode.text }
        if (type) param.type = type
        const defaultNode: Node | null = p.childForFieldName?.("default_value") ?? null
        if (defaultNode || p.type === "optional_parameter_declaration") {
          if (defaultNode) param.defaultValue = defaultNode.text
          param.isOptional = true
        }
        out.push(param)
      }
      return out
    }

    /**
     * M60.P1: the declared RETURN TYPE of a function or method, as the payload
     * field `returnType` — which was likewise never produced while the doc
     * claimed it.
     *
     * Two spellings, and the second is the one that is easy to get wrong:
     *
     *   `std::string name() const`      -> the declaration's `type` field
     *   `auto f() const -> std::string` -> the `type` field is `auto` and the
     *                                      REAL type is the `trailing_return_type`
     *                                      CHILD of the declarator (measured, not
     *                                      a field: `function_declarator
     *                                      [trailing_return_type [-> ,
     *                                      type_descriptor]]`)
     *
     * A trailing return type is not exotic C++ — it is how `decltype(auto)` and
     * every deduced-return function is written, and this lane's own fixtures use
     * it. Reading only the `type` field would publish `auto` for every one of
     * them, and `auto` is a name that resolves to nothing.
     *
     * Both arguments are passed in rather than re-found: the trailing type is a
     * child of the DECLARATOR and the plain type is a field of the DECLARATION, so
     * finding either one from the other means a `findChild` walk on the hot path
     * for a node the caller already has in hand.
     */
    const declaredReturnType = (node: Node | null, declarator: Node | null): string | undefined => {
      if (declarator) {
        const tail: Node | null = this.findChild(declarator, "trailing_return_type") ?? null
        const td: Node | null = tail ? (this.findChild(tail, "type_descriptor") ?? tail.namedChild(0)) : null
        const t = td?.text?.trim()
        if (t) return t
      }
      const t: Node | null = node?.childForFieldName?.("type") ?? null
      const text = t?.text?.trim()
      return text || undefined
    }

    while (stack.length > 0) {
      const item = stack.pop()!
      const { node, parentContext, isExit } = item

      if (isExit) {
        if (parentContext?.symbolRef && parentContext.isAbstract) {
          parentContext.symbolRef.isAbstract = true
          if (parentContext.symbolRef.metadata) {
            parentContext.symbolRef.metadata.isAbstract = true
          }
        }
        if (parentContext && scopeStack.length > 0 && scopeStack[scopeStack.length - 1] === parentContext) {
          scopeStack.pop()
        }
        continue
      }

      if (node.isMissing || node.hasError) {
        if (node.type === "ERROR" || node.type === "MISSING") {
          if (errors.length < 3) errors.push({
            message: `Syntax ${node.type} detected`,
            range: this.nodeToRange(node),
            severity: "warning",
          })
        }
      }

      let newContext = parentContext
      const type = node.type
      let pushedScope = false

      // 1. V8 Freeze Fix: Only check small text identifiers, not global node text
      if (type === "identifier" || type === "qualified_identifier" || type === "type_identifier") {
        const text = node.text
        if (text === "std::make_unique" || text === "std::make_shared") {
          memorySafetyScore = Math.min(100, memorySafetyScore + 5)
        }
      }
      if (type === "new_expression" || type === "delete_expression") {
        memorySafetyScore = Math.max(0, memorySafetyScore - 5)
      }

      // T1 family contract: decisions = branch constructs + short-circuit
      // operators. File-level cyclomatic was entirely absent before.
      if (
        type === "if_statement" || type === "for_statement" ||
        type === "while_statement" || type === "do_statement" ||
        type === "case_statement" || type === "catch_clause" ||
        type === "conditional_expression"
      ) {
        fileDecisions++
      } else if (type === "binary_expression") {
        const op = node.childForFieldName("operator")?.text
        if (op === "&&" || op === "||") fileDecisions++
      }

      if (type === "using_declaration") {
        // CPPD12 (deep review 2026-09-05): using-declarations emitted the
        // LEGACY {source, imported} import shape — the exact defect class the
        // C wave fixed for #include ("the persister reads imp.module and
        // DROPS imports with none"). `using namespace std;` and `using
        // std::vector;` were therefore NEVER persisted to brain_import.
        // Aligned to the family {module, items} contract (rust use:
        // module = qualified path, items = imported names; namespace form =
        // wildcard). Only FILE/NAMESPACE-scope usings are module imports — a
        // class-body `using B::f;` is a member RE-EXPORT (brings an inherited
        // member into the derived scope), not a module dependency, and stays
        // silent (no fabricated import edge).
        const inClass =
          parentContext &&
          (parentContext.kind === ASTEngine.SymbolKind.Class ||
            parentContext.kind === ASTEngine.SymbolKind.Struct ||
            parentContext.kind === ASTEngine.SymbolKind.Method ||
            parentContext.kind === ASTEngine.SymbolKind.Function ||
            parentContext.kind === ASTEngine.SymbolKind.Constructor)
        if (!inClass) {
          const targetNode = this.findChild(node, "qualified_identifier") || this.findChild(node, "identifier")
          const raw = targetNode?.text ?? ""
          const isNamespaceForm = node.text.indexOf("using namespace") !== -1
          // D1: a `using` can only import a name the source spells as an
          // identifier. A keyword here is recovery, and a module named with one
          // resolves to nothing in any store or tool.
          if (raw && isCppSpelledName(raw)) {
            const segs = raw.split("::").filter(Boolean)
            imports.push({
              module: raw,
              items: isNamespaceForm ? ["*"] : segs.length > 1 ? [segs[segs.length - 1]] : [raw],
              range: this.nodeToRange(node),
              metadata: { isImport: true, isUsingDeclaration: true, isNamespaceImport: isNamespaceForm },
            })
            // D3: one `references` edge per module, exactly as for `#include` —
            // the key is the module name, so a repeated `using std::vector;`
            // states the same dependency. The `imports` entry above is still
            // pushed for every occurrence.
            if (!referencesSeen.has(raw)) {
              referencesSeen.add(raw)
              relationships.push({
                // File-level dependency statement → source "global" (same
                // convention as the #include references edge above).
                source: "global",
                target: raw,
                type: ASTEngine.RelationshipType.References,
                confidence: 0.9,
                // M59.A7 (#825): the written path names the edge, not the `using`
                // keyword — `using namespace\n  std;` would otherwise name the line
                // above the module.
                line_number: this.nodeLine(targetNode ?? node),
                metadata: { isUsingDeclaration: true, isImport: true, relationshipType: "using_dependency" },
              })
            }
          }
        }
      } else if (type === "alias_declaration") {
        // `using Point = std::pair<double, double>;` — the modern typedef.
        // The alias name is the `name` field (type_identifier); the value is
        // a type_descriptor. Captured as a Type symbol (matches C typedefs).
        //
        // D5, CGD20 PARITY: a FUNCTION-LOCAL alias is an execution artifact.
        // The C lane states the rule and cites it — "CGD20: function-local
        // typedefs are execution artifacts (C-D1)" (`real-c-analyzer.ts`, the
        // `type_definition` case) — and C++ has the identical construct in two
        // spellings, `using X = Y;` and `typedef Y X;`. The C++ lane had no
        // such guard, so every block-scoped alias became a `Type` symbol owned
        // by the enclosing function: 173 over 554 real C++ files, the owners
        // being macro-heading functions whose names are the literal heading
        // text (`type attoseconds owner=TEST(chrono_test, …)`). That is an edge
        // shape the documented ontology does not contain — `contains` is
        // namespace→class/enum/alias, class→method/property/constructor,
        // enum→member — and a block-scoped alias has no members, so nothing is
        // lost by not publishing it. It matches the rule this analyzer already
        // applies to a local VARIABLE ("Function-local declarations are
        // execution artifacts, not declaration sites").
        //
        // A local CLASS is deliberately still published: it has members, and
        // they need an owner. That asymmetry is the reason the rule is stated
        // here, on the alias, and not as a blanket "nothing inside a function".
        if (ownerIsFunctionScope(parentContext)) {
          newContext = parentContext
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentContext: newContext })
          }
          continue
        }
        const nameNode = node.childForFieldName("name") || this.findChild(node, "type_identifier")
        const name = nameNode?.text
        // D1: an alias declares a name, and a declared name is an identifier.
        if (name && isCppSpelledName(name)) {
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Type,
            range: this.nodeToRange(node),
            visibility: parentContext?.visibility || "public",
            ownerName: parentContext?.name,
            ownerKind: parentContext?.kind,
            // #921: the type NAME's own line (a wrapped alias writes it below).
            metadata: { isTypeAlias: true, isUsingDeclaration: true, nameLine: this.nodeLine(nameNode) },
          })
        }
      } else if (type === "type_definition" || node.text.startsWith("typedef")) {
        // The other C++ spelling of the same construct, and the CGD20 parity
        // guard above applies to it identically — see the `alias_declaration`
        // branch for the full argument.
        if (ownerIsFunctionScope(parentContext)) {
          newContext = parentContext
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentContext: newContext })
          }
          continue
        }
        const typeId = this.findChild(node, "type_identifier")
        if (typeId && isCppSpelledName(typeId.text)) {
          symbols.push({
            name: typeId.text,
            kind: ASTEngine.SymbolKind.Type,
            range: this.nodeToRange(node),
            visibility: parentContext?.visibility || "public",
            ownerName: parentContext?.name,
            ownerKind: parentContext?.kind,
            metadata: { isTypeAlias: true, nameLine: this.nodeLine(typeId) },
          })
        }
      } else if (type === "preproc_include") {
        const text = node.text
        // Family contract (c wave): ImportInfo canonical fields are
        // module/items — the persister reads imp.module ?? imp.path ??
        // imp.localName and DROPS imports with none. The legacy shape
        // { source, imported, isTypeOnly } produced no module, so C++
        // #include imports were NEVER persisted to brain_import (caught by
        // the systems-cluster e2e gate M14.0.F9, 2026-08-29). Align with c.
        // #924: the include's NAME is the `path` node's own text (`<vector>` /
        // `"Service.h"`), never a slice of the whole directive. The legacy
        // slice ran from the `include` keyword to the node's end, so EVERY
        // trailing comment rode along — `#include <vector> // vector`
        // published the module/target `vector // vector`, a string that is
        // not a name and cannot resolve. Measured on the two pinned cpp
        // corpora: 876 such names across fmt + nlohmann-json. Mirrors the C
        // lane's `getIncludePath` contract exactly, including the
        // literal-only rule (a macro-composed argument parses as a
        // call_expression under the same field and is not a resolvable
        // header name — C-D2).
        let pathNode = node.childForFieldName("path")
        if (pathNode && pathNode.type !== "string_literal" && pathNode.type !== "system_lib_string") pathNode = null
        if (!pathNode) {
          pathNode = this.findChild(node, "string_literal") ?? this.findChild(node, "system_lib_string")
        }
        const rawPath = (pathNode?.text ?? "").trim()
        const includePath = pathNode ? stripIncludeChars(rawPath).trim() : ""
        // The system-ness is a property of the WRITTEN form (`<...>` vs
        // `"..."`) — read it from the raw path node, never from the stripped
        // name, where `stripIncludeChars` has already deleted the `<`. The
        // legacy expression was `includePath.startsWith("<")` on the
        // stripped string and could therefore never be true: every system
        // include was reported as a local one. Mirrors the C lane, which
        // computes `isSystem` from the raw node text.
        const isSystem = rawPath.startsWith("<")
        if (includePath) {
          imports.push({
            module: includePath,
            items: ["*"],
            range: this.nodeToRange(node),
            metadata: { isSystemInclude: isSystem, isImport: true, isIncludeDependency: true },
          })
        }
        // depends: #include = compile-time dependency (includePath computed above)
        if (includePath) {
          // #419 family contract: include edges carry the SAME metadata shape
          // as the C analyzer (relationshipType "include_dependency" +
          // isImport) — the C++ variant previously emitted only
          // isIncludeDependency, so the completeness gate's Section B saw no
          // pin for the include dependency kind.
          //
          // D3: one edge per dependency. `referencesSeen` is keyed on the
          // module name alone, so the EDGE is the dependency; the `imports`
          // entry above was still pushed for every directive, which is the
          // distinction between "how many times was it included" (a count) and
          // "what does this file depend on" (an edge).
          if (!referencesSeen.has(includePath)) {
            referencesSeen.add(includePath)
            relationships.push({
              source: "global",
              target: includePath,
              type: ASTEngine.RelationshipType.References,
              confidence: 1.0,
              // M59.A7 (#825), the C lane's rule: the include directive is the
              // source construct and its WRITTEN NAME is the path token — take
              // that node's line, not the directive's (a multi-line include puts
              // the path last).
              line_number: this.nodeLine(pathNode ?? node),
              metadata: { relationshipType: "include_dependency", isSystem, isImport: true, isIncludeDependency: true },
            })
          }
        }

        const lowerText = text.toLowerCase()
        if (stringIncludes(lowerText, "memory") || stringIncludes(lowerText, "unique_ptr") || stringIncludes(lowerText, "shared_ptr")) {
          patterns["RAII"] = true
          patterns["Smart Pointers"] = true
        }
        if (
          stringIncludes(lowerText, "qt") ||
          stringIncludes(lowerText, "qobject") ||
          stringIncludes(lowerText, "qstring") ||
          stringIncludes(lowerText, "qwidget")
        )
          frameworks["Qt"] = true
        if (stringIncludes(lowerText, "iostream") || stringIncludes(lowerText, "vector") || stringIncludes(lowerText, "algorithm"))
          frameworks["stl"] = true
        if (stringIncludes(lowerText, "windows.h")) frameworks["win32"] = true
      }

      if (type === "auto") patterns["auto"] = true
      if (type === "lambda_expression") patterns["lambda"] = true

      // 5. Deep Tree Walk Fix: Only check direct children for constexpr
      if (this.hasDirectModifier(node, "constexpr")) patterns["constexpr"] = true

      if (type === "access_specifier") {
        if (parentContext) {
          const t = node.text.replace(":", "").trim()
          if (t === "public" || t === "private" || t === "protected") {
            parentContext.visibility = t as any
          }
        }
      }

      if (type === "namespace_definition") {
        const name = this.childText(node, "namespace_identifier") || "anonymous"
        // D1: a namespace is named by an identifier; a keyword spelling is
        // recovery. (The "anonymous" sentinel is the deliberate no-name marker,
        // not a keyword, and is unaffected.)
        if (!isCppSpelledName(name)) {
          newContext = parentContext
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentContext: newContext })
          }
          continue
        }
        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Namespace,
          range: this.nodeToRange(node),
          visibility: "public",
          metadata: { isCppNamespace: true, fullName: this.buildFullName(scopeStack, name) },
        })
        newContext = {
          node,
          name,
          kind: ASTEngine.SymbolKind.Namespace,
          visibility: "public",
          isTemplate: false,
          isAbstract: false,
          friends: [],
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "class_specifier" || type === "struct_specifier" || type === "union_specifier") {
        // Forward declaration (`class X;`) — no body: NOT a symbol, no scope
        // push (matches the C negative contract: forward decls produce no
        // symbol). Only the type identifier lives inside, so walk children
        // (harmless) and continue.
        const bodyNode = this.findChild(node, "class_body") || this.findChild(node, "field_declaration_list")
        if (!bodyNode) {
          newContext = parentContext
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentContext: newContext })
          }
          continue
        }
        // CPPD1 (M37.9 probe, fmt corpus): partial/explicit class template
        // SPECIALIZATION (`template <typename T> class Box<T*>`, `template <>
        // class Box<int>`) carries its name in a template_type child
        // (`Box<T*>`), not a bare type_identifier — so every specialization
        // fabricated a bogus `anonymous` class symbol (255 across fmt). The
        // base name of the template_type IS the class (a specialization is
        // the same class Box, not a new anonymous type).
        const name =
          this.childText(node, "type_identifier") ||
          // D7 arm A: a `class`/`struct` may have a QUALIFIED name (an explicit
          // specialization, `template <> struct fmt::formatter<T> : formatter<U>
          // { … }`), which the direct-child `type_identifier` scan cannot see, so
          // the class published as `anonymous` — the no-name sentinel. The rule
          // is CPPD1's leaf, read off the grammar's `name` field.
          specifierDeclaredName(node) ||
          (() => {
            const tt = this.findChild(node, "template_type")
            if (tt) {
              const tn =
                tt.childForFieldName?.("name") ||
                this.findChild(tt, "type_identifier") ||
                this.findChild(tt, "qualified_identifier")
              if (tn?.text) return tn.text
              const lt = tt.text.indexOf("<")
              return lt > 0 ? tt.text.slice(0, lt).trim() : null
            }
            return null
          })() ||
          "anonymous"
        const kind = ASTEngine.SymbolKind.Class
        const defaultVis = type === "class_specifier" ? "private" : "public"

        // D1: a class/struct/union is named by an identifier, and the name is
        // the anchor for every `contains`, `extends` and `overrides` edge that
        // follows. A keyword spelling is recovery, and a class published under
        // one would anchor a whole subgraph on a name nothing can resolve — so
        // the scope is not entered either (entering it would attribute the
        // members to a class that was never declared).
        if (!isCppSpelledName(name)) {
          newContext = parentContext
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentContext: newContext })
          }
          continue
        }

        const isTemplate = node.parent?.type === "template_declaration"

        newContext = { node, name, kind, visibility: defaultVis, isTemplate, isAbstract: false, friends: [] }
        scopeStack.push(newContext)
        pushedScope = true

        const baseClasses: string[] = []
        const baseClause = this.findChild(node, "base_class_clause")
        if (baseClause) {
          // Pinned-wasm shape: base_class_clause children are FLAT
          // (access_specifier / type_identifier / template_type). The old
          // 'base_class' wrapper branches were dead literals (grammar audit).
          for (let i = 0; i < baseClause.namedChildCount; i++) {
            const bc = baseClause.namedChild(i)
            if (!bc || bc.type === "access_specifier") continue
            const typeNode =
              this.findChild(bc, "type_identifier") ||
              this.findChild(bc, "qualified_identifier") ||
              this.findChild(bc, "template_type") ||
              bc
            // CPPD4 (M37.9 fmt probe, base.h is_std_string_like): the extends
            // EDGE target must be the BASE CLASS NAME — leaf segment, template
            // ARGUMENTS stripped. Simple bases already parse to a bare
            // type_identifier (native_formatter), but a QUALIFIED templated
            // base (`detail::is_convertible<decltype(...)>`) fell through to
            // the whole template_type text, fabricating extends edges whose
            // target is the full argument list. Template args are ARGUMENTS,
            // never the inherited base (family contract, mirror of the
            // JS/TS/Dart heritage rule). The registry below applies exactly this
            // clean — the edge and the registry read the same leaf, from one
            // helper, so they cannot disagree (D2, D6).
            //
            // D2: a base whose cleaned leaf equals this class's own name is
            // refused outright — `priority_tag : priority_tag<N-1>` and
            // `char_traits : std::char_traits<T>` both cleaned to themselves,
            // and publishing them asserted that a class inherits from itself.
            const target = extendsTargetName(typeNode.text, name)
            if (target) {
              baseClasses.push(target)
              relationships.push({
                source: name,
                target,
                type: ASTEngine.RelationshipType.Extends,
                confidence: 1.0,
                // M59.A7 (#825): a type expression's start is not always the
                // line of the names inside it (a specifier starts at its
                // KEYWORD) — `nameLine` prefers the grammar's `name` field.
                line_number: this.nameLine(typeNode),
                metadata: { nodeType: typeNode.type },
              })
            }
          }
          // Registry key = the SAME leaf the edge names (template args stripped,
          // last qualifier segment) - methods register under the declared class
          // name, so a raw 'numpunct<Char>' key never matched the 'numpunct'
          // registry. D2: a refused self-base is not in `baseClasses` and so
          // cannot seed an override chain either.
          classBases.set(name, [...baseClasses])
        }

        const sym: ASTEngine.UniversalSymbol = {
          name,
          kind: ASTEngine.SymbolKind.Class,
          range: this.nodeToRange(node),
          visibility: parentContext?.visibility || "public",
          ownerName: parentContext?.name,
          ownerKind: parentContext?.kind,
          metadata: {
            isCppClass: true,
            isTemplate,
            baseClasses,
            // #921: the class NAME's own line (`template <…>` puts it below).
            nameLine: this.nameLine(node),
          },
        }
        symbols.push(sym)
        newContext.symbolRef = sym
      } else if (type === "compound_statement" && enclosingFunctionScope() === null && macroDeclaredBody(node)) {
        // #919: the body of a macro-declared heading (see `macroDeclaredBody`).
        // Publishing the definition the heading WRITES — the heading text
        // itself, never an invented identifier (`TEST(format_test, enum)`
        // generates `format_test_enum_Test::TestBody()`, which appears nowhere
        // in the source) — is what the graph needs: it gives the body's reads a
        // real owner instead of `global`, and it is flagged in metadata so no
        // consumer can mistake it for a hand-written function. The context gate
        // on the left is the whole safety story: inside a real (or recovered)
        // function scope a call statement followed by a block is valid C++ and
        // the enclosing function already owns those reads.
        const rec = macroDeclaredBody(node)!
        const headingText = macroInvocationText(content, rec.nameNode.startIndex)
        // A heading that cannot be read (unbalanced group, a hard token before
        // the paren, the cap) is REFUSED: the block is walked as before — no
        // scope, no symbol — rather than published under a damaged name.
        if (headingText) {
          const sym: ASTEngine.UniversalSymbol = {
            name: headingText,
            kind: ASTEngine.SymbolKind.Function,
            range: this.nodeToRange(rec.heading),
            visibility: "public",
            metadata: {
              isCppFunction: false,
              expandedFrom: "macro-heading",
              macroName: rec.macroName,
              headingText,
            },
          }
          symbols.push(sym)
          newContext = {
            node,
            name: headingText,
            kind: ASTEngine.SymbolKind.Function,
            visibility: "public",
            isTemplate: false,
            isAbstract: false,
            friends: [],
            symbolRef: sym,
            locals: new Set<string>(),
          }
          scopeStack.push(newContext)
          pushedScope = true
        }
      } else if (type === "enum_specifier") {
        const enumNameNode = node.childForFieldName("name") || this.findChild(node, "type_identifier")
        // D7 arm B: the attribute displaced the name out of the enum and into
        // the enclosing declaration, so the `name` field holds `fmt::as_identifiers`
        // and the `type_identifier` scan finds nothing -> `anonymous`. The real
        // name is legible in the declaration; an enum has no qualified name in C++,
        // so a qualified path in this slot is never a name (see
        // `attributeDisplacedEnumName` for the full shape and the narrowness).
        const displaced = attributeDisplacedEnumName(node)
        const name = displaced || this.childText(node, "type_identifier") || specifierDeclaredName(node) || "anonymous"
        // D1: an enum is named by an identifier; a keyword spelling is recovery.
        // The scope is not entered either, for the reason the class branch gives.
        if (!isCppSpelledName(name)) {
          newContext = parentContext
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentContext: newContext })
          }
          continue
        }
        let isEnumClass = false
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child && (child.text === "class" || child.text === "struct")) {
            isEnumClass = true
            break
          }
        }

        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Enum,
          range: this.nodeToRange(node),
          visibility: parentContext?.visibility || "public",
          ownerName: parentContext?.name,
          ownerKind: parentContext?.kind,
          metadata: { isCppEnum: true, isEnumClass, isScopedEnum: isEnumClass, nameLine: this.nodeLine(enumNameNode) },
        })
        newContext = {
          node,
          name,
          kind: ASTEngine.SymbolKind.Enum,
          visibility: "public",
          isTemplate: false,
          isAbstract: false,
          friends: [],
        }
        scopeStack.push(newContext)
        pushedScope = true
      } else if (type === "function_definition" || type === "field_declaration" || type === "declaration") {
        // CP2 (cpp review): friend declarations (`friend void helper();`)
        // are NOT members — the inner declaration node previously minted a
        // (private) Method symbol for someone else's function. The subtree
        // still walks (parameter names bind nothing observable), but no
        // symbol is emitted.
        if (hasFriendAncestor(node)) {
          newContext = parentContext
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentContext: newContext })
          }
          continue
        }
        const funcDetails = this.getFunctionDetails(node)

        // M60.P1: the declaration's modifiers, resolved ONCE, and the metadata
        // flags are DERIVED from them.
        //
        // The four `hasDirectModifier` calls this replaces each did TWO scans (the
        // declaration's children, then `findChild(function_declarator)` and ITS
        // children) — eight scans to answer four yes/no questions that the one
        // decorator list answers exactly, in source order, as published payload.
        // `isVirtual` needed two calls for the same reason (`virtual` sits on the
        // declaration, `override` on the declarator), which is the duplication
        // this collapses: one scan of each node answers both.
        //
        // The declarator is passed in rather than re-found for the same reason
        // `declaratorParameters`/`declaredReturnType` take it: it is a child of
        // this node, and three separate `findChild` lookups for one child is one
        // lookup too many on a hot path.
        const fnDeclarator: Node | null = this.findChild(node, "function_declarator")
        const cppDecorators = this.declarationDecorators(node, fnDeclarator)
        let isStatic = cppDecorators.includes("static")
        let isConstexpr = cppDecorators.includes("constexpr")
        let isConst = cppDecorators.includes("const")
        let isVirtual = cppDecorators.includes("virtual") || cppDecorators.includes("override")

        // M60.P1: the declared signature, resolved once (see the spread below for
        // why the duplicate call was worth removing).
        const fnParameters = declaratorParameters(fnDeclarator)
        const fnReturnType = declaredReturnType(node, fnDeclarator)

        if (funcDetails) {
          const { name: funcName, scope: explicitScope, isDestructor, isOperator, nameNode: funcNameNode } = funcDetails

          // D5: C++ HAS NO NESTED FUNCTION DEFINITION. A `function_definition`
          // whose enclosing scope is a function body cannot be a definition, so
          // what it is instead is the one thing that shape genuinely is: a LOCAL
          // VARIABLE written with direct-initialization parentheses, which is
          // ambiguous to a parser without semantics —
          //
          //   std::string contents(ReadEntireFile(flagfile));
          //   AutoHandle parent_process_handle(::OpenProcess(…));
          //   const FloatingPoint<RawType> lhs(val1), rhs(val2);
          //
          // The grammar resolves toward the function reading, so the analyzer was
          // publishing each of those variables as a FUNCTION symbol owned by the
          // enclosing function — 619 of them over 554 real C++ files, and the
          // graph's answer to "what does this function contain" was a set of
          // sibling functions.
          //
          // This is the third guard of one family, and its absence is why the
          // other two were not enough: the field/variable branch already refuses
          // to publish inside a function (`insideFunction`), and `isMacroFunctionShape`
          // already refuses an untyped heading at file scope. Neither reaches a
          // node the grammar calls a `function_definition` INSIDE a body, and
          // that is exactly where the class lives.
          //
          // The name is still BOUND as a local — a local shadows a file-scope or
          // class-scope name of the same spelling for the rest of the body, and
          // dropping that binding would fabricate a read of the outer name. No
          // symbol, no scope, and the children walk under the enclosing function
          // unchanged.
          const ownerIsFunction = ownerIsFunctionScope(parentContext)
          if (ownerIsFunction && !explicitScope) {
            const fnScope = enclosingFunctionScope()
            if (fnScope && isCppSpelledName(funcName)) {
              if (!fnScope.locals) fnScope.locals = new Set<string>()
              fnScope.locals.add(funcName)
            }
            newContext = parentContext
            for (let i = node.namedChildCount - 1; i >= 0; i--) {
              const child = node.namedChild(i)
              if (child) stack.push({ node: child, parentContext: newContext })
            }
            continue
          }

          // CP2: macro-function shapes (`TEST(a, b) {...}`) declare no real
          // function — `TEST` is not a name in the source — BUT the body is
          // real code whose locals must bind (shadowing) and whose nested
          // declarations must NOT leak as file-scope symbols. Without the
          // scope, TEST-body locals minted as file-scope Variables AND
          // shadow-suppression failed (phantom uses to same-named globals:
          // `copy`, `file`).
          //
          // #919: this is the SECOND spelling of a macro-DECLARED BODY (the
          // first is `macroDeclaredBody`, where the grammar leaves the block as
          // a sibling). Both are bodies written by a macro heading, and both
          // used to source their reads at `global`; both are now scoped and
          // published by the SAME policy — the heading text as the name,
          // flagged `expandedFrom: macro-heading` (see macroDeclaredBody's doc
          // for why naming is the product decision). The heading text here runs
          // from the node's start to the end of its parameter list, which is
          // exactly what the source writes; a shape with NO body (gmock's
          // decorator fragments) keeps the anonymous scope, because there is no
          // heading to read.
          if (!isDestructor && this.isMacroFunctionShape(node, funcName)) {
            const macroHeading = this.macroHeadingText(node, content, funcName)
            let sym: ASTEngine.UniversalSymbol | null = null
            if (macroHeading) {
              sym = {
                name: macroHeading,
                kind: ASTEngine.SymbolKind.Function,
                range: this.nodeToRange(node),
                visibility: "public",
                metadata: {
                  isCppFunction: false,
                  expandedFrom: "macro-heading",
                  macroName: funcName,
                  headingText: macroHeading,
                },
              }
              symbols.push(sym)
            }
            newContext = {
              node,
              name: macroHeading ?? "",
              kind: ASTEngine.SymbolKind.Function,
              visibility: "public",
              isTemplate: false,
              isAbstract: false,
              friends: [],
              ...(sym ? { symbolRef: sym } : {}),
              locals: new Set<string>(),
            }
            scopeStack.push(newContext)
            pushedScope = true
            // The branch continues past the shared exit-record push below,
            // so record the pop here (else the scope leaks into siblings).
            stack.push({ node, parentContext: newContext, isExit: true })
            for (let i = node.namedChildCount - 1; i >= 0; i--) {
              const child = node.namedChild(i)
              if (child) stack.push({ node: child, parentContext: newContext })
            }
            continue
          }

          // 3. Out-of-Line Method Orphan Fix: Use explicit scope if defined (e.g. MyClass::myMethod)
          const actualOwnerName = explicitScope || parentContext?.name
          const actualOwnerKind = explicitScope ? ASTEngine.SymbolKind.Class : parentContext?.kind

          const isConstructor = actualOwnerName === funcName && actualOwnerKind === ASTEngine.SymbolKind.Class

          // 2. Pure Virtual Hallucination Fix: Only check direct immediate children for '0' in a field declaration
          let isPureVirtual = false
          if (isVirtual || type === "field_declaration" || type === "declaration") {
            for (let i = 0; i < node.childCount; i++) {
              const child = node.child(i)
              if (child && child.type === "number_literal" && child.text === "0") {
                isPureVirtual = true
                break
              }
            }
          }

          if (isPureVirtual && parentContext && parentContext.name === actualOwnerName) {
            parentContext.isAbstract = true
          }

          const isTemplate = node.parent?.type === "template_declaration"
        // Destructors are compiler-managed lifecycle members; exclude them from
        // the declaration symbol set (matching the universal contract's focus on
        // user declarations).
        if (isDestructor) {
          // still walk children for nested declarations
          newContext = parentContext
          for (let i = node.namedChildCount - 1; i >= 0; i--) {
            const child = node.namedChild(i)
            if (child) stack.push({ node: child, parentContext: newContext })
          }
          continue
        }

        const kind = isConstructor
            ? ASTEngine.SymbolKind.Constructor
            : actualOwnerKind === ASTEngine.SymbolKind.Class
              ? ASTEngine.SymbolKind.Method
              : ASTEngine.SymbolKind.Function

        // Universal contract: constructors are normalized to the name
        // "constructor" (identical to the C# normalization). The C++ class name
        // remains available via ownerName.
        let symName = funcName
        if (isConstructor) symName = "constructor"

          const sym: ASTEngine.UniversalSymbol = {
            name: symName,
            kind: kind,
            range: this.nodeToRange(node),
            complexity: this.methodComplexityCpp(node),
            // CP3 (cpp review, HC1 parity): file-scope `static` (internal
            // linkage) is private. Class-member `static` is NOT internal
            // linkage — members keep their access-specifier visibility.
            visibility: (isStatic && actualOwnerKind !== ASTEngine.SymbolKind.Class
              ? "private"
              : parentContext?.visibility) || "public",
            isStatic,
            ownerName: actualOwnerName,
            ownerKind: actualOwnerKind,
            // M60.P1: the three declared payload fields the lane read but never
            // published. The M60 payload-seam matrix recorded `parameters`,
            // `returnType` and `decorators` as DEAD emit cells for cpp while
            // this file's own documentation claimed all three were supported —
            // a claim that was false, and the data for all three was already
            // extracted (the parameter NAMES bound the local roster, the return
            // type and the modifier specifiers were on the node).
            //
            // `parameters` and `returnType` are OMITTED rather than emitted empty
            // when there is no real signature: an empty list is a claim that the
            // function takes no arguments, and for a function that genuinely does
            // not (`void f()`) that is a true claim worth making, so this only
            // withholds the field where withholding it is the honest answer.
            // A macro-declared heading never reaches here — its branch returns
            // before the symbol is built — which is right, because its
            // "parameters" are macro paste-tokens rather than parameters.
            //
            // Computed ONCE each. The spread reads like a property access, so the
            // first draft called each helper twice — once for the `.length`/truth
            // test and once for the value — and `declaratorParameters` re-walks to
            // the `function_declarator` on each call. That is a second full
            // `findChild` scan and a second parameter-list walk per function
            // declaration, on the hot path, for a value already in hand.
            ...(fnParameters.length > 0 ? { parameters: fnParameters } : {}),
            ...(fnReturnType ? { returnType: fnReturnType } : {}),
            ...(cppDecorators.length > 0 ? { decorators: cppDecorators } : {}),
            metadata: {
              isCppFunction: true,
              isTemplate,
              isVirtual,
              isPureVirtual,
              isConst,
              isStatic,
              isConstexpr,
              isConstructor,
              isDestructor,
              isOperatorOverload: isOperator,
              // #612 store-phase: DECLARATION vs DEFINITION. This branch is
              // reached for all three node types that can name a function, and
              // the type itself is the whole discriminator — the grammar parses
              // a body as `function_definition` and a prototype (file-scope
              // `int f(void);`, an in-class `int f();`, a field declaration) as
              // `declaration`/`field_declaration`. Without this key the only
              // signal the store had was the symbol NAME, so a cpp header
              // prototype competed on equal footing with the .cpp definition
              // in another file and name resolution could pick the prototype.
              ...(type === "function_definition" ? {} : { isDeclaration: true }),
              // #921 (M60): the line the declared NAME is written on. A wrapped
              // return type puts it below the declaration's start
              // (`void NORETURN` then `CheckFailed(const char *file, …)`), and the
              // containment edge this symbol may own has to name THAT line — the
              // rule every other relationship type already follows. Absent when
              // the tree gives no name node (the containment edge then falls back
              // to the symbol range, which is the pre-#921 behaviour).
              nameLine: this.nodeLine(funcNameNode),
            },
          }
          // Override tracking. The OLD code stored registries on `this`
          // AND gated registration on a prior base_class_clause - base-class
          // methods were never registered before Derived was walked
          // (top-down order), so the feature was DEAD in practice.
          // Now: EVERY class-scope method registers (C++ virtual dispatch
          // does not require the keywords); resolution is post-loop when
          // all classes/bases are known. Constructors never register.
          if (
            !isConstructor &&
            kind === ASTEngine.SymbolKind.Method &&
            parentContext?.kind === ASTEngine.SymbolKind.Class &&
            funcName !== parentContext.name
          ) {
            // Signature-aware registry: name -> normalized TYPE-ONLY
            // parameter signature. CPPD5 (M37.9 fmt probe, gtest.h
            // EmptyTestEventListener): parameter NAMES are not part of a C++
            // signature, and the gtest idiom of commenting an unused name out
            // (`const TestInfo& /*test_info*/`) made the old full-text
            // comparison diverge from the base declaration — every such
            // override was silently dropped (11 of Empty's 15 overrides).
            // Comment-stripping is insufficient: the base has the name, the
            // child has none. Compare only each parameter's TYPE (the text
            // before its declarator), so names, comments, and whitespace
            // never affect virtual-dispatch matching — while DIFFERENT
            // parameter TYPES still correctly hide (the override-signature-
            // aware fixture contract).
            const decl2 = this.findChild(node, "function_declarator")
            const paramsNode = decl2?.childForFieldName("parameters") ?? null
            const normParams = this.buildParamSig(paramsNode)
            const sigs = classVirtuals.get(parentContext.name) ?? new Map()
            // CPPD11 (deep review 2026-09-05): overloaded virtuals — a base
            // declaring BOTH `virtual void f(int)` and `virtual void f(double)`
            // only ever matched the LAST-registered signature, so the other
            // overload's override was silently dropped (probe: Derived
            // overriding f(int) AND f(double) emitted one edge). Registry is
            // now per-name signature LIST.
            const prev = sigs.get(funcName) ?? []
            if (!prev.includes(normParams)) sigs.set(funcName, [...prev, normParams])
            else sigs.set(funcName, prev)
            classVirtuals.set(parentContext.name, sigs)
            if ((classBases.get(parentContext.name)?.length ?? 0) > 0) {
              pendingOverrides.push({ cls: parentContext.name, method: funcName, params: normParams, line: this.nodeLine(node) })
            }
          }

          symbols.push(sym)

          if (type === "function_definition") {
            newContext = {
              node,
              // CPPD9 (deep review 2026-09-05): the scope NAME must match the
              // emitted symbol name. Constructors were pushed as the raw
              // class name (`Engine`) while their symbol was normalized to
              // "constructor" — so ctor-body calls emitted source=Engine (the
              // Class symbol) instead of the Constructor symbol, and the
              // qualified_calls payload never reached the constructor. The
              // family contract (groovy/java/csharp) scopes ctors under the
              // normalized "constructor" name. Class-scope (non-ctor) funcs
              // keep funcName == symName already.
              name: symName,
              kind,
              visibility: "public",
              isTemplate: false,
              isAbstract: false,
              friends: [],
              symbolRef: sym,
              // CP5: out-of-line class scope for member resolution.
              classScope: explicitScope,
              // CP1: parameters bind at function entry (flow-sensitive
              // shadowing like the C family — reads before any local
              // binding still resolve outward).
              locals: new Set(declaratorParamNames(this.findChild(node, "function_declarator"))),
            }
            scopeStack.push(newContext)
            pushedScope = true
          }
        } else if (type === "field_declaration" || type === "declaration") {
          const decls = this.findAllChildren(node, "init_declarator")
          if (decls.length === 0) {
            // A declaration with NO initializer still declares when its declarator
            // is wrapped — a member `UserRepository *repository_;`, a file-scope
            // `char **environ;`, an array `int a[4];`. The old test looked ONE level
            // into pointer/reference wrappers, so `**p` and arrays published no
            // symbol at all (nlohmann-json full extent: zero symbols named
            // `environ` for `extern "C" char **environ;`).
            if (declaredValueName(node)) decls.push(node)
          }

          for (let idx = 0; idx < decls.length; idx++) {
            const d = decls[idx];
            // CPPD12: the name comes off the declarator chain, never off the
            // initializer (see declaredNameNode).
            //
            // D4: and when the grammar's own recovery displaced that chain's
            // terminal, the name is in the ERROR beside it and it WINS — the
            // declarator field is then holding the source's TYPE, which is not
            // a name at all. Measured on nlohmann's
            // `primitive_iterator.hpp:38`, where a macro access-specifier label
            // (`JSON_PRIVATE_UNLESS_TESTED:`) drove the grammar into recovery:
            // the analyzer published a `property difference_type` — a name that
            // is a type, colliding with the real alias of that name in the same
            // class — and the declaration that exists, `m_it`, was not in the
            // graph at all. Order matters: the chain read is not null here (a
            // type name is a legal identifier spelling), so the recovery has to
            // be consulted FIRST, not as a fallback.
            const idNode =
              recoveredDeclaredName(d) ??
              (d.type === "init_declarator" ? declaredNameNode(d) : declaredValueName(d))
            const name = idNode ? idNode.text : ""
            // D7 arm B: this declarator can BE the enum's displaced name rather
            // than a variable. `enum class [[=fmt::as_identifiers]] color { … }`
            // parses as a declaration whose `init_declarator` is `color { … }`, so
            // publishing the declarator gave `fmt/test/enum-test.cc:24` BOTH
            // `variable "color"` and `enum "anonymous"` for one enum. The
            // evidence is the same one `attributeDisplacedEnumName` reads: the
            // declarator's `type` field is an `enum_specifier` whose own `name`
            // field holds a qualified path, which no enum name in C++ can. When
            // it is present the name belongs to the ENUM and no variable is
            // published for it.
            const isDisplacedEnumName = (() => {
              // `d` is the `init_declarator`, so the `type` field lives on its
              // parent DECLARATION — reading it off `d` finds nothing and the
              // guard silently never fires (which is what the first cut did).
              const holder: Node | null = d.type === "init_declarator" ? d.parent ?? null : d
              const tf: Node | null = holder?.childForFieldName?.("type") ?? null
              if (!tf || tf.type !== "enum_specifier") return false
              return attributeDisplacedEnumName(tf) === name
            })()
            // Function-local declarations are execution artifacts, not
            // declaration sites — only class-scope fields and file-scope
            // variables become symbols.
            const insideFunction =
              parentContext &&
              (parentContext.kind === ASTEngine.SymbolKind.Function ||
                parentContext.kind === ASTEngine.SymbolKind.Method ||
                parentContext.kind === ASTEngine.SymbolKind.Constructor)
            // CP1: ...but they DO bind locals (shadowing suppression for
            // later reads in walk order — C CGD7 contract; the RHS
            // initializer is never a binding).
            if (name && insideFunction) {
              const fnScope = enclosingFunctionScope()
              if (fnScope) {
                if (!fnScope.locals) fnScope.locals = new Set<string>()
                fnScope.locals.add(name)
              }
            }
            if (name && !isDisplacedEnumName && !stringIncludes(name, "(") && !insideFunction && !this.isBareMacroDeclaration(node, name)) {
              // File-scope static (internal linkage) → private, matching the
              // C family contract; class-scope members keep the
              // access-specifier visibility.
              const visStatic =
                isStatic && parentContext?.kind !== ASTEngine.SymbolKind.Class ? "private" : undefined
              // M60.P1 `decorators`, the field/variable half — same extraction as
              // the function branch, and passed the declarator for the same reason:
              // a member declared only inside a class (`int sum() const;`) is a
              // `field_declaration` whose `const` and `override` sit on its
              // `function_declarator`, so a declaration-only scan would leave
              // those empty exactly as it did in the function branch.
              const declDecorators = this.declarationDecorators(node, this.findChild(node, "function_declarator"))
              symbols.push({
                name,
                kind: isConstexpr
                  ? ASTEngine.SymbolKind.Constant
                  : parentContext?.kind === ASTEngine.SymbolKind.Class
                    ? ASTEngine.SymbolKind.Property
                    : ASTEngine.SymbolKind.Variable,
                range: this.nodeToRange(d),
                visibility: visStatic || parentContext?.visibility || "public",
                isStatic,
                ownerName: parentContext?.name,
                ownerKind: parentContext?.kind,
                ...(declDecorators.length > 0 ? { decorators: declDecorators } : {}),
                metadata: {
                  isConstexpr,
                  isStatic,
                  isConst,
                  // #921: the declared NAME's own line — `struct { … } options;`
                  // and a wrapped type both write it below the declaration start.
                  nameLine: this.nodeLine(idNode),
                },
              })
            }
          }
        }
      } else if (type === "enumerator") {
        const enumeratorNameNode = node.childForFieldName("name") || this.findChild(node, "identifier")
        const name = this.childText(node, "identifier")
        // D1: an enumerator declares a name, and a declared name is an
        // identifier — the same rule `declaredNameNode` applies to variables.
        if (name && isCppSpelledName(name)) {
          // CP1: function-local enumerators bind locals too (shadow
          // suppression for later reads — same walk-order discipline as
          // variable declarations).
          const fnScope = enclosingFunctionScope()
          if (fnScope && scopeStack.length > 0) {
            if (this.insideFunctionBody(node.parent)) {
              if (!fnScope.locals) fnScope.locals = new Set<string>()
              fnScope.locals.add(name)
            }
          }
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.EnumMember,
            range: this.nodeToRange(node),
            visibility: "public",
            ownerName: parentContext?.name,
            ownerKind: parentContext?.kind,
            metadata: { isCppEnumMember: true, nameLine: this.nodeLine(enumeratorNameNode) },
          })
        }
      } else if (type === "field_expression") {
        // struct.field or ptr->field → Uses relationship (family contract:
        // field access is a USES edge, never a references/uses pair). When the
        // field access is the function of a call (`obj.method()`), the
        // call_expression branch already emits the `calls` edge — skipping it
        // here avoids the redundant `uses` pair (one edge per pair).
        const field = node.childForFieldName("field")
        const obj = node.childForFieldName("argument") || node.namedChild(0)
        // CPPD3 (M37.9 fmt probe, base-test.cc): a member read on a CALL
        // TEMPORARY (`parse_arg_id("42:").res`) was dropped by the old
        // `!(obj.type === call_expression)` guard — that guard was meant to
        // skip method-call shapes, but `x().field` (read on a temporary) is a
        // genuine member READ. The correct callee discriminator is the PARENT
        // check (field_expression as the function of a call), which remains
        // below. The obj being a call says nothing about whether `.field` is
        // read or invoked.
        // CPPD2 (M37.9 fmt probe, xchar/chrono-test.cc): assignment-LHS
        // member WRITES (`tm.tm_year = 116`) emitted `uses` — only call-
        // callee positions were gated, not write designators. The family
        // contract (C CGD27, SCD1, OO member-read sweep) gates member writes:
        // the LHS of an assignment is a write, never a read-use.
        const pType = node.parent?.type
        // F6 audit: `compound_assignment_expression` is not a tree-sitter-cpp
        // type; `a += 1` parses as `assignment_expression` with a compound
        // operator token, which this condition already covers.
        const lhsAssign =
          pType === "assignment_expression" &&
          node.parent?.namedChild(0) &&
          node.parent!.namedChild(0)!.startIndex === node.startIndex
        // D1, FIELD-POSITION GATE: the third `uses` emitting position, and the
        // last one the keyword set had to reach. A trailing return type is the
        // shape that gets here — measured at
        // catch2/extras/catch_amalgamated.hpp:5522,
        //
        //   constexpr auto isBinaryExpression() const -> bool { … }
        //
        // whose `-> bool` the grammar recovers as a `field_expression` with a
        // missing object, so the branch read a member named `bool` and published
        // `uses Detail -> bool` at confidence 0.9. A keyword is not a member, and
        // the bare-read gate cannot see this position because the edge is emitted
        // here rather than from the `identifier` branch.
        if (field && field.text.trim() && isCppSpelledName(field.text) && pType !== "call_expression" && !lhsAssign) {
          const source = parentContext?.name || "global"
          const relKey = `${source}::uses::${field.text}`
          if (!usesSeen.has(relKey)) {
            usesSeen.add(relKey)
            relationships.push({
              source,
              target: field.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              // M59.A7 (#825) / #870: the FIELD LEAF names this edge. This row
              // carried no line at all, which is the #870 measurement (a member
              // read reported at line 0 in the fmt lane).
              line_number: this.nodeLine(field),
              metadata: { relationshipType: "field_access", accessedFrom: obj?.text },
            })
          }
        }
      } else if (type === "call_expression") {
        const funcNode = node.childForFieldName("function") || node.namedChild(0)
        if (funcNode) {
          let targetName = funcNode.text
          let qualifiedName = targetName

          // CPPD13 (deep review 2026-09-05, fmt corpus: 855 -> 214 leaky
          // targets): the CALLEE LEAF is the bare name — template args
          // (m<int>), nested `::` chains (`std::numeric_limits<X>::lowest`),
          // and defense-parentheses (`(X)()` — the Windows min/max idiom)
          // must all unwrap to the innermost identifier. Recursive descent:
          //  template_function/method  -> first named child (bare name)
          //  qualified_identifier      -> last named child (repeat for
          //                              nested chains)
          //  parenthesized_expression  -> inner expression (then unwrap)
          //  field_expression          -> field member (leaf or template)
          // Stops at identifier / field_identifier / type_identifier /
          // operator_name / destructor_name. The FULL qualified path stays in
          // qualifiedName (qc payload) — only the edge target is the leaf.
          // M59.A7 (#825) contract, mirrored from the C lane: a row's line is the
          // line of the node that NAMES the relationship. For a call that is the
          // CALLEE LEAF — a `call_expression` starts at its RECEIVER, so a
          // multi-line receiver (`return obj\n  .method()`) would stamp the call
          // one line early, and a receiver span (a call inside a template
          // argument) further off. This returns the NODE, not its text, so the
          // edge's `line_number` and its `target` cannot name different nodes.
          // #924 (cpp's third name-surface class): the descent ends on a
          // NAME-BEARING node or there is no named callee at all. The old code
          // returned whatever the descent stopped on, so a callee the grammar
          // does not name published its SOURCE TEXT as the target — an IIFE
          // (`[](UInt m) { … }(4)`, whose `function` field IS the
          // lambda_expression), an element call (`arr[i]()`), a compound
          // literal, an assignment, a concatenated string, an update/ unary
          // expression, a mis-nested binary expression, an ERROR region — 184
          // such call sites over the two pinned corpora, measured
          // (script/m14/tmp/c924-calls-ws.ts). `null` here means "this call has
          // no named callee", which is the SAME ruling CPPD13 already applies
          // to functor temporaries and pointer-to-member invocations: a call
          // whose callee is only knowable at runtime emits no edge.
          const NAME_BEARING = (t: string): boolean =>
            t === "identifier" || t === "field_identifier" || t === "type_identifier" ||
            t === "operator_name" || t === "destructor_name" || t === "namespace_identifier"
          const calleeLeafNode = (n: any): any => {
            let cur = n
            let guard = 0
            while (cur && guard++ < 8) {
              const t = cur.type
              if (t === "field_expression") {
                const f = cur.childForFieldName("field") ?? cur.namedChild(cur.namedChildCount - 1)
                if (!f) return null
                cur = f
                continue
              }
              if (t === "template_function" || t === "template_method") {
                const base = cur.namedChild(0)
                if (!base) return null
                cur = base
                continue
              }
              // `loc.template get<T>()` / `u.template m<int>()` — the
              // `template` disambiguator keyword makes the member a
              // dependent_name wrapping the real template_method.
              if (t === "dependent_name" && cur.namedChildCount >= 1) {
                const inner = cur.namedChild(0)
                if (inner && (inner.type === "template_method" || inner.type === "template_function" || inner.type === "identifier" || inner.type === "field_identifier")) {
                  cur = inner
                  continue
                }
                return null
              }
              if (t === "qualified_identifier" && cur.namedChildCount >= 1) {
                cur = cur.namedChild(cur.namedChildCount - 1)
                continue
              }
              if (t === "parenthesized_expression" && cur.namedChildCount >= 1) {
                cur = cur.namedChild(0)
                continue
              }
              if (!NAME_BEARING(t)) return null
              // #924 + D1: a callee the language cannot spell names no function.
              // #924 closed the builtin-TYPE half of this (`unsigned(x)` is a
              // functional cast the grammar calls an `identifier`); D1 closed
              // the rest — the CAST family, which is the same impossibility
              // (`static_cast<int>(x)` is
              // `call_expression[function=template_function[name=identifier]]`),
              // and the CONTROL-FLOW keywords the grammar's ERROR recovery
              // invents `call_expression` nodes for (`calls if`, 25 sites).
              // Measured 5,496 keyword call targets over 1,502 real C++ files.
              // The membership test and its justification are `isCppSpelledName`
              // (exported: the F5 oracle applies the same rule, never a copy).
              if (t === "identifier" && !isCppSpelledName(cur.text)) return null
              return cur
            }
            return null
          }
          const calleeLeaf = (n: any): string => calleeLeafNode(n)?.text ?? ""
          // The naming node of the call edge — the SAME leaf whose text becomes
          // `targetName` below, so line and target can never disagree.
          let calleeSite: any = calleeLeafNode(funcNode)
          if (funcNode.type === "field_expression") {
            // obj.method() or ptr->method()
            const field = funcNode.childForFieldName("field")
            const obj = funcNode.childForFieldName("argument") || funcNode.namedChild(0)
            if (field) {
              targetName = calleeLeaf(field)
              qualifiedName = obj ? `${obj.text}.${field.text}` : field.text
              calleeSite = calleeLeafNode(field)
            }
          } else {
            targetName = calleeLeaf(funcNode)
            qualifiedName = funcNode.text
          }

          const source = parentContext?.name || "global"

          // CPPD13 (deep review 2026-09-05, fmt): a call whose CALLEE is
          // itself a call_expression is a functor-temporary invocation
          // (`std::forward<F>(f)(args)`, `Op<int>()(a, b)`) — the effective
          // callee is the anonymous temporary's operator(), which has no
          // named target (the CPP-D9 operator-call ruling; the inner
          // construction call is emitted separately at its own node). The
          // pre-fix code emitted the raw callee text (`std::forward<F>(f)`)
          // as a junk target. Pointer-to-member recovery (`->*` in decltype
          // soup) is the same shape: no named callee.
          const calleeIsTempCall = funcNode.type === "call_expression"
          // #924: the descent found no name-bearing node (see `calleeLeafNode`).
          const calleeIsUnnamed = calleeSite === null
          // CPPD13 tail (gmock.h L1872): `(std::declval<Class*>()->*pmf)()` —
          // a pointer-to-MEMBER invocation. The callee is only knowable at
          // runtime (like C function pointers), and the pinned grammar
          // ERROR-recovers the shape (fn.hasError). A mangled callee has no
          // trustworthy leaf — emit nothing.
          const calleeIsError = !!funcNode.hasError
          if (!targetName.startsWith("operator") && !calleeIsTempCall && !calleeIsUnnamed && !calleeIsError) {
            relationships.push({
              source,
              target: targetName,
              fromSymbol: source,
              toSymbol: qualifiedName,
              type: ASTEngine.RelationshipType.Calls,
              // M59.A7 (#825) / M60.P1 (#873): ONE line, ONE base, ONE node. The
              // row's `line_number` is the callee leaf's line (the node that
              // names the edge) and the metadata mirror repeats THAT value
              // instead of the call node's — a mirror that named a different
              // node would make "the row's line" ambiguous again, which is what
              // #873 was about. Base stays 1-based (R6).
              line_number: this.nodeLine(calleeSite),
              metadata: { line: this.nodeLine(calleeSite), qualified: qualifiedName },
            })
            // #383 payload: qualified path WITHOUT argument text (C++ keeps
            // :: separators), attributed to the enclosing function/method
            // symbol DIRECTLY (family contract — groovy/java push onto
            // parentContext.symbolRef at the call site). CPPD10 (deep review
            // 2026-09-05): the old post-loop merge keyed payloads by bare
            // method NAME, so two same-named methods in different classes
            // (Alpha.run / Beta.run) shared one bucket and BOTH symbols
            // carried BOTH classes' call lists (probe: 192 names / 640 excess
            // owners across fmt). Direct symbolRef attach is exact — and it
            // also fixes CPPD9's lost ctor payload (the ctor scope now has
            // name "constructor" == its symbol name).
            const caller = parentContext?.symbolRef
            if (caller && (caller.kind === ASTEngine.SymbolKind.Method || caller.kind === ASTEngine.SymbolKind.Function || caller.kind === ASTEngine.SymbolKind.Constructor)) {
              if (!caller.qualified_calls) caller.qualified_calls = []
              caller.qualified_calls.push(qualifiedName)
            }
          }
        }
      } else if (type === "new_expression") {
        // Track instantiations: new Foo() or new std::vector<int>()
        const typeNode = node.namedChild(0)
        if (typeNode) {
          let typeName = typeNode.text
          // CPPD8 (M37.9 fmt probe, gtest Message ctor): a leading global-scope
          // `::` adds a NESTED qualified_identifier level, so `new
          // ::std::stringstream` parses as qualified_identifier >
          // qualified_identifier("std::stringstream") > type_identifier. One
          // unwrap left "std::stringstream" — still qualified — and the clean
          // leaf regex below dropped the whole edge, while `new ::Foo` (single
          // unwrap reaches the leaf) worked. Descend to the innermost name
          // (the pinned grammar nests every namespace chain — `::` prefix or
          // Foo::Bar::Baz — as qualified_identifier levels; probed 2026-09-05:
          // no cpp shape emits scoped_type_identifier, so only
          // qualified_identifier is unwrapped here).
          let cur: any = typeNode
          while (cur && cur.type === "qualified_identifier" && cur.namedChildCount >= 1) {
            const inner = cur.namedChild(cur.namedChildCount - 1)
            if (!inner) break
            cur = inner
          }
          if (cur && cur !== typeNode) typeName = cur.text
          // Template arguments are not part of the constructed type name
          // (`new std::vector<int>` instantiates vector, not 'vector<int>').
          const lt3 = typeName.indexOf("<")
          if (lt3 !== -1) typeName = typeName.slice(0, lt3)
          // CPPD6 (M37.9 fmt probe, gtest.h/gmock.h): macro-mangled
          // new_expression recovery fabricates garbage constructed-type
          // targets (`(static_cast`, `typename Derived::template
          // gmock_Impl`, `(&locale_)`) from ERROR-region node soup. A real
          // constructed type is a clean identifier (optionally namespace-
          // qualified before template stripping) — anything else is a
          // recovery artifact and emits no edge (the C-wave CGD19 class).
          // ≡ /^[A-Za-z_]\w*$/ — full-string identifier shape: first char a
          // letter/underscore, every later char word-class. \w ≡ [A-Za-z0-9_]
          // in non-unicode mode, which is how this file's regexes run.
          if (this.isPlainIdentifier(typeName)) {
            const source = parentContext?.name || "global"
            relationships.push({
              source,
              target: typeName,
              fromSymbol: source,
              toSymbol: typeNode.text,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: typeNode.hasError ? 0.6 : 1.0,
              // M59.A7 (#825): the constructed type's own node names this edge —
              // `new` and its type can sit on different lines. Same value in the
              // #873 mirror, 1-based.
              line_number: this.nodeLine(typeNode),
              metadata: { line: this.nodeLine(typeNode), isNew: true },
            })
          }
        }
      } else if (type === "identifier") {
        // CP1 (cpp review): bare value reads. The analyzer previously
        // emitted NO bare-identifier edges at all (`return g;` produced
        // zero relationships) while the oracle only audited calls and
        // member reads — a both-sides blind spot. Every bare identifier
        // naming a file-visible VALUE is a Uses edge (C family contract),
        // with the C family's exclusion discipline:
        // declaration positions (leftmost-declarator rule), call callees
        // (calls branch owns them), member leaves (field path owns them),
        // qualified reads (limitation), preprocessor text (CGD11), labels,
        // attributes, lambda-capture bindings — and shadowing suppression
        // via function locals/params. Resolvability is required: unknown
        // names stay silent (no junk edges to std/external names).
        const p = node.parent
        // Lambda capture binding (`[z = g]`: z binds, g reads).
        if (p && p.type === "lambda_capture_initializer" && p.namedChild(0)?.startIndex === node.startIndex) {
          const fnScope = enclosingFunctionScope()
          if (fnScope) {
            if (!fnScope.locals) fnScope.locals = new Set<string>()
            fnScope.locals.add(node.text)
          }
        } else if (isDeclarationPosition(node) && !isFunctionOwnName(node)) {
          // Declaring occurrences bind locals in walk order (flow-sensitive
          // like the C family) — lambda/catch params, local struct members,
          // enumerators. The defined function NAME itself never binds
          // (self-shadow would eat same-named overload reads; oracle parity).
          const fnScope = enclosingFunctionScope()
          if (fnScope) {
            if (this.insideFunctionBody(p)) {
              if (!fnScope.locals) fnScope.locals = new Set<string>()
              fnScope.locals.add(node.text)
            }
          }
        } else if (
          node.text &&
          // D1, EDGE GATE. The roster gate above is the structural fix; this is
          // the edge-level guarantee, so the impossibility holds on the row
          // itself even if a future path adds a name to a roster directly. A
          // keyword names no value, so it is never a read.
          isCppSpelledName(node.text) &&
          !isDeclarationPosition(node) && !isPreprocText(node) &&
          // Assignment LHS is a WRITE, never a read (C CGD1 / family
          // write-is-not-a-use contract — plain and compound assignments
          // both carry the LHS as first named child).
          !((p && p.type === "assignment_expression") &&
            p.namedChild(0)?.startIndex === node.startIndex &&
            (p.namedChild(0)?.endIndex ?? 0) >= node.endIndex) &&
          // Call callee (span-matched like C CGD17, climbing through
          // template/dependent/parenthesized wrappers like the calls
          // branch's calleeLeaf) — the calls branch owns it.
          !isCallCallee(node) &&
          // Member leaves — the field path owns them (both read and call
          // positions). The OBJECT of a field access is a genuine read and
          // stays (CGD31 contract): only the field-role leaf is skipped.
          // CPPD14: seen through template wrappers (`key.get_ref<string_t&>()`).
          !isMemberLeaf(node) &&
          // Qualified reads (`ns::x`) — limitation, stays silent.
          !hasQualifiedAncestor(node) &&
          // Labels and attributes never name values.
          !(p && (p.type === "goto_statement" || p.type === "labeled_statement")) &&
          !hasAttributeAncestor(node)
        ) {
          const fnScope = enclosingFunctionScope()
          const shadowed = !!fnScope?.locals?.has(node.text)
          if (!shadowed && isResolvableRead(node.text)) {
            const source = parentContext?.name || "global"
            const relKey = `${source}::uses::${node.text}`
            if (!usesSeen.has(relKey)) {
              usesSeen.add(relKey)
              relationships.push({
                source,
                target: node.text,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 1.0,
                line_number: this.nodeLine(node),
                metadata: { relationshipType: "identifier_usage", nodeType: node.type },
              })
            }
          }
        }
      }

      if (pushedScope) {
        stack.push({ node, parentContext: newContext, isExit: true })
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          stack.push({ node: child, parentContext: newContext })
        }
      }
    }

    // Populate exports for file-scope public symbols
    // M49 JVM-closure exports invariant (F3 gate in run-fixtures.ts): export
    // names must be UNIQUE and resolve to top-level symbols. The old
    // class-scope member branch emitted methods/ctors (duplicate `run`/
    // `log`/`constructor` across classes; `operator()` payloads) — the
    // member half is removed; membership rides Contains. Members of anonymous
    // (unnamed-namespace) constructs are likewise dropped.
    const seenExportNames = new Set<string>()
    for (const sym of symbols) {
      if (!sym.ownerName && !sym.ownerKind) {
        // File-scope: global namespace
        const isPrivate = sym.visibility === "private" || sym.isStatic
        // #919: a macro-declared body's heading is the file's test/block
        // heading, not an exported API — the generated function has internal
        // linkage in every macro that writes this shape (gtest's TEST, doctest's
        // TEST_CASE, fmt's own macros), so it is not an export.
        const isMacroExpansion = sym.metadata?.expandedFrom === "macro-heading"
        if (!isPrivate && !isMacroExpansion && !sym.name.startsWith("anonymous") && !seenExportNames.has(sym.name)) {
          seenExportNames.add(sym.name)
          exports.push({
            name: sym.name,
            kind: sym.kind,
            range: sym.range,
            visibility: sym.visibility || "public",
          })
        }
      }
    }

    // POST-LOOP override resolution: every class and virtual is known now.
    // Resolves transitively (A->B->C) with a depth cap.
    {
      const resolves = (startCls: string, method: string, params: string): string[] => {
        const found: string[] = []
        const seen = new Set<string>()
        const queue = [startCls]
        let depth = 0
        while (queue.length && depth < 10) {
          depth++
          const cls = queue.shift()!
          if (seen.has(cls)) continue
          seen.add(cls)
          for (const base of classBases.get(cls) ?? []) {
            // CROSS-FILE BASE COLLISION GUARD: `class format_facet : public
            // fmt::format_facet<std::locale>` leaf-cleans to a base named
            // `format_facet` — identical to the class's own name. Resolving it
            // against the in-file registry (which holds the class's OWN
            // methods) fabricates a self-override (`format_facet.do_put ->
            // format_facet.do_put`). A class cannot inherit from itself, so any
            // base equal to the start class is a cross-file name collision and
            // must be skipped, not resolved.
            if (base === startCls) continue
            const baseSigs = classVirtuals.get(base)
            // SIGNATURE-AWARE: a same-name DIFFERENT-parameter overload is
            // C++ name-hiding, not virtual dispatch. CPPD11: the registry is
            // now a per-name LIST of signatures — any matching signature is a
            // real virtual override.
            if (baseSigs && (baseSigs.get(method) ?? []).includes(params)) found.push(base)
            queue.push(base)
          }
        }
        return found
      }
      // CPPD11: overloads whose sigs all override the same base collapse to
      // the same (cls.method, base.method) pair under the no-arity edge model
      // — emit each pair once.
      const seenOv = new Set<string>()
      for (const pend of pendingOverrides) {
        for (const base of resolves(pend.cls, pend.method, pend.params)) {
          const k = `${pend.cls}.${pend.method}|${base}.${pend.method}`
          if (seenOv.has(k)) continue
          seenOv.add(k)
          relationships.push({
            source: `${pend.cls}.${pend.method}`,
            target: `${base}.${pend.method}`,
            type: ASTEngine.RelationshipType.Overrides,
            confidence: 0.9,
            // M59.A7 (#825): the overriding method's own declaration site (the
            // pending record carries the line captured where the method was
            // walked — a post-loop resolution has no node to ask).
            line_number: pend.line,
            metadata: { isVirtualOverride: true, reasonCode: "signature-match" },
          })
        }
      }
    }

    // Post-loop: add contains for owned symbols (class→method, class→field, namespace→class)
    //
    // D3: ONE EDGE PER PAIR. `contains` is a containment relation between two
    // named entities — `person contains constructor` is a fact about the class,
    // not a fact about each of its overloads. But constructors are normalized to
    // the single name "constructor" (the family contract, C# parity) and
    // operator overloads keep their spelling, so a class with 14 constructors
    // published 14 identical rows, and two same-named members published two.
    // Measured 841 excess `contains` rows over 554 real C++ files (fmt +
    // nlohmann-json), the top pairs being `person constructor` x14 and
    // `formatter format` x12.
    //
    // The FIRST occurrence wins, and walk order is source order, so the edge
    // lands on the first declaration of the name — which is the declaration a
    // consumer navigating to the name wants. The overloads remain as SYMBOLS
    // (each with its own range and line); only the duplicated EDGE is dropped,
    // so nothing that was resolvable stops being resolvable.
    //
    // `calls` is deliberately NOT deduped here, and that is a measured
    // distinction rather than an oversight: line N calling `foo` and line M
    // calling `foo` are two facts, each carrying its own M59.A7 `line_number`,
    // and the C, TypeScript and Java lanes all emit both. The family's
    // "one edge per pair" set (`emittedUseRelationships` in C, `usesSeen` here)
    // covers `uses`/`references` — the read/include shapes, where many sites
    // express one fact.
    const containsSeen = new Set<string>()
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (!_owner) continue
      const relKey = `${_owner} ${s.name}`
      if (containsSeen.has(relKey)) continue
      containsSeen.add(relKey)
      relationships.push({
        source: _owner,
        target: s.name,
        type: ASTEngine.RelationshipType.Contains,
        confidence: 1.0,
        // M59.A7 (#825) + #921 (M60): a contains edge takes the CHILD's line,
        // and "the child's line" means the line that NAMES it — the rule every
        // other relationship type already follows (`nameLine`) and the rule the
        // M59 Tier A oracle checks. The symbol's RANGE still starts at its whole
        // declaration node (search, edit anchors and the M73 line base read
        // that), so the two are no longer forced to agree: a wrapped return
        // type used to put the edge on the declaration's first line, where the
        // name is not written (`void NORETURN` then `CheckFailed(…)`).
        line_number: (s.metadata as any)?.nameLine ?? s.range?.startLine,
        metadata: {},
      })
    }



    // Dedupe direct-attached qualified_calls per symbol (a method calling the
    // same target twice must list it once — the old Set-merge did this).
    for (const sym of symbols) {
      if (Array.isArray(sym.qualified_calls) && sym.qualified_calls.length > 1) {
        sym.qualified_calls = [...new Set(sym.qualified_calls)]
      }
    }

    // #419-D evidence tiers on EVERY edge (family classifier).
    this.classifyEvidenceTier(relationships)

    return {
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: 1 + fileDecisions,
        complexity: 1 + fileDecisions,
        patterns: (() => { const arr: string[] = []; for (const p in patterns) arr.push(p); return arr; })(),
        detectedFrameworks: (() => { const arr: string[] = []; for (const f in frameworks) arr.push(f); return arr; })(),
        memorySafetyScore,
      },
    }
  }

  // CP2 (cpp review): test/macro function shapes — `TEST(suite, name)
  // {...}`, `BOOST_AUTO_TEST_CASE(x) {...}` parse as function_definitions
  // whose declarator params are BARE identifiers (macro paste-tokens, no
  // types). Minting a `TEST` Function symbol per site (11 in one file) and
  // resolving reads against it fabricates API + edges for a preprocessor
  // fiction (C-D2: no macro expansion). Detection: ALL-CAPS declarator
  // name + a non-empty parameter list in which NO parameter carries a type
  // node. Real functions always type their params (`void f()`/`f(void)`
  // have empty/void lists and are kept); ALL-CAPS real functions with
  // typed params (`WINAPI Foo(int)`) are kept.
  // #919: the heading TEXT of a `function_definition`-spelled macro body — from
  // the node's start to the end of its parameter list, i.e. exactly the text the
  // source writes before the block (`TEST(my_case, keeps_its_locals)`). Returns
  // null when the shape has no body (a decorator fragment such as gmock's
  // `GTEST_LOCK_EXCLUDED_(g_gmock_mutex) = 0;`), because then there is no
  // heading/body pair at all.
  private macroHeadingText(node: Node, content: string, funcName: string): string | null {
    if (!node.childForFieldName("body")) return null
    const decl = this.findChild(node, "function_declarator")
    if (!decl) return null
    // The heading starts at the MACRO'S NAME, never at the node's start: the
    // grammar's recovery can swallow a preceding statement into this
    // `function_definition`'s specifier region (measured: `FMT_END_NAMESPACE\n\n
    // TEST(args_test, custom_format) {…}` makes the node start at the earlier
    // macro line), and the node may equally swallow LATER code into its
    // argument list. The name identifier is the declarator's own leftmost
    // identifier — the same occurrence `getFunctionDetails` named — and the text
    // runs to the close of that name's own paren group (see
    // `macroInvocationText` for why structural slicing cannot do this).
    let nameNode: Node | null = null
    {
      let cur: Node | null = decl
      while (cur) {
        if ((cur.type === "identifier" || cur.type === "field_identifier") && cur.text === funcName) { nameNode = cur; break }
        let next: Node | null = null
        for (let k = 0; k < cur.namedChildCount; k++) {
          const c = cur.namedChild(k)
          if (c && (c.type.endsWith("declarator") || c.type === "identifier" || c.type === "field_identifier")) { next = c; break }
        }
        cur = next
      }
    }
    if (!nameNode) return null
    return macroInvocationText(content, nameNode.startIndex)
  }

  // #919: is this node inside a function BODY? Two shapes qualify — a
  // `function_definition`, and the body of a macro-declared heading (which has
  // no `function_definition` at all: see `macroDeclaredBody`). A class/struct/
  // union boundary ends the search, exactly as the inline walk did before this
  // was factored out: a declaration inside a nested class belongs to that class,
  // not to the enclosing function whose locals we are collecting.
  private insideFunctionBody(node: Node | null): boolean {
    let cur: Node | null = node
    while (cur) {
      if (cur.type === "function_definition") return true
      if (cur.type === "class_specifier" || cur.type === "struct_specifier" ||
          cur.type === "union_specifier") return false
      if (macroDeclaredBody(cur)) return true
      cur = cur.parent
    }
    return false
  }

  private isMacroFunctionShape(node: Node, funcName: string): boolean {
    if (!this.isAllCapsName(funcName)) return false
    const decl = this.findChild(node, "function_declarator")
    if (!decl) return false
    const params = decl.childForFieldName("parameters")
    if (!params || params.namedChildCount === 0) return false
    for (let i = 0; i < params.namedChildCount; i++) {
      const p = params.namedChild(i)
      if (!p) continue
      if (p.type === "comment") continue
      if (this.paramHasType(p)) return false
    }
    return true
  }

  // #915: a bare top-level macro must not become a `variable`. Two consecutive
  // macros at file scope are recovered by the grammar as a `declaration` whose
  // "type" is itself a macro and whose terminator is MISSING
  // (`FMT_END_EXPORT` / `FMT_END_NAMESPACE` -> type_identifier + identifier +
  // MISSING `;`), and the declaration branch then names the symbol after the
  // second macro. Measured on fmt: 13 such phantoms in a 58-file draw, all bare
  // ALL-CAPS macro names (`variable FMT_END_NAMESPACE` x8, `GTEST_ATTRIBUTE_UNUSED_`
  // x2, `RUN_ALL_TESTS`, `GTEST_DEFAULT_DEATH_TEST_STYLE`, `FMT_BEGIN_EXPORT`),
  // and 0 on nlohmann-json. This is the BARE sibling of the call-shaped class
  // `isMacroFunctionShape` already suppresses.
  //
  // Three conditions, each doing real work — the first two alone would lose a
  // real symbol:
  //   * the name is ALL-CAPS            (`MAX_SIZE` stays a symbol, `MAX_SIZE;`)
  //   * the node is ERROR-RECOVERED     (a clean `MyType MAX_SIZE;` is kept,
  //                                      because its terminator is real; only
  //                                      already-broken code is affected)
  //   * it carries NO hard type         (`int MAX_SIZE` and
  //                                      `MyType *MAX_SIZE` are kept — a lone
  //                                      `type_identifier` is the grammar's
  //                                      classification of macro soup, not a type,
  //                                      the same reading `paramHasType` uses)
  private isBareMacroDeclaration(node: Node, name: string): boolean {
    if (!this.isAllCapsName(name)) return false

    let recovered = false
    const walkRecovered: Node[] = [node]
    while (walkRecovered.length > 0) {
      const m = walkRecovered.pop()!
      if (m.isMissing || m.isError) {
        recovered = true
        break
      }
      for (let i = 0; i < m.childCount; i++) {
        const c = m.child(i)
        if (c) walkRecovered.push(c)
      }
    }
    if (!recovered) return false

    const walkType: Node[] = [node]
    while (walkType.length > 0) {
      const m = walkType.pop()!
      if (
        m.type === "primitive_type" || m.type === "sized_type_specifier" ||
        m.type === "template_type" || m.type === "qualified_identifier" ||
        m.type === "dependent_type" || m.type === "decltype" ||
        m.type === "struct_specifier" || m.type === "union_specifier" ||
        m.type === "enum_specifier" || m.type === "class_specifier" ||
        m.type === "placeholder_type_specifier" || m.type === "macro_prefixed_type_specifier"
      ) {
        return false
      }
      for (let i = 0; i < m.childCount; i++) {
        const c = m.child(i)
        if (c) walkType.push(c)
      }
    }
    return true
  }

  private isAllCapsName(name: string): boolean {
    let hasUpper = false
    for (let i = 0; i < name.length; i++) {
      const c = name[i]
      if (c >= "a" && c <= "z") return false
      if (c >= "A" && c <= "Z") hasUpper = true
    }
    return hasUpper
  }

  private paramHasType(param: Node): boolean {
    // A parameter is typed iff it carries an unambiguous type node
    // (primitive/sized/template/qualified/typename/decltype/struct/union/
    // enum) or a type_identifier BESIDE a distinct declarator identifier
    // (`MyClass x`). A LONE type_identifier is the grammar's classification
    // of a bare macro-soup name (`TEST(a, b)` → type_identifier(a)) — NOT a
    // type. Accepted residual: `void F(T)` (all-caps, single abstract
    // type_identifier param) misreads as macro — near-nonexistent in real
    // code, and both sides skip identically so no edge pair can result.
    let sawHardType = false
    let sawTypeIdent = false
    let sawNameIdent = false
    const stack: Node[] = [param]
    while (stack.length > 0) {
      const m = stack.pop()!
      if (
        m.type === "primitive_type" || m.type === "sized_type_specifier" ||
        m.type === "template_type" || m.type === "qualified_identifier" ||
        m.type === "dependent_type" || m.type === "decltype" ||
        m.type === "struct_specifier" || m.type === "union_specifier" ||
        m.type === "enum_specifier"
      ) {
        sawHardType = true
        break
      }
      if (m.type === "type_identifier") sawTypeIdent = true
      if (m.type === "identifier" || m.type === "field_identifier") sawNameIdent = true
      for (let i = 0; i < m.namedChildCount; i++) {
        const c = m.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return sawHardType || (sawTypeIdent && sawNameIdent)
  }

  /**
   * M60.P1 `decorators`: a declaration's modifiers, as the SOURCE SPELLINGS the
   * node carries, in source order — so a consumer reads `["static", "constexpr"]`
   * instead of reversing four booleans back into words.
   *
   * This is the declared payload field, and the `metadata` flags
   * (`isVirtual`/`isConst`/`isConstexpr`/`isStatic`) were duplicating its content
   * without ever filling it: the M60 payload-seam matrix recorded
   * `UniversalSymbol.decorators` as a DEAD emit cell for cpp while this file's own
   * documentation claimed the row was supported.
   *
   * Shared by the function and the field/variable branch, because
   * `static constexpr int kMax = 10;` carries exactly as much modifier
   * information as `virtual int area() const = 0;` and a payload field that only
   * answered for one of them is a field a consumer cannot rely on.
   *
   * A destructor and an operator overload are deliberately ABSENT: `~File` and
   * `operator==` are part of the NAME, not modifiers applied to it, and listing
   * them here would put a name in a field whose meaning is "applied to this
   * declaration".
   *
   * The scan keys off the child's TEXT and EXCLUDES the declaration's own
   * payload fields (`type`, `declarator`, `default_value`, …), not off
   * `isNamed`. The grammar is inconsistent here and both forms occur in this
   * lane's own fixtures: `virtual int area() const = 0;` exposes `virtual` as an
   * UNNAMED token, while `static constexpr int kMax = 10;` exposes `static` and
   * `constexpr` as NAMED `storage_class_specifier` / `type_qualifier` wrappers.
   * A rule that only read unnamed tokens would find the modifier on the method
   * and miss it on the field, which is the worst of both — a payload field that
   * answers sometimes.
   */
  private declarationDecorators(node: Node, declarator: Node | null = null): string[] {
    const out: string[] = []
    const MODIFIERS = new Set([
      "static", "constexpr", "const", "inline", "virtual", "explicit", "extern",
      "friend", "mutable", "thread_local", "volatile", "override", "final",
    ])
    // Fields that carry the DECLARATION's own payload. A child in one of these
    // is content the author wrote inside the declaration, so matching it against
    // a modifier word would read a VALUE as a modifier — the risk that makes an
    // `isNamed`-only rule tempting, and the reason it is wrong.
    const PAYLOAD_FIELDS = new Set([
      "type", "declarator", "default_value", "value", "initializer", "parameters",
      "body", "name", "argument", "condition", "left", "right", "operator",
    ])
    const seen = new Set<string>()
    const scan = (n: Node | null) => {
      if (!n) return
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c) continue
        const field = n.fieldNameForChild ? n.fieldNameForChild(i) : null
        if (field && PAYLOAD_FIELDS.has(field)) continue
        if (MODIFIERS.has(c.text) && !seen.has(c.text)) {
          seen.add(c.text)
          out.push(c.text)
        }
      }
    }
    scan(node)
    // The DECLARATOR carries the modifiers that belong to the function itself,
    // and they are the ones a declaration-only scan always missed: a method's
    // trailing `const` (`int sum() const`) and its `override`/`final`
    // `virtual_specifier`s are children of the `function_declarator`, not of the
    // declaration. `const` is on essentially every getter in the corpus, so a
    // rule that stopped at the declaration published `decorators: []` for all of
    // them while looking correct on `static`/`virtual`, which DO sit on the
    // declaration. Two nodes, one scan each, and the list is complete.
    scan(declarator)
    return out
  }

  private buildParamSig(parametersNode: Node | null): string {
    // CPPD5 (M37.9 fmt probe, gtest.h): parameter TYPE-ONLY signature. Each
    // parameter_declaration's name lives in its trailing `declarator` field;
    // the TYPE is the parameter text minus that declarator. Names, comments
    // (`/*test_info*/`), and whitespace never enter the signature — matching
    // real C++ overload semantics where only the types discriminate.
    //
    // D8 (M60.P1): the slice is taken at the NAME node, not at the declarator.
    // A `reference_declarator`'s text is `& b` and its start index points at the
    // `&`, so subtracting the declarator's LENGTH from the parameter text turned
    // `const std::string& b` into `const std::string` and `const char* p` into
    // `const char`. That is not a cosmetic slip in a display field — this
    // signature IS the override-matching key, so `virtual void f(Widget&)` and
    // `virtual void f(Widget)` hashed to the SAME signature and a derived
    // `void f(Widget)` matched the base's `f(Widget&)`. It is the same slice the
    // published `parameters` payload had to learn (see `declaratorParameters`),
    // and the two are now the same rule for the same reason.
    if (!parametersNode) return ""
    const parts: string[] = []
    for (let i = 0; i < parametersNode.namedChildCount; i++) {
      const pc = parametersNode.namedChild(i)
      if (!pc) continue
      if (pc.type === "comment") continue
      if (pc.type === "variadic_parameter_declaration") {
        parts.push("...")
        continue
      }
      if (pc.type !== "parameter_declaration" && pc.type !== "optional_parameter_declaration") {
        // stray nodes: include raw text, as before — an unreadable parameter is
        // not silently dropped, because a dropped one makes two signatures equal
        continue
      }
      // `= default` / `= expr` is not part of the signature either; the type text
      // precedes the `=`.
      const eqAt = pc.text.indexOf("=")
      const nameNode = this.declaredNameNodeFor(pc)
      let t = pc.text
      if (nameNode) {
        const cut = nameNode.startIndex - pc.startIndex
        if (cut > 0) t = t.slice(0, cut)
      } else if (eqAt !== -1) {
        t = t.slice(0, eqAt)
      }
      t = t.trim()
      if (t) parts.push(t)
    }
    return parts.join(",")
  }

  /**
   * D8: the declared name node of a `parameter_declaration` /
   * `optional_parameter_declaration`, for the signature slice. A thin wrapper so
   * the two call sites that need it (`buildParamSig`) read the same name the
   * published `parameters` payload does.
   */
  private declaredNameNodeFor(param: Node): Node | null {
    const d: Node | null = param.childForFieldName?.("declarator") ?? null
    if (!d) return null
    let cur: Node | null = d
    for (let i = 0; i < 8 && cur; i++) {
      if (cur.type === "identifier" || cur.type === "field_identifier") return cur
      cur = cur.childForFieldName?.("declarator") ?? null
    }
    return null
  }

  private methodComplexityCpp(node: Node): number {
    // T1 family contract: 1 + decision points (branch constructs +
    // short-circuit operators; else adds nothing).
    const decisionTypes = new Set([
      "if_statement", "for_statement", "while_statement", "do_statement",
      "case_statement", "catch_clause", "conditional_expression",
    ])
    let c = 1
    const st: Node[] = [node]
    while (st.length) {
      const n = st.pop()!
      if (decisionTypes.has(n.type)) c++
      else if (n.type === "binary_expression") {
        const op = n.childForFieldName("operator")?.text
        if (op === "&&" || op === "||") c++
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const ch = n.namedChild(i)
        if (ch) st.push(ch)
      }
    }
    return c
  }

  /**
   * #419-D - evidence-tier classification for EVERY emitted relationship
   * (same rules as the JVM/web family).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "references") { md.evidenceClass = md.isImport ? "import_based" : "reference_qualified"; continue }
      if (t === "extends" || t === "implements" || t === "overrides") {
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") { md.evidenceClass = "structural"; continue }
      md.evidenceClass = "usage_contextual"
    }
  }

  /**
   * M59.A7 (#825): the line of the node that NAMES a relationship, 1-based, or
   * `undefined` when the site is not attributable — never a fabricated 0 and
   * never an enclosing declaration's line. The C lane carries the identical
   * helper; the contract is "call-site line or NULL" (M59.O2).
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node || !node.startPosition || typeof node.startPosition.row !== "number") return undefined
    return node.startPosition.row + 1
  }

  /**
   * M59.A7 (#825): a type expression's start is not the line of the names inside
   * it. A specifier starts at its KEYWORD, and a wrapped declaration puts the
   * name on the following line:
   *
   *   struct          <- the specifier's start
   *   Bigint {        <- where the name is written
   *
   * The grammar's `name` field is the site when it exists; otherwise the node is.
   * (Mirror of the C lane's `nameLine`.)
   */
  private nameLine(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    const nameField =
      typeof (node as any).childForFieldName === "function" ? node.childForFieldName("name") : null
    return this.nodeLine(nameField ?? node)
  }

  private nodeToRange(node: Node) {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private findChild(node: Node, type: string, text?: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) {
        if (text === undefined || child.text === text) return child
      }
    }
    return null
  }

  private findAllChildren(node: Node, type: string): Node[] {
    const res: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) res.push(child)
    }
    return res
  }

  private childText(node: Node, type: string): string | null {
    const child = this.findChild(node, type)
    return child ? child.text : null
  }

  private hasDirectModifier(node: Node, modifier: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.text === modifier) return true
      if (
        (child.type === "type_qualifier" ||
          child.type === "storage_class_specifier" ||
          child.type === "virtual_specifier") &&
        child.text === modifier
      ) {
        return true
      }
    }
    // Also check inside function_declarator for virtual_specifier (override keyword)
    const funcDecl = this.findChild(node, "function_declarator")
    if (funcDecl) {
      for (let i = 0; i < funcDecl.childCount; i++) {
        const child = funcDecl.child(i)
        if (child?.type === "virtual_specifier" && child.text === modifier) return true
      }
    }
    return false
  }

  /**
   * #921 (M60): `nameNode` is the node whose text IS the declared name (the
   * qualified form returns its LAST named child, the constructor/destructor and
   * operator spellings included). The containment edge needs the line that
   * NAMES the child — a wrapped return type puts the name one or more lines
   * below the declaration's start (`void NORETURN` then `CheckFailed(…)`).
   */
  private getFunctionDetails(
    node: Node,
  ): { name: string; scope?: string; isDestructor: boolean; isOperator: boolean; nameNode: Node } | null {
    // CPPD17/CPPD18 (#612 family round): the function_declarator can sit UNDER a
    // declarator wrapper, because a macro between the return type and the name
    // changes how the grammar nests the declaration. Measured in
    // `include/nlohmann/json_v3_10_5.hpp` (`binary_reader::sax_parse`):
    //
    //   JSON_HEDLEY_NON_NULL(3)
    //   bool sax_parse(const input_format_t format, …, const bool strict = true) { … }
    //     function_definition
    //       parenthesized_declarator        <- the macro's own parens, recovered
    //         function_declarator           <- the real declarator, one level down
    //
    // This lookup was DIRECT (`findChild` scans one level), with a one-level
    // pointer/reference fallback for a wrapped RETURN type. Neither reaches a
    // `parenthesized_declarator`, so this method returned null — and the caller
    // pushes the function's SYMBOL and its SCOPE out of this result, so the
    // method vanished and, with no function scope, the body's parameter reads
    // resolved OUTWARD. That is the whole of the lane's one remaining unexplained
    // edge at the nlohmann full extent (`uses binary_reader -> strict @8299`: the
    // parameter `strict` reaching `error_handler_t::strict` 8k lines away).
    // The descent is the declarator CHAIN (pointer/reference/parenthesized), the
    // same wrappers the rest of this file already unwraps for names and types, and
    // it SUBSUMES the one-level pointer/reference fallback it replaces.
    let decl = this.findChild(node, "function_declarator")
    if (!decl) {
      const WRAPPERS = ["pointer_declarator", "reference_declarator", "parenthesized_declarator"]
      let cur: Node | null = null
      for (const w of WRAPPERS) { cur = this.findChild(node, w); if (cur) break }
      for (let i = 0; cur && i < 8; i++) {
        const found = this.findChild(cur, "function_declarator")
        if (found) { decl = found; break }
        let next: Node | null = null
        for (const w of WRAPPERS) { next = this.findChild(cur, w); if (next) break }
        cur = next
      }
    }

    if (!decl) return null

    // CPPD17 (#612 family round): the NAME can be WRAPPED one declarator down.
    // The grammar keeps `function_declarator` direct under the definition but
    // routes a parenthesized NAME through its declarator field:
    //
    //   bool parse_result(const bool strict = true) { … }
    //     function_declarator[declarator: field_identifier parse_result, …]
    //   bool (parse_result)(const bool strict = true) { … }
    //     function_declarator[declarator: parenthesized_declarator[field_identifier], …]
    //
    // The lookups below scan the declarator's DIRECT named children, so the
    // wrapped spelling found no name at all and this method returned null — and
    // with it went the method's SYMBOL *and*, because the caller pushes the
    // function scope out of this result, the function scope itself. Measured on
    // the nlohmann-json full extent (496 files, the first .cpp-inclusive run):
    // `include/nlohmann/json_v3_10_5.hpp` declares its readers this way, and with
    // no scope there is no function-local roster for the body's reads to consult,
    // so every parameter read resolved OUTWARD — the lane's one remaining
    // unexplained edge, `uses binary_reader -> strict @8299` (the parameter
    // `strict` reaching the namespace-scope enumerator `error_handler_t::strict`
    // 8k lines away). Minimal reproduction, same defect on both spellings:
    // fixture-shaped `bool parse_result(const bool strict = true)` publishes the
    // symbol and binds the parameter; `bool (parse_result)(…)` published neither.
    // The descent is the declarator CHAIN only (parenthesized wrappers; repeated
    // spelling `((name))` cannot recurse more than a few levels) and stops at the
    // same five name kinds, so qualified/operator/destructor spellings keep the
    // handling below unchanged.
    let nameNode: Node | null = null
    {
      let cur: Node | null = decl
      for (let i = 0; cur && i < 8; i++) {
        nameNode =
          this.findChild(cur, "identifier") ||
          this.findChild(cur, "field_identifier") ||
          this.findChild(cur, "destructor_name") ||
          this.findChild(cur, "operator_name") ||
          this.findChild(cur, "qualified_identifier")
        if (nameNode) break
        cur = this.findChild(cur, "parenthesized_declarator")
      }
    }

    if (!nameNode) return null
    // #921: the node the returned name was READ FROM, kept so the caller can ask
    // the tree (not a text search) where the name is written.
    let namedNode: Node = nameNode

    let name = nameNode.text
    let scope: string | undefined = undefined
    let isDestructor = nameNode.type === "destructor_name" || name.startsWith("~")
    let isOperator = nameNode.type === "operator_name" || name.startsWith("operator")

    // D1, FUNCTION-NAME GATE. The declared-name choke point above cannot reach a
    // function's own name (this method reads the declarator directly), so the
    // same impossibility is enforced here: a function's name is an identifier,
    // and C++ has no identifier spelled with a keyword. Measured `noexcept` as a
    // published `function` symbol. `operator=`, `operator()` and every other
    // operator overload are ordinary names and pass — the set is an exact-match
    // test, and `operator` alone is in it precisely because nothing declares it.
    if (!isCppSpelledName(name)) return null

    if (nameNode.type === "qualified_identifier") {
      // #924: the name is the deepest qualifier's LAST segment, and a segment
      // above it is an OWNER only when a real `::` token joins them — a
      // misplaced return type rejoined to the name by the grammar is neither a
      // name nor a scope. See `qualifiedDeclaratorLeaf`.
      const parts = qualifiedDeclaratorLeaf(nameNode)
      const actualNameNode = parts?.nameNode ?? nameNode.namedChild(nameNode.namedChildCount - 1)
      const scopeQid: Node | null = parts?.scopeQid ?? null
      let scopeNode: Node | null = null
      for (let i = 0; scopeQid && i < scopeQid.namedChildCount - 1; i++) {
        const c = scopeQid.namedChild(i)
        if (c && (c.type === "namespace_identifier" || c.type === "type_identifier" || c.type === "identifier")) {
          scopeNode = c
          break
        }
        // `Registry<T>::add` — the scope is a template_type (`Registry<T>`);
        // use its underlying type name so template method definitions resolve
        // their owner correctly (instead of leaking to the namespace).
        if (c && c.type === "template_type") {
          const tname = c.childForFieldName("name") || this.findChild(c, "type_identifier")
          if (tname) {
            scopeNode = tname
            break
          }
        }
      }
      // Defensive fallback (unreachable after the descent above — the
      // deepest qualifier's first child is always a scope leaf): keep the
      // scope empty rather than guessing.
      const firstChild = scopeQid?.namedChild(0)
      if (!scopeNode && firstChild && firstChild.type === "qualified_identifier") {
        scopeNode = firstChild
      }

      if (actualNameNode) {
        name = actualNameNode.text
        namedNode = actualNameNode
        if (scopeNode) scope = scopeNode.text
        if (actualNameNode.type === "destructor_name" || name.startsWith("~")) isDestructor = true
        if (actualNameNode.type === "operator_name" || name.startsWith("operator")) isOperator = true
      }
    }

    return { name, scope, isDestructor, isOperator, nameNode: namedNode }
  }

  // ≡ /^[A-Za-z_]\w*$/ (zero-regex helper, M49 closure wave) — full-string
  // identifier shape: letter/underscore head, word-class tail. CGD19 class:
  // recovery-artifact type names (qualified, templated, mangled) fail this
  // and emit no edge.
  private isPlainIdentifier(s: string): boolean {
    if (s.length === 0) return false
    const c0 = s.charCodeAt(0)
    const firstOk = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95
    if (!firstOk) return false
    for (let i = 1; i < s.length; i++) {
      const c = s.charCodeAt(i)
      const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
      if (!ok) return false
    }
    return true
  }

  private buildFullName(scopeStack: any[], name: string): string {
    const parts: string[] = []
    for (let i = 0; i < scopeStack.length; i++) {
      if (scopeStack[i].kind === ASTEngine.SymbolKind.Namespace) {
        parts.push(scopeStack[i].name)
      }
    }
    parts.push(name)
    return parts.join("::")
  }
}
