// validation/m14/fixtures/c/field-access-offsetof-955.c
// M14 C fixture: a field named inside a macro ARGUMENT is a use of that field.
//
// Written for the field-access `uses` adjudicator, after it reported 74 phantom
// over-emissions in redis/src and every one of them turned out to be this shape.
// The evidence is cluster_legacy.h:268-284, seventeen consecutive lines of
//
//   static_assert(offsetof(clusterMsg, sig) == 0, "unexpected field offset");
//   static_assert(offsetof(clusterMsg, totlen) == 4, "unexpected field offset");
//   ...
//
// `sig` there is not a field ACCESS -- there is no `->` and no `.`; it is a bare
// identifier passed as a macro argument, and the parse has no `field_expression`
// for it at all. The payload nevertheless publishes, correctly:
//
//   uses global -> sig   relationshipType "identifier_usage"
//                               nodeType          "field_identifier"
//
// on the right line, from file scope. The adjudicator's parse-side model only knew
// `field_expression`, so a correct edge looked like a phantom, and 74 rows is
// exactly the size of a finding that would have been "fixed" by deleting them.
//
// That is the same failure #908 already recorded for call edges, one relationship
// type over, and the reason this row exists: a CORRECT behaviour with no fixture
// pinning it is a behaviour one refactor away from being removed as a bug. The
// M12 truth cannot catch it either, because the truth pins `uses` only for
// `a->x` field access and says nothing about a field named in a macro argument.
//
// The static assertions are the load-bearing case -- they are how a C project
// pins its wire-format struct layout, so dropping the edges would lose the only
// record that these fields are load-bearing at all.

#include <stddef.h>

#define STATIC_ASSERT(cond, msg) _Static_assert(cond, msg)

struct header {
  unsigned char sig;
  unsigned int totlen;
  unsigned int count;
  char *sender;
};

struct envelope {
  struct header head;
  int payload_len;
};

/* The pinned case: a bare field name as a macro argument, at file scope. */
STATIC_ASSERT(offsetof(struct header, sig) == 0, "sig must stay at offset 0");
STATIC_ASSERT(offsetof(struct header, totlen) == sizeof(unsigned int), "totlen offset");
STATIC_ASSERT(offsetof(struct envelope, payload_len) != 0, "payload is not first");

/* A field access through the same struct, which must ALSO be published. */
int header_length(const struct header *h) {
  return (int)h->totlen;
}

/* The control that must NOT move: an assignment TARGET publishes no `uses` edge.
 * `uses` is a read relation, and the M12 truth's demand for one here is the open
 * contract question -- not something this fixture settles in either direction. */
void header_set_count(struct header *h, unsigned int n) {
  h->count = n;
}

/* A macro-mediated read, to show the argument form is not special-cased. */
#define HEADER_SIG(h) ((h)->sig)

int header_sig(const struct header *h) {
  return HEADER_SIG(h) ? 1 : 0;
}
