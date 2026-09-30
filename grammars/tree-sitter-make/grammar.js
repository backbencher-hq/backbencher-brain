/**
 * @file Make grammar for tree-sitter
 * @author Alexandre Muller
 * @author Amaan Qureshi <amaanq12@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const CHARSET = 'a-zA-Z0-9%\\+\\-\\.@_\\*\\?\\/';
const ESCAPE_SET = 'abtnvfrE!"#\\$&\'\\(\\)\\*,;<>\\?\\[\\\\\\]^`{\\|}~';

const NL = token.immediate(/[\r\n]+/);
const WS = token.immediate(/[\t ]+/);
const SPLIT = alias(token.immediate(seq('\\', /\r?\n|\r/)), '\\');

const AUTOMATIC_VARS = ['@', '%', '<', '?', '^', '+', '/', '*'];

const DEFINE_OPS = ['=', ':=', '::=', '?=', '+='];

const FUNCTIONS = [
  'subst',
  'patsubst',
  'strip',
  'findstring',
  'filter',
  'filter-out',
  'sort',
  'word',
  'words',
  'wordlist',
  'firstword',
  'lastword',
  'dir',
  'notdir',
  'suffix',
  'basename',
  'addsuffix',
  'addprefix',
  'join',
  'wildcard',
  'realpath',
  'abspath',
  'error',
  'warning',
  'info',
  'origin',
  'flavor',
  'foreach',
  'if',
  'or',
  'and',
  'intcmp',
  'let',
  'call',
  'eval',
  'file',
  'value',
  'guile',
];

export default grammar({
  name: 'make',

  word: $ => $.word,

  inline: $ => [
    $._targets,
    $._target_pattern,
    $._prerequisites_pattern,
    $._prerequisites,
    $._order_only_prerequisites,
    $._target_or_pattern_assignment,

    $._primary,
    $._name,
    $._string,
  ],

  // PATCH P2 conflict declaration. `$$(FOO)` is genuinely two things at once:
  // a `variable_reference` (one `_primary`) and a balanced `_paren_text` (the
  // `shell_command` the analyzer already knows how to read). Declaring the
  // conflict lets the parser keep BOTH readings alive and choose per input, which
  // is the honest resolution; a static precedence would silently discard one of
  // them for EVERY input rather than for the inputs where it is wrong.
  conflicts: $ => [
    [$.concatenation, $._paren_text],
    [$.variable_reference, $._paren_text],
  ],

  extras: $ => [
    /\s/,
    alias(token(seq('\\', /\r?\n|\r/)), '\\'),
    $.comment,
  ],

  // P3 (M60 Make wave): `.RECIPEPREFIX`. Upstream hardcoded the recipe prefix to a
  // tab and left `// TODO external parser for .RECIPEPREFIX` where the value
  // belonged, so a Makefile that sets `.RECIPEPREFIX = >` had every one of its
  // recipe lines parsed as an ERROR node -- a build file the analyzer reads as
  // doing nothing. The order MUST match the enum in src/scanner.c.
  //
  //   RECIPE_PREFIX        consumes the prefix character, and only when it is the
  //                        one the file currently in force
  //   RECIPEPREFIX_VALUE   the VALUE of a `RECIPEPREFIX_assignment`, consumed only
  //                        when that value is a single literal character, which is
  //                        the only shape that names a usable prefix. Aliased to the
  //                        existing `text` node, so the assignment's node and fields
  //                        are byte-for-byte what they were. The scanner DECLINES
  //                        every other value -- a variable reference, an empty
  //                        value, more than one character -- and the internal
  //                        `_assignment_text` token then handles it exactly as it
  //                        always did, so nothing but the literal case changes.
  externals: $ => [
    $._recipeprefix,
    $._recipeprefix_value,
  ],

  rules: {
    // 3.1
    makefile: $ => repeat($._thing),

    _thing: $ => choice(
      $.rule,
      $._variable_definition,
      $._directive,
      seq($._function, NL),
    ),

    // Rules {{{
    // 2.1
    rule: $ => choice(
      $._ordinary_rule,
      $._static_pattern_rule,
    ),

    // PATCH P1 (measured, M60 Make): GNU Make 7.7 "Target-specific variable".
    //
    // `variable_assignment` already accepts an OPTIONAL leading `list ':'`, so
    // `target: VAR = value` parses. It does NOT parse `target: export VAR = value`,
    // because `export_directive` puts the `export` keyword BEFORE the assignment
    // (`export [target:] VAR = value`) and nothing allows the keyword after the
    // colon. The line therefore became an ERROR node on 8 sites across 2 of the
    // corpus's 99 files, and the variable was never extracted at all.
    //
    // The branch is added to the RULE (not to export_directive) because that is
    // where the colon has already been consumed and the assignment has not yet
    // started, which is the only place the form is unambiguous.
      // `_ordinary_rule` is UNCHANGED BY P3, and that is a MEASURED decision rather
      // than an oversight. An earlier version of this patch added a branch letting a
      // declared prefix lead a RULE, on the belief that "make strips it there too".
      // GNU Make 4.3, asked directly, says otherwise:
      //
      //     $ printf '.RECIPEPREFIX = >\n>all:\n>\t@echo ok\n' | make -f -
      //     Makefile:2: *** recipe commences before first target.  Stop.
      //
      // Because `>` is the recipe prefix, `>all:` IS a recipe line, and a recipe may
      // not come before the first target. The spelling that runs leaves the rule
      // UNPREFIXED:
      //
      //     .RECIPEPREFIX = >
      //     all:
      //     >	@echo ok
      //
      // So the prefixed-rule branch was a FABRICATED construct: it accepted input
      // make rejects. It was also the sole cause of the ambiguity this branch's
      // conflict declared -- with the prefix legal at both a recipe continuation and
      // a rule, a comment between two prefixed rules was ambiguous, the greedy
      // `repeat` won, and the second RULE was swallowed into the first recipe.
      // Deleting the branch removes the fabrication and the ambiguity together, and
      // with it the `[$.concatenation, $._line_text]` conflict it required.
      //
      // The rule form is now byte-for-byte what upstream shipped, and that is the
      // property worth protecting: P3 can only ever ADD a recipe prefix, never change
      // how a rule is read. Verified against real make, not inferred.
      //
    _ordinary_rule: $ => prec.right(choice(
      seq(
        $._targets,
        choice(':', '&:', '::'),
        optional(WS),
        optional($._prerequisites),
        choice(
          $.recipe,
          NL,
        ),
      ),
      seq(
        $._targets,
        ':',
        optional(WS),
        alias($.export_directive, $.export_directive),
        NL,
      ),
    )),

    // 4.12.1
    _static_pattern_rule: $ => prec.right(seq(
      $._targets,
      ':',
      optional(WS),
      $._target_pattern,
      ':',
      optional(WS),
      optional($._prerequisites_pattern),
      choice(
        $.recipe,
        NL,
      ),
    )),

    _targets: $ => alias($.list, $.targets),

    // LINT: List shall have length one
    _target_pattern: $ => field(
      'target',
      alias($.list, $.pattern_list),
    ),

    // 4.3
    _prerequisites: $ => choice(
      $._normal_prerequisites,
      seq(
        optional($._normal_prerequisites),
        '|',
        $._order_only_prerequisites,
      ),
    ),

    _normal_prerequisites: $ => field(
      'normal',
      alias($.list, $.prerequisites),
    ),

    _order_only_prerequisites: $ => field(
      'order_only',
      alias($.list, $.prerequisites),
    ),

    _prerequisites_pattern: $ => field(
      'prerequisite',
      alias($.list, $.pattern_list),
    ),

    recipe: $ => prec.right(choice(
      // the first recipe line may be attached to the
      // target-and-prerequisites line with a semicolon
      // in between
      seq(
        $._attached_recipe_line,
        NL,
        repeat(choice(
          $.conditional,
          $._prefixed_recipe_line,
        )),
      ),
      seq(
        NL,
        repeat1(choice(
          $.conditional,
          $._prefixed_recipe_line,
        )),
      ),
    )),

    _attached_recipe_line: $ => seq(
      ';',
      optional($.recipe_line),
    ),

    _prefixed_recipe_line: $ => seq(
      // The tab stays an INTERNAL token and the external one is the alternative.
      //
      // Moving the tab out of the internal set -- the obvious way to do this --
      // is what the first three builds did, and the corpus A/B rejected all three
      // with 36 error nodes across three real Makefiles. The reason is not the
      // scanner's logic: it is that a comment line between two recipe lines
      // (a space-indented or column-zero comment, which is ordinary makefile
      // style) ends the `repeat` that continues a recipe, and the tab line after
      // it then has nowhere to go. With the tab internal, the lex state that
      // resumes a recipe still contains it and the file parses exactly as it did.
      // A four-line repro is in reviews/make/master-review.md.
      //
      // The external token therefore only ever fires for a prefix the file
      // actually asked for, and the scanner DECLINES when the tracked prefix is
      // the default tab, so the two can never both match and there is no
      // ambiguity to resolve.
      choice($._recipeprefix_tab, $._recipeprefix),
      optional($.recipe_line),
      NL,
    ),

    recipe_line: $ => seq(
      optional(choice(
        ...['@', '-', '+'].map(c => token(prec(1, c))),
      )),
      alias($._line_text, $.shell_text),
    ),
    // }}}
    // Variables {{{
    _variable_definition: $ => choice(
      $.VPATH_assignment,
      $.RECIPEPREFIX_assignment,
      $.variable_assignment,
      $.shell_assignment,
      $.define_directive,
    ),

    // 4.5.1
    VPATH_assignment: $ => seq(
      field('name', 'VPATH'),
      optional(WS),
      field('operator', choice(...DEFINE_OPS)),
      field('value', $.paths),
      NL,
    ),

    RECIPEPREFIX_assignment: $ => seq(
      field('name', '.RECIPEPREFIX'),
      optional(WS),
      field('operator', choice(...DEFINE_OPS)),
      // The external arm is tried FIRST and handles the single-literal-character
      // value; the internal arm is the unchanged original, and is what parses
      // every value the scanner declines. Both alias to `text`, so the emitted
      // node and its `value` field are identical either way.
      field('value', choice(
        alias($._recipeprefix_value, $.text),
        alias($._assignment_text, $.text),
      )),
      NL,
    ),

    // 6.5
    variable_assignment: $ => seq(
      optional($._target_or_pattern_assignment),
      $._name,
      optional(WS),
      field('operator', choice(...DEFINE_OPS)),
      optional(WS),
      optional(field('value', alias($._assignment_text, $.text))),
      NL,
    ),

    _target_or_pattern_assignment: $ => seq(
      field('target_or_pattern', $.list),
      ':',
      optional(WS),
    ),

    shell_assignment: $ => seq(
      field('name', $.word),
      optional(WS),
      field('operator', '!='),
      optional(WS),
      field('value', alias($._line_text, $.shell_command)),
      NL,
    ),

    define_directive: $ => seq(
      'define',
      field('name', $.word),
      optional(WS),
      optional(field('operator', choice(...DEFINE_OPS))),
      optional(WS),
      NL,
      optional(field('value',
        alias(repeat1($._rawline), $.raw_text),
      )),
      token(prec(1, 'endef')),
      NL,
    ),
    // }}}
    // Directives {{{
    _directive: $ => choice(
      $.include_directive,
      $.vpath_directive,
      $.export_directive,
      $.unexport_directive,
      $.override_directive,
      $.undefine_directive,
      $.private_directive,
      $.conditional,
    ),

    // 3.3
    include_directive: $ => choice(
      seq('include', field('filenames', $.list), NL),
      seq('sinclude', field('filenames', $.list), NL),
      seq('-include', field('filenames', $.list), NL),
    ),

    // 4.5.2
    vpath_directive: $ => choice(
      seq('vpath', NL),
      seq('vpath', field('pattern', $.word), NL),
      seq('vpath', field('pattern', $.word), field('directories', $.paths), NL),
    ),

    // 5.7.2
    export_directive: $ => choice(
      seq('export', NL),
      seq('export', field('variables', $.list), NL),
      seq('export', $.variable_assignment),
    ),

    // 5.7.2
    unexport_directive: $ => choice(
      seq('unexport', NL),
      seq('unexport', field('variables', $.list), NL),
    ),

    // 6.7
    override_directive: $ => choice(
      seq('override', $.define_directive),
      seq('override', $.variable_assignment),
      seq('override', $.undefine_directive),
    ),

    // 6.9
    undefine_directive: $ => seq(
      'undefine', field('variable', $.word), NL,
    ),

    // 6.13
    private_directive: $ => seq(
      'private', $.variable_assignment,
    ),
    // }}}
    // Conditionals {{{
    // 7
    conditional: $ => seq(
      field('condition', $._conditional_directives),
      optional(field('consequence', $._conditional_consequence)),
      repeat($.elsif_directive),
      optional($.else_directive),
      'endif',
      NL,
    ),

    elsif_directive: $ => seq(
      'else',
      field('condition', $._conditional_directives),
      optional(field('consequence', $._conditional_consequence)),
    ),

    else_directive: $ => seq(
      'else',
      NL,
      optional(field('consequence', $._conditional_consequence)),
    ),

    _conditional_directives: $ => choice(
      $.ifeq_directive,
      $.ifneq_directive,
      $.ifdef_directive,
      $.ifndef_directive,
    ),

    _conditional_consequence: $ => repeat1(choice(
      $._thing,
      $._prefixed_recipe_line,
    )),

    ifeq_directive: $ => seq(
      'ifeq', $._conditional_args_cmp, NL,
    ),

    ifneq_directive: $ => seq(
      'ifneq', $._conditional_args_cmp, NL,
    ),

    ifdef_directive: $ => seq(
      'ifdef', field('variable', $._primary), NL,
    ),

    ifndef_directive: $ => seq(
      'ifndef', field('variable', $._primary), NL,
    ),

    _conditional_args_cmp: $ => choice(
      seq(
        '(',
        optional(field('arg0', $._primary)),
        ',',
        optional(field('arg1', $._primary)),
        ')',
      ),
      seq(
        field('arg0', $._primary),
        field('arg1', $._primary),
      ),
    ),

    // }}}
    // Variables {{{
    _variable: $ => choice(
      // PATCH P2 placement: the escaped-dollar SHELL form is tried FIRST, and it
      // is keyed on `$$` so it cannot shadow a real `$(...)` expansion.
      $._shell_escape,
      $.variable_reference,
      $.substitution_reference,
      $.automatic_variable,
    ),

    variable_reference: $ => seq(
      choice('$', '$$'),
      choice(
        delimitedVariable($._primary),
        // TODO are those legal? $) $$$
        alias(token.immediate(/./), $.word), // match any single digit
        // alias(token.immediate('\\\n'), $.word)
      ),
    ),

    // 6.3.1
    substitution_reference: $ => seq(
      choice('$', '$$'),
      delimitedVariable(seq(
        field('text', $._primary),
        ':',
        field('pattern', $._primary),
        '=',
        field('replacement', $._primary),
      )),
    ),

    // 10.5.3
    automatic_variable: _ => seq(
      choice('$', '$$'),
      choice(
        choice(
          ...AUTOMATIC_VARS
            .map(c => token.immediate(prec(1, c))),
        ),
        delimitedVariable(seq(
          choice(
            ...AUTOMATIC_VARS
              .map(c => token(prec(1, c))),
          ),
          optional(choice(
            token.immediate('D'),
            token.immediate('F'),
          )),
        )),
      ),
    ),
    // }}}
    // Functions {{{
    _function: $ => choice(
      $.function_call,
      $.shell_function,
    ),

    function_call: $ => seq(
      choice('$', '$$'),
      token.immediate('('),
      field('function', choice(
        ...FUNCTIONS.map(f => token.immediate(f)),
      )),
      optional(WS),
      $.arguments,
      ')',
    ),

    arguments: $ => seq(
      field('argument', $.text),
      repeat(seq(
        ',',
        field('argument', $.text),
      )),
    ),

    // 8.13
    shell_function: $ => seq(
      choice('$', '$$'),
      token.immediate('('),
      field('function', 'shell'),
      optional(WS),
      alias($._paren_text, $.shell_command),
      ')',
    ),

    // PATCH P2 (measured, M60 Make): `$$( ... )`.
    //
    // `$$` is Make's ESCAPED dollar, so Make does NOT expand `$$(X)` — it hands
    // `$(X)` to the shell verbatim. The grammar already writes `choice('$','$$')`
    // on variable_reference, substitution_reference, automatic_variable and
    // function_call, which routes an escaped form into the make-expansion
    // branches. When the content is a SHELL command rather than a make primary —
    // `$$($(GO_CMD) list -tags enterprise ./... | grep -v vendor/)` — neither
    // branch can parse it (variable_reference takes a single `_primary`; there are
    // spaces and a pipe), and the whole line became an ERROR node, so
    // MAIN_PACKAGES was never extracted.
    //
    // Keyed on the `$$` form ONLY, which is what makes it unambiguous: `$(FOO)` is
    // still a variable reference, and only the escaped spelling can be a shell
    // command. Whether this REGRESSES anything is decided by the A/B over the
    // 99-file corpus, not by this comment.
    // `prec(1, …)` resolves the conflict the generator reports between this rule
    // and `variable_reference`: `$(FOO)` is BOTH a single `_primary` and a
    // balanced `_paren_text`, and without a precedence the parse is ambiguous.
    // Raising the escaped form wins for `$$(`, which is the semantically correct
    // reading — Make does not expand it. Whether that changes anything the
    // analyzer can see is decided by the A/B, not here.
    _shell_escape: $ => prec.dynamic(1, seq(
      '$$',
      token.immediate('('),
      alias($._paren_text, $.shell_command),
      ')',
    )),
    // }}}
    // Primary and lists {{{
    list: $ => prec(1, seq(
      $._primary,
      repeat(seq(
        choice(WS, SPLIT),
        $._primary,
      )),
      optional(WS),
    )),

    paths: $ => seq(
      $._primary,
      repeat(seq(
        choice(...[':', ';'].map(c => token.immediate(c))),
        $._primary,
      )),
    ),

    _primary: $ => choice(
      $.word,
      $.archive,
      $._variable,
      $._function,
      $.concatenation,
      $.string,
    ),

    concatenation: $ => prec.right(seq(
      $._primary,
      repeat1(prec.left($._primary)),
    )),
    // }}}
    // Names {{{
    _name: $ => field('name', $.word),

    string: $ => field('string', choice(
      seq('"', optional($._string), '"'),
      seq('\'', optional($._string), '\''),
    )),

    _string: $ => repeat1(choice(
      $._variable,
      $._function,
      token(prec(-1, /([^'"$\r\n\\]|\\\\|\\[^\r\n])+/)),
    )),

    word: _ => token(repeat1(choice(
      new RegExp('[' + CHARSET + ']'),
      new RegExp('\\\\[' + ESCAPE_SET + ']'),
      new RegExp('\\\\[0-9]{3}'),
    ))),

    // 11.1
    archive: $ => seq(
      field('archive', $.word),
      token.immediate('('),
      field('members', $.list),
      token.immediate(')'),
    ),
    // }}}
    // Tokens {{{
    // P3: the DEFAULT recipe prefix, kept as an internal token so that every
    // makefile which does not use `.RECIPEPREFIX` lexes through exactly the token
    // set it always did. The external `_recipeprefix` covers the rest, and declines
    // whenever the tracked prefix is this one.
    _recipeprefix_tab: _ => '\t',

    // TODO prefixed line in define is recipe
    _rawline: _ => token(/.*[\r\n]+/), // any line

    _paren_group: $ => seq(
      '(',
      optional($._paren_text),
      ')',
    ),

    _line_text: $ => makeText($, {
      disallow: ['\\$', '\\n', '\\r', '\\'],
      allowSplit: true,
    }),

    // Disallow unescaped # so trailing comments tokenize correctly in assignments.
    _assignment_text: $ => makeText($, {
      disallow: ['\\$', '\\n', '\\r', '\\', '#'],
      allowSplit: true,
    }),

    _paren_text: $ => makeText($, {
      disallow: ['\\$', '\\(', '\\)', '\\n', '\\r', '\\'],
      allowSplit: true,
      extraFenced: [$._paren_group],
    }),

    text: $ => $._paren_text,
    // }}}

    comment: _ => token(prec(-1, /#.*/)),
  },
});

/**
 *
 * @param {...any} characters
 */
function noneOf(...characters) {
  const negatedString = characters.map(c => c == '\\' ? '\\\\' : c).join('');
  return new RegExp('[^' + negatedString + ']');
}

/**
 *
 * @param {RuleOrLiteral} rule
 */
function delimitedVariable(rule) {
  return choice(
    seq(token.immediate('('), rule, ')'),
    seq(token.immediate('{'), rule, '}'),
  );
}

/**
 *
 * @param {GrammarSymbols<string>} $
 * @param {{ disallow: string[], allowSplit?: boolean, extraFenced?: RuleOrLiteral[] }} opts
 */
function makeText($, opts) {
  const rawText = opts.allowSplit ?
    choice(noneOf(...opts.disallow), SPLIT) :
    noneOf(...opts.disallow);

  const fencedVars = choice(
    $._variable,
    $._function,
    alias('$$', $.escape),
    alias('//', $.escape),
    ...(opts.extraFenced ?? []),
  );

  return text(rawText, fencedVars);
}

/**
 *
 * @param {RuleOrLiteral} text
 * @param {RuleOrLiteral} fenced_vars
 */
function text(text, fenced_vars) {
  const raw_text = token(repeat1(choice(
    text,
    new RegExp('\\\\[' + ESCAPE_SET + ']'),
    new RegExp('\\\\[0-9]{3}'),
    new RegExp('\\\\[^\n\r]'), // used in cmd like sed \1
  )));
  return choice(
    seq(
      raw_text,
      repeat(seq(
        fenced_vars,
        optional(raw_text),
      )),
    ),
    seq(
      fenced_vars,
      repeat(seq(
        optional(raw_text),
        fenced_vars,
      )),
      optional(raw_text),
    ),
  );
}
