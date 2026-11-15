/** Types for the generated Evidence Atlas datasets. Regenerate with
 *  `bash script/hero/fetch-raw.sh && npx tsx script/hero/generate-hero-data.ts`,
 *  then verify with `npx tsx script/atlas/verify-atlas.ts`. */
export type HeroCluster = { l: string; n: number; a: number; x: number; y: number; h: [number, number][] }
export type HeroNode = {
  i: number
  n: string
  k: string
  f: string
  l: number
  c: number
  x: number
  y: number
  d: number | null
  t: number
  rt: string | null
  rg: number
  e: number
}
export type HeroEdge = { a: number; b: number; r: string; t: number }
export type HeroChip = { role: string; file: string; line: number; symbol: string; tier: string; note: string }
export type HeroAnswer = {
  question: string
  head: string
  sub: string
  evidence: string
  chips: HeroChip[]
  counted: {
    dependents: number
    shown: number
    direct: number
    files: number
    hops: number
    truncated: boolean
    truncationReason: string
    rowsOutsideMap: number
  }
}
export type HeroMap = {
  v: number
  digest: string
  generatedAt: string
  view: [number, number]
  root: number
  clusters: HeroCluster[]
  nodes: HeroNode[]
  edges: HeroEdge[]
  waves: number[][]
  answer: HeroAnswer
}
