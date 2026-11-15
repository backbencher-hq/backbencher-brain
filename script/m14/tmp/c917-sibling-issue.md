Filed out of #917, which recovers the **value-return** spelling of a macro-wrapped heading
(`CMPP__EXPORT(int, cmpp_stream)(…)`) and deliberately does not fold in this one.

## The shape

```c
CMPP__EXPORT(void *, cmpp_mrealloc)(void * p, size_t n){
  return sqlite3_realloc64(p, n);
}
```

The heading is still call-shaped, but its **first macro argument is a pointer type**. That
changes the parse in a way #917's gate does not cover: the body never arrives as an orphan
`compound_statement`, so there is no body to attach.

## Measured (production entry `parseFile`, isolated snippets)

| site | name | root children of the snippet | definition extracted |
| --- | --- | --- | --- |
| `ext/wasm/libcmpp.c:5514` | `cmpp_rc_cstr` | `function_definition` | no |
| `ext/wasm/libcmpp.c:5529` | `cmpp_mrealloc` | `declaration, ERROR` | no |
| `ext/wasm/libcmpp.c:5533` | `cmpp_malloc` | `function_definition` | no |
| `ext/wasm/libcmpp.c:6102` | `cmpp_dx_delim` | `function_definition` | no |
| `ext/wasm/libcmpp.c:9526` | `cmpp_b_reuse` | `function_definition` | no |
| `ext/wasm/libcmpp.c:9714` | `cmpp_b_borrow` | `function_definition` | no |

In the whole-file run, **5 of the 6 names exist only as the `#define`d macro constant** from
the file's thunk block (`cmpp_b_borrow@3623`, `cmpp_b_reuse@3630`, `cmpp_dx_delim@3648`,
`cmpp_malloc@3668`, `cmpp_mrealloc@3670`) — the definition is not a symbol. `cmpp_rc_cstr`
keeps its name only because a **prototype** exists earlier (`L219 char const * cmpp_rc_cstr(int rc);`);
its definition still contributes nothing.

For all six the definition's body, its scope and its reads are absent — the same consequence
as #917, reached by a different parse.

## Why it is separate, and why it is filed rather than counted

* The `function_definition` spelling needs its own name-resolution route: the declarator holds
  the macro's own argument list, so the name never reaches a `function_declarator`.
* The `declaration, ERROR` spelling (5529) is recovery-shaped like the giant-ERROR sites, not
  like #917's orphan body.
* Census: **6 sites, 1 file (`ext/wasm/libcmpp.c`), 0 in jq.** The F5 c lane derives no truth
  edge at any of them either, so the whole-corpus lane cannot see this class — which is exactly
  why it is an issue instead of a row.

The #917 fixture's rationale records the refusal (`validation/m14/fixtures/c/macro-wrapped-heading-917.c`
header comment: "NOT part of this class, and deliberately NOT in this fixture"), and its pins
cover the value-return class only.

Close-out needs the same shape of evidence any recovery does: the four-corpus A/B with every
change classified, a fixture with teeth for each spelling, and a regression mutant.
