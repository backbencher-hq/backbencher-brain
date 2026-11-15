import { BRAIN_TOOLS } from '@/data/brain-tools'

// Navigation copy, not tool facts.
//
// Every FACT about a tool — summary, description, modes, defaults, returns,
// errors, limitations, safety, evidence, staleness, relations — is generated
// into @/data/tools.generated.ts and rendered from there. Nothing in this file
// may restate one.
//
// What belongs here is the two things a generated reference structurally
// cannot give a reader:
//
//   role      — four to eight words naming the job, so sixteen rail rows read as
//               a menu instead of a lookup table.
//   useWhen   — the condition under which this is the RIGHT tool, which is a
//               decision, not a description. This is what replaced a block that
//               used to reprint tool.summary directly under the header, which is
//               where "best used for" turned into a tautology.
//   questions — the reader's own questions, each attached to the response field
//               that answers it, for the tools whose registry description is a
//               few hundred words carrying several separate guarantees at once.
//
// `questions` deserves its own note, because it is the easiest place on this
// page to slide into retelling the record. It is not a summary of the
// description and it never paraphrases one. Each entry is a QUESTION a reader
// would ask of this tool, plus the identifier the answer arrives in — so the
// paragraph below the list can be read as a series of commitments rather than
// as one wall of prose. bb_search is the clearest case: whether a short page is
// the whole match set, whether the query appeared verbatim, whether a body could
// have matched at all, and what an unindexed filter value does are four
// separate guarantees, and a reader has to be able to see them as four.
//
// Every question here was read off the generated description it sits above. A
// question the record does not answer is a promise the page cannot keep, so the
// list is authored per tool and is empty where the description is short enough
// to read straight through.
//
// Both fields are editorial and hedged on purpose: they must never contradict
// the generated record, and where the record publishes a limit (confidence,
// taint endpoints, migration estimates) the framing says so rather than selling
// past it. verify-tools-truth.ts fails the build if any of this quotes a
// registry summary or description verbatim.

export type ToolQuestion = {
  /** The response field that carries the answer. Verbatim from the record. */
  term: string
  /** What a reader would ask to get that field read. Never an answer. */
  ask: string
}

export type ToolFraming = {
  /** Four to eight words. One line on the index row. */
  role: string
  /** The job-to-be-done. One decision sentence, shown at the top of the panel. */
  useWhen: string
  /** Optional. The questions a long registry description answers, in order. */
  questions?: ToolQuestion[]
}

export const TOOL_FRAMING: Record<string, ToolFraming> = {
  bb_search: {
    role: 'Find a name, a string, or a file',
    useWhen:
      'You can already name the thing — a symbol, a literal string, a path — and want it located exactly rather than described. This is retrieval; it will not explain the code to you.',
    questions: [
      { term: 'totalMatches', ask: 'How many symbols matched, before the page you are holding was cut?' },
      { term: 'truncated', ask: 'Did a cap or the noise filter keep matches back from you?' },
      { term: 'matchMode', ask: 'Did the query appear verbatim, or did only its content words match?' },
      { term: 'bodyCoverage', ask: 'Could a body have matched at all, or is there no searchable body here?' },
      { term: 'language, symbolKind', ask: 'What happens when the filter names something this project never indexed?' },
      { term: 'autoRefresh', ask: 'Did the answer re-read files off disk before it replied?' },
    ],
  },
  bb_ask: {
    role: 'Ask in plain language, get candidates',
    useWhen:
      'You can say what the code should do but not yet what it is called. Read what comes back as candidates to open, not as an answer you can ship without reading the files.',
  },
  bb_analyze: {
    role: 'Typed per-mode reports over the graph',
    useWhen:
      'You want one bounded, typed answer — callers, complexity, test gaps, project counts — and you want the tool to name every bound it hit while producing it.',
    questions: [
      { term: 'rootMatch', ask: 'Did the name you asked for resolve to a symbol at all, or to something that contains it?' },
      { term: 'limit', ask: 'How many items came back, against how many exist?' },
      { term: 'targetMatch', ask: 'Is each edge through the name you asked about, or through its owner class?' },
      { term: 'filePath', ask: 'Which modes accept a path, and what happens on the ones that do not?' },
    ],
  },
  bb_impact: {
    role: 'What breaks if this symbol changes',
    useWhen:
      'You are about to change a symbol and need the reverse-dependent set, its true size, and an explicit account of what a bound cut out of it.',
    questions: [
      { term: 'totalCountIfKnown', ask: 'How large is the set this answer is a prefix of?' },
      { term: 'truncation', ask: 'Which bound fired, and what did it leave out?' },
      { term: 'rule.relationshipTypes', ask: 'Which relationship kinds were counted, and can that be changed?' },
      { term: 'found', ask: 'Does an empty result mean nothing depends on it, or that the name was unknown?' },
    ],
  },
  bb_graph: {
    role: 'One symbol’s edges, each with a tier',
    useWhen:
      'You want the graph around a single symbol and you care whether each edge was proven from source or merely inferred from context.',
    questions: [
      { term: 'tier', ask: 'Was this edge read from source, or inferred from context?' },
      { term: 'rowId', ask: 'Which stored row justifies this edge, and how do I find it?' },
      { term: 'truncation', ask: 'Did the traversal stop early, and why?' },
    ],
  },
  bb_patterns: {
    role: 'Orphans and framework patterns, ranked',
    useWhen:
      'You want a census of what the index can show is unreferenced, and you will treat the confidence number as a filter rather than a verdict.',
    questions: [
      { term: 'confidence', ask: 'Which evidence class produced this number, and what does it exclude?' },
      { term: 'scope', ask: 'Am I reading a dead-code census or the full pattern scan?' },
      { term: 'confidenceThreshold', ask: 'Does raising the bar remove weak findings, or all of one kind at once?' },
    ],
  },
  bb_security: {
    role: 'Lexical leads to validate, not findings',
    useWhen:
      'You want the source/sink token pairs the indexer stored, as leads to review by hand. Co-located tokens are not a proven dangerous path, and a language in the unsupported tier is not scanned at all.',
  },
  bb_visualize: {
    role: 'A drawable graph scoped to a subset',
    useWhen:
      'You want a diagram or a self-contained HTML artifact of part of the graph, and you will read its declared truncation before you read the picture.',
    questions: [
      { term: 'totalNodesAvailable', ask: 'What did the scope and filters actually match, before any budget?' },
      { term: 'truncation.originalNodes', ask: 'How many of those reached the projection, and how many came back?' },
      { term: 'excluded', ask: 'What did the noise filter remove, and on which patterns?' },
      { term: 'rowId', ask: 'Which stored relationship row does each drawn edge trace to?' },
      { term: 'declaredAbsent', ask: 'Is this an empty project, or an empty answer?' },
      { term: 'considered', ask: 'What did the answer actually read, and was the selection a ranking?' },
    ],
  },
  bb_migrate: {
    role: 'Order, waves, and effort for a port',
    useWhen:
      'You need a sequence and an estimate for moving named symbols to another language. It writes no target code, and a library with no registered mapping is charged as research.',
  },
  bb_doc: {
    role: 'Cited prose generated from source',
    useWhen:
      'You need written documentation whose claims resolve to locations you can open, and where a fact is unknown it stays unknown rather than being filled in.',
  },
  bb_health: {
    role: 'Index freshness, counts, integrity',
    useWhen:
      'Before trusting anything else on this page, you want to know whether the index still matches your working tree and which part of it is degraded.',
    questions: [
      { term: 'freshness why', ask: 'Which stale files were read to decide they were stale, and which were not?' },
      { term: 'healthy', ask: 'Is the index usable as it stands?' },
      { term: 'PER-LANGUAGE SEARCHABILITY', ask: 'Which languages can a semantic query reach at all?' },
      { term: 'freshness="complete"', ask: 'Is this count the whole project or a sample of it?' },
    ],
  },
  bb_index: {
    role: 'Refresh index rows for changed paths',
    useWhen:
      'You have just written or changed files, and every answer after that depends on the index having caught up with them.',
    questions: [
      { term: 'outcome', ask: 'Did this change anything, and if not, why not?' },
      { term: 'relative_path', ask: 'Is the path you gave me inside this project?' },
      { term: 'errorDetail', ask: 'Which file failed, and with what message?' },
      { term: 'ms', ask: 'Which of these numbers is measured and which is stable?' },
    ],
  },
  bb_edit: {
    role: 'The only tool here that writes source',
    useWhen:
      'You intend to change source files. Dry-run it first: the bounds come from the bytes on disk, and the tool refuses rather than guessing when it cannot vouch for them.',
    questions: [
      { term: 'warnings', ask: 'Was the file re-read and the symbol re-resolved before the bytes were touched?' },
      { term: 'dryRun', ask: 'What would change, without changing it?' },
      { term: 'rollback', ask: 'What happens to the file if validation fails?' },
    ],
  },
  bb_annotate: {
    role: 'A sourced note where a human reads it',
    useWhen:
      'You want to record a judgement next to the code, with an author class that cannot be forged by anything you type into the body.',
    questions: [
      { term: 'surfacing', ask: 'Can an editor surface actually show this note, or was it stored against a name nothing carries?' },
      { term: 'author_class', ask: 'Which claim about who wrote this is enforced rather than recorded?' },
      { term: 'replaced', ask: 'Did this note overwrite an earlier one?' },
    ],
  },
  bb_annotations: {
    role: 'Read stored notes, declare absence',
    useWhen:
      'You want to know what an earlier agent left behind on this symbol, and you need an explicit none-stored answer rather than an empty list to interpret.',
    questions: [
      { term: 'count', ask: 'Is this page the whole set or a slice of it?' },
      { term: 'totalCountIfKnown', ask: 'What is the true total behind this page?' },
      { term: 'symbol', ask: 'Does a qualified name match notes written under the bare name too?' },
    ],
  },
  bb_cross_language: {
    role: 'Stored rows that cross a language',
    useWhen:
      'You want the cross-language relationships the index actually stored for this name, per pair, with absence declared instead of guessed at.',
    questions: [
      { term: 'copies', ask: 'How many symbols in this project carry the name I asked for?' },
      { term: 'memberFacts', ask: 'Are these rows about the symbol, or about its members?' },
      { term: 'totalCountIfKnown', ask: 'How many rows exist, and how many came back?' },
      { term: 'bridge', ask: 'What mechanism carried the call across the boundary?' },
    ],
  },
}

// Coverage is enforced the same way the display layer enforces it: a tool that
// ships without framing has no job described, and the console would quietly
// fall back to a name. Failing at import is louder and cheaper than that.
for (const tool of BRAIN_TOOLS) {
  if (!TOOL_FRAMING[tool.name]) throw new Error(`components/tools/framing: no framing for ${tool.name}`)
}
for (const name of Object.keys(TOOL_FRAMING)) {
  if (!BRAIN_TOOLS.some((tool) => tool.name === name)) throw new Error(`components/tools/framing: framing for unknown tool ${name}`)
}

export function framingFor(name: string): ToolFraming {
  const framing = TOOL_FRAMING[name]
  if (!framing) throw new Error(`components/tools/framing: no framing for ${name}`)
  return framing
}