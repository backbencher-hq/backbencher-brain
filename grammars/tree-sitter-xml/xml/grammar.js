/**
 * @file Tree-sitter grammar definition for XML
 * @author ObserverOfTime
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

import * as c from '../common/common.mjs';

const O = optional;

export default grammar({
  name: 'xml',

  externals: $ => [
    // DTD
    $.PITarget,
    $._pi_content,
    $.Comment,

    // XML
    $.CharData,
    $.CData,
    'xml-model',
    'xml-stylesheet',
    $._start_tag_name,
    $._end_tag_name,
    $._erroneous_end_name,
    '/>',
  ],

  extras: _ => [],

  supertypes: $ => [
    $._markupdecl,
    $._AttType,
    $._EnumeratedType,
    $._EntityDecl,
    $._Reference,
  ],

  conflicts: $ => [
    [$.AttlistDecl, $.AttDef]
  ],

  word: $ => $.Name,

  rules: {
    document: $ => prec(2, seq(
      O($._S),
      O($.prolog),
      field('root', $.element),
      repeat($._Misc),
    )),

    prolog: $ => choice(
      seq(
        $.XMLDecl,
        repeat($._Misc),
      ),
      seq(
        O($.XMLDecl),
        repeat($._Misc),
        $.doctypedecl,
        repeat($._Misc),
      ),
      repeat1($._Misc)
    ),

    _Misc: $ => choice(
      $.PI,
      $.StyleSheetPI,
      $.XmlModelPI,
      $.Comment,
      $._S
    ),

    XMLDecl: $ => seq(
      '<?',
      'xml',
      $._VersionInfo,
      O($._EncodingDecl),
      O($._SDDecl),
      O($._S),
      '?>'
    ),

    _SDDecl: $ => seq(
      $._S,
      'standalone',
      $._Eq,
      c.str(choice('yes', 'no'))
    ),

    doctypedecl: $ => seq(
      '<!',
      'DOCTYPE',
      $._S,
      $.Name,
      O(seq($._S, $.ExternalID)),
      O($._S),
      O(seq(
        '[',
        repeat($._intSubsetItem),
        ']',
        O($._S)
      )),
      '>'
    ),

    // M60 XML lane: `_intSubset` used to be `rseq1(O($._S), $.__markupdecl,
    // $._DeclSep)`, i.e. it could only ever accept a MARKUP declaration. XML
    // 1.0 §2.4 also allows a CONDITIONAL SECTION there
    // (`<![ %pe; [ markupdecl* ]]>`), and upstream's `conditionalSect` was
    // unreachable from this rule — in 0.7.0 it is not declared in this grammar
    // at all, so `<![INCLUDE[ ... ]]>` inside an internal subset produced an
    // ERROR that swallowed the surrounding `<!DOCTYPE>` AND let the parser pick
    // a later `Name` as the DTD name (publishing a symbol called `INCLUDE`).
    // Routing the subset through the external-subset declaration, which is what
    // actually lists a conditional section, is the one-line repair.
    // Zero-or-more INLINE repeat: tree-sitter rejects a named rule that can
    // match the empty string, and XML 1.0 allows an empty internal subset, so
    // the repeat is written at each use site over a named ITEM rule (hidden, so
    // it contributes no node of its own).
    _intSubsetItem: $ => choice(
      $._markupdecl,
      $.conditionalSect,
      $._DeclSep,
    ),

    conditionalSect: $ => seq(
      '<![',
      O($._S),
      c.ref($, 'IGNORE', 'INCLUDE'),
      O($._S),
      '[',
      repeat($._intSubsetItem),
      ']]>',
    ),

    element: $ => choice(
      $.EmptyElemTag,
      seq($.STag, O($.content), $.ETag)
    ),

    EmptyElemTag: $ => seq(
      '<',
      alias($._start_tag_name, $.Name),
      c.rseq($._S, $.Attribute),
      O($._S),
      '/>'
    ),

    Attribute: $ => seq($.Name, $._Eq, $.AttValue),

    STag: $ => seq(
      '<',
      alias($._start_tag_name, $.Name),
      c.rseq($._S, $.Attribute),
      O($._S),
      '>'
    ),

    ETag: $ => seq('</', alias($._end_tag_name, $.Name), O($._S), '>'),

    _ErroneousETag: $ => seq(
      '</',
      alias($._erroneous_end_name, $.ERROR),
      O($._S),
      '>',
    ),

    content: $ => repeat1(
      choice(
        $.CharData,
        $.element,
        $._Reference,
        $.CDSect,
        $.PI,
        $.Comment
      )
    ),

    CDSect: $ => prec.left(
      seq($.CDStart, optional($.CData), ']]>')
    ),

    CDStart: _ => seq('<![', 'CDATA', '['),

    StyleSheetPI: $ => seq(
      '<?',
      'xml-stylesheet',
      c.rseq($._S, $.PseudoAtt),
      O($._S),
      '?>'
    ),

    XmlModelPI: $ => seq(
      '<?',
      'xml-model',
      c.rseq($._S, $.PseudoAtt),
      O($._S),
      '?>'
    ),

    PseudoAtt: $ => seq($.Name, $._Eq, $.PseudoAttValue),

    PseudoAttValue: $ => choice(
      c.att_value($, '"'),
      c.att_value($, "'")
    ),

    ...c.rules
  }
});
