// validation/m14/fixtures/c/instantiates-allocated-type-962.c
// M14 C fixture: `instantiates` names the TYPE an allocation produces, not the allocator.
//
// The M12 C truth defines this relationship C-specifically -- "instantiates = allocator
// calls (malloc/calloc/realloc family -- C-specific allocation semantic" -- and pins
// `rel:Module.c:instantiates:buffer_create:malloc`, with the note that "the calls +
// instantiates pair is intentional: call graph fact + allocation".
//
// The analyzer published no `instantiates` at all. Its removal note read: "malloc
// allocates BYTES, not a named type - an Instantiates edge to the literal 'malloc' could
// never resolve to a type symbol and was pure noise." That reasoning is CORRECT about
// the target and wrong about the consequence. Measured across all 25 M12 truths that pin
// an `instantiates` edge, the target is always a TYPE: `Point`, `HashMap`, `List`,
// `Dictionary`, `User`, `UserService`, `MemoryStorage`, `Shape`. C's `-> malloc` was the
// only non-type target in the family.
//
// So the relationship is wanted and the TARGET was wrong. C states the produced type in
// the cast, and in `sizeof`:
//
//   struct Buf *b = (struct Buf *)malloc(sizeof(struct Buf));   cast AND sizeof
//   struct Buf *c = malloc(sizeof(struct Buf));                sizeof only
//   struct Buf *d = (struct Buf *)realloc(d, n);               cast only
//
// Two spellings, both read, because they disagree about which carries the type in
// practice. Both name a type the file DECLARES -- an `instantiates` edge must resolve to a
// type symbol, which is the whole reason `-> malloc` was wrong.
//
// THE CASES THAT MUST PUBLISH NOTHING, which are the ones a naive implementation gets
// wrong. An allocation into `void *` with no cast instantiates no named type, so there is
// no edge; the `calls` edge and `metadata.usesMalloc` already record the allocation, and
// an edge to a type nobody declared could never resolve. That is an absence of a type, not
// an absence of a fact, and conflating the two is what produced the original removal.

#include <stdlib.h>
#include <string.h>

struct Buf {
  int n;
  char *p;
};

struct Node {
  int id;
  struct Node *next;
};

/* Both spellings present. */
struct Buf *buf_alloc(int n) {
  struct Buf *b = (struct Buf *)malloc(sizeof(struct Buf));
  b->n = n;
  return b;
}

/* sizeof only -- no cast. */
struct Node *node_alloc(int id) {
  struct Node *nd = malloc(sizeof(struct Node));
  nd->id = id;
  nd->next = NULL;
  return nd;
}

/* realloc family, cast only. */
struct Buf *buf_grow(struct Buf *old, int n) {
  return (struct Buf *)realloc(old, sizeof(struct Buf));
}

/* TWO allocations of the SAME type in one function: one fact, one edge. The dedup key is
 * the (function, type) PAIR, exactly as for `uses` and `calls` -- a line is not a site. */
struct Node *node_pair(void) {
  struct Node *a = malloc(sizeof(struct Node));
  struct Node *b = malloc(sizeof(struct Node));
  a->next = b;
  return a;
}

/* MUST PUBLISH NOTHING: an untyped allocation. `void *` instantiates no type. */
void *untyped_alloc(size_t n) {
  return malloc(n);
}

/* MUST PUBLISH NOTHING: a cast to a type this file does not declare. C-D2 forbids
 * resolving it, and an `instantiates` edge that cannot resolve is the defect the original
 * removal was trying to avoid -- it is the `-> malloc` case with a different spelling. */
struct Other;
struct Node *cross_file_alloc(struct Other *o);

/* The free side is not an instantiation. */
struct Buf *buf_copy(struct Buf *src) {
  struct Buf *copy = malloc(sizeof(struct Buf));
  copy->n = src->n;
  free(copy);
  return copy;
}

/* strdup allocates, but not a type this file declares -- no edge. */
char *dup(const char *s) {
  return strdup(s);
}