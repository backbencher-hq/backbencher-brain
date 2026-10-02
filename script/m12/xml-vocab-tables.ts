/**
 * THE DECLARATION-VOCABULARY TABLES MUST COVER THE SAME NAMESPACES.
 *
 * `real-xml-analyzer.ts` keeps `DECLARATION_VOCABULULARIES` — which vocabularies
 * put an element's own name in an attribute, and which of their constructs do.
 * The differential's XML oracle keeps its own `XML_DECL_NS`, written
 * independently on purpose: an oracle that imports the analyzer's table agrees
 * with it by construction, and an oracle that cannot disagree is a mirror, not a
 * check.
 *
 * Two hand-maintained lists will drift. This repo has the scar for it — the bash
 * lane's `BASH_ORACLE_BUILTINS` says so in as many words, and the drift there sat
 * undetected until a differential contradicted the analyzer.
 *
 * So the duplication is not left to discipline. This gate asserts the two tables
 * COVER THE SAME NAMESPACES, which is the failure that produces thousands of
 * "unexplained" edges and an argument rather than a finding: measured on cxf,
 * WSDL's absence from the oracle's set turned every WSDL containment edge into a
 * spurious row, and the per-role breakdown in `script/m12/xml-differential-gap.mts`
 * is what finally showed it was the vocabulary table and not the analyzer.
 *
 * What it does NOT assert, deliberately:
 *
 *   - that the two agree on the CONSTRUCT lists. A construct the oracle omits
 *     costs a few hundred edges and stays visible in the gap measurement; a
 *     construct rule is a semantic judgement and forcing the two copies to match
 *     textually would make this gate the place where the oracle's independence
 *     dies. The gap measurement is where construct-level drift belongs.
 *   - that either list is complete with respect to the whole world of XML
 *     vocabularies. It is not, and cannot be without the vocabulary
 *     specifications; a vocabulary nobody uses is not a defect.
 *
 * Usage: npx tsx script/m12/xml-vocab-tables.ts [--json]
 * Exit 0 when the namespace sets agree, 1 when they do not.
 */
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..")

/**
 * Read the analyzer's table from the SOURCE rather than importing the module.
 *
 * Importing it would drag in the analyzer's runtime and, worse, would read
 * whichever build happened to be loaded instead of the committed source. This
 * gate is about what is written down, so it reads what is written down.
 */
function analyzerVocabularies(): Set<string> {
  const src = fs.readFileSync(path.join(ROOT, "src/ast/real-xml-analyzer.ts"), "utf8")
  const start = src.indexOf("DECLARATION_VOCABULARIES")
  if (start < 0) throw new Error("DECLARATION_VOCABULARIES not found in the analyzer")
  // The table is a literal object; take its top-level keys.
  const open = src.indexOf("{", start)
  let depth = 0
  let end = -1
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}") {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = src.slice(open, end + 1)
  const out = new Set<string>()
  // Top-level keys only: a line that starts at column 0 inside the object literal
  // with a quoted key. Nested construct names are indented, so this cannot pick
  // them up.
  const re = /^\s{4}"([^"]+)":/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) out.add(m[1])
  return out
}

function oracleVocabularies(): Set<string> {
  const src = fs.readFileSync(path.join(ROOT, "script/m14/differential.ts"), "utf8")
  const i = src.indexOf("const XML_DECL_NS")
  if (i < 0) throw new Error("XML_DECL_NS not found in the differential")
  const open = src.indexOf("new Set([", i)
  const close = src.indexOf("])", open)
  if (open < 0 || close < 0) throw new Error("XML_DECL_NS literal not parseable")
  const body = src.slice(open, close)
  const out = new Set<string>()
  for (const m of body.matchAll(/"([^"]+)"/g)) out.add(m[1])
  return out
}

const analyzer = analyzerVocabularies()
const oracle = oracleVocabularies()

const onlyAnalyzer = [...analyzer].filter((n) => !oracle.has(n)).sort()
const onlyOracle = [...oracle].filter((n) => !analyzer.has(n)).sort()
const shared = [...analyzer].filter((n) => oracle.has(n)).sort()

const asJson = process.argv.includes("--json")
if (asJson) {
  console.log(JSON.stringify({ shared, onlyAnalyzer, onlyOracle }, null, 2))
} else {
  console.log(`declaration-vocabulary tables: analyzer ${analyzer.size}, oracle ${oracle.size}, shared ${shared.length}`)
  for (const n of shared) console.log(`    both      ${n}`)
  for (const n of onlyAnalyzer) console.log(`    ANALYZER ONLY  ${n}  — every containment edge in this vocabulary reads as unexplained`)
  for (const n of onlyOracle) console.log(`    ORACLE ONLY     ${n}  — the oracle corroborates a vocabulary the analyzer does not`)
  if (onlyAnalyzer.length === 0 && onlyOracle.length === 0) {
    console.log(`  OK — the two tables cover the same ${shared.length} namespace(s)`)
  } else {
    console.log(`  ${onlyAnalyzer.length + onlyOracle.length} mismatch(es): the tables will drift into thousands of unexplained edges`)
  }
}

process.exit(onlyAnalyzer.length === 0 && onlyOracle.length === 0 ? 0 : 1)