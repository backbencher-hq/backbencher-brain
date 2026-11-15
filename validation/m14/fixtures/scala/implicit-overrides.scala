// ScalaD-A/B/C (two-corpus gate wave 2026-09, cats-effect):
//  - implementing an ABSTRACT trait/class member needs no `override` keyword
//    in Scala (required only for CONCRETE members) — ImplA/ImplB.value are
//    keywordless yet genuine overrides of BaseTrait.value;
//  - a keyworded override through an intermediate abstract class must resolve
//    to the TRUE declaring ancestor (BaseTrait.doubled), never a
//    first-supertype guess against Mid, which does not declare it;
//  - the resolution is signature-exact: an overload with a different
//    parameter list must not pair.
trait BaseTrait {
  def value: Int

  def doubled: Int = value * 2

  def add(step: Int): Int = value + step
}

class ImplA extends BaseTrait {
  def value = 42
}

abstract class Mid extends BaseTrait

class ImplB extends Mid {
  def value = 7

  override def doubled = 100
}
