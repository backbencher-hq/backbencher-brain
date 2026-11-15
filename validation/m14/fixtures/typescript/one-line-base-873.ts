// M60.P1 #873 — ONE line base per relationship row.
//
// The eight writers in the typescript analyzer stored `startPosition.row`
// (0-based) in `metadata.line` while the same row's `line_number` is 1-based,
// so any consumer reading the mirror was off by one — and on some rows (where
// the mirror's node differed from `lineField`'s) off by more. Measured before
// the fix, through the production pipeline: typescript 148/155 rows off by one
// and 7 by more, tsx 173/179, vue 3/3; zero rows affected on any JVM language,
// because only this analyzer writes the mirror.
export function make(): number {
  return 1
}

const obj = { field: 7 }

export function use(): number {
  const a = make()
  const b = `${obj.field}`
  return a + b.length
}
