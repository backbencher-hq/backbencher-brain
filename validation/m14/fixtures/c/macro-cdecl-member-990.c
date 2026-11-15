/* c/macro-cdecl-member-990 — the fixture for the member-name walk descending into an
 * ERROR node and publishing a CALLING-CONVENTION MACRO as a member.
 *
 * The shape is sqlite src/sqlite3ext.h:112 verbatim:
 *
 *     char *(SQLITE_CDECL*mprintf)(const char*,...);
 *
 * A function-pointer member whose calling convention is a MACRO. It is not legal C
 * without expansion, so tree-sitter recovers it as
 *
 *     parenthesized_declarator
 *       ERROR(field_identifier)                                  <- SQLITE_CDECL, the MACRO
 *       pointer_declarator declarator: (field_identifier)        <- mprintf,     the MEMBER
 *
 * `parenthesized_declarator` carries no `declarator` FIELD, so the member-name walk fell
 * to `namedChild(0)` -- the ERROR -- and returned the macro. Measured against clang 14
 * (`contains-vs-clang.ts --dir <sqlite>/src --max-files 120`): 33 records / 421 members,
 * 414 agreed = 98.34%, and BOTH halves of the defect were in one struct:
 *
 *   PHANTOM  contains sqlite3_api_routines -> SQLITE_CDECL          x7
 *   MISSED   contains sqlite3_api_routines -> mprintf, xsnprintf, test_control,
 *            db_config, log, vtab_config, str_appendf              x7
 *
 * Reporting only the phantom count would have understated the defect by half, which is
 * why this fixture asserts BOTH directions and the gate below measures both.
 */

/* --- the subject: exactly sqlite's spelling, macro DEFINED in this file so the walk
 *     has no excuse to reach for it. `SQLITE_CDECL` expands to nothing. */
#define C990_CDECL

struct c990_routines {
  int  n;
  char *(C990_CDECL*mprintf)(const char *, ...);
  void *(*plain_cb)(void *, int);
  int  (*returns_int)(int, int);
  void (*void_cb)(void);
  void *(*array_of_cb[3])(void);
  void (*(*cb_returning_cb)(int))(void);
};

/* --- CONTROLS, each one a shape a looser fix would cost. --- */

/* #947's subject, which must STAY silent. The macro owns the name and the declaration
 * carries NO declarator at all: `GIT_CALLBACK(closing);` declares nothing the parse can
 * name. #928's rule is unchanged by #990 and this row proves it. */
#define C990_CALLBACK(x) (*x)
struct c990_macro_generated {
  int a;
  C990_CALLBACK(closing);
  int b;
};

/* #985's subject. A macro in TYPE position beside a real declarator: the member is
 * `lines`, and the macro's own name must not be published beside it. */
#define C990_ARRAY_T(type) struct { type *ptr; int n; }
struct c990_macro_typed {
  C990_ARRAY_T(long) lines;
};

/* A plain member whose name is an ordinary identifier -- the shape every fixture in this
 * lane asserts, so a fix that over-reaches (skipping any child that is not an
 * identifier, or dropping the walk's first step) shows up as a MISSING row. */
struct c990_plain {
  int plain_member;
  char *named_member;
  int arr[4];
};

/* The union arm of the same walk. #990 changes BOTH member-name walks -- the struct one
 * and the union one -- because they were two copies of the same defect, and a fix
 * applied to only one would leave half the corpus broken with no signal. */
union c990_u {
  int i;
  char *(C990_CDECL*ufn)(void);
};

/* An ERROR-wrapped member name in a FUNCTION position, not a field: #916-C already
 * handles this walk, and #990 must not change it. */
C990_CDECL int c990_fn_ptr(int, int);