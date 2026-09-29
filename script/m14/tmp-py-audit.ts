import * as fs from "node:fs";
import * as path from "node:path";

// PYTHON AUDIT — the method that found markdown's four worst defects:
//  1. resolve EVERY relationship endpoint against the file's OWN symbols, by name AND
//     by name+line (the store's key), not by counting;
//  2. sweep relationship types SEPARATELY, because an aggregate hides a whole class
//     when another type dominates;
//  3. classify targets rather than counting them, because python legitimately targets
//     things outside the file (imported modules, external callees, builtins) and a
//     count cannot tell an external target from an internal one that names nothing.
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const engine: any = await import(path.join(ROOT, "src/ast/engine"));

type R = {
  n: number; noLine: number; noClass: number; noConf: number; noSrc: number
  local: number; localMiss: number; localLineMiss: number
  ext: number; extBuiltin: number
  roles: Map<string, number>; bad: string[]
}
const types = new Map<string, R>()
const row = (t: string): R => {
  let r = types.get(t)
  if (!r) { r = { n: 0, noLine: 0, noClass: 0, noConf: 0, noSrc: 0, local: 0, localMiss: 0, localLineMiss: 0, ext: 0, extBuiltin: 0, roles: new Map(), bad: [] }; types.set(t, r) }
  return r
}

// python builtins: the analyzer already filters these from call targets; a target that
// IS a builtin in a call is worth knowing about, so they are counted not hidden.
const BUILTIN = new Set(["print","len","range","str","int","float","list","dict","set","tuple","bool","isinstance","type","open","enumerate","zip","sum","min","max","abs","sorted","reversed","map","filter","any","all","round","super","getattr","setattr","hasattr","format","repr","iter","next","id","hash","input","bytes","frozenset","complex","object","property","staticmethod","classmethod","vars","dir","callable","slice","memoryview","bytearray","NotImplemented","Ellipsis","__name__","__init__","__str__","__repr__","__eq__","__hash__","__enter__","__exit__","__iter__","__next__","__len__","__getitem__","__setitem__","__call__"])

let files = 0, syms = 0, errs = 0, parseErr = 0
const t0 = Date.now()

for (const f of process.argv.slice(2)) {
  let res: any
  try { res = await engine.ASTEngine.parseFile(f, fs.readFileSync(f, "utf8")) } catch { parseErr++; continue }
  if (res?.language !== "python") continue
  files++
  syms += (res.symbols ?? []).length
  if ((res.errors ?? []).length) errs++
  const byName = new Map<string, number[]>()
  for (const s of res.symbols ?? []) { const k = String(s.name); byName.set(k, [...(byName.get(k) ?? []), s.range?.startLine ?? -1]) }
  for (const r of res.relationships ?? []) {
    const t = String(r.type), R = row(t)
    R.n++
    const role = String(r.metadata?.role ?? "-")
    R.roles.set(role, (R.roles.get(role) ?? 0) + 1)
    const line = r.line_number
    if (typeof line !== "number" || line <= 0) { R.noLine++; if (R.bad.length < 4) R.bad.push(`no line: ${t} ${r.source} -> ${r.target}`) }
    if (!r.metadata?.evidenceClass) { R.noClass++; if (R.bad.length < 4) R.bad.push(`no evidenceClass: ${t} ${r.source} -> ${r.target}`) }
    if (typeof r.confidence !== "number") { R.noConf++; if (R.bad.length < 4) R.bad.push(`no confidence: ${t}`) }
    if (!byName.has(String(r.source))) R.noSrc++
    // The TARGET. A name the file declares is LOCAL and must resolve by name+line.
    const tgt = String(r.target ?? "")
    const tl = byName.get(tgt)
    if (tl) {
      R.local++
      if (typeof line !== "number" || !tl.includes(line)) {
        R.localLineMiss++
        if (R.bad.length < 4) R.bad.push(`LOCAL target line mismatch: ${t} ${r.source} -> ${tgt} @L${line}; symbol lines ${tl.slice(0,4).join(",")} (${path.basename(f)})`)
      }
    } else {
      R.ext++
      if (BUILTIN.has(tgt)) R.extBuiltin++
    }
  }
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`files=${files} symbols=${syms} filesWithParseErrors=${errs} unreadable=${parseErr} wall=${secs}s relationshipTypes=${types.size}\n`)
const p = (x: unknown, n: number) => String(x).padEnd(n)
console.log(p("TYPE", 13) + p("count", 9) + p("no-line", 9) + p("no-class", 10) + p("no-conf", 9) + p("local", 9) + p("loc-miss", 9) + p("loc-line", 9) + p("external", 10) + "src-not-local")
for (const [t, R] of [...types].sort((a, b) => b[1].n - a[1].n))
  console.log(p(t, 13) + p(R.n, 9) + p(R.noLine, 9) + p(R.noClass, 10) + p(R.noConf, 9) + p(R.local, 9) + p(R.localMiss, 9) + p(R.localLineMiss, 9) + p(R.ext, 10) + R.noSrc)
for (const [t, R] of types) {
  console.log(`\n${t}: ${[...R.roles].map(([k, v]) => `${k}=${v}`).join(" ")}`)
  for (const b of R.bad) console.log(`   ! ${b}`)
}
