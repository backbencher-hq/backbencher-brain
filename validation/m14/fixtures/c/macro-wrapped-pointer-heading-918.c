/* #918: a POINTER-RETURN macro-wrapped heading — `MACRO(ret*, name)(params){ body }`.
 *
 * #917's spelling leaves the body as an ORPHAN `compound_statement` (the heading
 * parses as `MACRO(ret, name)` CALLED with `(params)`). When the macro's first
 * argument is a POINTER TYPE the same heading parses differently — the grammar
 * accepts it as a `function_definition` (or, where recovery swallows the region,
 * a `declaration`) whose `type` field is a `macro_type_specifier` holding BOTH
 * macro arguments, with the PARAMETER list in the `declarator` field:
 *
 *   (function_definition
 *     type: (macro_type_specifier name: (identifier)
 *              (ERROR (type_descriptor … declarator: (abstract_pointer_declarator)))
 *              type: (type_descriptor type: (type_identifier)))
 *     declarator: (parenthesized_declarator …)
 *     body: (compound_statement …))
 *
 * The analyzer's declarator route looks for a `function_declarator`, so the
 * definition was never a symbol, its body never a Function scope, and five of
 * the six measured names (libcmpp.c) existed only as the `#define`d macro
 * constant from the file's thunk block.
 *
 * Every shape below is a measured sqlite site; the macros are deliberately NOT
 * defined here (in the real files they come from headers, and the parse is
 * identical either way).
 *
 * CONTROLS carry the other half: a VALUE-return heading (the #917 class — must
 * be recovered by that rule, never this one), an ORDINARY pointer-returning
 * function (untouched), and a DECLARATION-shaped control (`int g_ctl(void);`
 * style) that must not be mistaken for a heading.
 */

typedef unsigned long cmpp_size_t;
typedef int cmpp_rc_e;
typedef struct cmpp_b cmpp_b;
typedef struct cmpp cmpp;
typedef struct cmpp_dx cmpp_dx;

void helperTarget(void);
void * helper_alloc(void * p, size_t n);

static int fileScope = 7;

/* `void *` — libcmpp.c:5533. */
CMPP__EXPORT(void *, cmpp_malloc)(size_t n){
  (void)n;
  helperTarget();
  return 0;
}

/* `char const *` — libcmpp.c:5514 (the return type's words arrive as a
 * type_qualifier inside the same type_descriptor as the pointer). */
CMPP__EXPORT(char const *, cmpp_rc_cstr)(int rc){
  (void)rc;
  helperTarget();
  return 0;
}

/* `cmpp_b *` — libcmpp.c:9714 (a struct pointer; the return type's base is a
 * type_identifier, which is why the NAME slot is pinned by POSITION — after the
 * return-type ERROR — and not by node type alone). */
CMPP__EXPORT(cmpp_b *, cmpp_b_borrow)(cmpp *pp){
  (void)pp;
  helperTarget();
  return 0;
}

/* An UNNAMED parameter — must stay `unknown`, never name the definition by a
 * type word (the same contract the #917 collector publishes). */
CMPP__EXPORT(cmpp_b *, cmpp_b_clear)(void){
  helperTarget();
  return 0;
}

/* CONTROL 1: a VALUE-return heading — the #917 class. It must be recovered by
 * the #917 rule (orphan body), and the pointer rule must NOT also claim it. */
CMPP__EXPORT(int, cmpp_value_ctl)(int x){
  (void)x;
  helperTarget();
  return 0;
}

/* CONTROL 2: an ORDINARY pointer-returning function — untouched by either
 * recovery, and its parameters are the analyzer's clean path. */
void * plain_return(size_t n){
  (void)n;
  helperTarget();
  return 0;
}

/* CONTROL 3: an ordinary declaration that also carries a pointer type and a
 * parenthesised declarator — a PROTOTYPE, not a definition. */
void * plain_proto(size_t n);

/* The recovered definitions must resolve at their call sites. */
void caller(void){
  cmpp_malloc(4);
  cmpp_rc_cstr(0);
  cmpp_b_borrow(0);
  cmpp_b_clear();
  cmpp_value_ctl(1);
  plain_return(2);
  fileScope = fileScope + 1;
}

/* The DECLARATION spelling — libcmpp.c:5529 — reproduced in the REAL FILE's own
 * context: `#ifdef __cplusplus / extern "C" {` opens a brace the C parse cannot
 * close until the region ends, so the heading is glued into a
 * `linkage_specification` recovery and the parse cuts it after the FIRST
 * parameter, leaving the rest of the parameter list plus the body's opening in
 * an ERROR child of the declaration. The single `return <call>` body is what the
 * measured sites have; a body of several statements recovers differently and is
 * deliberately NOT claimed by this rule. */
#ifdef __cplusplus
extern "C" {
#endif

CMPP__EXPORT(void *, cmpp_mrealloc)(void * p, size_t n){
  return helper_alloc(p, n);
}

#ifdef __cplusplus
}
#endif

