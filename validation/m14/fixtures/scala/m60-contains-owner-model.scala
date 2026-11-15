// M60/S1 (scala deep review) — the `contains` owner model, stated as one rule:
// nearest enclosing owner; a val inside a FUNCTION SCOPE (a method OR a lambda)
// is not extracted. 68 controlled cases in script/m14/tmp/cases-b..j.

package p

class Inner { def m: Int = 1 }

// (1) A METHOD owns its local definitions.
class Locals {
  def m(): Any = {
    def local = 1
    type Alias = Int
    class Nested { val q = 1 }
    object AlsoNested { val r = 1 }
    new Runnable { def run(): Unit = () }
  }
}

// (2) A val inside a function scope is NOT extracted — method, lambda, and the
//     lambda argument block (`block > lambda_expression`, the shape behind all
//     56 of cats-effect's test-suite rows).
class Scopes {
  def inMethod(): Int = { val hidden = 1; hidden }
  def inLambda(): Any = { val f = (x: Int) => { val hidden = x; hidden }; f }
  ticked("x") { implicit ticker => val hidden = 1 }

  // (3) A val in a BARE BLOCK in a class body IS published — nothing on the path
  //     is a scope boundary. This is the declared approximation (SDJ-3).
  { val publishedInBlock = 1 }

  // (4) An anonymous class CLEARS the scope, so its members publish even inside
  //     a method or a lambda.
  def anonInsideMethod(): Any = { new Runnable { val field = 1 } }
  val anonInsideLambda: Any = (x: Int) => { new Runnable { val field = x } }

  // (5) A lambda CLEARS nothing on its own: nesting a lambda in a class body
  //     still hides the val inside it, while the lambda's own `val f` is a member.
  val memberLambda = (x: Int) => { val hidden = x; hidden }
}

// (6) The name shapes. An operator method's name is an `operator_identifier`, a
//     type alias's is a `type_identifier`, and reading the first `identifier`
//     child instead published `Scopes contains x` — the method's PARAMETER.
class Names {
  def !>(other: Names): Int = 1
  def ++(other: Names): Names = other
  type Alias[A] = List[A]
}

// (7) Trait parameters publish NEITHER a constructor nor a field (handleTrait has
//     no class_parameters path), while a class publishes both — and a CASE CLASS
//     publishes EVERY parameter as a field, val or not.
trait TraitWithParams(val a: Int) { def m: Int = 1 }
class Plain(a: Int, val b: Int) { def m: Int = 1 }
case class Case1(a: Int, val b: Int, var c: Int)
class NoParens { def m: Int = 1 }

// (8) An enum's CASES are members, and an enum with parameters publishes a
//     constructor but only its val/var parameters as fields.
enum Colour(val rgb: Int) {
  case Red, Green
  case Custom(override val rgb: Int)
  def hex: String = ""
}

// (9) A trait's ABSTRACT fields are members, and they arrive as val_declaration /
//     var_declaration carrying a `name:` field and NO `pattern:` field.
trait Service {
  def save(item: String): String
  val name: String
  var count: Int
  type Id = String
}

// (10) A `given` is an OWNER as well as a member, and an anonymous given does not
//      clear the function scope (handleVariable's ancestor scan breaks on
//      class/trait/object/enum and an anonymous class body, not on a given).
object Instances {
  given Ord[Int] with { def cmp(a: Int, b: Int): Int = 0 }
  given namedOrd: Ord[String] with { def cmp(a: String, b: String): Int = 0 }
  given [A]: Ord[Option[A]] = { val localInsideGiven = 1; new Ord[Option[A]] { def cmp(a: Option[A], b: Option[A]) = 0 } }
  def scoped(): Any = { given Ord[Char] with { def cmp(a: Char, b: Char) = 0 }; 1 }
}

trait Ord[A]
