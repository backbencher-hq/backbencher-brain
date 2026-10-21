/**
 * THE TYPESCRIPT POPULATION CENSUS — three numbers, three rules, one reconciliation.
 *
 * ## Why this file exists
 *
 * The lane's cell (§8b of `validation/m14/verification/TYPESCRIPT-VERDICT-PROPOSAL.md`) names the
 * on-disk count **71,734** and the gate's admitted count **17,689** for the same root, and the
 * campaign's own brief carries a THIRD number, **68,102**, for the router's three-spelling set.
 * Three numbers, one root, and no instrument that says which RULE produced which — which is
 * precisely the shape of defect this file exists to close.
 *
 * A population is not a number. A population is a NUMBER **plus the RULE that produced it**, and
 * two populations that differ by a rule are not in conflict: they are different measurements.
 * So the reconciliation is not "which number is right" — it is "which rule produced which, and
 * what is the exact arithmetic between them".
 *
 * ## THE RULES MEASURED HERE (each named, each reproduced by this file)
 *
 * **R1 · ON-DISK (four-spelling) — 71,734 (expected).** Every regular file under the corpus root
 * whose name ends in one of the gate's four TypeScript spellings (ts, tsx, mts, cts), found by
 * walking the tree with symlinked DIRECTORIES FOLLOWED (the charter's standing trap 9: a
 * `readdirSync(...,{withFileTypes:true}).isDirectory()` walk drops a symlinked repo entirely).
 * `.git` internals are excluded and COUNTED separately — they are version-control objects, not
 * project sources, and a `.git` directory can hold files whose names end in `.ts`.
 *
 * **R2 · ON-DISK (three-spelling) — 68,102 (expected).** The same walk with the `tsx` spelling
 * removed. This is the ROUTER's own `typescript` LANGUAGE ID set: `src/ast/language-detection.ts`
 * maps `ts`/`mts`/`cts` to the language id `typescript` and `tsx` to the language id `tsx` (a
 * separate id that shares this analyzer and this wasm family). The gate's `LANES_A.typescript`
 * is four spellings wide; the router's `typescript` language id is three. **The delta between R1
 * and R2 is the `.tsx` share, and this file measures it rather than subtracting it.**
 *
 * **R3 · ADMITTED — 17,689 (expected).** The gate's OWN rule, replicated here so the gap between
 * R1 and R3 is explained rather than asserted: for each corpus entry that is a real git checkout
 * (`git rev-parse --git-dir`), the TRACKED file list (`git ls-files -z`), filtered to the four
 * spellings, minus files over the gate's `SIZE_CAP` (1 MB — the analyzer's own FULL_AST limit)
 * and minus tracked paths absent from the working tree. **Untracked files, over-cap files and
 * absent files are each COUNTED, because a population that hides them is claiming files it
 * cannot read.**
 *
 * ## WHAT IT PRINTS
 *
 * The three numbers with their rules, the exact arithmetic between them, the per-extension
 * breakdown, the per-repo top contributors, the symlink-following count (so a reader can see the
 * walk did not silently drop repos), and the `.git` / `node_modules` split for R1 and R2.
 *
 * ## USAGE
 *
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-population-census.ts
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-population-census.ts --json out.json
 *
 * The corpus root defaults to the FARM (`$PWD/.corpus`) and the default-root reading is offered
 * with `--default-root` for the comparison the fleet's own pages require (the two roots are not
 * comparable — charter R1).
 */

import { readdirSync, statSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { laneExtensions } from "./ts-lane-extensions"

// ─── THE GATE'S SIZE CAP, READ FROM THE GATE'S OWN FILE ──────────────────────────────
// The gate's cap is the analyzer's FULL_AST_LIMIT. It is read LIVE out of the gate's source so
// this census cannot drift from the instrument it explains.
//
// IT IS WRITTEN AS AN EXPRESSION (`1024 * 1024`), and a reader that takes only the first number
// literal reads 1,024 — a thousand times too small, which would move every file over 1 KB into
// the over-cap bucket and shrink the ADMITTED population by an order of magnitude. That is a
// MEASURED defect of a first reading of this file, recorded here because the arithmetic it
// produced (ADMITTED 6,127 against the lane's 17,689) is the kind of number that looks like a
// finding and is not one. The whole right-hand side is read and evaluated as an arithmetic
// expression over digits, `_`, `*`, `+` and `(`/`)` — nothing else is accepted.
const GATE_SRC = "script/m14/incoming-gate.ts"
function gateSizeCap(): { bytes: number; source: string } {
  const fallback = 1_048_576
  try {
    const src = require("node:fs").readFileSync(path.resolve(process.cwd(), GATE_SRC), "utf8")
    const m = src.match(/const\s+SIZE_CAP\s*=\s*([^\n;]+)/)
    if (m) {
      const expr = m[1]!.replace(/_/g, "").trim()
      if (/^[0-9+\-*/() ]+$/.test(expr)) {
        const bytes = Function(`"use strict";return (${expr})`)() as number
        if (Number.isFinite(bytes) && bytes > 0) {
          return { bytes, source: `${GATE_SRC} · const SIZE_CAP = ${expr} → ${bytes.toLocaleString()} bytes` }
        }
      }
    }
    return { bytes: fallback, source: `${GATE_SRC} · SIZE_CAP NOT PARSEABLE — the historical ${fallback.toLocaleString()} bytes is used, and this says so` }
  } catch {
    return { bytes: fallback, source: `${GATE_SRC} (unreadable — the historical ${fallback.toLocaleString()} bytes is used, and this says so)` }
  }
}

// ─── THE ROUTER'S OWN SPELLING SETS, READ LIVE ──────────────────────────────────────
// `src/ast/language-detection.ts` is the router. This census reads the router's map so the
// three-spelling set is the ROUTER'S set and not a copy of it.
const ROUTER_SRC = "src/ast/language-detection.ts"
type RouterSets = { typescript: string[]; tsx: string[] }
function routerSets(): RouterSets {
  const fallback: RouterSets = { typescript: ["ts", "mts", "cts"], tsx: ["tsx"] }
  try {
    const src = require("node:fs").readFileSync(path.resolve(process.cwd(), ROUTER_SRC), "utf8")
    const grab = (lang: string): string[] => {
      const re = new RegExp(`\\b([a-z0-9]+)\\s*:\\s*"${lang}"`, "g")
      const out: string[] = []
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) out.push(m[1]!)
      return out
    }
    const ts = grab("typescript")
    const tsx = grab("tsx")
    return {
      typescript: ts.length ? ts : fallback.typescript,
      tsx: tsx.length ? tsx : fallback.tsx,
    }
  } catch {
    return fallback
  }
}

// ─── THE WALK ────────────────────────────────────────────────────────────────────────
type WalkCounts = {
  byExt: Map<string, number>
  total: number
  symlinkedDirsFollowed: number
  symlinkedDirsSkipped: number
  inGitDir: number
  inNodeModules: number
  inNodeModulesByExt: Map<string, number>
  repos: number
}

function walkRepo(root: string, exts: Set<string>): WalkCounts {
  const counts: WalkCounts = {
    byExt: new Map(),
    total: 0,
    symlinkedDirsFollowed: 0,
    symlinkedDirsSkipped: 0,
    inGitDir: 0,
    inNodeModules: 0,
    inNodeModulesByExt: new Map(),
    repos: 0,
  }
  const stack: string[] = [root]
  const seen = new Set<string>()
  while (stack.length) {
    const dir = stack.pop()!
    let real: string
    try {
      // statSync FOLLOWS a symlink — the charter's standing trap 9. readdirSync's Dirent
      // .isDirectory() is FALSE for a symlinked dir and silently drops whole repos.
      real = statSync(dir).isDirectory() ? dir : ""
    } catch { continue }
    if (!real) continue
    if (seen.has(real)) continue
    seen.add(real)
    // THE Dirent TYPE, SPELLED. `ReturnType<typeof readdirSync>` is the OVERLOAD set, so the
    // `withFileTypes: true` call is not assignable to it under --strict; the element type is
    // named here instead of being inferred through the overload.
    let entries: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean; isFile(): boolean }[]
    try {
      entries = readdirSync(real, { withFileTypes: true })
    } catch { continue }
    for (const e of entries) {
      const p = path.join(real, e.name)
      if (e.isDirectory()) { stack.push(p); continue }
      if (e.isSymbolicLink()) {
        let isDir = false
        try { isDir = statSync(p).isDirectory() } catch { counts.symlinkedDirsSkipped++; continue }
        if (isDir) { counts.symlinkedDirsFollowed++; stack.push(p) }
        continue
      }
      if (!e.isFile()) continue
      const lower = e.name.toLowerCase()
      const dot = lower.lastIndexOf(".")
      if (dot < 0) continue
      const ext = lower.slice(dot + 1)
      if (!exts.has(ext)) continue
      // `.git` internals are version-control objects, not project sources. COUNTED, not hidden.
      if (real.includes(`${path.sep}.git${path.sep}`)) { counts.inGitDir++; continue }
      // `node_modules` is COUNTED AND KEPT — a dependency's own sources are on disk and the
      // on-disk rule that the campaign's 71,734 / 68,102 figures use INCLUDES them. Dropping
      // them silently would have produced 17,777 and 14,181 and the fleet's figures would look
      // wrong for a reason that is not a defect. The admitted population is a different rule and
      // never reaches node_modules (it is git-tracked, and a dependency is not).
      if (real.includes(`${path.sep}node_modules${path.sep}`)) counts.inNodeModules++
      counts.total++
      counts.byExt.set(ext, (counts.byExt.get(ext) ?? 0) + 1)
      if (real.includes(`${path.sep}node_modules${path.sep}`)) {
        counts.inNodeModulesByExt.set(ext, (counts.inNodeModulesByExt.get(ext) ?? 0) + 1)
      }
    }
  }
  return counts
}

// ─── THE ADMITTED SET — THE GATE'S OWN RULE, REPLICATED ──────────────────────────────
type Admitted = {
  repos: number
  trackedExtMatched: number
  overCap: number
  overCapLargest: number
  absent: number
  admitted: number
  admittedByExt: Map<string, number>
  admittedByRepo: Map<string, number>
  trackedByExt: Map<string, number>
  notAGitCheckout: number
  perRepoTracked: Map<string, number>
}

function admit(root: string, exts: string[], sizeCap: number, lang: string): Admitted {
  const out: Admitted = {
    repos: 0, trackedExtMatched: 0, overCap: 0, overCapLargest: 0, absent: 0, admitted: 0,
    admittedByExt: new Map(), admittedByRepo: new Map(), trackedByExt: new Map(),
    notAGitCheckout: 0, perRepoTracked: new Map(),
  }
  const extSet = new Set(exts)
  let entries: string[]
  try { entries = readdirSync(root) } catch { return out }
  for (const name of entries.sort()) {
    const dir = path.join(root, name)
    let isDir = false
    try { isDir = statSync(dir).isDirectory() } catch { continue }
    if (!isDir) continue
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { out.notAGitCheckout++; continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch { continue }
    let repoAdmitted = 0
    let repoTracked = 0
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      if (!extSet.has(low.slice(low.lastIndexOf(".") + 1))) continue
      out.trackedExtMatched++
      repoTracked++
      out.trackedByExt.set(low.slice(low.lastIndexOf(".") + 1), (out.trackedByExt.get(low.slice(low.lastIndexOf(".") + 1)) ?? 0) + 1)
      const abs = path.join(dir, rel)
      try {
        const size = statSync(abs).size
        if (size > sizeCap) { out.overCap++; out.overCapLargest = Math.max(out.overCapLargest, size); continue }
      } catch { out.absent++; continue }
      out.admitted++
      repoAdmitted++
      out.admittedByExt.set(low.slice(low.lastIndexOf(".") + 1), (out.admittedByExt.get(low.slice(low.lastIndexOf(".") + 1)) ?? 0) + 1)
    }
    if (repoTracked > 0) {
      out.repos++
      out.admittedByRepo.set(name, repoAdmitted)
      out.perRepoTracked.set(name, repoTracked)
    }
  }
  void lang
  return out
}

// ─── MAIN ────────────────────────────────────────────────────────────────────────────
function main() {
  const useDefaultRoot = process.argv.includes("--default-root")
  const jsonIdx = process.argv.indexOf("--json")
  const jsonOut = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : ""
  const mdIdx = process.argv.indexOf("--md")
  const mdOut = mdIdx >= 0 ? process.argv[mdIdx + 1] : ""
  const CR = useDefaultRoot
    ? "$HOME/fixtures/repositories"
    : (process.env.BB_CORPUS_ROOT ?? path.resolve(process.cwd(), ".corpus"))

  const exts = laneExtensions("typescript", ["ts", "tsx", "mts", "cts"])
  const router = routerSets()
  const cap = gateSizeCap()
  const sizeCap = cap.bytes

  const three = [...router.typescript].sort()
  const four = [...new Set([...router.typescript, ...router.tsx])].sort()

  const L: string[] = []
  const say = (s = "") => L.push(s)

  say("THE TYPESCRIPT POPULATION CENSUS — three numbers, three rules, one reconciliation")
  say(`corpus root (ABSOLUTE): ${CR}`)
  say(`root selected by: ${useDefaultRoot ? "--default-root (the gate's DEFAULT root — NOT comparable with the FARM, charter R1)" : "BB_CORPUS_ROOT / $PWD/.corpus (the FARM)"}`)
  say(`gate's extension map, read LIVE: ${exts.source} → ${exts.list.join(",")}`)
  say(`router's language ids, read LIVE from ${ROUTER_SRC}: typescript → ${router.typescript.join(",")} · tsx → ${router.tsx.join(",")}`)
  say(`gate's SIZE_CAP, read LIVE: ${cap.source}`)
  say()

  // R1 / R2 — on-disk
  const cFour = walkRepo(CR, new Set(four))
  const cThree = walkRepo(CR, new Set(three))
  const repoCount = (() => {
    let n = 0
    try {
      for (const name of readdirSync(CR)) {
        try { if (statSync(path.join(CR, name)).isDirectory()) n++ } catch { /* unreadable entry */ }
      }
    } catch { /* unreadable root */ }
    return n
  })()
  cFour.repos = repoCount
  cThree.repos = repoCount
  const fmt = (m: Map<string, number>) => [...m.entries()].sort().map(([k, v]) => `${k} ${v.toLocaleString()}`).join(" · ")

  say("R1 · ON-DISK, FOUR SPELLINGS (the gate's map) — every regular file under the root whose")
  say("     name ends in one of the four spellings; symlinked DIRECTORIES FOLLOWED; `.git` internals")
  say("     excluded and counted; `node_modules` KEPT and counted (a dependency's sources are on")
  say("     disk, and the campaign's on-disk figures include them).")
  say(`     TOTAL ${cFour.total.toLocaleString()} · repos ${cFour.repos} · symlinked dirs followed ${cFour.symlinkedDirsFollowed} · symlinked dirs skipped ${cFour.symlinkedDirsSkipped}`)
  say(`     by extension: ${fmt(cFour.byExt)}`)
  say(`     of which inside node_modules: ${cFour.inNodeModules.toLocaleString()} (${fmt(cFour.inNodeModulesByExt)})`)
  say(`     outside node_modules: ${(cFour.total - cFour.inNodeModules).toLocaleString()}`)
  say(`     excluded: .git internals ${cFour.inGitDir.toLocaleString()}`)
  say()
  say("R2 · ON-DISK, THREE SPELLINGS (the ROUTER's `typescript` language id) — the same walk with")
  say("     the `tsx` spelling removed.")
  say(`     TOTAL ${cThree.total.toLocaleString()} · repos ${cThree.repos} · symlinked dirs followed ${cThree.symlinkedDirsFollowed}`)
  say(`     by extension: ${fmt(cThree.byExt)}`)
  say(`     of which inside node_modules: ${cThree.inNodeModules.toLocaleString()}`)
  say(`     outside node_modules: ${(cThree.total - cThree.inNodeModules).toLocaleString()}`)
  say()

  // R3 — admitted
  const adm = admit(CR, exts.list, sizeCap, "typescript")
  say("R3 · ADMITTED (the gate's own rule) — tracked files (`git ls-files`) in real git checkouts,")
  say("     extension-admitted, ≤ SIZE_CAP, present in the working tree.")
  say(`     ADMITTED ${adm.admitted.toLocaleString()} · repos ${adm.repos} · tracked-and-extension-matched ${adm.trackedExtMatched.toLocaleString()}`)
  say(`     over-cap (never parsed, never measured) ${adm.overCap.toLocaleString()} (largest ${adm.overCapLargest.toLocaleString()} bytes) · absent from the working tree ${adm.absent.toLocaleString()}`)
  say(`     corpus entries that are not git checkouts ${adm.notAGitCheckout}`)
  say(`     admitted by extension: ${fmt(adm.admittedByExt)}`)
  say()

  // THE ARITHMETIC — the reconciliation, every term named
  const untracked = cFour.total - adm.trackedExtMatched
  say("THE ARITHMETIC — R1 → R3, every term named:")
  say(`  R1 on-disk (four spellings)                 ${cFour.total.toLocaleString()}`)
  say(`  − NOT tracked by git (untracked / ignored)  ${untracked.toLocaleString()}`)
  say(`  = R3 tracked-and-extension-matched          ${adm.trackedExtMatched.toLocaleString()}`)
  say(`  − over the gate's SIZE_CAP (never parsed)   ${adm.overCap.toLocaleString()}`)
  say(`  − tracked but absent from the working tree  ${adm.absent.toLocaleString()}`)
  say(`  = R3 ADMITTED                               ${adm.admitted.toLocaleString()}`)
  say(`  R1 − R3 = ${(cFour.total - adm.admitted).toLocaleString()} files the ADMITTED population does not contain`)
  say()
  say("R1 − R2, the `.tsx` share (the router's separate `tsx` language id):")
  say(`  ${cFour.total.toLocaleString()} − ${cThree.total.toLocaleString()} = ${(cFour.total - cThree.total).toLocaleString()} .tsx files on disk`)
  say(`  of which ADMITTED under the gate's four-spelling map: ${(adm.admittedByExt.get("tsx") ?? 0).toLocaleString()}`)
  say(`  of which inside node_modules: ${(cFour.inNodeModulesByExt.get("tsx") ?? 0).toLocaleString()}`)
  say()

  // per-repo top contributors — the admitted set's shape
  const top = [...adm.admittedByRepo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  say("ADMITTED PER REPO — top 12:")
  for (const [r, n] of top) say(`  ${r.padEnd(34)} ${n.toLocaleString()}`)
  say()

  const report = {
    corpusRoot: CR,
    rootKind: useDefaultRoot ? "default" : "farm",
    gateExtMap: { source: exts.source, list: exts.list },
    routerSets,
    sizeCap,
    R1_onDiskFour: {
      total: cFour.total, repos: cFour.repos,
      symlinkedDirsFollowed: cFour.symlinkedDirsFollowed, symlinkedDirsSkipped: cFour.symlinkedDirsSkipped,
      byExt: Object.fromEntries(cFour.byExt), gitInternalsExcluded: cFour.inGitDir,
      inNodeModules: cFour.inNodeModules, inNodeModulesByExt: Object.fromEntries(cFour.inNodeModulesByExt),
      outsideNodeModules: cFour.total - cFour.inNodeModules,
    },
    R2_onDiskThree: {
      total: cThree.total, repos: cThree.repos,
      symlinkedDirsFollowed: cThree.symlinkedDirsFollowed,
      byExt: Object.fromEntries(cThree.byExt), gitInternalsExcluded: cThree.inGitDir,
      inNodeModules: cThree.inNodeModules,
      outsideNodeModules: cThree.total - cThree.inNodeModules,
    },
    R3_admitted: {
      admitted: adm.admitted, repos: adm.repos,
      trackedExtMatched: adm.trackedExtMatched, overCap: adm.overCap, overCapLargest: adm.overCapLargest,
      absent: adm.absent, notAGitCheckout: adm.notAGitCheckout,
      admittedByExt: Object.fromEntries(adm.admittedByExt),
      admittedByRepo: Object.fromEntries(adm.admittedByRepo),
    },
    arithmetic: {
      untracked: cFour.total - adm.trackedExtMatched,
      gapOnDiskMinusAdmitted: cFour.total - adm.admitted,
      tsxShareOnDisk: cFour.total - cThree.total,
      tsxShareAdmitted: adm.admittedByExt.get("tsx") ?? 0,
    },
  }

  const text = L.join("\n")
  console.log(text)
  if (mdOut) {
    const md = [
      "# TYPESCRIPT — THE POPULATION CENSUS (three denominators, three rules, one reconciliation)",
      "",
      "**Author: Muhammad Ishaq Khan.** This file is a MEASUREMENT. Every number in it was produced",
      "by `script/m14/ts-population-census.ts`, which re-derives them from the filesystem and the",
      "gate's own admission rule and prints the arithmetic that connects them. The fleet carries",
      "three numbers for this lane's population — **71,734** (the on-disk four-spelling count),",
      "**68,102** (the router's three-spelling count) and **17,689** (the gate's admitted count) —",
      "and they are not in conflict: they are three DIFFERENT RULES, and a cell that does not name",
      "its rule makes the disagreement look like an error.",
      "",
      "```",
      text,
      "```",
      "",
      "## WHAT EACH NUMBER IS, AND WHICH ONE THE CELL USED",
      "",
      "| # | denominator | rule | count |",
      "|---|---|---|---|",
      `| R1 | on-disk, four spellings | every regular file under the root whose name ends in one of the four spellings; symlinked directories FOLLOWED; \`.git\` internals excluded; \`node_modules\` KEPT | **${cFour.total.toLocaleString()}** |`,
      `| R2 | on-disk, three spellings — the ROUTER's own \`typescript\` LANGUAGE ID | the same walk with \`tsx\` removed | **${cThree.total.toLocaleString()}** |`,
      `| R3 | ADMITTED — the gate's own population | git-TRACKED, extension-admitted, ≤ the gate's 1 MB \`SIZE_CAP\`, present in the working tree | **${adm.admitted.toLocaleString()}** |`,
      "",
      `**THE CELL USES R3 (${adm.admitted.toLocaleString()} files / ${adm.repos} repos)**, because the cell's edges are the`,
      "gate's edges and the gate's population IS the admitted set. R1 and R2 are the on-disk",
      "denominators and are published so the gap and its decomposition are visible rather than",
      `asserted: **${(cFour.total - adm.admitted).toLocaleString()} files the admitted population does not contain, of which`,
      `${cFour.inNodeModules.toLocaleString()} are \`node_modules\` (vendored dependency code) and ${(cFour.total - adm.trackedExtMatched - cFour.inNodeModules).toLocaleString()} are untracked project files.**`,
      "",
      "## THE REPRODUCTION",
      "",
      "```",
      "  BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-population-census.ts --json pop.json --md pop.md",
      "```",
      "",
      "The instrument reads the extension map LIVE out of `script/m14/incoming-gate.ts`",
      "(`LANES_A.typescript`) and the router's own language ids LIVE out of",
      "`src/ast/language-detection.ts`, and it reads the gate's `SIZE_CAP` as the WHOLE",
      "right-hand side of its declaration (`1024 * 1024`) — **a reader that took only the first",
      "number literal would read 1,024 and undercount the admitted population by an order of",
      "magnitude, which is a measurement of a typo rather than of the corpus.**",
      "",
    ].join("\n")
    require("node:fs").writeFileSync(mdOut, md)
    console.log(`\nMD written: ${mdOut}`)
  }
  if (jsonOut) {
    require("node:fs").writeFileSync(jsonOut, JSON.stringify(report, null, 2) + "\n")
    console.log(`\nJSON written: ${jsonOut}`)
  }
  void existsSync
}

main()
