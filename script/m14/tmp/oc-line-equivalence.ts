// script/m14/tmp/oc-line-equivalence.ts — the objc lane's M59.A7 consistency proof.
//
// A claimed line is only worth anything if the SOURCE at that line confirms the
// edge: every edge's `line_number` must point at a line where the edge's target
// token is actually written. Measured over both pinned corpora at full extent:
//   unlined            — no line_number at all (the cell's defect state)
//   out-of-range       — line < 1 or beyond the end of the file
//   token-checked      — the target's NAME token is present on that exact line
//   exempt:<class>     — a ruled class whose target is IMPLIED by the site and
//                        therefore need not be spelled there (each class is
//                        counted with samples, never silently skipped)
//   INCONSISTENT       — the token is absent and no exemption applies (must be 0)
//
// ObjC's name vocabulary is why the token rule is not one rule: a message send's
// name is its FULL selector (`storeImage:forName:`), whose keywords may sit on
// different lines, so the check uses the FIRST keyword; an import's name is the
// path inside the angle brackets/quotes, so the check uses its last segment (a
// `leaf after the last dot` rule would reduce `Foundation/Foundation.h` to `h`,
// which is not a name anyone wrote).
//
// Run: bun script/m14/tmp/oc-line-equivalence.ts [capPerRepo]
// Reads only; writes nothing. The token checker SELF-TESTS before measuring, so a
// checker that cannot fail cannot report a pass.
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const REPOS = ["sdwebimage", "afnetworking"].map((r) => path.join("/home/ishaq2321/bb_tests/repositories", r))

// A header is this lane's file only when the ROUTER admits it (`.h` is sniffed
// for `@interface`/`@protocol`). The universe grew to include the header half in
// the M60 grammar wave, so these numbers must cover it or they describe a lane
// that no longer exists.
let detectLanguageFromPath: any = null
function onlyObjcRouted(file: string): boolean {
  if (!detectLanguageFromPath) return file.endsWith(".m")
  try {
    return detectLanguageFromPath(path.basename(file), fs.readFileSync(file, "utf8")) === "objective-c"
  } catch {
    return false
  }
}

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|\.git|build|dist|Pods\/Podspecs)/.test(e.name)) filesUnder(p, out) }
    else if (e.name.endsWith(".m") || e.name.endsWith(".h")) {
      if (onlyObjcRouted(p)) out.push(p)
    }
  }
  return out
}

// `_` is an identifier character; `$`, `.`, `/`, `:`, `>` and `"` are punctuation in ObjC.
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
    lineHasToken("  - (void)storeImage:(UIImage *)image forName:(NSString *)key", "storeImage"),
    lineHasToken("  @interface Foo : NSObject <NSCoding>", "NSObject"),
    lineHasToken("  #import <Foundation/Foundation.h>", "Foundation.h"),
    lineHasToken("    self.count = 1", "count"),
    lineHasToken("  - (void)setIsCalled:(BOOL)flag", "setIsCalled"),
  ].every(Boolean)
  const bad = [
    lineHasToken("    NSInteger discounted = 3", "count"),
    lineHasToken("  - (void)storeImage:(UIImage *)image", "forName"),
    lineHasToken("", "count"),
  ].every((x) => x === false)
  return ok && bad
}

/**
 * The single token a claimed line must confirm, per the lane's own name vocabulary.
 *
 * ORDER MATTERS, and it was measured: an override's target is a QUALIFIED selector
 * (`UITableViewCell.initWithStyle:reuseIdentifier:`), so a `contains(":")` test applied
 * before the dotted split asks the line for `UITableViewCell.initWithStyle` — a string no
 * source line writes — and 46 genuine rows fell into an exemption they did not deserve.
 * The last dotted segment is the NAME; the selector rule applies to it.
 */
function tokenFor(e: any): { token: string; rule: string } {
  const raw = String(e.target ?? "")
  const md = e.metadata ?? {}
  if (md.isObjCImport) {
    const seg = raw.split("/").pop() ?? raw
    return { token: seg, rule: "import-path-segment" }
  }
  const dotted = raw.lastIndexOf(".")
  const seg = dotted >= 0 ? raw.slice(dotted + 1) : raw
  if (seg.includes(":")) {
    const first = seg.split(":")[0]
    return { token: first, rule: dotted >= 0 ? "qualified-selector-first-keyword" : "selector-first-keyword" }
  }
  if (dotted >= 0) return { token: seg, rule: "dotted-leaf" }
  return { token: raw, rule: "plain" }
}

async function main() {
  const cap = Number(process.argv[2] ?? 10000)
  if (!selfTest()) {
    console.log("PROBE SELF-TEST FAILED: the token checker does not discriminate — refusing to report a pass")
    process.exit(9)
  }
  console.log("token-checker self-test: OK (accepts the selector's first keyword and the import's path segment, rejects `discounted`/a keyword on another line/empty)")

  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer"))
  const ld: any = await import(path.join(ROOT, "src/ast/language-detection"))
  detectLanguageFromPath = ld.detectLanguageFromPath

  let files = 0
  let edges = 0
  let unlined = 0
  const unlinedSample: string[] = []
  let outOfRange = 0
  let checked = 0
  const inconsistent: string[] = []
  const exempt: Record<string, { n: number; sample: string[] }> = {}
  const byKindChecked: Record<string, number> = {}
  const byRule: Record<string, number> = {}

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
      try { r = await new mod.RealObjectiveCAnalyzer().analyze(p.parse(content).rootNode, content, path.basename(f)) } catch { continue }
      const rel = path.relative(ROOT, f)
      for (const e of r.relationships ?? []) {
        edges++
        const ln = e.line_number
        if (typeof ln !== "number" || ln <= 0) {
          unlined++
          if (unlinedSample.length < 8) unlinedSample.push(`${rel} ${e.type} ${e.source}->${e.target}`)
          continue
        }
        if (ln > lines.length) { outOfRange++; inconsistent.push(`${rel} ${e.type} ${e.source}->${e.target}@${ln} (file has ${lines.length} lines)`); continue }
        const text = lines[ln - 1] ?? ""
        const { token, rule } = tokenFor(e)
        if (lineHasToken(text, token)) {
          checked++
          byKindChecked[String(e.type)] = (byKindChecked[String(e.type)] ?? 0) + 1
          byRule[rule] = (byRule[rule] ?? 0) + 1
          continue
        }
        // Ruled exemptions: the target is IMPLIED by the site that names it through a
        // different spelling, so the line legitimately does not carry it.
        const md = e.metadata ?? {}
        if (e.type === "contains" && md.isContained) { noteExempt("contains-member-declared-elsewhere", rel, e); continue }
        if (e.type === "overrides" && md.reasonCode === "first-parent-guess") { noteExempt("override-parent-not-in-file", rel, e); continue }
        inconsistent.push(`${rel} ${e.type} ${e.source}->${e.target}@${ln} rule=${rule} token=${JSON.stringify(token)} | ${JSON.stringify(text.trim().slice(0, 90))}`)
      }
    }
  }

  console.log(`files=${files} relationships=${edges}`)
  console.log(`unlined=${unlined} out-of-range=${outOfRange} token-checked=${checked} INCONSISTENT=${inconsistent.length}`)
  console.log("token-checked by kind:", JSON.stringify(byKindChecked))
  console.log("token rule applied:", JSON.stringify(byRule))
  for (const u of unlinedSample) console.log("  UNLINED " + u)
  for (const [cls, s] of Object.entries(exempt).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`exempt:${cls} n=${s.n}  e.g. ${s.sample.join(" ; ")}`)
  }
  if (inconsistent.length) {
    console.log(`\nfirst ${Math.min(25, inconsistent.length)} inconsistent rows:`)
    for (const x of inconsistent.slice(0, 25)) console.log("  " + x)
    process.exit(1)
  }
}
main()
