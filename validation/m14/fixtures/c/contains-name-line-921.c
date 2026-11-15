/* #921 (M60-C): a `contains` edge must carry the line that NAMES the child.
 * The shapes below are the ones the M59 Tier A oracle found in the c lane's own
 * residue (they arrive as .h files the product dispatches to cpp, but the C
 * analyzer owns the same rule for the same shapes in .c files):
 *   * a struct member whose type is wrapped, so the name is on the NEXT line;
 *   * the same in a union;
 *   * a nested anonymous aggregate member whose name is written on the CLOSING
 *     line of its declaration.
 * The one-line members beside them are the controls: their declaration start and
 * their name line are the same line, so the two readings cannot disagree.
 */

/* the member type wraps: the declaration starts here, the name is below */
struct Wrapped {
  unsigned long long
      counter;
  int oneline;
};

/* same shape in a union */
union Choice {
  unsigned char
      byte_value;
  unsigned int
      word_value;
};

struct Outer {
  /* the nested aggregate's member name is written on the closing line */
  struct {
    unsigned bits : 1;
  } options;
  int plain;
};
