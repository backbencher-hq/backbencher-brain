// SPECIAL-TARGET CENSUS — the measurement behind the decorates question, over
// the whole gate-admitted make population. GNU Make's special targets
// (.PHONY, .SUFFIXES, .SECONDARY, .PRECIOUS, .INTERMEDIATE, .DELETE_ON_ERROR,
// .SILENT, .EXPORT_ALL_VARIABLES, .NOTPARALLEL, .ONESHELL, .POSIX, .DEFAULT,
// .IGNORE) are RULE NAMES with side-effect semantics, not applied callables:
// `.PHONY: build` says `build` has no file product, it does not attach a
// decorator callable to `build`. The census counts every special-target site
// and its PREREQS (the names the special target governs), plus the two
// decorator-ISH shapes a make file can carry, so the ruling cites counts:
//   (a) `$(eval …)`-born rule text — runtime-generated, not a static target;
//   (b) pattern rules (`%.o: %.c`) — they generate recipes, not decorations.
// NO REGEX on source text for classification: the special-target name table is
// GNU Make's own documented list, and matching is a Set lookup on the parsed
// target word.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = resolve(ROOT, "validation/m14/fixtures/make/special-target-census.current.json")
const SIZE_CAP = 1024 * 1024

const { detectLanguageFromPath } = await import(`${ROOT}/src/ast/language-detection.ts`)
const { getParser } = await import(`${ROOT}/src/ast/engine.ts`)

const EXT = ["mk", "mak", "makefile", "gnumakefile"]
const gateAdmits = (rel: string): boolean => {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (EXT.some((e) => low.endsWith(`.${e}`))) return true
  return EXT.some((e) => base === e) && detectLanguageFromPath(rel) === "make"
}

const found: string[] = []
let absent = 0, overCap = 0
for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!gateAdmits(rel)) continue
    const abs = join(dir, rel)
    try {
      const size = statSync(abs).size
      if (size > SIZE_CAP) { overCap++; continue }
    } catch { absent++; continue }
    found.push(abs)
  }
}
found.sort()
const relOf = (p: string) => (p.startsWith(CR) ? p.slice(CR.length + 1) : p)

// GNU Make's documented special targets (GNU Make Manual §4.8 / §5.5).
const SPECIAL_TARGETS = new Set([
  ".PHONY", ".SUFFIXES", ".DEFAULT", ".PRECIOUS", ".INTERMEDIATE", ".SECONDARY",
  ".DELETE_ON_ERROR", ".IGNORE", ".LOW_RESOLUTION_TIME", ".SILENT",
  ".EXPORT_ALL_VARIABLES", ".NOTPARALLEL", ".ONESHELL", ".POSIX",
  ".SECONDEXPANSION", ".DEFAULT_GOAL", ".MAKEFLAGS", ".SHELLFLAGS",
])

type SpSite = { file: string; line: number; target: string; prereqs: string[] }
const spSites: SpSite[] = []
let evalBorn = 0, patternRules = 0, walkFailed = 0, filesWithSpecial = 0
const walkFailedFiles: string[] = []

for (const f of found) {
  const content = readFileSync(f, "utf8")
  try {
    const parser: any = await getParser("make")
    const tree: any = await parser.parse(content, f)
    if (!tree?.rootNode) throw new Error("null root")
    let sawSpecial = false
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const node: any = stack.pop()
      if (!node) continue
      if (node.type === "rule") {
        const targetsNode = (node.namedChildren ?? []).find((c: any) => c.type === "targets")
        if (targetsNode) {
          const names: string[] = []
          for (const c of targetsNode.namedChildren ?? []) {
            if (c.type === "word") names.push(String(c.text).trim())
            else if (String(c.text).includes("%")) { patternRules++ } // pattern rule: `%.o: %.c`
          }
          for (const n of names) {
            if (SPECIAL_TARGETS.has(n)) {
              sawSpecial = true
              // prereqs of this rule = the names the special target governs
              const prereqs: string[] = []
              for (const child of node.namedChildren ?? []) {
                if (child.type !== "prerequisites") continue
                for (const p of child.namedChildren ?? []) {
                  const t = String(p.text).trim()
                  if (t && t !== "|") prereqs.push(t)
                }
              }
              spSites.push({ file: relOf(f), line: node.startPosition.row + 1, target: n, prereqs })
            }
          }
        }
      }
      if (node.type === "function_call") {
        const txt = String(node.text).trim()
        if (txt.startsWith("$(") || txt.startsWith("${")) {
          const inner = txt.slice(2, -1).trim()
          if (inner.startsWith("eval ") || inner.startsWith("eval\t")) evalBorn++
        }
      }
      for (const c of node.namedChildren ?? []) stack.push(c)
    }
    if (sawSpecial) filesWithSpecial++
  } catch (e) { walkFailed++; walkFailedFiles.push(`${relOf(f)}: ${String(e).slice(0, 60)}`) }
}

if (walkFailed > 0) {
  console.error(`SITE-WALK REFUSAL — ${walkFailed} file(s): ${walkFailedFiles.slice(0, 3).join(" | ")}`)
  process.exit(3)
}

const byTarget: Record<string, number> = {}
for (const s of spSites) byTarget[s.target] = (byTarget[s.target] ?? 0) + 1
const governedNames = spSites.flatMap((s) => s.prereqs)

const artefact = {
  instrument: "script/m14/tmp/make/special-target-census.mts",
  whatThisIs: "Special-target census for the decorates question: every GNU Make special-target site (.PHONY, .SUFFIXES, …) with the prereqs it governs, plus the decorator-ish shapes (eval-born rule text, pattern rules), over the whole gate-admitted make population.",
  population: { corpusRoot: CR, membership: "gate's own admission (exts=[mk,mak,makefile,gnumakefile] + basename + router verdict), git ls-files, 1 MiB cap", admitted: found.length, absent, overCap, walkFailed, repos: new Set(found.map((f) => relOf(f).split("/")[0])).size },
  specialTargetSites: { total: spSites.length, files: filesWithSpecial, byTarget },
  governedNames: { total: governedNames.length, distinct: new Set(governedNames).size },
  decoratorIshShapes: { evalBornFunctionCalls: evalBorn, patternRuleTargetSites: patternRules },
  perSite: spSites,
  walkFailedFiles,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(artefact, null, 2) + "\n")
console.log(`special-target census — ${found.length} admitted · sites ${spSites.length} in ${filesWithSpecial} files`)
console.log(`by target: ${Object.entries(byTarget).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" · ")}`)
console.log(`governed names: ${governedNames.length} total · ${new Set(governedNames).size} distinct`)
console.log(`decorator-ish: eval-born ${evalBorn} · pattern-rule target sites ${patternRules}`)
