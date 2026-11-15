/* c/self-referential-struct-927 -- curl's cf-h1-proxy.c shape, and a HARD CRASH.
 *
 * Found 2026-09-28 (M14/M60 C wave) on the curl corpus:
 * `curl/lib/cf-h1-proxy.c` made `RealCAnalyzer.analyze` die with
 * "RangeError: Maximum call stack size exceeded" -- 1 crash in 900 curl files,
 * against a lane that documents a crash guarantee of 0.
 *
 * The root cause is NOT illegal C and NOT a self-referential struct. C keeps
 * TAG names (`struct X`, `enum X`) and ORDINARY identifiers (typedef names) in
 * separate namespaces, so this file is perfectly legal:
 *
 *   typedef enum { KEEPON_DONE, KEEPON_CONNECT } h1_tunnel_state;   <- an ENUM
 *   struct h1_tunnel_state {                                        <- a STRUCT TAG
 *     ...
 *     h1_tunnel_state tunnel_state;    /* the field is ENUM-typed * /
 *     ...
 *   };
 *
 * The field's type text is the bare word `h1_tunnel_state`, which names BOTH
 * entities. `calculateMemorySize` resolved a member's type by BARE NAME against
 * the struct map, found the STRUCT (same string), and recursed into the struct's
 * own field list -- which contains that field -- for ever. `calculateAlignment`
 * carried the identical unbounded recursion one function away.
 *
 * So the honest shape of the rule is about the NAMESPACE, not about cycles: a
 * member whose type is spelled through a tag (`struct S`) resolves in the struct
 * map, a member whose type is a typedef resolves through whichever entity that
 * typedef actually names, and a member whose type names something with no
 * by-value layout (an enum, a function pointer, an unknown typedef) contributes
 * its platform size rather than recursing. A genuine by-value self-member is
 * illegal C and has no computable size, so it is bounded rather than followed.
 *
 * The controls beside it: an ordinary nested struct by value (the recursion that
 * IS legal and must keep working), a pointer self-reference (the legal C idiom),
 * and a struct whose name no enum shadows.
 */
typedef enum tunnel_phase {
  TUNNEL_IDLE,
  TUNNEL_DONE
} tunnel_state;                    /* the ENUM, through a typedef */

/* the collision: that typedef and a struct tag with the same spelling */
struct tunnel_state {
  int a;
  int b;
  tunnel_state phase;             /* the field is ENUM-typed, via the typedef */
  int c;
};

/* CONTROL 1: an ordinary nested struct BY VALUE -- legal, and the recursion
 * that has always worked. */
struct outer_ok {
  int head;
  struct tunnel_state nested;
  int tail;
};

/* CONTROL 2: the legal C idiom for a self-referential type. */
struct list_node {
  int value;
  struct list_node *next;    /* a POINTER: never followed */
  struct list_node *prev;
};

/* CONTROL 3: a struct tag that no enum shadows. */
struct plain_holder {
  int only;
};
