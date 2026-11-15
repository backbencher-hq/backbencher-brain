/* c/macro-type-member-985 -- a macro in TYPE position is not a member name.
 *
 * The ADJACENT defect is already ruled and pinned by `c/macro-generated-field`
 * (#928): when a macro OWNS the member's name (`BIT(closing);`), the declaration
 * carries no declarator at all, `fieldDeclarationHasDeclarator` refuses it, and
 * the honest result is silence.
 *
 * This is the shape #928's test cannot see. When the macro is the TYPE and a
 * SEPARATE declarator names the member, a declarator IS present -- so the
 * #928 refusal does not fire -- but the extractor's per-child loop treats every
 * child that is not a type node as a DECLARATOR, and a `macro_type_specifier`
 * was in neither list:
 *
 *   git_array_t(size_t) line_index;
 *
 *     field_declaration
 *       macro_type_specifier    <- the TYPE; its first identifier is the MACRO
 *       field_identifier        <- the real member
 *
 * So both were published, and the payload carried a member no C declaration in
 * the file gives to any member:
 *
 *   contains git_blame -> git_array_t   <- phantom; clang reports it as PHANTOM
 *   contains git_blame -> line_index    <- correct, and unaffected
 *
 * Measured over the four declared corpora (3,997 files): 60 phantom `contains`
 * edges, 48 of them sitting beside the correct member, across 19 macro names --
 * git_array_t x13 (libgit2), ql_elm x11 / ql_head x5 / rb_node x5 (jemalloc),
 * STACK_OF (curl), HRESULT and ULONG (libgit2's winhttp header), GIT_ALIGN, and
 * C++-header debris (noexcept, decltype, operator) that tree-sitter-c parses out
 * of libstdc++/libc++.
 *
 * This is NOT C-D2. Whether the macro EXPANDS to a whole aggregate is
 * unrecoverable, and no member is invented for one -- but the real member is
 * right there in the parse and was already published. Only the duplicate goes.
 *
 * The controls are the readings that must not change: an object-like macro used
 * as a type (which parses as a plain `type_identifier`, never a macro node), the
 * #928 shape itself, a real member beside the macro-typed one, and the macro as
 * a plain file-scope function call -- which stays a `calls` edge.
 */
#define git_array_t(type) struct { type *ptr; size_t size, asize; }
#define MYINT int
#define BIT(x) int x : 1
#define ALIGN8(x) x __attribute__((aligned(8)))

struct array_field {
  int head;
  git_array_t(int) payload;        /* THE DEFECT: macro is the TYPE */
  int tail;
};

struct array_field_ptr {
  git_array_t(struct entry) entries;  /* same, behind a pointer declarator */
  int other;
};

struct two_macros {
  git_array_t(size_t) index;
  git_array_t(int) counts;
  int both;
};

struct controls {
  MYINT plain;                  /* CONTROL: object-like macro, parses as type_identifier */
  int ordinary;
  unsigned real_bit : 1;        /* CONTROL: a real bitfield */
  void (*callback)(int);        /* CONTROL: declarator inside the declarator */
  BIT(closing);                 /* CONTROL: #928's shape, still silent */
};

struct aligned_field {
  ALIGN8(int) slot;             /* macro_prefixed_type_specifier spelling */
  int after;
};

int use_macro(void);
int use_macro(void)
{
  git_array_t(int) inside = { 0, 0, 0 };   /* a local, not a member */
  return inside.size;
}
