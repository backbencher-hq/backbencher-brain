import type { ReactNode } from 'react'
import type { BrainTool } from '@/data/brain-tools'
import { framingFor } from './framing'
import { humanizeEvidence } from './record-labels'
import { RichText } from '@/components/atlas/RichText'
import { formatWords, meterPercent, RECORD } from './record'

// The contract.
//
// The panel used to open by setting the registry description as one paragraph of
// prose and then bury the part that actually matters — what the tool will not do
// — in a two-bullet footnote. Measured over the generated data that was close to
// backwards: `limitations` is about a third of all the curated words on this
// site, and it holds the measured, self-critical findings a reader most needs
// before they spend an agent call. bb_graph is still in the record because it used
// to answer a symbol with 3,437 call sites under 200 rows and `truncated: false`;
// bb_patterns publishes a confidence threshold that cannot discriminate among the
// findings it is meant to separate. None of that is a footnote.
//
// So the panel is ordered by what a reader is deciding:
//
//   1. reach for it at all   — the editorial "use this when", in one sentence
//   2. what it does          — summary, then the registry's own description, set
//                              as a readable column and indexed by the questions
//                              it answers, so a few hundred words of guarantees
//                              arrive as separate commitments
//   3. what it will not do   — the declared limitations, at full weight, one per
//                              row. This is the section the panel is built around
//                              and it is the largest thing on it.
//   4. what it does to you   — safety behaviour
//   5. the shape of the call — modes, defaults, example, returns, errors, relations
//   6. how it is justified   — evidence, performance and staleness, on request
//
// 2026-11-07 — Evidence Atlas surface. The panel is a paper reading column: the
// tool's name is an h2 in mono (a name is data), the sections are h3s set in the
// page's serif, the declared limits are hairline rows, and the one ember accent
// marks the decision sentence and the required-parameter flags. There is no
// dark plate and no second card inside a card; structure is carried by rules.
//
// Every fact below is rendered straight from BRAIN_TOOLS. This file types no
// tool prose at all.

type Tool = BrainTool

function formatValue(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
}

function Prose({ children, tone = 'body' }: { children: ReactNode; tone?: 'body' | 'lead' }) {
  return <p className={tone === 'lead' ? 'lead' : undefined}>{children}</p>
}

/** A plain list of commitments. Used for returns and errors. */
function Terms({ items }: { items: readonly (string | null)[] }) {
  const present = items.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (present.length === 0) return null
  return (
    <ul>
      {present.map((item) => (
        <li key={item}><RichText text={item} /></li>
      ))}
    </ul>
  )
}

/* The narrow sheet beside the shape: modes, defaults, the example input. */

function SheetBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sheet-block">
      <p className="k">{title}</p>
      {children}
    </div>
  )
}

export function ToolPanel({ tool }: { tool: Tool }) {
  const framing = framingFor(tool.name)
  const defaults = Object.entries(tool.defaults ?? {})
  const example = tool.examples?.[0]
  const questions = framing.questions ?? []
  // Generated curation data can carry a null entry (the tool's limitations list is authored, not inferred);
  // count only the words of the entries that exist rather than throwing on a null at build time.
  const limitWords = tool.limitations.reduce((total, item) => total + (item ?? '').trim().split(/\s+/).length, 0)
  const limits = tool.limitations.filter((item): item is string => typeof item === 'string' && item.length > 0)

  return (
    <article id={tool.name} data-panel={tool.name} className="tool-panel reading">
      {/* 1 · identity, and how much record the reader is about to inherit. */}
      <header className="tool-head">
        <div>
          <h2 className="tool-name">{tool.name}</h2>
          <p className="tool-tags">
            <span>{tool.group}</span>
            <span>{tool.mutability}</span>
            <span>{tool.requiresIndex ? 'requires index' : 'no index required'}</span>
            <span>{tool.category}</span>
          </p>
        </div>
        <div className="tool-record">
          <p className="tool-record-label">Generated contract</p>
          <p className="tool-record-value">
            <b>{formatWords(RECORD.get(tool.name) ?? 0)}</b>
            <span>words in this entry</span>
          </p>
          <span className="tool-record-meter" aria-hidden>
            <i style={{ width: `${meterPercent(tool.name)}%` }} />
          </span>
          <p className="tool-record-note">
            {limits.length} declared limits · {limitWords.toLocaleString('en-US')} words of them.
          </p>
        </div>
      </header>

      {/* 2 · the decision, then what the tool does. */}
      <div className="tool-use">
        <p className="tool-use-label">Use this when</p>
        <p className="when">{framing.useWhen}</p>
      </div>

      <h3>What it does</h3>
      <Prose tone="lead"><RichText text={tool.summary} /></Prose>
      <Prose><RichText text={tool.description} /></Prose>

      {/* The map before the wall: the questions a reader would ask of this tool,
          each attached to the field the answer arrives in. A tool whose
          description is two sentences gets no list — the questions only earn
          their place when the paragraph above carries more than one of them. */}
      {questions.length > 0 ? (
        <>
          <h3>Questions this description answers</h3>
          <dl className="tool-questions">
            {questions.map((question) => (
              <div key={question.term} className="tool-question">
                <dt>{question.term}</dt>
                <dd>{question.ask}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      {/* 3 · what it will not do. The section the panel is built around. */}
      <h3>What it will not do</h3>
      {limits.length > 0 ? (
        <div className="tool-limits">
          {limits.map((item) => (
            <p key={item}><RichText text={item} /></p>
          ))}
        </div>
      ) : (
        <p>No limitation is declared for this tool in the generated record.</p>
      )}

      {/* 4 · safety behaviour. Short, and the reason the section above exists. */}
      <h3>Safety behavior</h3>
      <Prose><RichText text={humanizeEvidence(tool.safety)} /></Prose>

      {/* 5 · the shape of the call, and the two long reference lists beside /
          beneath it so no list is squeezed into a column that cannot hold it. */}
      <h3>The shape of the call</h3>
      <div className="tool-shape">
        <div>
          <p className="tool-kicker">Returns</p>
          <Terms items={tool.returns.map(humanizeEvidence)} />
          <p className="tool-kicker" style={{ marginTop: 22 }}>
            Errors
          </p>
          <Terms items={tool.errors.map(humanizeEvidence)} />
          <p className="tool-kicker" style={{ marginTop: 22 }}>
            Relationship to other tools
          </p>
          <Prose><RichText text={humanizeEvidence(tool.relations)} /></Prose>
        </div>

        <div className="tool-sheet">
          <SheetBlock title={`Modes (${tool.modes.length})`}>
            {tool.modes.length === 0 ? (
              <p className="tool-note-empty">No modes are declared for this tool.</p>
            ) : (
              <ul className="tool-modes">
                {tool.modes.map((mode) => (
                  <li key={mode}>{mode}</li>
                ))}
              </ul>
            )}
            {tool.plannedModes.length > 0 ? (
              <p className="tool-note-empty">
                Planned, not executable today:{' '}
                {tool.plannedModes.map((mode) => (
                  <code key={mode}>{mode}</code>
                ))}
              </p>
            ) : null}
          </SheetBlock>

          <SheetBlock title="Runtime defaults">
            {defaults.length === 0 ? (
              <p className="tool-note-empty">No defaults are declared for this tool.</p>
            ) : (
              <ul className="tool-defaults">
                {defaults.map(([key, value]) => (
                  <li key={key}>
                    <code>{key}</code>
                    <span aria-hidden> · </span>
                    {formatValue(value)}
                  </li>
                ))}
              </ul>
            )}
          </SheetBlock>

          <SheetBlock title="Example input">
            <pre>
              <code>{example ? JSON.stringify(example, null, 2) : '// no example declared'}</code>
            </pre>
            <p className="tool-ref">
              Reference: {tool.referencePath}
            </p>
          </SheetBlock>
        </div>
      </div>

      {/* The parameter table. */}
      <h3>Parameters ({tool.parameters.length})</h3>
      {tool.parameters.length === 0 ? (
        <p>This tool takes no parameters.</p>
      ) : (
        <div className="tool-table-wrap overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th scope="col">Parameter</th>
                <th scope="col">Type</th>
                <th scope="col">Required</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody>
              {tool.parameters.map((parameter) => (
                <tr key={parameter.name}>
                  <td className="tool-param-name">{parameter.name}</td>
                  <td className="tool-param-type">{parameter.type}</td>
                  <td>
                    <span className="tool-param-req" data-required={parameter.required ? 'true' : 'false'}>
                      {parameter.required ? 'Required' : 'Optional'}
                    </span>
                  </td>
                  <td><RichText text={parameter.description} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 6 · provenance on request. Three long prose blocks; what they describe —
          how an answer is justified, and how far it may be from disk — is read
          when a reader doubts the answer, not before they have it. */}
      <details className="tool-more">
        <summary>Evidence, performance, and staleness</summary>
        <section>
          <h3>Evidence semantics</h3>
          <p className="k">Evidence</p>
          <Prose><RichText text={humanizeEvidence(tool.evidence)} /></Prose>
          <p className="k">Performance</p>
          <Prose><RichText text={humanizeEvidence(tool.performance)} /></Prose>
        </section>
        <section>
          <h3>Staleness</h3>
          <Prose><RichText text={humanizeEvidence(tool.staleness)} /></Prose>
        </section>
      </details>
    </article>
  )
}
