// Equivalence harness: char-scan helpers vs the original regexes, on the
// exact corpus shapes that regressed plus adversarial inputs.
const stripBrackets = (s: string): string => {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "[") { out += s[i]; continue }
    let j = i + 1
    let nested = false
    while (j < s.length && s[j] !== "]") { if (s[j] === "[") { nested = true; break } j++ }
    if (j < s.length && !nested) { i = j; continue }
    out += s[i]
  }
  return out
}
const stripAngles = (s: string): string => {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "<") { out += s[i]; continue }
    let j = i + 1
    let nested = false
    while (j < s.length && s[j] !== ">") { if (s[j] === "<") { nested = true; break } j++ }
    if (j < s.length && !nested) { i = j; continue }
    out += s[i]
  }
  return out
}
const stripTypeArgs = (s: string) => stripAngles(stripBrackets(s)).trim()
const reBr = (s: string) => s.replace(/\[[^\[\]]*\]/g, "")
const reTy = (s: string) => s.replace(/\[[^\[\]]*\]/g, "").replace(/<[^<>]*>/g, "").trim()

const cases = [
  "ParallelF[Id, *] ~> Id", "F ~> M", "(ParallelF ~> Id)", "(Id ~> ParallelF)",
  "List[(A[B], C)]", "Map[String, List[Int]]", "Box[Array[Seq[T]]]",
  "Foo[Bar[T]]", "T", "Either[A, B]", "F[_[_]]", "Lambda[A => B]",
  "Kleisli[M, A, B]", "Collection[Map[K,V]]", "a < b > c", "x[<y]", "a[b[c]]d[e]",
]
let bad = 0
for (const c of cases) {
  const a = stripTypeArgs(c), b = reTy(c)
  const ba = stripBrackets(c) === reBr(c)
  if (a !== b || !ba) { bad++; console.log("MISMATCH", JSON.stringify(c), "scan=", JSON.stringify(a), "re=", JSON.stringify(b)) }
}
// nested-bracket single-pass equivalence: scanner must also equal regex on
// single-pass behavior for nested cases (both leave inner brackets)
for (const c of cases) {
  if (stripBrackets(c) !== reBr(c)) { bad++; console.log("BR MISMATCH", c) }
}
console.log(bad === 0 ? `EQUIVALENT on ${cases.length} cases (incl. ~> shapes)` : `${bad} mismatches`)
