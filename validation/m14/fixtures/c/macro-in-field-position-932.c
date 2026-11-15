/* c/macro-in-field-position-932 -- a bare macro token in FIELD position.
 *
 * Found 2026-09-28 (M14/M60 C wave) on the redis corpus, at
 * deps/jemalloc/include/jemalloc/internal/tsd.h:255. jemalloc writes a bare macro
 * where a field belongs:
 *
 *   #define TSD_DATA_SLOW 1
 *   #define O(n, t, nt)  t TSD_MANGLE(n);
 *   typedef unsigned char tsd_state_t;
 *
 *   struct tsd_s {
 *   #define O(n, t, nt)  t TSD_MANGLE(n);   <- a #define INSIDE a struct body
 *     TSD_DATA_SLOW
 *     tsd_state_t state;
 *     TSD_DATA_FAST
 *   };
 *
 * which is legal C -- the preprocessor does not care about braces -- and which the
 * grammar reads as:
 *
 *   field_declaration { type_identifier(TSD_DATA_SLOW) field_identifier(tsd_state_t) ";" MISSING }
 *   field_declaration { type_identifier(state) ";" }
 *
 * The extractor published `tsd_state_t` -- a TYPE -- as a member of `tsd_s`, a
 * symbol a reader can navigate to that resolves to nothing.
 *
 * #932 SUPPRESSES and does not MEND. The real member (`state`) is one token away in
 * the next declaration's type slot, and a two-token mend whose generality was not
 * measured would be exactly the fabrication recovery risks; so the phantom is
 * removed and the loss of `state` is declared instead. The trade is deliberate: a
 * phantom member is a symbol that exists and is wrong, which is worse than a
 * member that is absent and recorded as absent.
 *
 * The controls are the two readings that make the rule SOUND rather than a shape
 * heuristic:
 *   - `struct type_named_member { struct S T; };` -- a member may LEGALLY share a
 *     spelling with a type in the same file (the declarator is an ordinary
 *     identifier; the tag is in its own namespace). It has no MISSING `;`, so the
 *     rule must not touch it. This is the case that would make a
 *     "name-slot-is-a-type" test alone wrong, and it is the reason the MISSING
 *     token is required.
 *   - a plain field, an array field and a function-pointer field: unchanged.
 *   - a #define inside a struct body with NO bare token after it: the shape the
 *     jemalloc construct reduces to when the macro is the whole field.
 */
#define TSD_DATA_SLOW 1
#define TSD_DATA_FAST 2
#define O(n, t, nt) t TSD_MANGLE(n);
typedef unsigned char tsd_state_t;

struct tsd_s {
#define O(n, t, nt) t TSD_MANGLE(n);
  TSD_DATA_SLOW
  tsd_state_t state;
  TSD_DATA_FAST
};

struct S;

/* CONTROL: a member whose name is spelled exactly like a type in the same file.
 * Legal C, and the reason the MISSING `;` is part of the rule. */
struct type_named_member {
  struct S S;
  int plain;
  int arr[4];
  void (*callback)(int);
};

/* CONTROL: a #define inside a struct body where the next field is well formed --
 * the #define alone must change nothing. */
struct define_only {
#define LATER_MACRO(x) ((x) * 2)
  int kept;
  int also_kept;
};
