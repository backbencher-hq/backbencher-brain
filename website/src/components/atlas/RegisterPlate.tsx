import { PARSERS, RELATIONSHIP_TYPES } from "@/data/brain-languages"
import { TRUTH } from "@/data/truth.generated"

// The register, drawn once as a night spectrum. One point per analyzer module;
// rows are bands of relationship breadth derived from the generated emits lists.
// Positions are deterministic (a stable hash supplies the jitter), so the drawing
// is identical on every render. The desktop field and the mobile field share the
// same data and differ only in geometry.
const BANDS = [
  { label: "14 of 14", match: (n: number) => n === 14, color: "#E2553B" },
  { label: "12–13", match: (n: number) => n >= 12 && n <= 13, color: "#D8A24A" },
  { label: "11", match: (n: number) => n === 11, color: "#9CAE6A" },
  { label: "9–10", match: (n: number) => n >= 9 && n <= 10, color: "#6FB3A8" },
  { label: "4–8", match: (n: number) => n <= 8, color: "#8E9BB8" },
]

const hash = (value: string) => {
  let h = 7
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) >>> 0
  return h
}

const total = RELATIONSHIP_TYPES.length
const bands = BANDS.map((band) => ({ ...band, families: PARSERS.filter((p) => band.match(p.emits.length)) }))

type Point = { x: number; y: number; name: string; emits: number; row: number; color: string }

function spectrum(mobile: boolean) {
  const w = mobile ? 420 : 1240
  const h = mobile ? 430 : 380
  const left = mobile ? 18 : 262
  const right = mobile ? 402 : 1186
  const top = mobile ? 54 : 86
  const step = mobile ? 76 : 64
  const points: Point[] = []
  bands.forEach((band, row) => {
    band.families.forEach((family, k) => {
      points.push({
        x: Math.round(left + ((k + 0.5) / band.families.length) * (right - left) + ((hash(family.name) % (mobile ? 7 : 11)) - (mobile ? 3 : 5))),
        y: Math.round(top + row * step + ((hash(family.name + "y") % (mobile ? 17 : 33)) - (mobile ? 8 : 16))),
        name: family.name,
        emits: family.emits.length,
        row,
        color: band.color,
      })
    })
  })
  return { w, h, left, right, top, step, points }
}

function calloutsFor(geo: ReturnType<typeof spectrum>, mobile: boolean) {
  const rows = mobile ? [0, 2] : [0, 1, 3]
  return rows
    .map((row) => {
      const inRow = geo.points.filter((p) => p.row === row)
      const point = inRow[Math.floor(inRow.length / 2)]
      if (!point) return null
      const above = row < 2
      const maxX = geo.w - (mobile ? 150 : 220)
      const tx = Math.max(16, Math.min(point.x + (above ? (mobile ? 12 : 26) : -(mobile ? 30 : 34)), maxX))
      const ty = above ? geo.top + row * geo.step - (mobile ? 20 : 34) : geo.top + row * geo.step + (mobile ? 34 : 50)
      return { point, tx, ty, title: point.name, sub: `${point.emits} of ${total} relationship types` }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
}

function Plate({ mobile }: { mobile: boolean }) {
  const geo = spectrum(mobile)
  const callouts = calloutsFor(geo, mobile)
  return (
    <svg
      className="at-plate"
      viewBox={`0 0 ${geo.w} ${geo.h}`}
      role="img"
      data-analyzers={PARSERS.length}
      aria-label={`The register: ${PARSERS.length} analyzers drawn in five bands of relationship breadth, from ${total} relationship types down to 4.`}
    >
      {bands.map((band, row) => {
        const y = geo.top + row * geo.step
        const labelY = mobile ? y - 12 : y + 4
        const labelX = mobile ? geo.left : geo.left - 40
        return (
          <g key={band.label}>
            <line className="at-row-line" x1={geo.left - (mobile ? 0 : 24)} y1={y} x2={geo.right} y2={y} />
            <text className="at-row-label" x={labelX} y={labelY} textAnchor={mobile ? "start" : "end"}>
              {band.label}
            </text>
          </g>
        )
      })}

      {geo.points.map((p) => (
        <circle key={`${p.name}-${p.row}`} data-analyzer={p.name} data-emits={p.emits} cx={p.x} cy={p.y} r={p.emits >= 13 ? (mobile ? 3.4 : 4.2) : (mobile ? 2.6 : 3.2)} fill={p.color}>
          <title>{`${p.name} — ${p.emits} of ${total} relationship types`}</title>
        </circle>
      ))}

      {callouts.map((c) => (
        <g key={c.title}>
          <path className="at-night-leader" d={`M${c.point.x} ${c.point.y - 5} L${c.tx - 5} ${c.ty - 3}`} />
          <text className="at-night-note" x={c.tx} y={c.ty}>{c.title}</text>
          <text className="at-night-sub" x={c.tx} y={c.ty + (mobile ? 12 : 16)}>{c.sub}</text>
        </g>
      ))}
    </svg>
  )
}

export function RegisterPlate() {
  return (
    <section className="night" id="register">
      <div className="container">
        <div className="night-head">
          <h2>{PARSERS.length} analyzers, drawn <i>once.</i></h2>
          <p>
            Every family has its own hand-written analyzer — {PARSERS.length} languages and{" "}
            {TRUTH.languages.dedicatedParsers}{" "}dedicated grammars once the register&rsquo;s three alias route ids
            (TSX, Sass, Terraform) are counted, there is no generic branch a language can fall back onto. <b>Each point is one analyzer module</b>, grouped by how much of the
            relationship vocabulary it can construct. A missing edge is a fact about the format, not
            a gap in the tool.
          </p>
        </div>

        <div className="at-only-desktop"><Plate mobile={false} /></div>
        <div className="at-only-mobile"><Plate mobile /></div>

        <div className="caption">
          <span><b>Plate II.</b> The register, as a field — one point per analyzer, rows are bands of relationship breadth. Nowhere prints a language list.</span>
          <span>one point per analyzer · {bands.length} bands · {total} relationship types</span>
        </div>
      </div>
    </section>
  )
}
