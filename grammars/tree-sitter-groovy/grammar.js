/**
 * @file Groovy grammar for tree-sitter
 * @author Amaan Qureshi <amaanq12@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const Java = require('tree-sitter-java/grammar.js');

/* eslint-disable no-multi-spaces */

const PREC = {
  // https://introcs.cs.princeton.edu/java/11precedence/
  COMMENT: 0,         // //  /*  */
  ASSIGN: 1,          // =  += -=  *=  /=  %=  &=  ^=  |=  <<=  >>=  >>>=
  DECL: 2,
  ELEMENT_VAL: 2,
  TERNARY: 3,         // ?:
  OR: 4,              // ||
  AND: 5,             // &&
  BIT_OR: 6,          // |
  BIT_XOR: 7,         // ^
  BIT_AND: 8,         // &
  EQUALITY: 9,        // ==  !=
  GENERIC: 10,
  REL: 10,            // <  <=  >  >=  instanceof
  SHIFT: 11,          // <<  >>  >>>
  ADD: 12,            // +  -
  MULT: 13,           // *  /  %
  CAST: 14,           // (Type)
  OBJ_INST: 14,       // new
  RANGE: 15,          // ..
  UNARY: 16,          // ++a  --a  a++  a--  +  -  !  ~
  POWER: 17,
  ARRAY: 18,          // [Index]
  OBJ_ACCESS: 18,     // .
  PARENS: 18,         // (Expression)
  CLASS_LITERAL: 19,  // .
};

/* eslint-enable no-multi-spaces */

const DIGITS = token(choice('0', seq(/[1-9]/, optional(seq(optional('_'), sep1(/[0-9]+/, /_+/))))));
const DECIMAL_DIGITS = token(sep1(/[0-9]+/, '_'));

const DELIMITER = choice(';', /\n/, '\0');

module.exports = grammar(Java, {
  name: 'groovy',

  conflicts: ($, original) => original.concat([
    [$.modifiers, $.annotated_type, $.module_declaration, $.package_declaration, $.function_definition],
    [$._method_declarator, $.function_definition],

    [$.primary_expression, $._variable_declarator_id, $._unannotated_type],
    [$.primary_expression, $._variable_declarator_id],
    // Untyped formal params make `(x)` context-dependent: parenthesized
    // expression, untyped parameter list, lambda param list, or type.
    [$.inferred_parameters, $.primary_expression, $._variable_declarator_id, $._unannotated_type],
    [$.inferred_parameters, $._variable_declarator_id],
    [$.inferred_parameters, $.primary_expression, $._variable_declarator_id],
    [$._variable_declarator_id, $._unannotated_type],
    [$.modifiers],
    [$.modifiers, $.annotated_type],
    [$.enum_body_declarations],
    [$.field_declaration, $.constant_declaration],
    [$.argument_list, $.formal_parameters],
    [$.enum_constant, $.generic_type],
    [$.enum_constant, $._unannotated_type],
    // #841 residual: `enum E { A<T> … }` — an identifier followed by `<` inside
    // an enum body is an enum constant, a generic type, or the type of a typed
    // member; the generator demands the three-way conflict now that
    // method_declaration accepts a type before its type parameters.
    [$.enum_constant, $._unannotated_type, $.generic_type],
    // …and its class-body twin: `modifiers identifier '<'` — the same
    // identifier-before-`<` three-way ambiguity, there between a typed member,
    // a declarator and a generic type.
    [$._variable_declarator_id, $._unannotated_type, $.generic_type],
    // …and the enum-body form of the same four-way ambiguity (a modifier-led
    // constant vs a modifier-led typed member vs a declarator vs a generic).
    [$.enum_constant, $._variable_declarator_id, $._unannotated_type, $.generic_type],

    [$.primary_expression, $.method_invocation],
    [$.field_access, $.method_invocation],
    // #742: a closure's implicit-parameter list (`{ a, b -> ... }`) begins
    // exactly like a variable_declarator_id, so the parse is genuinely
    // ambiguous until the arrow is seen.
    [$.closure, $._variable_declarator_id],
    // #742: `{ a, b -> ... }` param lists parse through the same state as
    // expression statements / lambda starts until the arrow disambiguates.
    [$.lambda_expression, $.expression_statement],
    [$.closure, $.lambda_expression],
    [$.closure, $.lambda_expression, $.expression_statement],
    [$.lambda_expression, $.statement],
    [$.enum_constant, $._variable_declarator_id],
    [$.enum_constant, $._variable_declarator_id, $._unannotated_type],
    [$.primary_expression, $._variable_declarator_id, $.closure],
    // #742: `(Type) x as Y` — cast vs as-coercion share the prefix
    [$.cast_expression, $.binary_expression],
    [$.array_access, $.expression],
    [$.record_pattern, $._unannotated_type],
    [$.instanceof_expression],
    [$._type, $.array_type],
    [$.annotated_type, $.array_type],

    [$.null_literal, $.reserved_word],
    [$.method_invocation, $._juxt_argument_list],
    [$.generic_type, $._juxt_argument_list],
    [$.annotated_type, $._juxt_argument_list],
    [$.array_access, $._juxt_argument_list],
    [$.primary_expression, $._unannotated_type, $._juxt_argument_list],
    [$.primary_expression, $._juxt_argument_list],
    [$.expression, $._juxt_argument_list],
    [$.expression, $.method_invocation],
    [$.method_invocation, $._juxt_function_name],
    [$.primary_expression, $.generic_type, $._juxt_argument_list],
    [$.expression, $.method_invocation, $._juxt_function_name],
    [$._unannotated_type, $._juxt_argument_list],
    [$.primary_expression, $._juxt_function_name],
    [$.primary_expression, $.method_invocation, $._juxt_function_name],
    [$.primary_expression, $._variable_declarator_id, $._unannotated_type, $._juxt_function_name],
    [$.primary_expression, $._unannotated_type, $._juxt_function_name],
    [$._literal, $._juxt_function_name],
    [$.array_access, $._juxt_function_name],

    [$.block, $.closure],
    [$.statement, $.closure],
    [$.expression, $._juxt_function_name],
    [$.expression, $.array_access, $._juxt_function_name],
    [$.primary_expression, $.explicit_constructor_invocation],
    // #841: slashy strings — `/a.b/` vs division. The '/' token is identical
    // for both, so the parse is genuinely ambiguous until the closing '/' is
    // seen: GLR keeps both interpretations alive and dynamic precedence
    // (slashy +5) picks the regex exactly when the division reading dies for
    // lack of a same-line closing '/'. A plain token would instead lex greedily
    // and turn `a / b / c` into division-slashy-division.
    [$.slashy_string, $.binary_expression],
    // #841: with the field_declaration delimiter optional (one-line class
    // bodies), the parser needs GLR to decide between continuing a
    // _variable_declarator_id (Java's `_` pattern + dimensions) and closing
    // the field at the same token — a genuine ambiguity, resolved by the
    // same dynamic precedence machinery as the rest of the file.
    [$._variable_declarator_id],
    // #841 round 17: after `= identifier`, the next token cannot tell
    // command-value from expression continuation (`y = foo / bar` division
    // vs `y = foo /bar/` slashy-string argument — real Groovy splits these
    // by spacing, the grammar cannot). GLR defers; the -1 last-resort bias
    // on _command_call_value keeps the expression reading wherever it is
    // live and falls back to the command call only when it is not
    // (`foo /bar/` — the trailing `/` kills the division reading).
    [$.primary_expression, $._command_call_value],
    // Same family, `[` lookahead: `y = foo [0]` — array access on the RHS
    // head vs the command-value reading (with the type-dimension reading
    // riding along). Resolved the same way.
    [$.primary_expression, $._unannotated_type, $._command_call_value],
    // Same family, `(` lookahead: `y = foo(x)` — a parenthesized argument
    // list after the RHS head (a method invocation reading, possibly after
    // a lambda). Resolved the same way.
    [$.primary_expression, $.method_invocation, $._command_call_value],
    // Same family inside `= { … }` initializers: a space-separated id +
    // literal could be a juxt, a command value, or an expression. GLR
    // defers; statement-side rules and last-resort bias decide.
    [$.primary_expression, $._command_call_value, $._juxt_function_name],
    // Same state, `(` lookahead: the id can also head a method invocation.
    [$.primary_expression, $.method_invocation, $._command_call_value, $._juxt_function_name],
    // Same state, `[` lookahead: the id can also be a declarator id (array
    // dimensions) or a type. GLR defers; the enclosing initializer decides.
    [$.primary_expression, $._variable_declarator_id, $._unannotated_type, $._command_call_value, $._juxt_function_name],
    // Same family, remaining keyword/bracket lookaheads inside `= { … }`
    // (`yield`, …) — the initializer content is genuinely multi-parseable,
    // and every set here is a subset of the same five-rule family. GLR
    // defers; statement-side rules and last-resort bias decide.
    [$.primary_expression, $._unannotated_type, $._command_call_value, $._juxt_function_name],
    // Same family, ':' lookahead: a named-arg map_item as the command
    // value's argument vs (inside `assert x = f y: …`) the assert message
    // separator — grammar cannot see spacing; zero corpus files carry the
    // assert shape. GLR defers; context decides.
    [$._command_call_value_args, $.map_item],
    // Same ':' state one level deeper: `assert x = f (1): msg` — the paren
    // group can be an argument_list element or a named-arg's parenthesized
    // value. GLR defers; context decides.
    [$.argument_list, $.map_item],
    // #841 round 21: Java's switch-case record patterns share the bare `_`
    // token with the new primary_expression admission (`case _(x) ->`); GLR
    // defers, context decides.
    [$.primary_expression, $.record_pattern_component],
    // #841 round 19: after an RHS method-invocation head, the next identifier
    // either continues the ordinary expression chain (primary_expression) or
    // starts a spaced chain segment (_command_chain_value, then-chains).
    // GLR defers; the -1 last-resort bias on the chain decides wherever the
    // expression reading survives.
    [$.primary_expression, $._command_chain_value],
    // …and the chain's own self-continuation: consecutive segments
    // (`then { } then { } then { }`) — GLR defers; the repeat machinery and
    // the -1 bias decide.
    [$._command_chain_value],
    // #841: `class C { List<String> xs }` — the field type can look like a
    // generic_type or the declarator can absorb the token; GLR decides.
    [$._variable_declarator_id, $.generic_type],
    // #841: `class C { C(int a) {} }` — a compact constructor's header and a
    // field declarator share the `identifier identifier {` prefix when the
    // field's delimiter is optional; GLR decides (the constructor reading
    // wins wherever a block follows).
    [$._variable_declarator_id, $.compact_constructor_declaration],
    // #841 residual (W22): with a dotted CONTINUATION legal after a field's
    // declarator, a bare `name .` at class-body level is genuinely ambiguous — a
    // field's DECLARATOR (`Foo b • .exclude()` continuing on the next line) vs a
    // SCOPED TYPE that continues (`a.b` ⏎ `.C x`). Both readings are real; GLR
    // decides, and the type reading wins only where a declarator/type actually
    // follows the dotted name. Declared rather than prec'd, so neither reading is
    // blanket-suppressed.
    [$._variable_declarator_id, $.scoped_type_identifier],
    // #841: same squeeze at the field_declaration level — shift the delimiter
    // (more fields on one line) vs reduce the field now (optional delimiter).
    [$.field_declaration],
    // #841: enum constants vs typed declarators share `Name(` and `Name Name`
    // prefixes once the field delimiter is optional; GLR decides.
    [$.enum_constant, $._variable_declarator_id, $.generic_type],
    // #841: quoted attribute names (`c.@"f"`, `c.@'f'`) make the '.'+'string'
    // prefix shared between field_access and GString template pieces; GLR
    // decides once the following token separates them.
    [$.field_access, $.template_expression],
    // #841: with '.' a legal statement FOLLOW (leading_dot_call), the juxt
    // argument machinery's type-vs-expression prefix ambiguity becomes
    // reachable at the dot; GLR decides (established pattern in this file).
    [$.primary_expression, $._unannotated_type, $.scoped_type_identifier, $._juxt_argument_list],      // #841: the chain tail (`if (c) x.f()
    //     .g()` — the if-consequence expression may extend over the dot or
    // end and let leading_dot_call take it); GLR decides.
    [$.expression, $.object_creation_expression, $.field_access, $.template_expression, $.method_invocation],
    // #841 round 3: `f(List<String>)` — the type reading vs a comparison
    // chain `f(List < String) > (...)`; the comparison dies at `> (`.
    [$.expression, $._unannotated_type],
    // #841 round 5: `Foo<User>.bar` — the generic type prefix is shared
    // between a scoped type reference and an expression field access, now that
    // generic_type is a value-position operand; GLR decides.
    [$.expression, $._unannotated_type, $.scoped_type_identifier],
    // #841 round 3: `Map<String, T> m` / `foo(Map < String …)` — the type
    // prefix is shared between generic_type, a bare type operand, and a
    // primary expression (the established juxt ambiguity, now with the
    // type-value reading added); GLR decides.
    [$.primary_expression, $._unannotated_type, $.generic_type],
    // #841 round 3: string/GString call names (`delegate."$k"(v)`) make a
    // string a possible callee, so `"lit" (args)` — a string callee vs a
    // string command-arg — needs GLR.
    [$._literal, $.method_invocation, $._juxt_function_name],
    // #841 round 3: `x.f(Boolean)` — the callee/object prefix is shared
    // between a method invocation, a primary expression, and a type operand
    // (`f(Boolean)` where Boolean is the class literal); GLR decides.
    [$.primary_expression, $.method_invocation, $._unannotated_type],
    // #841 round 3: `(x) -> …` lambda vs `(Type) x` cast vs `(x)` expression
    // — the parenthesized prefix is shared once types are value expressions.
    [$.lambda_expression, $.primary_expression, $._unannotated_type],
    // #841 round 22: `{ Type name -> ... }` — the typed params head vs the body's
    // juxt reading of the same tokens. Declared so GLR keeps both; the
    // error-free params-head parse then wins resolution.
    [$.juxt_function_call, $._closure_params_head],
    // #841 round 22 (generate-forced): `{ a, b -> … }` — the comma after the
    // first param reads as either the params-head separator or a variable
    // declarator list in the body. GLR keeps both; '->' decides.
    [$._variable_declarator_id, $._closure_params_head],
    // NOTE: generate also listed [lambda_expression, _closure_params_head] as
    // necessary in gen8 but UNNECESSARY in gen12 — the unnecessary form is a
    // known deregulation source (Legacy), so it is deliberately omitted.
    // #841 round 22 (generate-forced): `x = { a, b -> … }` — after '=' the
    // '{' body's first `identifier ,` forks three ways (primary_expression,
    // variable-declarator, params-head). GLR keeps all; '->' decides.
    [$.primary_expression, $._variable_declarator_id, $._closure_params_head],
    // #841 round 22 (generate-forced): same tie inside a `def f = { … }`
    // initializer — declaration RHS vs closure body. GLR keeps both.
    [$.primary_expression, $._variable_declarator_id, $._closure_params_head],
    // #841 round 3: string callee vs string argument (`"lit"."m"()` paths).
    [$._literal, $.method_invocation],
    // #841 round 3: command-chain callee/object vs type operand vs
    // method-invocation object — the juxt quartet with types added.
    [$.primary_expression, $.method_invocation, $._unannotated_type, $._juxt_function_name],
    // #841 round 3: `"lit".field` — string object field access vs a bare
    // string literal (juxt paths).
    [$._literal, $.field_access],
    // #841 round 3: string/GString object vs bare primary in the access
    // prefix (juxt paths).
    [$.primary_expression, $.field_access],
    // #841 round 3: `Map<String, T>` type prefix vs `map.field` access in
    // the juxt/type paths; GLR decides.
    [$.field_access, $.generic_type],
    // #841 round 3: object prefix shared between field access, primary, and
    // type operand (`Map.Entry` as type vs access); GLR decides.
    [$.primary_expression, $.field_access, $._unannotated_type],
    // #841 round 3: `org.springframework.X` scoped type vs dotted access
    // chain; GLR decides.
    [$.primary_expression, $.field_access, $._unannotated_type, $.scoped_type_identifier],
    // #841 round 3: `Outer.@Inner f` style prefix vs `x.@field` attribute
    // access; GLR decides.
    [$.field_access, $._unannotated_type],
    // #841 round 3: GString call name (`obj."$k"(v)`) shares the dotted
    // GString prefix with template pieces and field access; GLR decides.
    [$.field_access, $.template_expression, $.method_invocation],
    // #841 round 3: GString literal vs template-piece vs dotted-access
    // prefix (juxt paths).
    [$._literal, $.field_access, $.template_expression],
    // #841 round 3: `new Outer().new Inner()` — the object-creation rule is
    // self-nesting through the primary '.' prefix; GLR decides.
    [$.object_creation_expression],
    // #841 round 3: GString template vs method-invocation object prefix
    // (`"$k".m()`); GLR decides.
    [$.template_expression, $.method_invocation],
    // #841 round 3: `super.m()[i]` — self-nesting through the super prefix.
    [$.method_invocation],
    // G7: `[(Byte[]): v]` — a parenthesised parenthesised-ARRAY-TYPE map key
    // shares its whole prefix with a parenthesised type in expression position
    // (`'[' '(' _unannotated_type • ')'`), and tree-sitter refuses to generate
    // without a ruling. GLR settles it correctly rather than by preference: the
    // expression reading has no continuation, because the `:` that follows the
    // `)` only exists in `map_item`. Declared here as the narrowest available
    // ruling — raising `map_item`'s precedence instead would change every other
    // map and command-argument parse in the grammar.
    // #841 round 5: same consequence for the command-argument form `f(Byte[])`
    // (`_juxt_function_name '(' array_type • ')'`) now that array_type is a
    // value operand.
    [$.expression, $.map_item],
    [$.map_item, $._unannotated_type],
    // #841 round 5: consequence of admitting array_type as a value operand.
    // The `[(Byte[]): x]` map key above was deliberately kept to `$.array_type`
    // alone to dodge exactly this conflict; once the same form is legal as an
    // EXPRESSION, `[ '(' array_type • ')'` has three readings (map key, array
    // type, expression) and the ambiguity must be declared for GLR to settle
    // rather than avoided by omission. Verified by the corpus A/B, not assumed.
    [$.expression, $._unannotated_type, $.map_item],
    // #841 round 3: closure-body starts (`{ x …`) share the declarator/expr
    // prefix — the established quartet with closure added.
    [$.primary_expression, $._variable_declarator_id, $._unannotated_type, $.closure],
    // #841 round 3: `super.x.@y[i]` — self-nesting through the super prefix.
    [$.field_access],
  ]),

  extras: $ => [
    /\s/,
    // #841 round 11: Groovy's BACKSLASH LINE CONTINUATION. The real compiler
    // accepts a trailing `\` before a newline, and even a LONE `\` on its own
    // line (`MongoClientOptionsBuilder.groovy:89`, verified against Groovy
    // 3.0.24 by the parse oracle), treating it as if the newline were not
    // there. `extras` is the right home for it: extras are skipped BETWEEN
    // tokens exactly like whitespace, so no rule has to know about it and the
    // change cannot alter any production.
    $.line_continuation,
    $.line_comment,
    $.block_comment,
  ],

  rules: {
    // #841 round 20: Groovy's subscript takes a comma-separated index list
    // (`employee.properties['firstName', 'lastName'] = params` —
    // AdvancedDataBindingController:146; 3 corpus files). Java's inherited
    // array_access is single-index, so the juxt machinery was reading the
    // list as an ARRAY-LITERAL argument and the `=` was orphaned into an
    // ERROR. The real-Groovy oracle ACCEPTS the form. Overriding with a
    // commaSep index keeps the node name, fields and every other reading
    // identical; single-index trees are unchanged (commaSep's first element
    // IS the old shape), and the analyzer's array walk sees the same node.
    array_access: $ => seq(
      field('array', $.primary_expression),
      '[',
      field('index', commaSep1($.expression)),
      ']',
    ),

    // #841 round 21: in real Groovy `_` is an ordinary IDENTIFIER (oracle:
    // `def _ = 5`, `_ + 1`, `{ _ -> _ }` and the Spock interaction wildcard
    // `_ * builder.foo() >> false` — 2 corpus files — all ACCEPT). It lexes
    // as Java's underscore_pattern token, which Java reaches only through
    // pattern/declarator positions, so every `_`-in-expression died into
    // ERROR recovery. Admitting the token into primary_expression makes it a
    // legal expression operand everywhere, exactly as in real Groovy.
    primary_expression: ($, original) => choice(
      original,
      $.underscore_pattern,
    ),

    program: $ => seq(
      optional($.shebang),
      repeat($._toplevel_statement),
    ),

    _toplevel_statement: ($, original) => choice(
      original,
      $.function_definition,
    ),

    declaration: ($, original) => choice(
      original,
      $.package_declaration,
      $.trait_declaration,
    ),

    // Groovy traits are class-like types that may extend a super-trait and
    // implement interfaces, and carry concrete fields/methods/constructors.
    trait_declaration: $ => seq(
      optional($.modifiers),
      'trait',
      field('name', $.identifier),
      field('type_parameters', optional($.type_parameters)),
      optional($.superclass),
      optional($.super_interfaces),
      field('body', $.class_body),
    ),

    _class_body_declaration: ($, original) => choice(
      original,
      $.trait_declaration,
    ),


    shebang: $ => token(seq('#!', /.*/)),

    // #841 round 11: a backslash followed by optional blanks and a newline.
    line_continuation: _ => token(seq('\\', /[ \t]*\r?\n/)),

    expression_statement: $ => seq($.expression, DELIMITER),

    expression: ($, original) => choice(
      original,
      $.closure,
      $.range_expression,
      // #841 round 3: primitive types in value position — `type == boolean`,
      // `getMethod('setActive', boolean)`. Token-level superset: these lex as
      // fixed keywords, so no dotted-access ambiguity exists (the earlier
      // full type_expression node regressed dotted chains and was reverted —
      // `String[]`/`List<String>` value operands remain a documented gap).
      $.boolean_type,
      $.integral_type,
      $.floating_point_type,
      $.void_type,
      // #841 round 5: the two value-position forms that were still missing.
      // `reviews/m59-841-assert-comma-separator.md` §7b measured EIGHT
      // constructs across five positions — annotation argument, assignment
      // RHS, call argument, map value, comparison operand — that all fail on
      // this one absent production: `@Scaffold(Foo<User>)`,
      // `@Scaffold(List<String>)`, `@Scaffold(value = Foo<User>)`,
      // `Class c = Foo<User>`, `Class c = String[]`, `register(Foo<User>)`,
      // `[k: Foo<User>]`, `Foo<User> == null`. Every one ACCEPTED by the real
      // Groovy 3.0.24 compiler.
      //
      // Narrow on purpose, exactly like the `as` type operand above and the
      // `[(Byte[]): x]` map key below: `$.generic_type` and `$.array_type`,
      // NEVER the broad `$._unannotated_type`, whose earlier use as a
      // type-expression node regressed dotted chains and was reverted.
      $.generic_type,
      $.array_type,
    ),

    lambda_expression: $ => seq(
      optional(
        field('parameters', choice(
          $.identifier, $.formal_parameters, $.inferred_parameters, $._reserved_identifier,
        )),
      ),
      '->',
      field('body', choice($.expression, $.block)),
    ),

    local_variable_declaration: $ => choice(
      seq(
        optional($.modifiers),
        optional(choice(field('type', $._unannotated_type), 'def')),
        $._variable_declarator_list,
        DELIMITER,
      ),
      // #841 round 10: Groovy's MULTIPLE-ASSIGNMENT declaration —
      // `def (mapping, refDomainClass) = mockEntity(hasCompositeId)`. Every
      // corpus file carrying the form uses `def` with it, and one declares
      // TYPES inside the parentheses: `def (int max, int offset) = maxAndOffset()`
      // (AbstractS2UiDomainController.groovy), which is why the declarator here
      // is `optional(type) name` and not a bare identifier. The bare
      // `(a, b) = …` tuple-assignment form is a DIFFERENT construct with no
      // corpus instance, so it is deliberately not added.
      seq(
        optional($.modifiers),
        'def',
        '(',
        commaSep1(seq(optional(field('type', $._unannotated_type)), field('name', $.identifier))),
        ')',
        '=',
        field('value', $.expression),
        DELIMITER,
      ),
    ),

    import_declaration: $ => seq(
      'import',
      optional('static'),
      $._name,
      optional(seq('.', $.asterisk)),
      optional(seq('as', $.identifier)),
      DELIMITER,
    ),

    package_declaration: $ => seq(
      repeat($._annotation),
      'package',
      $._name,
      DELIMITER,
    ),

    enhanced_for_statement: $ => seq(
      'for',
      '(',
      optional($.modifiers),
      // #841: the loop variable may be declared `def` — `for (def x : list)` —
      // exactly like local_variable_declaration above. Without it every typed
      // for-in loop in build-logic scripts falls into ERROR recovery (and the
      // recovery cascades through the rest of the enclosing block).
      optional(choice(field('type', $._unannotated_type), 'def')),
      $._variable_declarator_id,
      choice(':', 'in'),
      field('value', $.expression),
      ')',
      field('body', $.statement),
    ),

    do_statement: $ => seq(
      'do',
      field('body', $.statement),
      'while',
      field('condition', $.parenthesized_expression),
      DELIMITER,
    ),

    if_statement: $ => prec.right(seq(
      'if',
      field('condition', $.parenthesized_expression),
      // #841 round 16: the bare-expression consequence is Groovy's one-liner
      // form (`if (x) y` before `}`/EOF), but it competes with the full
      // statement reading wherever a delimiter exists. Measured: once the
      // primitive-name family cleared the file's only ERROR, the tie flipped
      // and `if (attrs.id == null) attrs.remove('id')` split MID-LINE into
      // `attrs.remove` + `('id')` (GrailsParameterMapTests/FormTagLib span
      // proof, round-16 record §7t) — both readings error-free, so the choice
      // was decided by precedence, not by grammar. The ruling: the statement
      // reading wins ties; the bare form remains reachable exactly where no
      // delimiter can close a statement.
      field('consequence', choice($.statement, prec.dynamic(-1, $.expression))),
      optional(seq('else', field('alternative', $.statement))),
    )),

    // Groovy statements are newline-terminated (`if (x) throw new E()` is
    // idiomatic and legal); Java's inherited throw requires a literal ';',
    // which forced missing-token recovery on every such line.
    throw_statement: $ => seq('throw', $.expression, DELIMITER),

    // Annotation members are newline-terminated too.
    annotation_type_element_declaration: $ => seq(
      optional($.modifiers),
      field('type', $._unannotated_type),
      field('name', choice($.identifier, $._reserved_identifier)),
      '(', ')',
      field('dimensions', optional($.dimensions)),
      optional($._default_value),
      DELIMITER,
    ),

    // Same for `super(...)` / `this(...)` constructor-delegation lines
    // (mirrors the inherited Java rule, but newline-terminated).
    explicit_constructor_invocation: $ => seq(
      choice(
        seq(
          field('type_arguments', optional($.type_arguments)),
          field('constructor', choice($.this, $.super)),
        ),
        seq(
          field('object', choice($.primary_expression)),
          '.',
          field('type_arguments', optional($.type_arguments)),
          field('constructor', $.super),
        ),
      ),
      field('arguments', $.argument_list),
      DELIMITER,
    ),

    break_statement: $ => seq('break', optional($.identifier), DELIMITER),

    continue_statement: $ => seq('continue', optional($.identifier), DELIMITER),

    return_statement: $ => seq(
      'return',
      optional($.expression),
      DELIMITER,
    ),

    yield_statement: $ => seq(
      'yield',
      $.expression,
      DELIMITER,
    ),

    catch_formal_parameter: $ => seq(
      optional($.modifiers),
      optional($.catch_type),
      $._variable_declarator_id,
    ),

    binary_expression: ($, original) => choice(
      original,
      ...[
        ['in', PREC.REL],
        // #742: the spaceship operator (Groovy's Comparable compareTo).
        ['<=>', PREC.REL],
        // #841 round 7: Groovy 3's IDENTITY operators `a === b` / `a !== b`.
        // Legality is not assumed: both of the corpus files that use them
        // (`ColumnConfigSpec.groovy`, `HibernateConnectionSourceSettingsSpec`)
        // are in the oracle's ACCEPTED set, i.e. real Groovy 3.0.24 parses them
        // while our grammar does not. Same precedence as `==`/`!=`, which is
        // the level Java gives equality; longest-match lexing keeps `!==` from
        // splitting into `!=` + `=`.
        ['===', PREC.EQUALITY],
        ['!==', PREC.EQUALITY],
      ].map(([operator, precedence]) =>
        prec.left(precedence, seq(
          field('left', $.expression),
          // @ts-ignore
          field('operator', operator),
          field('right', $.expression),
        ))),
      prec.right(PREC.POWER, seq(
        field('left', $.expression),
        // @ts-ignore
        field('operator', '**'),
        field('right', $.expression),
      )),
      // Groovy elvis operator:  a ?: b
      prec.right(PREC.TERNARY, seq(
        field('left', $.expression),
        // @ts-ignore
        field('operator', '?:'),
        field('right', $.expression),
      )),
      // #742: Groovy `as` coercion — `x as Type`, `(...) as Type[]`, and the
      // regex matchers `=~` / `==~`. Ubiquitous in real Groovy; without them
      // every such line fails into ERROR/missing-token recovery.
      prec.right(PREC.CAST, seq(
        field('left', $.expression),
        // @ts-ignore
        field('operator', 'as'),
        field('type', $._type),
      )),
      prec.left(PREC.REL, seq(
        field('left', $.expression),
        // @ts-ignore
        field('operator', choice('=~', '==~')),
        field('right', $.expression),
      )),
    ),

    method_declaration: $ => seq(
      optional($.modifiers),
      choice(
        $._method_header,
        // #841 residual — Groovy writes the return type BEFORE the type
        // parameters: `def <T extends AsyncListener> T createListener(Class<T>)`
        // (grails-core GrailsAsyncContext.groovy:51). Java's `_method_header` is
        // the opposite order, so before the F6 narrow of `field_declaration` the
        // only parse that fitted was a bogus FIELD named `def` followed by the
        // method — error-free but wrong, and the narrow turned it into a real
        // ERROR (found by the m12 groovy census, 29 → 30 of 400). Both orders
        // are accepted; the type-parameters-first form is Groovy's own
        // (`<T> T m()`), the type-first form is the one above.
        seq(
          field('type', $._unannotated_type),
          field('type_parameters', $.type_parameters),
          // …and the METHOD's own return type follows the parameters, so the
          // Groovy shape carries two types (`def` then `T`). Without this the
          // `T` had nowhere to go and landed in an ERROR node.
          field('type', $._unannotated_type),
          $._method_declarator,
          optional($.throws),
        ),
      ),
      // Groovy one-liner method bodies are bare expressions (def add(a,b) { a + b })
      // — Java's block only accepts statements, so accept the closure form too.
      choice(field('body', $.block), field('body', $.closure), ';', '\n', '\0'),
    ),

    // #841: Groovy treats the closing brace as an implicit statement
    // terminator, so one-line try/catch bodies (`try { promise.get() }` —
    // 12+ occurrences in the grails-core census, previously ~59 MISSING ;)
    // need the same bare-expression tail escape the closure rule already has.
    // Without it, `promise.get()` needs a DELIMITER before '}' and the parser
    // inserts a MISSING ; inside the region. Mirrors closure above: statements
    // first (semicolon-terminated), then at most ONE bare expression/return
    // immediately before the '}'. Real Groovy would reject `} y()` after a
    // bare tail too, so the shape coverage is exact.
    block: $ => seq(
      '{',
      repeat($.statement),
      optional(choice(
        $.expression,
        seq('return', optional($.expression)),
        seq('throw', optional($.expression)),
      )),
      '}',
    ),

    constructor_body: ($, original) => choice(
      original,
      $.closure,
    ),

    // Command chains (println "hi") are statements, not expressions.
    statement: ($, original) => choice(
      original,
      $.juxt_function_call,
      // #841: Groovy 3 leading-dot chain continuation — `Options.builder()
      //     .standalone(false)` with the dot starting a line. The statement
      // above is delimiter-complete before the dot (the newline was consumed
      // as its DELIMITER), so without this form the '.' is orphaned and the
      // parser ERROR-recovers (AsciiDocEngine L55, DocPublisher L459, … —
      // ~14 corpus files). Dynamic precedence is negative so that wherever a
      // same-line continuation is still syntactically possible (the newline
      // can be eaten as an extra inside the unfinished expression), the GLR
      // keeps the chain-in-one-expression reading and this form only wins
      // when the previous statement is genuinely complete. AST tradeoff,
      // documented: after a complete statement the dotted segment becomes its
      // own statement node instead of extending the previous expression —
      // the call is still analyzer-visible and attributed to the enclosing
      // scope, which is what the symbol graph consumes.
      $.leading_dot_call,
      // #841 round 3: operator-first line continuations — real Groovy
      // continues an expression across a newline with the operator LEADING
      // the next line (`return a > 1` / `  && ClassUtils.isPresent(b)`,
      // `.onError(c)` / `  as Promise<List<T>>`, `.getProperty(p, List)` /
      // `  ?: []`). The newline was already consumed as the previous
      // statement's DELIMITER, so like leading_dot_call these become their
      // own statement node; dynamic precedence -2 keeps same-line
      // continuation winning wherever syntactically possible. AST tradeoff,
      // documented: the continued operand is analyzer-visible as its own
      // node instead of ERROR-recovering the whole region.
      $.operator_continuation,
    ),

    // #841 round 17: command-call values — real Groovy accepts a command
    // chain as the RHS of a declarator or an assignment (`def allMappings =
    // evaluator.evaluateMappings mappings`, `generator.urlMappingsHolder =
    // getUrlMappingsHolder mappings`, ~16 corpus files). Oracle boundary,
    // verified: ACCEPTS in declarator/assignment RHS (bare callee, dotted
    // callee, and as a field initializer), REJECTS as `return foo bar`.
    // Admission is therefore restricted to exactly these two RHS slots —
    // NOT `$.expression` — so the refuted supersets (return operands,
    // bare statement operands) stay rejected. The node is the existing
    // `juxt_function_call`, so the analyzer's statement-level handling
    // applies unchanged. Known inherited limitation: whitespace-separated
    // multi-arg chains (`foo bar baz`) remain unparsed (documented at
    // _juxt_argument_list).
    _variable_initializer: ($, original) => choice(
      original,
      // Last-resort admissions (see _command_call_value and
      // _command_chain_value for the shapes and the corpus/oracle contract).
      prec.dynamic(-1, $._command_call_value),
      prec.dynamic(-1, $._command_chain_value),
    ),

    // #841 round 17: command-call values — real Groovy accepts a command
    // chain as the RHS of a declarator or an assignment (`def allMappings =
    // evaluator.evaluateMappings mappings`, `generator.urlMappingsHolder =
    // getUrlMappingsHolder mappings`, ~16 corpus files). Oracle boundary,
    // verified: ACCEPTS in declarator/assignment RHS (bare callee, dotted
    // callee, and as a field initializer), REJECTS as `return foo bar` —
    // so admission is restricted to exactly these two RHS slots, NOT
    // `$.expression`. Unlike the statement-side juxt, the name set excludes
    // parenthesized heads and the argument list is restricted to simple
    // items (identifier, literal, named-arg map_item) — every corpus
    // command-value qualifies, and the restriction keeps the RHS state
    // space from re-entering every expression continuation (the broad
    // `_juxt_argument_list` re-opened cast-expression, `*`/`[`/`@`/`(`
    // continuations and cost 3 clean files their parses when measured).
    // The node is aliased to `juxt_function_call`, so the tree — and the
    // analyzer's statement-level handling — is identical to the statement
    // form. Last-resort via prec.dynamic(-1): wherever an ordinary
    // expression reading completes, it wins.
    _command_call_value: $ => alias(
      seq(
        field('name', choice($.identifier, $.field_access, $.array_access)),
        // Single-argument: a named-arg map_item (RestOauthService:68
        // `link controller: 'restOauth', …` — 3 corpus files) or one simple
        // item (every other corpus command value). No comma repeat: a comma
        // after the first arg would need a GLR declaration on the arg-list
        // state, and measuring that declaration showed it deregulates the
        // statement-side juxt chain (LegacyCommandRegistryLoadingSpec
        // collapses 1→14 error nodes). Multi-arg command values stay
        // unparsed — they were error files before this round too, so the
        // residual does not regress; documented at the oracle note below.
        field('args', alias($._command_call_value_args, $.argument_list)),
      ),
      $.juxt_function_call,
    ),

    // #841 round 19: the spaced then-chain — `promise = promise.then { it * 2 }
    // then { it + 6 }` (7 corpus files, oracle-ACCEPTED in all three spellings:
    // decl RHS, statement, with-throw). After the head `promise.then { … }`
    // completes, the trailing `then { … }` had NO legal continuation — the
    // parser ERROR-recovered over the first segment. The continuation segments
    // (`name closure`) are aliased to method_invocation so the analyzer sees
    // exactly the dotted-chain node it already emits `calls` edges for — the
    // round-18 lesson: alias to the REAL production, never invent a shape the
    // call walk must be taught. RHS-only, like _command_call_value; -1
    // last-resort so every ordinary reading wins wherever it completes.
    _command_chain_value: $ => prec.dynamic(-1, seq(
      field('receiver', $.method_invocation),
      repeat1(alias(
        seq(
          field('name', $.identifier),
          field('args', $.closure),
        ),
        $.method_invocation,
      )),
    )),

    _command_call_value_args: $ => choice(
      $.map_item,
      $.identifier,
      $._literal,
    ),

    // Same restriction in the assignment slot — last-resort so every
    // ordinary-expression reading wins and the command call is admitted
    // only where no other reading completes.
    assignment_expression: ($, original) => prec.right(PREC.ASSIGN, seq(
      field('left', choice(
        $.identifier,
        $._reserved_identifier,
        $.field_access,
        $.array_access,
      )),
      field('operator', choice('=', '+=', '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=', '>>>=')),
      field('right', choice($.expression, prec.dynamic(-1, $._command_call_value), prec.dynamic(-1, $._command_chain_value))),
    )),

    operator_continuation: $ => prec.dynamic(-2, prec.right(choice(
      seq(field('operator', choice('&&', '||')), field('operand', $.expression)),
      seq('as', field('type', $._type)),
      seq('?:', field('default', $.expression)),
    ))),


    leading_dot_call: $ => prec.dynamic(-2, prec.right(seq(
      '.',
      field('name', choice($.identifier, $._reserved_identifier, $.string_literal, $.character_literal)),
      optional(field('arguments', $.argument_list)),
      optional(field('body', $.closure)),
    ))),

    // Groovy asserts are newline-terminated.
    //
    // #841: the message separator is `:` OR `,`. The upstream rule accepted only
    // the colon form, so every file carrying `assert cond, 'message'` failed to
    // parse — and the recovery does not stop at the statement: it swallows the
    // enclosing class, which is why MailMessageBuilder.groovy reported its first
    // error on the `class` line rather than the assert. Verified against a REAL
    // Groovy 3.0.24 toolchain (script/m14/tmp/assert-comma-validity.groovy): both
    // separators parse and run, and the comma form raises
    // `AssertionError: <message>`. Measured on grails-core: 34 of the 322 residual
    // files contain the comma form (10.6%).
    assert_statement: ($, original) => seq(
      'assert',
      $.expression,
      optional(seq(choice(':', ','), $.expression)),
      DELIMITER,
    ),

    // Spock specs declare test methods with string names:
    //   def "addition is commutative"() { ... }
    // #841: single-quoted names too — `void 'createPromise with a null list'()` —
    // the single-quote form lexes as character_literal (which the #742 round
    // already turned into a full string), so the name choice needs it.
    _method_declarator: ($, original) => seq(
      field('name', choice($.identifier, $._reserved_identifier, $.string_literal, $.character_literal)),
      field('parameters', $.formal_parameters),
      field('dimensions', optional($.dimensions)),
    ),

    // Groovy member access adds safe navigation (?.) and spread-dereference (*.)
    // to Java's plain dot.
    // #841: attribute access `.@` — `c.@field`, `c.@"field"`, `c.@'field'` —
    // bypasses getters and hits the backing field directly; the field name may
    // be a quoted string. (Corpus: GrailsDependencyValidatorPlugin, SoftwareVersion.)
    field_access: $ => seq(
      field('object', choice($.primary_expression, $.super)),
      optional(seq(
        choice('.', '?.', '*.'),
        $.super,
      )),
      // #841 round 3: `.&` method reference — `this.&baz`, `obj.&method` —
      // first-class closure values in Groovy (method pointers). Lexically the
      // '.&' token is longest-match over '.' + '&', so `a & b.c` is untouched.
      choice('.', '?.', '*.', '.@', '.&'),
      // #841 round 16: primitive type names are legal member names in Groovy —
      // `params.int('max')`, `attrs.boolean('omitNext')`, `foo.long` — but the
      // Java base lexes the words as fixed tokens. Admitted in the member
      // position only (the call-name position below), where a type cannot
      // stand.
      field('field', choice($.identifier, $._reserved_identifier, $.this, $.string_literal, $.character_literal, $.integral_type, $.floating_point_type, $.boolean_type)),
    ),

    function_definition: $ => seq(
      repeat($._annotation),
      optional($.modifiers),
      choice(field('type', $._unannotated_type), 'def'),
      field('name', $.identifier),
      field('parameters', $.formal_parameters),
      field('body', $.closure),
    ),

    method_invocation: $ => prec.right(seq(
      choice(
        // #841 round 3: GString (`delegate."$entry.key"(v)`) and quoted
        // (`bean."autowire"`) method names — dynamic dispatch by name. Also
        // slashy names: `mock./print.*/(* _)` names methods by regex.
        // #841 G9: `$.character_literal` in BOTH name choices — Groovy's
        // single-quoted string lexes as character_literal (the #742 residual),
        // so the PARENTHESISED form of a quoted callee had no rule at all:
        // `'/500'(view: '/error')` (grails UrlMappings), `'in'(list)` and
        // `'*'(...)` in Constraints DSL blocks, `'user-type'(...)` in Hibernate
        // mapping builders. The command (paren-less) form always accepted it
        // through `_juxt_function_name`'s `$.primary_expression` — which is why
        // only the paren form failed, and why `"$quoted"(...)` always worked
        // (that is a real string_literal).
        field('name', choice($.identifier, $._reserved_identifier, $.string_literal, $.character_literal, $.template_expression, $.slashy_string)),
        seq(
          field('object', choice($.primary_expression, $.super)),
          // Groovy adds safe navigation (?.) and spread-dereference (*.) to
          // Java's plain member access (.).
          choice('.', '?.', '*.'),
          optional(seq(
            $.super,
            '.',
          )),
          field('type_arguments', optional($.type_arguments)),
          // #841 round 16: the dotted call-name position accepts the primitive
          // type names (`params.int('max')`, `attrs.boolean('omitNext')` — the
          // largest single residual family, ~20 corpus files). Bare `int('x')`
          // stays an error, matching real Groovy 3.0.24.
          field('name', choice($.identifier, $._reserved_identifier, $.string_literal, $.character_literal, $.template_expression, $.slashy_string, $.integral_type, $.floating_point_type, $.boolean_type)),
        ),
      ),
      choice(
        seq(
          optional(field('arguments', $.argument_list)),
          field('body', $.closure),
        ),
        seq(
          field('arguments', $.argument_list),
          optional(field('body', $.closure)),
        ),
      ),
    )),

    // Groovy formal parameters are untyped by default (def foo(a, b = 2)), so
    // the type is optional — Java requires it.
    formal_parameter: $ => seq(
      optional($.modifiers),
      optional(field('type', $._unannotated_type)),
      $._variable_declarator_id,
      optional(seq('=', $.expression)),
    ),

    argument_list: $ => seq(
      '(',
      // #742: spread call arguments — `convert(*args)` — are legal in the
      // parenthesised form as well as the command-chain form.
      // #841: the spread-MAP form `f(*:map)` spreads entries as named args —
      // distinct from `*expr`, so it gets its own named node and the lexer's
      // two-token lookahead ('*' then ':') separates the forms.
      commaSep(choice($.expression, $.map_item, $.spread_argument, $.spread_map_argument)),
      optional(','),
      ')',
    ),

    // #841: spread-map argument — `builder(*: settings)`. The named node keeps
    // the form visible to analyzers instead of an ERROR recovery region.
    spread_map_argument: $ => prec(2, seq('*', ':', $.expression)),

    juxt_function_call: $ => prec.left(1, seq(
      field('name', $._juxt_function_name),
      field('args', alias($._juxt_argument_list, $.argument_list)),
    )),

    // #742 residual: Groovy's single-quoted string is a full string literal,
    // not Java's one-character `char`. Java's inherited rule requires at least
    // one character (`repeat1`), so the very common empty literal `''` failed
    // to parse — it is the largest single first-error signature in the
    // grails-core corpus (`@ID`, i.e. annotations like
    // `@Builder(builderStrategy = SimpleStrategy, prefix = '')`). Tripled
    // quotes still lex as the multiline form because the lexer prefers the
    // longest match.
    character_literal: _ => token(seq(
      "'",
      repeat(choice(
        /[^\\'\n]/,
        /\\./,
        /\\\n/,
      )),
      "'",
    )),

    reserved_word: _ => 'null',

    _juxt_function_name: $ => choice(
      $.identifier,
      $.primary_expression,
      $.string_literal,
      // #841 round 3: interaction-DSL callees name methods by regex —
      // `./print.*/(* _)`.
      $.slashy_string,
      // #742: `assertNull null.encodeAsBase64()` — `null` (and Java's
      // `true`/`false` literals) are legal command-chain callees (Groovy
      // allows any expression there).
      $.reserved_word,
      $.true,
      $.false,
    ),

    // Command-chain arguments (comma-separated; whitespace-separated multi-arg
    // chains like `processBuilder "ls" "-la"` are a documented limitation —
    // whitespace-as-token conflicts with the extras handling).
    // §8.1: the `as` coercion as a COMMAND-CHAIN argument.
    //
    // `_juxt_argument_list` is all atoms, so `assertEquals '1' as char,
    // map.char('one')` was an ERROR at the second argument while every neighbouring form
    // parsed — the single-argument form, the parenthesised form, and the form with the
    // cast in the LAST argument. It was specifically a comma AFTER a cast that broke,
    // which is the signature of a missing argument alternative rather than a bad
    // precedence.
    //
    // Admitting all of `binary_expression` there fixes those lines and also
    // `assertEquals a == b, c`, and costs 19 previously-clean files (review §8.1):
    // `binary_expression` also covers `x.y(args)`, so `joinTable.key(v)` became ambiguous
    // between a method call and a command callee `joinTable` with a `key(v)` argument,
    // and two new declared conflicts were needed to generate at all.
    //
    // Two choices avoid that, and both are load-bearing:
    //
    // 1. The LEFT is the same ATOM list `_juxt_argument_list` admits, written out inline,
    //    and not `$.expression`. With a general `$.expression` on the left,
    //    `identifier • '->'` is unresolvable, because a lambda is an expression and
    //    `foo bar -> baz` is a command call taking a lambda. An atom list contains no
    //    lambda, so the `->` state is never reachable from this rule. The list is duplicated
    //    rather than shared through a named rule on purpose: routing both sites through one
    //    `_juxt_operand` nonterminal changes the LR construction and produces a
    //    `_juxt_function_name identifier • '('` conflict instead. Both sites must stay
    //    flat for the grammar to generate.
    // 2. `binary_expression`'s own inline coercion is UNTOUCHED, so no existing parse is
    //    re-derived and no existing tree shape changes. This is an additional alternative
    //    at one call site, not a rewrite of the operator.
    //
    // `as` is the coercion the corpus needs: grails-core's GORM query-handler family and
    // the Liquibase changelog DSL both write casts as command arguments.
    _juxt_as_coercion: $ => prec.right(PREC.CAST, seq(
      field('left', choice(
        $._literal,
        $.map_item,
        $.identifier,
        $.field_access,
        $.method_invocation,
        $.object_creation_expression,
        $.closure,
        $.spread_argument,
      )),
      // @ts-ignore
      field('operator', 'as'),
      field('type', $._type),
    )),

    _juxt_argument_list: $ => commaSep1(choice(
      $._literal,
      $.map_item,
      $.identifier,
      // #742: `assertNull null.encodeAsBase64().x` — a dotted chain starting
      // on a literal is a legal command-chain argument.
      $.field_access,
      $.method_invocation,
      // #841 round 3: `assertEquals "test", new String(bytes.decodeBase64())`
      // — constructor calls are legal command arguments.
      $.object_creation_expression,
      // #742: a trailing closure is the canonical Groovy command-argument
      // (`findAll { }`, `"/url" { mappings }`).
      $.closure,
      $.spread_argument,
      // §8.1: and a coercion, so `foo 'x' as char, y` parses.
      $._juxt_as_coercion,
    )),

    // #742: Groovy spread call argument — `foo(*list)`.
    spread_argument: $ => prec(2, seq('*', $.expression)),

    // Groovy enum bodies may list members without a trailing semicolon after
    // the constants (Java requires the ';'). Kept as a non-empty choice so the
    // rule never matches the empty string (tree-sitter constraint): either the
    // Java form (`;` then members) or newline-separated members with no `;`.
    //
    // #841 residual (found by the M14.0.F6 fixture-coverage gate, 2026-09-15):
    // `HAPPY, GLOOMY` at the top of an enum body IS the constant list, but it is
    // ALSO a legal Groovy untyped field with two declarators (the conflict pair
    // [enum_constant, _variable_declarator_id] declared above). Allowing the
    // member list to begin with NO delimiter let GLR end the constant list at
    // the first constant and read the rest as members — `enum Mood { HAPPY,
    // GLOOMY … }` parsed with ONE enum_constant and `GLOOMY` a field, so the
    // analyzer's enum_constant handling went dead and constants stopped
    // producing symbols. Requiring a DELIMITER before the member list closes
    // that route without losing the Groovy form: a member may still follow
    // constants with no ';', it just has to start on a new line (which is what
    // real code does).
    enum_body_declarations: ($, original) => choice(
      original,
      repeat1(choice(
        $.field_declaration,
        $.constant_declaration,
        $.method_declaration,
        $.constructor_declaration,
        $.class_declaration,
        $.interface_declaration,
        $.enum_declaration,
        $.static_initializer,
        ';',
      )),
    ),

    // Groovy class-body fields are newline-terminated, not ';'-terminated
    // (Java requires ';' — the inherited rule only parses via missing-token
    // recovery on newline-terminated fields, which is not a clean parse).
    // Groovy also allows *untyped* fields with modifiers (`static mapWith =
    // 'neo4j'`, `static mapping = { ... }`) — `def`-like, type elided.
    // #841: the delimiter is optional because a one-line class body may end a
    // field with the closing brace itself (`class Spec { def svc = S() }` —
    // common in build-logic and tests); requiring a delimiter forced MISSING ;
    // recovery there (the largest MISSING-token class in the corpus census).
    // Scope is safe: field_declaration only occurs in class bodies, never in
    // method statements. The trade: `int a int b` on one line now parses as two
    // fields where real Groovy would reject it — accepted, documented here.
    // #841 residual (found by the M14.0.F6 fixture-coverage gate, 2026-09-15):
    // DYNAMIC precedence on the enum constant, so that when a body is genuinely
    // ambiguous — `HAPPY, GLOOMY` is both a constant list and (as `GLOOMY Mood`)
    // a typed field plus a constructor — the reading with MORE constants wins.
    // Together with the narrowed field below this resolves every enum shape
    // tested: constants-only, constants+members, constants with class bodies,
    // the Java `;` form, and typed fields in the body.
    enum_constant: ($, original) => prec.dynamic(1, original),

    // #841 residual: the TYPE-ELIDED branch is now modifier-led. Every construct that motivated
    // it IS modifier-led (`static mapWith = 'neo4j'`, `static mapping = { … }`,
    // `public xs = []`), and `def x` never needed it (the lexer reads `def` as an
    // identifier, so it arrives through the typed branch). What the unrestricted
    // form bought was `A, B` — a bare identifier list read as ONE untyped field
    // with two declarators — and that is the enum-constant syntax: it let
    // `enum Mood { HAPPY, GLOOMY … }` parse with ZERO enum_constant nodes while
    // the declared conflict [enum_constant, _variable_declarator_id] resolved
    // statically toward the field (tree-sitter reports it `unnecessary`, so GLR
    // never split). Consequence measured before this: the analyzer's
    // enum_constant handling was dead code and enum constants produced no
    // symbol. No legitimate class-body construct is lost: a bare name list with
    // no modifier is not a Groovy field.
    // #841 residual (W22): a class-level FIELD whose initializer continues on
    // lines beginning with a dot. Not an edge case — it is the Grails/Gradle
    // idiom (`Path scriptDir = Paths.get(getClass()` ⏎ `.protectionDomain` ⏎
    // `.codeSource` …; `Builder b = pm.builder()` ⏎ `.excludeTimestamps()` …)
    // and it used to abort the whole class body: the declarator is complete and
    // DELIMITED before the first dotted line, and a class body has no rule for a
    // bare '.', so the parser inserted a MISSING '}' and everything after the
    // field collapsed. That is why the census's largest remaining first-error
    // line was a bare '}' (57 files) — collateral, not a cause.
    //
    // The SAME `leading_dot_call` node the statement form uses (W20's contract),
    // bound to the field it continues, so the analyzer (real-groovy-analyzer
    // L587) and the oracle (differential L1376) consume it unchanged. The
    // delimiter is consumed ONCE, before the chain: inside the `repeat` the
    // newline between two continuation segments would be eaten as a DELIMITER
    // and the following `.x()` would have nowhere to go (measured — that
    // intermediate build failed on the class body's own close brace, probe case
    // 7 of script/m14/tmp/g841-chain-probe.ts). Between two segments the newline
    // is skipped as an extra, because DELIMITER is not a valid token inside the
    // suffix.
    //
    // The first implementation offered this node as a CLASS-BODY DECLARATION
    // instead (the obvious mirror of the statement-level escape). It passed
    // every hasError-based instrument — file sets 384 → 370 with 0 regressed —
    // and it was wrong: two corpus files' entire program collapsed into a single
    // top-level ERROR node and lost 18 relationships between them, because the
    // declared ambiguity above is then live at every `modifiers identifier .` in
    // every class body. Only the per-file RELATIONSHIP comparison saw it. Do not
    // move this node back up to the class body.
    field_declaration: $ => choice(
      seq(
        optional($.modifiers),
        field('type', $._unannotated_type),
        $._variable_declarator_list,
        optional(DELIMITER),
        repeat($.leading_dot_call),
      ),
      // #841 round 16: the TYPELESS (modifier-only) field reading is the
      // corrupt half of the field+constructor split — `@Override\n    def
      // index(Integer max) { … }` parsed as a field named `def` (the lexeme
      // lexes as an identifier wherever the `def` keyword token is not valid)
      // followed by a `constructor_declaration` once the primitive-name family
      // cleared the method body's ERROR and made both readings error-free
      // (span proof in the round-16 record). `def` is never a legal variable
      // name in Groovy, and a one-line class still needs the bare end (the
      // DELIMITER tax was measured and reverted — it regressed 9 one-line
      // class files), so the narrow ruling is dynamic precedence on THIS
      // branch only: a typeless field loses ties against a method reading,
      // while typed fields (the M59 absorb shape) keep their baseline
      // behaviour untouched.
      prec.dynamic(-1, seq(
        $.modifiers,
        $._variable_declarator_list,
        optional(DELIMITER),
        repeat($.leading_dot_call),
      )),
    ),

    constant_declaration: $ => seq(
      optional($.modifiers),
      field('type', $._unannotated_type),
      $._variable_declarator_list,
      DELIMITER,
    ),

    // #841 round 21: `_` as a MAP KEY — `[_: '', name: 'x']` "apply every
    // other property" (GrailsWebDataBinderSpec:1608, oracle-ACCEPTED) and the
    // bare subscript `m[_]` — died when `_` became a primary: the key slot
    // reads identifiers, not primaries, and the old ERROR recovery had masked
    // the distinction entirely.
    map_item: $ => seq(
      field('key', choice(
        $.identifier,
        $.underscore_pattern,
        // M49 W21 (#850): Java reserves `open`, `module`, `record`, `with` and
        // `sealed` as keywords, and this grammar extends Java — so a named
        // argument whose KEY is one of them (`exclude group: 'x', module: 'y'`,
        // ubiquitous in Gradle build scripts) lexed as a keyword token, not an
        // identifier, and `module:` could not be a map_item at all. Every other
        // name position in this grammar already accepts `_reserved_identifier`
        // (`field('name', choice($.identifier, $._reserved_identifier, …))` at
        // five sites); the map_item key was the one that did not. Measured on
        // grails-core: `exclude module: 'x'` alone is an ERROR and drags its
        // whole enclosing `dependencies { … }` block into ERROR recovery, which
        // is why the census's largest first-error signature was a bare `ID {`.
        $._reserved_identifier,
        // #841 round 9: the TYPE keywords (`boolean:`, `int:`, `long:`, `short:`,
        // `byte:`, `char:`, `float:`, `double:`, `void:`) and the four remaining
        // Java keywords (`new:`, `switch:`, `this:`, `super:`). Measured, not
        // guessed: of 64 keywords probed as `g.f(KW: v)`, exactly these 13 are
        // refused by us, and real Groovy 3.0.24 ACCEPTS all 13 — while the
        // contextual ones (`class`, `default`, `module`, `record`, `sealed`,
        // `var`, …) already work through `_reserved_identifier` above.
        $.boolean_type,
        $.integral_type,
        $.floating_point_type,
        $.void_type,
        $.this,
        $.super,
        'new',
        'switch',
        $._literal,
        // A parenthesised key may be an EXPRESSION (`(x)`, `(x.y)`, `(1+2)`) or
        // an ARRAY TYPE. The array arm was missing, so
        // `[(Byte[]): CustomScalars.X]` — a real Groovy idiom in type-registry
        // maps, and the construct that left
        // `DefaultGraphQLTypeManager.groovy` unparsed — was an ERROR, while
        // `[(Integer): 1]` happened to work only because `Integer` is also a
        // legal expression. Deliberately `$.array_type` and NOT
        // `$._unannotated_type`: the broader type choice makes
        // `[ (T) ]` ambiguous with a parenthesised type in expression position
        // (`'[' '(' _unannotated_type • ')'`) and tree-sitter refuses to
        // generate without a precedence override, which is a far wider hammer
        // than a missing `T[]` key needs.
        seq('(', choice($.expression, $.array_type), ')'),
      )),
      ':',
      field('value', $.expression),
    ),

    // #841 round 22: closure typed-parameter head, extracted from the closure
    // rule as a HIDDEN rule (underscore = spliced into the parent, so the
    // produced tree is byte-identical to the previous inline form). Exists as
    // a named symbol solely so the `ILoggingEvent event` ambiguity against the
    // body's juxt_function_call can be declared in `conflicts`.
    _closure_params_head: $ => prec(1, prec.dynamic(1, seq(
      repeat(seq(optional(choice($._unannotated_type, 'def')), $.identifier, ',')),
      // #841 round 3: typed closure params may be declared `def`
      // (`out./print.*/(* _) >> { def args -> … }`, GrailsConsoleSpec) —
      // def is not a type in the grammar's eyes, so the param list needs
      // it explicitly.
      optional(choice($._unannotated_type, 'def')),
      $.identifier,
      '->',
    ))),

    closure: $ => prec(1, seq(
      '{',
      // Groovy closures take an implicit parameter list: `{ it }` (default),
      // `{ a, b -> ... }` (named, arrow form), `{ -> ... }` (zero-arg), or
      // typed (`{ MethodNode mn -> ... }`). Without it, `each { key, value ->
      // ... }` — ubiquitous in real code — forces ERROR recovery.
      optional(choice(
        // #841 round 22: named HIDDEN rule (tree shape unchanged) so the
        // type-vs-juxt ambiguity below can be DECLARED (inline alternatives
        // cannot be named in `conflicts`). With both stacks alive, GLR
        // completes the params-head and the error-free parse wins.
        $._closure_params_head,
        // #841 round 3: zero-arg arrow form `{ -> ... }`
        // (GrailsApplicationLifeCycleAdapter `return { -> }`).
        '->',
      )),
      repeat(choice($.statement, $.juxt_function_call)),
      // Single-line bodies may end in a bare expression (`{ x + 1 }`) or a
      // return with no trailing delimiter (`{ return id }`).
      // #841: same for a bare `throw` (`{ throw new RuntimeException('x') }` —
      // PromiseListSpec.groovy L82 and friends in the census) — throw is a
      // statement whose DELIMITER the one-liner never supplies.
      optional(choice(
        $.lambda_expression,
        $.expression,
        seq('return', optional($.expression)),
        seq('throw', optional($.expression)),
        // #841 round 3: bare one-liner assert — `'groovy'.each { assert
        // manager.getCache(it) }` — assert is newline-terminated as a
        // statement, so before '}' it needs the tail escape too.
        seq('assert', $.expression, optional(seq(':', $.expression))),
      )),
      '}',
    )),

    range_expression: $ => prec.right(PREC.RANGE, seq(
      field('start', $.expression),
      // #841 round 3: exclusive range `..<` — `sequence[i..<(i + degree)]`.
      // '..<' is longest-match over '..' + '<', so comparisons are untouched.
      choice('..', '..<'),
      field('end', $.expression),
    )),

    array_literal: $ => prec(1, seq(
      '[',
      commaSep($.expression),
      optional(','),
      ']',
    )),

    // Groovy's empty-map literal is `[:]` — a lone colon inside brackets.
    // #841: `[*: m]` spread-map entries copy m's entries into the new map —
    // distinct node so analyzers can tell copied keys from literal ones.
    map_literal: $ => choice(
      seq('[', ':', ']'),
      seq(
        '[',
        commaSep(choice($.map_item, $.spread_map_item)),
        optional(','),
        ']',
      ),
    ),

    spread_map_item: $ => seq('*:', $.expression),

    _multiline_string_literal: $ => choice(
      seq(
        '\'\'\'',
        repeat(choice(
          alias($._multiline_string_fragment_single, $.multiline_string_fragment),
          $._escape_sequence,
          // G7: NO `string_interpolation` here, deliberately. Groovy's
          // single-quoted forms (single or tripled) NEVER interpolate, so the
          // inherited Java alternative was dead only because `string_interpolation`
          // required a `\{` that Groovy source never contains. Now that the rule
          // is Groovy's `${…}`/`$name`, leaving it in would make `'''${x}'''`
          // interpolate — which is wrong Groovy — so it is removed rather than
          // left to be suppressed by the fragment token's appetite.
        )),
        '\'\'\'',
      ),
      seq(
        '"""',
        repeat(choice(
          alias($._multiline_string_fragment_double, $.multiline_string_fragment),
          $._escape_sequence,
          $.string_interpolation,
          $.interpolated_identifier,
          // G7: a `$` that starts no interpolation (`"""100$"""`) is literal.
          token.immediate('$'),
        )),
        '"""',
      ),
    ),

    // G7: `$` is no longer fragment text, so the fragment stops AT an
    // interpolation instead of swallowing it.
    _multiline_string_fragment_double: _ => choice(
      /[^"\\$]+/,
      /"([^"\\$]|\\")*/,
    ),

    // ── G7: Groovy string interpolation ──────────────────────────────────
    // Inherited from Java, neither of these was overridden, and together they
    // made interpolation invisible: `string_fragment` is
    // `token.immediate(prec(1, /[^"\\]+/))` — everything except `"` and `\`,
    // which INCLUDES `$` and `{` — so `${…}` and `$name` lexed as ONE OPAQUE
    // FRAGMENT, and `string_interpolation` was Java's text-block `'\{'` form,
    // which Groovy source never contains. No interpolated expression could
    // reach the analyzer, so `${obj.method()}` produced no `calls` edge,
    // `${obj.prop}` no `uses` edge, and the nested-quote subset
    // (`"${getenv("X")}"`) did not even parse. Measured on grails-core:
    // 2,115 of 7,701 groovy-surface files (27.5%) contain interpolation,
    // 13,830 sites, every one contributing 0 reads.
    string_fragment: _ => token.immediate(prec(1, /[^"\\$]+/)),

    // The `$name` short form is a TOKEN, not `seq('$', $.identifier)`, and that
    // is measured rather than stylistic. As a sequence, the parser had to choose
    // a token at `name` while standing inside a string, where BOTH `identifier`
    // and `string_fragment` are valid — and `string_fragment` carries `prec(1)`
    // inherited from Java, so the fragment won the lexical tie and
    // `"value $field"` parsed as TWO FRAGMENTS with no interpolation node at
    // all. Verified against the CLI rather than inferred: the fragments sit at
    // [0,9]-[0,15] and [0,16]-[0,21], with the `$` eaten by the literal-dollar
    // token. `prec.dynamic` on the rule did not change it, because the tie is
    // LEXICAL — a single token can only be matched or not, so the tie is gone.
    //
    // Aliased to `interpolated_identifier` because that is the node name the
    // kotlin analyzer already reads for its own `$name` form; the family
    // convention is reused rather than reinvented.
    interpolated_identifier: _ => token.immediate(/\$[A-Za-z_][A-Za-z0-9_]*/),

    // The `${ expr }` form is a real expression, so `${obj.method()}` and
    // `${obj.prop}` reach the call and field walks exactly as the same
    // expression would outside a string — the family contract that the same
    // expression emits the same edges.
    // #841 round 18: the interpolation body admits more than a bare
    // expression — oracle-verified (Groovy 3.0.24): command chains
    // ("x ${C.foo p} y"), local declarations ("${def q = p}" and the GORM
    // SELECT template family "${Product p}" / "${Attribute attr = p.attr}" —
    // DataServiceSpec:456, 7+ @Query/@Cypher corpus files) and assignments
    // ("${q = p}") all ACCEPT inside ${…}. The admitted set is deliberately
    // NOT $.statement: a full statement body creates a systematic
    // expression/expression_statement ambiguity that measurably broke four
    // otherwise-clean files (ternary branches carrying GStrings, binary
    // chains, spread postfix, template_expression names). Declarations get
    // +1 (the semantic reading of "${Product p}"), the command chain is
    // last-resort so parenthesized calls keep their method_invocation
    // reading from r17.
    string_interpolation: $ => seq(
      '${',
      // Body = expression + command chain, NO declarations. Measured, not
      // assumed: the corpus family splits into plain method invocations
      // ("${e.formatId(X)}", "${Integer.valueOf(p.toString())}" — expression
      // readings) and command chains ("${Product p}", "${C.foo p}" — juxt
      // readings, oracle-verified). Adding local_variable_declaration as a
      // third alternative put a type-vs-expression fork in every
      // interpolation state and collapsed ${Capitalized.call(x.toString())}
      // shapes (Neo4jGormStaticApi:308) — removed. If a future corpus file
      // proves a real "${Type t = …}" declaration reading, re-add it and
      // re-run this round's battery.
      // Body = ONE item: an expression or the r17 command-value shape. The
      // repeat1(choice(...)) first tried here FRAGMENTED bodies into
      // consecutive expression items — "${registry.lookup(\"G7\")}" parsed as
      // field_access + a separate parenthesized_expression, erasing the
      // method_invocation (no `calls` edge, leaked `uses` —
      // interpolation-reads-g7 caught it). A single item cannot fragment.
      // Measured rejections recorded below: full juxt_function_call (its
      // _juxt_argument_list admits parenthesized lists, flipping ordinary
      // calls to juxt) and local_variable_declaration (a type-vs-expression
      // fork in every interpolation state; collapsed
      // ${Capitalized.call(x.toString())} — Neo4jGormStaticApi:308).
      choice(
        prec.dynamic(1, $.expression),
        prec.dynamic(-1, $._command_call_value),
      ),
      '}',
    ),

    // A `$` that begins neither form — `"cost: $5"`, `"100$"`, `"a$$b"` — is
    // literal text and needs its OWN alternative here. It cannot be folded into
    // the fragment pattern with a lookahead: tree-sitter's regex engine has no
    // lookahead, so `/[^"\\$]+|\$(?![{a-zA-Z_])/` is not expressible.
    _string_literal: $ => seq(
      '"',
      repeat(choice(
        $.string_fragment,
        $.escape_sequence,
        $.string_interpolation,
        $.interpolated_identifier,
        token.immediate('$'),
      )),
      '"',
    ),

    _multiline_string_fragment_single: _ => choice(
      /[^'\\]+/,
      /'([^'\\]|\\')*/,
    ),

    _literal: ($, original) => choice(
      original,
      $.array_literal,
      $.map_literal,
      // #841: slashy string — `def r = /a.b+c/`. The dominant regex-literal
      // form in real Groovy (~42 first-error lines in the grails-core census
      // pre-W18; still live in the recorded sample post-W18). Deliberately a
      // TOKEN, not a rule: the lexer's longest-match already prefers it over
      // division whenever the closing '/' is on the same line, so `a / b` and
      // `// comment` (which can never contain a same-line closing '/') keep
      // their parses without grammar-level ambiguity or new conflicts.
      // Newlines are excluded so a stray `/…` cannot swallow the file.
      $.slashy_string,
    ),

    // G7 (slashy half): Groovy's slashy string INTERPOLATES, like the
    // double-quoted family (`/${className}.groovy/` renames a file per class;
    // `/$ext/` builds a path pattern). The token that used to swallow `/…/`
    // whole could not model that, so this is now a RULE carrying the same three
    // interpolation alternatives as `_string_literal`. Measured before the
    // change, over 2,000 grails-core files: 154 `slashy_string` tokens, 3 of
    // them carrying an interpolation-shaped `$` in 2 files, every one of which
    // emitted no read (the other 26 `$`-bearing tokens are regex ANCHORS —
    // `/^…$/` — which Groovy never interpolates, so they must stay literal and
    // are why the fragment only stops at an interpolation-SHAPED `$`).
    //
    // The fragment keeps backslash escapes (`\/`, `\x`) because Groovy's slashy
    // escape is `\/` — Java's `escape_sequence` has no `/`, so the fragment has
    // to own them or `a\/b` would stop parsing. It is an ANONYMOUS immediate
    // token on purpose: a named fragment node would be a new node type with no
    // contract to keep, and the completeness inventory rightly refuses those.
    // Dynamic precedence (5) is unchanged — the `/` decision is the same one the
    // declared `[$.slashy_string, $.binary_expression]` conflict already rules
    // on, and the slashy reading still has to survive GLR against division.
    slashy_string: $ => prec.dynamic(5, seq(
      '/',
      repeat(choice(
        token.immediate(prec(1, /([^\/\\\n\r$]|\\[\s\S])+/)),
        $.string_interpolation,
        $.interpolated_identifier,
        token.immediate('$'),
      )),
      '/',
    )),

    // #841 round 8: Groovy's INTEGER suffixes. Java's `decimal_integer_literal`
    // stops at `l`/`L`, so every other suffix Groovy allows fell into ERROR
    // (`5_000_000G` — the DetachedCriteriaJoinSpec literal; census MISSING
    // `decimal_integer_literal` x15).
    //
    // The suffix set is MEASURED, not guessed: each suffix was compiled by real
    // Groovy 3.0.24 via script/m14/tmp/groovy-parse-oracle.groovy, and all ten
    // are accepted on an integer — l L g G i I d D f F — while on a DECIMAL
    // only g G d D f F are (l L i I are rejected). Because `G` on a dotless
    // number is legal as an integer, adding it to the no-dot arm of
    // `decimal_floating_point_literal` below would make the two rules overlap
    // on the same text, so that rule is left alone: the measured corpus need is
    // the integer form.
    decimal_integer_literal: _ => token(seq(
      DIGITS,
      optional(/[lLgGiIdDfF]/),
    )),

    // #841 round 8b: the dot-bearing arms also take Groovy's `g`/`G`
    // (BigDecimal) suffix — `1.25G`. Measured, not assumed: real Groovy 3.0.24
    // accepts `1.25g`/`1.25G` on a decimal. `g`/`G` canNOT go on the DOTLESS
    // arms (3 and 4) because `5G` is a legal INTEGER there, so the two rules
    // would overlap on identical text; the corpus need is the dot form.
    // The rejected decimal suffixes are also measured: `1.25l` and `1.25i` are
    // refused by the language itself, so they stay refused here.
    decimal_floating_point_literal: _ => token(choice(
      seq(DECIMAL_DIGITS, '.', DECIMAL_DIGITS, optional(seq((/[eE]/), optional(choice('-', '+')), DECIMAL_DIGITS)), optional(/[fFdDgG]/)),
      seq('.', DECIMAL_DIGITS, optional(seq((/[eE]/), optional(choice('-', '+')), DECIMAL_DIGITS)), optional(/[fFdDgG]/)),
      seq(DIGITS, /[eEpP]/, optional(choice('-', '+')), DECIMAL_DIGITS, optional(/[fFdD]/)),
      seq(DIGITS, optional(seq((/[eE]/), optional(choice('-', '+')), DECIMAL_DIGITS)), (/[fFdD]/)),
    )),
  },
});

/**
 * Creates a rule to match one or more of the rules separated by `separator`
 *
 * @param {RuleOrLiteral} rule
 *
 * @param {RuleOrLiteral} separator
 *
 * @returns {SeqRule}
 */
function sep1(rule, separator) {
  return seq(rule, repeat(seq(separator, rule)));
}

/**
 * Creates a rule to match one or more of the rules separated by a comma
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {SeqRule}
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

/**
 * Creates a rule to optionally match one or more of the rules separated by a comma
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {ChoiceRule}
 */
function commaSep(rule) {
  return optional(commaSep1(rule));
}
