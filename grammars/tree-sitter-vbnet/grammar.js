const PRECEDENCE = {
  MEMBER_ACCESS: 20,
  INVOCATION: 19,
  ARRAY_ACCESS: 18,
  UNARY: 15,
  EXPONENTIATION: 14,
  MULTIPLICATIVE: 13,
  INTEGER_DIVISION: 12,
  MODULO: 11,
  ADDITIVE: 10,
  CONCATENATION: 9,
  SHIFT: 8,
  RELATIONAL: 7,
  EQUALITY: 6,
  LOGICAL_AND: 5,
  LOGICAL_OR: 4,
  LOGICAL_XOR: 3,
  CONDITIONAL: 2,
  ASSIGNMENT: 1,
};

module.exports = grammar({
  name: "vbnet",
  extras: $ => [
    $.comment,
    $.preprocessor_directive,
    /[ \t\v\f]+/,
    /\r?\n/,
    /_[ \t]*\r?\n/,
  ],

  supertypes: ($) => [
    $._declaration,
    $._type_member_declaration,
    $._interface_member_declaration,
    $._statement,
    $._expression,
    $._type,
  ],
  conflicts: ($) => [
    [$.simple_name, $.generic_name],
    [$.await_expression, $.with_expression],
    [$._name_reference, $._type],
    [$.object_creation_expression, $.array_creation_expression, $.array_type],
    [$.string_literal, $.character_literal],
    [$._primary_expression, $.variable_declarator],
    [$.lambda_expression, $.with_expression],
    [$.lambda_expression],
    [$.binary_expression, $.assignment_expression],
    [$._primary_expression, $.select_element],
    [$.with_expression, $.select_element],
    [$.select_clause],
    [$._primary_expression, $.group_element],
    [$._terminator, $._block_terminator],
    [$.labeled_statement],
    [$.argument_list, $.array_rank_specifier],
    [$._argument, $.array_creation_expression],
    [$.object_creation_expression],
    [$.mybase_expression, $.constructor_initializer],
    [$.myclass_expression, $.constructor_initializer],
    [$.lambda_expression, $.expression_statement],
    [$._primary_expression, $.by_element],
    [$.catch_block],
    [$.finally_block],
    [$.aggregate_function],
    [$.aggregate_element, $.into_element],
    [$.group_by_clause],
    [$.else_clause],
    [$.if_statement],
    [$.case_else_clause],
    [$.case_clause],
    [$.elseif_clause],
    [$._primary_expression, $.labeled_statement],
    [$._primary_expression, $.simple_name],
    [$._primary_expression, $.simple_name, $.generic_name],
    [$._primary_expression, $.variable_declarator, $.labeled_statement],
    [$._statement, $.with_statement],
    [$.dictionary_initializer, $.collection_initializer],
    // The block and file-scoped forms of `Namespace N` share their whole prefix
    // and differ only at end-of-input, so GLR must keep both alive until the
    // `End Namespace` (or the EOF) decides it.
    [$._block_namespace_declaration, $._file_scoped_namespace_declaration],
    [$._declaration, $._file_scoped_namespace_declaration],
    // A parameterless `Sub`/`Function` lambda opens with a bare keyword, which
    // is also the head of a statement lambda's parameter list and the head of a
    // declaration statement. GLR keeps the readings alive; the `End Sub` and the
    // body shape decide between them.
    [$._primary_expression, $.lambda_parameter],
    // `Function() As T(` — the `(` can open an array rank on the return type or
    // be the lambda body's first token. Dynamic precedence below breaks it
    // toward the lambda, which is the only reading that leaves the body with
    // something to parse.
    [$.array_type, $.as_clause],
    // `xs(i)` and `F(a)` are the same shape. GLR must keep both alive, because
    // which one is right is decided by what the parens CONTAIN: an index list
    // cannot hold a multi-line statement lambda, and a branch that reaches one
    // cannot finish. This fork is what lets the invocation reading survive to be
    // the one that completes -- without it the parser commits to the index
    // reading on the first `(` and reports `End Sub` as a stray error.
    [$.array_access_expression, $.invocation_expression],
    // `ReDim a.b(15)` vs `ReDim a(15)`: the target is an expression, so the
    // same shape is an index. GLR keeps both; the `ReDim` head decides.
    [$._argument, $.redim_clause],
    // `a = 1 : b = 2`: a statement either continues the expression or is followed
    // by a colon and another one. Same reduce point as the list design, but the
    // colon now lives INSIDE a node instead of at the list level.
    [
      $.class_declaration,
      $.structure_declaration,
      $.interface_declaration,
      $.enum_declaration,
      $.delegate_declaration,
      $.interface_method_declaration,
      $.interface_property_declaration,
      $.interface_event_declaration,
   
    ],
  ],

  word: ($) => $._identifier_token,

  rules: {
    // A FILE-SCOPED namespace must be the LAST declaration in the file -- VB
    // requires it, and modelling that here is what makes the two namespace
    // forms decidable at all. When `Namespace N` was just another member of the
    // flat declaration repeat, the file-scoped reading could reduce at ANY
    // point (it has no terminator to wait for), so the declarations after that
    // point were hoisted to file scope and the real `End Namespace` was left as
    // a stray ERROR. That was measured on Microsoft's own sources: a class
    // became a sibling of its namespace and `End Namespace` dangled at EOF.
    // Pinning the file-scoped form to the final position means its body can only
    // end at EOF, so a file that has an `End Namespace` cannot possibly take
    // that branch.
    source_file: ($) =>
      seq(
        optional($.option_statements),
        repeat(choice(
          prec(10, $.imports_statement),
          prec(10, $.global_attribute_section),
          prec(10, $.file_attribute_section),
          $._declaration,
          $._statement,
          $._block_terminator
        )),
        optional(alias($._file_scoped_namespace_declaration, $.namespace_declaration))
      ),

    file_attribute_section: ($) =>
      seq(
        $.attribute_list,
        $._terminator
      ),


    option_statements: ($) => repeat1($.option_statement),

    option_statement: ($) =>
      seq(
        ci("Option"),
        choice(
          seq(ci("Explicit"), optional(choice(ci("On"), ci("Off")))),
          seq(ci("Strict"), optional(choice(ci("On"), ci("Off")))),
          seq(ci("Compare"), choice(ci("Binary"), ci("Text"))),
          seq(ci("Infer"), optional(choice(ci("On"), ci("Off"))))
        ),
        $._terminator
      ),

    imports_statement: ($) =>
      seq(
        ci("Imports"),
        choice(
          field("namespace", $._name_reference),
          seq(
            field("alias", $.identifier),
            "=",
            field("namespace", $._name_reference)
          )
        ),
        $._terminator
      ),

    global_attribute_section: ($) =>
      seq(
        "<",
        field("target", $.attribute_target),
        ":",
        commaSep1($.attribute),
        ">",
        $._terminator
      ),

    attribute_target: ($) =>
      choice(
        ci("Assembly"),
        ci("Module")
      ),

    _terminator: ($) =>
      choice(seq(optional(":"), choice("\n", "\r\n")), $._eof),

    // `:` is VB's same-line statement separator (`Case 1 : Return 10`). The
    // upstream `_terminator` only accepted a colon that was IMMEDIATELY
    // followed by a newline, so every colon-separated clause head was an ERROR.
    // This is the clause-head form: end the head at the colon, and let the body
    // statements follow on the same line.
    _clause_terminator: ($) => choice($._block_terminator, token(":")),

    _block_terminator: ($) => prec.right(repeat1(choice("\n", "\r\n", $._eof))),

    _eof: ($) => token(prec(-10, "$")),

    // VB.NET identifiers admit Unicode letters (the language spec's identifier
    // is a letter followed by letters/digits, and letters are not ASCII-only).
    // The upstream token was /[a-zA-Z_][a-zA-Z0-9_]*/, so every declaration
    // carrying a non-ASCII name — `Public ReadOnly Property Pokémon` — was an
    // ERROR node. \p{L}/\p{Nd} are the Unicode letter / decimal-digit classes.
    _identifier_token: ($) => token(prec(-1, /[\p{L}_][\p{L}\p{Nd}_]*/)),

    identifier: ($) =>
      choice(
        $._identifier_token,
        seq("[", /[^\]]+/, "]") // Bracketed identifier
      ),

    _implements_keyword: ($) => token(prec(10, ci("Implements"))),
    _inherits_keyword: ($) => token(prec(10, ci("Inherits"))),

    _sub_new: ($) => token(prec(100, seq(ci("Sub"), /\s+/, ci("New")))),

    member_modifier: ($) =>
      token(
        prec(
          10,
          choice(
            ci("Public"),
            ci("Private"),
            ci("Protected"),
            ci("Friend"),
            ci("Protected Friend"),
            ci("Private Protected"),
            ci("ReadOnly"),
            ci("WriteOnly"),
            ci("Shared"),
            ci("Shadows"),
            ci("MustInherit"),
            ci("NotInheritable"),
            ci("Overrides"),
            ci("MustOverride"),
            ci("NotOverridable"),
            ci("Overridable"),
            ci("Overloads"),
            ci("WithEvents"),
            ci("Widening"),
            ci("Narrowing"),
            ci("Partial"),
            ci("Async"),
            ci("Iterator"),
            ci("Dim"),
            ci("Const")
          )
        )
      ),

    _method_body_statement: ($) =>
      choice(
        prec(10, $.try_statement),  // High precedence for try
        prec(10, $.select_statement),  // High precedence for select
        prec(10, $.if_statement),
        prec(10, $.while_statement),
        prec(10, $.do_statement),
        prec(10, $.for_statement),
        prec(10, $.for_each_statement),
        prec(10, $.using_statement),
        prec(10, $.with_statement),
        prec(1, $.declaration_statement),  // Lower precedence for declarations
        $._statement  // Fallback to regular statements
      ),

    _non_statement_identifier: $ => choice(
      // Match identifiers that don't start with statement keywords
      token(prec(1, seq(
        negative_lookahead(seq(
          choice(
            /[Tt][Rr][Yy]/,
            /[Ss][Ee][Ll][Ee][Cc][Tt]/,
            /[Ii][Ff]/,
            /[Ww][Hh][Ii][Ll][Ee]/,
            /[Dd][Oo]/,
            /[Ff][Oo][Rr]/,
            /[Uu][Ss][Ii][Nn][Gg]/,
            /[Ww][Ii][Tt][Hh]/,
            /[Tt][Hh][Rr][Oo][Ww]/,
            /[Rr][Ee][Tt][Uu][Rr][Nn]/,
            /[Ee][Xx][Ii][Tt]/,
            /[Cc][Oo][Nn][Tt][Ii][Nn][Uu][Ee]/,
            /[Ss][Tt][Oo][Pp]/,
            /[Ee][Nn][Dd]/,
            /[Gg][Oo][Tt][Oo]/,
            /[Rr][Ee][Ss][Uu][Mm][Ee]/,
            /[Ee][Rr][Rr][Oo][Rr]/,
            /[Oo][Nn]/,
            /[Rr][Ee][Dd][Ii][Mm]/,
            /[Ee][Rr][Aa][Ss][Ee]/,
            /[Ss][Yy][Nn][Cc][Ll][Oo][Cc][Kk]/,
            /[Rr][Aa][Ii][Ss][Ee][Ee][Vv][Ee][Nn][Tt]/,
            /[Aa][Dd][Dd][Hh][Aa][Nn][Dd][Ll][Ee][Rr]/,
            /[Rr][Ee][Mm][Oo][Vv][Ee][Hh][Aa][Nn][Dd][Ll][Ee][Rr]/
          ),
          choice(/\s/, /\r/, /\n/, /$/)
        )),
        /[a-zA-Z_][a-zA-Z0-9_]*/
      ))),
      seq("[", /[^\]]+/, "]") // Bracketed identifier can be anything
    ),

    local_declaration_modifier: ($) =>
      choice(ci("Dim"), ci("Const"), ci("Static")),

    attribute_list: ($) => seq("<", commaSep1($.attribute), ">"),

    attribute: ($) =>
      seq(
        field("name", $._name_reference),
        optional(field("arguments", $.attribute_argument_list))
      ),

    attribute_argument_list: ($) =>
      seq("(", commaSep($._attribute_argument), ")"),

    _attribute_argument: ($) => choice($._expression, $.named_argument),

    // `f(a, b:=c)` — a named argument. Upstream declared this rule but left it
    // at default precedence, so `b` won as a plain `_expression` and the `:=`
    // that followed was an ERROR. PRECEDENCE.INVOCATION-level precedence makes
    // the `name :=` shape win the tie it is supposed to win.
    named_argument: ($) =>
      prec(PRECEDENCE.INVOCATION, seq(
        field("name", $.identifier),
        ":=",
        field("value", $._expression)
      )),

    // Expressions
    _expression: ($) =>
      choice(
        // $.aggregate_function,
        $._primary_expression,
        $.binary_expression,
        $.unary_expression,
        $.assignment_expression,
        $.conditional_expression,
        $.lambda_expression,
        $.await_expression,
        $.query_expression,
        $.typeof_is_expression
      ),


    _primary_expression: ($) =>
      choice(
        $._literal,
        $.identifier,
        $.parenthesized_expression,
        $.generic_invocation_expression,  // Add this before regular invocation
        $.invocation_expression,
        $.member_access_expression,
        $.array_access_expression,
        $.object_creation_expression,
        $.array_creation_expression,
        $.typeof_expression,
        $.cast_expression,
        $.me_expression,
        $.mybase_expression,
        $.myclass_expression,
        $.if_expression,
        $.with_expression,
        $.anonymous_object_creation_expression,
        $.with_member_access_expression
      ),

    // `CallSite(Of Func(Of Object, Object))` names a generic method without
    // calling it -- a method group, passed as a delegate. Upstream required an
    // argument list alongside the type arguments, so the bare type-argument
    // form had no production at all. Making the argument list optional makes
    // the `(` after the type arguments ambiguous (attach it as the argument
    // list, or leave it to the enclosing expression), so the rule is
    // right-associative: the paren attaches here.
    generic_invocation_expression: ($) =>
      prec.right(
        PRECEDENCE.INVOCATION + 1,
        seq(
          field("function", $._expression),
          field("type_arguments", $.type_argument_list),
          optional(field("arguments", $.argument_list))
        )
      ),

    parenthesized_expression: ($) => seq("(", $._expression, ")"),

    member_access_expression: ($) =>
      prec.left(
        PRECEDENCE.MEMBER_ACCESS,
        seq(
          field("object", $._expression),
          choice(".", "?."),
          field("member", $.identifier)
        )
      ),

    // `F(a, b:=c)` and `xs(i)` are the same shape up to the `:=`, so the parser
    // has to keep BOTH readings alive until then. `invocation_expression`
    // carries dynamic precedence over `array_access_expression` for exactly
    // that: an index list can never contain a named argument, so when the list
    // turns out to hold one, the invocation reading is the correct survivor and
    // must win the tie. The dynamic rank is on the rule that can CONSUME the
    // `:=`, not on the one that cannot.
    invocation_expression: ($) =>
      prec.dynamic(
        PRECEDENCE.INVOCATION,
        prec(
          PRECEDENCE.INVOCATION,
          seq(
            field("function", $._expression),
            field("arguments", $.argument_list)
          )
        )
      ),

    argument_list: ($) => seq("(", optional(commaSep1($._argument)), ")"),

    _argument: ($) =>
      choice($._expression, $.named_argument, $.omitted_argument),

    omitted_argument: ($) => token(prec(1, ",")),

    // `xs(i)` and `F(a, b:=c)` share a surface, so this is the ambiguous one,
    // and both readings are built from the same `$._argument` so that they
    // differ only at the `:=` -- a branch that reaches `:=` and cannot consume
    // it dies, so the surviving branch is the correct one.
    //
    // The narrower alternative (index list = `commaSep1($._expression)`, leaving
    // the named-argument case to be settled by precedence on the invocation
    // side) was built and MEASURED rather than argued about, and it is worse on
    // both counts: 89.17 % vs 90.17 % clean over the same 600-file P3D draw, and
    // it could not parse `F(1, b:=2)` at all. A plausible story about GLR fork
    // blowup was the reason to try it; the corpus said no.
    array_access_expression: ($) =>
      prec(
        PRECEDENCE.ARRAY_ACCESS,
        seq(
          field("array", $._expression),
          "(",
          field("indices", commaSep1($._argument)),
          ")"
        )
      ),

    binary_expression: ($) =>
      choice(
        // Special handling for "Is Not" as two tokens
        prec.left(
          PRECEDENCE.EQUALITY,
          seq(
            field("left", $._expression),
            field("operator", seq(ci("Is"), ci("Not"))),
            field("right", $._expression)
          )
        ),
        ...[
          ["^", PRECEDENCE.EXPONENTIATION],
          ["*", PRECEDENCE.MULTIPLICATIVE],
          ["/", PRECEDENCE.MULTIPLICATIVE],
          ["\\", PRECEDENCE.INTEGER_DIVISION],
          [ci("Mod"), PRECEDENCE.MODULO],
          ["+", PRECEDENCE.ADDITIVE],
          ["-", PRECEDENCE.ADDITIVE],
          ["&", PRECEDENCE.CONCATENATION],
          ["<<", PRECEDENCE.SHIFT],
          [">>", PRECEDENCE.SHIFT],
          ["<", PRECEDENCE.RELATIONAL],
          [">", PRECEDENCE.RELATIONAL],
          ["<=", PRECEDENCE.RELATIONAL],
          [">=", PRECEDENCE.RELATIONAL],
          ["=", PRECEDENCE.EQUALITY],
          ["<>", PRECEDENCE.EQUALITY],
          [ci("Is"), PRECEDENCE.EQUALITY],
          [ci("IsNot"), PRECEDENCE.EQUALITY],
          [ci("Like"), PRECEDENCE.RELATIONAL],
          [ci("And"), PRECEDENCE.LOGICAL_AND],
          [ci("AndAlso"), PRECEDENCE.LOGICAL_AND],
          [ci("Or"), PRECEDENCE.LOGICAL_OR],
          [ci("OrElse"), PRECEDENCE.LOGICAL_OR],
          [ci("Xor"), PRECEDENCE.LOGICAL_XOR],
        ].map(([op, precedence]) =>
          prec.left(
            precedence,
            seq(
              field("left", $._expression),
              field("operator", seq(op, optional(/_[ \t]*\r?\n/))),
              // Accept optional extras (comments, line continuation) here
              field("right", $._expression)
            )
          )
        )
      ),


    unary_expression: ($) =>
      prec.left(
        PRECEDENCE.UNARY,
        choice(
          seq("+", $._expression),
          seq("-", $._expression),
          seq(ci("Not"), $._expression),
          seq(ci("AddressOf"), $._expression)
        )
      ),

    assignment_expression: ($) =>
      prec.right(
        PRECEDENCE.ASSIGNMENT,
        seq(
          field("left", $._expression),
          field(
            "operator",
            choice("=", "+=", "-=", "*=", "/=", "\\=", "^=", "&=", "<<=", ">>=")
          ),
          field("right", $._expression)
        )
      ),

    conditional_expression: ($) =>
      prec.right(
        PRECEDENCE.CONDITIONAL,
        seq(
          ci("If"),
          "(",
          field("condition", $._expression),
          ",",
          field("true_expression", $._expression),
          ",",
          field("false_expression", $._expression),
          ")"
        )
      ),

    if_expression: ($) =>
      prec.right(
        PRECEDENCE.CONDITIONAL,
        seq(
          ci("If"),
          "(",
          field("condition", $._expression),
          ",",
          field("true_expression", $._expression),
          ")"
        )
      ),

    // VB has TWO lambda shapes and upstream had half of one.
    //
    //   single-line   `Sub(x) expr`            / `Function(x) As T expr`
    //   statement     `Sub(x) ... End Sub`     / `Function(x) As T ... End Function`
    //
    // Three things were missing, each measured on real code: the parameter list
    // could not be ABSENT (a bare `Sub` with no parentheses is legal and is how
    // `Task.Run(Sub() ...)` is written), the `As T` return clause was missing,
    // and there was no `End Sub`/`End Function` terminator -- so a multi-line
    // lambda reported its own closing keyword as an ERROR. The body stays a
    // choice of an expression (single-line) or a statement block (multi-line),
    // and the terminator is what tells them apart.
    lambda_expression: ($) =>
      seq(
        choice(ci("Function"), ci("Sub")),
        optional(field("parameters", $.lambda_parameter_list)),
        optional($.as_clause),
        choice(
          // single-line: the body is one expression and there is no terminator
          field("body", $._expression),
          // multi-line: the terminator is REQUIRED, not optional. VB always
          // closes a statement lambda with `End Sub`/`End Function`, and leaving
          // the terminator optional made the body able to stop anywhere -- which
          // is what let the index-list reading of `Task.Run(...)` swallow the
          // whole body and then report `End Sub` as a stray error.
          seq(
            field("body", $._statement_block),
            ci("End"),
            choice(ci("Sub"), ci("Function"))
            // NO `$._terminator` here, deliberately. The newline after
            // `End Sub` belongs to whatever ENCLOSES the lambda: the
            // `declaration_statement` that holds `Dim f = Sub() ... End Sub`
            // still has to consume its own terminator, and a lambda that ate
            // the newline left the enclosing statement with nothing to close on.
            // That is measured, not argued: with the terminator attached, a
            // statement lambda followed by ANY further statement failed
            // (4/4 shapes), and the same lambda as the last statement in a
            // method passed -- which is exactly the signature of a stolen
            // newline. An argument-position lambda is unaffected: `End Sub` is
            // followed by `)`, which needs no terminator.
          )
        )
      ),

    lambda_parameter_list: ($) => seq("(", commaSep($.lambda_parameter), ")"),

    lambda_parameter: ($) =>
      seq(field("name", $.identifier), optional($.as_clause)),

    typeof_is_expression: ($) =>
      prec.left(
        PRECEDENCE.RELATIONAL,
        seq(
          ci("TypeOf"),
          field("expression", $._expression),
          ci("Is"),
          field("type", $._type)
        )
      ),
    await_expression: ($) => seq(ci("Await"), $._expression),

    object_creation_expression: ($) =>
      seq(
        ci("New"),
        field("type", $._type),
        optional(field("arguments", $.argument_list)),
        optional(
          field(
            "initializer",
            choice(
              $.object_initializer, 
              $.collection_initializer,
              $.dictionary_initializer  // Add this new option
            )
          )
        )
      ),

    dictionary_initializer: ($) =>
      seq(
        ci("From"), 
        "{", 
        commaSep($.dictionary_element), 
        "}"
      ),
    
    // `From {{k, v}, {k2, v2}}` — each braced group is a key/value PAIR. This
    // is structurally identical to a two-element `array_initializer`
    // (`{e1, e2}`), and the two genuinely overlap, so the tie has to be broken
    // explicitly: inside a `dictionary_initializer` a two-element brace is a
    // pair, and the parser is unambiguously already inside that context when it
    // reaches the brace. ARRAY_ACCESS-level precedence is above the default
    // (0) an `array_initializer` element list is reduced at.
    dictionary_element: ($) =>
      prec(
        PRECEDENCE.ARRAY_ACCESS,
        seq(
          "{",
          field("key", $._expression),
          ",",
          field("value", $._expression),
          "}"
        )
      ),


    object_initializer: ($) =>
      seq(ci("With"), "{", commaSep($.member_initializer), "}"),
    member_initializer: ($) =>
      choice(
        seq(
          ".",
          field("name", $.identifier),
          "=",
          field("value", $._expression)
        ),
        seq(
          ci("Key"),
          ".",
          field("name", $.identifier),
          "=",
          field("value", $._expression)
        )
      ),

    collection_initializer: ($) =>
      seq(ci("From"), "{", commaSep($._expression), "}"),

    // VB's ARRAY INITIALIZER: a bare braced list, `{a, b}`. It is reached
    // through `_literal`, so it nests inside itself (a 2-D initializer is
    // `{ {1, 2}, {3, 4} }`) and is legal anywhere an expression is. Kept as its
    // own node so the analyzer can tell a braced initializer from a `From`-led
    // collection initializer and from a `With`-led object initializer.
    array_initializer: ($) =>
      seq("{", optional(commaSep($._expression)), "}"),


    array_creation_expression: ($) =>
      seq(
        ci("New"),
        field("type", $._type),
        choice(
          seq(
            "(",
            field("bounds", commaSep1($._expression)),
            ")",
            optional(field("initializer", $.array_initializer))
          ),
          field("initializer", $.array_initializer)
        )
      ),
    array_initializer: ($) => seq("{", commaSep($._expression), "}"),
    anonymous_object_creation_expression: ($) =>
      seq(
        ci("New"),
        ci("With"),
        "{",
        commaSep($.anonymous_object_member_declarator),
        "}"
      ),
    anonymous_object_member_declarator: ($) =>
      choice(
        seq(
          ".",
          field("name", $.identifier),
          "=",
          field("value", $._expression)
        ),
        seq(
          ci("Key"),
          ".",
          field("name", $.identifier),
          "=",
          field("value", $._expression)
        ),
        $._expression
      ),
    typeof_expression: ($) =>
      seq(ci("GetType"), "(", field("type", $._type), ")"),
    cast_expression: ($) =>
      choice(
        seq(
          ci("CType"),
          "(",
          field("expression", $._expression),
          ",",
          field("type", $._type),
          ")"
        ),
        seq(
          ci("DirectCast"),
          "(",
          field("expression", $._expression),
          ",",
          field("type", $._type),
          ")"
        ),
        seq(
          ci("TryCast"),
          "(",
          field("expression", $._expression),
          ",",
          field("type", $._type),
          ")"
        ),
        seq(ci("CInt"), "(", field("expression", $._expression), ")"),
        seq(ci("CLng"), "(", field("expression", $._expression), ")"),
        seq(ci("CDbl"), "(", field("expression", $._expression), ")"),
        seq(ci("CDec"), "(", field("expression", $._expression), ")"),
        seq(ci("CStr"), "(", field("expression", $._expression), ")"),
        seq(ci("CBool"), "(", field("expression", $._expression), ")"),
        seq(ci("CDate"), "(", field("expression", $._expression), ")"),
        seq(ci("CObj"), "(", field("expression", $._expression), ")"),
        seq(ci("CByte"), "(", field("expression", $._expression), ")"),
        seq(ci("CSByte"), "(", field("expression", $._expression), ")"),
        seq(ci("CShort"), "(", field("expression", $._expression), ")"),
        seq(ci("CUShort"), "(", field("expression", $._expression), ")"),
        seq(ci("CUInt"), "(", field("expression", $._expression), ")"),
        seq(ci("CULng"), "(", field("expression", $._expression), ")"),
        seq(ci("CSng"), "(", field("expression", $._expression), ")"),
        seq(ci("CChar"), "(", field("expression", $._expression), ")")
      ),
    me_expression: ($) => ci("Me"),
    mybase_expression: ($) => ci("MyBase"),
    myclass_expression: ($) => ci("MyClass"),
    with_member_access_expression: ($) =>
      prec(PRECEDENCE.MEMBER_ACCESS, seq(".", $.identifier)),
    with_expression: ($) =>
      seq(field("object", $._expression), "!", field("member", $.identifier)),
    _literal: ($) =>
      choice(
        $.string_literal,
        $.character_literal,
        $.integer_literal,
        $.floating_point_literal,
        $.boolean_literal,
        $.nothing_literal,
        $.date_literal,
        // A braced initializer is a LITERAL in VB: it appears on the right of
        // `=` in a declaration, in an assignment, and nested inside itself for
        // a 2-D initializer. Modelling it as a literal rather than as an
        // initializer-only rule is what makes the nesting come for free and
        // makes `x = {1, 2}` legal. Upstream had no production for a bare
        // `{...}` at all (its `collection_initializer` required LINQ's leading
        // `From`, its `object_initializer` a leading `With`), so every
        // initialized array declaration was an ERROR at the `=`.
        $.array_initializer
      ),
    string_literal: ($) => seq('"', repeat(choice(/[^"\n]+/, '""')), '"'),
    // `"x"c` is a CHARACTER literal. It has to be ONE token, not a sequence of
    // a string plus a bare `c`: as a sequence, `string_literal` matched the
    // leading `"x"` and the trailing `c` was left dangling (and `c` lexes as an
    // identifier), so every character literal in a `Select Case` was an ERROR.
    // As one token its length beats the string reading at the same start.
    character_literal: ($) =>
      token(seq('"', choice(/[^"\n]/, '""'), '"', /[cC]/)),
    // VB integer literals: decimal, or hex (&H)/octal (&O)/binary (&B) prefixed,
    // each with an optional type character. The upstream rule had neither the
    // radix prefixes nor the %/&/D/F/R type characters, so Microsoft's own
    // Microsoft.VisualBasic.Core failed to parse at every `&H80004003`. Each
    // radix carries its OWN digit class -- `&HC6` needs hex letters, and
    // decimal digits alone stop after `&H`.
    integer_literal: ($) =>
      token(seq(
        choice(
          seq(choice("&H", "&h"), /[0-9a-fA-F]+/),
          seq(choice("&O", "&o"), /[0-7]+/),
          seq(choice("&B", "&b"), /[01]+/),
          /\d+/
        ),
        optional(choice("I", "i", "UI", "ui", "L", "l", "UL", "ul", "S", "s", "US", "us",
                        "%", "&", "!", "D", "d", "F", "f", "R", "r"))
      )),
    floating_point_literal: ($) =>
      token(
        seq(
          choice(seq(/\d+/, ".", /\d+/), seq(".", /\d+/), /\d+/),
          optional(/[eE][+-]?\d+/),
          // `!` is Single and is extremely common in generated Windows Forms
          // code (`New SizeF(6.0!, 13.0!)`); F/R/D are Double/Float.
          //
          // `#` (Double) and `@` (Decimal) are VB6's legacy suffixes. An EARLIER
          // revision of this comment ruled them out, on the reasoning that `#`
          // also opens `date_literal` and the two would be ambiguous. That
          // reasoning was wrong and the corpus said so: `#` and `@` attach to
          // the END of a numeric token while `date_literal` starts at `#`, so
          // they never compete for the same character position, and Microsoft's
          // own Microsoft.VisualBasic.Financial writes `Period - 1.0#`. A ruling
          // that a real corpus contradicts is not a ruling, it is a guess with a
          // comment attached; it is withdrawn here and the suffixes are accepted.
          optional(choice("F", "f", "D", "d", "R", "r", "!", "#", "@"))
        )
      ),
    boolean_literal: ($) => choice(ci("True"), ci("False")),
    nothing_literal: ($) => ci("Nothing"),
    date_literal: ($) => seq("#", /[^#]+/, "#"),

    // Names and types
    // `generic_name` IS a member, and the reason is measured rather than
    // argued. A heritage list needs it -- `Class C : Implements
    // IComparable(Of C)` is how VB spells a generic interface implementation,
    // and without it that one line errored and cascaded 1848 error nodes through
    // TankExporter's frmMain.vb. A first attempt kept heritage on a SEPARATE
    // `_heritage_name` rule, on the theory that admitting generics here would
    // make both ends of every qualified name generic at once. The corpus
    // differential did not support the theory: with the split, aggregate clean
    // was 90.21 %; with `generic_name` here as well, it is 90.55 % (+0.34), with
    // no corpus worse. So the separate rule is gone and the simpler form stays.
    //
    // (A 32.49 % reading was observed at one point in this lane and is recorded
    // in validation/history/reading-05-heritage.json. It did NOT reproduce from
    // this rule on its own, so it is recorded as an unexplained reading rather
    // than written up as a cause -- the rule and the reading are kept apart on
    // purpose, because a comment that asserts a cause the measurement refused to
    // confirm is worse than no comment.)
    _name_reference: ($) =>
      choice(
        $.simple_name,
        $.qualified_name,
        $.global_qualified_name,
        $.generic_name
      ),

    simple_name: ($) => $.identifier,

    // A qualified name's LAST segment may itself be generic:
    // `System.Collections.Generic.Dictionary(Of String, Node)`. Upstream pinned
    // the final segment to `simple_name` (a bare identifier), so a qualified
    // generic type -- which is how almost every BCL type is spelled -- had no
    // production and errored at the `(Of`.
    qualified_name: ($) =>
      prec.left(
        PRECEDENCE.MEMBER_ACCESS + 1,
        seq(
          field("qualifier", $._name_reference),
          token("."),
          field("name", choice($.simple_name, $.generic_name))
        )
      ),
    global_qualified_name: ($) =>
      seq(ci("Global"), ".", field("name", $._name_reference)),

    _type: ($) =>
      choice(
        prec(2, $.nullable_type),  // Give nullable_type higher precedence
        $.simple_name,
        $.qualified_name,
        // `Global.` is VB's root-namespace qualifier and every BCL type is
        // reachable through it. The rule existed but was listed nowhere that a
        // TYPE could reach, so `As Global.System.Text.StringBuilder` -- which is
        // how the Visual Studio designer emits half its members -- had no
        // production at all and took the whole declaration with it.
        $.global_qualified_name,
        $.generic_name,
        $.predefined_type,
        $.array_type,
        $.tuple_type
      ),

    predefined_type: ($) =>
      choice(
        ci("Boolean"),
        ci("Byte"),
        ci("SByte"),
        ci("Char"),
        ci("Date"),
        ci("Decimal"),
        ci("Double"),
        ci("Integer"),
        ci("Long"),
        ci("Object"),
        ci("Short"),
        ci("Single"),
        ci("String"),
        ci("UInteger"),
        ci("ULong"),
        ci("UShort")
      ),

    generic_name: ($) => seq(field("name", $.identifier), $.type_argument_list),
    type_argument_list: ($) => seq("(", ci("Of"), commaSep1($._type), ")"),
    array_type: ($) =>
      seq(field("element_type", $._type), $.array_rank_specifier),
    array_rank_specifier: ($) => seq("(", repeat(","), ")"),

    nullable_type: ($) => prec.left(20, seq(
      field("type", choice(
        $.predefined_type,
        $.simple_name,
        $.qualified_name,
        $.generic_name  // Also allow generic types to be nullable
      )),
      token.immediate("?")
    )),

    tuple_type: ($) => seq("(", commaSep2($.tuple_element), ")"),
    tuple_element: ($) =>
      seq(
        optional(seq(field("name", $.identifier), ci("As"))),
        field("type", $._type)
      ),

    // `As <type>` and `As New <type>`. The `As New` form is how VB
    // spells an auto-implemented property or field with an initialiser
    // (`Public Property Deps As New List(Of AppxDependency)`), and it is the
    // dominant spelling in modern VB.NET. `variable_declarator` already had the
    // `As New` shape; `as_clause` did not, so every such member was an ERROR
    // and took its whole body with it. The `= init` half deliberately stays with
    // the rules that OWN an initializer (`variable_declarator`,
    // `property_declaration`): putting it here as well made the same `=` match
    // two rules and the generator could not rank them.
    // Right-associative so the clause takes what follows its type: `As New T {`
    // is an initializer, not a type followed by a body that starts with a brace.
    // The dynamic rank additionally breaks the `Function() As T(` tie toward the
    // lambda, which is the only reading that leaves the body something to parse.
    as_clause: ($) => prec.right(prec.dynamic(1, choice(
      seq(
        ci("As"),
        field("declared_type", $._type)
      ),
      seq(
        ci("As"),
        ci("New"),
        field("declared_type", $._type),
        // `As New DateTime(2020, 1, 1)` -- the constructed form of `As New`.
        optional(field("arguments", $.argument_list)),
        // `As New Process() With { .FileName = ... }` -- the object-initializer
        // form. This is NOT a nicety: moving `As New` out of
        // `variable_declarator` into this shared clause is what put it here, and
        // without the initializer half the shape was lost. It is measured on
        // DISMTools, where `Using p As New Process() With { ... }` (and the
        // nested `New ProcessStartInfo() With { ... }` inside it) is how every
        // process launch in that codebase is written.
        //
        // Only the braced initializers are named, deliberately: the `= expr`
        // form is NOT, because it is owned by the rules that HAVE an
        // initializer slot (`variable_declarator`, `property_declaration`) and
        // admitting it in two places made the same `=` match two rules.
        optional(field("initializer", choice(
          $.object_initializer,
          $.array_initializer,
          // LINQ's `From { ... }` DOES follow `As New` -- `Dim d As New
          // Dictionary(Of String, String) From {{k, v}, {k2, v2}}` is how a
          // populated dictionary is written. An earlier revision of this comment
          // claimed it never does, and claimed that naming it here made the
          // generator unable to rank it. Both claims were wrong: the
          // generator's complaint was an UNRANKED tie, which `as_clause`'s
          // right-associativity and dynamic rank now settle, and the corpus
          // decides the rest.
          $.collection_initializer
        )))
      )
    ))),

    implements_member_clause: ($) =>
      seq(ci("Implements"), commaSep1($._name_reference)),

    implements_statement: ($) =>
      prec.right(
        10,
        seq($._implements_keyword, commaSep1($._name_reference), $._terminator)
      ),

    inherits_statement: ($) =>
      prec.right(
        10,
        seq($._inherits_keyword, commaSep1($._name_reference), $._terminator)
      ),

    // Declarations
    _declaration: ($) =>
      choice(
        alias($._block_namespace_declaration, $.namespace_declaration),
        $._declaration_without_namespace
      ),

    // Every top-level declaration EXCEPT a namespace. A file-scoped namespace
    // admits only these in its body: VB forbids nesting a namespace inside one,
    // and excluding it here is what lets the two `namespace_declaration`
    // alternatives be told apart without a GLR conflict.
    _declaration_without_namespace: ($) =>
      choice(
        $.class_declaration,
        $.structure_declaration,
        $.interface_declaration,
        $.module_declaration,
        $.enum_declaration,
        $.delegate_declaration
      ),

    // VB 15 (2017) added the FILE-SCOPED namespace: `Namespace N` followed by
    // declarations with no `End Namespace`. It is now the dominant spelling in
    // modern VB.NET, and the upstream rule required `End Namespace`, so every
    // such file was one giant ERROR node.
    //
    // Modelled as TWO alternatives under one public node, not as one rule with
    // an OPTIONAL `End Namespace`. The optional form is genuinely ambiguous and
    // the ambiguity is not benign: with the body free to end anywhere, the
    // file-scoped reading also "succeeds" for a file that DOES end with
    // `End Namespace` -- it just leaves the `End Namespace` dangling, and the
    // declarations after the early reduction become siblings of the namespace
    // instead of its children. That was measured, not theorised: 5 of
    // Microsoft's own files had a class hoisted to file scope and a stray
    // `End Namespace` ERROR at EOF.
    //
    // Two alternatives still do not decide it for us, because the two forms are
    // identical until the very end of the file -- which is the definition of an
    // LR ambiguity, not something a conflict declaration can rank. So the tie is
    // broken by DYNAMIC precedence, which is the tool for "both parse, pick the
    // better": the block form outranks the file-scoped form, and a file that
    // genuinely has no `End Namespace` still resolves to file-scoped, because
    // the block alternative cannot finish at all and is discarded.
    //
    // The file-scoped body excludes a NESTED namespace, both because VB forbids
    // nesting one inside a file-scoped namespace and because it is what keeps
    // the two alternatives from differing before the end.
    _block_namespace_declaration: ($) =>
      seq(
        ci("Namespace"),
        field("name", $._name_reference),
        $._block_terminator,
        repeat(choice($.imports_statement, $._declaration)),
        ci("End"),
        ci("Namespace"),
        $._terminator
      ),

    _file_scoped_namespace_declaration: ($) =>
      seq(
        ci("Namespace"),
        field("name", $._name_reference),
        $._block_terminator,
        repeat(choice($.imports_statement, $._declaration_without_namespace))
      ),

    // `Class C : Inherits B, Implements I` — the single-LINE heritage form.
    // VB spells heritage two ways: as a colon-suffixed clause on the declaration
    // header, and as a following `Inherits`/`Implements` line. The grammar had
    // the line form only (`inherits_statement`/`implements_statement`), so
    // Microsoft's own `Public NotInheritable Class Collection : Implements
    // ICollection, IList` was an ERROR. Both forms remain accepted.
    _class_heritage_clause: ($) =>
      prec.right(
        10,
        seq(
          token(":"),
          optional(seq(ci("Inherits"), commaSep1($._name_reference))),
          optional(seq(ci("Implements"), commaSep1($._name_reference)))
        )
      ),

    // `Interface I : IDisposable, IEnumerable` and `Structure S : IComparable`
    // — for an interface or a structure the colon list is BARE: there is no
    // `Inherits`/`Implements` keyword, because a structure cannot inherit and
    // an interface has nothing to inherit from. This is a separate rule from
    // the class form precisely because of that missing keyword; folding the two
    // together would make the keyword-less list unreachable. `Implements` is
    // still accepted, because real code writes it.
    _interface_list_clause: ($) =>
      prec.right(
        10,
        seq(
          token(":"),
          optional(ci("Implements")),
          commaSep1($._name_reference)
        )
      ),

    class_declaration: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),  // Allow multiple attribute lists
        optional(field("modifiers", repeat1($.member_modifier))),
        ci("Class"),
        field("name", $.identifier),
        optional(field("type_parameters", $.type_parameter_list)),
        optional($._class_heritage_clause),
        $._block_terminator,
        field("body", repeat($._type_member_declaration)),
        ci("End"),
        ci("Class"),
        $._terminator
      ),

    structure_declaration: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),  // Change from optional to repeat
        optional(field("modifiers", repeat1($.member_modifier))),
        ci("Structure"),
        field("name", $.identifier),
        optional(field("type_parameters", $.type_parameter_list)),
        optional($._interface_list_clause),
        $._block_terminator,
        field("body", repeat($._type_member_declaration)),
        ci("End"),
        ci("Structure"),
        $._terminator
      ),

    interface_declaration: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),  // Change from optional to repeat
        optional(field("modifiers", repeat1($.member_modifier))),
        ci("Interface"),
        field("name", $.identifier),
        optional(field("type_parameters", $.type_parameter_list)),
        // `Interface I : IDisposable, IEnumerable` — an interface's only
        // heritage is the interface list, so it takes the same header clause.
        optional($._interface_list_clause),
        $._block_terminator,
        field("body", repeat($._interface_member_declaration)),
        ci("End"),
        ci("Interface"),
        $._terminator
      ),

    module_declaration: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),  // Change from optional to repeat
        optional(field("modifiers", repeat1($.member_modifier))),
        ci("Module"),
        field("name", $.identifier),
        $._block_terminator,
        field("body", repeat($._type_member_declaration)),
        ci("End"),
        ci("Module"),
        $._terminator
      ),

    enum_declaration: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),  // Change from optional to repeat
        optional(field("modifiers", repeat1($.member_modifier))),
        ci("Enum"),
        field("name", $.identifier),
        optional($.as_clause),
        $._block_terminator,
        repeat($.enum_member_declaration),
        ci("End"),
        ci("Enum"),
        $._terminator
      ),

    enum_member_declaration: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),
        field("name", $.identifier),
        optional(seq("=", field("value", $._expression))),
        $._terminator
      ),

    delegate_declaration: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),  // Change from optional to repeat
        optional(field("modifiers", repeat1($.member_modifier))),
        ci("Delegate"),
        choice(ci("Sub"), ci("Function")),
        field("name", $.identifier),
        optional(field("type_parameters", $.type_parameter_list)),
        optional(field("parameters", $.parameter_list)),
        optional($.as_clause),
        $._terminator
      ),

    // Type members
    _type_member_declaration: ($) =>
      choice(
        prec(-1, $.empty_statement),
        prec(10, $.inherits_statement),
        prec(10, $.implements_statement),
        prec(100, $.constructor_declaration),
        // Explicitly add statements that can appear at class level
        prec(200, $.try_statement),      // Very high precedence
        prec(200, $.select_statement),   // Very high precedence
        prec(200, $.if_statement),
        prec(200, $.while_statement),
        prec(200, $.do_statement),
        prec(200, $.for_statement),
        prec(200, $.for_each_statement),
        prec(200, $.using_statement),
        prec(200, $.with_statement),
        prec(200, $.synclock_statement),
        prec(200, $.throw_statement),
        prec(200, $.return_statement),
        prec(200, $.exit_statement),
        prec(200, $.continue_statement),
        prec(200, $.stop_statement),
        prec(200, $.end_statement),
        prec(200, $.goto_statement),
        prec(200, $.resume_statement),
        prec(200, $.error_statement),
        prec(200, $.on_error_statement),
        prec(200, $.redim_statement),
        prec(200, $.erase_statement),
        prec(200, $.raiseevent_statement),
        prec(200, $.add_handler_statement),
        prec(200, $.remove_handler_statement),
        prec(200, $.call_statement),
        prec(200, $.yield_statement),
        prec(200, $.assignment_statement),
        prec(200, $.expression_statement),
        prec(200, $.declaration_statement),
        prec(200, $.labeled_statement),
        prec(1, $.method_declaration),
        prec(1, $.property_declaration),
        prec(1, $.event_declaration),
        prec(1, $.operator_declaration),
        // P/Invoke `Declare` sits in a Class/Module body alongside methods.
        prec(1, $.declare_statement),
        $.type_declaration_in_type,
        prec.dynamic(-100, $.field_declaration)  // Very low precedence
      ),

    type_declaration_in_type: ($) =>
      choice(
        $.class_declaration,
        $.structure_declaration,
        $.interface_declaration,
        $.enum_declaration,
        $.delegate_declaration
      ),

    _field_modifiers: ($) => repeat1($.member_modifier),

    variable_declarator: ($) =>
      seq(
        field("name", $.identifier),
        optional(choice(
          // Array bounds specification
          seq("(", field("bounds", commaSep1($._expression)), ")"),
          // Array rank specification
          $.array_rank_specifier
        )),
        // `as_clause` now carries BOTH the plain `As T` and the `As New T [= x]`
        // forms, so the separate `As New` branch that used to live here is gone:
        // keeping both made the two rules match the same text and the generator
        // refused to rank them.
        optional($.as_clause),
        // `Dim xs() As T = {a, b}` is legal VB. The braced form is reached
        // through `_literal` (see `array_initializer`), so it needs no mention
        // here; what still needs naming is the two initializer forms that are
        // NOT expressions: LINQ's `From`-led collection initializer and the
        // `With`-led object initializer.
        optional(seq(
          "=",
          field("initializer", choice(
            $._expression,
            $.collection_initializer,
            $.object_initializer
          ))
        ))
      ),


    field_declaration: ($) =>
      prec.dynamic(-100, seq(
        repeat(field("attributes", $.attribute_list)),
        optional(field("modifiers", repeat1($.member_modifier))),
        commaSep1($.variable_declarator),
        $._terminator
      )),

    field_variable_declarator: ($) =>
      seq(
        field("name", $._non_statement_identifier),
        optional($.array_rank_specifier),
        optional($.as_clause),
        optional(seq("=", field("initializer", $._expression)))
      ),

    property_declaration: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),
        optional(field("modifiers", repeat1($.member_modifier))), // Changed
        ci("Property"),
        field("name", $.identifier),
        optional(field("parameters", $.parameter_list)),
        $.as_clause,
        optional($.implements_member_clause),
        optional(seq("=", field("initializer", $._expression))),
        choice(
          $._terminator, // Auto-implemented property
          seq(
            $._block_terminator,
            optional($.property_getter),
            optional($.property_setter),
            ci("End"),
            ci("Property"),
            $._terminator
          )
        )
      ),

    property_getter: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),
        optional(field("modifiers", repeat1($.member_modifier))),
        ci("Get"),
        $._block_terminator,
        repeat($._method_body_statement),  // Use the new rule here
        ci("End"),
        ci("Get"),
        $._terminator
      ),

    property_setter: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),
        optional(field("modifiers", repeat1($.member_modifier))),
        ci("Set"),
        optional(seq("(", field("parameter", $.parameter), ")")),
        $._block_terminator,
        repeat($._method_body_statement),  // Use the new rule here
        ci("End"),
        ci("Set"),
        $._terminator
      ),

    method_declaration: ($) =>
      prec(
        1,
        seq(
          repeat(field("attributes", $.attribute_list)),
          optional(field("modifiers", repeat1($.member_modifier))),
          choice(
            seq(
              ci("Sub"),
              field("name", $.identifier)
            ),
            seq(ci("Function"), field("name", $.identifier))
          ),
          optional(field("type_parameters", $.type_parameter_list)),
          optional(field("parameters", $.parameter_list)),
          optional($.as_clause),
          optional($.handles_clause),
          optional($.implements_member_clause),
          $._block_terminator,
          repeat($._method_body_statement),
          ci("End"),
          choice(ci("Sub"), ci("Function")),
          $._terminator
        )
      ),

    handles_clause: ($) => seq(ci("Handles"), commaSep1($.event_member)),

    event_member: ($) =>
      seq(
        field("object", $._name_reference),
        ".",
        field("event", $.identifier)
      ),

    constructor_declaration: ($) =>
      prec(
        100,
        seq(
          repeat(field("attributes", $.attribute_list)),
          optional(field("modifiers", repeat1($.member_modifier))),
          $._sub_new,
          optional(field("parameters", $.parameter_list)),
          $._block_terminator,
          optional($.constructor_initializer),
          repeat($._method_body_statement),  // Use the new rule here
          ci("End"),
          ci("Sub"),
          $._terminator
        )
      ),

    constructor_initializer: ($) =>
      seq(
        choice(ci("MyBase"), ci("MyClass")),
        ".",
        ci("New"),
        $.argument_list,
        $._terminator
      ),

    event_declaration: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),
        optional(field("modifiers", repeat1($.member_modifier))), // Changed
        ci("Event"),
        field("name", $.identifier),
        choice($.as_clause, field("parameters", $.parameter_list)),
        optional($.implements_member_clause),
        $._terminator
      ),

    operator_declaration: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),
        optional(field("modifiers", repeat1($.member_modifier))), // Changed
        ci("Operator"),
        field(
          "operator",
          choice(
            "+",
            "-",
            "*",
            "/",
            "\\",
            "^",
            "&",
            ci("Mod"),
            ci("And"),
            ci("Or"),
            ci("Xor"),
            ci("Not"),
            "<<",
            ">>",
            "=",
            "<>",
            "<",
            ">",
            "<=",
            ">=",
            ci("IsTrue"),
            ci("IsFalse"),
            ci("Like"),
            ci("CType")
          )
        ),
        field("parameters", $.parameter_list),
        $.as_clause,
        $._block_terminator,
        repeat($._statement),
        ci("End"),
        ci("Operator"),
        $._terminator
      ),

    // Interface members
    _interface_member_declaration: ($) =>
      choice(
        prec(-1, $.empty_statement),
        $.inherits_statement,
        $.interface_method_declaration,
        $.interface_property_declaration,
        $.interface_event_declaration,
        $.type_declaration_in_type
      ),

    interface_method_declaration: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),
        optional(field("modifiers", repeat1($.member_modifier))), // Changed
        choice(ci("Sub"), ci("Function")),
        field("name", $.identifier),
        optional(field("type_parameters", $.type_parameter_list)),
        optional(field("parameters", $.parameter_list)),
        optional($.as_clause),
        $._terminator
      ),

    interface_property_declaration: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),
        optional(field("modifiers", repeat1($.member_modifier))), // Changed
        ci("Property"),
        field("name", $.identifier),
        optional(field("parameters", $.parameter_list)),
        $.as_clause,
        $._terminator
      ),

    interface_event_declaration: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),
        optional(field("modifiers", repeat1($.member_modifier))), // Changed
        ci("Event"),
        field("name", $.identifier),
        choice($.as_clause, field("parameters", $.parameter_list)),
        $._terminator
      ),

    // Parameters
    type_parameter_list: ($) =>
      seq("(", ci("Of"), commaSep1($.type_parameter), ")"),

    type_parameter: ($) =>
      seq(
        optional($.variance_annotation),
        field("name", $.identifier),
        optional($.type_parameter_constraints_clause)
      ),
    variance_annotation: ($) => choice(ci("In"), ci("Out")),
    type_parameter_constraints_clause: ($) =>
      seq(
        ci("As"),
        choice(
          $.type_parameter_constraint,
          seq("{", commaSep1($.type_parameter_constraint), "}")
        )
      ),
    type_parameter_constraint: ($) =>
      choice($._type, ci("New"), ci("Class"), ci("Structure")),

    parameter_list: ($) => seq("(", commaSep($.parameter), ")"),

    parameter: ($) =>
      seq(
        repeat(field("attributes", $.attribute_list)),
        optional(
          field(
            "modifiers",
            repeat1(choice(ci("Optional"), ci("ByVal"), ci("ByRef"), ci("ParamArray")))
          )
        ),
        field("name", $.identifier),
        optional(choice(
          // Array parameter specification (e.g., values())
          $.array_rank_specifier,
          // Array bounds specification (e.g., values(10))
          seq("(", field("bounds", commaSep1($._expression)), ")")
        )),
        optional($.as_clause),
        optional(seq("=", field("default_value", $._expression)))
      ),

    // Statements
    _statement: ($) =>
      choice(
        $.empty_statement,
        $.labeled_statement,
        prec(2, $.select_statement),
        prec(2, $.try_statement),  // Give try_statement higher precedence
        $.declaration_statement,
        $.expression_statement,
        $.assignment_statement,
        $.call_statement,
        $.if_statement,
        $.while_statement,
        $.do_statement,
        $.for_statement,
        $.for_each_statement,
        $.using_statement,
        $.with_statement,
        $.throw_statement,
        $.return_statement,
        $.yield_statement,
        $.exit_statement,
        $.continue_statement,
        $.stop_statement,
        $.end_statement,
        $.goto_statement,
        $.resume_statement,
        $.error_statement,
        $.on_error_statement,
        $.redim_statement,
        $.erase_statement,
        $.synclock_statement,
        $.raiseevent_statement,
        $.add_handler_statement,
        $.remove_handler_statement
      ),

    // `:` separates statements on ONE line: `Me.a = -10000 : Me.b = 10000`.
    // The separator belongs to the STATEMENT LIST, not to any single
    // statement's terminator, because `_terminator` only accepts a colon that is
    // IMMEDIATELY followed by a newline -- so the general form had no
    // production and a colon-separated pair was an ERROR. Every statement list
    _statement_block: ($) => repeat1($._statement),

    // `_statement_block` is the plain statement repetition. The `:` SEPARATOR
    // is NOT handled here, and that is deliberate after measuring both ways.
    //
    // `:` between statements (`a = 1 : b = 2`) is modelled as its own statement
    // form, `colon_statement`, which is a `_statement`. Two designs were tried:
    // making the colon a property of the LIST, and making it a property of the
    // STATEMENT. The list design had to choose between an optional token at the
    // exact point where the expression parser was deciding whether to reduce
    // (and the shift won, folding `a = 1 : b = 2` into one assignment whose
    // right operand spanned the colon), or dropping `optional(":")` from
    // `_terminator` (which regressed six repro cases, because a trailing colon
    // is legal after `End If`, `End Sub`, a declaration, and a dozen other
    // heads). The statement design has neither problem: the colon lives inside
    // one node, and `_terminator` keeps its own colon for the end-of-line case.

    empty_statement: ($) => $._terminator,

    labeled_statement: ($) =>
      seq(field("label", $.identifier), ":", optional($._statement)),

    declaration_statement: ($) =>
      prec(1, seq(  // Add precedence
        repeat(field("attributes", $.attribute_list)),
        field("modifiers", choice(
          $.local_declaration_modifier,
          repeat1($.local_declaration_modifier)
        )),
        commaSep1($.variable_declarator),
        $._terminator
      )),

    expression_statement: ($) => seq($._expression, $._terminator),

    assignment_statement: ($) =>
      prec.right(
        PRECEDENCE.ASSIGNMENT,
        seq(
          field("left", choice(
            $.identifier,
            $.member_access_expression,
            $.array_access_expression
          )),
          field(
            "operator",
            choice("=", "+=", "-=", "*=", "/=", "\\=", "^=", "&=", "<<=", ">>=")
          ),
          field("right", $._expression),
          $._terminator
        )
      ),
    call_statement: ($) => seq(ci("Call"), $._expression, $._terminator),

    if_statement: ($) =>
      seq(
        ci("If"),
        field("condition", $._expression),
        ci("Then"),
        choice(
          // Single-line if
          seq(
            field("then_statement", $._statement),
            optional(seq(ci("Else"), field("else_statement", $._statement)))
          ),
          // Multi-line if
          seq(
            $._block_terminator,
            field("then_branch", repeat($._statement)),
            repeat($.elseif_clause),
            optional($.else_clause),
            ci("End"),
            ci("If"),
            $._terminator
          )
        )
      ),

    elseif_clause: ($) =>
      seq(
        ci("ElseIf"),
        field("condition", $._expression),
        ci("Then"),
        $._block_terminator,
        field("body", repeat($._statement))
      ),

    // `Else : stmt` is the colon form of the else head, exactly as `Case 1 :`
    // is for a case head -- the terminator that accepts `:` is shared.
    else_clause: ($) =>
      seq(ci("Else"), $._clause_terminator, field("body", repeat($._statement))),

    select_statement: $ => prec(2, seq(
      ci('Select'),
      ci('Case'),
      field('expression', $._expression),
      $._block_terminator,
      repeat($.case_clause),
      optional($.case_else_clause),
      ci('End'),
      ci('Select'),
      $._terminator
    )),

    case_clause: ($) =>
      seq(
        ci("Case"),
        field("values", commaSep1($.case_value)),
        $._clause_terminator,
        field("body", repeat($._statement))
      ),

    case_value: ($) =>
      choice(
        $._expression,
        seq(field("from", $._expression), ci("To"), field("to", $._expression)),
        seq(
          ci("Is"),
          field("operator", choice("<", ">", "<=", ">=", "=", "<>")),
          field("value", $._expression)
        )
      ),

    case_else_clause: ($) =>
      seq(
        ci("Case"),
        ci("Else"),
        $._clause_terminator,
        field("body", repeat($._statement))
      ),

    while_statement: ($) =>
      seq(
        ci("While"),
        field("condition", $._expression),
        $._block_terminator,
        field("body", repeat($._statement)),
        ci("End"),
        ci("While"),
        $._terminator
      ),

    do_statement: ($) =>
      seq(
        ci("Do"),
        optional(
          choice(
            seq(ci("While"), field("while_condition", $._expression)),
            seq(ci("Until"), field("until_condition", $._expression))
          )
        ),
        $._block_terminator,
        field("body", repeat($._statement)),
        ci("Loop"),
        optional(
          choice(
            seq(ci("While"), field("while_condition", $._expression)),
            seq(ci("Until"), field("until_condition", $._expression))
          )
        ),
        $._terminator
      ),

    for_statement: ($) =>
      seq(
        ci("For"),
        field("variable", $.identifier),
        optional($.as_clause),
        "=",
        field("from", $._expression),
        ci("To"),
        field("to", $._expression),
        optional(seq(ci("Step"), field("step", $._expression))),
        $._block_terminator,
        field("body", repeat($._statement)),
        ci("Next"),
        optional(field("counter", $.identifier)),
        $._terminator
      ),

    for_each_statement: ($) =>
      seq(
        ci("For"),
        ci("Each"),
        field("variable", $.identifier),
        optional($.as_clause),
        ci("In"),
        field("collection", $._expression),
        $._block_terminator,
        field("body", repeat($._statement)),
        ci("Next"),
        optional(field("counter", $.identifier)),
        $._terminator
      ),

    using_statement: ($) =>
      seq(
        ci("Using"),
        field("resource", choice($.variable_declarator, $._expression)),
        $._block_terminator,
        field("body", repeat($._statement)),
        ci("End"),
        ci("Using"),
        $._terminator
      ),

    with_statement: ($) =>
      seq(
        ci("With"),
        field("expression", $._expression),
        $._block_terminator,
        field("body", repeat(choice(
          $.declaration_statement,  // Allow declarations in With blocks
          $._statement
        ))),
        ci("End"),
        ci("With"),
        $._terminator
      ),

    try_statement: ($) =>
      prec(2, seq(
        ci("Try"),
        $._block_terminator,
        field("body", repeat($._statement)),
        repeat($.catch_block),
        optional($.finally_block),
        ci("End"),
        ci("Try"),
        $._terminator
      )),

    catch_block: ($) =>
      seq(
        ci("Catch"),
        optional(
          seq(
            field("exception", $.identifier),
            optional(seq(ci("As"), field("type", $._type))),
            optional(seq(ci("When"), field("filter", $._expression)))
          )
        ),
        $._block_terminator,
        field("body", repeat($._statement))
      ),
    finally_block: ($) =>
      seq(
        ci("Finally"),
        $._block_terminator,
        field("body", repeat($._statement))
      ),
    throw_statement: ($) =>
      seq(ci("Throw"), optional($._expression), $._terminator),
    return_statement: ($) =>
      seq(ci("Return"), optional($._expression), $._terminator),
    yield_statement: ($) => seq(ci("Yield"), $._expression, $._terminator),
    exit_statement: ($) =>
      seq(
        ci("Exit"),
        choice(
          ci("Do"),
          ci("For"),
          ci("While"),
          ci("Select"),
          ci("Sub"),
          ci("Function"),
          ci("Property"),
          ci("Try")
        ),
        $._terminator
      ),
    continue_statement: ($) =>
      seq(
        ci("Continue"),
        choice(ci("Do"), ci("For"), ci("While")),
        $._terminator
      ),
    stop_statement: ($) => seq(ci("Stop"), $._terminator),
    end_statement: ($) => seq(ci("End"), $._terminator),
    goto_statement: ($) =>
      seq(ci("GoTo"), field("label", $.identifier), $._terminator),
    resume_statement: ($) =>
      seq(
        ci("Resume"),
        optional(choice(ci("Next"), field("label", $.identifier))),
        $._terminator
      ),
    error_statement: ($) => seq(ci("Error"), $._expression, $._terminator),
    on_error_statement: ($) =>
      seq(
        ci("On"),
        ci("Error"),
        choice(
          seq(ci("GoTo"), field("label", choice($.identifier, "0"))),
          seq(ci("Resume"), ci("Next"))
        ),
        $._terminator
      ),
    redim_statement: ($) =>
      seq(
        ci("ReDim"),
        optional(ci("Preserve")),
        commaSep1($.redim_clause),
        $._terminator
      ),
    // `ReDim GLTF_in.matrix(15)` -- the target may be a member expression, not
    // only a bare identifier. A member_access_expression is an _expression, so
    // naming the field as one covers the bare identifier as well.
    redim_clause: ($) =>
      seq(field("array", $._expression), "(", commaSep1($._expression), ")"),
    erase_statement: ($) =>
      seq(ci("Erase"), commaSep1($.identifier), $._terminator),
    synclock_statement: ($) =>
      seq(
        ci("SyncLock"),
        field("expression", $._expression),
        $._block_terminator,
        field("body", repeat($._statement)),
        ci("End"),
        ci("SyncLock"),
        $._terminator
      ),
    raiseevent_statement: ($) =>
      seq(
        ci("RaiseEvent"),
        field("event", $.identifier),
        optional(field("arguments", $.argument_list)),
        $._terminator
      ),
    add_handler_statement: ($) =>
      seq(
        ci("AddHandler"),
        field("event", $._expression),
        ",",
        field("handler", $._expression),
        $._terminator
      ),
    remove_handler_statement: ($) =>
      seq(
        ci("RemoveHandler"),
        field("event", $._expression),
        ",",
        field("handler", $._expression),
        $._terminator
      ),

    // `Declare [Ansi] [Unicode] Function|Sub name Lib "dll" [Alias "entry"]
    //  (args) [As type]` — VB's unmanaged P/Invoke declaration. It is a MEMBER
    // declaration (it lives in a Class/Module body, not a statement list), and
    // upstream had no rule for it at all, so every P/Invoke in a VB.NET
    // assembly was an ERROR node. Modelled as a member with its own signature
    // fields so the analyzer can emit it as a real method symbol.
    //
    // `Lib` and `Alias` are SEQUENTIAL optionals, not a choice of one: VB spells
    // the managed entry point as `Lib "dll" Alias "EntryPoint"`, and a choice
    // form would accept either alone and reject the pairing that real
    // interop code actually uses.
    declare_statement: ($) =>
      seq(
        ci("Declare"),
        repeat(choice(ci("Ansi"), ci("Unicode"))),
        field("kind", choice(ci("Function"), ci("Sub"))),
        field("name", $.identifier),
        optional(seq(ci("Lib"), field("library", $.string_literal))),
        optional(seq(ci("Alias"), field("alias", $.string_literal))),
        optional(field("parameters", $.parameter_list)),
        // `Declare Sub` has no return value in VB, but the `As` clause is
        // accepted rather than rejected: a real corpus contains it, and a
        // grammar that hard-errors on a spelling the compiler tolerates turns
        // one member into an ERROR that swallows its whole body.
        optional($.as_clause),
        $._terminator
      ),

    query_expression: ($) =>
      seq($.from_clause, repeat($.query_body_clause), $.select_or_group_clause),
    from_clause: ($) => seq(ci("From"), commaSep1($.collection_range_variable)),
    collection_range_variable: ($) =>
      seq(
        field("variable", $.identifier),
        optional($.as_clause),
        ci("In"),
        field("collection", $._expression)
      ),
    query_body_clause: ($) =>
      choice(
        $.from_clause,
        $.let_clause,
        $.where_clause,
        $.join_clause,
        $.order_by_clause,
        $.aggregate_clause
      ),
    let_clause: ($) => seq(ci("Let"), commaSep1($.expression_range_variable)),
    expression_range_variable: ($) =>
      seq(
        field("variable", $.identifier),
        "=",
        field("expression", $._expression)
      ),
    where_clause: ($) => seq(ci("Where"), field("condition", $._expression)),
    join_clause: ($) =>
      seq(
        ci("Join"),
        $.collection_range_variable,
        ci("On"),
        commaSep1($.join_condition)
      ),
    join_condition: ($) =>
      seq(
        field("left", $._expression),
        ci("Equals"),
        field("right", $._expression)
      ),
    order_by_clause: ($) => seq(ci("Order"), ci("By"), commaSep1($.ordering)),
    ordering: ($) =>
      seq(
        field("expression", $._expression),
        optional(choice(ci("Ascending"), ci("Descending")))
      ),
    aggregate_clause: ($) =>
      seq(
        ci("Aggregate"),
        $.collection_range_variable,
        repeat($.query_body_clause),
        ci("Into"),
        commaSep1($.aggregate_element)
      ),
    aggregate_element: ($) =>
      seq(
        optional(seq(field("name", $.identifier), "=")),
        field("function", $.aggregate_function)
      ),
    aggregate_function: ($) =>
      seq(
        field(
          "name",
          choice(
            ci("Count"),
            ci("Sum"),
            ci("Min"),
            ci("Max"),
            ci("Average"),
            ci("All"),
            ci("Any"),
            ci("Group")
          )
        ),
        optional(seq("(", field("argument", $._expression), ")"))
      ),
    select_or_group_clause: ($) => choice($.select_clause, $.group_by_clause),
    select_clause: ($) => seq(ci("Select"), commaSep1($.select_element)),
    select_element: ($) =>
      choice(
        $._expression,
        seq(
          field("name", $.identifier),
          "=",
          field("expression", $._expression)
        )
      ),
    group_by_clause: ($) =>
      seq(
        ci("Group"),
        commaSep1($.group_element),
        ci("By"),
        commaSep1($.by_element),
        ci("Into"),
        commaSep1($.into_element)
      ),
    group_element: ($) =>
      choice(
        $._expression,
        seq(
          field("name", $.identifier),
          "=",
          field("expression", $._expression)
        )
      ),
    by_element: ($) =>
      choice(
        $._expression,
        seq(
          field("name", $.identifier),
          "=",
          field("expression", $._expression)
        )
      ),
    into_element: ($) => choice($.identifier, $.aggregate_element),

    // Comments
    comment: ($) => token(prec(100, choice(
      // Single quote comment (including multiple quotes) - don't consume newline
      /'+[^\n\r]*/,
      // REM followed by whitespace - don't consume newline
      /[Rr][Ee][Mm][ \t][^\n\r]*/
    ))),

    // Preprocessor Directives
    preprocessor_directive: ($) => token(seq("#", /[^\r\n]*/)),
  },
});

// Helper functions
function ci(keyword) {
  return new RegExp(
    keyword
      .split("")
      .map((letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`)
      .join("")
  );
}

// Helper function for negative lookahead
function negative_lookahead(pattern) {
  return seq(not(pattern), '');
}

function not(pattern) {
  return token(prec(-1, seq('', pattern)));
}

function commaSep1(rule) {
  return seq(rule, repeat(seq(",", rule)));
}

function commaSep(rule) {
  return optional(commaSep1(rule));
}

function commaSep2(rule) {
  return seq(rule, ",", commaSep1(rule));
}
