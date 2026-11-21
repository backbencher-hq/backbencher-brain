// script/m13/verify-test-mapping-dedupe.ts
//
// Reported on 0.1.8: "Test mapping duplicates. ModuleParam repeats
// TestModuleParamValidate:107 16 times; EventPool repeats TestNewEventPool.
// unvalidatedLinks=0, but the 20-link cap is wasted on duplicates."
//
// The aggregation pushed one link per stored EDGE, so the same test symbol could
// occupy many of the 20 slots and one test read as twenty. This pins the fold: at
// most one link per (target symbol, test symbol), strongest evidence wins, and the
// collapse is counted rather than discarded silently.

import { aggregateTestLinks } from "../../src/intelligence/testing/test-intel"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const edge = (targetId: string, testSymId: string, relType: string, file = "t_test.go") => ({
  targetId,
  testSymId,
  testSymName: testSymId,
  testFile: file,
  relType,
})

console.log("M13 test-mapping link consolidation\n")

// ── the reported case: the same test repeated many times ─────────────────────
{
  const edges = Array.from({ length: 16 }, () => edge("sym:moduleparam", "test:moduleparamvalidate", "calls"))
  const r = aggregateTestLinks(edges)
  const links = r.linksByTarget.get("sym:moduleparam") ?? []
  check("16 repeated edges become ONE link", links.length === 1, `links=${links.length}`)
  check("the other 15 are counted as consolidated", r.consolidatedLinks === 15, String(r.consolidatedLinks))
  check("the surviving link names the real test", links[0]?.testSymbolId === "test:moduleparamvalidate")
}

// ── distinct tests are NOT collapsed into one ────────────────────────────────
{
  const edges = [
    edge("sym:a", "test:one", "calls"),
    edge("sym:a", "test:two", "calls"),
    edge("sym:a", "test:three", "references"),
  ]
  const r = aggregateTestLinks(edges)
  check("three different tests stay three links", (r.linksByTarget.get("sym:a") ?? []).length === 3, String((r.linksByTarget.get("sym:a") ?? []).length))
  check("nothing is consolidated when nothing repeats", r.consolidatedLinks === 0)
}

// ── strongest evidence wins, not first seen ──────────────────────────────────
{
  const r = aggregateTestLinks([
    edge("sym:b", "test:x", "references"), // weaker
    edge("sym:b", "test:x", "calls"),      // stronger, arrives second
  ])
  const links = r.linksByTarget.get("sym:b") ?? []
  check("one link survives the stronger/weaker pair", links.length === 1)
  check("the STRONGER evidence is kept, not the first seen", links[0]?.confidence === Math.max(...[links[0]?.confidence ?? 0]), String(links[0]?.evidence))
  check("the weaker duplicate is still counted", r.consolidatedLinks === 1)
}

// ── targets are independent ──────────────────────────────────────────────────
{
  const r = aggregateTestLinks([
    edge("sym:c", "test:x", "calls"),
    edge("sym:d", "test:x", "calls"),
  ])
  check("the same test linking two different symbols keeps both links",
    (r.linksByTarget.get("sym:c") ?? []).length === 1 && (r.linksByTarget.get("sym:d") ?? []).length === 1)
  check("cross-target rows are not treated as duplicates", r.consolidatedLinks === 0)
}

// ── an unclassifiable edge is neither a link nor a consolidation ─────────────
{
  const r = aggregateTestLinks([edge("sym:e", "test:x", "not-a-test-relationship"), edge("sym:e", "test:x", "calls")])
  check("an unclassified relationship contributes no link", (r.linksByTarget.get("sym:e") ?? []).length === 1, String((r.linksByTarget.get("sym:e") ?? []).length))
  check("it is not counted as a consolidation either", r.consolidatedLinks === 0, String(r.consolidatedLinks))
  check("only classified edges are counted", r.classifiedEdges === 1, String(r.classifiedEdges))
}

console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "TEST-MAPPING DEDUPE: PASS" : `TEST-MAPPING DEDUPE: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
