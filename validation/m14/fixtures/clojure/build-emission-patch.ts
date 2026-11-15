#!/usr/bin/env bash
# Build the READY-TO-APPLY emission patch for the CLOJURE `packageScope` claim, WITHOUT touching
# the working tree. It writes validation/m14/proposals/clojure-package-scope-emission.patch and
# then PROVES the patch applies cleanly to the current analyzer and reverses cleanly again.
#
# The patch is a PROPOSAL: it is NOT applied here, because the shared arbiter's semantics change
# (the Lead's) must land FIRST — a lane-side emission published before the instrument exists
# would read `ext?` on every row, and published after the manifest reader but before the
# semantics change it would read `extFAIL` on 977 rows.
set -euo pipefail
cd "$(dirname "$0")/../../../.."      # the repo root (validation/m14/fixtures/clojure -> root)
ROOT="$PWD"
WORK=".tmp-clj-patchbuild"
rm -rf "$WORK"
mkdir -p "$WORK/a/src/ast" "$WORK/b/src/ast"
cp src/ast/real-clojure-analyzer.ts "$WORK/a/src/ast/real-clojure-analyzer.ts"
cp src/ast/real-clojure-analyzer.ts "$WORK/b/src/ast/real-clojure-analyzer.ts"

python3 - "$WORK/b/src/ast/real-clojure-analyzer.ts" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p).read()

old_roots = '''    {
      // Mirrors `incoming-rule.ts namespaceMatchOf` exactly: split the target on `.`, `::`
      // and `:`, and test prefixes longest-first. A claim attached only where a prefix
      // matches cannot be refuted by the verifier's own rule.
      const LANGUAGE_NAMESPACE_ROOTS = ["clojure", "cljs", "js", "goog", "java", "javax"]
'''
new_roots = '''    // THE CLOSED LANGUAGE/RUNTIME ROOT SET — ONE LIST, TWO CLAIMS. It is hoisted out of the
    // CLJ-EX2 block so the CLJ-EX5 dependency-membership claim below uses the SAME list rather
    // than a second copy: a duplicated constant is a second source of truth, and this one decides
    // which rows are the LANGUAGE's business and which are a DEPENDENCY's.
    const LANGUAGE_NAMESPACE_ROOTS = ["clojure", "cljs", "js", "goog", "java", "javax"]
    {
      // Mirrors `incoming-rule.ts namespaceMatchOf` exactly: split the target on `.`, `::`
      // and `:`, and test prefixes longest-first. A claim attached only where a prefix
      // matches cannot be refuted by the verifier's own rule.
'''
assert old_roots in s, "the CLJ-EX2 root-list block was not found — the patch base has moved"
s = s.replace(old_roots, new_roots)

anchor = '''      }
    }

    this.classifyEvidenceTier(relationships)
'''
emission = '''      }
    }

    // ── CLJ-EX5 (2026-10-20): THE DEPENDENCY-MEMBERSHIP CLAIM ──────────────────────────────────
    //
    // WHAT IT STATES. "This target is a MEMBER of the DEPENDENCY named `package`" — and the only
    // evidence that can answer it is the PROJECT'S OWN MANIFEST. The claim already exists in the
    // shared arbiter (`incoming-rule.ts`'s `PACKAGE_SCOPE_CLAIM_KEY`); what was missing was a lane
    // that emits it and a manifest reader that can check it.
    //
    // THE EMISSION CONTRACT, MEASURED BEFORE THE CLAIM WAS PROPOSED (the lane's own price
    // instrument, `validation/m14/fixtures/clojure/package-scope-price.ts`, whole admitted
    // population, farm root): publishing the claim on EVERY libspec the file declares gives
    // **629 rows the project's manifest confirms** (calls 299 · references 290 · imports 40) and
    // **977 rows it does not** — which, under the Lead's 2026-10-20 semantics ruling, are
    // UNVERIFIABLE rather than REFUTED, so they stay unresolved and count against clause 1. The
    // lane GAINS on the 629 and LOSES NOTHING on the 977, and it CANNOT filter them: whether a
    // project declares a dependency is a PROJECT fact a one-file analyzer cannot see. The 629/977
    // split is therefore the CONTROL on the shared change — it must not move.
    //
    // WHY IT MUST NOT OVERLAP THE NAMESPACE CLAIM. The arbiter reads `packageScope` BEFORE
    // `languageNamespace` (the manifest is the stronger evidence), so a row carrying both would
    // lose the namespace claim's answer. The two are DISJOINT by construction: the namespace claim
    // fires only for a root IN the closed language/runtime set, and this one only for a root
    // OUTSIDE it.
    //
    // THE LIBSPEC IS MATCHED, NOT SPLIT. A Clojure libspec is `babashka.fs` (a namespace) OR
    // `io.replikativ/datalog-parser` (a maven coordinate), and a coordinate contains a `/` of its
    // own — so splitting the TARGET at a fixed slash would cut the namespace in half. The libspec
    // set is matched instead, LONGEST FIRST, and the member is what follows it.
    {
      const libspecs = new Set<string>()
      for (const im of imports) {
        const m = String((im as any)?.module ?? "")
        if (m.length > 0) libspecs.add(m)
      }
      const libspecList = [...libspecs].sort((a, b) => b.length - a.length)
      for (const r of relationships) {
        const md = r.metadata as Record<string, any> | undefined
        if (!md || md.packageScope !== undefined) continue
        const tgt = typeof r.target === "string" ? r.target : ""
        if (tgt.length === 0) continue
        let member = ""
        let lib = ""
        for (const l of libspecList) {
          if (tgt === l) { member = l; lib = l; break }
          if (tgt.startsWith(l + "/")) { member = tgt.slice(l.length + 1); lib = l; break }
        }
        if (member.length === 0 || lib.length === 0) continue
        // A LANGUAGE/RUNTIME namespace is the `languageNamespace` claim's business, not this one's.
        const root = lib.split(".")[0]!
        if (LANGUAGE_NAMESPACE_ROOTS.includes(root)) continue
        md.packageScope = { package: lib, name: member }
      }
    }

    this.classifyEvidenceTier(relationships)
'''
assert anchor in s, "the CLJ-EX2 block end was not found — the patch base has moved"
s = s.replace(anchor, emission, 1)
open(p, 'w').write(s)
print("patched the working copy")
PYEOF

( cd "$WORK" && git diff --no-index --src-prefix=a/ --dst-prefix=b/ a/src/ast/real-clojure-analyzer.ts b/src/ast/real-clojure-analyzer.ts > "$ROOT/validation/m14/proposals/clojure-package-scope-emission.patch" || true )
# The header must name the REAL path, so `git apply` finds it.
python3 - "$ROOT/validation/m14/proposals/clojure-package-scope-emission.patch" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace("a/a/src/ast/", "a/src/ast/").replace("b/b/src/ast/", "b/src/ast/")
open(p, 'w').write(s)
PYEOF

echo "--- PROOF: the patch applies cleanly to the CURRENT analyzer, and reverses cleanly ---"
BEFORE=$(git hash-object src/ast/real-clojure-analyzer.ts)
git apply --check validation/m14/proposals/clojure-package-scope-emission.patch && echo "  git apply --check: CLEAN"
git apply validation/m14/proposals/clojure-package-scope-emission.patch
APPLIED=$(git hash-object src/ast/real-clojure-analyzer.ts)
echo "  applied: $BEFORE -> $APPLIED"
git apply --check --reverse validation/m14/proposals/clojure-package-scope-emission.patch && echo "  git apply --check --reverse: CLEAN"
git apply --reverse validation/m14/proposals/clojure-package-scope-emission.patch
AFTER=$(git hash-object src/ast/real-clojure-analyzer.ts)
if [ "$BEFORE" = "$AFTER" ]; then echo "  the working tree is byte-identical again: $AFTER"; else echo "  *** THE TREE DID NOT COME BACK ***"; exit 1; fi
rm -rf "$WORK"
echo "patch written: validation/m14/proposals/clojure-package-scope-emission.patch ($(wc -l < validation/m14/proposals/clojure-package-scope-emission.patch) lines)"
