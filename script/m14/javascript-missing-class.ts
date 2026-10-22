/**
 * THE d4 DISPOSITION INSTRUMENT — `script/m14/javascript-missing-class.ts`
 *
 * WHAT IT IS FOR. The differential reports a `MISSING` count per lane — a truth row the analyzer
 * does not publish. The harness prints TWELVE SAMPLES of them, which is a DIAGNOSIS AID and not a
 * COUNT: it cannot say whether the class of the missing rows is a defect, a contract, or a draw
 * artefact. THIS INSTRUMENT ANSWERS THAT QUESTION BY REPRODUCING BOTH SIDES' RULES EXACTLY AND
 * DIFFING THE KEY SETS, so the count is a MEASUREMENT and not a sample.
 *
 * ⇒ IT IS LANE-OWNED AND IT READS THE LEAD'S HARNESS (`differential.ts`'s exported
 * `auditTarget`/`normTarget`, and `run-fixtures.ts`'s `getParser`, so the grammar is the SERVED one)
 * and the lane's own analyzer. IT EDITS NOTHING ✓✓.
 *
 * ⇒ USAGE: `BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/javascript-missing-class.ts <repo>`
 *
 * THE MEASURED RESULT IS DISPOSITIONED IN
 * `validation/m14/verification/JAVASCRIPT-WALLS-DISPOSITIONED.md` §4.9 ✓✓.
 */
/**
 * THE d4 DISPOSITION INSTRUMENT FOR `Exposed:javascript` — THE 58 "MISSING" ROWS, CLASSIFIED AND
 * PROVEN, NOT SAMPLED.
 *
 * WHY THIS INSTRUMENT EXISTS. The differential reports `MISSING=58` for Exposed:javascript and the
 * baseline (recorded 2026-10-17) reported `MISSING=2`. The harness itself says the lane is UNPINNED
 * ("no recorded drawn set — those keep the strict count comparison, which can false-positive after
 * a rotation"), and the file set rotated. Two controls have already ruled out the two obvious
 * causes: a run in a git worktree at the tree BEFORE the R3 remedy gives a BYTE-IDENTICAL result
 * (MISSING=58, unexplained=0, heuristic=8, hash 4a9ed14bdbe4710e), so the remedy is not the cause;
 * and a run with the PRE-Lead-commit differential gives the same hash, so the harness change is not
 * the cause either.
 *
 * WHAT IS LEFT IS the ANALYZER's OWN CONTRACT, and this instrument proves it by REPRODUCING BOTH
 * SIDES' RULES EXACTLY AND DIFFING THE KEY SETS:
 *
 *   THE TRUTH SIDE (script/m14/differential.ts:6557-6577) — for a `call_expression`, the truth
 *   pushes `fn.text` (the WHOLE callee text) unless the callee is a `member_expression` (then the
 *   property) or a `subscript_expression`, and unless the text is over 100 chars, contains a
 *   newline, a backtick, `${`, a brace or `=`, or names a builtin. THE TRUTH HAS NO NAME TEST: it
 *   publishes SOURCE TEXT as a target.
 *
 *   THE ANALYZER SIDE (src/ast/real-javascript-analyzer.ts:274) — `isNameLikeCallTarget` refuses a
 *   callee whose text is not a plain identifier, because a `calls` TARGET is read by the graph as a
 *   symbol NAME. The fixture `javascript/non-name-callee-refused` pins that refusal.
 *
 *   THE COMPARISON (differential.ts:25693-25698) — per file, a truth row is covered iff SOME
 *   analyzer row has the same `matchKey` = `normTarget(auditTarget(target))`.
 *
 * ⇒ IF THE DIFF REPRODUCES 58 AND EVERY DIFF ROW'S TARGET IS A REFUSED SOURCE-TEXT CALLEE, THE 58
 * ARE THE ANALYZER'S OWN CONTRACT, NOT A DEFECT, AND THE COUNT IS PROVEN RATHER than SAMPLED.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "./run-fixtures"
import { auditTarget, normTarget } from "./differential"
import { RealJavaScriptAnalyzer } from "../../src/ast/real-javascript-analyzer"

const ROOT = process.cwd()
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const REPO = process.argv[2] ?? "Exposed"
const EXTS = [".js", ".jsx", ".mjs", ".cjs"]

// ── THE TRUTH SIDE'S RULE, COPIED ───────────────────────────────────────────────────────────────────
const JS_CONSOLE_BUILTINS = new Set([
  "console.log", "console.warn", "console.error", "console.info", "console.debug",
  "console.trace", "console.table", "console.group", "console.groupEnd",
  "console.groupCollapsed", "console.time", "console.timeEnd", "console.assert",
  "console.count", "console.countReset", "console.dir", "console.dirxml",
  "console.clear", "console.profile", "console.profileEnd",
])
const JS_OBJECT_LEAF_METHODS = new Set([
  "toString", "valueOf", "hasOwnProperty", "isPrototypeOf",
  "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__defineSetter__",
])
const hasBraceEquals = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "{" || ch === "}" || ch === ";" || ch === "=") return true
  }
  return false
}
const stripWhitespace = (s: string): string => s.replace(/[ \t\n\r]/g, "")
const isBuiltinCall = (targetName: string, fullCallee: string): boolean => {
  if (targetName === "super") return true
  if (JS_CONSOLE_BUILTINS.has(fullCallee)) return true
  if (JS_CONSOLE_BUILTINS.has(stripWhitespace(fullCallee))) return true
  if (JS_OBJECT_LEAF_METHODS.has(targetName)) return true
  return false
}

// ── THE ANALYZER SIDE'S RULE, COPIED ────────────────────────────────────────────────────────────────
const isNameLikeCallTarget = (text: string): boolean => /^#?[\p{L}\p{Nl}_$][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}_$]*$/u.test(text)

function filesOf(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    let entries: any[]
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      let st: any
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(p)
      else if (st.isFile() && EXTS.some((x) => e.name.toLowerCase().endsWith(x))) out.push(p)
    }
  }
  walk(dir)
  return out
}

const parser = await getParser("javascript")
const analyzer = new RealJavaScriptAnalyzer()
const repoDir = path.join(CR, REPO)
const files = filesOf(repoDir).sort()

let truthTotal = 0
let covered = 0
let missing = 0
const missingRows: { file: string; target: string }[] = []
const classes = new Map<string, number>()

for (const f of files) {
  const src = readFileSync(f, "utf8")
  const tree = parser.parse(src)

  // ── THE TRUTH SIDE ───────────────────────────────────────────────────────────────────────────────
  const truth = new Set<string>()
  const st: any[] = [tree.rootNode]
  while (st.length) {
    const n = st.pop()
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function")
      const isImportCallee = !!fn && (fn.type === "import" || (fn.type === "identifier" && fn.text === "import"))
      const isRequire = !!fn && fn.type === "identifier" && fn.text === "require"
      if (fn && !isRequire && !isImportCallee) {
        let targetName = fn.text
        const fullCallee = fn.text
        if (fn.type === "member_expression") {
          const prop = fn.childForFieldName("property")
          if (prop) targetName = prop.text
        }
        if (
          fn.type !== "subscript_expression" &&
          targetName.length <= 100 &&
          !targetName.includes("\n") &&
          !targetName.includes("`") &&
          !targetName.includes("${") &&
          !hasBraceEquals(targetName) &&
          !isBuiltinCall(targetName, fullCallee)
        ) truth.add(targetName)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) st.push(c)
    }
  }

  // ── THE ANALYZER SIDE ───────────────────────────────────────────────────────────────────────────
  const result: any = analyzer.analyze(tree.rootNode, src, f)
  const rels: any[] = result?.relationships ?? []
  const analyzerKeys = new Set<string>()
  for (const r of rels) {
    if (r.type !== "calls") continue
    analyzerKeys.add(normTarget(auditTarget(r.target)))
  }

  for (const te of truth) {
    truthTotal++
    const k = normTarget(auditTarget(te))
    if (analyzerKeys.has(k)) covered++
    else {
      missing++
      missingRows.push({ file: path.relative(repoDir, f), target: te })
      // THE CLASS: is the target a SOURCE-TEXT callee the analyzer refuses by contract?
      const cls = isNameLikeCallTarget(te) ? "PUBLISHED-ELSEWHERE (name-like, spelled differently)" : "REFUSED-BY-CONTRACT (source text, isNameLikeCallTarget)"
      classes.set(cls, (classes.get(cls) ?? 0) + 1)
    }
  }
}

console.log(`repo ${REPO} · ${files.length} javascript file(s)`)
console.log(`truth calls rows (deduped per file): ${truthTotal}`)
console.log(`  covered by the analyzer: ${covered}`)
console.log(`  MISSING: ${missing}`)
console.log(`the classes of the MISSING rows:`)
for (const [k, v] of [...classes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v} × ${k}`)
console.log(`every MISSING row (target :: file):`)
for (const r of missingRows) console.log(`  ${r.target.replace(/\s+/g, " ").slice(0, 90)}  ::  ${r.file}`)
