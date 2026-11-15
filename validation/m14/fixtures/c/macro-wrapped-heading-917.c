/* #917: a MACRO-WRAPPED heading — `MACRO(ret, name)(params){ body }`.
 *
 * Every shape below is a measured sqlite site, and the macros are deliberately
 * NOT defined here: in the real files they come from headers, and the parse is
 * identical either way.
 *
 * The heading is CALL-shaped, so the published grammar reads it as
 * `MACRO(ret, name)` CALLED with `(params)` and leaves the body as an orphan
 * `compound_statement` — a direct child of the translation_unit, or of the
 * ERROR / preproc_ifdef that swallowed the region. There is no
 * `function_definition`, so the definition was never a symbol, its locals were
 * published as FILE-SCOPE names, and every read in its body was attributed to
 * `global`.
 *
 * Each spelling has a CONTROL: the same body shape in an ORDINARY function,
 * and a call chain followed by a block inside a function (which is NOT a
 * definition and must stay two statements).
 *
 * NOT part of this class, and deliberately NOT in this fixture: a heading whose
 * macro's FIRST argument is a POINTER type (`CMPP__EXPORT(void *,
 * cmpp_mrealloc)(void * p, size_t n){…}`, libcmpp.c:5529/5533/5514/6102/9526/
 * 9714). It does not produce an orphan body at all — `void * CMPP__EXPORT(…)`
 * parses as a DECLARATION that names the macro and types it as a pointer — so
 * its definition is lost by a different mechanism. Measured PRE-FIX and
 * POST-FIX IDENTICAL (`cmpp_mrealloc` stays `constant@3670` in both), and
 * registered as its own defect (**#918**) rather than folded in here.
 */

typedef struct cmpp_input_f cmpp_input_f;
typedef unsigned long cmpp_size_t;

void helperTarget(void);

static int fileScope = 7;

/* (ret, name) — libcmpp.c:8749. The body carries the LEAK this fixture pins:
 * an anonymous `enum` and an array read of its member. Pre-fix both the enum
 * and its member were file-scope symbols and the read was
 * `uses global -> BufSize`, a pair the tree-truth oracle cannot derive. */
CMPP__EXPORT(int, cmpp_stream)( cmpp_input_f inF, void * inState ){
  int rc = 0;
  enum { BufSize = 1024 * 4 };
  unsigned char buf[BufSize];
  (void)inF;
  (void)inState;
  (void)buf;
  helperTarget();
  return rc;
}

/* CONTROL: the same body in an ORDINARY function — its enum must not leak
 * either, and this is the behaviour the wrapped case must now match. */
int plain_stream(void){
  int rc = 0;
  enum { PlainSize = 1024 * 4 };
  unsigned char buf[PlainSize];
  (void)buf;
  helperTarget();
  return rc;
}

/* (existing_fn(), type, MANGLED_name) — sqlite3-jni.c:5338. The declared name
 * is the LAST argument and the C lexer SPLITS it (`1` + `value_1text`), because
 * an identifier cannot start with a digit. */
S3JniApi(existing_binding(),jstring,1value_1text)( int jValue ){
  helperTarget();
  return jValue;
}

/* A VARIADIC parameter list — libcmpp.c:5463. */
CMPP__EXPORT(int, cmpp_err_set)( int rc, char const * zFmt, ... ){
  helperTarget();
  return rc;
}

/* CONTROL: a call chain followed by a block INSIDE a function is two
 * statements, never a definition — the recovery is gated on the scope. */
void plain_control(void){
  helperTarget();
  { int nested = 1; (void)nested; }
}

void helper_defined(void){
  cmpp_stream(0, 0);
  fileScope = fileScope + 1;
}
