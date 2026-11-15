import Link from "next/link"
import heroMap from "@/data/atlas/hero-map.generated.json"
import { TRUTH } from "@/data/truth.generated"
import type { HeroMap } from "./types"
import { buildPlate } from "./provenance"
import { ProvenancePlate } from "./ProvenancePlate"

const data = heroMap as unknown as HeroMap
const plate = buildPlate(data)
const symbol = data.answer.chips[0]?.symbol ?? "the symbol"
const affectedDirectories = plate.clusters.filter((cluster) => cluster.affected).length

export function AtlasHero() {
  return (
    <section className="hero">
      <div className="container">
        <div className="hero-top">
          <div>
            <h1>Evidence is the <i>answer.</i></h1>
            <p className="sub">
              bb builds a local index of your codebase — symbols, imports, call-graph edges — and
              answers from it. Every answer carries the <b>source bounds</b>, the <b>relationship it
              walked</b>, and <b>what it could not know</b>.
            </p>
            <div className="ctas">
              <Link className="btn" href="/install">Install bb <span aria-hidden>→</span></Link>
              <Link className="textlink" href="#register">See the register <span aria-hidden>↓</span></Link>
            </div>
          </div>

          <div className="margin-note">
            <p className="q">What breaks if I rename <b>{symbol}</b>?</p>
            <p className="claim">
              {data.answer.counted.dependents} dependents, {data.answer.counted.files} files.{" "}
              <i className="nowrap">{data.answer.counted.hops} hops deep.</i>
            </p>
            <p className="note-line">{data.answer.sub}</p>
            <p className="ev">
              {data.answer.chips.slice(0, 2).map((chip) => (
                <span key={chip.file}>
                  <i />
                  {chip.file}:{chip.line}&nbsp;&nbsp;{chip.tier.replace(/_/g, "-")}
                </span>
              ))}
              <span>
                <i className="dash" />
                {data.answer.counted.rowsOutsideMap} rows outside src/&nbsp;&nbsp;declared
              </span>
            </p>
          </div>
        </div>

        <ProvenancePlate plate={plate} />

        <div className="legend">
          <span><i />directories the rename reaches — {affectedDirectories} of {plate.clusters.length}</span>
          <span>{plate.modules} modules · {plate.imports} resolved imports · {plate.clusters.length} directories · index snapshot 2026-11-07</span>
        </div>

        <div className="caption">
          <span><b>Plate I.</b> One answer, and the evidence behind it — the question sits in the margin, the answer is a provenance path through the directories.</span>
          <span>recorded with bb {TRUTH.version} · digest {plate.digest.slice(0, 12)}…</span>
        </div>
      </div>
    </section>
  )
}
