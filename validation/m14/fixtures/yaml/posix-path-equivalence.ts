// EQUIVALENCE PROOF for the regex-free `toPosixPath`.
//
// The four regex usages it replaced were `replace(/\\/g, "/")` then `replace(/\/+$/, "")`, on two
// lines. A character walk that is *nearly* the same is a silent behaviour change, so the two are
// run against each other on the shapes that actually reach this function: Windows roots, UNC-ish
// paths, trailing and doubled separators, separator-only strings, and the empty string. The
// ORIGINAL is reproduced here as a local lambda (which is why this probe may contain the regex:
// it is a fixture comparing two implementations, not analyzer source).
const original = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "")

// the analyzer's own implementation, reached through the real module
const m: any = await import("../../../../src/ast/real-yaml-analyzer.ts")
const Cls = Object.values(m).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any
const current = (Cls as any).toPosixPath as (p: string) => string
if (typeof current !== "function") throw new Error("toPosixPath is not reachable — the equivalence proof is measuring nothing")

const CASES = [
  "", "/", "//", "///", "\\", "\\\\", "a", "a/", "a//", "a\\", "a\\\\",
  "C:\\dir\\file.yaml", "C:\\dir\\", "C:\\dir\\\\", "/home/u/p/", "/home/u/p//",
  "/home/u/p", "a/b/c.yaml", "a\\b\\c.yaml", "a/b\\", "\\a\\b\\",
  "C:/already/posix/", "mixed\\and/sep/", "trailing\\", "deep/a/b/c/d/e/",
  "./x/", ".\\x\\", "../y/", "\\\\server\\share\\", "\\\\server\\share\\file.yaml",
]
let bad = 0
for (const c of CASES) {
  const a = original(c), b = current(c)
  const ok = a === b
  if (!ok) bad++
  console.log(`${ok ? "ok  " : "FAIL"} ${JSON.stringify(c).padEnd(30)} original=${JSON.stringify(a).padEnd(24)} walk=${JSON.stringify(b)}`)
}
console.log(`\n${bad === 0 ? "PASS" : "FAIL"} — ${CASES.length - bad}/${CASES.length} inputs identical`)
if (bad) process.exit(1)
