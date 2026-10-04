/**
 * LUA-51 — a WRITTEN supertype clause the analyzer does not read, and a probe that
 * could not see it.
 *
 * ## The finding this measures
 *
 * `extends` is emitted from two conventions, both read at the CALL site:
 *
 *   setmetatable(D, B) / setmetatable(D, {__index = B})   real-lua-analyzer.ts:853
 *   Object:extend(Base) / Object.extend(Base)              the `class` branch, :866
 *
 * The second one reads only `firstString` — the class's own NAME — and never looks
 * at a parent argument. Lua's most widely vendored OOP factory declares one:
 *
 *   luarocks/vendor/argparse.lua:38
 *     local function class(prototype, properties, parent)
 *
 * and CALLS it with the parent in THIRD position:
 *
 *     :277  local Command = class({...}, {...}, Parser)
 *     :328  local Option  = class({...}, {...}, Argument)
 *
 * Both are inheritance: `Command` extends `Parser`, `Option` extends `Argument`.
 * The corpus says so in the callee's own body — `if parent then cl.__prototype =
 * deep_update(deep_update({}, parent.__prototype), prototype)`. Neither edge is
 * emitted.
 *
 * ## Why the existing probe MISSED it, which is the part worth keeping
 *
 * `lua-conformance-probe.ts` bucket b1 counted `class(...)` calls and read
 * `as[1]` — the SECOND argument — as the supertype, reporting
 * `b1SupertypeArgumentShape = {name: 0, string: 0, other: 4}`. That is argparse's
 * MIDDLE argument, a table constructor, so all four landed in `other` and the
 * bucket read 0 names — which is what let `implements` be ruled.
 *
 * The probe guessed a POSITION. The convention's position is a property of the
 * callee's parameter list, which is written in the same file, so the probe should
 * have READ it. This is the same defect the coverage gate's header records for
 * json's first `$ref` probe: a probe that matches a SHAPE rather than a ROLE
 * produces a number, and the number is worth nothing.
 *
 * ## The instrument
 *
 * ROLE-RESOLVED, not positional:
 *
 *   1. Collect every function DEFINED in this file, by name, with its parameter
 *      names IN ORDER (`parameters` node, `identifier` children).
 *   2. For each call to such a name, look up which parameter slot carries a
 *      supertype ROLE NAME.
 *   3. Report the call only if the argument IN THAT SLOT is an `identifier`.
 *
 * Step 1 is what makes it falsifiable: a parameter named `parent` in slot 3 is a
 * claim the file makes about its own API, and if the file does not make it, there
 * is nothing to read. A hardcoded index 3 would have convicted argparse by luck.
 *
 * Usage: npx tsx script/m60/lua-supertype-arg-probe.ts [--out <path>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (k: string, d?: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const OUT = path.resolve(ROOT, arg("--out", "validation/m60/lua/supertype-arg-probe.json")!)

/** A parameter name that states its own role. Matched against the callee's OWN
 * `parameters` node, so this list is a role vocabulary and never a position. */
const SUPERTYPE_ROLES = new Set(["parent", "super", "base", "supertype", "superclass", "super_class", "parentclass", "parent_class"])

// ─────────────────────────────────────────────────────── corpus (the draw every lua instrument uses)
const files: Array<{ dir: string; abs: string; text: string; label: string }> = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.lua"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean).sort()
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
    } catch { continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    files.push({ dir, abs, text, label: `${e}/${rel}` })
  }
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-lua.wasm"))))

interface Hit { file: string; line: number; callee: string; slot: number; param: string; arg: string; ownLine: number }
const hits: Hit[] = []
/** Every function name this file defines, with its ordered parameter names. */
const signatureCount = new Map<string, number>()
/** Calls whose callee HAS a supertype-role parameter but whose argument there is
 * not a name — reported apart, because a nil parent means the class has none. */
let roleSlotNonName = 0
const roleSlotNonNameExamples: string[] = []
/** The positional guess the old probe made, so the two numbers can be compared
 * instead of the old one being quietly replaced. */
let positionalGuessNames = 0
/** How many locally-defined factory functions carry a supertype-role parameter
 * AT ALL. If this is 0 the probe could never fire and its 0 means nothing. */
const factoriesWithRole = new Map<string, string[]>()

/** The parameter names of a `parameters` node, in order. `...` is a
 * `vararg_expression` and is not a slot, so it is skipped rather than counted. */
function paramNames(params: any): string[] {
  const out: string[] = []
  if (!params) return out
  for (let i = 0; i < params.namedChildCount; i++) {
    const c = params.namedChild(i)
    if (!c) continue
    if (c.type === "identifier") out.push(c.text)
    else if (c.type === "vararg_expression") continue
    else out.push("")
  }
  return out
}

/** The name a `function_declaration`/`function_definition` binds, when it binds a
 * plain local name. `function M.foo()` binds a FIELD, which is not a call target. */
function definedName(fn: any): string | undefined {
  const n = fn.childForFieldName("name")
  if (n?.type === "identifier") return n.text
  return undefined
}

for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  // Pass 1 — this file's own function signatures, by name.
  const sigs = new Map<string, string[]>()
  const collect = (n: any): void => {
    if (n.type === "function_declaration" || n.type === "function_definition") {
      const nm = definedName(n)
      if (nm && !sigs.has(nm)) {
        const ps = paramNames(n.childForFieldName("parameters"))
        sigs.set(nm, ps)
        if (ps.some((p) => SUPERTYPE_ROLES.has(p.toLowerCase()))) {
          factoriesWithRole.set(`${f.label}:${nm}`, ps)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) collect(c)
    }
  }
  collect(t.rootNode)
  if (sigs.size === 0) { t.delete?.(); continue }
  for (const [, ps] of sigs) signatureCount.set(`${ps.length} params`, (signatureCount.get(`${ps.length} params`) ?? 0) + 1)

  // Pass 2 — calls, resolved against those signatures by ROLE.
  const walk = (n: any): void => {
    if (n.type === "function_call") {
      const callee = n.childForFieldName("name") ?? n.namedChild(0)
      const args = n.childForFieldName("arguments")
      if (callee?.type === "identifier" && args) {
        const nm = callee.text
        const ps = sigs.get(nm)
        const as: any[] = []
        for (let i = 0; i < args.namedChildCount; i++) {
          const c = args.namedChild(i)
          if (c?.type) as.push(c)
        }
        if (ps) {
          ps.forEach((p, slot) => {
            if (!SUPERTYPE_ROLES.has(p.toLowerCase())) return
            const a = as[slot]
            const line = (n.startPosition?.row ?? 0) + 1
            if (a?.type === "identifier") {
              hits.push({
                file: f.label, line, callee: nm, slot, param: p, arg: a.text,
                ownLine: (a.startPosition?.row ?? 0) + 1,
              })
            } else {
              roleSlotNonName++
              if (roleSlotNonNameExamples.length < 12) {
                roleSlotNonNameExamples.push(`${f.label}:${line}: ${nm}(...) arg${slot + 1}=${a?.type ?? "absent"}`)
              }
            }
          })
        }
        // The old probe's guess, recomputed so the change is a comparison.
        if (nm === "class" && as.length >= 2 && as[1]?.type === "identifier") positionalGuessNames++
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c)
    }
  }
  walk(t.rootNode)
  t.delete?.()
}

const byCallee = new Map<string, { n: number; files: Set<string> }>()
for (const h of hits) {
  const row = byCallee.get(h.callee) ?? { n: 0, files: new Set<string>() }
  row.n++
  row.files.add(h.file)
  byCallee.set(h.callee, row)
}

const report = {
  schemaVersion: 1,
  kind: "lua_supertype_arg_probe",
  at: new Date().toISOString(),
  commit: execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  corpus: {
    root: CR,
    filesParsed: files.length,
    sampling: "every tracked *.lua, sorted, no cap",
  },
  grammarWasm: "wasm/tree-sitter-lua.wasm",
  instrument:
    "B:parse-tree-count, role-resolved: the supertype argument's POSITION is read from the callee's own `parameters` node, then the argument at that slot is required to be an identifier. No positional guess, no text match.",
  question: "does the corpus write a supertype as an ARGUMENT to a locally-defined factory, and the analyzer not read it?",
  factoriesWithSupertypeRoleParameter: {
    count: factoriesWithRole.size,
    list: [...factoriesWithRole.entries()].slice(0, 40).map(([k, ps]) => `${k}(${ps.join(", ")})`),
  },
  writtenSupertypeArguments: {
    occurrences: hits.length,
    files: new Set(hits.map((h) => h.file)).size,
    byCallee: [...byCallee.entries()]
      .map(([callee, r]) => ({ callee, occurrences: r.n, files: r.files.size }))
      .sort((a, b) => b.occurrences - a.occurrences),
    hits: hits.slice(0, 60),
  },
  roleSlotPresentButNotAName: {
    occurrences: roleSlotNonName,
    note: "the factory declares a supertype parameter and the call site does not pass a name there — a class with no parent, or a non-literal. Reported so the count above is not read as 'every call has a parent'.",
    examples: roleSlotNonNameExamples,
  },
  comparisonWithThePositionalGuess: {
    oldProbeReadArgumentIndex: 2,
    oldProbeCountOfNameArguments: positionalGuessNames,
    roleResolvedCount: hits.length,
    whyTheyDiffer:
      "the old probe read the SECOND argument of every `class(...)` call. argparse's convention puts the parent in the THIRD, because the callee declares `class(prototype, properties, parent)`. The old number is 0 and it was reported as evidence that no written supertype exists.",
  },
  overturnCondition:
    "0 written supertype arguments resolved by role. A non-zero count of any call whose callee declares a parent/super/base parameter and passes a NAME there is a finding about `extends` coverage.",
}

writeFileSync(OUT, JSON.stringify(report, null, 2))
console.log(`supertype-arg probe — corpus ${files.length} files`)
console.log(`factories declaring a supertype-role parameter: ${factoriesWithRole.size}`)
for (const [k, ps] of [...factoriesWithRole.entries()].slice(0, 20)) console.log(`  ${k}(${ps.join(", ")})`)
console.log(`written supertype arguments (role-resolved): ${hits.length} across ${new Set(hits.map((h) => h.file)).size} files`)
for (const h of hits.slice(0, 30)) console.log(`  ${h.file}:${h.line}  ${h.callee} arg${h.slot + 1} (param '${h.param}') -> ${h.arg}`)
console.log(`role slot present but not a name: ${roleSlotNonName}`)
console.log(`old positional guess would have counted: ${positionalGuessNames}`)
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)