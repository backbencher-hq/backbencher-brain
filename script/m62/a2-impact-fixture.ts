// script/m62/a2-impact-fixture.ts — M62.A2 R6 (issue #878): the fixture for
// the impact surface's position law.
//
// WHY A DEDICATED FIXTURE. `computeImpact` publishes a dependent's position
// TWICE, and a gate that only exercises one of them gates half the bug class:
//
//   1. the PROVISIONAL write, from the engine's edge address, for every entry;
//   2. the DEPTH-CORRECTED write, when M63.T2's measurement moved an entry's
//      depth off the engine's first-trace stamp — and that write is the one
//      that read the raw stored column.
//
// The second path has two preconditions, both of which this file exists to
// create, and both of which the gate ASSERTS rather than assumes:
//
//   (a) `countVerification` must RUN. `computeImpact` pays for the counting walk
//       only when the walk reached the last expandable depth (maxDepth - 1 = 4)
//       AND that level has dependents of its own. So the fixture carries a
//       chain six deep — `k6` sits at depth 5, the walk's maxDepth — plus `k7`,
//       which calls `k6`. Without `k7` the boundary level is a leaf,
//       `boundarySuspect` is false, and the counting walk never runs.
//
//   (b) an entry's MEASURED depth must DIFFER from the engine's first-trace
//       stamp, or the correction block `continue`s before it re-reads
//       anything. The engine walks depth-first and stamps the first trace; the
//       counting walk is breadth-first and reports the shortest. `t` calls BOTH
//       `mid1` (so it is reachable at depth 2 through `p1`) and `p2` (so its
//       shortest path is depth 1). The engine expands `p1` first — it orders
//       same-file callers by line, and `p1`'s row is the earlier line — so the
//       first trace stamps 2 and the measurement says 1.
//
//   (c) the re-read row must carry a stored line DIFFERENT from the dependent's
//       own declaration line, or "served the raw stored line" and "published
//       the declaration" are the same bytes and a gate comparing them would pass
//       for the wrong reason. `t`'s declaration is its `def t():` line; its two
//       call rows are on later lines.
//
// ONE file, deliberately: the engine's caller ordering is by relative path, so
// splitting the chain and the diamond across files would make the DFS order (and
// therefore the depth stamps the whole fixture depends on) a property of the
// filenames.

/** The fixture source. Python, because M59 gives it real stored lines — which
 *  is what makes the §15.3 difference between "the declaration" and "the call
 *  site" a DIFFERENCE OF BYTES rather than two undefined values. */
export const IMPACT_SOURCE = `def r0():
    return 0

def p1():
    return r0()

def p2():
    return r0()

def mid1():
    return p1()

def t():
    a = mid1()
    b = p2()
    return a + b

def k1():
    return r0()

def k2():
    return k1()

def k3():
    return k2()

def k4():
    return k3()

def k5():
    return k4()

def k6():
    return k5()

def k7():
    return k6()
`

export const IMPACT_FILES: Record<string, string> = { "impact_fix.py": IMPACT_SOURCE }

/** The symbol the gate roots the impact answer at, and the one whose depth MUST
 *  move (precondition (b)). Named so the gate can assert the movement rather
 *  than hope for it. */
export const IMPACT_ROOT = "r0"
/** The entry whose measured depth must differ from the engine's stamp. */
export const DEPTH_CORRECTED_SYMBOL = "t"

/** The 1-based line a fixture function's DECLARATION is on, found by scanning for
 *  `def <name>(` — never counted by hand (the discipline and its reason are in
 *  a2-language-fixture.ts). Null when absent, which the gate treats as a
 *  fixture defect rather than a product finding. */
export function declarationLine(files: Record<string, string>, name: string): number | null {
  const pattern = new RegExp(`^def\\s+${name}\\s*\\(`)
  for (const body of Object.values(files)) {
    const lines = body.split("\n")
    for (let i = 0; i < lines.length; i++) if (pattern.test(lines[i] ?? "")) return i + 1
  }
  return null
}

/** The 1-based lines of every CALL of `callee` in the fixture, found by scanning.
 *  The callee's own `def <callee>(` line is excluded — a declaration is not a
 *  call, and including it here would make "the line the store pointed at" and
 *  "the line the callee is declared on" the same number, which is precisely the
 *  distinction this fixture exists to keep sharp.
 *
 *  Used to prove the re-read row's stored line is the CALL and neither the
 *  dependent's declaration nor the callee's. */
export function callLines(files: Record<string, string>, callee: string): number[] {
  const call = new RegExp(`\\b${callee}\\s*\\(`)
  const declaration = new RegExp(`^\\s*def\\s+${callee}\\s*\\(`)
  const out: number[] = []
  for (const body of Object.values(files)) {
    body.split("\n").forEach((text, i) => {
      if (!declaration.test(text) && call.test(text)) out.push(i + 1)
    })
  }
  return out.sort((a, b) => a - b)
}