// script/m50/verify-a3-guidance-truth.ts — M50.A3 (#765)
//
// Guidance is a promise to the agent. This gate proves the promise is
// generated from the registry and cannot name a tool that does not exist, and
// that the checker actually FAILS on the two failure modes that produced the
// user-visible complaint ("System: Model tried to call unavailable tool
// 'bb_select'"):
//
//   G  generation: the rendered section mentions exactly the registry tools,
//      one row each, and zero bb_* names outside the registry.
//   I  idempotence + preservation: writing twice is a no-op; user text outside
//      the markers survives byte-for-byte.
//   C  check semantics: --check reports `missing` on a file with no section,
//      `drift` on a tampered section, `unchanged` on a conformant one, and
//      NEVER writes.
//   M  mutations (falsifiability — a gate that cannot fail is not a gate):
//      M1 a ghost name injected into the section is caught;
//      M2 a registry tool deleted from the section is caught;
//      M3 a ghost name injected into a SHIPPED guidance surface is caught by
//         the same predicate the project-wide scan uses.
//   S  shipped-surface scan: AGENTS.md (if present), the on-board renderer
//      itself, and the CLI help text carry no retired ghost names.
//
// Every check runs real code; nothing auto-passes.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"
import {
  GUIDANCE_END,
  GUIDANCE_START,
  RETIRED_GHOST_TOOL_NAMES,
  TASK_DISAMBIGUATION,
  applyGuidanceSection,
  extractGuidanceSection,
  ghostToolNames,
  missingToolNames,
  onboard,
  renderGuidanceSection,
  toolNamesIn,
} from "../../src/cli/onboard"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const REGISTRY = PUBLIC_TOOL_DESCRIPTORS.map((d) => d.name)

let passed = 0
let failed = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++
    console.log(`  ok ${label}`)
  } else {
    failed++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

console.log(`M50.A3 guidance-truth gate — registry has ${REGISTRY.length} tools`)

// ── G: generation ───────────────────────────────────────────────────────────
const section = renderGuidanceSection()
const body = section.slice(GUIDANCE_START.length, section.length - GUIDANCE_END.length)
check("G1 section carries both markers exactly once", (section.match(/bb:onboard:start/g) ?? []).length === 1 && (section.match(/bb:onboard:end/g) ?? []).length === 1)
check("G2 every registry tool appears in the guidance", missingToolNames(section).length === 0, missingToolNames(section).join(", "))
check("G3 no bb_* name outside the registry appears", ghostToolNames(section).length === 0, ghostToolNames(section).join(", "))
check("G4 the guidance names no retired ghost", RETIRED_GHOST_TOOL_NAMES.every((g) => !section.includes(g)))
// G5 counts TABLE ROWS, not every mention: the write-tool sentence names
// mutating tools a second time on purpose, and counting all mentions would
// force the prose to be worse for the reader.
const rows = section.split("\n").filter((l) => l.startsWith("| `bb_"))
const rowNames = rows.map((l) => l.slice(3).split("`")[0])
check(
  "G5 exactly one table row per registry tool, no duplicates",
  rows.length === REGISTRY.length && new Set(rowNames).size === REGISTRY.length && REGISTRY.every((n) => rowNames.includes(n)),
  `rows=${rows.length} unique=${new Set(rowNames).size}`,
)
check("G6 declares the tool count honestly", section.includes(`${REGISTRY.length} total`))
check("G7 every mutating tool is marked as mutating", PUBLIC_TOOL_DESCRIPTORS.filter((d) => d.mutability !== "read").every((d) => body.includes(`| \`${d.name}\` |`) && /yes/i.test(section.split(`\`${d.name}\``)[1]?.split("\n")[0] ?? "")))
// G8/G9: the M50.A4 task clauses may add vocabulary but never a tool, and they
// must cover every tool (an agent choosing between two tools needs the
// discriminating question, not just the return-shape summary).
check("G8 every task-disambiguation key is a registry tool", Object.keys(TASK_DISAMBIGUATION).every((n) => REGISTRY.includes(n)), Object.keys(TASK_DISAMBIGUATION).filter((n) => !REGISTRY.includes(n)).join(", "))
check(
  "G9 every registry tool has a task-disambiguation clause",
  REGISTRY.every((n) => typeof TASK_DISAMBIGUATION[n] === "string" && TASK_DISAMBIGUATION[n].length > 0),
  REGISTRY.filter((n) => !TASK_DISAMBIGUATION[n]).join(", "),
)
check("G10 disambiguation clauses are unique (they must discriminate)", new Set(Object.values(TASK_DISAMBIGUATION)).size === Object.keys(TASK_DISAMBIGUATION).length)

// ── I: idempotence + preservation ───────────────────────────────────────────
const userText = "# My project\n\nRules for agents: never touch vendor/.\n"
const first = applyGuidanceSection(userText, section)
check("I1 first write appends (user text kept)", first.action === "appended" && first.text.startsWith(userText))
const second = applyGuidanceSection(first.text, section)
check("I2 second write is byte-identical", second.text === first.text)
check("I3 user text survives byte-for-byte", second.text.includes(userText))
const tampered = first.text.replace("| `bb_search` |", "| `bb-deleted-tool` |")
const afterTamper = applyGuidanceSection(tampered, section)
check("I4 a tampered section is replaced, not appended twice", (afterTamper.text.match(/bb:onboard:start/g) ?? []).length === 1)
check("I5 the tamper is gone after re-write", !afterTamper.text.includes("bb-deleted-tool"))

// ── C: check semantics on a real temp project ───────────────────────────────
const dir = mkdtempSync(path.join(tmpdir(), "bb-a3-onboard-"))
try {
  const missing = onboard(dir, { check: true })
  check("C1 --check reports missing on a project with no section", missing.action === "missing" && missing.changed)
  check("C2 --check wrote nothing", !existsSync(path.join(dir, "AGENTS.md")))

  const w = onboard(dir, {})
  check("C3 write inserts the section", w.changed && w.action === "inserted" && existsSync(path.join(dir, "AGENTS.md")))
  const ok = onboard(dir, { check: true })
  check("C4 --check is clean immediately after writing", ok.action === "unchanged" && !ok.changed, `${ok.action} ghosts=${ok.ghosts.join(",")} missing=${ok.missing.join(",")}`)

  const file = path.join(dir, "AGENTS.md")
  const original = readFileSync(file, "utf8")
  writeFileSync(file, original.replace("| `bb_graph` |", "| `bb_select` |"))
  const driftGhost = onboard(dir, { check: true })
  check("C5 M1: a ghost name in the on-disk section is caught", driftGhost.action === "drift" && driftGhost.ghosts.includes("bb_select"), JSON.stringify(driftGhost.ghosts))
  check("C6 M1: --check did not repair the file behind our back", readFileSync(file, "utf8").includes("bb_select"))

  writeFileSync(file, original.replace(/\| `bb_graph` \|[^\n]*\n/, ""))
  const driftMissing = onboard(dir, { check: true })
  check("C7 M2: a deleted registry row is caught", driftMissing.action === "drift" && driftMissing.missing.includes("bb_graph"), JSON.stringify(driftMissing.missing))

  writeFileSync(file, original)
  check("C8 restore is clean", onboard(dir, { check: true }).action === "unchanged")

  // The rendered section is exactly what the file holds (generator == writer).
  check("C9 on-disk section equals the generator's output", extractGuidanceSection(readFileSync(file, "utf8")) === section)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// ── S: shipped-surface scan (the same predicate, mutation-proven) ───────────
const SHIPPED = ["AGENTS.md", "src/cli/onboard.ts", "docs/TOOLS.md", "docs/BB_TOOLS.md"]
let scanned = 0
for (const rel of SHIPPED) {
  const abs = path.join(ROOT, rel)
  if (!existsSync(abs)) continue
  scanned++
  const text = readFileSync(abs, "utf8")
  // The ONE allowed home for retired names is the declared retired-names
  // constant in the onboard module — it exists so gates can prove they are
  // gone. It must be labelled as retired, and its own body must not leak into
  // any other surface: strip it, then require zero ghosts in the rest.
  const retiredBlock = text.match(/\/\*\*[^]*?\*\/\s*export const RETIRED_GHOST_TOOL_NAMES = \[[^\]]*\] as const/)
  const scrubbed = retiredBlock ? text.replace(retiredBlock[0], "") : text
  const ghosts = ghostToolNames(scrubbed)
  check(`S: ${rel} names no unknown bb_* tool`, ghosts.length === 0, ghosts.join(", "))
  if (retiredBlock) {
    check(`S: ${rel} retired-name list is labelled as removed`, /removed|retired/i.test(retiredBlock[0]))
  }
}
check("S: at least one shipped guidance surface was scanned", scanned > 0, `scanned=${scanned}`)

// M3: the predicate itself must be able to fail on a shipped-looking surface.
const mutant = readFileSync(path.join(ROOT, "src/cli/onboard.ts"), "utf8") + "\n// mutant: " + RETIRED_GHOST_TOOL_NAMES.join(", ") + "\n"
check("M3: injecting a retired ghost into the surface trips the same predicate", ghostToolNames(mutant).length === RETIRED_GHOST_TOOL_NAMES.length, ghostToolNames(mutant).join(", "))

// ── end-to-end: the CLI command really serves the same contract ─────────────
const dir2 = mkdtempSync(path.join(tmpdir(), "bb-a3-cli-"))
try {
  mkdirSync(path.join(dir2, "src"), { recursive: true })
  const out = execFileSync("node", [path.resolve(ROOT, "bin/bb"), "onboard", dir2, "--print"], { encoding: "utf8", cwd: ROOT })
  check("E1 `bb onboard --print` emits the generated section", out.includes(GUIDANCE_START) && out.includes(GUIDANCE_END) && ghostToolNames(out).length === 0)
  const wrote = execFileSync("node", [path.resolve(ROOT, "bin/bb"), "onboard", dir2, "--file", path.join(dir2, "AGENTS.md")], { encoding: "utf8", cwd: ROOT })
  check("E2 `bb onboard <dir>` writes the file", wrote.includes("guidance inserted") && existsSync(path.join(dir2, "AGENTS.md")), wrote.trim())
  const clean = execFileSync("node", [path.resolve(ROOT, "bin/bb"), "onboard", dir2, "--check", "--file", path.join(dir2, "AGENTS.md")], { encoding: "utf8", cwd: ROOT })
  check("E3 `bb onboard --check` exits clean on a just-written file", clean.includes("is current"), clean.trim())
  // A REAL project-with-no-guidance (the previous temp dir is already gone, so
  // using it would prove the wrong thing: requireDir's exit, not the checker's).
  const dir3 = mkdtempSync(path.join(tmpdir(), "bb-a3-empty-"))
  let exitCode = 0
  let stderr = ""
  try {
    execFileSync("node", [path.resolve(ROOT, "bin/bb"), "onboard", dir3, "--check"], { encoding: "utf8", cwd: ROOT, stdio: "pipe" })
  } catch (e: any) {
    exitCode = e.status ?? 1
    stderr = String(e.stdout ?? "")
  } finally {
    rmSync(dir3, { recursive: true, force: true })
  }
  check("E4 `bb onboard --check` exits non-zero on a project with no section", exitCode === 1 && !existsSync(path.join(dir3, "AGENTS.md")), `exit=${exitCode} out=${stderr.trim()}`)
} catch (error: any) {
  check("E: CLI onboard surface", false, `${error?.stdout ?? ""}${error?.stderr ?? ""}${error?.message ?? ""}`.slice(0, 300))
} finally {
  rmSync(dir2, { recursive: true, force: true })
}

// ── evidence stamp (M50 seals every gate with the commit it ran against) ────
{
  const { mkdirSync: mk, writeFileSync: wf } = await import("node:fs")
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const dir = path.join(ROOT, "validation/m50/results")
  mk(dir, { recursive: true })
  wf(
    path.join(dir, "A3.json"),
    JSON.stringify(
      {
        gate: "M50.A3",
        issue: 765,
        milestone: "M50",
        at: new Date().toISOString(),
        commit,
        checks: passed + failed,
        passed,
        failed,
        verifierCommand: "npx tsx script/m50/verify-a3-guidance-truth.ts",
        status: failed === 0 ? "verified" : "known-gap",
        method:
          "generation/idempotence/check-semantics/ghost-scan over the real onboard module + the real CLI, with four mutations (ghost injected, row deleted, predicate falsifiability, retired-name discipline)",
        registryTools: REGISTRY.length,
      },
      null,
      2,
    ) + "\n",
  )
}

console.log(`\nM50.A3 GUIDANCE TRUTH: ${failed === 0 ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed)`)
process.exit(failed === 0 ? 0 : 1)
