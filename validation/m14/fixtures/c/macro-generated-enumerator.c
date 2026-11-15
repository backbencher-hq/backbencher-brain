/* c/macro-generated-enumerator -- an enumerator the analyzer cannot NAME must
 * not be published from a macro invocation's ARGUMENTS.
 *
 * Found 2026-09-28 (M14/M60 C wave) on the curl corpus, in `include/curl/curl.h`:
 * curl declares its option table through a macro that stands where an enumerator
 * belongs, and the parse cannot keep the invocation together:
 *
 *   #define CURLOPT(id, type, num) CURLOPT_##id = num
 *   typedef enum {
 *     CURLOPT(CURLOPT_WRITEDATA, CURLOPTTYPE_CBPOINT, 1),
 *     CURLOPT(CURLOPT_URL,      CURLOPTTYPE_CBPOINT, 2),
 *     PLAIN_MEMBER = 3,
 *   } CURLoption;
 *
 * which the pinned grammar reads as an `enumerator_list` holding ERROR nodes for
 * the macro's punctuation and BARE `enumerator(identifier)` fragments between
 * them -- one per argument. The extractor read every `enumerator` as a real
 * member, so each invocation published its ARGUMENTS as enum members:
 * `CURLOPTTYPE_CBPOINT` twenty-one times under `CURLoption`, `CURLOPT_WRITEDATA`
 * beside it, and a `contains` edge onto each. Measured on the corpus: 41
 * duplicate member names in curl, 41 in libgit2, 19 in redis -- the two phantoms
 * per invocation being the reason they collide.
 *
 * The real enumerator name is `CURLOPT_WRITEDATA` only AFTER token pasting, so it
 * is not derivable (C-D2). Silence is the honest result.
 *
 * The controls are the readings that must not change: a real enumerator in the
 * SAME damaged list (`PLAIN_MEMBER`, which sits between two macro invocations and
 * is still a clean enumerator), a plain enum, a real bitfield-free value, and an
 * enumerator with an explicit value.
 */
#define CURLOPT(id, type, num) CURLOPT_##id = num
#define CURLOPTTYPE_CBPOINT 7

typedef enum {
  CURLOPT(CURLOPT_WRITEDATA, CURLOPTTYPE_CBPOINT, 1),
  CURLOPT(CURLOPT_URL, CURLOPTTYPE_CBPOINT, 2),
  PLAIN_MEMBER = 3,
  ANOTHER_PLAIN,
} CURLoption;

enum plain_enum {
  ONE = 1,
  TWO = 2,
};

enum single_invocation {
  CURLOPT(CURLOPT_ONLY_ONE, CURLOPTTYPE_CBPOINT, 1),
  REAL_AFTER = 2,
};

/* #931, second half: a FUNCTION-LIKE macro name is not a macro USE here, because
   no `(` follows it. redis/src/server.h declares `double min, max;` 3,700 lines
   after its own `#define min(a, b) ...`, and those really are the field names --
   the `,` after each is not a `(`. The first corpus run reported them as
   macro-named phantoms; both the rule and the census measure were wrong about C.
   The same distinction inside an ENUM: an enumerator is followed by `,`, `=` or
   `}`, never by `(`, so an enumerator named after a function-like macro is real. */
#define FN_LIKE_MACRO(x) ((x) + 1)
#define OBJ_LIKE_MACRO 9

enum function_like_is_real {
  FN_LIKE_MACRO = 1,
  REAL_AFTER_FN = 2,
};

enum object_like_is_not {
  OBJ_LIKE_MACRO,
  REAL_AFTER_OBJ,
};
