import { BRAIN_TOOLS, type BrainTool } from '@/data/brain-tools'

// How large each tool's contract actually is.
//
// The sixteen tools are not the same size. Measured over the generated data,
// the curated record (description, summary, safety, staleness, performance,
// evidence, relations, returns, errors, limitations and the parameter table)
// runs to roughly nineteen thousand words — and `limitations` alone is about a
// third of it, which makes it the largest block of hand-written prose anywhere
// on this site. bb_visualize carries nearly three thousand words of contract;
// bb_ask carries two hundred and sixty. That is an 11× spread between two tools
// a reader chooses between the same way.
//
// A reference page that renders all sixteen as equal blocks is therefore not
// merely untidy — it hides the one fact a reader cannot get anywhere else,
// which is how much this thing actually commits to. So the index measures it.
//
// This is a COUNT, not a score. It is computed here from BRAIN_TOOLS at build
// time and nothing is hand-entered: no word count, no name, no total in this
// file is a literal. If the registry grows a field, or a curated limitation is
// rewritten, the bar and the figures in the page head move with it and there is
// nothing to forget to update.

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length

// Generated tool data can carry a null entry (curation lists are authored and a missing entry is
// emitted as null rather than silently dropped). Counting must ignore it instead of failing the
// site build on a type that is wider than the old one.
const listWords = (items: readonly (string | null)[]): number =>
  items.reduce((total, item) => total + (item === null ? 0 : words(item)), 0)

/** Every field a reader inherits when they open this tool's entry. */
export function recordWords(tool: BrainTool): number {
  return (
    words(tool.description) +
    words(tool.summary) +
    words(tool.safety) +
    words(tool.staleness) +
    words(tool.performance) +
    words(tool.evidence) +
    words(tool.relations) +
    listWords(tool.returns) +
    listWords(tool.errors) +
    listWords(tool.limitations) +
    tool.parameters.reduce((total, parameter) => total + words(parameter.name) + words(parameter.type) + words(parameter.description), 0)
  )
}

export const RECORD: ReadonlyMap<string, number> = new Map(BRAIN_TOOLS.map((tool) => [tool.name, recordWords(tool)]))

export const TOTAL_RECORD_WORDS = BRAIN_TOOLS.reduce((total, tool) => total + (RECORD.get(tool.name) ?? 0), 0)

/** The heaviest entry, and the lightest one. Both are read from the data. */
function extremes(): { largest: { name: string; words: number }; smallest: { name: string; words: number } } {
  let largest = { name: BRAIN_TOOLS[0]!.name, words: -1 }
  let smallest = { name: BRAIN_TOOLS[0]!.name, words: Number.POSITIVE_INFINITY }
  for (const tool of BRAIN_TOOLS) {
    const count = RECORD.get(tool.name) ?? 0
    if (count > largest.words) largest = { name: tool.name, words: count }
    if (count < smallest.words) smallest = { name: tool.name, words: count }
  }
  return { largest, smallest }
}

export const SPREAD = extremes()

/** How many times bigger the largest contract is than the smallest one. */
export const SPREAD_RATIO = SPREAD.largest.words / SPREAD.smallest.words

/** Bar width for one index row, as a percentage of the largest entry. */
export function meterPercent(name: string): number {
  const count = RECORD.get(name) ?? 0
  return Math.max(2, Math.round((count / SPREAD.largest.words) * 100))
}

/** Grouped thousands, so a figure is read as a figure and not as a code. */
export function formatWords(count: number): string {
  return count.toLocaleString("en-US")
}