/**
 * @file Objective-C grammar for tree-sitter
 * @author Amaan Qureshi <amaanq12@gmail.com>
 * @license MIT
 */


/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Provenance: inherits the C grammar. It must be the UPSTREAM tree-sitter-c
// (declared in package.json), NOT this repo's vendored `grammars/tree-sitter-c`
// — that copy carries the #743 `macro_prefixed_type_specifier` rule, which is
// not co-live with objc's `generic_specifier`: generating against it fails with
// `Unresolved conflict: '^' identifier identifier • '<'` (`NSArray<NSString *>`
// against `A B` read as macro-decorated type). Inheriting the c fix for objc is
// therefore its own wave, not this one.
const C = require('tree-sitter-c/grammar');

// Welcome to Hell
module.exports = grammar(C, {
  name: 'objc',

  extras: $ => [
    /\u00A0|\s|\\\r?\n/,
    $.comment,
  ],

  conflicts: ($, original) => original.filter(
    (e) => !(e.length == 2 && e[0].name == 'type_qualifier' && e[1].name == 'extension_expression'),
  ).concat([
    [$.enum_specifier],
    // Narrow and deliberate: a macro call's parenthesized arguments are ambiguous with a
    // function-declarator's parameter list in exactly one position tree-sitter names
    // (`IDENT ( args ) • {`, an identifier-headed declarator followed by a brace). Rather
    // than narrow the rule until the ambiguity disappears — which would mean teaching it
    // which brace bodies are enums, the guess this rule exists to avoid — the parser is told
    // to keep both readings alive and let the full lookahead decide. tree-sitter resolves
    // this with GLR, so the cost is ambiguity in one construct, not a wrong answer.
    [$.macro_enum_arguments],
    // The availability annotation is admissible at two points in one method declaration — the
    // selector/parameter loop and the trailing modifiers — and the parser cannot commit to
    // which until it has seen the `;`. Same shape as the conflict above and the same answer:
    // keep both readings alive and let the lookahead decide, rather than pick a precedence
    // before the token that settles it has been read.
    [$._method_trailing_modifiers],
    // `IDENT ( primitive_type )` is the same ambiguity from the struct-member admission of
    // `macro_enum_specifier`: the `(` may open this rule's arguments or a parenthesized type.
    // Resolved by lookahead, not precedence — a precedence answer must be chosen before the
    // parser has seen the `{` that actually decides it, which is the one case where guessing
    // is guaranteed wrong.
    [$.type_specifier, $.macro_enum_arguments],
    [$.expression, $.generic_specifier],
    [$._declarator, $.type_specifier, $.generic_specifier],
    [$._declarator, $.type_specifier, $.sized_type_specifier],
    [$.attribute, $.expression],
    [$.parameterized_arguments],
    [$.string_literal],
    [$.extension_expression, $.range_expression],
    [$.abstract_array_declarator, $.array_type_specifier],
    [$._type_definition_type],
  ]),

  inline: ($, original) => original.concat([
    $.method_selector,
    $.method_selector_no_list,
    $.keyword_selector,
    $.interface_declaration,
    $.typedefed_identifier,
    $.keyword_identifier,
  ]),

  supertypes: ($, original) => original.concat([
    $.specifier_qualifier,
  ]),

  rules: {
    _top_level_item: ($, original) => choice(
      original,
      $.class_declaration,
      $.class_interface,
      $.class_implementation,
      $.protocol_declaration,
      $.protocol_forward_declaration,
      $.module_import,
      $.compatibility_alias_declaration,
      $.preproc_undef,
      $.preproc_linemarker,
      $.macro_prefixed_objc_declaration,
    ),

    // `macro_prefixed_objc_declaration` belongs HERE as well as in `_top_level_item`, and its
    // absence was invisible until the corpus was measured at full size.
    //
    // tree-sitter-c builds `preproc_if` as `preprocIf('', $ => $._block_item)` — the body of a
    // file-scope `#if` is a list of BLOCK items, not top-level items. So registering the rule
    // in `_top_level_item` alone made it UNREACHABLE inside every conditional, and the failure
    // was not a small one: a bare macro line above an `@interface` inside `#if` fell through to
    // the grammar's default reading of a bare identifier (a `declaration` with a
    // `type_identifier`), which cannot continue, so the ERROR node it produced did not stop at
    // the macro — it extended to the next `@end`, 101 lines later, deleting the whole class.
    //
    // That is the shape of this lane's worst findings: a rule that is registered and correct,
    // unreachable from the position real code puts it in. It generates, it builds, it passes a
    // diff of the grammar file, and a fixture written without a surrounding `#if` proves it
    // works. sdwebimage wraps most of its headers in `#if SD_UIKIT || SD_MAC`, so the corpus
    // is where it finally showed up: 84 `@`-declaration errors across 16 files, all of them
    // downstream of this one missing registration.
    _block_item: ($, original) => choice(
      original,
      $.class_declaration,
      $.class_interface,
      $.class_implementation,
      $.protocol_declaration,
      $.protocol_forward_declaration,
      $.module_import,
      $.compatibility_alias_declaration,
      $.preproc_undef,
      $.preproc_linemarker,
      $.macro_prefixed_objc_declaration,
    ),

    function_definition: $ => seq(
      optional($.ms_call_modifier),
      $._declaration_specifiers,
      field('declarator', $._declarator),
      field('body', $.compound_statement),
    ),

    declaration: $ => seq(
      $._declaration_specifiers,
      commaSep1(prec.right(field('declarator', choice(
        seq($._declarator, optional($.gnu_asm_expression)),
        $.init_declarator,
        seq($.type_qualifier, $.identifier),
      )))),
      optional($._declaration_modifiers),
      ';',
    ),

    // TWO FORMS, because Apple's macro spelling has no trailing declarator at all: the name
    // lives inside the macro's arguments, so `typedef NS_ENUM(NSUInteger, Foo) { ... };`
    // ends at the body's `;`. Forcing that through the C form — whose declarator list is
    // `commaSep1`, i.e. at least ONE — cannot complete the typedef, and the resulting error
    // node does not stay local: it extends past the `};`, past the doc comment, past
    // `NS_ASSUME_NONNULL_BEGIN`, and swallows the `@interface` that follows. That is how a
    // rule written to REPAIR 470 ERROR nodes turned `AFSecurityPolicy.h` from 3 errors to 16
    // and deleted a whole class from the graph, and it is why the A/B diffs analyzer output
    // rather than trusting the error count to move in the right direction.
    //
    // The C form is left strict on purpose. Making `_type_definition_declarators` optional
    // everywhere would be a one-word change that also accepts `typedef int;`, and a grammar
    // weakened to let one real construct through is a grammar that will let phantoms through
    // somewhere else. The extra branch is narrow: one production, one shape.
    type_definition: $ => choice(
      seq(
        optional('__extension__'),
        optional($.ms_declspec_modifier),
        'typedef',
        optional($.attribute_specifier),
        optional($.ms_declspec_modifier),
        $._type_definition_type,
        $._type_definition_declarators,
        ';',
      ),
      seq(
        optional('__extension__'),
        optional($.ms_declspec_modifier),
        'typedef',
        field('type', alias($.macro_enum_specifier, $.enum_specifier)),
        optional($._declaration_modifiers),
        ';',
      ),
    ),

    _type_definition_type: $ => seq(
      repeat($.type_qualifier),
      optional($.attribute_specifier),
      field('type', $.type_specifier),
      optional($.ms_declspec_modifier),
      repeat($.type_qualifier),
    ),

    _type_definition_declarators: $ => seq(
      commaSep1(field('declarator', $._type_declarator)),
      optional($._declaration_modifiers),
    ),

    // Apple's trailing availability annotations are MACRO CALLS with nested parentheses,
    // commas and string literals, and they are routinely written across several lines:
    //
    //   API_DEPRECATED_WITH_REPLACEMENT("queryImageForKey:", macos(10.10, X), ios(8.0, X),
    //                                   tvos(9.0, X), watchos(2.0, X));
    //
    // C's `macro_type_specifier` covers `MACRO(type)` — one argument, type-shaped — and
    // `attribute_specifier` covers `[[...]]`, so neither reaches this shape. Measured on
    // sdwebimage's SDImageCacheDefine.h the gap was not cosmetic: the annotation trailed the
    // LAST parameter of a method declaration, the parse could not continue, and the ERROR node
    // it produced swallowed the enclosing `@protocol` whole — 83 lines, one protocol, deleted.
    // The same file twice (Core/ and include/) put 66 of the lane's 285 remaining errors here.
    //
    // The argument set is deliberately the four shapes these annotations actually use — a string
    // literal, a nested call, a bare identifier, a number — rather than a full expression, so
    // the rule cannot swallow an arbitrary comma-separated list and reinterpret it as an
    // annotation. It is admitted through `_declaration_modifiers` so it can trail a parameter,
    // a method declaration, or a field, which is where Apple puts it.
    availability_macro_specifier: $ => prec(1, seq(
      alias($.identifier, $.macro_specifier),
      '(',
      optional(commaSep1(choice(
        $.string_literal,
        $.call_expression,
        $.identifier,
        $.number_literal,
      ))),
      ')',
    )),

    // NOT here. The first attempt admitted `availability_macro_specifier` through this shared
    // hidden rule, which is the right-looking move — the annotation really does trail a
    // declaration — and it was a disaster over the corpus: 285 -> 14,710 ERROR nodes and
    // 17,642 relationships dropped, 239 of 329 files regressed. `_declaration_modifiers` sits in
    // every declaration and parameter position in the grammar, so at `prec(1)` a rule whose
    // arguments include a bare `identifier` outranks ordinary declarations almost everywhere:
    // `UIApplicationMain(argc, argv)` in `main.m` was read as an annotation, and the method
    // bodies that depended on that declaration were lost with it.
    //
    // The minimal case PASSED for this rule before the corpus was run, which is the point worth
    // keeping: `API_DEPRECATED_WITH_REPLACEMENT(...)` after a method parameter parsed cleanly,
    // in isolation, and was still unsound. A construct that fixes a real file can break 200, and
    // only a 329-file A/B says so. The rule is therefore admitted ONLY where Apple puts these
    // annotations — trailing a method selector or a method parameter.
    _declaration_modifiers: ($, original) => choice(
      original,
      $.availability_attribute_specifier,
      $.attribute_declaration,
    ),

    _method_trailing_modifiers: $ => choice(
      $._declaration_modifiers,
      $.availability_macro_specifier,
    ),

    _declaration_specifiers: $ => prec.right(seq(
      repeat($._declaration_modifiers),
      field('type', $.type_specifier),
      repeat($._declaration_modifiers),
    )),

    parameter_declaration: $ => seq(
      $._declaration_specifiers,
      optional(field('declarator', choice(
        seq($._declarator, optional($._declaration_modifiers)),
        $._abstract_declarator,
      ))),
    ),

    _non_case_statement: ($, original) => choice(
      ...original.members.filter(member => member.name !== 'seh_try_statement' && member.name !== 'seh_leave_statement'),
      $.try_statement,
      $.throw_statement,
      $.synchronized_statement,
      $.ms_asm_block,
    ),

    attribute: $ => seq(
      optional(seq(field('prefix', $.identifier), '::')),
      field('name', $.identifier),
      optional(seq('(', commaSep($.expression), ')')),
    ),

    attribute_declaration: $ => seq(
      '[',
      '[',
      commaSep1($.attribute),
      ']',
      ']',
    ),

    _expression_not_binary: ($, original) => choice(
      original,
      $.message_expression,
      $.selector_expression,
      $.available_expression,
      $.range_expression,
      $.block_literal,
      $.dictionary_literal,
      $.array_literal,
      $.at_expression,
      $.encode_expression,
      $.va_arg_expression,
      $.keyword_identifier,
    ),

    cast_expression: $ => prec(C.PREC.CAST, choice(
      seq(
        '(',
        field('type', choice($.type_descriptor, $.typeof_specifier, $.parameterized_arguments)),
        ')',
        field('value', $.expression),
      ),
      seq(choice('__real', '__imag'), field('value', $.expression)),
    )),

    argument_list: $ => seq(
      '(',
      choice(
        commaSep(choice(
          seq(optional($.type_qualifier), choice($.expression, $.typeof_specifier)),
          $.compound_statement,
        )),
        seq($._type_identifier, token.immediate('<'), commaSep1($.type_name), '>'),
        $.objc_bridge,
        $.availability,
      ),
      ')',
    ),

    objc_bridge: $ => seq(
      'objc_bridge_related',
      '(',
      $.expression,
      ',',
      optional(seq($.expression, ':')),
      ',',
      optional($.expression),
      ')',
    ),

    typeof_specifier: $ => seq(
      choice('__typeof__', '__typeof', 'typeof'),
      '(',
      choice($.expression, $.type_descriptor),
      ')',
    ),

    compound_statement: $ => seq(
      optional('@autoreleasepool'),
      '{',
      repeat($._block_item),
      '}',
    ),

    availability: $ => seq(
      'availability',
      '(',
      commaSep1(seq(
        $.identifier,
        optional(seq(
          '=',
          choice($.version, $.expression),
        )),
      )),
      ')',
    ),
    version: $ => prec.right(choice(
      $.platform,
      $.version_number,
      seq(
        $.platform,
        '(',
        commaSep1(choice($.number_literal, $.identifier)),
        ')',
      ),
    )),
    version_number: _ => /\d+([\._]\d+)*/,
    platform: _ => choice('ios', 'tvos', 'macos', 'macosx', 'watchos'),

    _declarator: ($, original) => prec.right(choice(
      ...original.members.filter(member => member.name !== 'attributed_declarator'),
      $.block_pointer_declarator,
    )),

    _abstract_declarator: ($, original) => choice(
      original,
      $.abstract_block_pointer_declarator,
    ),

    _field_declarator: ($, original) => choice(
      original,
      alias($.block_pointer_field_declarator, $.block_pointer_declarator),
    ),

    _type_declarator: $ => choice(
      alias($.pointer_type_declarator, $.pointer_declarator),
      alias($.function_type_declarator, $.function_declarator),
      alias($.array_type_declarator, $.array_declarator),
      alias($.parenthesized_type_declarator, $.parenthesized_declarator),
      alias($.block_pointer_type_declarator, $.block_pointer_declarator),
      $._type_identifier,
      alias(choice('signed', 'unsigned', 'long', 'short'), $.primitive_type),
      $.primitive_type,
    ),

    for_statement: ($, original) => choice(
      original,
      prec(1, seq(
        'for',
        '(',
        choice(
          seq($._declaration_specifiers, $._declarator),
          $.identifier,
        ),
        'in',
        $.expression,
        ')',
        $._non_case_statement,
      )),
    ),

    type_qualifier: (_, original) => prec.right(choice(
      original,
      'nullable',
      '_Complex',
      '_Nonnull',
      '_Nullable',
      '_Nullable_result',
      '_Null_unspecified',
      '__autoreleasing',
      '__block',
      '__bridge',
      '__bridge_retained',
      '__bridge_transfer',
      '__complex',
      '__const',
      '__imag',
      '__kindof',
      '__nonnull',
      '__nullable',
      '__ptrauth_objc_class_ro',
      '__ptrauth_objc_isa_pointer',
      '__ptrauth_objc_super_pointer',
      '__real',
      '__strong',
      '__unsafe_unretained',
      '__unused',
      '__weak',
    )),

    storage_class_specifier: (_, original) => choice(
      original,
      '__inline__',
      'CG_EXTERN',
      'CG_INLINE',
      'FOUNDATION_EXPORT',
      'FOUNDATION_EXTERN',
      'FOUNDATION_STATIC_INLINE',
      'IBOutlet',
      'IBInspectable',
      'IB_DESIGNABLE',
      'NS_INLINE',
      'NS_VALID_UNTIL_END_OF_SCOPE',
      'OBJC_EXPORT',
      'OBJC_ROOT_CLASS',
      'UIKIT_EXTERN',
    ),

    preproc_include: $ => seq(
      field('directive', choice(preprocessor('include'), preprocessor('import'))),
      field('path', choice(
        $.string_literal,
        $.system_lib_string,
        $.identifier,
        alias($.preproc_call_expression, $.call_expression),
      )),
      token.immediate(/\r?\n/),
    ),

    module_import: $ => seq(
      '@import',
      field('path', seq($.identifier, repeat(seq('.', $.identifier)))),
      ';',
    ),

    ...preprocIf('', $ => choice($._block_item, $.attribute_specifier, $.property_implementation)),
    ...preprocIf('_in_implementation_definition', $ => $.implementation_definition),
    ...preprocIf('_in_interface_declaration', $ => $.interface_declaration),
    ...preprocIf('_in_enumerator', $ => seq($.enumerator, ',')),

    preproc_undef: $ => seq(
      preprocessor('undef'),
      field('name', $.identifier),
      token.immediate(/\r?\n/),
    ),

    preproc_linemarker: $ => seq(
      '#',
      $.number_literal,
      field('filename', $.string_literal),
      optional(seq(
        field('row', $.number_literal),
        optional(field('column', $.number_literal)),
      )),
      token.immediate(/\r?\n/),
    ),

    _preproc_expression: ($, original) => choice(
      original,
      $.system_lib_string,
    ),

    preproc_params: $ => seq(
      token.immediate('('), commaSep(choice($.identifier, '...')), optional('...'), ')',
    ),

    attribute_specifier: $ => seq(
      choice('__attribute__', '__attribute'),
      '(',
      choice($.argument_list, seq('(', commaSep1(choice('noreturn', 'nothrow')), ')')),
      ')',
    ),

    availability_attribute_specifier: $ => choice(
      'NS_AUTOMATED_REFCOUNT_UNAVAILABLE',
      'NS_ROOT_CLASS',
      'NS_UNAVAILABLE',
      'NS_REQUIRES_NIL_TERMINATION',
      'CF_RETURNS_RETAINED',
      'CF_RETURNS_NOT_RETAINED',
      'DEPRECATED_ATTRIBUTE',
      'UI_APPEARANCE_SELECTOR',
      'UNAVAILABLE_ATTRIBUTE',
      seq(
        choice(
          'CF_FORMAT_FUNCTION',
          'NS_AVAILABLE',
          '__IOS_AVAILABLE',
          'NS_AVAILABLE_IOS',
          'API_AVAILABLE',
          'API_UNAVAILABLE',
          'API_DEPRECATED',
          'NS_ENUM_AVAILABLE_IOS',
          'NS_DEPRECATED_IOS',
          'NS_ENUM_DEPRECATED_IOS',
          'NS_FORMAT_FUNCTION',
          'DEPRECATED_MSG_ATTRIBUTE',
          '__deprecated_msg',
          '__deprecated_enum_msg',
          'NS_SWIFT_NAME',
          'NS_SWIFT_UNAVAILABLE',
          'NS_EXTENSION_UNAVAILABLE_IOS',
          'NS_CLASS_AVAILABLE_IOS',
          'NS_CLASS_DEPRECATED_IOS',
          '__OSX_AVAILABLE_STARTING',
        ),
        '(',
        commaSep1(choice(
          $.string_literal,
          $.concatenated_string,
          $.version,
          $.method_identifier,
          $.identifier,
          seq($.identifier, '(', optional($.method_identifier), ')'),
        )),
        ')',
      ),
    ),

    struct_specifier: $ => prec.right(seq(
      'struct',
      optional($.attribute_specifier),
      optional($.ms_declspec_modifier),
      choice(
        seq(
          field('name', $._type_identifier),
          field('body', optional($.field_declaration_list)),
        ),
        field('body', $.field_declaration_list),
      ),
      optional($.attribute_specifier),
    )),

    enum_specifier: $ => seq(
      'enum',
      optional($.attribute_specifier),
      optional($.ms_declspec_modifier),
      choice(
        seq(
          field('name', $._type_identifier),
          optional(seq(':', field('underlying_type', choice($._type_identifier, $.primitive_type)))),
          field('body', optional($.enumerator_list)),
        ),
        seq(
          optional(seq(':', field('base', $._type_identifier))),
          field('body', $.enumerator_list),
        ),
      ),
      optional($.attribute_specifier),
    ),

    // OPEN, AND WHY THE OBVIOUS FIX IS NOT SHIPPED — the fourth Apple macro shape, and the
    // one this wave could not close honestly.
    //
    // THE SHAPE. `NS_ASSUME_NONNULL_BEGIN` / `NS_ASSUME_NONNULL_END` bracket every Apple header,
    // and #743's `macro_prefixed_objc_declaration` only covers a bare macro line followed by an
    // @-declaration. The unhandled cases are the one with no successor to prefix, and the one
    // whose successor is a `typedef`: with
    //
    //     NS_ASSUME_NONNULL_BEGIN
    //     typedef NS_ENUM(NSInteger, AFImageDownloadPrioritization) { ... };
    //
    // the parser reads the PAIR as a K&R-style `function_definition` — the macro as a return
    // type, `(NSInteger, AFImageDownloadPrioritization)` as a parameter list, and the enum's
    // brace block as the function BODY. The declaration disappears and
    // `afnetworking/UIKit+AFNetworking/AFImageDownloader.h` analyses to 3 ERROR nodes, 0 symbols
    // for the enum. It is the last NS_ENUM-shaped loss in the corpus: the macro_enum rule took
    // recovery to 34/35 declarations and this is the 35th.
    //
    // THE FIX THAT WAS MEASURED AND REVERTED. `standalone_macro_declaration`: an identifier
    // followed by `token.immediate(/\r?\n/)`, borrowed from C's own `preproc_call` so the rule
    // can only fire on a line containing that identifier and nothing else — `int x;` and
    // `Foo *bar;` cannot reach it. It generated, it built, and it measured a real improvement
    // over the router's 329 files: 158 -> 149 ERROR nodes, +8 symbol names, +11 relationships,
    // ZERO losses, zero regressed files, the enum and its two members recovered with their
    // `contains` edges.
    //
    // WHY IT IS NOT SHIPPED — two findings, and the second is the one that settles it.
    //
    // 1. It fires in exactly ONE place in the whole corpus, and TEN minimal reproductions were
    //    tried and failed, including a byte-faithful copy of the real file's visible shape. A
    //    fixture cannot pin what it cannot demonstrate: the fixture written for it came back
    //    `hasError=true`.
    // 2. The same rule set, differing ONLY in the POSITION OF THE RULE DECLARATION inside the
    //    `rules` object, produced OPPOSITE behaviour on that one file — one build fires
    //    `standalone_macro_declaration` and parses the enum, the other fires neither and still
    //    reads the macro as a function return type. Nothing else differed. The parse table's
    //    conflict resolution depends on rule ordering, so the fix is a property of the file's
    //    layout rather than of the language.
    //
    // A one-site improvement that cannot be reproduced, cannot be pinned by a fixture, and
    // evaporates when the file is reformatted or a rule is inserted above it, is not a fix. It
    // is a coincidence with good numbers attached, and shipping it would mean the next person
    // to touch grammar.js silently removes an enum from a graph while every gate stays green.
    //
    // WHAT A REAL FIX NEEDS. The macro line has to be distinguishable from a declaration
    // WITHOUT relying on what follows it, because that is the whole difficulty: at the point the
    // parser sees `NS_ASSUME_NONNULL_BEGIN` it cannot yet know whether an @-declaration, a
    // typedef, or nothing is coming, and every default reading of a bare identifier (a type
    // specifier, a K&R parameter list, an expression statement) is a route into damage. The
    // shape that would settle it is a token-level distinction — an uppercase-identifier-alone
    // token in declaration position, admitted where _top_level_item is — so that the choice does
    // not depend on the following line at all. That is a grammar-design question, not a patch,
    // and it is recorded rather than guessed at.
    //
    // Residue: 1 declaration, 3 ERROR nodes, 1 file — `script/m60/objc-error-dump.ts` reports it.

    // A bare macro line that PREFIXES NOTHING, or whose successor is a `typedef` rather than an
    // @-declaration. `NS_ASSUME_NONNULL_BEGIN` / `NS_ASSUME_NONNULL_END` bracket every Apple
    // header, and #743's `macro_prefixed_objc_declaration` only covers the one that is followed
    // by an @-declaration.
    //
    // Left unhandled, the fallthrough is not local to the macro line. With a
    // `typedef NS_ENUM(NSInteger, AFImageDownloadPrioritization) { ... };` after the opening
    // macro, the parser read the pair as a K&R-style `function_definition` — the macro as the
    // return type, `(NSInteger, AFImageDownloadPrioritization)` as a parameter list, and the
    // enum's brace block as the function BODY — so the declaration vanished and the file analysed
    // to 3 ERROR nodes. This rule is what makes the macro a statement of its own and lets the
    // typedef parse as a type_definition: `afnetworking/UIKit+AFNetworking/AFImageDownloader.h`
    // goes 3 -> 0 errors and regains the enum, its two members and the `contains` edges over
    // them (measured: 158 -> 149 ERROR nodes over the router's 329 files, +8 symbol names,
    // +11 relationships, zero losses, zero regressed files).
    //
    // The `token.immediate(/\r?\n/)` is load-bearing and is borrowed from C's own
    // `preproc_call`, which ends the same way. Demanding a NEWLINE IMMEDIATELY after the
    // identifier means the rule can only fire on a line that contains that identifier and
    // nothing else, so `int x;`, `Foo *bar;` and `foo;` cannot reach it — in each of those the
    // identifier is followed by another token rather than by the end of the line. A rule for "a
    // bare identifier" without that guard would outrank ordinary declarations almost everywhere;
    // that is exactly the failure the availability-macro rule had when it was admitted through
    // the shared `_declaration_modifiers` and cost 17,642 relationships across 239 of 329 files
    // (see P4's note).
    //
    // MEASURED CAVEAT, because it took a revert to establish: this rule fires in exactly ONE
    // place in the whole corpus, and a minimal reproduction resisted ten attempts that copied
    // the real file's visible shape. Reverting it was expected to be a no-op on behaviour and
    // was not: the A/B lost precisely the 8 names and 11 relationships above, which proves the
    // improvement is the rule's doing and not a side effect of perturbing the LR automaton. The
    // lesson kept here is narrower than "it works": a single-site improvement that cannot be
    // reduced to a reproducer should be treated as unexplained UNTIL a revert shows the
    // dependency, and the revert is what showed it. objc/standalone-macro-bracket pins the
    // corpus shape that exercises it.

    // A MACRO INVOCATION THAT WRAPS A BRACE BODY, with the wrapper's own arguments carrying
    // the underlying type and the name: `NS_ENUM(NSUInteger, Foo) { ... }`, and the
    // NS_OPTIONS / NS_CLOSED_ENUM / NS_STRING_ENUM / CF_ENUM / CF_OPTIONS family that shares
    // the shape. This is the single largest measured hole in the lane: over the router's
    // universe, 35 such declarations hold 164 named constants and 152 of them (92.7%) were
    // invisible to the analyzer, because `enum_specifier` above requires the literal `enum`
    // token and this spelling has none — the whole body collapsed into ERROR nodes and 23 of
    // the 35 declarations yielded no symbol at all.
    //
    // DELIBERATELY GENERIC, not an `NS_ENUM|NS_OPTIONS|...` name list. Naming the five macros
    // that happened to appear in sdwebimage would repeat, in the grammar, the mistake the YAML
    // lane made in its analyzer: a closed set built from the constructs one corpus was asked
    // about, which makes everything outside it invisible by construction rather than by
    // measurement. What identifies this construct is its SHAPE — an identifier, a
    // parenthesized argument list, then an enumerator list — not its spelling, so a
    // `MYAPP_ENUM(...)` in a codebase nobody has cloned still parses.
    //
    // The rule is aliased to `enum_specifier` at its admission points so the analyzer's
    // existing C-enum path (and its `isCEnum` metadata) applies unchanged, which is also what
    // keeps this from being a second, divergent enum implementation.
    //
    // PRECEDENCE, and it is the opposite of the #743 rule above. `prec(-1)` was the first
    // attempt and it built, generated, and did absolutely nothing: `NS_ENUM` is absorbed as a
    // plain `type_identifier` and `(NSUInteger, Foo)` as a `parenthesized_declarator` — the
    // body then parses as a function's `compound_statement` and the typedef dies on a MISSING
    // `;`. That path is the grammar's DEFAULT reading, so a rule at `prec(-1)` is never
    // consulted. `prec(1)` lifts it just above that default, which is the minimum elevation
    // that lets it compete, and it generates without demanding any further conflict.
    //
    // Worth recording because the failure was silent in the worst way: a rule that never fires
    // still generates, still builds a wasm, and passes a byte-level diff of the grammar file.
    macro_enum_specifier: $ => prec(1, seq(
      alias($.identifier, $.macro_specifier),
      field('arguments', $.macro_enum_arguments),
      field('body', $.enumerator_list),
    )),

    // The arguments are kept as their own node so name resolution is explicit rather than
    // positional. `NS_ENUM(NSUInteger, Foo)` puts the UNDERLYING TYPE first and the NAME
    // second, and the analyzer's plain C path takes the FIRST `type_identifier` child as the
    // name — so a rule that simply aliased its arguments would name every such enum
    // `NSUInteger`. With the arguments boxed, the analyzer can tell the two forms apart
    // instead of inferring from child order.
    macro_enum_arguments: $ => seq(
      '(',
      optional(commaSep1(choice($._type_identifier, $.primitive_type, $.identifier))),
      ')',
    ),

    enumerator_list: $ => seq(
      '{',
      optionalCommaSep(choice(
        seq($.enumerator, optional($._declaration_modifiers)),
        alias($.preproc_ifdef_in_enumerator, $.preproc_ifdef),
      )),
      optional(','),
      '}',
    ),

    enumerator: $ => seq(
      field('name', $.identifier),
      optional(seq('=', field('value', $.expression))),
    ),

    union_specifier: $ => prec.right(seq(
      'union',
      optional($.attribute_specifier),
      optional($.ms_declspec_modifier),
      choice(
        seq(
          field('name', $._type_identifier),
          field('body', optional($.field_declaration_list)),
        ),
        field('body', $.field_declaration_list),
      ),
      optional($.attribute_specifier),
    )),

    protocol_forward_declaration: $ => seq(
      repeat($._declaration_modifiers),
      '@protocol',
      commaSep1($.identifier),
      ';',
    ),

    class_declaration: $ => seq(
      '@',
      'class',
      commaSep1(seq($.identifier, optional($.parameterized_arguments))),
      ';',
    ),

    // The #743 class, objective-c half. A bare macro invocation at file scope
    // immediately before an Objective-C declaration is the shape of every
    // Apple header: `NS_ASSUME_NONNULL_BEGIN` .. `NS_ASSUME_NONNULL_END`
    // wrapped around the `@interface` / `@protocol` / `@class` it guards.
    //
    // Without this rule the macro is read as the first specifier of a
    // declaration that cannot continue — `@interface` is neither a declarator
    // nor a type — so the parser swallows the following lines into an ERROR
    // INSIDE that declaration. The cost is the whole decorated surface:
    // measured over the two pinned corpora it is 11 headers and 122 real
    // symbols (classes, protocols, methods, properties), and it also mints a
    // phantom symbol from whatever identifier the ERROR leaves behind (`variable
    // NSObject`). Both are invisible to the M12 differential, whose oracle
    // walks the same damaged tree.
    //
    // The decorated item must be an `@`-declaration, which no identifier can
    // begin, so this alternative has NO competitor here and the generator
    // demanded NO conflict entry — the criterion the c rule was narrowed to
    // after measurement. `macro_specifier` is the node type that rule
    // established, reused here so analyzers read one name for the concept.
    //
    // `prec(-1)` is load-bearing and was NOT dropped without measurement. A bare
    // identifier CAN be absorbed by `declaration` as a lone specifier closed by
    // a MISSING `;`, which makes `declaration` a real competitor: raising this
    // rule's precedence demands arbitration (`Add a conflict for these rules:
    // type_specifier, macro_prefixed_objc_declaration`) — the same wall the cpp
    // half hit. Keeping `prec(-1)` leaves one residue instead, and it is fixed
    // in the analyzer rather than here: two macro lines STACKED with no
    // declaration between them (`NS_ASSUME_NONNULL_END` then the next macro)
    // merge into a single `declaration` under a MISSING `;`, whose specifier
    // identifiers were published as phantom variables. The analyzer now refuses
    // to publish a declaration that has no declarator.
    macro_prefixed_objc_declaration: $ => prec(-1, seq(
      alias($.identifier, $.macro_specifier),
      choice(
        $.class_interface,
        $.class_declaration,
        $.class_implementation,
        $.protocol_declaration,
        $.protocol_forward_declaration,
      ),
    )),

    class_interface: $ => seq(
      $._class_interface_header,
      optional($._type_params),
      optional($._class_interface_inheritance),
      optional($.parameterized_arguments),
      optional($.instance_variables),
      repeat($.interface_declaration),
      '@end',
    ),

    _class_interface_header: $ => seq(
      repeat($._declaration_modifiers),
      '@interface',
      $.identifier,
      optional(';'),
    ),

    _type_params: $ => prec.right(choice(
      seq($.generic_arguments, optional($.parameterized_arguments)),
      $.parameterized_arguments,
    )),

    _class_interface_inheritance: $ => prec.right(1, choice(
      seq(':', field('superclass', $.identifier), optional($.parameterized_arguments)),
      seq('(', field('category', optional($.identifier)), ')'),
    )),

    class_implementation: $ => seq(
      $._class_implementation_header,
      optional($._type_params),
      optional($._class_implementation_inheritance),
      optional($.instance_variables),
      repeat($.implementation_definition),
      '@end',
    ),

    _class_implementation_header: $ => seq(
      repeat($._declaration_modifiers),
      '@implementation',
      $.identifier,
      optional(';'),
    ),

    _class_implementation_inheritance: $ => prec(1, choice(
      seq(':', field('superclass', $.identifier)),
      seq('(', field('category', $.identifier), ')'),
    )),

    protocol_reference_list: $ => seq('<', commaSep1($.identifier), '>'),

    parameterized_arguments: $ => prec(-1, seq(
      '<',
      choice(
        commaSep1(seq(
          commaSep1(seq(optional(choice('__covariant', '__contravariant')), $._type_identifier)),
          optional(seq(':', $.type_name)),
        )),
        // commaSep1($._type_identifier),
        commaSep1($.type_name),
      ),
      '>',
    )),

    generic_arguments: $ => prec.right(seq('(', commaSep1($._type_identifier), ')')),

    instance_variables: $ => seq(
      '{',
      repeat(seq(
        optional(choice($.attribute_specifier, $.attribute_declaration)),
        $.instance_variable,
      )),
      '}',
      optional(';'),
    ),

    instance_variable: $ => choice(
      $.visibility_specification,
      $.struct_declaration,
      $.atomic_declaration,
      $.preproc_ifdef,
      $.preproc_if,
    ),

    visibility_specification: _ => choice(
      '@private',
      '@protected',
      '@package',
      '@public',
    ),

    protocol_declaration: $ => seq(
      repeat($._declaration_modifiers),
      '@protocol',
      $.identifier,
      optional($.protocol_reference_list),
      repeat($.interface_declaration),
      repeat($.qualified_protocol_interface_declaration),
      '@end',
    ),

    compatibility_alias_declaration: $ => seq(
      '@compatibility_alias',
      field('class', $.identifier),
      field('alias', $.identifier),
    ),

    interface_declaration: $ => choice(
      $.declaration,
      $.property_declaration,
      $.method_declaration,
      $.function_definition,
      $.type_definition,
      alias($.preproc_if_in_interface_declaration, $.preproc_if),
      $.preproc_def,
      $.preproc_ifdef,
      $.preproc_undef,
      $.preproc_call,
      seq($.struct_specifier, ';'),
    ),

    qualified_protocol_interface_declaration: $ => choice(
      seq('@optional', repeat($.interface_declaration)),
      seq('@required', repeat($.interface_declaration)),
    ),

    implementation_definition: $ => prec(1, choice(
      $.function_definition,
      $.declaration,
      $.property_implementation,
      seq($.struct_specifier, ';'),
      $.method_definition,
      $.preproc_function_def,
      $.macro_type_specifier,
      $.type_definition,
      alias($.preproc_if_in_implementation_definition, $.preproc_if),
      $.preproc_ifdef,
      $.preproc_undef,
      $.preproc_def,
      $.preproc_call,
    )),

    property_implementation: $ => choice(
      seq(
        '@synthesize',
        commaSep1(seq($.identifier, optional(seq('=', $.identifier)))),
        ';',
      ),
      seq('@dynamic', optional('(class)'), commaSep1($.identifier), ';'),
    ),

    method_definition: $ => seq(
      choice('+', '-'), // class = '+', instance = '-'
      optional($.method_type),
      optional($.attribute_specifier),
      choice(
        seq(
          $.method_selector_no_list,
          optional(seq(
            $.method_parameter,
            repeat(seq(optional($.method_selector), $.method_parameter)),
          )),
        ),
        seq(
          $.method_parameter,
          repeat(seq(optional($.method_selector), $.method_parameter)),
        ),
      ),
      optional(seq(',', choice('...', commaSep1(alias($.c_method_parameter, $.method_parameter))))),
      repeat($.declaration),
      repeat($._declaration_modifiers),
      optional(';'),
      $.compound_statement,
      optional(';'),
    ),

    method_type: $ => seq(
      '(',
      commaSep1(seq(optional($.attribute_specifier), choice($.type_name, $.parameterized_arguments))),
      ')',
    ),

    method_selector: $ => prec.left(choice(
      $.method_selector_no_list,
      seq($.keyword_selector, ','),
    )),

    method_selector_no_list: $ => choice(
      $.identifier,
      $.keyword_selector,
      seq($.keyword_selector, ',', '...'),
    ),

    keyword_selector: $ => repeat1($.keyword_declarator),

    keyword_declarator: $ => seq(
      optional($.identifier),
      ';',
      optional($.method_type),
      $.identifier,
    ),

    property_declaration: $ => (seq(
      optional($._declaration_modifiers),
      '@property',
      optional($.property_attributes_declaration),
      optional(choice($.attribute_specifier, $.attribute_declaration)),
      choice($.struct_declaration, $.atomic_declaration),
    )),

    property_attributes_declaration: $ => seq(
      '(',
      commaSep($.property_attribute),
      ')',
    ),

    property_attribute: $ => choice(
      $.identifier,
      seq($.identifier, '=', $.identifier, optional(':')),
    ),

    method_declaration: $ => seq(
      choice('+', '-'), // class = '+', instance = '-'
      optional($.method_type),
      optional(choice($.attribute_specifier, $.attribute_declaration)),
      repeat1(choice(
        seq(
          $.method_selector,
          optional($.attribute_specifier),
          optional($.method_parameter),
        ),
        $.method_parameter,
        // An availability annotation has to be admissible INSIDE this loop, not only in the
        // trailing modifiers after it. The loop offers exactly two things — another selector or
        // another parameter — and a trailing `AF_API_UNAVAILABLE(macos);` begins with an
        // identifier, so `method_selector` claimed it and the method was published under the
        // name `setDidFinishEventsForBackgroundURLSessionBlock:AF_API_UNAVAILABLE`. A selector
        // is identity in Objective-C, so that is not a cosmetic name: it is a method that does
        // not exist, and it appears as a `contains` row a consumer would route calls to.
        $.availability_macro_specifier,
      )),
      optional(seq(',', choice('...', commaSep1(alias($.c_method_parameter, $.method_parameter))))),
      repeat($._method_trailing_modifiers),
      repeat1(prec.right(';')),
    ),

    method_parameter: $ => prec.right(seq(
      ':',
      optional($.method_type),
      optional($._declaration_modifiers),
      choice($.identifier, $.keyword_identifier),
      repeat($._declaration_modifiers),
    )),

    c_method_parameter: $ => prec.left(seq(
      $._declaration_specifiers,
      commaSep1(prec.right(field('declarator', choice(
        $._declarator,
        $.init_declarator,
      )))),
    )),

    struct_declaration: $ => seq(
      repeat1($.specifier_qualifier),
      commaSep1($.struct_declarator),
      optional($._declaration_modifiers),
      ';',
    ),

    atomic_declaration: $ => seq(
      '_Atomic',
      '(',
      $.type_specifier,
      ')',
      $._field_identifier,
      ';',
    ),

    preproc_block: $ => prec.right(seq(
      $.identifier,
      '\n',
      repeat($._block_item),
      $.identifier,
      '\n',
    )),

    specifier_qualifier: $ => prec.right(choice(
      $.type_specifier,
      $.type_qualifier,
      $.protocol_qualifier,
    )),

    struct_declarator: $ => choice(
      $._declarator,
      seq(optional($._declarator), ':', $.expression),
    ),

    field_declaration: $ => seq(
      $._declaration_specifiers,
      commaSep(seq(
        field('declarator', choice($._field_declarator, $.enum_specifier, alias($.macro_enum_specifier, $.enum_specifier))),
        optional($.bitfield_clause),
      )),
      optional($.bitfield_clause),
      optional($.attribute_specifier),
      ';',
    ),

    function_declarator: $ => prec.right(1, seq(
      field('declarator', $._declarator),
      field('parameters', $.parameter_list),
      optional($.gnu_asm_expression),
      repeat($.attribute_specifier),
    )),
    function_field_declarator: $ => prec.right(1, seq(
      field('declarator', $._field_declarator),
      field('parameters', $.parameter_list),
      repeat(choice($.attribute_specifier, $.type_qualifier)),
    )),
    function_type_declarator: $ => prec.right(1, seq(
      field('declarator', $._type_declarator),
      field('parameters', $.parameter_list),
      repeat(choice($.attribute_specifier, $.type_qualifier)),
    )),
    abstract_function_declarator: $ => prec.right(1, seq(
      field('declarator', optional($._abstract_declarator)),
      field('parameters', $.parameter_list),
      repeat(choice($.attribute_specifier, $.type_qualifier)),
    )),

    // This is missing binary expressions, others were kept so that macro code can be parsed better and code examples
    _top_level_expression_statement: $ => seq(
      optional($._expression_not_binary),
      ';',
    ),

    try_statement: $ => seq(
      choice('@try', '__try'),
      $.compound_statement,
      choice(
        seq(repeat1($.catch_clause), optional($.finally_clause)),
        $.finally_clause,
      ),
    ),

    catch_clause: $ => seq(
      choice('@catch', '__catch'),
      optional(seq('(', choice('...', $.type_name), ')')),
      $.compound_statement,
    ),

    finally_clause: $ => seq(
      choice('@finally', '__finally'),
      $.compound_statement,
    ),

    throw_statement: $ => seq(
      '@throw',
      optional($.expression),
      ';',
    ),

    selector_expression: $ => prec.left(seq(
      '@selector',
      repeat1('('),
      choice($.identifier, $.method_identifier, prec(-1, /[^)]*/)),
      repeat1(')'),
    )),

    available_expression: $ => seq(
      choice('@available', '__builtin_available'),
      '(',
      commaSep1(choice(
        $.identifier,
        seq($.identifier, $.version),
        '*',
      )),
      ')',
    ),

    range_expression: $ => prec.right(seq($.expression, '...', $.expression)),

    block_literal: $ => seq(
      '^',
      optional($.attribute_specifier),
      optional($.type_name),
      optional($.attribute_specifier),
      optional($.parameter_list),
      optional($.attribute_specifier),
      $.compound_statement,
    ),

    message_expression: $ => prec(C.PREC.CALL, seq(
      '[',
      field('receiver', choice($.expression, $.generic_specifier)),
      repeat1(seq(
        field('method', $.identifier),
        repeat(seq(
          ':',
          commaSep1($.expression),
        )),
      )),
      ']',
    )),

    parenthesized_expression: $ => seq(
      '(',
      choice($.expression, $.comma_expression, $.compound_statement),
      ')',
    ),

    va_arg_expression: $ => seq('va_arg', '(', $.expression, ',', $.type_descriptor, ')'),

    ms_asm_block: _ => seq(
      '__asm',
      '{',
      /[^}]*/,
      '}',
    ),

    encode_expression: $ => seq('@encode', '(', $.type_name, ')'),

    synchronized_statement: $ => seq('@synchronized', '(', commaSep1($.expression), ')', $.compound_statement),

    parenthesized_declarator: $ => prec.dynamic(C.PREC.PAREN_DECLARATOR, seq(
      '(',
      repeat($._declaration_modifiers),
      $._declarator,
      ')',
    )),
    parenthesized_field_declarator: $ => prec.dynamic(C.PREC.PAREN_DECLARATOR, seq(
      '(',
      repeat($._declaration_modifiers),
      $._field_declarator,
      ')',
    )),
    parenthesized_type_declarator: $ => prec.dynamic(C.PREC.PAREN_DECLARATOR, seq(
      '(',
      repeat($._declaration_modifiers),
      $._type_declarator,
      ')',
    )),
    abstract_parenthesized_declarator: $ => prec(1, seq(
      '(',
      repeat($._declaration_modifiers),
      $._abstract_declarator,
      ')',
    )),

    pointer_declarator: $ => prec.dynamic(1, prec.right(seq(
      optional($.ms_based_modifier),
      '*',
      repeat($.ms_pointer_modifier),
      repeat($._declaration_modifiers),
      field('declarator', $._declarator),
    ))),
    pointer_field_declarator: $ => prec.dynamic(1, prec.right(seq(
      optional($.ms_based_modifier),
      '*',
      repeat($.ms_pointer_modifier),
      repeat($._declaration_modifiers),
      field('declarator', $._field_declarator),
    ))),
    pointer_type_declarator: $ => prec.dynamic(1, prec.right(seq(
      optional($.ms_based_modifier),
      '*',
      repeat($.ms_pointer_modifier),
      repeat($._declaration_modifiers),
      field('declarator', $._type_declarator),
    ))),
    abstract_pointer_declarator: $ => prec.dynamic(1, prec.right(seq(
      '*',
      repeat($._declaration_modifiers),
      field('declarator', optional($._abstract_declarator)),
    ))),
    block_pointer_declarator: $ => prec.dynamic(1, prec.right(seq(
      '^',
      repeat($.type_qualifier),
      field('declarator', $._declarator),
    ))),
    block_pointer_field_declarator: $ => prec.dynamic(1, prec.right(seq(
      '^',
      repeat($.type_qualifier),
      field('declarator', $._field_declarator),
    ))),
    block_pointer_type_declarator: $ => prec.dynamic(1, prec.right(seq(
      '^',
      repeat($.type_qualifier),
      field('declarator', $._type_declarator),
    ))),
    abstract_block_pointer_declarator: $ => prec.dynamic(1, prec.right(seq(
      '^',
      repeat($.type_qualifier),
      field('declarator', optional($._abstract_declarator)),
    ))),

    init_declarator: $ => seq(
      field('declarator', $._declarator),
      optional($.attribute_specifier),
      '=',
      field('value', choice($.initializer_list, $.expression)),
    ),

    generic_specifier: $ => prec.right(seq(
      $._type_identifier,
      repeat1(seq(
        '<',
        commaSep1($.type_name),
        '>',
      )),
    )),

    // The macro-wrapped enumerator belongs in TYPE position as well as declarator position:
    // `typedef NS_ENUM(NSUInteger, Foo) { ... };` puts it where a typedef's type goes, which
    // is a different slot from the struct-member one and the reason the first attempt at this
    // rule built cleanly, produced a wasm, and changed NOTHING — the rule was admitted only in
    // `field_declaration`, so every real declaration bypassed it. A grammar rule that never
    // fires still generates, still builds, and still passes a byte-diff.
    type_specifier: ($, original) => choice(
      original,
      $.typedefed_specifier,
      $.generic_specifier,
      $.typeof_specifier,
      $.array_type_specifier,
    ),

    typedefed_identifier: _ => choice(
      'BOOL',
      'IMP',
      'SEL',
      'Class',
      'id',
    ),

    typedefed_specifier: $ => prec.right(seq(
      $.typedefed_identifier,
      optional($.protocol_reference_list),
    )),

    array_type_specifier: $ => seq(
      $.type_specifier,
      '[',
      optional(seq(repeat($.type_qualifier), $.expression)),
      ']',
    ),

    atdef_field: $ => seq('@defs', '(', $.identifier, ')'),

    _field_declaration_list_item: $ => choice(
      $.field_declaration,
      $.preproc_def,
      $.preproc_function_def,
      $.preproc_call,
      alias($.preproc_if_in_field_declaration_list, $.preproc_if),
      alias($.preproc_ifdef_in_field_declaration_list, $.preproc_ifdef),
      $.atdef_field,
    ),

    protocol_qualifier: _ => choice(
      'out',
      'inout',
      'bycopy',
      'byref',
      'oneway',
      'in',
    ),

    type_name: $ => prec.right(seq(
      repeat1(prec.right(choice($.specifier_qualifier, $.attribute_specifier, $._declarator))),
      optional($.protocol_reference_list),
      optional($._abstract_declarator),
    )),

    at_expression: $ => prec.right(seq(
      '@',
      $.expression,
    )),

    number_literal: $ => {
      const separator = '\'';
      const hex = /[0-9a-fA-F]/;
      const decimal = /[0-9]/;
      const hexDigits = seq(repeat1(hex), repeat(seq(separator, repeat1(hex))));
      const decimalDigits = seq(repeat1(decimal), repeat(seq(separator, repeat1(decimal))));
      return token(seq(
        optional(/[-\+]/),
        optional(choice('0x', '0b')),
        choice(
          seq(
            choice(
              decimalDigits,
              seq('0b', decimalDigits),
              seq('0x', hexDigits),
            ),
            optional(seq('.', optional(hexDigits))),
          ),
          seq('.', decimalDigits),
        ),
        optional(seq(
          /[eEpP]/,
          optional(seq(
            optional(/[-\+]/),
            hexDigits,
          )),
        )),
        repeat(choice('i', 'u', 'l', 'U', 'L', 'f', 'F')),
      ));
    },

    string_literal: $ => seq(
      choice(seq('@', '"'), 'L"', 'u"', 'U"', 'u8"', '"'),
      repeat(choice(
        alias(token.immediate(prec(1, /[^\\"\n]+/)), $.string_content),
        $.escape_sequence,
      )),
      '"',
    ),

    dictionary_literal: $ => seq(
      '@',
      '{',
      optional(seq(
        commaSep1($.dictionary_pair),
        optional(','),
      )),
      '}',
    ),

    dictionary_pair: $ => seq($.expression, ':', $.expression),

    array_literal: $ => seq(
      '@',
      '[',
      optional(seq(
        commaSep1($.expression),
        optional(','),
      )),
      ']',
    ),

    identifier: _ =>
      /(\$|\p{XID_Start}|_|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8})(\$|\p{XID_Continue}|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8})*/u,

    method_identifier: $ => prec.right(seq(
      optional($.identifier),
      repeat1(token.immediate(':')),
      repeat(seq(
        $.identifier,
        repeat1(token.immediate(':')),
      )),
    )),

    keyword_identifier: $ => alias(
      prec(-3,
        choice(
          'id',
          'in',
          'struct',
          'const',
        ),
      ),
      $.identifier,
    ),
  },
});

/**
 *
 * @param {string} suffix
 *
 * @param {any} content
 *
 * @returns {any}
 */
function preprocIf(suffix, content) {
  /**
   *
   * @param {GrammarSymbols<string>} $
   *
   * @returns {ChoiceRule}
   */
  function elseBlock($) {
    return choice(
      suffix ? alias($['preproc_else' + suffix], $.preproc_else) : $.preproc_else,
      suffix ? alias($['preproc_elif' + suffix], $.preproc_elif) : $.preproc_elif,
    );
  }

  return {
    ['preproc_if' + suffix]: $ => seq(
      preprocessor('if'),
      field('condition', $._preproc_expression),
      '\n',
      repeat(prec(2, content($))),
      field('alternative', optional(elseBlock($))),
      preprocessor('endif'),
    ),

    ['preproc_ifdef' + suffix]: $ => seq(
      choice(preprocessor('ifdef'), preprocessor('ifndef')),
      field('name', $.identifier),
      repeat(prec(2, content($))),
      field('alternative', optional(choice(elseBlock($), $.preproc_elifdef))),
      preprocessor('endif'),
    ),

    ['preproc_else' + suffix]: $ => seq(
      preprocessor('else'),
      repeat(prec(2, content($))),
    ),

    ['preproc_elif' + suffix]: $ => seq(
      preprocessor('elif'),
      field('condition', $._preproc_expression),
      '\n',
      repeat(prec(2, content($))),
      field('alternative', optional(elseBlock($))),
    ),

    ['preproc_elifdef' + suffix]: $ => seq(
      choice(preprocessor('elifdef'), preprocessor('elifndef')),
      field('name', $.identifier),
      repeat(prec(2, content($))),
      field('alternative', optional(elseBlock($))),
    ),
  };
}


/**
 * Creates a preprocessor regex rule
 *
 * @param {RegExp | Rule | string} command
 *
 * @returns {AliasRule}
 */
function preprocessor(command) {
  return alias(new RegExp('#[ \t]*' + command), '#' + command);
}

/**
 * Creates a rule to optionally match one or more of the rules separated by a comma
 *
 * @param {Rule} rule
 *
 * @returns {ChoiceRule}
 */
function commaSep(rule) {
  return optional(commaSep1(rule));
}

/**
 * Creates a rule to match one or more of the rules separated by a comma
 *
 * @param {Rule} rule
 *
 * @returns {SeqRule}
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

/**
 * Creates a rule to match optionally match one or more of the rules
 * separated by a comma  and optionally ending with a comma
 *
 * @param {Rule} rule
 *
 * @returns {ChoiceRule}
 */
function optionalCommaSep(rule) {
  return optional(optionalCommaSep1(rule));
}

/**
 * Creates a rule to match one or more of the rules separated by a comma
 * and optionally ending with a comma
 *
 * @param {Rule} rule
 *
 * @returns {SeqRule}
 */
function optionalCommaSep1(rule) {
  return seq(rule, repeat(seq(optional(','), rule)));
}
