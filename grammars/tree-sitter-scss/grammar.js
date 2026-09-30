/**
 * @file SCSS grammar for tree-sitter
 * @author Amaan Qureshi <amaanq12@gmail.com>
 * @license MIT
 *
 * ── LOCAL PATCHES (backbencher-brain) ────────────────────────────────────────
 * Vendored from tree-sitter-scss@1.0.0, byte-for-byte except the hunks marked
 * `LOCAL PATCH` below. Each has a one-line minimal reproduction, is measured to be
 * strictly additive by an A/B over 244 .scss files in 4 corpora
 * (validation/m14/results/scss-grammar-ab.json, instrument
 * script/m14/tmp/scss-grammar-ab.ts), and is pinned in script/m14/verify-grammar-pins.ts.
 *
 *   1/2  Sass module system  `@use`/`@forward` took a value and a semicolon and
 *                            nothing else, so `as <namespace>`, `as *`,
 *                            `with (<config>)` and `show <members>` were all ERROR.
 *                            `@use 'sass:map';` parsed; `@use 'sass:map' as map;` —
 *                            the form Sass documents — did not. This was the single
 *                            largest residual class: the bare token `as` at 277 error
 *                            spans across the corpus.
 *   2/2  `!default`/`!global` the declaration rule allowed `!important` and nothing
 *                            else, so `$brand: #f00 !default;` was an ERROR — the
 *                            most common line in a Sass variable file. 210 occurrences
 *                            in the corpus. Also on a mixin/function parameter default,
 *                            which is where Sass puts it most often.
 *
 * Together: 73 -> 149 of 244 files parsing clean (29.9% -> 61.1%), 76 FIXED,
 * 0 REGRESSED, ERROR nodes 5,624 -> 3,900. Against the CSS grammar this lane
 * replaced, the same 244 files went 43 -> 149 (17.6% -> 61.1%) and 30,767 -> 3,900
 * ERROR nodes.
 *
 * DECLARED NOT SUPPORTED
 *
 *   `@forward 'x' as prefix-*;` — the PREFIX form of the `as` clause. It needs
 *   `repeat1(seq('-', …))` after the name, which is an unresolved conflict with
 *   `binary_expression` (a `$._value` can itself be `a - b`). It occurs ZERO times
 *   in 40,521 lines of corpus, where 359 uses are `as *` and 1 is `as common`. A
 *   grammar conflict taken on for a form with no evidence is a risk incurred on
 *   somebody else's behalf, so it is declared instead. The A/B reports it as
 *   `forward-as-dashed-prefix` with verdict `unchanged-broken`, which is the
 *   honest cell: still broken, and named.
 *
 * THE BASE IS A DEPENDENCY, NOT VENDORED SOURCE
 *
 * This grammar is `grammar(require('tree-sitter-css/grammar'), {…})` over
 * tree-sitter-css **0.20.0**, so the build is not self-contained:
 *   cd grammars/tree-sitter-scss && npm install --no-save tree-sitter-css@0.20.0
 *   tree-sitter generate && tree-sitter build --wasm -o ../../wasm/tree-sitter-scss.wasm
 * The package declares `tree-sitter-css: ^0.20.0`, a RANGE — the exact version is
 * pinned in verify-grammar-pins.ts because a range is not a pin. The locally
 * generated parser reproduces the package's own shipped src/parser.c exactly
 * (73/244 clean and 5,624 ERROR nodes on both), which is how 0.20.0 was identified
 * as the right dependency rather than assumed.
 *
 * Rebuilding on this repo's PATCHED tree-sitter-css 0.25.0 instead would have
 * inherited all four CSS patches for free, and is not possible as written: this
 * grammar is CommonJS and 0.25.0 ships an ES-module grammar.js, so `require` of it
 * fails. See the `alternatives` entry in verify-grammar-pins.ts.
 *
 * There is NO tree-sitter.json in the npm tarball; one was authored here, without
 * which `tree-sitter generate` warns and silently emits ABI 14. There is also NO
 * LICENSE file in the tarball — only package.json's `"license": "MIT"` field, which
 * is a claim rather than a licence text.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const CSS = require('tree-sitter-css/grammar');

module.exports = grammar(CSS, {
  name: 'scss',

  externals: ($, original) => original.concat([
    $._concat,
  ]),

  rules: {
    _top_level_item: ($, original) => choice(
      original,
      $.postcss_statement,
      $.use_statement,
      $.forward_statement,
      $.mixin_statement,
      $.include_statement,
      $.function_statement,
      $.return_statement,
      $.extend_statement,
      $.error_statement,
      $.warn_statement,
      $.debug_statement,
      $.at_root_statement,
      $.if_statement,
      $.each_statement,
      $.for_statement,
      $.while_statement,
    ),

    _block_item: ($, original) => choice(
      original,
      $.mixin_statement,
      $.include_statement,
      $.function_statement,
      $.return_statement,
      $.extend_statement,
      $.error_statement,
      $.warn_statement,
      $.debug_statement,
      $.at_root_statement,
      $.if_statement,
      $.each_statement,
      $.for_statement,
      $.while_statement,
    ),

    // Selectors

    _selector: ($, original) => choice(
      original,
      alias($._concatenated_identifier, $.tag_name),
      $.placeholder,
    ),

    class_selector: $ => prec(1, seq(
      optional($._selector),
      choice('.', $.nesting_selector),
      alias(choice($.identifier, $._concatenated_identifier), $.class_name),
    )),

    pseudo_class_selector: $ => seq(
      optional($._selector),
      alias($._pseudo_class_selector_colon, ':'),
      alias(choice($.identifier, $._concatenated_identifier), $.class_name),
      optional(alias($.pseudo_class_arguments, $.arguments)),
    ),

    // Declarations

    declaration: $ => seq(
      alias(
        choice($.identifier, $.variable, $._concatenated_identifier),
        $.property_name,
      ),
      ':',
      $._value,
      repeat(seq(optional(','), $._value)),
      // LOCAL PATCH 2/2 — Sass's `!default` / `!global` flag. The rule allowed
      // `!important` and nothing else, so `$a: 1 !default;` — the single most common
      // line in a Sass variable file, and the whole point of a configurable default —
      // was an ERROR. Measured after patch 1/1: `!default` at 19 error spans and a bare
      // `!` at 18, the largest coherent class left in the corpus.
      optional(choice($.important, $._sass_visibility_flag)),
      ';',
    ),

    _sass_visibility_flag: _ => seq('!', choice('default', 'global')),

    // Media queries

    _query: ($, original) => choice(
      original,
      prec(-1, $.interpolation),
    ),

    // Property Values

    _value: ($, original) => choice(
      original,
      prec(-1, choice(
        $.nesting_selector,
        $._concatenated_identifier,
        $.list_value,
      )),
      $.variable,
    ),

    // LOCAL PATCH 1/1 (backbencher-brain) — Sass's module system has three optional
    // clauses these two rules never allowed, and the corpus is full of them:
    //
    //   @use '<url>' [as <namespace> | as *]? [with (<config>)]?;
    //   @forward '<url>' [as <prefix>-*]? [show <members> | hide <members>]? [with (<config>)]?;
    //
    // As written, `@use` took a value and a semicolon and nothing else, so every
    // `as` clause was an ERROR: measured across 244 .scss files, the single largest
    // residual class was the bare token `as` at 277 error spans. `@use 'sass:map';`
    // parsed; `@use 'sass:map' as map;` — the form Sass actually documents — did not.
    //
    // Modelled in the grammar's OWN loose style (the pattern at lines 86-87,
    // `$._value, repeat(seq(optional(','), $._value))`) rather than with a strict
    // grammar for Sass's config objects, for two reasons: a strict model is a second
    // research project, and the analyzer deliberately reads these clauses by SLICING
    // `node.text` — it never names a node type for an at-rule prelude, because
    // slicing text cannot fall behind a grammar change (M60 R10). So the parse only
    // has to be faithful enough to delimit the statement.
    use_statement: $ => seq(
      '@use',
      $._value,
      // `$._value` rather than `choice($.identifier, $.variable)`: the namespace may be
      // a plain identifier OR a concatenated one, and `$._value` already covers both
      // without this rule having to enumerate them.
      optional(seq('as', choice('*', $._value))),
      optional($._with_clause),
      ';',
    ),

    forward_statement: $ => seq(
      '@forward',
      $._value,
      // `@forward './list' as list-gap;` — the namespace form.
      //
      // Sass also has a PREFIX form, `as list-gap-*;`, and it is deliberately NOT
      // supported here. Supporting it needs `repeat1(seq('-', ...))` after the name,
      // which is an UNRESOLVED conflict with `binary_expression` (a `$._value` can
      // itself be `a - b`), so it would mean a precedence fight over a form that
      // occurs ZERO times in 40,521 lines of corpus: 359 uses are `as *` and 1 is
      // `as common`. Declared rather than paid for — a grammar conflict introduced
      // for a construct with no evidence is a risk taken on somebody else's behalf.
      optional(seq('as', choice('*', choice($.identifier, $.variable, $._concatenated_identifier)))),
      // the `choice` this first used ($._value | $.identifier | $.variable) is an
      // UNRESOLVED conflict with `_value` itself, because a member list can loop and
      // `_value` can also match an identifier. The grammar's own loose pattern —
      // `repeat(seq(optional(','), $._value))` — sidesteps it by never choosing
      // between them, and `tree-sitter generate` accepts it.
      optional(seq(choice('show', 'hide'), repeat(seq(optional(','), $._value)))),
      optional($._with_clause),
      ';',
    ),

    // Sass's configuration clause is a list of `$name: value` PAIRS, not a list of
    // values. The first version allowed only `$._value`, so `with ($a: 1)` matched the
    // `$a` and then choked on the `1` — reported as `(UNEXPECTED '1')`, which reads
    // like a value problem and is actually a missing separator. The `optional` on the
    // pair prefix is what lets a bare positional value through too.
    _with_clause: $ => seq('with', '(', repeat(seq(optional(','), optional(seq($.variable, ':')), $._value)), optional(','), ')'),

    mixin_statement: $ => seq(
      '@mixin',
      field('name', $.identifier),
      optional($.parameters),
      $.block,
    ),

    include_statement: $ => seq(
      '@include',
      $.identifier,
      optional(alias($._include_arguments, $.arguments)),
      choice($.block, ';'),
    ),

    // ── LOCAL PATCH 5 (backbencher-brain) — `@include` ARGUMENT WHITESPACE ────────
    //
    // This rule demanded `token.immediate` on BOTH delimiters, and `token.immediate`
    // means zero characters of whitespace between the token and its neighbour. So an
    // `@include` whose argument list is not written with the parens hard against the
    // argument did not parse AT ALL. Measured, four forms:
    //
    //     @include f(1px);          OK      no whitespace
    //     @include f(1px NL );      FAIL    a newline before the closing paren
    //     @include f( NL 1px NL );  FAIL    the multi-line form
    //     @include f( 1px );        FAIL    a single SPACE, on one line
    //
    // (NL stands for a line break; the literal form is in the A/B instrument's
    // `include-arg-whitespace` repro rather than in a comment that a shell would eat.)
    //
    // The multi-line form is not exotic — it is the house style of a design-system
    // stylesheet, and it is the FIRST error in 15 of the 63 element-plus files that
    // still fail to parse, across `set-css-var-value` (10 files) and
    // `css-var-from-global` (5). The trailing-space case is what makes the defect
    // obvious rather than merely annoying: a stylesheet with a space inside the
    // parentheses is not unusual, and it did not parse.
    //
    // A plain call with the same layout always parsed, which localises the fault
    // precisely: it is this rule's delimiters, not Sass and not the lexer.
    //
    // Only the CLOSING delimiter is relaxed. `token.immediate('(')` stays, because Sass
    // genuinely forbids whitespace between a mixin name and its argument list, and
    // loosening it would accept `@include f (1px)`, which is a different language. The
    // block form `@include f(1px) { … }` also still parses, because the `)` is now an
    // ordinary token and the `{` after it is unambiguously the block.
    _include_arguments: $ => seq(
      token.immediate('('),
      sep1(',', alias($._include_argument, $.argument)),
      ')',
    ),

    _include_argument: $ => seq(
      optional(seq(field('name', $.variable), ':')),
      field('value', $._value),
    ),

    function_statement: $ => seq(
      '@function',
      field('name', $.identifier),
      optional($.parameters),
      $.block,
    ),

    parameters: $ => seq('(', sep1(',', $.parameter), ')'),

    parameter: $ => seq(
      $.variable,
      optional(seq(
        ':',
        field('default', $._value),
        // LOCAL PATCH 2/2, second site: the same flag on a mixin or function
        // parameter default, which is where Sass puts it most often
        // (`@mixin button($bg: $grey !default)`).
        optional($._sass_visibility_flag),
      )),
    ),

    return_statement: $ => seq('@return', $._value, ';'),

    extend_statement: $ => seq('@extend', choice($._value, $.class_selector), ';'),

    error_statement: $ => seq('@error', $._value, ';'),

    warn_statement: $ => seq('@warn', $._value, ';'),

    debug_statement: $ => seq('@debug', $._value, ';'),

    at_root_statement: $ => seq('@at-root', $._value, $.block),

    if_statement: $ => seq(
      '@if',
      field('condition', $._value),
      $.block,
      repeat($.else_if_clause),
      optional($.else_clause),
    ),

    else_if_clause: $ => seq(
      '@else',
      'if',
      field('condition', $._value),
      $.block,
    ),

    else_clause: $ => seq('@else', $.block),

    each_statement: $ => seq(
      '@each',
      optional(seq(field('key', $.variable), ',')),
      field('value', $.variable),
      'in',
      $._value,
      $.block,
    ),

    for_statement: $ => seq(
      '@for',
      $.variable,
      'from',
      field('from', $._value),
      'through',
      field('through', $._value),
      $.block,
    ),

    while_statement: $ => seq('@while', $._value, $.block),

    call_expression: $ => seq(
      alias(choice($.identifier, $.plain_value), $.function_name),
      $.arguments,
    ),

    binary_expression: $ => prec.left(seq(
      $._value,
      choice('+', '-', '*', '/', '==', '<', '>', '!=', '<=', '>='),
      $._value,
    )),

    // ── LOCAL PATCH 4 (backbencher-brain) — MAP LITERALS, as an extension of two
    // EXISTING rules rather than a new one. The reasoning for that shape is the whole
    // content of this hunk, so it is written out rather than left implicit.
    //
    // `map.merge((…), $default)` is the largest parse-failure class in the corpus, and
    // three previous attempts at it were measured and REVERTED (SCSS-L8). All three
    // added a NEW rule — `map_value` — to the value hierarchy. Measured outcomes:
    //
    //   new rule in `_value`, prec 1     5 files fixed, 0 regressed, ERROR 3,900 -> 8,056
    //   new rule overriding `arguments`  4 files fixed, 9 REGRESSED
    //   that, with `prec.dynamic`         worse
    //
    // The first is the instructive failure. "0 regressed" and a DOUBLING of the error
    // count, and the file-level A/B saw none of it, because the files that gained errors
    // were already failing and stayed in the same bucket. A new rule in `_value` competes
    // in every declaration, selector and interpolation in the language, and where it loses,
    // tree-sitter recovers with an error node.
    //
    // So this patch adds NO new rule. It extends two rules that are already in the
    // grammar and already compete safely:
    //
    //   1. `list_value` — the parenthesised VALUE group — now also accepts KEYED
    //      entries, so a two-or-more-pair map is a `list_value` whose entries carry a
    //      `:`. No new node type, no new competition: the rule already sits at
    //      `prec(-1)` beside every other Sass value addition and has never inflated
    //      the error count.
    //
    //   2. `parenthesized_value` — inherited from CSS as `'(' $._value ')'` — also
    //      accepts `'(' $._value ':' $._value ')'`. This is the single-pair case, and
    //      it is the one that looked arbitrary: `('a': 1)` lost to `parenthesized_value`
    //      while `('a': 1, 'b': 2)` parsed, because a comma resolves the conflict before
    //      precedence is consulted. Extending the winning rule is the direct answer, and
    //      it is why `prec.dynamic` was never going to work — the conflict is settled when
    //      the parser is GENERATED, so a post-parse preference is never consulted.
    //
    // Both halves only ever ACCEPT more than they did. A `:` inside parentheses was
    // previously an error in every one of these positions, so no parse that succeeded
    // before can change shape — which is the property the A/B then confirms rather than
    // assumes.
    // LOCAL PATCH 4/4b (backbencher-brain) — the SINGLE-PAIR map, which is the case
    // that is not a `list_value` at all and so needs the CSS rule itself widened.
    // `($, original)` keeps the inherited `'(' $._value ')'` and adds the keyed form,
    // so every existing use parses exactly as before.
    parenthesized_value: ($, original) => choice(
      original,
      seq('(', $._value, ':', $._value, optional(','), ')'),
    ),

    list_value: $ => seq(
      '(',
      // LOCAL PATCH 4/4a — a keyed entry is `KEY ':' VALUE`, so a MAP is a
      // `list_value` whose entries carry a colon. `sep2` is `rule (sep rule)+`, so the
      // trailing comma needs its own `optional(',')`; without it a multi-line group's
      // final comma is an error, which is why the element-plus idiom below failed even
      // where the pairs themselves parsed.
      sep2(',', choice($._value, seq($._value, ':', $._value))),
      optional(','),
      ')',
    ),

    interpolation: $ => seq('#{', $._value, '}'),

    placeholder: $ => seq('%', $.identifier),

    _concatenated_identifier: $ => choice(
      seq(
        $.identifier,
        repeat1(seq(
          $._concat,
          choice($.interpolation, $.identifier, alias(token.immediate('-'), $.identifier)),
        )),
      ),
      seq(
        $.interpolation,
        repeat(seq(
          $._concat,
          choice($.interpolation, $.identifier, alias(token.immediate('-'), $.identifier)),
        )),
      ),
    ),

    variable: _ => /([a-zA-Z_]+\.)?\$[a-zA-Z-_][a-zA-Z0-9-_]*/,
  },
});

/**
 * Creates a rule to match one or more of the rules separated by `separator`
 *
 * @param {RuleOrLiteral} separator
 *
 * @param {RuleOrLiteral} rule
 *
 * @return {SeqRule}
 *
 */
function sep1(separator, rule) {
  return seq(rule, repeat(seq(separator, rule)));
}

/**
 * Creates a rule to match two or more of the rules separated by `separator`
 *
 * @param {RuleOrLiteral} separator
 *
 * @param {RuleOrLiteral} rules
 *
 * @return {SeqRule}
 */
function sep2(separator, rules) {
  return seq(rules, repeat1(seq(separator, rules)));
}
