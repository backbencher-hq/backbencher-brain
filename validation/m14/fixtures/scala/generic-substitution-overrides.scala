// ScalaD-E/H regression fixture (M37.21 #610, scala3 byname-implicits-13 +
// spec-example1 shapes): trait methods declared under GENERIC TYPE VARIABLES
// (`def to(t: T)`, `def m(x: T)`) are overridden by implementations carrying
// the SUBSTITUTED concrete types (`to(t: AABB)`, `m(x: Int)`). Textual sig
// equality rejects these genuine overrides — both analyzer and oracle must
// pair them name-only when either sig carries a type variable. Concrete
// same-name-different-sig pairs (overloads) must still NEVER pair.
trait Codec[T] {
  def encode(t: T): Array[Byte]
  def decode(bytes: Array[Byte]): T
}

case class Payload(value: String)

class PayloadCodec extends Codec[Payload] {
  // substitutes T -> Payload: generic-substitution override
  def encode(t: Payload): Array[Byte] = t.value.getBytes
  def decode(bytes: Array[Byte]): Payload = Payload(new String(bytes))
}

class StringCodec extends Codec[String] {
  // same shape, different substitution — still an override of Codec.encode
  def encode(t: String): Array[Byte] = t.getBytes
  def decode(bytes: Array[Byte]): String = new String(bytes)
}

class Overloads {
  // CONCRETE overload pair: (Int) vs (String) — must NOT pair as overrides
  def f(x: Int): Int = x
  def f(x: String): Int = x.length
}
