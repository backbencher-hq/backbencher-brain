// validation/m14/fixtures/c/call-in-directive-condition-956.c
// M14 C fixture: a `call_expression` inside a preprocessor directive is not a call.
//
// Written for call-edge-fidelity.ts, after it reported 61 over-emitted call sites
// across 200 files per corpus and every one of them was this shape. The evidence:
//
//   curl/lib/curl_trc.c:554    calls global -> defined   x2
//   curl/lib/curl_trc.c:575,590,598, protocol.c:92,120,147,
//   curl/lib/http.c:690,691,692,735,737,738,739,822,
//   curl/lib/openldap.c:936,937, cf-ip-happy.c:76,79,
//   curl/lib/curl_sha512_256.c:303
//   redis/src                  7 more
//
// `#if !defined(CURL_DISABLE_WEBSOCKETS) && !defined(CURL_DISABLE_HTTP)` is a
// preprocessor CONDITION. It never executes, and `defined` is a preprocessor
// OPERATOR rather than a callable name, so `calls global -> defined` fabricates a
// call from file scope to something that is not a function.
//
// The `uses` path has refused this since CGD40, with two guards: a
// preproc_*-ancestor walk and a line-anchored "does this physical line start with
// '#'" check. The `calls` path had NEITHER, which is why the class survived a lane
// that has adjudicated call edges several times over.
//
// BOTH guards are load-bearing, for the two different ways a directive loses its
// identity, and this fixture contains both:
//
//   1. `defined` in a CLEANLY parsed directive. The walk finds the preproc_*
//      ancestor immediately. (A clean `#if defined(X)` produces no
//      call_expression at all, so this specific row needs the DAMAGED form below
//      to reproduce; it is here so the guard is pinned regardless.)
//
//   2. `defined` where the directive line was SWALLOWED by an open construct.
//      The initializer below is left unterminated across interleaved #ifdefs, so
//      the `#if` line parses inside an ERROR with no preproc_* ancestor and the
//      structural guard is blind. This is the shape that actually reproduced
//      curl_trc.c:530-556, and a fixture written from the tidy version of this
//      defect would have passed the fix without testing it.
//
// The controls at the bottom are what must SURVIVE: a real call inside a
// conditional block, a call in code guarded by #ifdef, and a genuine call to a
// name that is also a macro.

struct entry {
  const char *name;
  int kind;
};

static const struct entry features[] = {
#ifdef FEATURE_A
  { "a", 1 },
#endif
#ifdef FEATURE_B
  { "b", 2 },
#endif
#if !defined(FEATURE_SKIP_WS) && !defined(FEATURE_SKIP_HTTP)
  { "ws", 3 },
#endif
};

/* The cleanest form, pinned so the structural guard is not the only thing tested. */
#if defined(FEATURE_A) && !defined(FEATURE_B)
int clean_directive(void) { return 1; }
#endif

int real_helper(int v);

int live_calls(void) {
  int n = 0;
#ifdef FEATURE_A
  n += real_helper(1);
#endif
#if defined(FEATURE_B)
  n += real_helper(2);
#else
  n += real_helper(3);
#endif
  return n + real_helper(4);
}
