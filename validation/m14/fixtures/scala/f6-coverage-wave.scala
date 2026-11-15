// F6 fixture-coverage wave: every construct below was probe-verified against
// the pinned tree-sitter-scala grammar to produce a spec declared
// handled_verified node type that no earlier fixture exercised. Only the 17
// uncovered types the analyzer actually references (grep-verified literals in
// real-scala-analyzer.ts) are exercised here; the remaining spec entries are
// ruled grammar-internal in scala-completeness.json.
package com.backbencher.f6

import scala.collection.{ListMap as LM} // as_renamed_identifier (Scala 3 form)
import scala.collection.{ListMap => LMO} // arrow_renamed_identifier (Scala 2 form)

package object f6support { // package_object
  val threshold: Int = 2

  def helper(): Int = threshold
}

trait BaseOp {
  def apply(x: Int): Int
}

trait ExtraOp {
  def tag: String
}

// trait-level abstract declarations: val_declaration / var_declaration
// (no initializer), plus access_qualifier on a qualified-private member.
trait F6Decls {
  val declared: Int
  var mutable: Int
  protected[f6] val guarded: Int
}

enum F6Color { // enum_definition + enum_body + enum_case_definitions
  case Red, Green // simple_enum_case
  case Mixed(r: Int, g: Int) extends F6Color(r + g) // full_enum_case
}

opaque type F6Cache = Map[String, Int] // opaque_modifier

class F6Ops[T: Ordering](val items: List[T]) { // context_bound
  type Combined = BaseOp with ExtraOp // compound_type
  type Infix = Int Map String // infix_type

  def raise(x: Int): Int =
    try { // try_expression
      if (x < 0) { throw new IllegalStateException("neg") } // throw_expression
      var i = 0
      while (i < x) { i += 1 } // while_expression
      do { i -= 1 } while (i > 2) // do_while_expression
      i
    } catch {
      case e: IllegalStateException => 0 // catch_clause
    } finally {
      val done = 1
    }

  inline def pick(x: Int): Int = x // inline_modifier

  transparent inline def show(x: Int): Int = x // transparent_modifier

  def useInfix: Int = 2 * 3 // infix_type usage site

  def rename(v: LMO[Int]): Int = v.size
}

// ---- F6 wave 2: remaining probe-verified shapes ----
class F6Proj { // projected_type
  type S
  val yy: F6Proj#S = ???
}

class F6Prefix[+A, -B](a: A, b: B) // covariant/contravariant params
class F6LB[B >: Null] // lower_bound

object F6Wave2 {
  val b = true // boolean_literal
  val n: Option[Int] = null // null_literal
  val c: Char = 'a' // character_literal
  val d = 1.5d // floating_point_literal
  val y = 5
  val plus = +y // prefix_expression
  val pf = y unary_! // postfix_expression
  val asc = (y: Int) // ascription_expression
  val t: 1 = 1 // literal_type
  val x2: Int @unchecked = y // annotated_type
  val nt: (name: String, age: Int) = ??? // named_tuple_type + name_and_type

  def g(v: Int): Int = v match { // guard
    case k if k > 0 => k
    case _ => 0
  }

  def ic(v: Int): Int = v match // indented_cases
    case 1 => 1
    case _ => 0

  def ret(): Int = { return 1 } // return_expression

  def pr(): Unit = println: // colon_argument
    1

  type MT[F[_]] = F[_] match { // match_type + type_case_clause
    case Option[t] => t
  }
  type TL = [X] =>> List[X] // type_lambda
  type R2 = AnyRef { def tick(): Int } // refinement
  def st(x: { def go(): Int }): Int = x.go() // structural_type
  def sing(z: F6Ops.type): F6Ops = z // singleton_type
  def mt(v: MT[Option]): Int = 1
}
erased def e(x: Int) = x // erased_modifier
tracked def tr(x: Int) = x // tracked_modifier
infix def plus(o: Int) = 1 // infix_modifier
def vb[T <% Int](t: T) = t // view_bound
consume def cd(x: Int) = x // consume_modifier
class EM:
  val q = 1
end EM // end_marker
