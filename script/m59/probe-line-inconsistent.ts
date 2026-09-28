// script/m59/probe-line-inconsistent.ts — M59 #825 diagnostic
//
// After attaching lines at every scala emission site, coverage became 100% but
// the oracle's Tier A check started failing on claims that previously had no
// line at all. This probe records EVERY failing claim (not a 5-sample) with the
// source line and the relationship's own fields, so the failures can be
// classified by mechanism instead of guessed at.
//
// Read-only: writes nothing.

import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS = "$HOME/fixtures/repositories"

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", ".venv", "venv",
  "__pycache__", ".gradle", ".idea", "vendor", "third_party", "tmp", ".next", "coverage",
])

const MAX_BYTES = 400_000

function argNum(name: string, dflt: number): number {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? Number(a.split("=")[1]) : dflt
}

function walkFiles(root: string, exts: Set<string>, cap: number): string[] {
  const found: string[] = []
  const stack = [root]
  while (stack.length > 0 && found.length < cap) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const e of entries) {
      if (found.length >= cap) break
      if (SKIP_DIRS.has(e)) continue
      const p = path.join(dir, e)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(p)
      else if (st.size > 0 && st.size <= MAX_BYTES && exts.has(path.extname(e))) found.push(p)
    }
  }
  return found
}

function calleeToken(rel: any): string | null {
  const raw =
    rel?.target ?? rel?.to ?? rel?.targetExternal ?? rel?.target_external ?? rel?.metadata?.calleeExpression
  if (typeof raw !== "string" || raw.trim().length === 0) return null
  let s = raw.trim()
  s = s.split("(")[0]
  s = s.split("<")[0]
  const parts = s.split(".")
  const last = parts[parts.length - 1]
  return last && /^[\w$#:@-]+$/.test(last) ? last : null
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function tierAConsistent(lines: string[], line: number, token: string): boolean {
  if (!Number.isFinite(line) || line < 1 || line > lines.length) return false
  const src = lines[line - 1]
  const head = token.replace(/_+$/, "")
  const variants = token === head ? [token] : [token, head]
  return variants.some((v) => new RegExp(`(^|[^\\w$])${escapeRe(v)}([^\\w$]|$)`).test(src))
}

// The `$` in the Tier A boundary class is wrong for every language whose source
// uses `$` as a sigil rather than an identifier character (scala interpolation
// `$v`, php `$var`, js `$el`). Measured: `$v` fails while plain `v` passes.
function tierAConsistentFixed(lines: string[], line: number, token: string): boolean {
  if (!Number.isFinite(line) || line < 1 || line > lines.length) return false
  const src = lines[line - 1]
  const head = token.replace(/_+$/, "")
  const variants = token === head ? [token] : [token, head]
  return variants.some((v) => new RegExp(`(^|[^\\w])${escapeRe(v)}([^\\w]|$)`).test(src))
}

// Names the analyzer SYNTHESISES. They are never written in source, so Tier A
// can neither confirm nor refute them; folding them into `inconsistent`
// conflates "cannot check" with "checked and failed" — the exact conflation the
// oracle's own docstring forbids. Shapes only, so an allowlist cannot be used
// to smuggle a real name past the check.
const SYNTHETIC_NAME = /^(constructor|anonymous_object|anonymous_[\w$]+|given_\d+)$/
const UNKNOWN_TARGET = new Set(["?", "<unknown>", "<anonymous>"])

function isCheckableToken(token: string | null, target: string | null): token is string {
  if (!token) return false
  if (SYNTHETIC_NAME.test(token)) return false
  if (target !== null && UNKNOWN_TARGET.has(target)) return false
  if (target !== null && /[{}\n;]/.test(target)) return false // structural body text, not a name
  return true
}

async function main() {
  const filesPerLang = argNum("files-per-lang", 60)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  const files = walkFiles(CORPUS, new Set([".scala"]), filesPerLang)
  const failures: any[] = []
  const notCheckable: any[] = []
  let rels = 0
  let withLine = 0
  let fixedByDollar = 0

  for (const f of files) {
    const content = readFileSync(f, "utf8")
    const lines = content.split("\n")
    let res: any
    try {
      res = await ASTEngine.parseFile(f, content)
    } catch {
      continue
    }
    for (const rel of res?.relationships ?? []) {
      rels++
      const ln = rel?.line_number
      if (typeof ln !== "number" || ln <= 0) continue
      withLine++
      const token = calleeToken(rel)
      const target = rel?.target ?? rel?.to ?? null
      if (!isCheckableToken(token, typeof target === "string" ? target : null)) {
        notCheckable.push({ file: path.relative(CORPUS, f), type: rel?.type, target, token, line: ln })
        continue
      }
      if (tierAConsistentFixed(lines, ln, token)) {
        if (!tierAConsistent(lines, ln, token)) fixedByDollar++
        continue
      }
      failures.push({
        file: path.relative(CORPUS, f),
        type: rel?.type,
        source: rel?.source,
        target: rel?.target ?? rel?.to ?? null,
        token,
        line: ln,
        // the relationship's own start line, if it carries one
        startLine: rel?.startLine ?? rel?.start_line ?? null,
        sourceText: (lines[ln - 1] ?? "").trim().slice(0, 120),
        ctx: [ln - 2, ln - 1, ln, ln + 1, ln + 2]
          .filter((i) => i >= 1 && i <= lines.length)
          .map((i) => `${i === ln ? ">>" : "  "}${i}| ${(lines[i - 1] ?? "").slice(0, 120)}`),
        keys: Object.keys(rel ?? {}).sort().join(","),
      })
    }
  }

  // Classify by a coarse mechanism signature so the report is readable.
  const byType = new Map<string, number>()
  const bySig = new Map<string, number>()
  for (const x of failures) {
    byType.set(String(x.type), (byType.get(String(x.type)) ?? 0) + 1)
    const sig = `${x.type}|${x.token ? "named" : "unnamed"}`
    bySig.set(sig, (bySig.get(sig) ?? 0) + 1)
  }

  console.log(`files=${files.length} rels=${rels} withLine=${withLine}`)
  console.log(
    `inconsistent=${failures.length} notCheckable=${notCheckable.length} ` +
      `(of which $${"{"}…} boundary bug explains ${fixedByDollar})`,
  )
  console.log(`
=== not-checkable by target name ===`)
  const nc = new Map<string, number>()
  for (const x of notCheckable) nc.set(String(x.target).slice(0, 40), (nc.get(String(x.target).slice(0, 40)) ?? 0) + 1)
  for (const [k, v] of [...nc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`${v}\t${k}`)
  console.log(`\n=== by type ===`)
  for (const [k, v] of [...byType.entries()].sort((a, b) => b[1] - a[1])) console.log(`${v}\t${k}`)
  console.log(`\n=== by signature ===`)
  for (const [k, v] of [...bySig.entries()].sort((a, b) => b[1] - a[1])) console.log(`${v}\t${k}`)

  console.log(`\n=== first 25 failures, full context ===`)
  for (const x of failures.slice(0, 25)) {
    console.log(`\n--- ${x.file}`)
    console.log(`type=${x.type} token=${x.token} target=${x.target} line=${x.line} startLine=${x.startLine}`)
    console.log(`src : ${x.sourceText}`)
    console.log(`keys: ${x.keys}`)
    for (const l of x.ctx) console.log(l)
  }

  const classes = new Map<string, any[]>()
  for (const x of failures) {
    const k = String(x.type)
    if (!classes.has(k)) classes.set(k, [])
    classes.get(k)!.push(x)
  }
  console.log(`\n=== one full example per failing type ===`)
  for (const [k, v] of classes) {
    const x = v[0]
    console.log(`\n--- type=${k} count=${v.length}`)
    console.log(`file=${x.file} token=${x.token} target=${x.target} line=${x.line} startLine=${x.startLine}`)
    console.log(`src : ${x.sourceText}`)
    for (const l of x.ctx) console.log(l)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
