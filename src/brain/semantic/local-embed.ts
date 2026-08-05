// @ts-nocheck — pre-existing null safety and type issues
import * as Log from "../../tool/brain-log"

const log = Log.create({ service: "local-embed" })

// Dynamic per-project word vectors. Zero deps, zero downloads, compiled binary safe.
const WORD_DIM = 50

const BASE_WORDS = [
  "function","class","return","import","export","const","let","var","async","await",
  "if","else","for","while","switch","case","break","continue","try","catch",
  "throw","new","this","super","extends","implements","interface","type","enum",
  "public","private","protected","static","abstract","final","override",
  "string","number","boolean","array","object","null","undefined","void",
  "true","false","map","filter","reduce","find","sort","push","pop","slice",
  "promise","callback","event","handler","listener","dispatch","subscribe",
  "module","package","dependency","require","default",
  "data","user","get","set","create","update","delete","fetch","load","save",
  "list","item","result","error","success","fail","check","validate","parse",
  "convert","format","render","display","show","hide","open","close","start",
  "stop","init","setup","config","option","param","value","key","id","name",
  "path","file","dir","read","write","send","receive","request","response",
  "query","select","insert","table","column","row","index","join",
  "api","http","url","server","client","host","port","connect","socket",
  "auth","token","login","logout","session","cookie","password","hash",
  "test","mock","stub","assert","expect","should","describe","before","after",
  "build","deploy","release","version","tag","branch","commit","merge",
  "payment","checkout","order","cart","product","price","customer","invoice",
  "subscription","refund","transaction","balance","charge","billing",
  "notification","message","email","template","report","dashboard","widget",
  "component","screen","page","view","layout","style","theme","color",
  "cache","store","database","repository","service","controller","model",
  "middleware","route","router","endpoint","schema","migration","seed",
  "state","context","provider","hook","effect","reducer","action",
]

let _wordMap: Record<string, number> | null = null
let _wordVecs: Float32Array | null = null

function hashWord(w: string): number {
  let h = 0x5EED
  for (let i = 0; i < w.length; i++) { h = Math.imul(h ^ w.charCodeAt(i), 0x5bd1e995); h = Math.imul(h ^ (h >>> 15), 0x5bd1e995) }
  return h >>> 0
}

function seedPRNG(seed: number): () => number {
  let s = seed | 0
  return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}

function buildVectors(words: string[]): void {
  const unique = [...new Set(words.map(w => w.toLowerCase().slice(0, 30)).filter(w => w.length >= 2))]
  _wordMap = Object.create(null)
  _wordVecs = new Float32Array(unique.length * WORD_DIM)
  const rng = seedPRNG(0x5EED0001)
  for (let i = 0; i < unique.length; i++) {
    _wordMap[unique[i]] = i
    const base = i * WORD_DIM
    for (let d = 0; d < WORD_DIM; d++) _wordVecs[base + d] = rng() * 2 - 1
    let norm = 0
    for (let d = 0; d < WORD_DIM; d++) norm += _wordVecs[base + d] * _wordVecs[base + d]
    norm = Math.sqrt(norm)
    if (norm > 0) for (let d = 0; d < WORD_DIM; d++) _wordVecs[base + d] /= norm
  }
}

export function buildProjectVocab(rawDb: any, projectId: string): void {
  const allWords = [...BASE_WORDS]
  try {
    const symbols = rawDb.prepare("SELECT DISTINCT name FROM brain_symbol WHERE project_id = ? LIMIT 80000").all(projectId) as any[]
    const freq: Record<string, number> = {}
    for (const s of symbols) {
      if (!s.name) continue
      const words = String(s.name).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").toLowerCase().split(/\s+/)
      for (const w of words) { if (w.length >= 2 && w.length <= 30 && !/^\d+$/.test(w)) freq[w] = (freq[w] || 0) + 1 }
    }
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5000).map(e => e[0])
    allWords.push(...sorted)
  } catch (e: any) { log.debug("project vocab failed, using base", { e: e?.message }) }
  buildVectors(allWords)
}

function getVectors(): { map: Record<string, number>; vecs: Float32Array } | null {
  if (_wordMap && _wordVecs) return { map: _wordMap, vecs: _wordVecs }
  buildVectors(BASE_WORDS)
  return _wordMap && _wordVecs ? { map: _wordMap, vecs: _wordVecs } : null
}

export function embedLocal(texts: string[]): number[][] {
  const wv = getVectors()
  if (!wv) return []
  const results: number[][] = []
  for (const text of texts) {
    const vec = new Array(WORD_DIM).fill(0)
    const clean = text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim()
    const words = clean.split(" ")
    let count = 0
    for (const w of words) {
      if (w.length < 2) continue
      const idx = wv.map[w]
      if (idx !== undefined) { const base = idx * WORD_DIM; for (let d = 0; d < WORD_DIM; d++) vec[d] += wv.vecs[base + d]; count++ }
      else { for (let i = 0; i < w.length - 1; i++) { const si = wv.map[w.slice(i, i + 2)]; if (si !== undefined) { const b = si * WORD_DIM; for (let d = 0; d < WORD_DIM; d++) vec[d] += wv.vecs[b + d] * 0.5; count++ } } }
    }
    if (count === 0) { results.push(new Array(WORD_DIM).fill(0)); continue }
    let norm = 0; for (let d = 0; d < WORD_DIM; d++) norm += vec[d] * vec[d]
    norm = Math.sqrt(norm)
    if (norm > 0) for (let d = 0; d < WORD_DIM; d++) vec[d] /= norm
    results.push(vec)
  }
  return results
}

export async function initLocalModel(): Promise<boolean> { return getVectors() !== null }
export async function initOnnxModel(): Promise<boolean> { return false }
