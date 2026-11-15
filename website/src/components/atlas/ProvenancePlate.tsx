"use client"

import { useState } from "react"
import type { PlateData } from "./provenance"
import { DESKTOP, MOBILE, layout } from "./provenance"

type Mode = "map" | "text"

function ringLabel(ring: number) {
  if (ring === 0) return "declares it"
  return ring === 1 ? "1 import hop" : `${ring} import hops`
}

function Svg({ plate, mobile }: { plate: PlateData; mobile: boolean }) {
  const l = layout(plate, mobile)
  const { w, h, cx, cy } = l.view
  const ringRadii = mobile ? MOBILE.radii : DESKTOP.radii
  const yFactor = mobile ? MOBILE.yFactor : DESKTOP.yFactor
  const rings = [...new Set(plate.clusters.map((c) => c.ring))].filter((r) => r > 0).sort((a, b) => a - b)

  const labelPoint = (index: number, point: { x: number; y: number }) => {
    const dx = point.x - cx
    const dy = point.y - cy
    const dist = Math.max(1, Math.hypot(dx, dy))
    const r = l.radius(plate.clusters[index].n)
    const off = mobile ? 9 : 14
    return {
      x: Math.max(mobile ? 22 : 28, Math.min(w - (mobile ? 22 : 28), point.x + (dx / dist) * (r + off))),
      y: Math.max(14, Math.min(h - 14, point.y + (dy / dist) * (r + off) + 3)),
      anchor: dx < 0 ? ("end" as const) : ("start" as const),
    }
  }

  return (
    <svg
      className="at-plate"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Provenance of the rename as import distance from the directory that declares the symbol: ${plate.clusters.length} directories, the rename reaches ${plate.clusters.filter((c) => c.affected).length}.`}
    >
      {rings.map((ring) => {
        const radius = ringRadii[Math.min(ring, ringRadii.length - 1)]
        return <ellipse key={ring} className="at-ring" cx={cx} cy={cy} rx={radius} ry={radius * yFactor} />
      })}

      <g>
        {plate.pairs.map((pair) => {
          const a = l.points[pair.a]
          const b = l.points[pair.b]
          if (!a || !b) return null
          const dx = b.x - a.x
          const dy = b.y - a.y
          const len = Math.max(1, Math.hypot(dx, dy))
          const bow = Math.min(mobile ? 14 : 34, len * 0.08) * (pair.a < pair.b ? 1 : -1)
          const mx = (a.x + b.x) / 2 - (dy / len) * bow
          const my = (a.y + b.y) / 2 + (dx / len) * bow
          return (
            <path
              key={`${pair.a}-${pair.b}`}
              className={pair.lit ? "at-edge-lit at-draw" : "at-edge"}
              pathLength={pair.lit ? 1 : undefined}
              style={pair.lit ? { animationDelay: "300ms" } : { strokeWidth: Math.min(1.6, 0.5 + Math.log2(pair.w) * 0.28) }}
              d={`M${a.x} ${a.y} Q${mx.toFixed(1)} ${my.toFixed(1)} ${b.x} ${b.y}`}
            />
          )
        })}
      </g>

      <g>
        {plate.clusters.map((cluster, index) => {
          const point = l.points[index]
          const label = labelPoint(index, point)
          const showLabel = mobile ? cluster.affected || index === plate.root : true
          return (
            <g key={cluster.l}>
              <circle
                className={cluster.affected ? "at-cluster-affected at-wave" : "at-cluster-node"}
                style={cluster.affected ? { animationDelay: `${140 + cluster.ring * 150}ms` } : undefined}
                cx={point.x}
                cy={point.y}
                r={l.radius(cluster.n)}
              >
                <title>{`${cluster.l} — ${cluster.n} module${cluster.n === 1 ? "" : "s"} · ${ringLabel(cluster.ring)}`}</title>
              </circle>
              {showLabel && index !== plate.root ? (
                <text className="at-cluster-label" x={label.x} y={label.y} textAnchor={label.anchor}>
                  {cluster.l}
                </text>
              ) : null}
            </g>
          )
        })}
      </g>

      <circle className="at-root-halo" cx={cx} cy={cy} r={mobile ? 16 : 28} />
      <circle className="at-root" cx={cx} cy={cy} r={mobile ? 3.6 : 5.4} />
      <circle className="at-root-ring" cx={cx} cy={cy} r={mobile ? 7.5 : 12} />
      <text className="at-root-label" x={cx} y={cy + (mobile ? 18 : 30)} textAnchor="middle">
        config
      </text>
    </svg>
  )
}

export function ProvenancePlate({ plate }: { plate: PlateData }) {
  const [mode, setMode] = useState<Mode>("map")
  const groups = [...new Set(plate.clusters.map((c) => c.ring))]
    .sort((a, b) => a - b)
    .map((ring) => ({
      ring,
      label: ringLabel(ring),
      clusters: plate.clusters.filter((c) => c.ring === ring).sort((a, b) => a.l.localeCompare(b.l)),
    }))

  return (
    <div className="at-plate-wrap">
      <div className="at-view" role="group" aria-label="Provenance view">
        <button type="button" aria-pressed={mode === "map"} className={mode === "map" ? "is-on" : ""} onClick={() => setMode("map")}>
          Map
        </button>
        <button type="button" aria-pressed={mode === "text"} className={mode === "text" ? "is-on" : ""} onClick={() => setMode("text")}>
          Text
        </button>
      </div>

      {mode === "map" ? (
        <div className="at-map">
          <div className="at-only-desktop"><Svg plate={plate} mobile={false} /></div>
          <div className="at-only-mobile"><Svg plate={plate} mobile /></div>
        </div>
      ) : (
        <div className="at-text-view" role="region" aria-label="The same provenance as text">
          {groups.map((group) => (
            <p className="at-text-row" key={group.ring}>
              <span className="at-text-hop">{group.label}</span>
              <span className="at-text-dirs">
                {group.clusters.map((c) => c.l).join(" · ")}
                {group.ring === 0 ? " (the declaration)" : ""}
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
