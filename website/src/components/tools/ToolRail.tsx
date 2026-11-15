import { GROUP_ORDER, toolsInGroup, type BrainTool, type ToolGroup } from '@/data/brain-tools'
import { formatWords, meterPercent, RECORD } from './record'
import { framingFor } from './framing'

// The index.
//
// Sixteen names in a scrolling rail is a lookup table: it answers "what is this
// called" and nothing else, so a reader arriving with a question has nowhere to
// put it. Each row therefore carries two more things:
//
//   · the tool's one-line role, so the rail reads as sixteen answers to "what do
//     I reach for" (hand-authored navigation copy — see ./framing.ts);
//   · a meter of the size of that tool's generated record (see ./record.ts), so
//     the reader can see that one entry is a deep contract and another is a thin
//     one BEFORE opening either. That spread is the page's whole point and it
//     has to be visible from the index, not discovered afterwards.
//
// The meter is a bar plus a count, and the count is the number: it is never a
// rating. Nothing here says a tool is good or thin, only how much it commits to.
//
// 2026-11-07 — Evidence Atlas surface. The row is set as an editorial index
// entry: a running number in the margin, the tool name in mono (a name is data),
// the role in the page's body face, and a one-pixel meter. There is no icon and
// no coloured dot: the selected row is painted by the generated rules in
// ./console-css.ts, which is a stronger signal than a 5px mark, and the atlas
// system does not use decorative glyphs. Order and numbering come from the
// registry walk below, so a tool added to the data cannot leave a hole.
//
// The interaction is unchanged. It is still a plain radio set, still zero
// JavaScript to select, and the focus ring is still drawn on the row label by
// .console-index (globals.css) because the input itself is sr-only.
//
// className arrives from the page so the console hook stays declared where the
// design gate reads it (website/src/app/tools/page.tsx), the same arrangement
// the /languages index uses.

/** The rail in reading order, and the number each row carries in the margin. */
const ORDERED: BrainTool[] = GROUP_ORDER.flatMap((group) => toolsInGroup(group))
const NUMBER = new Map(ORDERED.map((tool, index) => [tool.name, index + 1]))

function RailRow({ tool }: { tool: BrainTool }) {
  const inputId = `t-${tool.name}`
  const framing = framingFor(tool.name)
  const size = RECORD.get(tool.name) ?? 0

  return (
    <label htmlFor={inputId} className="tools-row">
      {/* No defaultChecked. A pre-checked first radio would fight the fragment
          rule: a deep link would arrive on the first tool AND the one it named.
          Nothing checked is a state the stylesheet can reason about, so the
          unselected console still opens on the first tool. */}
      <input type="radio" name="tool-reference" id={inputId} className="sr-only" />
      <span aria-hidden className="tools-row-index">
        {String(NUMBER.get(tool.name) ?? 0).padStart(2, '0')}
      </span>
      <span className="tools-row-body">
        <span className="rail-name tools-row-name">{tool.name}</span>
        {/* Hidden on phones: at one column the panel below is a tap away, and a
            fourteen-word role under every name would turn the index into a wall
            before the reader reaches a single contract. The panel opens with the
            same judgement in words, so nothing is lost but the preview. */}
        <span className="rail-role tools-row-role">{framing.role}</span>
        <span className="tools-row-meter">
          <span className="rail-meter-track">
            <span className="rail-meter-fill" style={{ width: `${meterPercent(tool.name)}%` }} />
          </span>
          <span className="rail-words">
            {formatWords(size)}
            <span className="sr-only"> words in this tool&rsquo;s generated record</span>
          </span>
        </span>
      </span>
    </label>
  )
}

export function ToolRail({ className = '' }: { className?: string }) {
  const groups = GROUP_ORDER.map((group) => ({ group, tools: toolsInGroup(group) })).filter(
    (entry) => entry.tools.length > 0,
  )

  return (
    <nav aria-label="Tools" className={`tools-rail ${className}`}>
      {/* The rail is taller than a laptop viewport now that every row carries a
          role and a meter, so it scrolls inside its own column rather than
          pushing the reader back to the top of the document to change tool. */}
      <div data-rail-scroll="" className="tools-rail-scroll">
        {groups.map(({ group, tools }: { group: ToolGroup; tools: BrainTool[] }) => (
          <section key={group} className="tools-group">
            <p className="tools-group-label">
              {group}
              <span className="n">{tools.length}</span>
            </p>
            <ul className="tools-rows">
              {tools.map((tool) => (
                <li key={tool.name}>
                  <RailRow tool={tool} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="tools-rail-note">
          Selection is plain HTML — every entry here is already in this page, and the address bar keeps the tool you are
          reading so you can send the link.
        </p>
      </div>
    </nav>
  )
}
