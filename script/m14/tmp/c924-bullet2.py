import io

p = "reviews/onboarding.md"
s = io.open(p, encoding="utf-8").read()

tail = (
    " NOT claimed: cpp's R10 conviction "
    "at these bytes is no longer about symbol names — it is `calls` targets that are source text (lambdas, "
    "assignments, compound literals: **224 sites** measured on the tree), and that separate class is sized in "
    "the record with the rule that would close it, not folded into this commit.\n"
)
assert tail in s, "bullet tail not found"

new_tail = (
    " **The third class landed in the same round:** that same `calls` class was closed by one rule — *the "
    "callee descent must end on a NAME-BEARING node, else the call has no named callee* (CPPD13's own ruling) "
    "— removing **322 edges (0 added, 0 symbols changed)**: 179 source-text targets and **143 that spelled a "
    "functional CAST** (`calls -> int`, `-> char`, `-> size_t`, where the grammar puts a `primitive_type` in "
    "the callee slot). Class-type and template constructions (`Buffer(1,2)`, `Box<int>(v)`) still emit, which "
    "is the fixture's boundary. A keyword-spelled cast the grammar reads as an `identifier` (`unsigned(x)`, "
    "`short(x)`, `long(x)`: 17 sites) needed the list the **C lane has always had** — "
    "`CPP_BUILTIN_TYPE_KEYWORDS`, mirroring `C_SPECIFIER_KEYWORDS`, a family-parity gap rather than a new "
    "invention — and exactly one `calls -> uint64_t` is left standing on purpose, because a typedef name IS a "
    "legal identifier and refusing it by name would be a heuristic. Acceptance through the production entry: "
    "call targets containing whitespace **224 → 0**, builtin-type targets **18 → 1**; the R10 census for the "
    "lane now reports **no `whitespace` class at all** (anomalyCount 57 → 45, all `delimiter`) and leaves "
    "`whitespaceSubclasses` = the ruled `operatorMember` only. fmt:cpp 4839/4839 and nlohmann-json:cpp "
    "1001/1001, both MISSING=0 unexplained=0 heuristic=0; cpp fixtures 19/19; cpp mutants 25/25. The class is "
    "now gated at corpus level by **F14** (`audit:name-surface`, in `npm run verify` beside F13): no "
    "whitespace call target, no cast target, a whitespace symbol name only in the two deliberate classes, "
    "with a self-test that re-derives the PRE-FIX state from the source and the tree and must fail — 121 "
    "files, 29,076 calls, 0 violations, self-test flags 4/134/2.\n"
)
s = s.replace(tail, new_tail, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("extended")
