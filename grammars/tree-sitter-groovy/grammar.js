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
  ]),

  extras: $ => [
    /\s/,
    $.line_comment,
    $.block_comment,
  ],

  rules: {
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

    expression_statement: $ => seq($.expression, DELIMITER),

    expression: ($, original) => choice(
      original,
      $.closure,
      $.range_expression,
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

    local_variable_declaration: $ => seq(
      optional($.modifiers),
      optional(choice(field('type', $._unannotated_type), 'def')),
      $._variable_declarator_list,
      DELIMITER,
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
      optional(field('type', $._unannotated_type)),
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
      field('consequence', choice($.statement, $.expression)),
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
      $._method_header,
      // Groovy one-liner method bodies are bare expressions (def add(a,b) { a + b })
      // — Java's block only accepts statements, so accept the closure form too.
      choice(field('body', $.block), field('body', $.closure), ';', '\n', '\0'),
    ),

    constructor_body: ($, original) => choice(
      original,
      $.closure,
    ),

    // Command chains (println "hi") are statements, not expressions.
    statement: ($, original) => choice(
      original,
      $.juxt_function_call,
    ),

    // Groovy asserts are newline-terminated.
    assert_statement: ($, original) => seq(
      'assert',
      $.expression,
      optional(seq(':', $.expression)),
      DELIMITER,
    ),

    // Spock specs declare test methods with string names:
    //   def "addition is commutative"() { ... }
    _method_declarator: ($, original) => seq(
      field('name', choice($.identifier, $._reserved_identifier, $.string_literal)),
      field('parameters', $.formal_parameters),
      field('dimensions', optional($.dimensions)),
    ),

    // Groovy member access adds safe navigation (?.) and spread-dereference (*.)
    // to Java's plain dot.
    field_access: $ => seq(
      field('object', choice($.primary_expression, $.super)),
      optional(seq(
        choice('.', '?.', '*.'),
        $.super,
      )),
      choice('.', '?.', '*.'),
      field('field', choice($.identifier, $._reserved_identifier, $.this)),
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
        field('name', choice($.identifier, $._reserved_identifier)),
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
          field('name', choice($.identifier, $._reserved_identifier)),
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
      commaSep(choice($.expression, $.map_item, $.spread_argument)),
      optional(','),
      ')',
    ),

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
    _juxt_argument_list: $ => commaSep1(choice(
      $._literal,
      $.map_item,
      $.identifier,
      // #742: `assertNull null.encodeAsBase64().x` — a dotted chain starting
      // on a literal is a legal command-chain argument.
      $.field_access,
      $.method_invocation,
      // #742: a trailing closure is the canonical Groovy command-argument
      // (`findAll { }`, `"/url" { mappings }`).
      $.closure,
      $.spread_argument,
    )),

    // #742: Groovy spread call argument — `foo(*list)`.
    spread_argument: $ => prec(2, seq('*', $.expression)),

    // Groovy enum bodies may list members without a trailing semicolon after
    // the constants (Java requires the ';'). Kept as a non-empty choice so the
    // rule never matches the empty string (tree-sitter constraint): either the
    // Java form (`;` then members) or newline-separated members with no `;`.
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
    field_declaration: $ => seq(
      optional($.modifiers),
      optional(field('type', $._unannotated_type)),
      $._variable_declarator_list,
      DELIMITER,
    ),

    constant_declaration: $ => seq(
      optional($.modifiers),
      field('type', $._unannotated_type),
      $._variable_declarator_list,
      DELIMITER,
    ),

    map_item: $ => seq(
      field('key', choice(
        $.identifier,
        $._literal,
        seq('(', $.expression, ')'),
      )),
      ':',
      field('value', $.expression),
    ),

    closure: $ => prec(1, seq(
      '{',
      // Groovy closures take an implicit parameter list: `{ it }` (default),
      // `{ a, b -> ... }` (named, arrow form), `{ -> ... }` (zero-arg), or
      // typed (`{ MethodNode mn -> ... }`). Without it, `each { key, value ->
      // ... }` — ubiquitous in real code — forces ERROR recovery.
      optional(seq(
        repeat(seq(optional($._unannotated_type), $.identifier, ',')),
        optional($._unannotated_type),
        $.identifier,
        '->',
      )),
      repeat(choice($.statement, $.juxt_function_call)),
      // Single-line bodies may end in a bare expression (`{ x + 1 }`) or a
      // return with no trailing delimiter (`{ return id }`).
      optional(choice(
        $.lambda_expression,
        $.expression,
        seq('return', optional($.expression)),
      )),
      '}',
    )),

    range_expression: $ => prec.right(PREC.RANGE, seq(
      field('start', $.expression),
      '..',
      field('end', $.expression),
    )),

    array_literal: $ => prec(1, seq(
      '[',
      commaSep($.expression),
      optional(','),
      ']',
    )),

    // Groovy's empty-map literal is `[:]` — a lone colon inside brackets.
    map_literal: $ => choice(
      seq('[', ':', ']'),
      seq(
        '[',
        commaSep($.map_item),
        optional(','),
        ']',
      ),
    ),

    _multiline_string_literal: $ => choice(
      seq(
        '\'\'\'',
        repeat(choice(
          alias($._multiline_string_fragment_single, $.multiline_string_fragment),
          $._escape_sequence,
          $.string_interpolation,
        )),
        '\'\'\'',
      ),
      seq(
        '"""',
        repeat(choice(
          alias($._multiline_string_fragment_double, $.multiline_string_fragment),
          $._escape_sequence,
          $.string_interpolation,
        )),
        '"""',
      ),
    ),

    _multiline_string_fragment_double: _ => choice(
      /[^"\\]+/,
      /"([^"\\]|\\")*/,
    ),

    _multiline_string_fragment_single: _ => choice(
      /[^'\\]+/,
      /'([^'\\]|\\')*/,
    ),

    _literal: ($, original) => choice(
      original,
      $.array_literal,
      $.map_literal,
    ),

    decimal_floating_point_literal: _ => token(choice(
      seq(DECIMAL_DIGITS, '.', DECIMAL_DIGITS, optional(seq((/[eE]/), optional(choice('-', '+')), DECIMAL_DIGITS)), optional(/[fFdD]/)),
      seq('.', DECIMAL_DIGITS, optional(seq((/[eE]/), optional(choice('-', '+')), DECIMAL_DIGITS)), optional(/[fFdD]/)),
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
