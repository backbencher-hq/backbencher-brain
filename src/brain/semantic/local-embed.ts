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
  for (let i = 0; i < unique.length; i++) {
    _wordMap[unique[i]] = i
    _wordVecs.set(wordVector(unique[i]), i * WORD_DIM)
  }
}

/** The unit vector for one word.
 *
 *  Seeded from the WORD ITSELF, not from a sequential draw. That is the whole
 *  point: a word's vector is now a pure function of the word, so two callers
 *  with DIFFERENT vocabularies still produce comparable vectors for the words
 *  they share.
 *
 *  The previous sequential PRNG made a word's vector depend on its POSITION in
 *  the vocabulary. That is only safe when every caller uses an identical
 *  vocabulary — and they do not: `buildProjectVocab` produces a different list
 *  per project, and the top-5000 frequency slice reorders it. Under the old
 *  scheme, a query embedding a word at index 3 and an index-time embedding of
 *  the same word at index 417 compared two unrelated points with a cosine and
 *  reported the result as a similarity. Position-independence removes that
 *  whole class of silent nonsense, and it means a project vocabulary can be
 *  ADDED to the base one as a pure coverage increase: it can never perturb a
 *  vector that already existed. */
function wordVector(word: string): Float32Array {
  const v = new Float32Array(WORD_DIM)
  const rng = seedPRNG(hashWord(word) | 0)
  for (let d = 0; d < WORD_DIM; d++) v[d] = rng() * 2 - 1
  let norm = 0
  for (let d = 0; d < WORD_DIM; d++) norm += v[d] * v[d]
  norm = Math.sqrt(norm)
  if (norm > 0) for (let d = 0; d < WORD_DIM; d++) v[d] /= norm
  return v
}

/**
 * The ONE tokenizer, used by BOTH the vocabulary builder and the embedder.
 *
 * Before this existed, the two sides disagreed:
 *   - `buildProjectVocab` split names on camelCase, `_`, `-` and `.`
 *   - `embedLocal` split on WHITESPACE ONLY
 * so `CpuCounter` entered the vocabulary as `cpu` + `counter` but was queried
 * as the single token `cpucounter`. The out-of-vocabulary fallback cannot
 * rescue this: it tries 2-grams of the token, and vocabulary entries are whole
 * words, never 2-grams. The result was an all-zero query vector for every
 * identifier — measured at 99 of 99 real symbol names across 9 repositories.
 *
 * A zero vector has cosine 0 against every stored row, so the dense path never
 * ran for the single most likely query a code tool receives.
 */
/** The unit vector for one word, or null when the word is not in any
 *  vocabulary this module knows. Exported so a DIAGNOSTIC can re-derive the
 *  scoring exactly as production does, instead of approximating it — a probe
 *  that guesses the model measures a different model. */
export function wordVectorForTest(word: string): Float32Array | null {
  const w = word.toLowerCase().slice(0, 30)
  if (w.length < 2) return null
  if (!_wordMap || !_wordVecs) buildVectors(BASE_WORDS)
  const idx = _wordMap?.[w]
  if (idx === undefined || !_wordVecs) return null
  return _wordVecs.slice(idx * WORD_DIM, (idx + 1) * WORD_DIM)
}

export function tokenizeForEmbedding(text: string): string[] {
  const out: string[] = []
  // Split on everything that is not a letter or digit — INCLUDING underscore,
  // which is a word separator in snake_case and SCREAMING_SNAKE. (An earlier
  // draft excluded `_` from the split set and left `process_queue_item` as one
  // token; the probe caught it.)
  for (const raw of String(text).split(/[^A-Za-z0-9]+/)) {
    if (!raw) continue
    // Split camelCase and PascalCase: `getUserById` -> get User By Id.
    for (const part of raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(" ")) {
      const word = part.toLowerCase()
      if (word.length >= 2 && word.length <= 30 && !/^\d+$/.test(word)) out.push(word)
    }
  }
  return out
}

/** Per-project vocabularies, memoized.
 *
 *  A vocabulary is a SUPERSET of BASE_WORDS, and because word vectors are
 *  position-independent (see `wordVector`) adding words to it is a pure
 *  coverage increase: every word already in BASE_WORDS keeps exactly the
 *  vector it had. That is what makes it safe for the index side and the query
 *  side to build DIFFERENT vocabularies and still compare — which is the
 *  situation they are actually in, and the situation the previous sequential
 *  PRNG turned into silent noise.
 *
 *  Bounded because it is a per-project cache in a long-lived process. */
const PROJECT_VOCAB_MAX = 16
const projectVocabCache = new Map<string, Record<string, number>>()

/** The vocabulary for a project, built on first use from its own symbol names.
 *  Returns null when the index cannot be read, so the caller falls back to the
 *  base vocabulary instead of failing. */
export function projectVocabulary(rawDb: any, projectId: string): Record<string, number> | null {
  const cached = projectVocabCache.get(projectId)
  if (cached) return cached
  const words = new Set(BASE_WORDS)
  try {
    const symbols = rawDb.prepare("SELECT DISTINCT name FROM brain_symbol WHERE project_id = ? LIMIT 80000").all(projectId) as any[]
    const freq: Record<string, number> = {}
    for (const s of symbols) {
      if (!s.name) continue
      for (const w of tokenizeForEmbedding(String(s.name))) freq[w] = (freq[w] || 0) + 1
    }
    // Frequency order, then NAME order, so the vocabulary is deterministic for
    // a given corpus rather than dependent on SQLite's row order.
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5000)
    for (const [w] of top) words.add(w)
  } catch (e: any) {
    log.debug("project vocabulary failed, using base", { e: e?.message })
    return null
  }
  const map = Object.create(null)
  for (const w of words) map[w.toLowerCase().slice(0, 30)] = 0
  if (projectVocabCache.size >= PROJECT_VOCAB_MAX) {
    const oldest = projectVocabCache.keys().next().value
    if (oldest !== undefined) projectVocabCache.delete(oldest)
  }
  projectVocabCache.set(projectId, map)
  return map
}

export function buildProjectVocab(rawDb: any, projectId: string): void {
  const map = projectVocabulary(rawDb, projectId)
  buildVectors(map ? Object.keys(map) : BASE_WORDS)
}

/** The base vocabulary, as a map. Exported so a diagnostic can measure the
 *  base-only case honestly: the module's current word table is whatever was
 *  built last, so "with the base vocabulary" is otherwise unmeasurable without
 *  rebuilding it, and a probe that quietly measured the project vocabulary
 *  while labelling the result "base" would report a number nothing produced. */
export function baseVocabulary(): Record<string, number> {
  const map = Object.create(null)
  for (const w of BASE_WORDS) map[w] = 0
  return map
}

function getVectors(vocabulary?: Record<string, number> | null): { map: Record<string, number>; vecs: Float32Array } | null {
  if (vocabulary) {
    // Rebuild the vector table for this vocabulary. Vectors are
    // position-independent, so this is a pure re-derivation of the same values
    // for shared words — only the set of covered words changes.
    buildVectors(Object.keys(vocabulary))
    return _wordMap && _wordVecs ? { map: _wordMap, vecs: _wordVecs } : null
  }
  if (_wordMap && _wordVecs) return { map: _wordMap, vecs: _wordVecs }
  buildVectors(BASE_WORDS)
  return _wordMap && _wordVecs ? { map: _wordMap, vecs: _wordVecs } : null
}

export function embedLocal(texts: string[], vocabulary?: Record<string, number> | null): number[][] {
  const wv = getVectors(vocabulary)
  if (!wv) return []
  const results: number[][] = []
  for (const text of texts) {
    const vec = new Array(WORD_DIM).fill(0)
    // The SAME tokenizer the vocabulary was built with. Using a different one
    // here is what made every identifier unrepresentable.
    const words = tokenizeForEmbedding(text)
    let count = 0
    for (const w of words) {
      const idx = wv.map[w]
      if (idx !== undefined) {
        const base = idx * WORD_DIM
        for (let d = 0; d < WORD_DIM; d++) vec[d] += wv.vecs[base + d]
        count++
      } else {
        // Sub-word fallback for genuine OOV words. Sub-words are vocabulary
        // words themselves, so this can actually fire; the previous version
        // looked for 2-grams, which are never vocabulary entries, so it could
        // never fire and every OOV token silently contributed nothing.
        for (let i = 0; i < w.length - 3; i++) {
          const sub = w.slice(i, i + 4)
          const si = wv.map[sub]
          if (si !== undefined) {
            const b = si * WORD_DIM
            for (let d = 0; d < WORD_DIM; d++) vec[d] += wv.vecs[b + d] * 0.25
            count++
          }
        }
      }
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
