// script/m60/objc-line-truth.ts — are the 24,114 line NUMBERS right, not merely present?
//
// The edge audit already proves 24,114/24,114 relationships carry a `line_number`. Presence is
// the easy half, and it is the half that survives being wrong: a row pointing at line 1 of a
// 600-line file is "present" and useless. Nothing in this lane has ever checked the second
// thing, and a wrong line is worse than a missing one, because a consumer that navigates to a
// relationship's line lands somewhere confident and wrong rather than nowhere.
//
// THREE CHECKS, INCREASINGLY DEMANDING, and each one's result is reported separately because
// they fail for different reasons and averaging them would hide that.
//
//   1. IN RANGE      — 1 <= line <= the file's line count. Catches off-by-one and 0/1-base
//                      confusion, which is the classic and which a "0 means absent" convention
//                      makes invisible: a 0-based line on line 1 is a real 1 rendered as 0.
//
//   2. LINE PLAUSIBLE — the source line plausibly CONTAINS the edge. A `contains` edge should
//                      name its member on that line; a `calls` edge should contain the selector;
//                      a `class extends superclass` should sit on the `@interface` line. This is
//                      checked per relationship type against a per-type rule, because "the line
//                      mentions the target" is the right question for some types and the wrong
//                      one for others.
//
//   3. EXACT         — for the types where it is decidable from the line alone, the target
//                      appears ON that line, not merely in the file. `contains` is the strong
//                      case: a container's members are declared on the member's own line, and
//                      the closure record's OBJCD7 finding was precisely that this relationship
//                      had been publishing CONTAINER lines for member rows. If that regressed,
//                      this is the check that sees it.
//
// WHY NOT JUST ASK THE ORACLE
// ---------------------------
// Because the F5 oracle derives its truth from the same tree, so it cannot see a line the tree
// itself produced. And because a line is a claim about TEXT, so the arbiter should be the text.
// Every check here re-reads the file and looks at the line the analyzer pointed at, which is an
// arbiter the analyzer has no access to.
//
// Scoped honestly: this proves the line is plausible or decidably wrong. It does NOT prove the
// line is the BEST line — for `overrides` the superclass member is not on the line at all, and
// for `references` the target is a module that may be imported on that line or elsewhere. Those
// types are reported with their rule named and are not counted as failures.
//
// Usage: bun run script/m60/objc-line-truth.ts [--per-file=0] [--sample=N]
// Writes: validation/m60/results/objc-line-truth.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const OUT = path.join(ROOT, "validation/m60/results/objc-line-truth.json")
const REPOS = ["sdwebimage", "afnetworking", "Clyde"]
const argNum = (f: string, d: number) => { const a = process.argv.find((x) => x.startsWith(`--${f}=`)); return a ? Number(a.slice(f.length + 3)) : d }
const argSample = argNum("sample", 12)

const admitted = (abs: string) => {
  const ext = path.extname(abs).toLowerCase()
  if (ext === ".m" || ext === ".mm") return true
  if (ext !== ".h") return false
  try { const fd = fs.openSync(abs, "r"); const b = Buffer.alloc(65536); const n = fs.readSync(fd, b, 0, 65536, 0); fs.close(fd); return /@(?:interface|protocol|implementation)\s+[A-Za-z_]/.test(b.toString("utf8", 0, n)) } catch { return false }
}

/** A selector's last keyword, which is the part a line should contain. */
const selLeaf = (s: string) => { const parts = s.split(":").filter(Boolean); return parts[parts.length - 1] ?? s }
const isSelectorShaped = (s: string) => /^[A-Za-z_]\w*:/.test(s)

type Rule = "exact" | "plausible" | "not-decidable"
/** What "the line should contain the target" means for each type, and why. */
const RULE: Record<string, { rule: Rule; why: string }> = {
  contains: { rule: "exact", why: "a member is declared on the member's own declaration; the OBJCD7 defect was exactly this relationship publishing the CONTAINER's line for member rows. Selector-shaped members are matched by leaf over a small window, because an Objective-C selector WRAPS and no single line carries the full string" },
  extends: { rule: "exact", why: "the superclass name is written on the @interface/@protocol line that the edge is about" },
  implements: { rule: "exact", why: "a conformed protocol is named in the @interface's protocol list, on that line" },
  uses: { rule: "plausible", why: "a value read's target is a name in scope, which need not be on the read's own line (a parameter is read far from its declaration) — so presence on the line is necessary, not sufficient" },
  calls: { rule: "plausible", why: "a selector is written at the send, and the edge's target is the FULL selector, so the LEAF is what must appear — over a window, since a send routinely wraps across lines in this language" },
  instantiates: { rule: "plausible", why: "the class receiver is on the line for [[Foo alloc] init] and [Foo new], but a nested alloc puts the receiver one line up" },
  overrides: { rule: "not-decidable", why: "the target is a SUPERCLASS member, absent from the subclass file by definition — an override's line is the overriding declaration, which is correct" },
  references: { rule: "not-decidable", why: "the target is a module name from an #import, and whether the line is the import or the use is a design choice this lane has not pinned" },
}

async function main() {
  const perType = new Map<string, { total: number; inRange: number; zeroLine: number; overLine: number; exactHit: number; exactMiss: number; plausibleHit: number; plausibleMiss: number; samples: string[] }>()
  const t = () => ({ total: 0, inRange: 0, zeroLine: 0, overLine: 0, exactHit: 0, exactMiss: 0, plausibleHit: 0, plausibleMiss: 0, samples: [] as string[] })
  let files = 0, totalEdges = 0
  const failures: any[] = []

  for (const repo of REPOS) {
    const dir = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(dir)) continue
    let ls = ""
    try { ls = execSync("git ls-files '*.m' '*.mm' '*.h'", { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }) } catch { continue }
    for (const f of ls.split("\n").filter((x) => x.trim())) {
      const abs = path.join(dir, f)
      if (!admitted(abs)) continue
      let src: string
      try { src = readFileSync(abs, "utf8") } catch { continue }
      const lines = src.split("\n")
      let p: any
      try { p = await parseFile(abs, dir) } catch { continue }
      files++
      for (const r of p.relationships ?? []) {
        totalEdges++
        const type = String(r.type ?? "")
        if (!perType.has(type)) perType.set(type, t())
        const row = perType.get(type)!
        row.total++
        const ln = r.line_number ?? 0
        const rel = `${f}:${ln} ${r.source} ${type} ${r.target}`
        if (ln === 0) {
          row.zeroLine++
          if (row.samples.length < argSample) row.samples.push(`LINE-0  ${rel}`)
          continue
        }
        if (ln < 1 || ln > lines.length) {
          row.overLine++
          if (row.samples.length < argSample) row.samples.push(`OUT-OF-RANGE(file has ${lines.length})  ${rel}`)
          continue
        }
        row.inRange++
        const line = lines[ln - 1] ?? ""
        const rule = RULE[type]?.rule ?? "plausible"
        const tgt = String(r.target ?? "")

        // A SINGLE-LINE test is the wrong test for an Objective-C selector, and the first
        // version of this tool made exactly that mistake and reported 836 `contains` misses.
        // The samples were not defects — they were the language's own formatting:
        //
        //     - (BOOL)application:(UIApplication *)application
        //                 didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
        //
        // The edge's target is `application:didFinishLaunchingWithOptions:`, a string that
        // appears on no single line anywhere, because a selector WRAPS. Requiring the full
        // selector on one line cannot succeed for a wrapped declaration, so the check was
        // measuring line-length, not correctness.
        //
        // So: a selector-shaped target is matched by its LEAF, and because a selector may wrap
        // over several lines, the leaf is looked for in a small WINDOW starting at the edge's
        // line — the declaration or the send cannot have its final keyword arbitrarily far below
        // its opening. Non-selector targets (a type name, a property name) keep the strict
        // single-line test, because those are not wrapped.
        // A six-line window, stated as the arbitrary bound it is. Two other bounds were tried
        // and measured, and both are recorded because the second was worse and the reason is
        // the useful part:
        //
        //   - a single line: 78.5% on `contains`, because an Objective-C selector WRAPS and
        //     its full string appears on no single line anywhere. That measured line-length,
        //     not correctness.
        //   - to the end of the enclosing statement, breaking on the first following `;` or
        //     `{`: 92.1% on `contains`, WORSE than the plain window, because a method
        //     declaration's BODY brace is not the end of its declaration — `- (void)setX:(id)x
        //     completed:(void(^)(void))done {` puts `{` on the same line as the last keyword
        //     region, and the break fired before the leaf was read.
        //
        // So the window stays, and the residual it leaves — selectors wrapping further than six
        // lines, e.g. `sd_internalSetImageWithURL:placeholderImage:options:context:setImageBlock:
        // progress:completed:` — is REPORTED rather than tuned away. Widening the window until
        // the number reads well is how a check stops checking.
        const SEL_WINDOW = 6
        const hit = isSelectorShaped(tgt)
          ? (() => {
              const leaf = selLeaf(tgt)
              if (!leaf) return false
              for (let k = ln - 1; k < Math.min(lines.length, ln - 1 + SEL_WINDOW); k++)
                if ((lines[k] ?? "").includes(leaf)) return true
              return false
            })()
          : line.includes(tgt)
        if (rule === "exact") {
          if (hit) row.exactHit++
          else {
            row.exactMiss++
            if (row.samples.length < argSample) row.samples.push(`EXACT-MISS  ${rel}\n              line ${ln}: ${line.trim().slice(0, 100)}`)
          }
        } else if (rule === "plausible") {
          if (hit) row.plausibleHit++
          else {
            row.plausibleMiss++
            if (row.samples.length < argSample) row.samples.push(`PLAUSIBLE-MISS  ${rel}\n              line ${ln}: ${line.trim().slice(0, 100)}`)
          }
        }
        if ((rule === "exact" && !hit) || (rule === "plausible" && !hit)) {
          if (failures.length < 400) failures.push({ file: f, rel: `${r.source} ${type} ${r.target}`, line: ln, rule, text: line.trim().slice(0, 140) })
        }
      }
    }
  }

  const rows = [...perType.entries()].map(([type, r]) => ({
    type,
    rule: RULE[type]?.rule ?? "plausible",
    ruleWhy: RULE[type]?.why ?? "no rule declared; treated as plausible",
    edges: r.total,
    inRange: r.inRange,
    lineZero: r.zeroLine,
    outOfRange: r.overLine,
    inRangePct: r.total ? +(100 * r.inRange / r.total).toFixed(2) : null,
    lineContainsTarget: r.exactHit + r.plausibleHit,
    lineMissesTarget: r.exactMiss + r.plausibleMiss,
    containsPct: (r.exactHit + r.plausibleHit + r.exactMiss + r.plausibleMiss) > 0
      ? +(100 * (r.exactHit + r.plausibleHit) / (r.exactHit + r.plausibleHit + r.exactMiss + r.plausibleMiss)).toFixed(2)
      : null,
    samples: r.samples,
  })).sort((a, b) => b.edges - a.edges)

  const decidable = rows.filter((r) => r.rule !== "not-decidable")
  const exactRows = rows.filter((r) => r.rule === "exact")
  const anyOutOfRange = rows.some((r) => r.lineZero > 0 || r.outOfRange > 0)

  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "Objective-C relationship LINE truth: in range, and does the line contain the target",
    generatedAt: new Date().toISOString(),
    method:
      `every relationship in the router's universe (${files} files, ${totalEdges} edges). For each edge: ` +
      `is the line within the file, and does the SOURCE TEXT of that line contain the edge's target — ` +
      `under a per-type rule, because "the line mentions the target" is the right question for a ` +
      `member declaration and the wrong one for a superclass member that is not in the file at all. ` +
      `The arbiter is the file's own text, which the analyzer has no access to and which the F5 ` +
      `oracle cannot supply either, since it derives truth from the same tree.`,
    why:
      "presence is the easy half and it is the half that survives being wrong: a row pointing at line 1 of a 600-line file is present and useless, and a wrong line is worse than a missing one because a consumer lands somewhere confident",
    files, totalEdges,
    rules: RULE,
    byType: rows,
    totals: {
      inRange: rows.reduce((n, r) => n + r.inRange, 0),
      lineZero: rows.reduce((n, r) => n + r.lineZero, 0),
      outOfRange: rows.reduce((n, r) => n + r.outOfRange, 0),
      decidableEdges: decidable.reduce((n, r) => n + r.inRange, 0),
      decidableHits: decidable.reduce((n, r) => n + r.lineContainsTarget, 0),
      exactEdges: exactRows.reduce((n, r) => n + r.inRange, 0),
      exactHits: exactRows.reduce((n, r) => n + r.lineContainsTarget, 0),
    },
    failures: failures.slice(0, 200),
    verdict:
      anyOutOfRange
        ? `LINE NUMBERS ARE NOT ALL IN RANGE: ${rows.reduce((n, r) => n + r.lineZero + r.outOfRange, 0)} edge(s) at 0 or past the end of the file.`
        : `all ${totalEdges.toLocaleString()} lines in range. Of the ${decidable.reduce((n, r) => n + r.inRange, 0).toLocaleString()} edges whose type makes the line decidable, ` +
          `${decidable.reduce((n, r) => n + r.lineContainsTarget, 0).toLocaleString()} point at a line containing the target ` +
          `(${decidable.reduce((n, r) => n + r.inRange, 0) ? +(100 * decidable.reduce((n, r) => n + r.lineContainsTarget, 0) / decidable.reduce((n, r) => n + r.inRange, 0)).toFixed(2) : 0}%). ` +
          `EXACT types only (contains/extends/implements, where the line is decidable): ` +
          `${exactRows.reduce((n, r) => n + r.lineContainsTarget, 0)}/${exactRows.reduce((n, r) => n + r.inRange, 0)} ` +
          `(${exactRows.reduce((n, r) => n + r.inRange, 0) ? +(100 * exactRows.reduce((n, r) => n + r.lineContainsTarget, 0) / exactRows.reduce((n, r) => n + r.inRange, 0)).toFixed(2) : 0}%).`,
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")

  console.log(`files ${files}   edges ${totalEdges.toLocaleString()}\n`)
  console.log("per type (rule = what 'the line should contain the target' means here):")
  for (const r of rows) {
    console.log(`  ${r.type.padEnd(13)} ${String(r.edges).padStart(6)}  ${r.rule.padEnd(14)} inRange ${String(r.inRange).padStart(6)} (${r.inRangePct}%)  line-hit ${String(r.lineContainsTarget).padStart(6)}  miss ${String(r.lineMissesTarget).padStart(5)}  contains ${r.containsPct ?? "-"}%`)
  }
  console.log(`\ntotals: inRange ${payload.totals.inRange}  line0 ${payload.totals.lineZero}  outOfRange ${payload.totals.outOfRange}`)
  console.log(`decidable edges ${payload.totals.decidableEdges}  hit ${payload.totals.decidableHits}`)
  console.log(`EXACT types    ${payload.totals.exactEdges}  hit ${payload.totals.exactHits}`)
  console.log(`\nVERDICT: ${payload.verdict}`)
  for (const r of rows) for (const s of r.samples.slice(0, 2)) console.log(`  ${s}`)
  console.log(`-> ${path.relative(ROOT, OUT)}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
