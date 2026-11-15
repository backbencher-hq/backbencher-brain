/* c/fabricated-macro-name-991 — the fixture for a macro symbol whose NAME is a name no
 * `#define` in the file declares.
 *
 * The grammar loses the macro name when the replacement list is a brace-enclosed,
 * comment-bearing initializer, and the `name:` field then binds to whatever identifier
 * comes next:
 *
 *     #define CmppLvl_empty_m {  .flags=0U, .lineNo=0U  }
 *
 *     preproc_def
 *       ERROR(identifier, preproc_arg, comment)   <- "CmppLvl_empty_m {" and the body
 *       name: (identifier)                        <- ".flags"
 *       value: (preproc_arg)                     <- "=0U, .lineNo=0U}"
 *
 * sqlite `ext/wasm/libcmpp.c:5520` is the corpus case, and it is the shape that
 * registered the defect: the analyzer published a macro named `flags`, and `flags` is a
 * real struct member nine hundred lines earlier (`cmpp_flag32_t flags;`, :448). The
 * lane gate's own `P7-no-macro-named-member` convicted it with 9 rows in that one file
 * -- `cmpp_ctor_opt.flags@L448 is named after an object-like macro, not a declarator` --
 * and the analyzer was right about the member and wrong about the macro.
 *
 * Measured by script/m14/tmp/c-audit/c-macro-name.ts over 348 C-routed sqlite files,
 * 4,472 `#define` nodes: the `name` field matches what the line spells in 4,466 and is a
 * name no `#define` declares in **6**, and in all 6 an ERROR child of the same node sits
 * BEFORE the name field. That is the structural test, and on this corpus it and the
 * fabrication coincide exactly.
 */

/* --- the subject: sqlite's spelling, brace-enclosed and comment-bearing. --- */
struct c991_S {
  unsigned flags;
  long lineNo;
};
#define C991_S_empty_m {/* the whole replacement list */ .flags=0U, .lineNo=0U}

/* --- CONTROLS, each a shape the test must NOT catch. --- */

/* An ordinary brace-enclosed replacement list with no comment before the first
 * designated initializer: this one parses clean, and a test that refused every
 * brace-bodied `#define` would lose it. */
#define C991_brace_ok { 1, 2 }

/* An object-like macro and a function-like macro, both the everyday shapes. */
#define C991_object_like 5
#define C991_function_like(x) ((x) + 1)

/* A macro whose replacement list is itself a brace body reached through a function-like
 * macro -- the same loss, so it must also publish nothing. */
#define C991_indirect_empty_m C991_function_like(0)

/* An ordinary member named after a FUNCTION-LIKE macro that this file does define.
 * This is the legitimate shape the P7 property is really about and it must keep
 * resolving: the rule is not "no member may share a macro's name" -- redis's
 * `double min, max;` declared 3,700 lines after its own `#define min(a, b)` is real
 * C and #931's fixtures pin it.
 *
 * The FUNCTION-LIKE spelling is load-bearing and the first version of this control got
 * it wrong: with an OBJECT-like macro the preprocessor replaces the identifier
 * wherever it appears, so `unsigned X;` after `#define X 0` expands to `unsigned 0;`
 * and is not valid C at all. The lane gate's P7-no-macro-named-member property caught
 * exactly that, on this fixture, with
 *   `c991_member_named_after_macro.C991_flags_misnomer_m@L57 is named after an
 *    object-like macro, not a declarator`
 * which is the property being right and the fixture being wrong. A function-like macro
 * is replaced only where `(` follows the name, and a member declarator is followed by
 * `;`, so the member survives substitution -- which is why #931's rule is restricted to
 * object-like macros and why this control has to be one. */
#define C991_fn_misnomer_m(x) (x)
struct c991_member_named_after_macro {
  unsigned C991_fn_misnomer_m;
  double C991_fn_misnomer_m2;
};
#define C991_fn_misnomer_m2(a, b) ((a) < (b) ? (a) : (b))