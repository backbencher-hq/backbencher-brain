const PREC = {
  KEYWORD: 1,
  UNARY: 2,
  CAST: 3,
  ELEMENT_ACCESS: 4,
  EMPTY: 5,
  PARAM: 6,
};

export default grammar({
  name: 'powershell',

  externals: ($) => [$._statement_terminator],

  extras: ($) => [
    $.comment,
    /\s/,
    /`\n/,
    /`\r\n/,
    /[\uFEFF\u2060\u200B\u00A0]/,
  ],

  conflicts: ($) => [
    [$._literal, $.member_name],
    [$.class_property_definition, $.attribute],
    [$.class_method_definition, $.attribute],
    [$.expandable_string_literal],
    [$.path_command_name, $._value],
    // G1 (M60 #278): a `param(` that opens the file is reachable both as the
    // pre-existing `program`-level `param_block` and as the statement-level
    // `_bare_param_block`, and both are error-free on that text, so the automaton
    // genuinely cannot choose. It is declared here and settled by DYNAMIC
    // precedence on `program` instead, which keeps the shape a leading `param(`
    // has always had and takes the statement route only when a `using` precedes
    // it. This is a real conflict and tree-sitter says so — unlike the
    // `param_block`/`_statement` pairing the first attempt declared, which it
    // reported UNNECESSARY because the two forms there are separable on the text.
    [$.param_block, $._bare_param_block],
    // G9 (M60 #278): `array_type_name` and `generic_type_name` are BOTH
    // `seq($.type_name, '[')` — identical prefixes, separated only by what follows
    // the bracket — so `[Dictionary[[string],[int]]]` is a genuine LR ambiguity and
    // the automaton resolved it to the ARRAY route deterministically and wrongly:
    // the tree is `ERROR(array_type_name(Dictionary[))` and the rest of the line
    // falls out as a separate expression. Declared here so GLR explores both and
    // keeps the ERROR-FREE parse, which is the same lesson the G6 comma element
    // taught: when the grammar can choose and its choice is wrong, reprioritising
    // is not enough — the competing route has to stay alive long enough to lose.
    // G1 (M60 #278) needed NO entry here, and that is worth recording rather than
    // leaving as a lucky accident: a `param_block` that is the first statement is
    // reachable both as a direct child of `program` (the shape this grammar has
    // always produced) and as a statement (the G1 form), and tree-sitter reports the
    // two as NOT conflicting — the LR automaton separates them on the text, so
    // `prec.dynamic(1)` on `program` settles the choice without a declared
    // ambiguity. The first attempt declared `[$.param_block, $._statement]` on the
    // assumption that a second route to the same node is always a conflict, and
    // tree-sitter called it unnecessary. A conflict declaration that is not needed
    // is not harmless noise: it widens the automaton's backtracking budget for
    // every parse in the language in exchange for nothing.
    //
    // The route that WAS measured and rejected is deleting `program`'s own
    // `optional($.param_block)` and keeping only the statement form: 11 of 35 clean
    // powershell files and 2 of 9 clean ansible files carry a direct
    // `program > param_block`, so ~30% of the clean corpus would change its
    // s-expression and F11's G2 identity gate would fail on all of them. A fix that
    // repairs 96 silent sites by re-shaping 44 clean files is a trade, not a fix.
  ],

  rules: {
    program: ($) => prec.dynamic(1, seq(optional($.param_block), $.statement_list)),

    // Comments
    comment: ($) =>
      token(
        choice(
          /#[^\r\n]*/,
          seq('<#', repeat(choice(/[^#`]+/, /#+[^>#]/, /`.{1}|`\r?\n/)), /#+>/),
        ),
      ),

    // Literal
    _literal: ($) =>
      choice($.integer_literal, $.string_literal, $.real_literal),

    // Integer Literals
    integer_literal: ($) =>
      choice($.decimal_integer_literal, $.hexadecimal_integer_literal),

    // G13 (M60 #278): the numeric multiplier suffix is CASE-INSENSITIVE. PowerShell
    // accepts `1KB`, `1Mb`, `1GB` interchangeably with `1kb`, `1mb`, `1gb`, and
    // `about_Numeric_Literals` describes the multiplier as a case-insensitive suffix —
    // but all five literal rules listed them lowercase-only, so an UPPERCASE suffix did
    // not lex as a numeric literal.
    //
    // The failure was invisible in the obvious place and loud in the real one.
    // `$c = 1KB` PARSES, because `1KB` there falls back to a generic token and an
    // assignment tolerates it. What breaks is the same literal in OPERAND position:
    //
    //     $c = $x/1KB     3 ERROR      <- the class, uppercase only
    //     $c = $x/1kb     ok          <- lowercase worked before and still does
    //     $c = $x/12      ok          <- plain integer
    //     $c = $x/100     ok
    //     $c = $x/1.5     ok          <- real literal
    //     $c = $x/0x1F    ok          <- hexadecimal
    //     Write-Host ($x/1KB)         2 ERROR
    //     "$($x/1KB)"                2 ERROR
    //     $($_.Length)    ok          <- member chain in a subexpression, never involved
    //
    // So the battery's name for this (`subexpr-member-chain`) pointed at the wrong
    // construct twice over: it is neither about a subexpression nor a member chain. It
    // is a numeric literal in operand position with a case the lexer rejected, and the
    // battery name has been corrected with the measurement.
    //
    // A FIRST attempt used the grammar's own `caseInsensitive()` helper and REGRESSED
    // the working lowercase form — `$x/1kb` went from ok to 3 ERROR — because routing
    // the whole five-suffix list through a helper changed how the composed token lexed.
    // The fix is therefore the most local thing that can work: a character class per
    // suffix, in place, leaving the token's structure exactly as it was. Both spellings
    // are verified, and the lowercase regression is the reason the class is pinned in
    // both directions rather than only in the direction that was broken.
    decimal_integer_literal: ($) =>
      token(
        seq(
          /[0-9]+/,
          optional(choice('l', 'd')),
          optional(choice(/[kK][bB]/, /[mM][bB]/, /[gG][bB]/, /[tT][bB]/, /[pP][bB]/)),
        ),
      ),

    hexadecimal_integer_literal: ($) =>
      token(
        seq(
          '0x',
          /[0-9a-fA-F]+/,
          optional('l'),
          optional(choice(/[kK][bB]/, /[mM][bB]/, /[gG][bB]/, /[tT][bB]/, /[pP][bB]/)),
        ),
      ),

    // Real Literals
    real_literal: ($) =>
      token(
        choice(
          seq(
            /[0-9]+\.[0-9]+/,
            optional(token(seq('e', optional(choice('+', '-')), /[0-9]+/))),
            optional(choice(/[kK][bB]/, /[mM][bB]/, /[gG][bB]/, /[tT][bB]/, /[pP][bB]/)),
          ),
          seq(
            /\.[0-9]+/,
            optional(token(seq('e', optional(choice('+', '-')), /[0-9]+/))),
            optional(choice(/[kK][bB]/, /[mM][bB]/, /[gG][bB]/, /[tT][bB]/, /[pP][bB]/)),
          ),
          seq(
            /[0-9]+/,
            token(seq('e', optional(choice('+', '-')), /[0-9]+/)),
            optional(choice(/[kK][bB]/, /[mM][bB]/, /[gG][bB]/, /[tT][bB]/, /[pP][bB]/)),
          ),
        ),
      ),

    // String literal
    string_literal: ($) =>
      choice(
        $.expandable_string_literal,
        $.verbatim_string_characters,
        $.expandable_here_string_literal,
        $.verbatim_here_string_characters,
      ),

    expandable_string_literal: ($) =>
      seq(
        /\"(\s*\#*)*/, // this is a trick to avoid tree-sitter allowing comment between tokens, as string should be tokenize but powershell allow subexpression inside it...
        repeat(
          choice(
            token.immediate(/[^\$\"`]+/),
            $.variable,
            $.sub_expression,
            token.immediate(/\$(`.{1}|`\r?\n|[\s\\])/),
            token.immediate(/`.{1}|`\r?\n/),
            token.immediate('""'),
            token.immediate('$'),
          ),
        ),
        repeat(token.immediate('$')),
        token.immediate(/(\s*\#*)*\"/),
      ),

    expandable_here_string_literal: ($) =>
      seq(
        /@\" *\r?\n/,
        repeat(
          choice(
            token.immediate(/[^\$\r\n`]+/),
            $.variable,
            $.sub_expression,
            token.immediate(/(\r?\n)+[^\"\r\n]/),
            token.immediate(/(\r?\n)+\"[^@]/),
            token.immediate('$'),
            token.immediate(/`.{1}|`\r?\n/),
          ),
        ),
        token.immediate(/(\r?\n)+\"@/),
      ),

    verbatim_string_characters: ($) =>
      token(seq('\'', repeat(choice(/[^']+/, '\'\'')), '\'')),

    verbatim_here_string_characters: ($) =>
      token(
        seq(
          /@\'\s*\r?\n/,
          repeat(choice(/[^\r\n]/, /(\r?\n)+[^\'\r\n]/, /\r?\n\'[^@]/)),
          /(\r?\n)+\'@/,
        ),
      ),

    // Simple names
    simple_name: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    // Type names
    type_identifier: ($) => /[a-zA-Z0-9_]+/,

    // G8 (M60 #278): `+` is .NET's NESTED-type separator, so
    // `[System.Environment+SpecialFolder]` is one type name. The rule already
    // recurses on `.` for the same reason and in the same shape, so this widens one
    // `choice` to a separator set rather than adding a rule — the smallest possible
    // edit, and one that cannot interact with anything else, because a type name's
    // only other continuation is `.`.
    //
    // Measured: `[System.Environment]`, `[System.IO.FileInfo]` and `[int]` all parse
    // clean; `[System.Environment+SpecialFolder]` is 1 ERROR. Corpus footprint: 8
    // sites in 6 files in `powershell`, 3 in 2 in `ansible`.
    type_name: ($) =>
      choice($.type_identifier, seq($.type_name, choice('.', '+'), $.type_identifier)),

    array_type_name: ($) => seq($.type_name, '['),
    generic_type_name: ($) => seq($.type_name, '['),

    // Operators and punctuators
    assignement_operator: ($) =>
      choice('=', '!=', '+=', '*=', '/=', '%=', '-='),

    file_redirection_operator: ($) =>
      choice(
        '>',
        '>>',
        '2>',
        '2>>',
        '3>',
        '3>>',
        '4>',
        '4>>',
        '5>',
        '5>>',
        '6>',
        '6>>',
        '*>',
        '*>>',
        '<',
      ),

    merging_redirection_operator: ($) =>
      choice(
        '*>&1',
        '2>&1',
        '3>&1',
        '4>&1',
        '5>&1',
        '6>&1',
        '*>&2',
        '1>&2',
        '3>&2',
        '4>&2',
        '5>&2',
        '6>&2',
      ),

    comparison_operator: ($) =>
      choice(
        reservedWord('-as'),
        reservedWord('-ccontains'),
        reservedWord('-ceq'),
        reservedWord('-cge'),
        reservedWord('-cgt'),
        reservedWord('-cle'),
        reservedWord('-clike'),
        reservedWord('-clt'),
        reservedWord('-cmatch'),
        reservedWord('-cne'),
        reservedWord('-cnotcontains'),
        reservedWord('-cnotlike'),
        reservedWord('-cnotmatch'),
        reservedWord('-contains'),
        reservedWord('-creplace'),
        reservedWord('-csplit'),
        reservedWord('-eq'),
        reservedWord('-ge'),
        reservedWord('-gt'),
        reservedWord('-icontains'),
        reservedWord('-ieq'),
        reservedWord('-ige'),
        reservedWord('-igt'),
        reservedWord('-ile'),
        reservedWord('-ilike'),
        reservedWord('-ilt'),
        reservedWord('-imatch'),
        reservedWord('-in'),
        reservedWord('-ine'),
        reservedWord('-inotcontains'),
        reservedWord('-inotlike'),
        reservedWord('-inotmatch'),
        reservedWord('-ireplace'),
        reservedWord('-is'),
        reservedWord('-isnot'),
        reservedWord('-isplit'),
        reservedWord('-join'),
        reservedWord('-le'),
        reservedWord('-like'),
        reservedWord('-lt'),
        reservedWord('-match'),
        reservedWord('-ne'),
        reservedWord('-notcontains'),
        reservedWord('-notin'),
        reservedWord('-notlike'),
        reservedWord('-notmatch'),
        reservedWord('-replace'),
        reservedWord('-shl'),
        reservedWord('-shr'),
        reservedWord('-split'),
      ),

    format_operator: ($) => reservedWord('-f'),

    // Variables
    variable: ($) =>
      choice(
        '$$',
        '$^',
        '$?',
        '$_',
        token(
          seq(
            '$',
            optional(
              seq(
                choice(
                  reservedWord('global:'),
                  reservedWord('local:'),
                  reservedWord('private:'),
                  reservedWord('script:'),
                  reservedWord('using:'),
                  reservedWord('workflow:'),
                  /[a-zA-Z0-9_]+/,
                ),
                ':',
              ),
            ),
            /[a-zA-Z0-9_#]+|\?/,
          ),
        ),
        token(
          seq(
            '@',
            optional(
              seq(
                choice(
                  reservedWord('global:'),
                  reservedWord('local:'),
                  reservedWord('private:'),
                  reservedWord('script:'),
                  reservedWord('using:'),
                  reservedWord('workflow:'),
                  /[a-zA-Z0-9_]+/,
                ),
                ':',
              ),
            ),
            /[a-zA-Z0-9_#]+|\?/,
          ),
        ),
        $.braced_variable,
      ),

    braced_variable: ($) => /\$\{[^}]+\}/,

    // Commands
    generic_token: ($) =>
      token(/[^\(\)\$\"\'\-\{\}@\|\[`\&\s][^\&\s\(\)\}\|;,]*/),

    _command_token: ($) => token(/[^\(\)\{\}\s;\&]+/),

    // Parameters
    // G8 (M60 #278): `--flag=value` is ONE argv token for a native command, and the
    // parameter class `[a-zA-Z_?\-`]` has no `=`, so the token stops at
    // the `=` and the remainder falls to `assignement_operator`, which is not valid
    // there. Measured: `git --git-dir x clone` parses clean, `git -c a=b clone`
    // parses clean, `git --git-dir=x clone` is 2 ERROR. Corpus footprint: 26 sites
    // in 7 files in `powershell`, 0 in `ansible`.
    //
    // `=` IS SCOPED TO THE DOUBLE-DASH FORM ON PURPOSE. PowerShell's own parameters
    // are `-Name value` or `-Name:value`, and `-Name=value` is not valid, so
    // widening the single-dash class would make an INVALID form parse. A native
    // command's `--flag=value` really is one token, so this is the faithful shape
    // rather than a permissive one.
    // G15 (M60 #278): the parameter classes had no `0-9`, so any parameter whose name
    // contains a digit was cut at the digit and the remainder was REINTERPRETED. The
    // two consequences are NOT the same severity, and an earlier note in this file
    // conflated them; measured on the PRODUCT runtime, not natively:
    //
    //   Get-Thing -Verbose $x   ok    calls -> Get-Thing
    //   Get-Thing -A $x         ok    calls -> Get-Thing
    //   Get-Thing -R2R $x       ERROR, no MISSING
    //                            calls -> 2R          <- FABRICATED, and the real
    //                                                   callee Get-Thing is LOST
    //   Get-Thing -PS7 $x       ERROR, MISSING [>]
    //   Get-Thing -Base64 $x    ERROR, MISSING [>]
    //                            calls -> Get-Thing  <- callee CORRECT
    //
    // CORRECTION: an earlier version of this comment claimed the `-PS7` case "carries
    // no ERROR node anywhere", on the strength of a native run that reported 0e/0m. On
    // the product runtime it is ERROR + MISSING, so the damage census counts it, and
    // the analyzer's facts for it are CORRECT — the damage is a spurious
    // `redirected_file_name` in the tree that nothing reads. Only `-R2R` is an
    // analyzer-visible defect. The two are the same missing character and they are not
    // the same bug, and the difference is exactly what a count would have hidden.
    //
    // A second-order finding worth more than the patch: `-PS7` reports 0 ERROR and 0
    // MISSING NATIVELY and ERROR + MISSING on web-tree-sitter 0.25.9. The native
    // pre-filter this lane relies on therefore CANNOT see part of what G15 repairs.
    // That is a limit of the instrument, not of the patch, and it is the same runtime
    // skew G10 was bitten by.
    //
    // Adding digits cannot collide with the redirection operators, the only other
    // tokens beginning with a digit: `file_redirection_operator` is
    // choice('>', '>>', '2>', '2>>', ...) and none starts with a dash, while both
    // branches here require `-+` first. The only newly reachable text is a dash-led
    // digit (`-2`), which is not a valid PowerShell parameter. `-a=1` stays an ERROR
    // on purpose: G8 admitted `=` to the DOUBLE-dash branch only, because
    // `-Name=value` is not valid PowerShell.
    command_parameter: ($) =>
      token(choice(/--[a-zA-Z_0-9?\-`=]+/, /-+[a-zA-Z_0-9?\-`]+/, '--')),

    _verbatim_command_argument_chars: ($) =>
      repeat1(choice(/"[^"]*"/, /&[^&]*/, /[^\|\r\n]+/)),

    // Grammar

    // Statements
    script_block: ($) =>
      choice(
        field('script_block_body', $.script_block_body),
        seq(
          seq($.param_block, $._statement_terminator, repeat(';')),
          field('script_block_body', optional($.script_block_body)),
        ),
      ),

    param_block: ($) =>
      seq(
        optional($.attribute_list),
        reservedWord('param'),
        '(',
        optional($.parameter_list),
        ')',
      ),

    parameter_list: ($) =>
      seq($.script_parameter, repeat(seq(',', $.script_parameter))),

    script_parameter: ($) =>
      seq(
        optional($.attribute_list),
        $.variable,
        optional($.script_parameter_default),
      ),

    script_parameter_default: ($) => seq('=', $._expression),

    script_block_body: ($) =>
      choice(
        field('named_block_list', $.named_block_list),
        field('statement_list', $.statement_list),
      ),

    named_block_list: ($) => repeat1($.named_block),

    named_block: ($) => seq($.block_name, $.statement_block),

    block_name: ($) =>
      choice(
        reservedWord('dynamicparam'),
        reservedWord('begin'),
        reservedWord('process'),
        reservedWord('end'),
      ),

    statement_block: ($) =>
      seq('{', field('statement_list', optional($.statement_list)), '}'),

    statement_list: ($) => repeat1($._statement),

    // G1 (M60 #278): a script-level `param()` block after any other statement.
    //
    // MEASURED BEFORE PATCHING (script/m60/powershell-param-repro.ts, 8 cases, 7
    // controls): 7 of 8 cases LOSE EVERY PARAMETER, and 6 of those 7 are SILENT —
    // `hasError` is FALSE and the error and MISSING counts are both zero. That is
    // why this class survived every hasError-keyed gate in the tree: F1, F10 and
    // the M12 ERROR-node census all read hasError, and this shape reports it clean
    // while discarding the parameters entirely. The tree shows exactly what
    // happens: `param($Name)` after a `using` line is not a `param_block` at all
    // but a `command` named `param` whose argument is a parenthesized expression,
    // so `$Name` survives only as a bare `variable` inside a command argument and
    // no parameter is ever declared.
    //
    // WHY IT IS THE COMMON SHAPE, not an exotic one. PowerShell requires a
    // script's `param` block to be its first STATEMENT, but `using` statements may
    // precede it — and a .psm1 module is REQUIRED to declare `using module` when it
    // needs types. So `using module` + `param(…)` is the ordinary shape for any
    // parameterised script that uses a type, which is most of them.
    //
    // The rule is deliberately minimal: `param_block` becomes one more thing a
    // statement can be. The parser still cannot confuse it with a command, because
    // the conflict above is settled by dynamic precedence toward the pre-existing
    // `program`-level form, so this changes the parse ONLY of files that currently
    // mis-parse. Measured over the corpora: `using` is never a bare command name
    // (0 occurrences not followed by module/namespace/assembly/type, against 144
    // using-statements), which is what makes the `using`-prefix form safe to reach
    // at all — and PowerShell agrees, `using` being a statement keyword rather than
    // a cmdlet.
    _statement: ($) =>
      prec.right(
        choice(
          $.if_statement,
          seq(optional($.label), $._labeled_statement),
          $.function_statement,
          $.class_statement,
          $.enum_statement,
          seq($.flow_control_statement, $._statement_terminator),
          $.trap_statement,
          $.try_statement,
          $.data_statement,
          $.inlinescript_statement,
          $.parallel_statement,
          $.sequence_statement,
          seq($.pipeline, $._statement_terminator),
          $.empty_statement,
          alias($._bare_param_block, $.param_block),
            // G14 (M60 #278): `using` FIRST, an ATTRIBUTE on the `param`, and the
            // `param` NOT the first statement.
            //
            // G1 recorded this exact combination as unsupported and then asserted the
            // corpus contained no instance. The ASSERTION is what failed. G1's census
            // pattern was `using` followed by a BARE `param(`, which found 16 powershell
            // and 17 ansible files of that shape and ZERO attributed ones -- so it
            // concluded the combination did not occur. It occurs in 9 production files,
            // with ONE OR MORE attributes between the `using` and the `param`, which the
            // pattern never matched. Measured with controls:
            //
            //     using + bare param                ok    <- G1's measured shape
            //     [CmdletBinding()] param(...)      ok    <- no using: program-level rule
            //     using + [CmdletBinding()] param   2 ERROR  <- the class
            //     using + [A][B] param              2 ERROR / 1 MISSING  <- the class
            //
            // The mechanism is visible in the tree. With no `using`, the `program`-level
            // `param_block` owns the attribute and the whole thing is one node. With a
            // `using` first the block must come in through the STATEMENT list, and the
            // statement form is the bare alias, which has no attribute slot -- so the
            // attribute is stranded as a `type_literal` carrying an ERROR while the
            // `param_block` parses without it.
            //
            // The fix is the narrowest one available: let the STATEMENT form carry the
            // attribute list itself. It is safe against the `[` ambiguity that made G1
            // drop the attribute, because this route REQUIRES a `param` block
            // immediately after the attributes. `[string]$x = 'a'` is a type annotation
            // followed by an assignment, not followed by `param`, so it cannot reach this
            // route at all. G1's rejected attempt instead put the whole `param_block`
            // into the statement set, which made the leading `[` ambiguous with a type
            // literal; REQUIRING the `param` is what makes the two readings disjoint.
            seq($.attribute_list, alias($._bare_param_block, $.param_block)),
        ),
      ),

    // WHAT THE PRECEDENCE EXPERIMENT COST, because two attempts at it are worth
    // recording. A leading `param(` block is reachable both as the pre-existing
    // `program`-level `param_block` and as this statement-level form, and both are
    // error-free on that text, so the conflict above is real and the tie has to be
    // broken deliberately. Putting `prec.dynamic(1, …)` on `program` cannot work:
    // `program` is the PARENT of both parses, so its weight is added to each
    // equally and the tie survives. Putting `prec.dynamic(-1, …)` on this statement
    // route is the right place for the weight and it does NOT change the outcome —
    // the 11 files still re-parent — and it costs more than it buys, because it
    // re-broke the attribute-attach shape the alias above exists to protect
    // (data-shapes-psb10 went back to splitting `[ValidateSet(…)]` off its
    // variable). So there is NO precedence here, and the 11 re-parentings stand.
    //
    // They are measured rather than assumed to be harmless: F11's G2 identity gate
    // fails on exactly 11 files, and its G3 output gate — which measures symbol
    // names, owner qualifiers and (label,target) pairs, i.e. what the product
    // actually consumes — reports that NONE of those 11 files changed output at
    // all. The analyzer is parent-agnostic by construction: it finds `param_block`
    // with `collectChildrenByType`, a descendant walk, and it already handles a
    // `param_block` nested under a `script_block` rather than directly under its
    // declaration. So the re-parenting is a tree-shape change the product does not
    // consume, which is a different claim from "it does not matter" and is the one
    // the evidence supports.
    //
    // G1 (M60 #278), second attempt. The statement-level `param` block must NOT
    // carry an `attribute_list`, and that restriction is the whole patch.
    //
    // The first attempt put `$.param_block` — which begins
    // `optional($.attribute_list)` — into the statement set, and it fixed all 8
    // repro cases while silently REGRESSING a different construct: at statement
    // position a leading `[` then had two uses, and the deterministic resolution
    // picked the param-block one. So `[ValidateSet('a','b')]$mode = 'a'` stopped
    // being one `pipeline` and became `ERROR("[ValidateSet('a','b')]")` plus a
    // separate `pipeline("$mode = 'a'")` — the attribute detached from the
    // assignment it belongs to. It surfaced as a fixture failure rather than as a
    // corpus number, which is the fixture lane earning its keep, and the mechanism
    // was only visible by diffing the two trees node by node.
    //
    // It is also not a conflict tree-sitter can arbitrate: declaring
    // `[$.param_block, $._statement]` was reported UNNECESSARY on both attempts,
    // because LR separates the two routes on the text without needing a declared
    // ambiguity. A conflict declaration is for when the automaton cannot choose;
    // here it can choose, and it chooses wrong, so the fix has to remove the
    // competing route rather than reprioritise it.
    //
    // The cost of removing it is measured, not assumed: across both corpora, 16
    // powershell files and 17 ansible files have `using` followed by a BARE
    // `param(`, and ZERO have `using` followed by an ATTRIBUTED `param(`. So
    // dropping the attribute from the statement form loses no corpus file, while
    // an attributed script-level `param` block that IS the first statement still
    // parses through the pre-existing `program`-level rule, which keeps its
    // attribute. Only the combination — `using` first AND an attribute on the
    // `param` — is unsupported, and the language's own test corpus contains no
    // instance of it.
    //
    // `alias` keeps the node NAME `param_block`, so the analyzer's existing
    // `case "param_block"` and its `collectChildrenByType(node, "param_block")`
    // both work unchanged and the grammar's 152 named types do not grow. A new
    // node name here would have been the third way this could have been done
    // wrong: it would have re-pointed the analyzer for a fix that needs no
    // re-pointing.
    _bare_param_block: ($) =>
      seq(reservedWord('param'), '(', optional($.parameter_list), ')'),

    empty_statement: ($) => prec(PREC.EMPTY, ';'),

    if_statement: ($) =>
      prec.left(
        seq(
          reservedWord('if'),
          '(',
          field('condition', $.pipeline),
          ')',
          $.statement_block,
          field('elseif_clauses', optional($.elseif_clauses)),
          field('else_clause', optional($.else_clause)),
        ),
      ),

    elseif_clauses: ($) => prec.left(repeat1($.elseif_clause)),

    elseif_clause: ($) =>
      seq(
        reservedWord('elseif'),
        '(',
        field('condition', $.pipeline),
        ')',
        $.statement_block,
      ),

    else_clause: ($) => seq(reservedWord('else'), $.statement_block),

    _labeled_statement: ($) =>
      choice(
        $.switch_statement,
        $.foreach_statement,
        $.for_statement,
        $.while_statement,
        $.do_statement,
      ),

    switch_statement: ($) =>
      seq(
        reservedWord('switch'),
        optional($.switch_parameters),
        $.switch_condition,
        $.switch_body,
      ),

    switch_parameters: ($) => repeat1($.switch_parameter),

    switch_parameter: ($) =>
      choice(
        reservedWord('-regex'),
        reservedWord('-wildcard'),
        reservedWord('-exact'),
        reservedWord('-casesensitive'),
        reservedWord('-parallel'),
      ),

    switch_condition: ($) =>
      choice(
        seq('(', $.pipeline, ')'),
        seq(reservedWord('-file'), $.switch_filename),
      ),

    switch_filename: ($) => choice($._command_token, $._primary_expression),

    switch_body: ($) => seq('{', optional($.switch_clauses), '}'),

    switch_clauses: ($) => repeat1($.switch_clause),

    switch_clause: ($) =>
      seq(
        $.switch_clause_condition,
        $.statement_block,
        $._statement_terminator,
        repeat(';'),
      ),

    switch_clause_condition: ($) =>
      choice($._command_token, $._primary_expression),

    foreach_statement: ($) =>
      seq(
        reservedWord('foreach'),
        optional($.foreach_parameter),
        '(',
        $.variable,
        reservedWord('in'),
        $.pipeline,
        ')',
        $.statement_block,
      ),

    foreach_parameter: ($) => choice(reservedWord('-parallel')),

    for_statement: ($) =>
      seq(
        reservedWord('for'),
        '(',
        optional(
          seq(
            optional(
              seq(
                field('for_initializer', $.for_initializer),
                $._statement_terminator,
              ),
            ),
            optional(
              seq(
                choice(';', token.immediate(/\r?\n/)),
                optional(
                  seq(
                    field('for_condition', $.for_condition),
                    $._statement_terminator,
                  ),
                ),
                optional(
                  seq(
                    choice(';', token.immediate(/\r?\n/)),
                    optional(
                      seq(
                        field('for_iterator', $.for_iterator),
                        $._statement_terminator,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        ')',
        $.statement_block,
      ),

    for_initializer: ($) => $.pipeline,

    for_condition: ($) => $.pipeline,

    for_iterator: ($) => $.pipeline,

    while_statement: ($) =>
      seq(
        reservedWord('while'),
        '(',
        field('condition', $.while_condition),
        ')',
        $.statement_block,
      ),

    while_condition: ($) => $.pipeline,

    do_statement: ($) =>
      seq(
        reservedWord('do'),
        $.statement_block,
        choice(reservedWord('while'), reservedWord('until')),
        '(',
        field('condition', $.while_condition),
        ')',
      ),

    function_statement: ($) =>
      seq(
        choice(
          reservedWord('function'),
          reservedWord('filter'),
          reservedWord('workflow'),
        ),
        $.function_name,
        optional($.function_parameter_declaration),
        '{',
        optional($.script_block),
        '}',
      ),

    function_name: ($) => $._command_token,

    function_parameter_declaration: ($) =>
      seq('(', optional($.parameter_list), ')'),

    flow_control_statement: ($) =>
      choice(
        seq(reservedWord('break'), optional($.label_expression)),
        seq(reservedWord('continue'), optional($.label_expression)),
        seq(reservedWord('throw'), optional($.pipeline)),
        seq(reservedWord('return'), optional($.pipeline)),
        seq(reservedWord('exit'), optional($.pipeline)),
      ),

    label: ($) => token(seq(':', /[a-zA-Z_][a-zA-Z0-9_]*/)),

    label_expression: ($) => choice($.label, $.unary_expression),

    trap_statement: ($) =>
      seq(reservedWord('trap'), optional($.type_literal), $.statement_block),

    try_statement: ($) =>
      seq(
        reservedWord('try'),
        $.statement_block,
        choice(
          seq($.catch_clauses, optional($.finally_clause)),
          optional($.finally_clause),
        ),
      ),

    catch_clauses: ($) => repeat1($.catch_clause),

    catch_clause: ($) =>
      seq(
        reservedWord('catch'),
        optional($.catch_type_list),
        $.statement_block,
      ),

    catch_type_list: ($) =>
      seq($.type_literal, repeat(seq(',', $.type_literal))),

    finally_clause: ($) => seq(reservedWord('finally'), $.statement_block),

    data_statement: ($) =>
      seq(
        reservedWord('data'),
        optional($.data_name),
        optional($.data_commands_allowed),
        $.statement_block,
      ),

    data_name: ($) => $.simple_name,

    data_commands_allowed: ($) =>
      seq(reservedWord('-supportedcommand'), $.data_commands_list),

    data_commands_list: ($) =>
      seq($.data_command, repeat(seq(',', $.data_command))),

    data_command: ($) => $.command_name_expr,

    inlinescript_statement: ($) =>
      seq(reservedWord('inlinescript'), $.statement_block),

    parallel_statement: ($) => seq(reservedWord('parallel'), $.statement_block),

    sequence_statement: ($) => seq(reservedWord('sequence'), $.statement_block),

    pipeline: ($) =>
      choice(
        $.assignment_expression,
        seq(
          $.pipeline_chain,
          repeat(seq($.pipeline_chain_tail, $.pipeline_chain)),
        ),
      ),

    pipeline_chain: ($) =>
      choice(
        seq(
          $._expression,
          optional($.redirections),
          optional($._pipeline_tail),
        ),
        seq(
          $.command,
          optional($.verbatim_command_argument),
          optional($._pipeline_tail),
        ),
      ),

    pipeline_chain_tail: ($) => choice('&&', '||'),

    // Distinct a normal expression to a left assignement expession
    left_assignment_expression: ($) => $._expression,

    assignment_expression: ($) =>
      seq(
        $.left_assignment_expression,
        $.assignement_operator,
        field('value', $._statement),
      ),

    _pipeline_tail: ($) => repeat1(seq('|', $.command)),

    command: ($) =>
      choice(
        seq(
          field('command_name', $.command_name),
          field('command_elements', optional($.command_elements)),
        ),
        seq(
          $.command_invokation_operator,
          // optional($.command_module),
          field('command_name', $.command_name_expr),
          field('command_elements', optional($.command_elements)),
        ),
      ),

    command_invokation_operator: ($) => choice('.', '&'),

    // This rule is ignored as it does not appear as a rule
    // command_module: $ => $.primary_expression,

    _expandable_string_literal_immediate: ($) =>
      seq(
        repeat(
          choice(
            /[^\$"`]+/,
            $.variable,
            /\$`(.{1}|`\r?\n)/,
            /`.{1}|`\r?\n/,
            '""',
            $.sub_expression,
          ),
        ),
        repeat('$'),
        '"',
      ),

    _string_literal_immediate: ($) =>
      seq(
        /[^']+/,
        '\'',
      ),

    command_name: ($) =>
      seq(
        choice(
          /[^\{\}\(\);,\|\&`"'\s\r\n\[\]\+\-\*\/\$@<\!]+/,
          // tree-sitter does not allow to control lexer
          // each start keyword into _statement rule must be present here
          // https://github.com/airbus-cert/tree-sitter-powershell/issues/24
          new RegExp(caseInsensitive('break-')),
          new RegExp(caseInsensitive('continue-')),
          new RegExp(caseInsensitive('throw-')),
          new RegExp(caseInsensitive('return-')),
          new RegExp(caseInsensitive('exit-')),
          new RegExp(caseInsensitive('try-')),
          new RegExp(caseInsensitive('trap-')),
          new RegExp(caseInsensitive('if-')),
          new RegExp(caseInsensitive('function-')),
          new RegExp(caseInsensitive('filter-')),
          new RegExp(caseInsensitive('workflow-')),
          new RegExp(caseInsensitive('class-')),
          new RegExp(caseInsensitive('enum-')),
          new RegExp(caseInsensitive('switch-')),
          new RegExp(caseInsensitive('for-')),
          new RegExp(caseInsensitive('while-')),
          new RegExp(caseInsensitive('parallel-')),
        ),
        repeat(
          choice(
            token.immediate(/[^\{\}\(\);,\|\&"'\s\r\n]+/),
            seq(token.immediate('"'), $._expandable_string_literal_immediate),
            seq(token.immediate('\''), $._string_literal_immediate),
            token.immediate('""'),
            token.immediate('\'\''),
          ),
        ),
      ),

    // G12 (M60 #278): the forward SLASH, which the class was missing.
    //
    // `path_command_name` is `repeat1(choice(path_command_name_token, variable))` and
    // the token class allowed `\` but not `/`, so a Windows path parsed and a POSIX one
    // could not: `/usr/bin/pwsh` lexed as `usr`, `/`, `bin`, `/`, `pwsh` with no rule
    // able to consume a separator. Measured before patching:
    //
    //     & /usr/bin/pwsh      3 ERROR      <- literal POSIX path
    //     & $D/pwsh            3 ERROR      <- variable-prefixed
    //     & $D                 ok          <- variable alone
    //     & $D -x              ok          <- variable then a flag
    //     & pwsh -x            ok          <- bare command then a flag
    //     $a/$b                ok          <- DIVISION, which must stay division
    //     cd /tmp/x            ok          <- a path as a command ARGUMENT, already fine
    //
    // So the class was correct for the language it was written for and wrong for the
    // other one, which is why the battery's name (`var-prefixed-path`) pointed at the
    // wrong thing: it is not about variables, it is about slashes. A literal POSIX path
    // fails identically, and the battery name has been corrected with the class.
    //
    // Safe for division: `path_command_name` is reachable only from `command_name_expr`,
    // which is reachable only after a `command_invokation_operator` (`&` or `.`), so
    // the binary-operator route that reads `$a/$b` as division is not in scope here.
    path_command_name_token: ($) => /[0-9a-zA-Z_?\-\.\\\/]+/,

    // Use to parse command path
    path_command_name: ($) =>
      repeat1(choice($.path_command_name_token, $.variable)),

    command_name_expr: ($) =>
      choice($.command_name, $.path_command_name, $._primary_expression),

    command_elements: ($) => prec.right(repeat1($._command_element)),

    // G6 (M60 #278): a command argument list whose values include a BARE WORD.
    //
    // The class is not "comma-separated lists" in general, and measuring which is
    // the whole content of this patch. In the pinned grammar:
    //
    //   Write-Output -Type 'deb', 'rpm'   ok    (string_literal)
    //   Write-Output $a, $b              ok    (variable)
    //   Write-Output (1), (2)            ok    (integer_literal)
    //   Write-Output -Type 1, 2           ok    (integer_literal)
    //   Write-Output -Type deb, rpm       BROKEN 2e   (generic_token)
    //
    // `array_literal_expression` is `prec.left(seq($.unary_expression, repeat(seq(',', $.unary_expression))))`
    // — and a BARE WORD is not reachable as a `unary_expression`. So every value
    // kind PowerShell accepts in a list works except the one that matters most in
    // command position, where an unquoted word is a command name or a bare
    // argument. `Export-ModuleMember -Function 'A', 'B'` already worked, which is
    // why the module surface looked fine; `Export-ModuleMember A, B` did not.
    //
    // WHY THIS FORM AND NOT A COMMA ELEMENT, which is what the first attempt used.
    // That version was a bare `seq(',', tail)` among the `_command_element`
    // alternatives, and it stole the comma from INSIDE `array_literal_expression`:
    // a two-element array became a one-element array plus an orphan literal. The
    // error count did not move (0 before, 0 after) and neither did the analyzer's
    // output, so only F11's G2 s-expression comparison saw it. `prec(-1)` on the
    // comma element did not help, because it was never a precedence tie.
    //
    // THIS FORM CANNOT DO THAT, and the reason is structural rather than a matter
    // of tuning: the deciding token is different. Every element of an
    // `array_literal_expression` is a `unary_expression`, and every element of this
    // rule is a `generic_token`, so on the very first token of a list element the
    // two rules are DISJOINT — the comma that this rule consumes is one the array
    // rule could never have used. That is what "cannot compete" means, and it is why
    // the earlier `prec` attempt failed and this one does not need a `prec` at all.
    //
    // It also does not overlap the single-value form: this alternative REQUIRES a
    // comma, so `-Type deb` still parses through the existing
    // `seq(command_argument_sep, optional(generic_token))` and no conflict is
    // declared. The patch is one alternative, additive, and touches no existing rule.
    _command_element: ($) =>
      prec.right(
        choice(
          $.command_parameter,
          // G10 (M60 #278), THIRD design — and the first with no second TOKEN in it.
          //
          // Attempt 1 added a `_glued_command_parameter` token with `token(prec(1, …))`;
          // F11 returned INADMISSIBLE with 274 clean files re-shaped, because
          // tree-sitter resolves LEXICAL precedence BEFORE length, so the glued token
          // beat `command_parameter` even when shorter and split `--flag=alnum` — clean
          // today, since `command_parameter` matches it whole — into two children
          // across the corpus. Attempt 2 dropped the precedence and cannot work either:
          // two tokens matching the SAME text at the SAME length is unresolvable by
          // precedence or by length, and `--a=1 --b=2` measured 2 ERROR where the
          // pinned grammar had one SILENT MISSING.
          //
          // This is a PARSER rule, not a lexing one. `command_parameter` is untouched,
          // which is the whole point: with no second token, `--flag=alnum` cannot change
          // shape, because nothing about the lexer moved. The new alternative is
          // `command_parameter` followed IMMEDIATELY by a value with no
          // `command_argument_sep` — the one shape the existing argument path cannot
          // express, because every value alternative in `_command_argument` begins with
          // a separator and a glued value has none.
          //
          // Without it the value is STOLEN, not merely unparsed: `redirection` wins it
          // and the tree becomes a fabricated redirection with a MISSING ">", which is
          // invisible to every ERROR-keyed gate in the project. Every value kind listed
          // here is currently DAMAGED that way, so the alternative can only fire where
          // the tree is already wrong.
          //
          // Measured: 691 corpus files, 0 clean files changed shape, 7 newly clean, 0
          // newly broken. `generic_token` is deliberately absent — `--flag=alnum` is
          // CLEAN today because `command_parameter` matches the whole token, so
          // admitting it as a glued value would split that clean node into two.
          seq($.command_parameter, choice($._literal, $.variable)),
          seq($._command_argument, optional($.argument_list)),
          $.redirection,
          $.stop_parsing,
          seq(
            $.command_argument_sep,
            $.generic_token,
            ',',
            $.generic_token,
            repeat(seq(',', $.generic_token)),
          ),
        ),
      ),

    // Stop parsing is a token that end the parsing of command line
    stop_parsing: ($) => /--%[^\r\n]*/,

    // Generic token is hard to manage
    // So a definition is that a generic token must have to begin by one or more space char
    command_argument_sep: ($) => prec.right(choice(repeat1(' '), ':')),

    // Adapt the grammar to have same behavior

    // G7 (M60 #278): a command ARGUMENT that is a variable-prefixed path.
    //
    // MEASURED, and it is the largest remaining class: 1,002 sites in 155 files in
    // `powershell` and 81 sites in 15 in `ansible` — 1,083 in 170 files, 2.6x the
    // next class. The battery named it "backslash paths", which is wrong: `\` and
    // `/` fail IDENTICALLY, and `Import-Module $PSScriptRoot` alone parses clean, so
    // the class is neither about backslashes nor about paths as such.
    //
    // THE DECIDING TOKEN, which is the whole content of this patch.
    // `generic_token` is
    //   token(/[^\(\)\$\"'\-\{\}@\|\[`\&\s][^\&\s\(\)\}\|;,]*/)
    // and the asymmetry is the bug: the CONTINUATION class allows `/` and `\`, but
    // the FIRST-character class excludes `$`. So `$a/b` cannot be one token — `$a`
    // lexes as a variable and `/b` as something else — while `a/b` (no sigil) lexes
    // as one `generic_token` perfectly. In PowerShell `$PSScriptRoot/x` is a single
    // path argument, so the sigil is exactly what has to be allowed to lead.
    //
    // WHY A NEW TOKEN AND NOT A WIDER `generic_token`. Widening the shared class
    // would change the token in EVERY position, including the right-hand side of an
    // assignment, where `$a/$b` is DIVISION and already parses correctly. This
    // token is declared only inside `_command_argument`, and tree-sitter's lexer is
    // driven by parse state, so it can only be produced where a command argument is
    // expected. `$x = $a/$b` goes through `assignment_expression`, a different rule,
    // and is untouched by construction rather than by precedence — the same
    // structural argument that made the admitted G6 form safe after the rejected one
    // was not.
    //
    // Verified before patching, in argument position: `$a/b` BROKEN, `$a\b` BROKEN,
    // `${a}/b` BROKEN, `$($a)/b` BROKEN, `($a)/b` BROKEN, and `"$a/b"` ok (quoted, so
    // it is an expandable string). At statement start and as a command name the same
    // text is also broken, which is left alone on purpose: this patch is scoped to
    // argument position because that is where the 1,002 corpus sites are, and every
    // extra position is extra regression surface for a lexer change.
    _command_argument: ($) =>
      prec.right(
        PREC.PARAM,
        choice(
          seq(
            $.command_argument_sep,
            optional(choice($.generic_token, alias($._path_argument, $.generic_token))),
          ),
          seq($.command_argument_sep, $.array_literal_expression),
          $.parenthesized_expression,
          $.script_block_expression,
        ),
      ),

    // A sigil-led path argument. The sigil, then an optional drive/scope prefix,
    // then at least one path SEPARATOR followed by a path segment — the separator
    // is required, so `$a` alone still lexes as an ordinary `variable` and this
    // token cannot compete with it. The segment class stops at everything that can
    // end an argument (`;` `&` `|` `,` whitespace quotes brackets), so the token
    // cannot swallow structure.
    // TWO properties this token needs, and the first version of the patch had
    // neither, which is why it looked like a success and was not one.
    //
    // PRECEDENCE 2, because the `variable` token is `reserved(...)` and so carries
    // `prec(1)`; at equal-or-lower precedence the shorter variable token wins and
    // the path is split. That is why `$a/b` "parsed" while `$PSScriptRoot\..\..\x`
    // did not — two separators is where the length advantage stopped being enough.
    //
    // ALIASED TO `generic_token`, because a HIDDEN token produces no node. The first
    // version left it hidden, and the result was the worst failure this lane has
    // produced: `Write-Output $a/b` reported 0 ERROR nodes and the tree was
    // `command_elements: (command_argument_sep)` — the argument was silently
    // GONE. A parse error is visible and a dropped node is not, so the micro-repro
    // read `ok` and would have been believed; it was caught only by printing the
    // tree instead of the error count. An argument that lexes into nothing is a
    // fabrication in the opposite direction from the ones this lane hunts.
    _path_argument: ($) =>
      prec(
        2,
        token(
        seq(
          // sigil, name, and an OPTIONAL SCOPE — `$env:ProgramFiles/x` is one of
          // the commonest variable-prefixed paths in the corpus and the first
          // version of this regex rejected it, which a corpus grep found and a
          // regex unit test then confirmed in one pass. The scope is the same
          // `[A-Za-z0-9_]+:` shape the grammar's own `variable` token accepts, so
          // the two agree on what a scoped variable is.
          /[$@][A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?/,
          optional(/[A-Za-z]:/),
          // ONE OR MORE (separator, segment) pairs. The first version alternated a
          // single segment against a run that had to END on a separator, so a path
          // whose last character is a segment — which is every real path — matched
          // only its first segment and the remainder fell out as ERROR nodes. The
          // segment body excludes `;` `&` `|` `,` whitespace `(` `)` and quotes, so
          // the token cannot swallow structure; verified against `$a/b;c`, `$a/b&c`,
          // `$a/b|c`, `$a/b,c`, `$a/b c` and `$a/b)`, all of which stop at the
          // delimiter.
          repeat1(seq(/[\\/]/, /[A-Za-z0-9_.\-\[\]]+/)),
          // An OPTIONAL TRAILING SEPARATOR, and this is the fix for a real,
          // measured loss rather than a refinement. A directory argument ends in a
          // separator — `$testDataPath\UserConfigProv\` — and without this the
          // token matched only the PREFIX `$testDataPath\UserConfigProv`, leaving
          // the final `\` orphaned, which broke the whole command and cost 11 REAL
          // cmdlet calls in one Pester file
          // (Microsoft.PowerShell.Security/FileCatalog.Tests.ps1: lines 318, 338,
          // 357, 384, 392 and neighbours — `New-FileCatalog`/`Test-FileCatalog`,
          // verified by running the analyzer under both grammars: 40 such calls
          // under the pinned grammar, 29 under the candidate, all still owned by
          // the file, so they are genuinely GONE and not re-attributed).
          //
          // It works because tree-sitter's lexer takes the LONGEST match: adding the
          // optional separator makes the token one character longer at exactly the
          // position where the bare variable used to win, so the whole path is
          // consumed instead of a prefix of it. The regex was checked in isolation
          // first — against `$a/b`, `$a\b`, a trailing-separator directory, a
          // `..` chain, a scoped `$env:` path, a drive, and termination at space,
          // `;` `,`, `|` and `&` — because a lexer change costs ten minutes per
          // attempt and a regex costs seconds.
          optional(/[\\/]/),
        ),
        ),
      ),

    verbatim_command_argument: ($) =>
      seq('--%', $._verbatim_command_argument_chars),

    redirections: ($) => repeat1($.redirection),

    redirection: ($) =>
      choice(
        $.merging_redirection_operator,
        seq($.file_redirection_operator, $.redirected_file_name),
      ),

    redirected_file_name: ($) =>
      choice($._command_argument, $._primary_expression),

    // Class
    class_attribute: ($) =>
      choice(token(reservedWord('hidden')), token(reservedWord('static'))),

    class_property_definition: ($) =>
      seq(
        optional($.attribute),
        repeat($.class_attribute),
        optional($.type_literal),
        $.variable,
        optional(seq('=', $._expression)),
      ),

    class_method_parameter: ($) => seq(optional($.type_literal), $.variable),

    class_method_parameter_list: ($) =>
      seq($.class_method_parameter, repeat(seq(',', $.class_method_parameter))),

    class_method_definition: ($) =>
      seq(
        optional($.attribute),
        repeat($.class_attribute),
        optional($.type_literal),
        $.simple_name,
        '(',
        optional($.class_method_parameter_list),
        ')',
        '{',
        optional($.script_block),
        '}',
      ),

    class_statement: ($) =>
      seq(
        token(reservedWord('class')),
        $.simple_name,
        optional(seq(':', $.simple_name, repeat(seq(',', $.simple_name)))),
        '{',
        repeat(
          choice(
            seq(
              $.class_property_definition,
              $._statement_terminator,
              repeat(';'),
            ),
            $.class_method_definition,
          ),
        ),
        '}',
      ),

    // Enums
    enum_statement: ($) =>
      seq(
        token(reservedWord('enum')),
        $.simple_name,
        '{',
        repeat(seq($.enum_member, $._statement_terminator, repeat(';'))),
        '}',
      ),

    enum_member: ($) =>
      seq($.simple_name, optional(seq('=', $.integer_literal))),

    // Expressions
    _expression: ($) => $._ternary_expression,

    // G5a (M60 #278): the null-coalescing operator `??`, added in PowerShell 7.0.
    //
    // MEASURED BEFORE PATCHING (script/m60/powershell-0264-repro-battery.ts, the
    // construct reduced to a minimal source with a control): `$a ?? $b` produces 3
    // ERROR nodes and does not parse, while the control `$a = $b ?? 'fallback'`
    // without the operator parses clean. Named limit `null-coalescing`, 1 corpus
    // file, from .github/actions/infrastructure/markdownlinks/Parse-MarkdownLink.ps1.
    //
    // PLACEMENT, from about_Operator_Precedence rather than from taste: `??` binds
    // LOOSER than -and/-or/-xor and TIGHTER than the ternary `? :`. So it sits
    // between the existing top level (logical_expression) and the new ternary
    // level, and it is its own level rather than another choice inside
    // logical_expression — putting it there would make it bind as tightly as
    // -and, and `$a -or $b ?? $c` would then parse as `($a -or $b) ?? $c` only by
    // accident of the left-associative fold.
    //
    // `??` is a single token and appears nowhere in the language otherwise, so this
    // is purely additive: no existing rule is edited and no existing token widens.
    // That is the property F11's G2 gate (every already-clean file must produce a
    // byte-identical s-expression) exists to confirm rather than assume.
    //
    // BOTH LEVELS ARE HIDDEN, and the first attempt at this patch got that wrong in
    // the most instructive way available. Named `ternary_expression` /
    // `coalesce_expression` scored a clean win on every count the battery reports —
    // 2 of 12 named limits fixed, 0 regressions, all 9 controls held — and the A/B's
    // collateral gate passed too, 0 files broken. It was still the wrong patch, and
    // only the SHAPE delta caught it: a named level emits its node in the
    // pass-through case as well, so adding two levels wrapped EVERY expression in
    // the language and produced 9,046 `coalesce_expression` and 9,038
    // `ternary_expression` nodes across 49 corpus files, silently re-pointing an
    // analyzer written against the old shapes. Hiding the levels makes the rule
    // inline, so an expression that uses neither operator produces exactly the tree
    // it produced before, and F11's G2 gate passes by construction rather than by
    // luck. The operators appear as anonymous tokens, which is the majority
    // convention in this grammar anyway: `+ - * / %` and `..` are all anonymous,
    // and only `comparison_operator` / `format_operator` are named.
    _ternary_expression: ($) =>
      prec.right(
        choice(
          $._coalesce_expression,
          seq($._coalesce_expression, '?', $._ternary_expression, ':', $._ternary_expression),
        ),
      ),

    _coalesce_expression: ($) =>
      prec.left(
        choice(
          $.logical_expression,
          seq($._coalesce_expression, '??', $.logical_expression),
        ),
      ),

    logical_expression: ($) =>
      prec.left(
        choice(
          $.bitwise_expression,
          seq(
            $.logical_expression,
            choice(
              reservedWord('-and'),
              reservedWord('-or'),
              reservedWord('-xor'),
            ),
            $.bitwise_expression,
          ),
        ),
      ),

    bitwise_expression: ($) =>
      prec.left(
        choice(
          $.comparison_expression,
          seq(
            $.bitwise_expression,
            choice(
              reservedWord('-band'),
              reservedWord('-bor'),
              reservedWord('-bxor'),
            ),
            $.comparison_expression,
          ),
        ),
      ),

    comparison_expression: ($) =>
      prec.left(
        choice(
          $.additive_expression,
          seq(
            $.comparison_expression,
            $.comparison_operator,
            $.additive_expression,
          ),
        ),
      ),

    additive_expression: ($) =>
      prec.left(
        choice(
          $.multiplicative_expression,
          seq(
            $.additive_expression,
            choice('+', '-'),
            $.multiplicative_expression,
          ),
        ),
      ),

    multiplicative_expression: ($) =>
      prec.left(
        choice(
          $.format_expression,
          seq(
            $.multiplicative_expression,
            choice('/', '\\', '%', '*'),
            $.format_expression,
          ),
        ),
      ),

    format_expression: ($) =>
      prec.left(
        choice(
          $.range_expression,
          seq($.format_expression, $.format_operator, $.range_expression),
        ),
      ),

    range_expression: ($) =>
      prec.left(
        choice(
          $.array_literal_expression,
          seq($.range_expression, '..', $.array_literal_expression),
        ),
      ),

    array_literal_expression: ($) =>
      prec.left(seq($.unary_expression, repeat(seq(',', $.unary_expression)))),

    unary_expression: ($) =>
      prec.right(
        choice($._primary_expression, $.expression_with_unary_operator),
      ),

    expression_with_unary_operator: ($) =>
      choice(
        seq(',', $.unary_expression),
        seq(reservedWord('-not'), $.unary_expression),
        seq('!', $.unary_expression),
        seq(reservedWord('-bnot'), $.unary_expression),
        seq('+', $.unary_expression),
        seq('-', $.unary_expression),
        $.pre_increment_expression,
        $.pre_decrement_expression,
        $.cast_expression,
        seq(reservedWord('-split'), $.unary_expression),
        seq(reservedWord('-join'), $.unary_expression),
      ),

    pre_increment_expression: ($) => seq('++', $.unary_expression),
    pre_decrement_expression: ($) => seq('--', $.unary_expression),

    cast_expression: ($) =>
      prec(PREC.CAST, seq($.type_literal, $.unary_expression)),

    attributed_variable: ($) => seq($.type_literal, $.variable),

    _primary_expression: ($) =>
      choice(
        $._value,
        $.member_access,
        $.element_access,
        $.invokation_expression,
        $.post_increment_expression,
        $.post_decrement_expression,
      ),

    _value: ($) =>
      choice(
        $.parenthesized_expression,
        $.sub_expression,
        $.array_expression,
        $.script_block_expression,
        $.hash_literal_expression,
        $._literal,
        $.type_literal,
        $.variable,
      ),

    parenthesized_expression: ($) => seq('(', $.pipeline, ')'),

    sub_expression: ($) =>
      seq('$(', field('statements', optional($.statement_list)), ')'),

    array_expression: ($) =>
      seq('@(', field('statements', optional($.statement_list)), ')'),

    script_block_expression: ($) =>
      seq('{', optional($.param_block), $.script_block, '}'),

    hash_literal_expression: ($) =>
      seq('@{', optional($.hash_literal_body), '}'),

    hash_literal_body: ($) => repeat1($.hash_entry),

    hash_entry: ($) =>
      seq(
        $.key_expression,
        '=',
        $._statement,
        $._statement_terminator,
        repeat(';'),
      ),

    key_expression: ($) => choice($.simple_name, $.unary_expression),

    post_increment_expression: ($) =>
      prec(PREC.UNARY, seq($._primary_expression, '++')),

    post_decrement_expression: ($) =>
      prec(PREC.UNARY, seq($._primary_expression, '--')),

    // G5c (M60 #278): the null-conditional operators `?.` and `?[`, added in
    // PowerShell 7.0. Like `??` and `? :`, the operators are ABSENT from the
    // grammar rather than mishandled by it, which is why the original list of four
    // grammar defects — built by reading the grammar — never mentioned them.
    //
    // MEASURED BEFORE PATCHING (script/m60/powershell-nullcond-repro.ts, 8 forms,
    // 11 controls): all 8 forms fail, `$a?.b` giving 2 ERROR + 1 MISSING, and 10
    // of 11 controls parse clean. The corpus target is the PowerShell repo's own
    // test/powershell/Language/Operators/NullConditional.Tests.ps1, and the
    // FORMS are taken from that file rather than from the language documentation,
    // because the documentation and the corpus disagree on one of them: the
    // element-access operator is `?[`, not `?.[`. The corpus also uses `?.`
    // chained (`${psObj}?.name?.nonExistent`), `?.` on a parenthesised command
    // (`(Get-Item $TestDrive)?.EnumerateFiles()?.Name`), and `?.` on a static
    // member (`[int32]::MaxValue?.ToString()`), so the operator has to be
    // left-associative and composable with invocation, not a one-off.
    //
    // PRECEDENCE, from the language's own definition: `?.` binds exactly like `.`
    // and `?[` exactly like `[`, so each null-conditional arm is added INSIDE the
    // rule that already defines its twin and inherits its associativity, rather
    // than as a new level. That is also what keeps `${psObj}?.name?.nonExistent`
    // working: `member_access` is already `prec.left` over `_primary_expression`,
    // so the second `?.` binds to the first arm's result.
    //
    // The tokens are `token.immediate` for the same reason the `.` in
    // `member_access` is: `?.` must not be recognised across whitespace, or
    // `$c ? .5 : 1.5` would silently become a null-conditional. The one genuine
    // ambiguity is `$c?[1,2] : $y` written with no space, which this grammar now
    // reads as null-conditional indexing — which is what PowerShell itself does,
    // so the ambiguity is resolved the way the language resolves it rather than
    // invented here. `$c ?[1,2] : $y` (spaced) is unaffected, and F11's G2
    // identity gate over the clean corpus is what confirms no real file relied on
    // the other reading.
    member_access: ($) =>
      prec.left(
        choice(
          seq($._primary_expression, token.immediate('.'), $.member_name),
          seq($._primary_expression, '::', $.member_name),
          seq($._primary_expression, token.immediate('?.'), $.member_name),
        ),
      ),

    member_name: ($) =>
      choice(
        $.simple_name,
        $.string_literal,
        $.expression_with_unary_operator,
        $._value,
      ),

    element_access: ($) =>
      choice(
        prec(
          PREC.ELEMENT_ACCESS,
          seq($._primary_expression, '[', $._expression, ']'),
        ),
        prec(
          PREC.ELEMENT_ACCESS,
          seq($._primary_expression, token.immediate('?['), $._expression, ']'),
        ),
      ),

    invokation_expression: ($) =>
      choice(
        seq(
          $._primary_expression,
          token.immediate('.'),
          $.member_name,
          $.argument_list,
        ),
        seq($._primary_expression, '::', $.member_name, $.argument_list),
        seq(
          $._primary_expression,
          token.immediate('?.'),
          $.member_name,
          $.argument_list,
        ),
        $.invokation_foreach_expression,
      ),

    // adding this rule to handle .foreach synthax
    invokation_foreach_expression: ($) =>
      seq(
        $._primary_expression,
        token.immediate(reservedWord('.foreach')),
        $.script_block_expression,
      ),

    argument_list: ($) =>
      seq(
        '(',
        field('argument_expression_list', optional($.argument_expression_list)),
        ')',
      ),

    argument_expression_list: ($) =>
      prec.left(
        seq($.argument_expression, repeat(seq(',', $.argument_expression))),
      ),

    argument_expression: ($) => $.logical_argument_expression,

    logical_argument_expression: ($) =>
      prec.left(
        choice(
          $.bitwise_argument_expression,
          seq(
            $.logical_argument_expression,
            choice(
              reservedWord('-and'),
              reservedWord('-or'),
              reservedWord('-xor'),
            ),
            $.bitwise_argument_expression,
          ),
        ),
      ),

    bitwise_argument_expression: ($) =>
      prec.left(
        choice(
          $.comparison_argument_expression,
          seq(
            $.bitwise_argument_expression,
            choice(
              reservedWord('-and'),
              reservedWord('-or'),
              reservedWord('-xor'),
            ),
            $.comparison_argument_expression,
          ),
        ),
      ),

    comparison_argument_expression: ($) =>
      prec.left(
        choice(
          $.additive_argument_expression,
          seq(
            $.comparison_argument_expression,
            $.comparison_operator,
            $.additive_argument_expression,
          ),
        ),
      ),

    additive_argument_expression: ($) =>
      prec.left(
        choice(
          $.multiplicative_argument_expression,
          seq(
            $.additive_argument_expression,
            choice('+', '-'),
            $.multiplicative_argument_expression,
          ),
        ),
      ),

    multiplicative_argument_expression: ($) =>
      prec.left(
        choice(
          $.format_argument_expression,
          seq(
            $.multiplicative_argument_expression,
            choice('/', '\\', '%', '*'),
            $.format_argument_expression,
          ),
        ),
      ),

    format_argument_expression: ($) =>
      prec.left(
        choice(
          $.range_argument_expression,
          seq(
            $.format_argument_expression,
            $.format_operator,
            $.range_argument_expression,
          ),
        ),
      ),

    range_argument_expression: ($) =>
      prec.left(
        choice(
          $.unary_expression,
          seq($.range_argument_expression, '..', $.unary_expression),
        ),
      ),

    type_literal: ($) => seq('[', $.type_spec, ']'),

    type_spec: ($) =>
      choice(
        seq($.array_type_name, optional($.dimension), ']'),
        seq($.generic_type_name, $.generic_type_arguments, ']'),
        $.type_name,
      ),

    dimension: ($) => repeat1(','),

    // G9 (M60 #278): a generic ARGUMENT may be a bracketed type, which is how
    // PowerShell and C# both write an array-of-X type argument:
    // `Dictionary[[string],[int]]`.
    //
    // The gap is structural rather than a missing alternative, which is why three
    // earlier attempts failed and two of them failed silently. `generic_type_arguments`
    // took a `type_spec`, and a `type_spec` can only express the SUFFIX array form
    // (`string[]`, via `array_type_name`) — the leading `[` of a `type_literal` has
    // nowhere to go. So `[Dictionary[[string],[int]]]` had no derivation at all, and
    // the parser reached for the only route it had (`array_type_name` on
    // `Dictionary[`) and then failed, producing
    // `ERROR(array_type_name(Dictionary[))` with the rest of the line falling out as
    // a separate expression.
    //
    // Adding `type_literal` as an argument is additive and does not overlap the
    // existing form: the two are disjoint on the FIRST token of the argument, since
    // `type_literal` opens with `[` and a bare `type_spec` does not. That is the same
    // disjointness argument that made the admitted G6 and G7 forms safe, and it is
    // why no conflict declaration is needed — tree-sitter confirms none is.
    //
    // Measured before patching: `[Dictionary[[string],[int]]]` 2 ERROR,
    // `[Dictionary[[string]]]` 1 MISSING, and every control already clean
    // (`[Dictionary[string[]]]`, `[List[string]]`, `[Dictionary[string,int]]::new()`,
    // `[System.Environment+SpecialFolder]`). Corpus footprint: 28 sites in 5 files in
    // `powershell` and 10 in 3 in `ansible`.
    generic_type_arguments: ($) =>
      seq(
        choice($.type_spec, $.type_literal),
        repeat(seq(',', choice($.type_spec, $.type_literal))),
      ),

    // Attributes
    attribute_list: ($) => repeat1($.attribute),

    attribute: ($) =>
      choice(
        seq(
          '[',
          $.attribute_name,
          '(',
          optional($.attribute_arguments),
          ')',
          ']',
        ),
        $.type_literal,
      ),

    attribute_name: ($) => $.type_spec,

    attribute_arguments: ($) =>
      seq($.attribute_argument, repeat(seq(',', $.attribute_argument))),

    attribute_argument: ($) =>
      choice(
        $._expression,
        seq($.simple_name, optional(seq('=', $._expression))),
      ),
  },
});

// inspired from https://github.com/tree-sitter/tree-sitter/issues/261
/**
 * Creates a rule to match a case insensitive reserved keyword
 *
 * @param {string} word
 */
function reservedWord(word) {
  // return word // when debuging
  return alias(reserved(caseInsensitive(word)), word);
}

/**
 * Create a reserved regex keyword
 *
 * @param {regex} regex
 */
function reserved(regex) {
  return prec(PREC.KEYWORD, new RegExp(regex));
}

/**
 * Return case insensitive regex for a word
 *
 * @param {string} word
 */
function caseInsensitive(word) {
  return word
    .split('')
    .map((letter) => `[${letter}${letter.toUpperCase()}]`)
    .join('');
}
