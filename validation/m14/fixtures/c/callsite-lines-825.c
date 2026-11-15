// fixture: c/callsite-lines-825
// M59 (#825): a relationship's line_number is the line of the node that NAMES
// it, never the line of the construct that contains it. Three C-shaped traps are
// pinned here, each measured on real corpora:
//   1. a newline-continued function-pointer member call — `call_expression`
//      starts at the RECEIVER, so a construct-start line stamps the call one
//      line early (the scala/java/groovy chain defect, in C's node shape);
//   2. a wrapped `struct` specifier — the specifier starts at the KEYWORD while
//      the tag is written on the next line (measured: jq jv_dtoa.c 512/513);
//   3. an include carries the line of its path.
// The forbidRelationships entries are exactly those pre-fix shapes.
#include <stdio.h>
#include "counters.h"

struct
Tally {
  int total;
};

struct
Counters {
  int hits;
  int misses;
  int (*record)(struct Counters *, int);
};

static int helper(int v) {
  return v + 1;
}

struct
Tally *seed(struct Tally *t, int n) {
  t->total = helper(n);
  return t;
}

static int record_impl(struct Counters *c, int n) {
  c->hits = c->hits + helper(n);
  c->misses = c->misses + 1;
  return c->hits;
}

int run(struct Counters *c, int n) {
  c->record = record_impl;
  return c
      ->record(c, n);
}
