import type { HeroMap } from "./types"

// Everything the provenance plate needs, derived exactly from the generated
// 210-module map: directory clusters, import-distance rings from the declaring
// directory, and the aggregated cross-directory import weights. No invented
// node, edge or count — this module only aggregates.
export type PlateCluster = { l: string; n: number; ring: number; affected: boolean }
export type PlatePair = { a: number; b: number; w: number; lit: boolean }
export type PlateData = {
  digest: string
  modules: number
  imports: number
  root: number
  clusters: PlateCluster[]
  pairs: PlatePair[]
}

export const DESKTOP = { w: 1200, h: 520, cx: 600, cy: 262, radii: [0, 230, 388, 468], yFactor: 0.44 }
export const MOBILE = { w: 420, h: 352, cx: 210, cy: 172, radii: [0, 104, 166, 194], yFactor: 0.5 }

export function buildPlate(map: HeroMap): PlateData {
  const clusterOfNode = map.nodes.map((n) => n.c)
  const affectedClusters = new Set(map.nodes.filter((n) => n.d !== null).map((n) => n.c))
  const root = map.nodes[map.root].c

  const pairWeight = new Map<string, { a: number; b: number; w: number }>()
  for (const edge of map.edges) {
    const ca = clusterOfNode[edge.a]
    const cb = clusterOfNode[edge.b]
    if (ca === undefined || cb === undefined || ca === cb) continue
    const key = ca < cb ? `${ca}-${cb}` : `${cb}-${ca}`
    const entry = pairWeight.get(key)
    if (entry) entry.w += 1
    else pairWeight.set(key, { a: Math.min(ca, cb), b: Math.max(ca, cb), w: 1 })
  }

  const adjacency = map.clusters.map(() => new Set<number>())
  for (const { a, b } of pairWeight.values()) {
    adjacency[a].add(b)
    adjacency[b].add(a)
  }

  const ringOf = new Map<number, number>([[root, 0]])
  const queue = [root]
  while (queue.length) {
    const current = queue.shift() as number
    for (const next of adjacency[current]) {
      if (!ringOf.has(next)) {
        ringOf.set(next, (ringOf.get(current) ?? 0) + 1)
        queue.push(next)
      }
    }
  }
  for (let i = 0; i < map.clusters.length; i += 1) if (!ringOf.has(i)) ringOf.set(i, 3)

  return {
    digest: map.digest,
    modules: map.nodes.length,
    imports: map.edges.length,
    root,
    clusters: map.clusters.map((cluster, i) => ({
      l: cluster.l,
      n: cluster.n,
      ring: ringOf.get(i) ?? 3,
      affected: affectedClusters.has(i),
    })),
    pairs: [...pairWeight.values()].map((pair) => ({
      ...pair,
      lit: affectedClusters.has(pair.a) && affectedClusters.has(pair.b),
    })),
  }
}

export type Layout = {
  view: { w: number; h: number; cx: number; cy: number }
  points: { x: number; y: number }[]
  radius: (modules: number) => number
}
export const radiusOf = (modules: number) => Math.min(19, 4 + Math.sqrt(modules) * 1.45)
export const mobileRadiusOf = (modules: number) => Math.min(11, 2.6 + Math.sqrt(modules) * 0.85)

export function layout(plate: PlateData, mobile: boolean): Layout {
  const spec = mobile ? MOBILE : DESKTOP
  const rings = new Map<number, number[]>()
  plate.clusters.forEach((cluster, i) => {
    if (!rings.has(cluster.ring)) rings.set(cluster.ring, [])
    rings.get(cluster.ring)!.push(i)
  })
  rings.get(0)?.sort((a, b) => a - b)
  const points: { x: number; y: number }[] = plate.clusters.map(() => ({ x: spec.cx, y: spec.cy }))
  for (const ring of [...rings.keys()].sort((a, b) => a - b)) {
    if (ring === 0) {
      points[rings.get(0)![0]] = { x: spec.cx, y: spec.cy }
      continue
    }
    const members = (rings.get(ring) ?? []).sort((a, b) => plate.clusters[a].l.localeCompare(plate.clusters[b].l))
    const radius = spec.radii[Math.min(ring, spec.radii.length - 1)]
    const start = -Math.PI / 2 + ring * 0.42
    members.forEach((cluster, index) => {
      const angle = start + (index / members.length) * Math.PI * 2
      points[cluster] = {
        x: Math.round(spec.cx + Math.cos(angle) * radius),
        y: Math.round(spec.cy + Math.sin(angle) * radius * spec.yFactor),
      }
    })
  }
  return { view: spec, points, radius: mobile ? mobileRadiusOf : radiusOf }
}
