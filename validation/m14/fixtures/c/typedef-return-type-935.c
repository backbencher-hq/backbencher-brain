/* c/typedef-return-type-935 -- a function's RETURN TYPE is a type reference.
 *
 * Found 2026-09-28 (M14/M60 C wave) by the lane's truth-drift probe, which
 * compares the PINNED M12 ground truth against the live analyzer row by row. Of
 * 92 pinned facts, 13 had drifted; 12 were explained (6 include edges that became
 * the first-class `imports` kind in M60/#910, 1 an `instantiates` edge the
 * allocator branch had deliberately removed, 5 assignment-LHS rows that a
 * deliberate ruling says are writes rather than reads) -- and ONE was a real
 * missing edge:
 *
 *     rel:Negative.c:references:pick_color:Color
 *     evidence: "bare return type -- in-file type usage -> references"
 *
 * which the analyzer did not emit. The cause is a gate that is one node-type too
 * broad. CGD34's rule is "a bare `identifier` DIRECTLY under a function_definition
 * is the NAME of a phantom function recovered from a macro-mangled declaration"
 * (`static SQLITE_WSD struct Mem3Global {` parses as a function_definition whose
 * direct children are [storage_class, type_identifier(SQLITE_WSD), ERROR,
 * identifier(Mem3Global), compound_statement]). The predicate tested only the
 * PARENT, so it suppressed every direct child -- and a function_definition's
 * direct children include its RETURN TYPE:
 *
 *   function_definition
 *     type_identifier        <- the return type, e.g. `Color f(void)`
 *     function_declarator    <- the name and parameters
 *     compound_statement
 *
 * A return type spelled with a TYPEDEF name is a `type_identifier` in exactly that
 * position, so every function declared with a typedef return type -- the most
 * common C declaration idiom there is -- lost its `references` edge. Measured over
 * 326 corpus files: 2,903 return types pass through the gate, 37 of them name a
 * type the analyzer can resolve, so 37 real edges were missing (31 in redis, e.g.
 * `defragModuleGlobals() returns doneStatus`; 4 in curl; 2 in libgit2).
 *
 * The controls are the two halves that make the narrowing sound rather than a
 * deletion:
 *   - the CGD34 SUBJECT. `static SQLITE_WSD struct Mem3Like { ... }` still
 *     publishes no `uses` for the macro, and still publishes no `uses` for the
 *     struct tag: the phantom's name parses as a bare `identifier` (still
 *     suppressed) and its `type_identifier` sibling is a MACRO, which
 *     `isResolvableUseTarget` refuses for a `type_identifier` because no such
 *     type is declared in the file.
 *   - the return types that were ALWAYS right and must stay right: a struct TAG
 *     and an enum TAG as a return type, a parameter type, a local declaration,
 *     a cast, a `sizeof`, and a POINTER return type.
 */
typedef enum { RED, GREEN, BLUE } Color;
typedef int counter_t;

struct Point {
  int x;
  int y;
};

enum Shade { LIGHT, DARK };

/* THE DEFECT: a typedef name as a return type. */
Color pick_color(int n) {
  if (n < 0) return RED;
  return GREEN;
}

counter_t next_counter(void) {
  return 0;
}

/* CONTROL: a pointer return type, where the typedef is inside a declarator. */
counter_t *counter_slot(void) {
  return 0;
}

/* CONTROL: return types spelled with a TAG were always right. */
struct Point origin(void) {
  struct Point p;
  p.x = 0;
  p.y = 0;
  return p;
}

Shade pick_shade(int n) {
  return n > 0 ? LIGHT : DARK;
}

/* CONTROL: the other type positions were always right. */
int total(int a, Color c) {
  Color local = c;
  int n = (int)sizeof(Color) + (int)local;
  return a + n;
}

/* CONTROL -- the CGD34 subject. The macro decorates a struct definition and the
 * grammar recovers it as a function_definition whose bare `identifier` child is
 * the struct's name; the `type_identifier` child is the MACRO. Neither may
 * become a `uses` target, and neither did before this wave. */
#define SQLITE_WSD
static SQLITE_WSD struct Mem3Like {
  int nPool;
} the_mem3;

void touch_mem3(void) {
  (void)the_mem3.nPool;
}
