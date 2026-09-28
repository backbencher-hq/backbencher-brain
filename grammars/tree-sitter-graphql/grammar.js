// VENDORED, PATCHED GRAMMAR — read grammars/tree-sitter-graphql/README.md
// before changing anything here.
//
// Upstream: github.com/bkegley/tree-sitter-graphql (MIT), `main` @ ee5ce96.
// Two deliberate, load-bearing divergences from upstream:
//   1. Rule NAMES are PascalCase, matching the wasm this repository
//      vendored before (#GQL). src/ast/real-graphql-analyzer.ts dispatches on
//      `node.type === "ObjectTypeDefinition"`; upstream's snake_case names
//      would send every construct down the analyzer's default branch.
//   2. Three upstream rules that reject specification-valid GraphQL are
//      fixed in place and each carries a FIX comment naming the construct.
//
// Regenerate + rebuild after any edit here:
//   cd grammars/tree-sitter-graphql && tree-sitter generate && tree-sitter build --wasm -o ../../wasm/tree-sitter-graphql.wasm
// Then re-run every gate; see grammars/tree-sitter-graphql/README.md.

module.exports = grammar({
  name: "graphql",

  extras: ($) => [/[\s\uFEFF\u0009\u0020\u000A\u000D]/, $.comma, $.comment],

  rules: {
    source_file: ($) => $.Document,
    Document: ($) => repeat1($.Definition),
    Definition: ($) =>
      choice(
        $.ExecutableDefinition,
        $.TypeSystemDefinition,
        $.TypeSystemExtension
      ),
    ExecutableDefinition: ($) =>
      choice($.OperationDefinition, $.FragmentDefinition),
    TypeSystemDefinition: ($) =>
      choice($.SchemaDefinition, $.TypeDefinition, $.DirectiveDefinition),
    TypeSystemExtension: ($) => choice($.SchemaExtension, $.TypeExtension),
    SchemaDefinition: ($) =>
      seq(
        optional($.Description),
        "schema",
        optional($.Directives),
        "{",
        repeat1($.OperationTypeDefinition),
        "}"
      ),
    // FIX 1 also needs `prec.right`: with an optional body, the `{` after
    // `extend schema` is ambiguous (extension body vs. a new shorthand
    // operation), which `tree-sitter generate` reports as an unresolved
    // conflict. Every other `*_type_extension` in this grammar already
    // resolves the same ambiguity with prec.right; this one is now shaped like
    // them. The shift side is the extension, which is what Apollo Federation
    // emits (`extend schema @link(...)` with no body at all).
    SchemaExtension: ($) =>
      prec.right(
        seq(
          "extend",
          "schema",
          optional($.Directives),
          optional(seq("{", repeat1($.OperationTypeDefinition), "}"))
        )
      ),
    TypeExtension: ($) =>
      choice(
        $.ScalarTypeExtension,
        $.ObjectTypeExtension,
        $.InterfaceTypeExtension,
        $.UnionTypeExtension,
        $.EnumTypeExtension,
        $.InputObjectTypeExtension
      ),
    ScalarTypeExtension: ($) => seq(
      "extend",
      "scalar",
      $.Name,
      optional($.Directives)
    ),
    ObjectTypeExtension: ($) =>
      prec.right(
        choice(
          seq(
            "extend",
            "type",
            $.Name,
            optional($.ImplementsInterfaces),
            optional($.Directives),
            $.FieldsDefinition
          ),
          seq(
            "extend",
            "type",
            $.Name,
            optional($.ImplementsInterfaces),
            optional($.Directives)
          )
        )
      ),
    InterfaceTypeExtension: ($) =>
      prec.right(
        choice(
          seq(
            "extend",
            "interface",
            $.Name,
            optional($.ImplementsInterfaces),
            optional($.Directives),
            $.FieldsDefinition
          ),
          seq(
            "extend",
            "interface",
            $.Name,
            optional($.ImplementsInterfaces),
            optional($.Directives)
          )
        )
      ),
    UnionTypeExtension: ($) =>
      prec.right(
        choice(
          seq(
            "extend",
            "union",
            $.Name,
            optional($.Directives),
            $.UnionMemberTypes
          ),
          seq("extend", "union", $.Name, optional($.Directives))
        )
      ),
    EnumTypeExtension: ($) =>
      prec.right(
        choice(
          seq(
            "extend",
            "enum",
            $.Name,
            optional($.Directives),
            $.EnumValuesDefinition
          ),
          seq("extend", "enum", $.Name, optional($.Directives))
        )
      ),
    InputObjectTypeExtension: ($) =>
      prec.right(
        choice(
          seq(
            "extend",
            "input",
            $.Name,
            optional($.Directives),
            repeat1($.InputFieldsDefinition)
          ),
          seq("extend", "input", $.Name, optional($.Directives))
        )
      ),
    InputFieldsDefinition: ($) =>
      seq("{", repeat1($.InputValueDefinition), "}"),
    EnumValuesDefinition: ($) =>
      seq("{", repeat1($.EnumValueDefinition), "}"),
    EnumValueDefinition: ($) =>
      seq(optional($.Description), $.EnumValue, optional($.Directives)),
    ImplementsInterfaces: ($) =>
      choice(
        seq($.ImplementsInterfaces, "&", $.NamedType),
        seq("implements", optional("&"), $.NamedType)
      ),
    FieldsDefinition: ($) => seq("{", repeat1($.FieldDefinition), "}"),
    FieldDefinition: ($) =>
      seq(
        optional($.Description),
        $.Name,
        optional($.ArgumentsDefinition),
        ":",
        $.Type,
        optional($.Directives)
      ),
    ArgumentsDefinition: ($) =>
      seq("(", repeat1($.InputValueDefinition), ")"),
    InputValueDefinition: ($) =>
      seq(
        optional($.Description),
        $.Name,
        ":",
        $.Type,
        optional($.DefaultValue),
        optional($.Directives)
      ),
    DefaultValue: ($) => seq("=", $.Value),
    UnionMemberTypes: ($) =>
      choice(
        seq($.UnionMemberTypes, "|", $.NamedType),
        seq("=", optional("|"), $.NamedType)
      ),
    OperationTypeDefinition: ($) =>
      seq($.OperationType, ":", $.NamedType),
    OperationDefinition: ($) =>
      choice(
        $.SelectionSet,
        seq(
          $.OperationType,
          optional($.Name),
          optional($.VariableDefinitions),
          optional($.Directives),
          $.SelectionSet
        )
      ),
    OperationType: ($) => choice("query", "mutation", "subscription"),
    TypeDefinition: ($) =>
      choice(
        $.ScalarTypeDefinition,
        $.ObjectTypeDefinition,
        $.InterfaceTypeDefinition,
        $.UnionTypeDefinition,
        $.EnumTypeDefinition,
        $.InputObjectTypeDefinition
      ),
    ScalarTypeDefinition: ($) =>
      prec.right(
        seq(optional($.Description), "scalar", $.Name, optional($.Directives))
      ),
    ObjectTypeDefinition: ($) =>
      prec.right(
        seq(
          optional($.Description),
          "type",
          $.Name,
          optional($.ImplementsInterfaces),
          optional($.Directives),
          optional($.FieldsDefinition)
        )
      ),
    InterfaceTypeDefinition: ($) =>
      prec.right(
        seq(
          optional($.Description),
          "interface",
          $.Name,
          optional($.ImplementsInterfaces),
          optional($.Directives),
          optional($.FieldsDefinition)
        )
      ),
    UnionTypeDefinition: ($) =>
      prec.right(
        seq(
          optional($.Description),
          "union",
          $.Name,
          optional($.Directives),
          optional($.UnionMemberTypes)
        )
      ),
    EnumTypeDefinition: ($) =>
      prec.right(
        seq(
          optional($.Description),
          "enum",
          $.Name,
          optional($.Directives),
          optional($.EnumValuesDefinition)
        )
      ),
    InputObjectTypeDefinition: ($) =>
      prec.right(
        seq(
          optional($.Description),
          "input",
          $.Name,
          optional($.Directives),
          optional($.InputFieldsDefinition)
        )
      ),
    VariableDefinitions: ($) => seq("(", repeat1($.VariableDefinition), ")"),
    VariableDefinition: ($) =>
      seq(
        $.Variable,
        ":",
        $.Type,
        optional($.DefaultValue),
        optional($.Directives),
        optional($.comma)
      ),
    SelectionSet: ($) => seq("{", repeat1($.Selection), "}"),
    Selection: ($) => choice($.Field, $.InlineFragment, $.FragmentSpread),
    Field: ($) =>
      seq(
        optional($.Alias),
        $.Name,
        optional($.Arguments),
        optional($.Directives),
        optional($.SelectionSet)
      ),
    Alias: ($) => seq($.Name, ":"),
    Arguments: ($) => seq("(", repeat1($.Argument), ")"),
    Argument: ($) => seq($.Name, ":", $.Value),
    Value: ($) =>
      choice(
        $.Variable,
        $.StringValue,
        $.IntValue,
        $.FloatValue,
        $.BooleanValue,
        $.NullValue,
        $.EnumValue,
        $.ListValue,
        $.ObjectValue
      ),
    Variable: ($) => seq("$", $.Name),
    StringValue: ($) =>
      choice(
        seq('"""', /([^"\\]|"[^"]|"{2}[^"]|\\(.|\n))*/, '"""'),
        seq('"', /([^"\\\n]|\\[^\n])*/, '"')
      ),
    IntValue: ($) => /-?(0|[1-9][0-9]*)/,
    FloatValue: ($) =>
      token(
        seq(
          /-?(0|[1-9][0-9]*)/,
          choice(
            /\.[0-9]+/,
            /(e|E)(\+|-)?[0-9]+/,
            seq(/\.[0-9]+/, /(e|E)(\+|-)?[0-9]+/)
          )
        )
      ),
    BooleanValue: ($) => choice("true", "false"),
    NullValue: ($) => "null",
    EnumValue: ($) => $.Name,
    ListValue: ($) => seq("[", repeat($.Value), "]"),
    ObjectValue: ($) => seq("{", repeat($.ObjectField), "}"),
    ObjectField: ($) => seq($.Name, ":", $.Value, optional($.comma)),
    FragmentSpread: ($) => seq("...", $.FragmentName, optional($.Directives)),
    FragmentDefinition: ($) =>
      seq(
        "fragment",
        $.FragmentName,
        $.TypeCondition,
        optional($.Directives),
        $.SelectionSet
      ),
    FragmentName: ($) => $.Name,
    InlineFragment: ($) =>
      seq(
        "...",
        optional($.TypeCondition),
        optional($.Directives),
        $.SelectionSet
      ),
    TypeCondition: ($) => seq("on", $.NamedType),
    Directives: ($) => repeat1($.Directive),
    Directive: ($) => seq("@", $.Name, optional($.Arguments)),
    DirectiveDefinition: ($) =>
      prec.right(
        1,
        seq(
          optional($.Description),
          "directive",
          "@",
          $.Name,
          optional($.ArgumentsDefinition),
          optional("repeatable"),
          "on",
          $.DirectiveLocations
        )
      ),
    DirectiveLocations: ($) =>
      choice(
        seq($.DirectiveLocations, "|", $.DirectiveLocation),
        seq(optional("|"), $.DirectiveLocation)
      ),
    DirectiveLocation: ($) =>
      choice($.ExecutableDirectiveLocation, $.TypeSystemDirectiveLocation),
    ExecutableDirectiveLocation: ($) =>
      choice(
        "QUERY",
        "MUTATION",
        "SUBSCRIPTION",
        "FIELD",
        "FRAGMENT_DEFINITION",
        "FRAGMENT_SPREAD",
        "INLINE_FRAGMENT",
        "VARIABLE_DEFINITION"
      ),
    TypeSystemDirectiveLocation: ($) =>
      choice(
        "SCHEMA",
        "SCALAR",
        "OBJECT",
        "FIELD_DEFINITION",
        "ARGUMENT_DEFINITION",
        "INTERFACE",
        "UNION",
        "ENUM",
        "ENUM_VALUE",
        "INPUT_OBJECT",
        "INPUT_FIELD_DEFINITION"
      ),
    Type: ($) => choice($.NamedType, $.ListType, $.NonNullType),
    NamedType: ($) => $.Name,
    ListType: ($) => seq("[", $.Type, "]"),
    NonNullType: ($) => choice(seq($.NamedType, "!"), seq($.ListType, "!")),
    Name: ($) => /[_A-Za-z][_0-9A-Za-z]*/,
    comment: ($) => token(seq("#", /.*/)),
    comma: ($) => ",",
    Description: ($) => $.StringValue,
  },
});
