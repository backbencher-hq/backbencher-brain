// script/m64/verify-actionability.ts — M64.A1 + M64.A2 + M64.A3.
//
// Three disclosures, each of which is data the code already had and the report
// did not show. They are grouped because all three fail the same way: a number
// the caller cannot act on, sitting where an actionable one should be.
//
//   A1  integrity reported "92% (0 warnings, 1 errors)" — not WHICH check. The
//       names were in the JSON only, and the documented answer was "run
//       bb_health(integrity=true) for details", a second battery to learn one
//       fact. The check's own remediation was stored and never printed.
//   A2  per-language counts and per-kind embedding counts were both reported and
//       never JOINED, so "22% covered" could not be turned into "will bb_ask
//       find the Rust in this repo".
//   A3  the only cost on the surface was the last INDEX RUN's phases, labelled
//       `perf:` next to a runtime line with nothing saying which was which.
//       Nothing measured the call the caller was waiting for.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Harness } from "../m13/harness"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { runIndexHealthCheck } from "../../src/brain/brain-index-health"
import { getUnifiedHealth, formatUnifiedHealth } from "../../src/intelligence/health/health-provider"

const harness = new Harness({
  issue: "M64",
  code: "H64a",
  tool: "bb_health",
  title: "bb_health actionability: which integrity check failed, which language is searchable, and what this call cost",
  layers: ["integration"],
  decisions: {
    A1: "the integrity one-liner names the non-ok checks and carries each check's own first sentence of remediation",
    A1_bound: "healthy adds nothing; a pathological project names 3 and counts the rest",
    A2: "per-language searchability is the join of the language census and the embedding census, over the same rows a semantic reader searches",
    A3: "this call's cost is measured per phase and labelled as distinct from the last index run's",
    A3_bound: "zero-valued phases are omitted so a warm call stays one short line",
  },
  limitations: [
    "Phase timings are wall-clock on a shared machine and are asserted for STRUCTURE (present, non-negative, ordered, non-zero only when the phase ran) rather than for a duration, which no gate can pin.",
  ],
})

const clean = (root: string, pid: string) => {
  try { rmSync(path.dirname(BrainDatabase.getDbPath(pid as any)), { recursive: true, force: true }) } catch {}
  rmSync(root, { recursive: true, force: true })
}

async function mixed() {
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64a-"))
  mkdirSync(path.join(root, "ts"), { recursive: true })
  mkdirSync(path.join(root, "py"), { recursive: true })
  mkdirSync(path.join(root, "rb"), { recursive: true })
  for (let i = 0; i < 6; i++) {
    writeFileSync(path.join(root, "ts", `f${i}.ts`), `export function tsFn${i}(): number { return ${i} }\n`)
    writeFileSync(path.join(root, "py", `f${i}.py`), `def py_fn_${i}():\n    return ${i}\n`)
  }
  // Ruby is indexed but the fixture deliberately carries no symbol the embedder
  // will reach, to give the join a language with real numbers on both sides.
  for (let i = 0; i < 3; i++) writeFileSync(path.join(root, "rb", `f${i}.rb`), `class Rb#{i}\n  def m\n  end\nend\n`)
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  return { root, pid }
}

// ══ A1 — the integrity line must be actionable ═════════════════════════════
{
  const { root, pid } = await mixed()
  try {
    const raw = await BrainDatabase.getRawInstance(pid as any)
    // A clean battery must stay quiet.
    const ok = formatUnifiedHealth(await getUnifiedHealth(pid, root, { integrity: true }))
    const okLine = ok.split("\n").find((l) => l.startsWith("integrity:"))!
    harness.check("a healthy battery still prints its summary line", /100%/.test(okLine) && /scored/.test(okLine), okLine.slice(0, 120))
    harness.negative("and names NO checks when nothing failed", !ok.split("\n").some((l) => /^\s+(ERROR|WARN)\s/.test(l)), "the healthy case must add nothing")
    harness.check("it states the scored/informational split", /\d+ scored \+ \d+ informational/.test(okLine), okLine.slice(0, 120))

    // Break a check in a way the battery can see. The orphan-owner threshold is
    // `> 10` to warn, so ONE orphan leaves the check `ok` — the first version of
    // this block planted one and then asserted the check was named, which failed
    // because the check it meant to trip never tripped. The battery was right and
    // the fixture was wrong.
    const fileId = (raw.prepare("SELECT id FROM brain_file WHERE project_id=? LIMIT 1").get(pid) as any).id
    const ins = raw.prepare("INSERT OR REPLACE INTO brain_symbol (id,project_id,file_id,name,symbol_type,owner_symbol_id,line_start,line_end,byte_start,byte_end) VALUES (?,?,?,?,?,?,?,?,?,?)")
    raw.transaction(() => { for (let i = 0; i < 15; i++) ins.run(`sym-orphan-${i}`, pid, fileId, `orphanFn${i}`, "function", `no-such-owner-${i}`, 1, 1, 0, 5) })()
    const broken = formatUnifiedHealth(await getUnifiedHealth(pid, root, { integrity: true }))
    const detail = broken.split("\n").filter((l) => /^\s+(ERROR|WARN)\s/.test(l))
    harness.check("a failed check is NAMED in the text form", detail.some((l) => /Orphan Owner References/.test(l)), detail.join(" | ").slice(0, 140) || "no detail line")
    harness.check("its severity is on the line", detail.some((l) => /^\s+(ERROR|WARN)\s/.test(l)), detail[0]?.slice(0, 44) ?? "none")
    harness.check("it carries the check's own REMEDIATION, not just its name", detail.some((l) => /->/.test(l) && /re-?index|Re-index/i.test(l)), detail.find((l) => /->/.test(l))?.slice(0, 170) ?? "no remediation on the line")
    harness.negative("and it does not inline the whole paragraph", !detail.some((l) => l.length > 420), `longest detail line ${Math.max(0, ...detail.map((l) => l.length))} chars (the orphan-owner remediation is 3 sentences; only the first, the instruction, is inlined)`)
    harness.check("the remediation's first sentence is the instruction, not the caveat", /Re-index the affected files/.test(detail.find((l) => /->/.test(l)) ?? ""), "the dropped second sentence is where --force is documented NOT to help — it stays in integrity.checks[]")

    // The documented loop must not still be the only way to learn the fact.
    harness.negative("no 'run bb_health(integrity=true) for details' pointer is needed", !/run bb_health\(integrity=true\) for details/.test(broken), "the answer is on the line now")

    // The score itself must be unaffected by the extra lines.
    const rep = await getUnifiedHealth(pid, root, { integrity: true })
    harness.check("the report object still carries all 13 checks", rep.integrity!.checks.length === 13, `${rep.integrity!.checks.length} checks`)
    harness.check("and the orphan check is now non-ok", rep.integrity!.checks.find((c) => c.name === "Orphan Owner References")!.status !== "ok", `status=${rep.integrity!.checks.find((c) => c.name === "Orphan Owner References")!.status} with 15 orphans (threshold is >10 to warn)`)

    // A check whose description contains a decimal must not be truncated at the
    // decimal point. `firstSentence` splits on a full stop followed by
    // whitespace, so "0.47 relationships per symbol." must survive whole.
    const withDecimal = detail.find((l) => /\d+\.\d+/.test(l))
    harness.check("a description containing a decimal renders in full", !!withDecimal && /\d+\.\d+\s/.test(withDecimal), withDecimal?.slice(0, 90) ?? "no decimal-bearing detail line to check")
  } finally { clean(root, pid) }
}

// ══ A2 — per-language searchability ════════════════════════════════════════
{
  const { root, pid } = await mixed()
  try {
    const r = await getUnifiedHealth(pid, root, { verbose: true })
    const byLang = r.embeddings.byLanguage
    harness.check("every indexed language appears, not only the embedded ones", byLang.length === r.languages.length, `byLanguage=${byLang.length} languages=${r.languages.length} (${byLang.map((l) => l.language).join(",")})`)
    harness.check("each row carries symbols, embedded and a percentage", byLang.every((l) => typeof l.symbols === "number" && typeof l.embedded === "number" && typeof l.searchablePercent === "number"), JSON.stringify(byLang[0] ?? {}))
    harness.check("embedded never exceeds symbols", byLang.every((l) => l.embedded <= l.symbols), byLang.map((l) => `${l.language} ${l.embedded}/${l.symbols}`).join(" "))
    harness.check("the percentage matches its own operands", byLang.every((l) => l.symbols === 0 || l.searchablePercent === Math.round((l.embedded / l.symbols) * 1000) / 10), byLang.map((l) => `${l.language}:${l.searchablePercent}%`).join(" "))
    const totalEmbedded = byLang.reduce((a, l) => a + l.embedded, 0)
    harness.check("the per-language embedded counts sum to the report's own entity count", totalEmbedded === r.embeddings.embeddedEntities, `sum=${totalEmbedded} embeddedEntities=${r.embeddings.embeddedEntities} — the join must not count anything the census does not`)
    const totalSymbols = byLang.reduce((a, l) => a + l.symbols, 0)
    harness.check("and the per-language symbol counts sum to counts.symbols", totalSymbols === r.counts.symbols, `sum=${totalSymbols} counts.symbols=${r.counts.symbols}`)

    const out = formatUnifiedHealth(r)
    const line = out.split("\n").find((l) => l.startsWith("searchable by language:"))!
    harness.check("verbose prints the joined census", !!line, line?.slice(0, 130) ?? "absent")
    harness.check("each language shows embedded/total and a percentage", /\w+:\d+\/\d+\([\d.]+%\)/.test(line ?? ""), line?.slice(0, 130) ?? "")
    // A language with no vectors is the case the whole join exists for, and the
    // fixture's Ruby may or may not produce it depending on the embedder — so the
    // assertion is conditional on the data and the unsearchable line is asserted
    // only when such a language exists.
    const dead = byLang.filter((l) => l.symbols > 0 && l.embedded === 0).map((l) => l.language)
    if (dead.length) {
      harness.check("a language with no vectors is named unsearchable", new RegExp(`unsearchable languages: ${dead[0]}`).test(out), out.split("\n").find((l) => l.startsWith("unsearchable languages:"))?.slice(0, 120) ?? "absent")
    } else {
      harness.negative("no unsearchable line is invented when every language has vectors", !/unsearchable languages:/.test(out), `dead=${dead.length}`)
    }
    harness.negative("the join stays out of the DEFAULT output (verbose owns breakdowns)", !/searchable by language:/.test(formatUnifiedHealth(await getUnifiedHealth(pid, root, {}))), "the default line count must not grow for this")
  } finally { clean(root, pid) }
}

// ══ A3 — this call's cost, distinguished from the last index run ═══════════
{
  const { root, pid } = await mixed()
  try {
    const r = await getUnifiedHealth(pid, root, {})
    const t = r.timing
    harness.check("a call reports its own cost", typeof t.totalMs === "number" && t.totalMs >= 0, `totalMs=${t.totalMs}`)
    harness.check("every phase is a number, not null/NaN", [t.aggregatesMs, t.freshnessMs, t.integrityMs, t.refreshMs].every((x) => Number.isFinite(x) && x >= 0), JSON.stringify(t))
    harness.check("a call that did NOT run integrity reports integrityMs=0", t.integrityMs === 0, `integrityMs=${t.integrityMs} with integrity:false`)
    harness.check("a call that did NOT refresh reports refreshMs=0", t.refreshMs === 0, `refreshMs=${t.refreshMs}`)
    harness.check("the phases do not exceed the total (no double counting)", t.aggregatesMs + t.freshnessMs + t.integrityMs + t.refreshMs <= t.totalMs, `phases=${t.aggregatesMs + t.freshnessMs + t.integrityMs + t.refreshMs} total=${t.totalMs}`)

    const out = formatUnifiedHealth(r)
    const callLine = out.split("\n").find((l) => l.startsWith("this call:"))!
    harness.check("the text form prints this call's cost", /total=\d+ms/.test(callLine), callLine.slice(0, 120))
    harness.negative("a warm default call omits the zero phases", !/integrity=|refresh=/.test(callLine), callLine.slice(0, 120))
    harness.check("the index run's cost is labelled as the index run, not as perf of this call", /index run:/.test(out) && /the last INDEX RUN, not this call/.test(out), out.split("\n").find((l) => l.startsWith("index run:"))?.slice(0, 110) ?? "absent")
    harness.negative("the ambiguous bare `perf:` label is gone", !/^perf:/.test(out), "two different measurements were on adjacent lines under one label")

    // The integrity battery DOES run in this call, so its phase must appear.
    const withIntegrity = await getUnifiedHealth(pid, root, { integrity: true })
    harness.check("running integrity makes its phase non-zero and visible", withIntegrity.timing.integrityMs > 0, `integrityMs=${withIntegrity.timing.integrityMs}`)
    harness.check("and the line shows it", /integrity=\d+ms/.test(formatUnifiedHealth(withIntegrity).split("\n").find((l) => l.startsWith("this call:")) ?? ""), formatUnifiedHealth(withIntegrity).split("\n").find((l) => l.startsWith("this call:"))?.slice(0, 120) ?? "")

    // M64.A4: with a complete freshness scan the battery must NOT read the disk
    // again. Before this, `integrity: true` + `freshness: "complete"` content-
    // hashed the whole corpus TWICE in one call.
    //
    // This needs a corpus big enough for the difference to be measurable, and the
    // first version of this block used the 15-file fixture — where the whole
    // freshness scan rounds to 0 ms and the battery's 13 SQL aggregates dominate
    // by construction, so the comparison was meaningless in BOTH directions.
    // That is the same mistake as asserting a duration at all, one level down:
    // the honest form is a fixture where hashing is necessarily the expensive
    // thing, and the claim is then about the RATIO.
    const big = mkdtempSync(path.join(tmpdir(), "bb-h64a-big-"))
    try {
      mkdirSync(path.join(big, "src"), { recursive: true })
      for (let i = 0; i < 400; i++) writeFileSync(path.join(big, "src", `f${String(i).padStart(4, "0")}.ts`), `export function fn${i}(): number {\n${Array.from({ length: 30 }, (_, k) => `  const v${k} = ${k} + ${i}`).join("\n")}\n  return v0\n}\n`)
      const bigPid = getProjectId(big)
      await indexProjectParallel(bigPid as any, big, {})
      const both = await getUnifiedHealth(bigPid, big, { integrity: true, freshness: "complete" })
      const drift = both.integrity!.checks.find((c) => c.name.includes("Hash Drift"))!
      const missingCheck = both.integrity!.checks.find((c) => c.name.includes("Missing from Disk"))!

      harness.check("the freshness phase is wired (non-zero where there is real work)", both.timing.freshnessMs > 0, `freshnessMs=${both.timing.freshnessMs} over ${both.freshness.checked} files`)
      harness.check("the battery REUSES the freshness verdicts rather than re-reading the corpus", /SAME ones bb_health's own freshness scan just produced/.test(drift.description), drift.description.slice(0, 118))
      // REMOVED, deliberately: "integrityMs < freshnessMs".
      //
      // It looked like the direct witness for A4 (the battery no longer hashes
      // the corpus a second time), and it failed intermittently in the MERGED
      // tree: integrity=71ms vs freshness=57ms over the same 400 files, then
      // 43/43 on the two reruns that followed. Both phases sit at tens of
      // milliseconds here, so machine contention decides the order.
      //
      // It is also redundant. What actually proves the reuse is structural and
      // already asserted above: the check's own description names the map it
      // reused, the reused hash-drift count equals the resolver's own count, and
      // a pre-resolved map whose total does not match the index is DISCARDED —
      // which is only observable if the reuse path is real. A gate that goes red
      // on noise trains people to ignore red, so the unsupported claim goes and
      // the numbers are recorded here instead.
      //
      // Measured for the record: pre-fix this call hashed the same 400 files a
      // second time; post-fix the battery runs 13 SQL aggregates.
      harness.check("the battery is handed the scan it would otherwise repeat, and says so", /SAME ones bb_health's own freshness scan just produced/.test(drift.description) && /both from the freshness scan this report already ran/.test(missingCheck.description), `Hash Drift claims the SAME verdicts; Files Missing says its counts come from the scan this report already ran. Measured: integrity=${both.timing.integrityMs}ms vs freshness=${both.timing.freshnessMs}ms over ${both.freshness.checked} files — reported, not asserted: at this fixture size the two phases are the same order of magnitude and an ordering assertion is decided by contention, not by the code`)
      harness.check("Files Missing reuses them too", /from the freshness scan this report already ran/.test(missingCheck.description), missingCheck.description.slice(0, 110))
      harness.check("the reused Hash Drift count equals the report's own stale count", drift.value === both.freshness.stale, `drift=${drift.value} freshness.stale=${both.freshness.stale}`)
      harness.check("and the reused missing count equals the report's own missing count", missingCheck.value === both.freshness.missing, `missing=${missingCheck.value} freshness.missing=${both.freshness.missing}`)
      harness.check("the reused verdict is the same measurement, not an approximation", /identical|EXACT/.test(drift.description) && /mtime\+size/.test(drift.description), "the resolver applies the same fast path and the same SHA-256-16 comparison, so the number is the same measurement")

      // The indexer's own call passes no map: it must still read the disk and
      // still produce the same number, so the reuse is an optimisation and not a
      // second, different definition.
      const noPre = await runIndexHealthCheck(bigPid as any, { diskScan: "complete" })
      const drift2 = noPre.checks.find((c) => c.name.includes("Hash Drift"))!
      harness.check("with no pre-resolved map the battery does its own scan and AGREES", drift2.value === both.freshness.stale && /content-hashed/.test(drift2.description), `own-scan value=${drift2.value} vs reused ${drift.value}`)
      const missing2 = noPre.checks.find((c) => c.name.includes("Missing from Disk"))!
      harness.check("Files Missing: own scan agrees with the reused count", missing2.value === both.freshness.missing, `own=${missing2.value} reused=${missingCheck.value}`)

      // A stale map must be IGNORED, not believed. `total` is re-checked against
      // the live row count, so a map that does not describe the current index
      // falls back to a real scan.
      const staleMap = await runIndexHealthCheck(bigPid as any, { diskScan: "complete", preResolved: { total: 999_999, reasons: { "hash-differs": 12345 } } })
      const drift3 = staleMap.checks.find((c) => c.name.includes("Hash Drift"))!
      harness.check("a pre-resolved map whose total does not match the index is DISCARDED", drift3.value === both.freshness.stale, `stale map claimed 12345 drift; the battery reported ${drift3.value} (truth ${both.freshness.stale})`)
    } finally {
      try { rmSync(path.dirname(BrainDatabase.getDbPath(getProjectId(big))), { recursive: true, force: true }) } catch {}
      rmSync(big, { recursive: true, force: true })
    }
  } finally { clean(root, pid) }
}

harness.emit()
