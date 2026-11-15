// M49 W17 (cont): verify the JVM family's M12 corpus claims.
//
// Every M12 corpus claim lives in `validation/m12/corpus-manifest.json` as prose
// plus a `grammarErrorFiles` number. The groovy claim ("0/400 grammar errors and
// 0 missing tokens") does not reproduce, and an audit of `script/m12/` shows why:
// there is a `*-corpus-errors.ts` for 35 languages and NONE for java, kotlin,
// scala or groovy. The claims were never executable.
//
// This re-measures each JVM language over the EXACT sample file list recorded in
// that language's `*-corpus-sample.txt`, at the pinned revision, through the
// PRODUCTION parser path (ASTEngine.getParser, fresh parser per file — the
// pool-worker behaviour the dart script documents). ERROR and MISSING are
// counted separately (they are different defects).
//
// Usage: bun run script/m14/tmp/jvm-corpus-claims.ts [lang ...]
import * as fs from "fs"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

// The repo each sample's relative paths resolve against, and the claim under test.
const LANGS: Record<string, { repo: string; claim: string; claimed: number | null }> = {
  java: { repo: "/home/ishaq2321/intellij-community", claim: "no grammarErrorFiles field (never measured)", claimed: null },
  kotlin: { repo: "/home/ishaq2321/intellij-community", claim: "grammarErrorFiles: 51 of 300", claimed: 51 },
  scala: { repo: "/home/ishaq2321/bb_tests/repositories/scala3", claim: "grammarErrorFiles: 0 of 400", claimed: 0 },
  groovy: { repo: "/home/ishaq2321/bb_tests/repositories/grails-core", claim: "0/400 grammar errors and 0 missing tokens", claimed: 0 },
}

type Row = {
  lang: string
  files: number
  missingFilesInCorpus: number
  errFiles: number
  missFiles: number
  either: number
  errNodes: number
  missNodes: number
  crashes: number
  claimed: number | null
  examples: string[]
}

function scan(root: any): { err: number; miss: number; first: string } {
  let err = 0
  let miss = 0
  let first = ""
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "ERROR") {
      err++
      if (!first) first = "ERROR @line " + (n.startPosition.row + 1)
    }
    if (n.isMissing) {
      miss++
      if (!first) first = "MISSING " + n.type + " @line " + (n.startPosition.row + 1)
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return { err, miss, first }
}

async function measure(lang: string): Promise<Row> {
  const cfg = LANGS[lang]
  const sample = fs
    .readFileSync(ROOT + "/validation/m12/results/" + lang + "-corpus-sample.txt", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const row: Row = {
    lang,
    files: 0,
    missingFilesInCorpus: 0,
    errFiles: 0,
    missFiles: 0,
    either: 0,
    errNodes: 0,
    missNodes: 0,
    crashes: 0,
    claimed: cfg.claimed,
    examples: [],
  }

  for (const rel of sample) {
    const p = cfg.repo + "/" + rel
    let src: string
    try {
      src = fs.readFileSync(p, "utf8")
    } catch {
      row.missingFilesInCorpus++
      continue
    }
    try {
      // Fresh parser per file — the production pool-worker behaviour.
      const parser = await ASTEngine.getParser(lang as any)
      const tree = parser.parse(src)
      if (!tree || !tree.rootNode) {
        row.crashes++
        continue
      }
      const st = scan(tree.rootNode)
      row.files++
      row.errNodes += st.err
      row.missNodes += st.miss
      if (st.err > 0) row.errFiles++
      if (st.miss > 0) row.missFiles++
      if (st.err > 0 || st.miss > 0) {
        row.either++
        if (row.examples.length < 6) row.examples.push(rel + " -> " + st.first)
      }
    } catch {
      row.crashes++
    }
  }
  return row
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"))
  const langs = args.length > 0 ? args : Object.keys(LANGS)
  const rows: Row[] = []
  for (const l of langs) {
    if (!LANGS[l]) {
      console.error("unknown lang: " + l + " (known: " + Object.keys(LANGS).join(", ") + ")")
      process.exit(2)
    }
    const r = await measure(l)
    rows.push(r)
    const pct = ((r.either / Math.max(1, r.files)) * 100).toFixed(1)
    console.log("")
    console.log("=== " + l + " ===")
    console.log("   sample files measured : " + r.files + (r.missingFilesInCorpus ? "  (" + r.missingFilesInCorpus + " sample paths absent in corpus)" : ""))
    console.log("   ERROR files           : " + r.errFiles + "  (" + r.errNodes + " nodes)")
    console.log("   MISSING files         : " + r.missFiles + "  (" + r.missNodes + " nodes)")
    console.log("   either                : " + r.either + " / " + r.files + "  (" + pct + "%)")
    console.log("   crashes               : " + r.crashes)
    console.log("   manifest claim        : " + LANGS[l].claim)
    const verdict =
      r.claimed === null ? "UNMEASURED IN MANIFEST" : r.either === 0 && r.crashes === 0 ? "CONFIRMED" : "DOES NOT REPRODUCE"
    console.log("   VERDICT               : " + verdict)
    for (const e of r.examples) console.log("     " + e)
  }

  console.log("")
  console.log("=== summary ===")
  for (const r of rows) {
    const pct = ((r.either / Math.max(1, r.files)) * 100).toFixed(1)
    console.log(
      "  " +
        r.lang.padEnd(8) +
        " measured " +
        String(r.either).padStart(4) +
        "/" +
        String(r.files).padEnd(4) +
        " (" +
        pct.padStart(5) +
        "%)   claimed " +
        (r.claimed === null ? "none" : String(r.claimed)),
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
