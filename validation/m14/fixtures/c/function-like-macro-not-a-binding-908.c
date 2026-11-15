/* #908 (M60-C) — a function-like macro's NAME is never a LOCAL BINDING.
 *
 * The corpus shape (verbatim jq src/parser.c L2229-2230, minimised here to the
 * lines that carry it): a function-like macro invoked inside a declaration is
 * absorbed by the grammar. `YY_INITIAL_VALUE (static YYSTYPE x;)` becomes a
 * `declaration` whose `macro_type_specifier` holds the macro, and
 * `YYSTYPE yylval YY_INITIAL_VALUE (= yyval_default);` becomes a `declaration`
 * whose DECLARATOR field is a `function_declarator` NAMED AFTER THE MACRO — the
 * really-declared name (`yylval`) is demoted to the declaration's
 * type_identifier.
 *
 * `yyparse` (L37) carries that pair in the corpus's own order: the macro use
 * (L38) is walked BEFORE the declaration that misparses it (L39), so it emits
 * even under the defect. `c908_after` (L44) is the same pair REVERSED, and that
 * is the load-bearing half: the preprocessor expands the name wherever it
 * appears, so the mention on L46 must still emit after the declaration on L45.
 * A collector that reads L45's declarator leftmost identifier as a bound local
 * puts YY_INITIAL_VALUE into c908_after's locals and silently drops both that
 * function's rows — the exact order-dependent behaviour this fixture exists to
 * forbid (the real corpus only escaped it because parser.c L2229 happens to be
 * walked before L2230).
 *
 * `c908_read` (L50) is the opposite guard: a macro invocation in a value
 * position, in a function that never sees the misparse. It must keep emitting,
 * so the reverted first attempt at #908 — "a function-like macro name is never a
 * value read" — fails here; that attempt removed the jq row and traded it for
 * four MISSING rows (isleap, YYDPRINTF, decFinish, CFUNC).
 *
 * The invocation declares nothing: `YYSTYPE` on L39/L45 is the type of the NEXT
 * declaration (the grammar glued it there), and `yylval` is a function-local
 * binding (C-D1: never a symbol) on both sides.
 */
#define YY_INITIAL_VALUE(Value) Value

typedef int YYSTYPE;

/* corpus order: the use precedes the declaration that misparses */
int yyparse(void) {
  YY_INITIAL_VALUE (static YYSTYPE yyval_default;)
  YYSTYPE yylval YY_INITIAL_VALUE (= yyval_default);
  return yylval;
}

/* order probe: the misparsed declaration precedes the use */
int c908_after(void) {
  YYSTYPE yylval YY_INITIAL_VALUE (= yyval_default);
  YY_INITIAL_VALUE (static YYSTYPE zz_default;)
  return yylval;
}

int c908_read(void) {
  return YY_INITIAL_VALUE (41);
}
