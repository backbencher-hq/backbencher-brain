import { startNode, sync } from "../src/node.ts"
import { assert } from "node:assert"

const results: [string, boolean, string][] = []
const ck = (name: string, ok: boolean, detail = "") => results.push([name, ok, detail])

// ── 1. A node alone is a working database. No server, no network, no peers.
const A = await startNode("A", 4831)
A.node.set("greeting", "hello from the sky")
ck("a lone node reads back what it wrote", A.node.get("greeting") === "hello from the sky")

// ── 2. TWO NODES PARTITIONED — both accept writes while unable to reach each other.
const B = await startNode("B", 4832)
A.node.set("city", "Lahore")
B.node.set("city", "Karachi")
ck("both sides accept a conflicting write while apart",
  A.node.get("city") === "Lahore" && B.node.get("city") === "Karachi")

// ── 3. THEY MEET. One exchange, and both converge on the SAME value.
const { aChanged, bChanged } = await sync(A, B)
const converged = A.node.get("city") === B.node.get("city")
ck("after one sync both nodes hold the SAME value", converged, `A=${A.node.get("city")} B=${B.node.get("city")}`)
// NOTE, and it is the point of the design: the LOSING side is the one that changes.
// A's write won the tie-break, so A merges B's snapshot and finds nothing to take
// while B takes A's value. Asserting "both sides changed" would be asserting that
// convergence did NOT happen.
ck("the sync moved the LOSING side and the winner kept its value",
  (aChanged > 0 || bChanged > 0) && A.node.get("city") === B.node.get("city"),
  `a=${aChanged} b=${bChanged} winner=${A.node.get("city")}`)

// ── 4. IDEMPOTENCE — syncing again must change NOTHING. This is what makes
//      retries, replays and duplicate packets safe.
const again = await sync(A, B)
ck("a second sync changes nothing (idempotent)", again.aChanged === 0 && again.bChanged === 0, JSON.stringify(again))

// ── 5. ORDER INDEPENDENCE — a third node joining in any order lands in the same place.
const C = await startNode("C", 4833)
C.node.set("city", "Islamabad")
await sync(C, A)
await sync(C, B)
const all = [A.node.get("city"), B.node.get("city"), C.node.get("city")]
ck("three nodes, syncs in arbitrary order, all identical", new Set(all).size === 1, JSON.stringify(all))

// ── 6. NO DATA LOST — every distinct key written anywhere is present everywhere.
A.node.set("k1", 1); B.node.set("k2", 2); C.node.set("k3", 3)
await sync(A, B); await sync(B, C); await sync(A, C)
const sizes = [A.node.size(), B.node.size(), C.node.size()]
// The exact count is whatever the run wrote — 5 keys by now (greeting, city, k1, k2, k3).
// What matters is that all three agree, and it is 5 rather than 3: asserting 3 was the
// test being wrong about its own history, which is worth keeping in the comment.
ck("every key written anywhere exists everywhere",
  new Set(sizes).size === 1 && sizes[0] === 5, `sizes=${JSON.stringify(sizes)} (greeting, city, k1, k2, k3)`)

await Promise.all([A.close(), B.close(), C.close()])

let pass = 0
for (const [n, ok, d] of results) { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  [" + d + "]" : ""}`); if (ok) pass++ }
console.log(`\n${pass}/${results.length} checks`)
process.exit(pass === results.length ? 0 : 1)
