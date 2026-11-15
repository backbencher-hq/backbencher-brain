// M60/S11 (scala deep review) — a `calls` / `instantiates` TARGET is a NAME, so
// the CALLEE must be a name-bearing shape.
//
// This is the defect class the analyzer already documents and fixed for `throw`
// (SCD4) and had not fixed here. It was also a SHARED BLIND SPOT: the oracle
// fell back to the same node text, so the differential reported 0 unexplained
// while both sides published the same garbage.

package p

class LensRef[F[_], A, B](ref: Ref[F, A]) {
  def get: F[B] = ???
  def set(a: A): F[Unit] = ???
}
class Ref[F[_], A]

class K {
  def lens[F[_], A, B](ref: Ref[F, A])(get: A => B, set: A => B => A): Ref[F, B] =
    // THE DEFECT: a CURRIED CONSTRUCTION. The callee node is the
    // instance_expression, so `fnNode.text` was the whole construction and the
    // published target was `new LensRef(ref)` — an EXPRESSION carrying an
    // argument, which no reference can name and nothing in the graph can join to.
    new LensRef[F, A, B](ref)(get, set)

  def infix(f: Int => Int): Int =
    // THE DEFECT, second shape: a right-associative infix operator makes the
    // INFIX EXPRESSION the callee, so the target was the whole expression, newlines
    // and all. dotty's `/:` reads `deps /: f(x)` exactly this way, and its targets
    // were things like
    //   `!inIntersection\n      || accountsFor(elem)\n      || TypeComparer.atomicOp`.
    (1 to 10) :/ (x => f(x))

  // CONTROL: an ordinary call, and an ordinary construction, are both names.
  def ordinary(xs: List[Int]): Int = xs.map(_ + 1).sum
  def construct(): LensRef[Int, Int, Int] = new LensRef[Int, Int, Int](new Ref[Int, Int])
}
