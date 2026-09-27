#!/usr/bin/env python3
"""
Port bkegley/tree-sitter-graphql's grammar.js to the node-name contract the
vendored wasm already established, then apply the upstream bug fixes.

Why this script exists and why it is checked in next to the grammar: the node
NAMES are a public contract. `src/ast/real-graphql-analyzer.ts` dispatches on
`node.type === "ObjectTypeDefinition"`, and so do
`script/m12/graphql-node-types-compare.ts`, the m12 shape-safety artifact, the
m14/m60 language lanes, and every `.graphql` consumer of `bb_search` line
numbers. Upstream `main` is snake_case (`object_type_definition`), which would
silently route every construct through the analyzer's default branch. The
previous vendored wasm (built with an older tree-sitter CLI) exposed PascalCase
names, so the rename below is not cosmetic - it is what keeps 41 analyzer string
literals, the m12 shape-safety census, and every stored symbol live.

`source_file`, `comment` and `comma` stay lower-case because that is what the
vendored wasm exposes for them (they are the start rule and the two `extras`
rules); every other rule takes its PascalCase name from the vendored wasm's own
declared-type table, so the mapping is pinned to a measurement, not to a guess.
"""
import re
import sys

# The pristine upstream file is checked in verbatim so the port is REPRODUCIBLE:
# `python3 port.py` always reads upstream and rewrites grammar.js from scratch,
# which makes the patch reviewable as a diff and makes a re-run idempotent
# instead of a "the anchor is already gone" failure.
UPSTREAM = "$HOME/backbencher-brain/grammars/tree-sitter-graphql/grammar.upstream.js"
SRC = "$HOME/backbencher-brain/grammars/tree-sitter-graphql/grammar.js"

# snake_case rule -> the exact name the vendored wasm exposes.
# Derived from `language.nodeTypeForId` over wasm/tree-sitter-graphql.wasm
# (recorded in fixtures/graphql/out/grammar-census.json -> grammarDeclaredTypes).
RENAME = {
    "document": "Document",
    "definition": "Definition",
    "executable_definition": "ExecutableDefinition",
    "type_system_definition": "TypeSystemDefinition",
    "type_system_extension": "TypeSystemExtension",
    "schema_definition": "SchemaDefinition",
    "schema_extension": "SchemaExtension",
    "type_extension": "TypeExtension",
    "scalar_type_extension": "ScalarTypeExtension",
    "object_type_extension": "ObjectTypeExtension",
    "interface_type_extension": "InterfaceTypeExtension",
    "union_type_extension": "UnionTypeExtension",
    "enum_type_extension": "EnumTypeExtension",
    "input_object_type_extension": "InputObjectTypeExtension",
    "input_fields_definition": "InputFieldsDefinition",
    "enum_values_definition": "EnumValuesDefinition",
    "enum_value_definition": "EnumValueDefinition",
    "implements_interfaces": "ImplementsInterfaces",
    "fields_definition": "FieldsDefinition",
    "field_definition": "FieldDefinition",
    "arguments_definition": "ArgumentsDefinition",
    "input_value_definition": "InputValueDefinition",
    "default_value": "DefaultValue",
    "union_member_types": "UnionMemberTypes",
    "root_operation_type_definition": "OperationTypeDefinition",
    "operation_definition": "OperationDefinition",
    "operation_type": "OperationType",
    "type_definition": "TypeDefinition",
    "scalar_type_definition": "ScalarTypeDefinition",
    "object_type_definition": "ObjectTypeDefinition",
    "interface_type_definition": "InterfaceTypeDefinition",
    "union_type_definition": "UnionTypeDefinition",
    "enum_type_definition": "EnumTypeDefinition",
    "input_object_type_definition": "InputObjectTypeDefinition",
    "variable_definitions": "VariableDefinitions",
    "variable_definition": "VariableDefinition",
    "selection_set": "SelectionSet",
    "selection": "Selection",
    "field": "Field",
    "alias": "Alias",
    "arguments": "Arguments",
    "argument": "Argument",
    "value": "Value",
    "variable": "Variable",
    "string_value": "StringValue",
    "int_value": "IntValue",
    "float_value": "FloatValue",
    "boolean_value": "BooleanValue",
    "null_value": "NullValue",
    "enum_value": "EnumValue",
    "list_value": "ListValue",
    "object_value": "ObjectValue",
    "object_field": "ObjectField",
    "fragment_spread": "FragmentSpread",
    "fragment_definition": "FragmentDefinition",
    "fragment_name": "FragmentName",
    "inline_fragment": "InlineFragment",
    "type_condition": "TypeCondition",
    "directives": "Directives",
    "directive": "Directive",
    "directive_definition": "DirectiveDefinition",
    "directive_locations": "DirectiveLocations",
    "directive_location": "DirectiveLocation",
    "executable_directive_location": "ExecutableDirectiveLocation",
    "type_system_directive_location": "TypeSystemDirectiveLocation",
    "type": "Type",
    "named_type": "NamedType",
    "list_type": "ListType",
    "non_null_type": "NonNullType",
    "name": "Name",
    "description": "Description",
    # deliberately NOT renamed - these three are lower-case in the vendored wasm:
    # "source_file", "comment", "comma"
}

# Longest first so `type_system_definition` is not eaten by `type`.
ORDERED = sorted(RENAME.items(), key=lambda kv: -len(kv[0]))


def rename(src: str) -> str:
    """PascalCase the rule NAMES without touching anything else.

    Two hazards, both of which produced a broken grammar.js on the first
    attempt and are pinned here:

    * the `name:` key of `grammar({...})` is NOT a rule. Renaming it produces a
      grammar that generates but names no language, so the rename is confined to
      the text after `rules: {`.
    * `$.x` references and rule keys must be renamed in ONE pass over a name set
      that is complete before the pass starts, or `type` eats
      `type_system_definition`. `ORDERED` exists for the reader; the regexes use
      `\b` anchors, so ordering is not load-bearing.
    """
    marker = "rules: {"
    idx = src.index(marker)
    head, body = src[: idx + len(marker)], src[idx + len(marker) :]

    # 1. `$.rule_name` references (a `$.` is unambiguous, so this is safe head-wide)
    def ref(m):
        return "$." + RENAME.get(m.group(1), m.group(1))

    head = re.sub(r"\$\.([a-z][a-z0-9_]*)", ref, head)
    body = re.sub(r"\$\.([a-z][a-z0-9_]*)", ref, body)

    # 2. rule keys, inside `rules: {` only
    def key(m):
        return m.group(1) + RENAME.get(m.group(2), m.group(2)) + ":"

    body = re.sub(r"(?m)^([ \t]+)([a-z][a-z0-9_]*):", key, body)
    return head + body


# ---------------------------------------------------------------------------
# Upstream bug fixes. Each one is a construct the GraphQL specification defines
# that upstream `main` rejects; each is measured by
# fixtures/graphql/probe/grammar-gaps.mts.
# ---------------------------------------------------------------------------
FIXES = [
    # FIX 1 — `extend schema { query: Q mutation: M }`
    # upstream: seq("extend","schema",optional($.directives),"{",$.root_operation_type_definition,"}")
    # A schema extension may add SEVERAL root operation types, and may carry only
    # directives. Measured: upstream rejects both (`ext-schema-multi`,
    # `ext-schema-directives-only`, and Apollo Federation's own
    # `extend schema @link(url: ..., import: [...])`).
    (
        """    schema_extension: ($) =>
      seq(
        "extend",
        "schema",
        optional($.directives),
        "{",
        $.root_operation_type_definition,
        "}"
      ),""",
        """    // FIX 1 also needs `prec.right`: with an optional body, the `{` after
    // `extend schema` is ambiguous (extension body vs. a new shorthand
    // operation), which `tree-sitter generate` reports as an unresolved
    // conflict. Every other `*_type_extension` in this grammar already
    // resolves the same ambiguity with prec.right; this one is now shaped like
    // them. The shift side is the extension, which is what Apollo Federation
    // emits (`extend schema @link(...)` with no body at all).
    schema_extension: ($) =>
      prec.right(
        seq(
          "extend",
          "schema",
          optional($.directives),
          optional(seq("{", repeat1($.root_operation_type_definition), "}"))
        )
      ),""",
    ),
    # FIX 2 — `extend scalar S` with no directive
    # upstream: seq("extend","scalar",$.name,$.directives) — `$.directives` is
    # `repeat1`, so the directive is MANDATORY. Spec 3.17 allows a bare
    # `extend scalar S`. Measured: upstream rejects `ext-scalar`.
    (
        """    scalar_type_extension: ($) => seq("extend", "scalar", $.name, $.directives),""",
        """    scalar_type_extension: ($) => seq(
      "extend",
      "scalar",
      $.name,
      optional($.directives)
    ),""",
    ),
    # FIX 3 — two directives on one field selection: `{ f @a @b }`
    # upstream: `optional($.directive)` — singular. `directives` is `repeat1`, so
    # `@a @b` is the legal spelling and it is the spelling every real client
    # emits. Measured: upstream rejects `field-two-directives`; the previous
    # vendored grammar accepted it, so this is a REGRESSION GUARD, not a new fix.
    (
        """        optional($.alias),
        $.name,
        optional($.arguments),
        optional($.directive),
        optional($.selection_set)""",
        """        optional($.alias),
        $.name,
        optional($.arguments),
        optional($.directives),
        optional($.selection_set)""",
    ),
]


# FIX 4 is a whole-rule replacement, so it is expressed as (find, repl) on the
# rule body rather than as a small anchor. Raw strings: the backslashes below are
# the JavaScript source's own backslashes and must survive verbatim into grammar.js.
# Triple-single-quoted because the rule body itself contains '"""', which would
# terminate a Python triple-double-quoted string.
STRING_VALUE_UPSTREAM = r'''    string_value: ($) =>
      choice(
        seq('"""', /([^"]|\n|""?[^"])*/, '"""'),
        seq('"', /[^"\\\n]*/, '"')
      ),'''

STRING_VALUE_PATCHED = r'''    StringValue: ($) =>
      choice(
        seq('"""', /([^"\\]|"[^"]|"{2}[^"]|\\(.|\n))*/, '"""'),
        seq('"', /([^"\\\n]|\\[^\n])*/, '"')
      ),'''


def apply_fixes(src: str) -> str:
    for find, repl in FIXES:
        if find not in src:
            sys.exit(f"FIX anchor not found; refusing to write a half-ported grammar:\n{find}")
        src = src.replace(find, repl, 1)
    if STRING_VALUE_UPSTREAM not in src:
        sys.exit("STRING_VALUE anchor not found; refusing to write a half-ported grammar")
    src = src.replace(STRING_VALUE_UPSTREAM, STRING_VALUE_PATCHED, 1)
    return src


def main() -> None:
    with open(UPSTREAM, encoding="utf-8") as fh:
        original = fh.read()
    # The FIX anchors are written in upstream's snake_case, so they must be
    # applied BEFORE the rename; renaming first would make every anchor miss.
    fixed = apply_fixes(original)
    renamed = rename(fixed)

    header = (
        "// VENDORED, PATCHED GRAMMAR — read grammars/tree-sitter-graphql/README.md\n"
        "// before changing anything here.\n"
        "//\n"
        "// Upstream: github.com/bkegley/tree-sitter-graphql (MIT), `main` @ ee5ce96.\n"
        "// Two deliberate, load-bearing divergences from upstream:\n"
        "//   1. Rule NAMES are PascalCase, matching the wasm this repository\n"
        "//      vendored before (#GQL). src/ast/real-graphql-analyzer.ts dispatches on\n"
        "//      `node.type === \"ObjectTypeDefinition\"`; upstream's snake_case names\n"
        "//      would send every construct down the analyzer's default branch.\n"
        "//   2. Three upstream rules that reject specification-valid GraphQL are\n"
        "//      fixed in place and each carries a FIX comment naming the construct.\n"
        "//\n"
        "// Regenerate + rebuild after any edit here:\n"
        "//   cd grammars/tree-sitter-graphql && tree-sitter generate && tree-sitter build --wasm -o ../../wasm/tree-sitter-graphql.wasm\n"
        "// Then re-run every gate; see grammars/tree-sitter-graphql/README.md.\n\n"
    )
    with open(SRC, "w", encoding="utf-8") as fh:
        fh.write(header + renamed)
    print("wrote", SRC)


if __name__ == "__main__":
    main()
