// DEFINE/ENDEF CENSUS — the measurement behind the mixes_in question, over the
// whole gate-admitted make population (755 files). Counts:
//   * define_directive SITES (a macro declaration) and how many are `define
//     NAME =` vs bare `define NAME`;
//   * CALL SITES — `$(call NAME …)` / `${call NAME …}` per macro, plus
//     `$(NAME)` bare-expansion sites, so the "spliced at every call site"
//     denominator is a count, not an impression;
//   * THE DISCRIMINATOR — does a macro compose into a SUPER-type chain? Make
//     has no type declaration; the nearest composition facts are: (a) a macro
//     whose body CALLS another macro (chain-in-body), (b) a macro whose body
//     REFERENCES a variable the same file declares, (c) a `define` nested
//     inside a conditional (compose-under-condition). Each is counted so the
//     ruling can cite the measured shape rather than "no types" alone.
// NO REGEX on source: classification is a tree walk. (The call-site walk reads
// function_call nodes' first argument text, which is a node read, not regex.)
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, resolve, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = resolve(ROOT, "validation/m14/fixtures/make/define-census.current.json")
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

// The analyzer's own helpers, copied by rule.
const trimOperator = (raw: string): string => {
  let end = raw.length
  while (end > 0) {
    const c = raw.charCodeAt(end - 1)
    if (c === 63 || c === 43 || c === 61 || c === 33 || c === 58) end--
    else break
  }
  return raw.slice(0, end).trim()
}

type DefSite = { file: string; line: number; name: string; operator: string; bodyCallsMacro: string[]; bodyRefsDeclared: string[]; inConditional: boolean }
type CallSite = { file: string; line: number; callee: string; caller: string }
const defSites: DefSite[] = []
const callSites: CallSite[] = []
let walkFailed = 0, filesWithDefine = 0, filesWithCall = 0
const walkFailedFiles: string[] = []

for (const f of found) {
  const content = readFileSync(f, "utf8")
  try {
    const parser: any = await getParser("make")
    const tree: any = await parser.parse(content, f)
    if (!tree?.rootNode) throw new Error("null root")
    // pass 1: declarations this file makes (variables + macros), so body
    // references can be split declared vs external exactly as the analyzer does
    const declared = new Set<string>()
    const macros = new Set<string>()
    let sawDefine = false, sawCall = false
    const stack: any[] = [{ node: tree.rootNode, owner: "" }]
    while (stack.length > 0) {
      const { node } = stack.pop() as any
      if (!node) continue
      if (node.type === "variable_assignment") {
        const w = (node.namedChildren ?? []).find((c: any) => c.type === "word")
        if (w) declared.add(trimOperator(String(w.text).trim()))
      }
      if (node.type === "define_directive") {
        sawDefine = true
        const nameNode = (node.namedChildren ?? []).find((c: any) => c.type === "word")
        const name = nameNode ? trimOperator(String(nameNode.text).trim()) : ""
        if (name) { macros.add(name); declared.add(name) }
      }
      for (const c of node.namedChildren ?? []) stack.push({ node: c, owner: "" })
    }
    // pass 2: the site walk, with ancestry for conditional nesting
    const stack2: any[] = [{ node: tree.rootNode, inCond: false, owner: "" }]
    while (stack2.length > 0) {
      const { node, inCond } = stack2.pop() as any
      if (!node) continue
      if (node.type === "define_directive") {
        const line = node.startPosition.row + 1
        const nameNode = (node.namedChildren ?? []).find((c: any) => c.type === "word")
        const rawName = nameNode ? String(nameNode.text).trim() : ""
        const name = trimOperator(rawName)
        // operator: text between the name node and the body
        const body = (node.namedChildren ?? []).find((c: any) => c.type === "raw_text")
        let operator = "define"
        if (nameNode && body) {
          const text = String(node.text ?? "")
          const gap = text.slice(nameNode.endIndex - node.startIndex, body.startIndex - node.startIndex).trim()
          if (gap) operator = gap
        }
        // body composition: nested macro calls + declared-variable references
        const bodyCallsMacro: string[] = []
        const bodyRefsDeclared: string[] = []
        if (body) {
          const bstack: any[] = [body]
          while (bstack.length > 0) {
            const b = bstack.pop() as any
            if (!b) continue
            if (b.type === "function_call") {
              // first field = callee name (the grammar gives no child of its own)
              const txt = String(b.text).trim()
              if (txt.startsWith("$(") || txt.startsWith("${")) {
                const inner = txt.slice(2, -1).trim()
                const first = inner.split(",")[0].trim()
                if (first.startsWith("call") || first === "call") {
                  const callee = inner.split(/\s+/)[1]?.split(",")[0].trim() ?? ""
                  if (callee) bodyCallsMacro.push(callee)
                } else if (inner.startsWith("call ") || inner.startsWith("call\t")) {
                  const callee = inner.slice(5).trim().split(",")[0].trim()
                  if (callee) bodyCallsMacro.push(callee)
                }
              }
            }
            if (b.type === "variable_reference") {
              const vn = String(b.text).trim().replace(/^\$\(|^\$\{/, "").replace(/\)$|\}$/, "").trim()
              if (vn && declared.has(vn) && vn !== name) bodyRefsDeclared.push(vn)
            }
            for (const c of b.namedChildren ?? []) bstack.push(c)
          }
        }
        defSites.push({ file: relOf(f), line, name, operator, bodyCallsMacro, bodyRefsDeclared, inConditional: inCond })
      }
      if (node.type === "function_call") {
        const txt = String(node.text).trim()
        if (txt.startsWith("$(") || txt.startsWith("${")) {
          const inner = txt.slice(2, -1).trim()
          if (inner.startsWith("call ") || inner.startsWith("call\t")) {
            const callee = inner.slice(5).trim().split(",")[0].trim()
            if (callee) { callSites.push({ file: relOf(f), line: node.startPosition.row + 1, callee, caller: "" }); sawCall = true }
          }
        }
      }
      const isCond = inCond || ["conditional", "ifeq_directive", "ifneq_directive", "ifdef_directive", "ifndef_directive"].includes(String(node.type))
      for (const c of node.namedChildren ?? []) stack2.push({ node: c, inCond: isCond, owner: "" })
    }
    if (sawDefine) filesWithDefine++
    if (sawCall) filesWithCall++
  } catch (e) { walkFailed++; walkFailedFiles.push(`${relOf(f)}: ${String(e).slice(0, 60)}`) }
}

if (walkFailed > 0) {
  console.error(`SITE-WALK REFUSAL — ${walkFailed} file(s): ${walkFailedFiles.slice(0, 3).join(" | ")}`)
  process.exit(3)
}

const macroNames = new Set(defSites.map((d) => d.name))
const callsOfMacros = callSites.filter((c) => macroNames.has(c.callee))
const chainInBody = defSites.filter((d) => d.bodyCallsMacro.length > 0)
const refsInBody = defSites.filter((d) => d.bodyRefsDeclared.length > 0)
const inCond = defSites.filter((d) => d.inConditional)

const artefact = {
  instrument: "script/m14/tmp/make/define-census.mts",
  whatThisIs: "define/endef census for the mixes_in question: macro declaration sites, call sites, and the composition discriminators (body calls another macro, body references a declared variable, define nested in a conditional), over the whole gate-admitted make population.",
  population: { corpusRoot: CR, membership: "gate's own admission (exts=[mk,mak,makefile,gnumakefile] + basename + router verdict), git ls-files, 1 MiB cap", admitted: found.length, absent, overCap, walkFailed, repos: new Set(found.map((f) => relOf(f).split("/")[0])).size },
  defineSites: { total: defSites.length, files: filesWithDefine, withOperator: defSites.filter((d) => d.operator !== "define").length, bare: defSites.filter((d) => d.operator === "define").length, inConditional: inCond.length },
  callSites: { total: callSites.length, files: filesWithCall, ofDeclaredMacros: callsOfMacros.length },
  composition: {
    chainInBody: chainInBody.length,
    chainInBodySites: chainInBody.flatMap((d) => d.bodyCallsMacro.map((m) => ({ file: d.file, line: d.line, macro: d.name, calls: m }))),
    bodyRefsDeclaredMacros: refsInBody.filter((d) => d.bodyRefsDeclared.some((r) => macroNames.has(r))).length,
    bodyRefsAnyDeclared: refsInBody.length,
  },
  perDefine: defSites,
  perCall: callSites,
  walkFailedFiles,
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(artefact, null, 2) + "\n")
console.log(`define census — ${found.length} admitted · define sites ${defSites.length} in ${filesWithDefine} files · call sites ${callSites.length} (of declared macros ${callsOfMacros.length}) in ${filesWithCall} files`)
console.log(`composition: chain-in-body ${chainInBody.length} · body-refs-declared ${refsInBody.length} · defines-in-conditional ${inCond.length}`)
