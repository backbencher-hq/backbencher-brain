// script/m14/tmp/sw-line-equivalence.ts — the swift lane's M59.A7 consistency
// proof. A claimed line is only worth anything if the SOURCE at that line
// confirms the edge: every edge's `line_number` must point at a line where the
// edge's target token is actually written.
//
// Measured over both pinned corpora at full extent. Reported as:
//   unlined            — no line_number at all (the cell's defect state)
//   out-of-range       — line < 1 or beyond the end of the file
//   token-checked      — the target's leaf token is present on that exact line
//   exempt:<class>     — a ruled class whose target is IMPLIED by the site and
//                        therefore need not be spelled there (each class is
//                        counted with samples, never silently skipped)
//   INCONSISTENT       — the token is absent and no exemption applies (must be 0)
//
// Run: bun script/m14/tmp/sw-line-equivalence.ts [capPerRepo]
// Reads only; writes nothing.
//
// NOTE on the checker: `lineHasToken` is a boundary-aware scan (no regex, per the
// project contract) and the probe SELF-TESTS it before measuring, so a checker
// that cannot fail cannot report a pass.
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const REPOS = ["swift-nio", "alamofire"].map((r) => path.join("/home/ishaq2321/bb_tests/repositories", r))

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|\.build|build|dist|\.git)/.test(e.name)) filesUnder(p, out) }
    else if (e.name.endsWith(".swift")) out.push(p)
  }
  return out
}

// `$` is NOT an identifier character here: in Swift it is the property-wrapper
// PROJECTION sigil (`$count` reads the wrapper's projected value), and the
// analyzer's SW-F rule publishes the wrapped member (`count`) for exactly that
// spelling — so a line carrying `$count` DOES confirm the target `count`.
const isIdentChar = (c: string): boolean =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_"

/** Boundary-aware substring search: `count` matches `self.count` but not `discount`. */
function lineHasToken(line: string, token: string): boolean {
  if (!token) return false
  let from = 0
  for (;;) {
    const i = line.indexOf(token, from)
    if (i < 0) return false
    const before = i === 0 ? "" : line[i - 1]
    const after = i + token.length >= line.length ? "" : line[i + token.length]
    if (!isIdentChar(before) && !isIdentChar(after)) return true
    from = i + 1
  }
}

function selfTest(): boolean {
  const ok = [
    lineHasToken("        return self.count", "count"),
    lineHasToken("    var path = Path.method(.get)", "Path"),
    lineHasToken("    var path = Path.method(.get)", "method"),
    lineHasToken("    if a == b { return a }", "=="),
    lineHasToken("  func bump() {", "bump"),
  ].every(Boolean)
  const bad = [
    lineHasToken("    let discount = 3", "count"),
    lineHasToken("    return other", "count"),
    lineHasToken("", "count"),
  ].every((x) => x === false)
  return ok && bad
}

async function main() {
  const cap = Number(process.argv[2] ?? 10000)
  if (!selfTest()) {
    console.log("PROBE SELF-TEST FAILED: the token checker does not discriminate — refusing to report a pass")
    process.exit(9)
  }
  console.log("token-checker self-test: OK (matches `self.count`, rejects `discount`/`other`/empty)")

  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-swift-analyzer"))

  let files = 0
  let edges = 0
  let unlined = 0
  const unlinedSample: string[] = []
  let outOfRange = 0
  let checked = 0
  const inconsistent: string[] = []
  const exempt: Record<string, { n: number; sample: string[] }> = {}
  const byKindChecked: Record<string, number> = {}

  const leafOf = (t: string): string => {
    const i = t.lastIndexOf(".")
    return i >= 0 ? t.slice(i + 1) : t
  }
  const noteExempt = (cls: string, file: string, r: any) => {
    exempt[cls] ??= { n: 0, sample: [] }
    exempt[cls].n++
    if (exempt[cls].sample.length < 3) exempt[cls].sample.push(`${file} ${r.type} ${r.source}->${r.target}@${r.line_number}`)
  }

  for (const repo of REPOS) {
    for (const f of filesUnder(repo).sort().slice(0, cap)) {
      files++
      const content = fs.readFileSync(f, "utf8")
      const lines = content.split("\n")
      const p = new P()
      p.setLanguage(LANG)
      let r: any
      try { r = await new mod.RealSwiftAnalyzer().analyze(p.parse(content).rootNode, content, path.basename(f)) } catch { continue }
      const rel = path.relative(ROOT, f)
      for (const e of r.relationships ?? []) {
        edges++
        const ln = e.line_number
        if (typeof ln !== "number" || ln <= 0) {
          unlined++
          if (unlinedSample.length < 8) unlinedSample.push(`${rel} ${e.type} ${e.source}->${e.target} md=${JSON.stringify(e.metadata ?? {})}`)
          continue
        }
        if (ln > lines.length) { outOfRange++; inconsistent.push(`${rel} ${e.type} ${e.source}->${e.target}@${ln} (file has ${lines.length} lines)`); continue }
        const text = lines[ln - 1] ?? ""
        // Operator overloads are spelled as symbols, not identifiers.
        const raw = String(e.target)
        const token = raw.startsWith("operator ") ? raw.slice("operator ".length).trim() : leafOf(raw)
        if (lineHasToken(text, token)) { checked++; byKindChecked[String(e.type)] = (byKindChecked[String(e.type)] ?? 0) + 1; continue }
        // Ruled exemptions: the target is IMPLIED by a site that names it
        // through a different spelling.
        if (raw.startsWith("operator ")) { noteExempt("operator-target", rel, e); continue }
        const md = e.metadata ?? {}
        if (e.type === "instantiates" && md.isEnumConstruction) { noteExempt("enum-construction-target-implied", rel, e); continue }
        if (e.type === "instantiates" && (md.isSelfInit || md.isSuperInit)) { noteExempt("init-delegation-target-implied", rel, e); continue }
        if (e.type === "instantiates" && md.isInstantiation) { noteExempt("bare-construction-target-implied", rel, e); continue }
        if (e.type === "overrides") { noteExempt("override-qualified-parent", rel, e); continue }
        if (e.type === "contains") { noteExempt("contains-declaration-name", rel, e); continue }
        inconsistent.push(`${rel} ${e.type} ${e.source}->${e.target}@${ln} | ${JSON.stringify(text.trim().slice(0, 90))}`)
      }
    }
  }

  console.log(`files=${files} relationships=${edges}`)
  console.log(`unlined=${unlined} out-of-range=${outOfRange} token-checked=${checked} INCONSISTENT=${inconsistent.length}`)
  console.log("token-checked by kind:", JSON.stringify(byKindChecked))
  for (const u of unlinedSample) console.log("  UNLINED " + u)
  for (const [cls, s] of Object.entries(exempt).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`exempt:${cls} n=${s.n}  e.g. ${s.sample.join(" ; ")}`)
  }
  if (inconsistent.length) {
    console.log(`\nfirst ${Math.min(20, inconsistent.length)} inconsistent rows:`)
    for (const x of inconsistent.slice(0, 20)) console.log("  " + x)
    process.exit(1)
  }
}
main()
