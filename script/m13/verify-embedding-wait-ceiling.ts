// script/m13/verify-embedding-wait-ceiling.ts
//
// The bb_ask / bb_search wait ceiling is a DEFAULT that an explicit
// BB_EMBEDDING_TIMEOUT_MS RAISES. The defect this pins:
//
//   waitCeilingMs = Math.min(providerBound, EMBEDDING_WAIT_CEILING_MS)  // 2000
//
// so a caller setting BB_EMBEDDING_TIMEOUT_MS=15000 still waited 2000 ms, then
// answered from the 50-dimension local space without any way to ask for more
// time. Measured by the owner on 0.1.8: "setting 15000 still reported 2000, and
// the first query fell back to the 4% local space".
//
// The assertions below are the arithmetic contract, run against a SUPPLIED env so
// the gate is deterministic regardless of the ambient shell.

import { resolveEmbeddingWaitMs, EMBEDDING_WAIT_CEILING_MS, EMBEDDING_WAIT_HARD_MAX_MS } from "../../src/intelligence/search/semantic-search"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) {
    console.log(`  ok: ${label}`)
  } else {
    failures++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

console.log("M13 embedding wait ceiling\n")

check("default ceiling constant is 2000 ms", EMBEDDING_WAIT_CEILING_MS === 2000, String(EMBEDDING_WAIT_CEILING_MS))
check("hard maximum is 60000 ms", EMBEDDING_WAIT_HARD_MAX_MS === 60_000, String(EMBEDDING_WAIT_HARD_MAX_MS))

// ── unset: the fast read-tool default ─────────────────────────────────────────
check("unset env -> 2000 ms (a read tool must not block for 30 s)", resolveEmbeddingWaitMs({}) === 2000, String(resolveEmbeddingWaitMs({})))
check("empty env -> 2000 ms", resolveEmbeddingWaitMs({ BB_EMBEDDING_TIMEOUT_MS: "" }) === 2000)
check("non-numeric env -> 2000 ms", resolveEmbeddingWaitMs({ BB_EMBEDDING_TIMEOUT_MS: "not-a-number" }) === 2000)
check("zero env -> 2000 ms", resolveEmbeddingWaitMs({ BB_EMBEDDING_TIMEOUT_MS: "0" }) === 2000)
check("negative env -> 2000 ms", resolveEmbeddingWaitMs({ BB_EMBEDDING_TIMEOUT_MS: "-5000" }) === 2000)

// ── the reported defect: an explicit value must RAISE the bound ───────────────
check(
  "THE REPORTED DEFECT: BB_EMBEDDING_TIMEOUT_MS=15000 -> 15000 ms, not 2000",
  resolveEmbeddingWaitMs({ BB_EMBEDDING_TIMEOUT_MS: "15000" }) === 15000,
  `got ${resolveEmbeddingWaitMs({ BB_EMBEDDING_TIMEOUT_MS: "15000" })}`,
)
check("5000 -> 5000 ms (still raisable above the 2 s default)", resolveEmbeddingWaitMs({ BB_EMBEDDING_TIMEOUT_MS: "5000" }) === 5000)
check("1000 -> 1000 ms (a caller may also ask for LESS than the default)", resolveEmbeddingWaitMs({ BB_EMBEDDING_TIMEOUT_MS: "1000" }) === 1000)

// ── bounded: a typo must not hang a tool call ────────────────────────────────
check(
  "a huge value is capped at the hard maximum (a typo cannot hang the tool)",
  resolveEmbeddingWaitMs({ BB_EMBEDDING_TIMEOUT_MS: "999999999" }) === EMBEDDING_WAIT_HARD_MAX_MS,
  String(resolveEmbeddingWaitMs({ BB_EMBEDDING_TIMEOUT_MS: "999999999" })),
)
check("the hard maximum itself is honoured exactly", resolveEmbeddingWaitMs({ BB_EMBEDDING_TIMEOUT_MS: "60000" }) === 60_000)

console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "WAIT CEILING: PASS" : `WAIT CEILING: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
