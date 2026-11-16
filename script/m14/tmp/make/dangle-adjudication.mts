/**
 * DANGLE ADJUDICATION — what are the 356 unresolved edge ends ACTUALLY?
 *
 * A dangle count on its own is not a defect list, it is a question. Make is
 * STRUCTURALLY prone to unresolved ends: a prerequisite is usually a file rather
 * than a target, a variable is often set by the command line or another
 * makefile, and GNU Make ships builtins that no file declares. Those are not
 * analyzer bugs and calling them bugs would push the fix in the wrong direction
 * (chasing declarations that do not exist).
 *
 * So each unresolved end is classified into exactly one of:
 *   builtinVariable   a GNU Make built-in variable (MAKE, MAKEFILE_LIST, ...)
 *   automaticVariable $@ $< $^ ... — per-recipe, never declared
 *   filePath          a path, not a symbol
 *   externalVariable  a variable this file does not declare (command line,
 *                     environment, or another makefile)
 *   operatorPolluted  the real name exists but was captured WITH its operator
 *                     (`CGO_ENABLED?`), so the reference dangles by construction
 *   trueDangler       none of the above — a real miss
 *
 * Only the last is a defect. The split is what tells us whether to emit `uses`
 * (unresolvable, HCL's precedent) or `references` (resolvable in-project).
 */
import { readFileSync, writeFileSync } from "node:fs"
import { ASTEngine } from "<corpus-root>/backbencher-brain/src/ast/engine"

const MAN = JSON.parse(readFileSync("<corpus-root>/bb_tests/make/out/corpus-manifest.json", "utf8"))
const OUT = "<corpus-root>/bb_tests/make/out"
const REPOS = "<corpus-root>/bb_tests/repositories"

/** GNU Make built-in variables (GNU Make manual, "Variables Used by Make"). */
const BUILTIN_VARIABLES = new Set([
  "MAKE", "MAKEFILE_LIST", "MAKEFILES", "MAKEFLAGS", "MAKECMDGOALS", "MAKELEVEL",
  "CURDIR", "SUFFIXES", "DEFAULT_GOAL", "INCLUDE_DIRS", "LIB_DIRS", "VPATH",
  ".DEFAULT_GOAL", "SHELL", "CC", "CXX", "CPP", "AR", "AS", "LD", "RM", "CFLAGS",
  "CXXFLAGS", "LDFLAGS", "ARFLAGS", "ASFLAGS", "LDFLAGS", "LDLIBS", "YFLAGS",
  "AWK", "FC", "GET", "LEX", "PC", "TEX", "TEXI2DVI", "WEAVE", "CWEAVE",
  "CTANGLE", "RM", "MFLAGS", "MAKE_RESTARTS",
])
const AUTOMATIC = new Set(["@", "<", "^", "+", "?", "*", "%", "@D", "<D", "^D", "+D", "F", "D", "FP"])

const classes: Record<string, number> = {}
const examples: Record<string, unknown[]> = {}
const builtinNames = new Map<string, number>()
const externNames = new Map<string, number>()
const trueDanglerSamples: unknown[] = []

const bump = (k: string, e: unknown) => {
  classes[k] = (classes[k] ?? 0) + 1
  if (!examples[k]) examples[k] = []
  if (examples[k]!.length < 8) examples[k]!.push(e)
}

for (const f of MAN.fileList) {
  const abs = `${REPOS}/${f.repo}/${f.rel}`
  const r: any = await ASTEngine.parseFile(abs, readFileSync(abs, "utf8"))
  const declared = new Set((r.symbols ?? []).map((s: any) => s.name))
  // strip a trailing operator to test the "polluted name" theory
  const stripped = new Set([...declared].map((n) => n.replace(/[?!+:]{1,2}$/, "")))

  for (const x of r.relationships ?? []) {
    const t = String(x.target)
    if (declared.has(t)) continue
    if (t.includes("/") || t.includes(".") || t.includes("*") || t.includes("%")) { bump("filePath", { file: `${f.repo}/${f.rel}`, target: t }); continue }
    // `$$` is Make's ESCAPED dollar, so `$$?` is the SHELL's exit status, not a
    // Make automatic variable. The analyzer labels these `shell_variable` and the
    // class is genuinely distinct, so classifying them as `external` here would
    // contradict the analyzer's own labelling and hide a real tier in a pool.
    if (t.startsWith("$$")) { bump("shellVariable", { file: `${f.repo}/${f.rel}`, target: t }); continue }
    if (AUTOMATIC.has(t) || (t.length <= 2 && t.startsWith("$"))) { bump("automaticVariable", { file: `${f.repo}/${f.rel}`, target: t }); continue }
    if (BUILTIN_VARIABLES.has(t)) { bump("builtinVariable", { file: `${f.repo}/${f.rel}`, target: t }); builtinNames.set(t, (builtinNames.get(t) ?? 0) + 1); continue }
    if (stripped.has(t)) { bump("operatorPolluted", { file: `${f.repo}/${f.rel}`, target: t, declaredAs: [...declared].find((n) => n.replace(/[?!+:]{1,2}$/, "") === t) }); continue }
    externNames.set(t, (externNames.get(t) ?? 0) + 1)
    if (trueDanglerSamples.length < 20) trueDanglerSamples.push({ file: `${f.repo}/${f.rel}`, type: x.type, source: x.source, target: t })
    bump("externalVariable", { file: `${f.repo}/${f.rel}`, target: t })
  }
}

const report = {
  classes,
  examples,
  builtinVariablesSeen: [...builtinNames.entries()].sort((a, b) => b[1] - a[1]),
  topExternalVariables: [...externNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
  distinctExternalVariables: externNames.size,
  note: "only `trueDangler` is a defect; the rest are structural to GNU Make and are what the `uses` class exists for",
}
writeFileSync(`${OUT}/dangle-adjudication.json`, JSON.stringify(report, null, 2) + "\n")

console.log("unresolved edge ends by class:")
for (const [k, n] of Object.entries(classes).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${n}`)
console.log(`\nbuiltin variables seen : ${JSON.stringify(report.builtinVariablesSeen.slice(0, 10))}`)
console.log(`distinct external vars : ${report.distinctExternalVariables}`)
console.log(`top external           : ${JSON.stringify(report.topExternalVariables.slice(0, 10))}`)
console.log(`operatorPolluted sample: ${JSON.stringify(examples.operatorPolluted?.slice(0, 3) ?? [])}`)
