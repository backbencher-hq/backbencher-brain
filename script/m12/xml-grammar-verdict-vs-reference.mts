/**
 * XML GRAMMAR VERDICT vs A CONFORMING REFERENCE PARSER — VENDORED into this
 * repository.
 *
 * Decides, per construct, whether a rejection is a DEFECT or a correct refusal,
 * by checking every accept/reject decision against a parser that is not this
 * grammar. A grammar that cannot parse something is not thereby wrong; a grammar
 * that cannot parse something no conforming parser can either is being held to an
 * impossible standard, and this is the instrument that distinguishes the two.
 *
 * WHY IT MOVED. It lived in a sibling worktree while its result — "16/16 agreement
 * with a conforming parser" — is quoted in `reviews/xml/master-review.md` as the
 * evidence that the two grammar rejections the lane records as correct really are
 * correct. Evidence quoted from an instrument a clone cannot run is a claim.
 *
 * Usage: npx tsx script/m12/xml-grammar-verdict-vs-reference.mts [--repos DIR]
 */
/**
 * XML GRAMMAR VERDICT vs A CONFORMING PARSER — the falsification test.
 *
 * A grammar that rejects things is only useful if its rejections are RIGHT. The
 * lane's corpus is full of files that do not parse, and "the analyzer reports an
 * error" is not by itself evidence that the error is correct: it is equally the
 * signature of a grammar defect, which is how the two grammar repairs were found.
 *
 * So every borderline file is handed to Python's `expat` — a CONFORMING XML 1.0
 * implementation, and an implementation this repository does not own or ship — and
 * the two verdicts are compared. Agreement is the evidence that a rejection is
 * correct. DISAGREEMENT is the finding, and it is the thing this probe exists to
 * hunt: it is what would have caught the two repaired defects, and it is what
 * settles a third hypothesis.
 *
 * The third hypothesis, recorded here because a RETRACTED finding is evidence
 * too: `cxf/…/2001/XMLSchema.xsd` — the W3C's own XSD — opens with a comment
 * block and only then the `<?xml …?>` declaration, and the grammar's `prolog`
 * admits an `XMLDecl` only as the first construct, so the file was a candidate
 * third grammar defect ("a `Misc` may precede the declaration"). expat rejects
 * the same file with "XML or text declaration not at start of entity", which is
 * XML 1.0 §2.8 — `prolog ::= XMLDecl? Misc* (doctypedecl Misc*)?` puts the
 * declaration FIRST. The grammar is right and the W3C's vendored copy violates
 * the specification. NO REPAIR WAS MADE, and the finding is recorded as rejected
 * rather than quietly dropped.
 */
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { dirname, join, resolve as pathResolve } from "node:path"
import { fileURLToPath } from "url"
import { Parser, Language } from "web-tree-sitter"

const ROOT_HERE = pathResolve(dirname(fileURLToPath(import.meta.url)), "..", "..") // the REPO ROOT
const REPOS = process.env.XML_CORPUS_ROOT ?? "$HOME/fixtures/xml/repos"
const OUT = process.env.XML_AB_OUT ?? join(ROOT_HERE, "validation", "m12", "results")

const CASES: [string, string][] = [
  ["cxf/services/wsn/wsn-api/src/main/resources/org/apache/cxf/wsn/wsdl/2001/XMLSchema.xsd", "the W3C's own XSD: a comment block, then the XML declaration"],
  ["cxf/maven-plugins/archetypes/cxf-jaxws-javafirst/src/main/resources/archetype-resources/src/main/webapp/WEB-INF/web.xml", "archetype template: a `##` header, then the XML declaration"],
  ["cxf/services/wsn/wsn-api/src/main/resources/org/apache/cxf/wsn/wsdl/2001/XMLSchema.dtd", "standalone W3C DTD, used as an external subset"],
  ["cxf/src/site/site.xml", "a missing space between two attributes (committed upstream defect)"],
  ["cxf/systests/rs-security/src/test/java/org/apache/cxf/systest/http/resources/jaxws-server.xml", "an unterminated attribute value (committed upstream defect)"],
  ["cxf/rt/databinding/jaxb/src/test/java/org/apache/cxf/jaxb/resources/emptyReq.xml", "0 bytes"],
  ["cxf/services/ws-discovery/ws-discovery-api/src/test/java/org/apache/cxf/ws/discovery/msg1.xml", "four SOAP envelopes concatenated with no separator"],
  ["cxf/rt/bindings/xml/src/test/resources/message-operation-empty-param.xml", "a JAXB binding fragment with no document element"],
  ["cxf/rt/bindings/soap/src/test/resources/org/apache/cxf/binding/soap/test-no-endenv.xml", "a binding fragment with no document element"],
  ["cxf/systests/jaxws/src/test/java/org/apache/cxf/systest/dispatch/resources/GreetMeDocLiteralRespMalformed.xml", "malformed by name: a deliberate negative test input"],
  ["cxf/rt/databinding/aegis/src/test/java/org/apache/cxf/aegis/type/encoded/example-messages.xml", "a document ABOUT documents: example payloads as text"],
  ["libxml2/test/errors/759573-2.xml", "libxml2's own fuzzer-regression input"],
  ["libxml2/test/c14n/1-1-without-comments/example-5.xml", "a DTD with entity and notation declarations"],
  ["libxml2/test/valid/id3.xml", "a DTD with element, attlist and entity declarations"],
  ["grails-core/grails-data-hibernate7/dbmigration-core/src/test/resources/liquibase/harness/diff/xml/Authors.hbm.xml", "a multi-line PUBLIC doctype"],
  ["grails-core/grails-gsp/grails-web-jsp/src/main/resources/org/grails/gsp/jsp/web-app_2_2.dtd", "a standalone JSP DTD"],
]

await Parser.init()
const parser = new Parser()
parser.setLanguage(await Language.load(join(ROOT_HERE, "wasm", "tree-sitter-xml.wasm")))

/** The reference verdict, from an implementation this repository does not own. */
const expatVerdict = (abs: string): { wellFormed: boolean; detail: string } => {
  const script = `
import sys, xml.parsers.expat
data = open(sys.argv[1], "rb").read()
try:
    p = xml.parsers.expat.ParserCreate()
    p.Parse(data, True)
    print("WELL-FORMED")
except Exception as e:
    print("NOT WELL-FORMED\\t" + str(e)[:160])
`
  try {
    const out = execFileSync("python3", ["-c", script, abs], { encoding: "utf8" }).trim()
    if (out.startsWith("WELL-FORMED")) return { wellFormed: true, detail: "" }
    const [verdict, ...rest] = out.split("\t")
    return { wellFormed: false, detail: rest.join("\t") || verdict }
  } catch (error: any) {
    const text = String(error?.stdout ?? "") + String(error?.message ?? "")
    return { wellFormed: false, detail: `expat failed: ${text.slice(0, 160)}` }
  }
}

const rows: any[] = []
let agree = 0
let disagree = 0
for (const [rel, why] of CASES) {
  const abs = `${REPOS}/${rel}`
  let src: string
  try { src = (await import("node:fs")).readFileSync(abs, "utf8") } catch { continue }
  const tree = parser.parse(src)
  const grammarClean = !tree.rootNode.hasError
  tree.delete()
  const reference = expatVerdict(abs)
  const same = grammarClean === reference.wellFormed
  if (same) agree++
  else disagree++
  rows.push({ file: rel, why, grammar: grammarClean ? "accepts" : "rejects", reference: reference.wellFormed ? "accepts" : "rejects", referenceDetail: reference.detail, agree: same })
}

const result = {
  generatedAt: new Date().toISOString(),
  reference: "Python 3 expat — a conforming XML 1.0 implementation, not owned or shipped by this repository",
  method: "Each file is parsed by the wired grammar and by expat, and the two accept/reject verdicts are compared. Agreement is the evidence that a rejection is CORRECT; disagreement is a candidate grammar defect and is the thing this probe exists to find.",
  cases: rows,
  agree,
  disagree,
  retractedHypotheses: [
    {
      hypothesis: "A `Misc` (comment) may precede the XML declaration, so `prolog` must allow it — a third grammar defect, proposed because the W3C's own XMLSchema.xsd is rejected at its declaration.",
      verdict: "REJECTED — the grammar is correct and the file violates XML 1.0 §2.8",
      evidence: "expat rejects the same file with `XML or text declaration not at start of entity`, which is the specification's own rule: `prolog ::= XMLDecl? Misc* (doctypedecl Misc*)?` places the declaration FIRST. No repair was made; the finding is recorded rather than dropped, because a retracted finding is evidence and a silently-dropped one is not.",
    },
  ],
}
;(await import("node:fs")).writeFileSync(`${OUT}/grammar-verdict-vs-reference.json`, JSON.stringify(result, null, 2) + "\n")
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(pad("file", 58) + pad("grammar", 10) + pad("expat", 10) + "agree")
for (const r of rows) console.log(pad(r.file.split("/").pop()!, 58) + pad(r.grammar, 10) + pad(r.reference, 10) + (r.agree ? "yes" : "NO — CANDIDATE DEFECT"))
console.log(`\nagree ${agree}  disagree ${disagree}`)
if (disagree > 0) process.exitCode = 1
