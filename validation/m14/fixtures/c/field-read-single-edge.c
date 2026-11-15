/* c/field-read-single-edge -- one field NAME OCCURRENCE, one `uses` edge.
 *
 * The defect this pins (found 2026-09-28, M14/M60 C wave, measured 2,369
 * occurrences over 80 redis files and 274 over the C fixtures + a curl slice):
 * a field read published TWO `uses` edges for one occurrence --
 *
 *   uses f -> value   relationshipType=field_access      confidence 0.9   (the field_expression)
 *   uses f -> value   relationshipType=identifier_usage  confidence 1.0   (its own field_identifier leaf)
 *
 * because the two emission branches keyed the SHARED dedup set differently
 * (`${scope}::uses::${name}` against `${scope}::use::${name}`), so the set could
 * not see that they were the same edge. Consequences beyond the count: one fact
 * carried two confidences (a `confidenceThreshold` filter returns both, and they
 * disagree), and one fact split across two `relationshipType` vocabularies, so
 * any count BY relationshipType splits a single semantic event in half.
 *
 * Which edge survives is a decision, not an accident, and this fixture states it:
 * the `field_access` edge, because it is the one that carries the receiver
 * (`accessedFrom`). The leaf-level `identifier_usage` spelling of the same name
 * is a re-read of the node the parent already reported.
 *
 * CONTROLS, each the shape that must NOT change:
 *   - the WRITE (`c->count = 0`, `c->count += 1`): an assignment LHS names the
 *     field being assigned; it is not a read, so no `uses` at all;
 *   - the CALLEE (`t->hook(x)`): a member call is a `calls` edge, and the field
 *     leaf must stay silent (CGD31);
 *   - the plain value read of the same global field, which is the one legitimate
 *     `identifier_usage` and must survive.
 */
struct point {
  int value;
  int count;
  int (*hook)(struct point *);
};

static int global_value;

int read_field(struct point *p) {
  int local = p->value;          /* ONE uses edge for `value` */
  return local + p->count + global_value;
}

int read_dot(struct point *p) {
  return p->value;               /* the `.` spelling of the same read */
}

void write_field(struct point *c, int v) {
  c->count = 0;                  /* a WRITE: no uses count */
  c->count += 1;                 /* a compound write: no uses count */
  c->value = v;
}

static int hook_impl(struct point *p) {
  return p->value;               /* the callee's own body is still a read */
}

int call_hook(struct point *t) {
  return t->hook(t);             /* a CALL: calls edge only, no uses hook */
}
