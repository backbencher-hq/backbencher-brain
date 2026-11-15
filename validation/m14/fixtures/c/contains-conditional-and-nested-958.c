// validation/m14/fixtures/c/contains-conditional-and-nested-958.c
// M14 C fixture: `contains` for a member inside a preprocessor CONDITION, and for a
// member of a nested anonymous aggregate whose outer aggregate is itself anonymous.
//
// Both defects were found by `contains-vs-clang.ts`, the first oracle in this lane to
// judge `contains` against a parser that is not the one the analyzer uses. Every
// tree-sitter-based counter had reported both files as CLEAN, because the payload and
// the grammar agree with each other -- and that agreement is not evidence about the
// grammar. A member the grammar never produces as a `field_declaration` cannot be
// found by a probe that looks for `field_declaration`.
//
// #957 -- a member inside `#ifdef`/`#else`. The parse puts the `preproc_ifdef` as a
// DIRECT child of the `field_declaration_list` with no `field_declaration` at that
// level, so iterating named children found nothing and the struct was published with
// a symbol and ZERO contains edges. redis/src/eventnotifier.h:19-25 is the real input:
//
//   typedef struct eventNotifier {
//   #ifdef HAVE_EVENT_FD
//       int efd;
//   #else
//       int pipefd[2];
//   #endif
//   } eventNotifier;
//
// Both arms are published, because the preprocessor is textual (C-D2): the analyzer
// cannot know which arm the project compiles with, and the honest superset is both.
// `efd` and `pipefd` coexisting is a true statement about the two possible
// compilations -- the same shape as the macro-mediated members #908 already requires.
//
// #958 -- a nested member under a PLACEHOLDER owner. `inlineAggregateOwnerName` asked
// the enclosing aggregate for its own name, and an anonymous union has only the
// placeholder, so `CallReply.val.verbatim_str.str` was published as
// `anonymous_union.verbatim_str -> str` (redis/src/call_reply.c:30-38). The correct
// path composes from the member that CARRIES the outer aggregate.
//
// The controls at the bottom are what must SURVIVE: a member with a plain name, a
// bitfield, a named nested struct, and an assignment TARGET inside a conditional
// (which publishes no `uses` edge -- see field-access-offsetof-955, the open
// write-vs-read contract question).

#define WIDTH 32

/* #957: the whole member list lives under a conditional. */
typedef struct guarded {
#ifdef GUARD_ALT
  int primary;
#else
  long long fallback;
#endif
  int always;
} guarded;

/* #958: an anonymous union, holding an anonymous struct, inside a named struct. */
struct envelope {
  int tag;
  union {
    const char *text;
    struct {
      const char *text;
      const char *format;
    } verbatim;
    long long number;
  } body;
};

/* A NAMED nested struct must keep its own name, not a placeholder. */
struct named_outer {
  struct {
    int inner_a;
    int inner_b;
  } group;
  int tail;
};

/* Controls: plain, bitfield, and array members. */
struct controls {
  int plain;
  unsigned int bits : 3;
  int array[4];
  struct named_outer named;
};

#ifdef GUARD_ALT
int guarded_alt_only(void) { return 1; }
#endif
#ifndef GUARD_ALT
int guarded_default_only(void) { return 2; }
#endif

/* A call guarded by a conditional is still a call -- the #956 control. */
int helper(int v);
int uses_controls(const struct controls *c) {
  return helper(c->plain) + helper(c->bits) + helper(c->array[0]) + helper(c->named.plain);
}

/* An assignment TARGET under a conditional: publishes no `uses` (see #955). */
#ifdef GUARD_ALT
void guarded_write(struct guarded *g, int v) { g->primary = v; }
#endif
