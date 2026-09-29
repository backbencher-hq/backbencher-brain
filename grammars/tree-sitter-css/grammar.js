/**
 * @file CSS grammar for tree-sitter
 * @author Max Brunsfeld <maxbrunsfeld@gmail.com>
 * @author Amaan Qureshi <contact@amaanq.com>
 * @license MIT
 *
 * ── LOCAL PATCHES (backbencher-brain) ────────────────────────────────────────
 * Vendored from tree-sitter-css@0.25.0, byte-for-byte except the four hunks
 * marked `LOCAL PATCH` below. Each was reproduced from real CSS BEFORE patching,
 * each has a one-line minimal reproduction, and each was measured to be strictly
 * additive by the same A/B (validation/m14/results/css-grammar-ab-*.json,
 * instrument script/m14/tmp/css-grammar-ab.ts):
 *
 *   1/3  relative url()      19 files fixed, 0 regressed, 0 node types changed
 *   2/3  float keyframe step  3 files fixed, 0 regressed, 0 node types changed
 *   3/3  IE filter args      37 files fixed, 0 regressed, 0 collateral,
 *                            node types 151 -> 152 (the one addition is this
 *                            rule's own generated `parenthesized_value_repeat1`),
 *                            0 field changes; grails-core 20.94% -> 1.57%
 *   4/4  at-rule idents      0 files fixed, 0 regressed, 0 collateral,
 *                            0 shape deltas, 0 field changes. NO corpus file
 *                            uses these at-rules, which is WHY they were broken
 *                            and unmeasured: `@custom-media --narrow (max-width:
 *                            400px)` and `@font-feature-values Body Text {…}`
 *                            ERRORED outright (4 and 6 errors) because a prelude
 *                            had to be a comma-separated query list. Also drops
 *                            real SCSS errors: `@mixin`/`@include` preludes.
 *
 * Patch 4/4 is the one with a net corpus win of ZERO, and that is stated here
 * rather than left for a reader to discover: its justification is the minimal
 * reproduction, and the A/B's job was to prove it does no harm. A patch measured
 * only by a corpus win would never have been made, because there was none to make.
 *
 * Corpus-wide: 533 files in 13 repositories, 61 error files -> 24.
 * See `reviews/m49-css-review.md`.
 *
 * The committed `wasm/tree-sitter-css.wasm` is built from THIS file, so the wasm
 * is no longer upstream's prebuilt. Rebuild with:
 *   cd grammars/tree-sitter-css && tree-sitter generate && tree-sitter build --wasm
 * A rebuild's sha256 is NOT a function of the source (measured: the UNMODIFIED
 * upstream source rebuilds to a different sha than upstream's own prebuilt, with
 * identical behaviour on 533 corpus files), so compare BEHAVIOUR, never hashes.
 * See script/m14/tmp/css-grammar-ab.ts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

export default grammar({
  name: 'css',

  extras: $ => [
    /\s/,
    $.comment,
    $.js_comment,
  ],

  externals: $ => [
    $._descendant_operator,
    $._pseudo_class_selector_colon,
    $.__error_recovery,
  ],

  inline: $ => [
    $._top_level_item,
    $._block_item,
  ],

  rules: {
    stylesheet: $ => repeat($._top_level_item),

    _top_level_item: $ => choice(
      $.declaration,
      $.rule_set,
      $.import_statement,
      $.media_statement,
      $.charset_statement,
      $.namespace_statement,
      $.keyframes_statement,
      $.supports_statement,
      $.scope_statement,
      $.at_rule,
    ),

    // Statements

    import_statement: $ => seq(
      '@import',
      $._value,
      sep(',', $._query),
      ';',
    ),

    media_statement: $ => seq(
      '@media',
      sep1(',', $._query),
      $.block,
    ),

    charset_statement: $ => seq(
      '@charset',
      $._value,
      ';',
    ),

    namespace_statement: $ => seq(
      '@namespace',
      optional(alias($.identifier, $.namespace_name)),
      choice($.string_value, $.call_expression),
      ';',
    ),

    keyframes_statement: $ => seq(
      choice(
        '@keyframes',
        alias(/@[-a-z]+keyframes/, $.at_keyword),
      ),
      alias($.identifier, $.keyframes_name),
      $.keyframe_block_list,
    ),

    keyframe_block_list: $ => seq(
      '{',
      repeat($.keyframe_block),
      '}',
    ),

    keyframe_block: $ => seq(
      // LOCAL PATCH 1/2 — a keyframe step may be a percentage, and `33.3%` is a
      // `float_value`, not an `integer_value`. `float_value` already exists in
      // this grammar and already carries the `%` unit, so this only widens the
      // CHOICE; no node type is added or removed (measured: 151 -> 151).
      // Corpus: svelte `keyframes/33.3%` plus 2 more files across 3 repos.
      // Repro:  @keyframes f { 33.3% { color: yellow } }
      sep1(',', choice($.from, $.to, $.integer_value, $.float_value)),
      $.block,
    ),

    from: _ => 'from',
    to: _ => 'to',

    supports_statement: $ => seq(
      '@supports',
      $._query,
      $.block,
    ),

    scope_statement: $ => seq(
      '@scope',
      optional(
        seq(
          '(', $._selector, ')',
          optional(seq('to', '(', $._selector, ')')),
        ),
      ),
      $.block,
    ),

    postcss_statement: $ => prec(-1, seq(
      $.at_keyword,
      repeat(choice($._value, $.important_value)),
      ';',
    )),

    at_rule: $ => seq(
      $.at_keyword,
      // LOCAL PATCH 4/4 — an at-rule prelude may be a run of identifiers, not only a
      // comma-separated list of queries.
      //
      // `@custom-media --narrow (max-width: 400px);` and
      // `@font-feature-values Body Text { … }` both ERROR on the pinned grammar,
      // because their preludes are idents and `sep(',', $._query)` will only accept
      // idents that are separated by COMMAS. The grammar contains no mention of
      // either at-rule at all (measured: 0 occurrences of `custom-media`), so this
      // is a genuine gap rather than a mis-shaped special case.
      //
      // The identifiers are ALIASED to `keyword_query` — the same alias `_query`
      // already applies — so this introduces no new node type, which is what keeps
      // the patch free of a completeness-spec change.
      optional($._prelude_ident_run),
      sep(',', $._query),
      choice(';', $.block),
    ),

    //
    // `prec(1)` resolves the leading-identifier ambiguity toward this run. That is
    // safe BECAUSE both readings alias to the same node: `_query` aliases
    // `identifier` to `keyword_query` and so does this, so preferring this branch
    // changes which PARSE wins and not the node type any consumer sees. The extra
    // capability is that a comma-separated query list may now FOLLOW the run, which
    // is exactly the `@custom-media --narrow (max-width: 400px)` shape the pinned
    // grammar could not read.
    _prelude_ident_run: $ => repeat1(prec(1, alias($.identifier, $.keyword_query))),

    // Rule sets

    rule_set: $ => seq(
      $.selectors,
      $.block,
    ),

    selectors: $ => sep1(',', $._selector),

    block: $ => seq(
      '{',
      repeat($._block_item),
      optional(alias($.last_declaration, $.declaration)),
      '}',
    ),

    _block_item: $ => choice(
      $.declaration,
      $.rule_set,
      $.import_statement,
      $.media_statement,
      $.charset_statement,
      $.namespace_statement,
      $.keyframes_statement,
      $.supports_statement,
      $.scope_statement,
      $.postcss_statement,
      $.at_rule,
    ),

    // Selectors

    _selector: $ => choice(
      $.universal_selector,
      alias($.identifier, $.tag_name),
      $.class_selector,
      $.nesting_selector,
      $.pseudo_class_selector,
      $.pseudo_element_selector,
      $.id_selector,
      $.attribute_selector,
      $.string_value,
      $.child_selector,
      $.descendant_selector,
      $.sibling_selector,
      $.adjacent_sibling_selector,
      $.namespace_selector,
    ),

    nesting_selector: _ => '&',

    universal_selector: _ => '*',

    class_selector: $ => prec(1, seq(
      optional($._selector),
      '.',
      $.class_name,
    )),

    pseudo_class_selector: $ => seq(
      optional($._selector),
      alias($._pseudo_class_selector_colon, ':'),
      choice(
        // Either a specific pseudo-class that can only accept a selector…
        seq(
          alias(
            choice('has', 'not', 'is', 'where', 'host', 'host-context'),
            $.class_name,
          ),
          alias($.pseudo_class_with_selector_arguments, $.arguments),
        ),

        // …or an `nth-child` or `nth-last-child` selector (which can
        // optionally accept a selector)…
        $._nth_child_pseudo_class_selector,

        // …or any other pseudo-class (for which we'll allow a more diverse set
        // of arguments).
        seq(
          $.class_name,
          optional(alias($.pseudo_class_arguments, $.arguments)),
        ),

        // …or a standalone `host` pseudo-class (as `:host` doesn't require arguments).
        alias('host', $.class_name),
      ),
    ),

    // Only `nth-child`/`nth-last-child`, not `nth-of-type`/`nth-last-of-type`,
    // allows an optional filtering selector as a parameter.
    _nth_child_pseudo_class_selector: $ => seq(
      alias(
        choice('nth-child', 'nth-last-child'),
        $.class_name,
      ),
      alias($.pseudo_class_nth_child_arguments, $.arguments),
    ),

    pseudo_element_selector: $ => seq(
      optional($._selector),
      '::',
      alias($.identifier, $.tag_name),
      optional(alias($.pseudo_element_arguments, $.arguments)),
    ),

    id_selector: $ => seq(
      optional($._selector),
      '#',
      alias($.identifier, $.id_name),
    ),

    attribute_selector: $ => seq(
      optional($._selector),
      token(prec(1, '[')),
      alias(choice($.identifier, $.namespace_selector), $.attribute_name),
      optional(seq(
        choice('=', '~=', '^=', '|=', '*=', '$='),
        $._value,
      )),
      ']',
    ),

    child_selector: $ => prec.left(seq(optional($._selector), '>', $._selector)),

    descendant_selector: $ => prec.left(seq($._selector, $._descendant_operator, $._selector)),

    sibling_selector: $ => prec.left(seq(optional($._selector), '~', $._selector)),

    adjacent_sibling_selector: $ => prec.left(seq(optional($._selector), '+', $._selector)),

    namespace_selector: $ => prec.left(seq(optional($._selector), '|', $._selector)),

    pseudo_class_arguments: $ => seq(
      token.immediate('('),
      sep(',', choice($._selector, repeat1($._value))),
      ')',
    ),

    pseudo_class_with_selector_arguments: $ => seq(
      token.immediate('('),
      sep(',', $._selector),
      ')',
    ),

    pseudo_class_nth_child_arguments: $ => prec(-1, seq(
      token.immediate('('),
      choice(
        alias('even', $.plain_value),
        alias('odd', $.plain_value),
        $.integer_value,
        alias($._nth_functional_notation, $.plain_value),
      ),
      optional(
        seq(
          'of',
          $._selector,
        ),
      ),
      ')',
    )),

    // An+B notation for `nth-child`/`nth-last-child`.
    _nth_functional_notation: _ => /-?(\d)*n\s*(\+\s*\d+)?/,

    pseudo_element_arguments: $ => seq(
      token.immediate('('),
      sep(',', choice($._selector, repeat1($._value))),
      ')',
    ),

    // Declarations

    declaration: $ => seq(
      alias($.identifier, $.property_name),
      ':',
      $._value,
      repeat(seq(
        optional(','),
        $._value,
      )),
      optional($.important),
      ';',
    ),

    last_declaration: $ => prec(1, seq(
      alias($.identifier, $.property_name),
      ':',
      $._value,
      repeat(seq(
        optional(','),
        $._value,
      )),
      optional($.important),
    )),

    important: _ => '!important',

    // Media queries

    _query: $ => choice(
      alias($.identifier, $.keyword_query),
      $.feature_query,
      $.binary_query,
      $.unary_query,
      $.selector_query,
      $.parenthesized_query,
    ),

    feature_query: $ => seq(
      '(',
      alias($.identifier, $.feature_name),
      ':',
      repeat1($._value),
      ')',
    ),

    parenthesized_query: $ => seq(
      '(',
      $._query,
      ')',
    ),

    binary_query: $ => prec.left(seq(
      $._query,
      choice('and', 'or'),
      $._query,
    )),

    unary_query: $ => prec(1, seq(
      choice('not', 'only'),
      $._query,
    )),

    selector_query: $ => seq(
      'selector',
      '(',
      $._selector,
      ')',
    ),

    // Property Values

    _value: $ => prec(-1, choice(
      alias($.identifier, $.plain_value),
      $.plain_value,
      $.color_value,
      $.integer_value,
      $.float_value,
      $.string_value,
      $.grid_value,
      $.binary_expression,
      $.parenthesized_value,
      $.call_expression,
      $.important,
    )),

    parenthesized_value: $ => seq(
      '(',
      // LOCAL PATCH 3/3 — an IE filter argument list is `name = value` PAIRS:
      //   filter: progid:DXImageTransform.Microsoft.gradient(startColorStr = '#fff')
      // and this rule allowed exactly ONE value, so `startColorStr = '#fff'` could
      // not be a `parenthesized_value` and the whole list became an ERROR.
      //
      // This is the LARGEST class the lane had left: 37 of the 62 corpus .css files
      // that still failed, 60% of the residual mass, and the largest single
      // parse-failure class in the corpus. Measured A/B over 533 files in 13
      // repositories: 61 error files -> 24, **37 fixed, 0 regressed, 0 collateral**
      // (every file that parsed clean before still parses clean), node types
      // 151 -> 152 with the one addition being this rule's own generated
      // `parenthesized_value_repeat1` wrapper, 0 field changes.
      // grails-core 20.94% -> 1.57%.
      //
      // WHY THE FIRST ATTEMPT FAILED, since the obvious patch is wrong: adding `=`
      // to the separator choice of `arguments` was built and A/B'd and was provably
      // INERT (61 -> 61, 0 fixed). The value does not parse as a `call_expression`
      // at all — it parses as a `parenthesized_value` — so `arguments` is never
      // reached and the token's character set was never the problem. The cause was
      // the rule's ARITY.
      //
      // A strict SUPERSET of the old rule: a single value still parses, and the
      // grouping form `calc((1px + 2px) * 3)` still parses because `1px + 2px` is
      // one `binary_expression` and therefore one `$._value`. Shape mirrors the
      // `arguments` rule, which already had this shape.
      sep(choice(',', ';', '='), repeat1($._value)),
      ')',
    ),

    color_value: _ => seq('#', token.immediate(/[0-9a-fA-F]{3,8}/)),

    string_value: $ => choice(
      seq(
        '\'',
        repeat(choice(
          alias(/[^\\'\n]+/, $.string_content),
          $.escape_sequence,
        )),
        '\'',
      ),
      seq(
        '"',
        repeat(choice(
          alias(/[^\\"\n]+/, $.string_content),
          $.escape_sequence,
        )),
        '"',
      ),
    ),

    escape_sequence: _ => token(seq(
      '\\',
      choice(
        /[0-9a-fA-F]{1,6}\s?/,
        /[^0-9a-fA-F\n\r]/,
      ),
    )),

    integer_value: $ => seq(
      token(seq(
        optional(choice('+', '-')),
        /\d+/,
      )),
      optional($.unit),
    ),

    float_value: $ => seq(
      token(seq(
        optional(choice('+', '-')),
        /\d*/,
        choice(
          seq('.', /\d+/),
          seq(/[eE]/, optional('-'), /\d+/),
          seq('.', /\d+/, /[eE]/, optional('-'), /\d+/),
        ),
      )),
      optional($.unit),
    ),

    unit: _ => token.immediate(/[a-zA-Z%]+/),

    grid_value: $ => seq(
      '[',
      sep1(',', $._value),
      ']',
    ),

    call_expression: $ => seq(
      alias($.identifier, $.function_name),
      $.arguments,
    ),

    binary_expression: $ => prec.left(seq(
      $._value,
      choice('+', '-', '*', '/'),
      $._value,
    )),

    arguments: $ => seq(
      token.immediate('('),
      sep(choice(',', ';'), repeat1($._value)),
      ')',
    ),

    class_name: $ => seq(
      choice($.identifier, $.escape_sequence),
      repeat(choice(
        alias(/[a-zA-Z0-9-_\xA0-\xFF]+/, $.identifier),
        $.escape_sequence,
      )),
    ),

    identifier: _ => /(--|-?[a-zA-Z_\xA0-\xFF])[a-zA-Z0-9-_\xA0-\xFF]*/,

    at_keyword: _ => /@[a-zA-Z-_]+/,

    js_comment: _ => token(prec(-1, seq('//', /.*/))),

    comment: _ => token(seq(
      '/*',
      /[^*]*\*+([^/*][^*]*\*+)*/,
      '/',
    )),

    plain_value: _ => token(seq(
      repeat(choice(
        /[-_]/,
        // LOCAL PATCH 2/2 — a value token must LEAD with a letter, so an unquoted
        // RELATIVE url() (`url(../img/x.svg)`) could not lex at all: the token
        // ended at the first `.` and the `..` became two ERROR nodes. `.` is
        // already legal in this token's BODY, so only the LEADING repeat lacked
        // it. The required /[a-zA-Z]/ is deliberately RETAINED, so a value made
        // only of punctuation still cannot match and the token cannot swallow
        // structure. Measured: the largest single class in the corpus after
        // `progid:` — 16 of 191 grails-core files, 2 of 53 scala3, 1 of 185
        // svelte. Repro: .a { background-image: url(../img/x.svg); }
        /\./,
        /\/[^\*\s,;!{}()\[\]]/, // Slash not followed by a '*' (which would be a comment)
      )),
      /[a-zA-Z]/,
      repeat(choice(
        /[^/\s,;!{}()\[\]]/, // Not a slash, not a delimiter character
        /\/[^\*\s,;!{}()\[\]]/, // Slash not followed by a '*' (which would be a comment)
      )),
    )),

    important_value: _ => token(seq(
      '!',
      /[a-zA-Z]/,
      repeat(/[a-zA-Z0-9-_]/),
    )),
  },
});

/**
 * Creates a rule to optionally match one or more of the rules separated by `separator`
 *
 * @param {RuleOrLiteral} separator
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {ChoiceRule}
 */
function sep(separator, rule) {
  return optional(sep1(separator, rule));
}

/**
 * Creates a rule to match one or more of the rules separated by `separator`
 *
 * @param {RuleOrLiteral} separator
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {SeqRule}
 */
function sep1(separator, rule) {
  return seq(rule, repeat(seq(separator, rule)));
}
