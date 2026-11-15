import io

p = "reviews/onboarding.md"
s = io.open(p, encoding="utf-8").read()

bullet = (
    "- `reviews/m60-924-qualified-declarator-name.md` — M60 **#924, cpp's second name-surface class** (the "
    "include-name fix was the first): a macro standing where the return type begins makes the cpp grammar "
    "rejoin the type to the declarator as **extra qualifier segments separated by whitespace only** — the "
    "qid's `::` separator carries a token with EMPTY text — so the outer-segment name read published "
    "`system_error vwindows_error` owned by a class `system_error` (`fmt/os.h:122`), and inlined genuine "
    "owners into names (`SocketWriter::MakeConnection`, `Outer::Inner::step`). The fix is one **structural** "
    "rule, `qualifiedDeclaratorLeaf`: the name is the DEEPEST segment, and the segment above it is an owner "
    "only when a real `::` token joins them; it is exported by the analyzer and imported by the F5 oracle "
    "(#916), which is why the differential reads clean on both corpora and the **fixture is the independent "
    "gate**. A/B against HEAD over both pinned cpp corpora (570 files, same tree, both implementations): "
    "non-macro whitespace symbol names **52 → 19** (the 19 are `operator` spellings, the language's own rule; "
    "the other **825 whitespace names are the deliberate #919 macro-heading contract**, "
    "`metadata.expandedFrom === \"macro-heading\"`), symbols **17,391 → 17,391**, **152** symbols reclassified "
    "`method → function` (they were members of a class that does not exist), **2** constructors now detectable, "
    "`metadata.nameLine` **unchanged** (the #921 line contract), and the whole edge delta (**−73**) is the "
    "rename moving the edges that name the child — **no resolution lost**. Verified: `fmt:cpp` 4876/4876 "
    "MISSING=0 / unexplained=0 / heuristic=0 and `nlohmann-json:cpp` 1017/1017 likewise (scoped F5 at these "
    "bytes); cpp fixtures **18/18** (new `cpp/qualified-declarator-name-924`; `cpp/bare-value-reads`'s CP7 pin "
    "moves `Inner::step → step`, the qualified spelling *was* this defect), c **18/18**; cpp mutants **24/24** "
    "(new `cpp/qualified-declarator-name-glue`, faithful by construction — re-derived from the result's own "
    "source line, real-`::` prefixes left alone, both edge endpoints moved). NOT claimed: cpp's R10 conviction "
    "at these bytes is no longer about symbol names — it is `calls` targets that are source text (lambdas, "
    "assignments, compound literals: **224 sites** measured on the tree), and that separate class is sized in "
    "the record with the rule that would close it, not folded into this commit.\n"
)

lesson = (
    "- **Mutant filters are code, not prose:** `cpp/nested-scope-silence` filtered on the literal edge source "
    "`Inner::step` — a spelling that was *itself* the defect — so the #924 name fix silently disarmed it and "
    "the lane reported **SURVIVED** until the filter was re-keyed in the same commit. A mutant that names a "
    "symbol spelling must be re-keyed whenever that spelling changes; the only signal is `SURVIVED`, and it "
    "arrives only if the lane is re-run. A mutant suite that is not re-run after a rename is a suite that "
    "quietly stopped testing.\n"
)

# 1) the round bullet at the end of the review list (before the Review-wave protocol heading)
anchor = "\n## Review-wave protocol (how external reviews get processed)"
assert anchor in s
s = s.replace(anchor, "\n" + bullet + anchor, 1)

# 2) the standing lesson, immediately before the closing "No claim without a re-run" lesson
tail = "- **No claim without a re-run:**"
assert tail in s
s = s.replace(tail, lesson + tail, 1)

io.open(p, "w", encoding="utf-8").write(s)
print("inserted:", len(bullet), len(lesson))
