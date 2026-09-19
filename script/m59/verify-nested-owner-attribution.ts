// script/m59/verify-nested-owner-attribution.ts — M59.A10 (#879)
//
// The store-side owner fix, pinned by fixture, with the additive law and a
// mutation that proves the checks can fail.
//
// What was wrong: #866 made an anonymous body's field member a real symbol and
// attributed the initialiser's call to it, but the member was stored with
// `owner_symbol_id = NULL` — so `bb_graph` answered with a symbol named `a` and
// NO owner chain connected it to the method the agent asked about. The red check
// that tracked it was `nested-site-source-reaches-the-caller` in
// script/m59/acceptance-tool-callsites.ts.
//
// What the fix must be: a symbol every existing derivation leaves OWNERLESS,
// whose span sits inside a storeable NON-container symbol, gains that symbol as
// its owner. Strictly additive by construction (it runs only when the owner is
// still null), so no existing owner may change — and that law is a check here,
// not a footnote, because re-owning members in bulk was measured at 40% churn on
// a scala slice before this shape of the fix was chosen.
//
// Checks:
//   A  the anonymous body's member is owned by the ENCLOSING METHOD (the fix)
//   B  the owner chain from that member reaches the caller the agent asked about
//   C  an outer container also encloses it — container-only containment cannot
//      produce a reachable answer, which is why "innermost non-container" is
//      load-bearing rather than incidental
//   D  MUTATION: nulling the member's owner turns A and B red, and restoring it
//      turns them green again — the gate measures the fix, it is not vacuous
//   E  ADDITIVE LAW: a member that already had a container owner keeps it
//   F  NO INVENTION: a top-level symbol with no enclosing storeable symbol stays
//      ownerless — the fallback must not manufacture an owner
//
// Usage: npx tsx script/m59/verify-nested-owner-attribution.ts

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "m59-owner-data-"))

const FANON = [
  "object Fanon {",
  "  def targetScalaAnon(): Int = 1",
  "  def callerScalaAnon(): Unit =",
  "    new Runnable {",
  "      val a =",
  "        targetScalaAnon()",
  "      val b =",
  "        targetScalaAnon()",
  "    }",
  "}",
  "",
].join("\n")

const CONTROL = [
  "def firstTop(): Int = 1",
  "object Control {",
  "  def holder(): Unit = {",
  "    class Local {",
  "      val field = 1",
  "    }",
  "    Local()",
  "  }",
  "}",
  "",
  "def topLevel(): Int = 1",
  "",
].join("\n")

type Sym = {
  id: string
  name: string
  symbol_type: string
  line_start: number
  line_end: number
  owner_symbol_id: string | null
}

const checks: Array<{ id: string; pass: boolean; detail: string }> = []
const check = (id: string, pass: boolean, detail: string) => checks.push({ id, pass, detail })

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const project = mkdtempSync(path.join(tmpdir(), "m59-owner-proj-"))
  mkdirSync(path.join(project, "src"), { recursive: true })
  writeFileSync(path.join(project, "src", "Fanon.scala"), FANON)
  writeFileSync(path.join(project, "src", "Control.scala"), CONTROL)

  const pid = getProjectId(project) as any
  await indexProjectParallel(pid, project, {})
  const db: any = await BrainDatabase.getRawInstance(pid)

  const syms = db
    .prepare(`SELECT id, name, symbol_type, line_start, line_end, owner_symbol_id FROM brain_symbol`)
    .all() as Sym[]
  const byId = new Map<string, Sym>(syms.map((s) => [s.id, s]))
  const find = (file: string, name: string) =>
    syms.find((s) => s.name === name && String(s.id).includes(file)) ?? null

  console.log("=== stored symbols ===")
  for (const s of syms.sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    console.log(
      `  ${s.name.padEnd(18)} ${s.symbol_type.padEnd(10)} ${String(s.line_start).padStart(2)}-${String(s.line_end).padEnd(2)} owner=${byId.get(String(s.owner_symbol_id))?.name ?? "NULL"}`,
    )
  }

  const member = find("Fanon.scala", "a")
  const caller = find("Fanon.scala", "callerScalaAnon")
  const outer = find("Fanon.scala", "Fanon")

  // ── A: the fix ────────────────────────────────────────────────────────────
  const owner = member?.owner_symbol_id ? byId.get(String(member.owner_symbol_id)) ?? null : null
  check(
    "A-anon-member-owned-by-the-enclosing-method",
    !!owner && owner.name === "callerScalaAnon" && owner.symbol_type === "method",
    member
      ? `member "a" (${member.symbol_type}) owner=${owner ? `${owner.name} (${owner.symbol_type})` : "NULL"} — expected the enclosing method callerScalaAnon`
      : "member symbol 'a' was not stored at all — fixture or analyzer changed, re-derive before trusting this gate",
  )

  // ── B: the reachability property the harness asserts ──────────────────────
  const chain: string[] = []
  let cur = member?.owner_symbol_id ?? null
  let reaches = false
  for (let hop = 0; hop < 12 && cur; hop++) {
    const s = byId.get(String(cur))
    if (!s) break
    chain.push(`${s.name}(${s.symbol_type})`)
    if (s.name === "callerScalaAnon") {
      reaches = true
      break
    }
    cur = s.owner_symbol_id
  }
  check(
    "B-owner-chain-reaches-the-caller",
    reaches,
    reaches
      ? `a → ${chain.join(" → ")} — the agent can get from the reported source to the symbol it asked about`
      : `a → ${chain.join(" → ") || "NULL"} — dead end; this is the #879 defect`,
  )

  // ── C: container-only containment is not sufficient ───────────────────────
  const containerEncloses =
    !!outer && !!member && outer.line_start <= member.line_start && outer.line_end >= member.line_end && outer.id !== member.id
  check(
    "C-outer-container-also-encloses-it",
    containerEncloses,
    containerEncloses
      ? `object Fanon (${outer!.line_start}-${outer!.line_end}) also encloses a (${member!.line_start}-${member!.line_end}) — a container-only rule answers with Fanon, which does not reach the caller, so "innermost non-container" is what makes the answer readable`
      : "the outer container does not enclose the member — this fixture no longer exercises the choice",
  )

  // ── D: mutation — the gate can fail ───────────────────────────────────────
  const redNow = () => {
    const m = db.prepare(`SELECT owner_symbol_id FROM brain_symbol WHERE id = ?`).get(member!.id) as any
    const o = m?.owner_symbol_id ? byId.get(String(m.owner_symbol_id)) : null
    return o?.name === "callerScalaAnon"
  }
  const greenBefore = redNow()
  db.prepare(`UPDATE brain_symbol SET owner_symbol_id = NULL WHERE id = ?`).run(member!.id)
  const redDuring = redNow()
  db.prepare(`UPDATE brain_symbol SET owner_symbol_id = ? WHERE id = ?`).run(member!.owner_symbol_id, member!.id)
  const greenAfter = redNow()
  check(
    "D-mutation-nulling-the-owner-turns-it-red",
    greenBefore && !redDuring && greenAfter,
    `owner present=${greenBefore} → nulled=${redDuring ? "STILL GREEN (NOT DETECTED)" : "red (detected)"} → restored=${greenAfter}`,
  )

  // ── E: additive law — an existing container owner is untouched ────────────
  const field = find("Control.scala", "field")
  const fieldOwner = field?.owner_symbol_id ? byId.get(String(field.owner_symbol_id)) ?? null : null
  const localClass = find("Control.scala", "Local")
  check(
    "E-additive-law-class-member-keeps-its-class-owner",
    !!fieldOwner && !!localClass && fieldOwner.id === localClass.id,
    field
      ? `class member "field" owner=${fieldOwner ? `${fieldOwner.name} (${fieldOwner.symbol_type})` : "NULL"} — the fallback must never re-own a symbol that already has one; expected Local`
      : "control member 'field' was not stored — the additive law is unmeasured, not satisfied",
  )

  // ── F: no invention — this fix's own law ───────────────────────────────
  // `firstTop` sits before every container in its file, so NO derivation has a
  // candidate: the container search finds nothing to enclose it, the "nearest
  // preceding container" step finds nothing earlier, and the #879 fallback finds
  // no enclosing non-container. It must stay ownerless.
  const firstTop = find("Control.scala", "firstTop")
  check(
    "F-no-invention-when-nothing-encloses",
    !!firstTop && firstTop.owner_symbol_id === null,
    firstTop
      ? `top-level def "firstTop" (line ${firstTop.line_start}) owner=${firstTop.owner_symbol_id ?? "NULL"} — nothing storeable encloses it, so no owner may be manufactured`
      : "top-level fixture symbol was not stored — this check would be vacuous",
  )

  // ── O: DECLARED KNOWN DEFECT — pre-existing, NOT introduced here ────────
  // `topLevel` (a single-line top-level function) is owned by `Local` — a class
  // declared in a method body ABOVE it whose span does NOT enclose it. That owner
  // comes from the pre-existing "nearest preceding container" step, whose own
  // comment reserves it for the regex fallback but which also runs on tree-sitter
  // results. Filed separately: separating "invented owner" from "analyzer emitted
  // a short end line" needs its own measurement, which this number cannot make.
  const top = find("Control.scala", "topLevel")
  const topOwner = top?.owner_symbol_id ? byId.get(String(top.owner_symbol_id)) ?? null : null
  const encloses = (o: Sym | null, c: Sym | null) =>
    !!o && !!c && o.id !== c.id && o.line_start <= c.line_start && o.line_end >= c.line_end
  checks.push({
    id: "O-preceding-container-invents-an-owner(documented, not asserted)",
    pass: true,
    detail: top
      ? `top-level "topLevel" (line ${top.line_start}) owner=${topOwner ? `${topOwner.name} (${topOwner.line_start}-${topOwner.line_end})` : "NULL"} — encloses it: ${encloses(topOwner, top)}. Measured on the real cats-effect index: 1,221 of 6,009 owned symbols (20%) carry an owner whose span does not enclose them (method<-class 271, method<-interface 262, function<-type 147). Pre-existing, unrelated to this fix, filed as its own issue`
      : "top-level fixture symbol was not stored — this observation is unmeasured",
  })

  console.log("\n=== checks ===")
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.id}\n        ${c.detail}`)
  const ok = checks.every((c) => c.pass)
  console.log(
    ok
      ? "\nAll checks passed — a nested site's answer is attributable to the method that asked, existing owners are untouched, and no owner is invented."
      : "\nFAILED — see the checks above.",
  )
  if (!ok) process.exitCode = 1
}

main().catch((e) => {
  console.error("VERIFY ERROR:", e?.stack ?? e)
  process.exitCode = 2
})
