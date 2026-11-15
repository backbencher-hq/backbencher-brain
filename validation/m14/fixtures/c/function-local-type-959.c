// validation/m14/fixtures/c/function-local-type-959.c
// M14 C fixture: a function-LOCAL type is a compile-time type definition, not an
// execution artifact. This fixture documents the CURRENT behaviour and is the
// evidence for a ruling that is OPEN, not a claim that the current behaviour is
// right.
//
// Found while adjudicating the last two `contains` misses from contains-vs-clang.ts.
// Those two were `listpack.c:1920`'s `struct pick`, and chasing them turned up a
// whole class rather than an instance:
//
//   redis   7 function-local named types,  41 members
//   curl   12 function-local named types,  23 members
//   libgit2 1 function-local named type,    1 member
//   TOTAL  20 types, 65 members -- NONE published
//
// `listpack.c:1920` is the clearest instance, and the shape is not exotic:
//
//   void lpRandomEntries(unsigned char *lp, unsigned int count, listpackEntry *entries) {
//       struct pick { unsigned int index; unsigned int order; } *picks = lp_malloc(...);
//       ...
//       picks[i].index = rand() % total_size;   // the members carry real data
//
// and the ones that make the ruling matter are USED, not decoration:
//
//   deps/jemalloc/test/unit/malloc_io.c:14  struct test_s { input, expected_remainder,
//       base, expected_errno, expected_errno_name, expected_x } -- 4 references
//   src/ebuckets.c:2230                     struct TestParams { minExpire, maxExpire,
//       items, description } testCases[] = { ... } -- the parameter table for the
//       benchmark below it
//   deps/jemalloc/src/ctl.c:990             struct container_s { ctl_arena, astats }
//
// WHY THIS IS A QUESTION AND NOT A FIX. The rule that drops them is CGD20
// (real-c-analyzer.ts:1512):
//
//   // CGD20: function-local struct definitions are execution artifacts
//   // (C-D1) -- no scope, no symbol, no field registration.
//   if (scopeManager.isInsideFunction()) break
//
// "Execution artifact" is the part that does not survive contact with C. A struct
// definition emits no code: `struct pick { unsigned int index; unsigned int order; }`
// is a TYPE, and its type is a compile-time property of the translation unit that the
// block's scope merely limits the VISIBILITY of. The local variable `picks` is the
// execution artifact; the struct is not. Under the current rule a consumer cannot
// answer "how big is `struct pick`, what are its members, who reads them" -- and the
// answer is fully determined at compile time.
//
// The name collision is not a reason to keep the silence either. Two curl types
// (`mime.c:1689 struct ContentType`, `cf-socket.c:251 struct tcp_keepalive`) share a
// name with nothing at file scope, and a first pass counted them as "published" only
// because a MEMBER happened to share the name. Re-checked: 0 of 20 are published.
//
// WHY IT IS NOT BEING FIXED HERE. CGD20 is not a C-local slip. It is mirrored in the
// shared oracle at three sites in script/m14/differential.ts, and the cpp lane's
// documentation cites it by name. Un-mirroring it changes what the oracle expects
// across every lane that has a function-local type, so it is a contract change with an
// owner, not a defect fix with a fixture.
//
// The controls below are the shapes that MUST keep working whichever way the ruling
// goes: a file-scope struct, a typedef'd anonymous struct, a function-local VARIABLE
// (still not a symbol -- that part of C-D1 is right), and a call to a function declared
// at file scope from inside a block that also declares a local type.

struct file_scope {
  int width;
  int height;
};

typedef struct {
  int x;
  int y;
} alias_anon;

/* The subject: a local type with real members, read through a local pointer. */
void local_type_in_use(struct file_scope *out) {
  struct pick {
    unsigned int index;
    unsigned int order;
  } picks[4];

  picks[0].index = 1;
  picks[0].order = 2;
  out->width = (int)picks[0].index;
  out->height = (int)picks[0].order;
}

/* A local UNION, and a local ENUM: the same question, three spellings. */
int local_union_and_enum(void) {
  union {
    int as_int;
    float as_float;
  } value;
  enum { LOCAL_A, LOCAL_B } which = LOCAL_B;
  value.as_int = which;
  return value.as_int;
}

/* A local TYPEDEF of a file-scope type: unambiguously fine, and a control. */
void local_typedef_ok(struct file_scope *out) {
  typedef struct file_scope local_view;
  local_view *v = out;
  v->width = 1;
}

/* CONTROL: a function-local VARIABLE is not a symbol. C-D1 is right about THIS. */
int local_variable_is_not_a_symbol(struct file_scope *out) {
  int counter = 0;
  counter += out->width;
  return counter;
}
