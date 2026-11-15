/* c/inline-enum-member-path-986 -- an anonymous inline enum is a MEMBER PATH.
 *
 * The inline-aggregate owner path was #950/#951 for struct and union, and the
 * tagged enum spelling already kept its own tag. The UNTAGGED enum as a member's
 * type was the one shape left, and it collapsed onto the CONTAINER:
 *
 *   typedef union {
 *     enum { A_ONE, A_TWO } first;     /* the member carries an enum of its own *\/
 *     int n;
 *   } U;
 *
 * published
 *
 *   contains U -> first
 *   contains U -> A_ONE        <- a member of `first`, published as a member of U
 *   contains U -> A_TWO
 *
 * so a consumer reading `U` sees `A_ONE` beside `first` and `n` and cannot learn
 * that `first` is a struct of its own with two enumerators. The two adjacent
 * shapes were already right, which is what makes this a defect and not a choice:
 *
 *   typedef union { enum E { B_ONE, B_TWO } first; int n; } V;
 *     -> contains V -> first ; contains E -> B_ONE, B_TWO   (the tag names it)
 *
 *   typedef union { struct { int x; } pt; int n; } W;
 *     -> contains W -> pt ; contains W.pt -> x              (#950/#958)
 *
 * Measured over the four declared corpora (3,997 files): 17 members across 6 files
 * -- curl's `pl_unix_substate` (7 inline enums in one union) and
 * `pl_winNT_substate` (3) and `ftp_parselist_data` (1) in ftplistparser.c,
 * `stub_gss_ctx_id_t_desc` in curl_gssapi.c, `OperationConfig` in tool_cfgable.h
 * (curl), and libgit2's `reftable_ref_record`, `reftable_log_record` and
 * `refdb_reftable_stack_iterator`.
 *
 * This is the same defect class as #958 (a member under a placeholder owner),
 * reached from a different direction: the owner here is a REAL name, just the
 * wrong one, so nothing looks broken.
 *
 * The controls are the readings that must not change: a tagged inline enum (its own
 * tag is the owner, unchanged), an inline struct (the #950/#958 path, unchanged), a
 * FUNCTION-local anonymous enum (there is no member path, so #961's scope rule must
 * still own it), two function-local enums in one file (which must not collide), and
 * an anonymous enum in a NESTED inline aggregate, where the path has to compose two
 * levels.
 */
typedef union {
  enum { A_ONE, A_TWO } first;      /* THE DEFECT: an anonymous inline enum */
  int n;
} U;

typedef union {
  enum E { B_ONE, B_TWO } first;     /* CONTROL: a tagged inline enum owns itself */
  int n;
} V;

typedef struct {
  struct { int x; int y; } pt;       /* CONTROL: #950/#958, already correct */
  int n;
} W;

typedef struct {
  enum { C_ONE, C_TWO } mode;        /* THE DEFECT again, in a struct not a union */
  int n;
} X;

int f(int in) {
  enum { L_ONE, L_TWO } e;           /* CONTROL: #961 -- a function-local enum has
                                       no member path, so the enclosing function
                                       is still the owner */
  return in + e;
}

int g(void) {
  enum { M_ONE, M_TWO } e;           /* CONTROL: a second local enum must not
                                       collide with the first */
  return e;
}

typedef struct {
  struct { struct { int deep; } inner; int shallow; } mid;
  int top;
} Nested;
