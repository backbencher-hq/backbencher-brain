// M49.S1 #715 regression fixture: heritage + qualified-construction contracts.
//
// Pins three wave rulings (all verified on live parses before pinning):
//   1. Companion-qualified construction keeps the DOTTED target
//      (new TrieMapLike.MangledHashing[Int] -> instantiates
//      TrieMapLike.MangledHashing) — the pre-S1 oracle dropped these as junk
//      and a reverted analyzer would too (scala3 TrieMap.scala real corpus).
//   2. enum X extends Y emits heritage (the shared-blind-spot class: BOTH
//      sides were blind before S1; probe s1-probe3).
//   3. Transitive overrides through a NON-DECLARING middle (Leaf.handle ->
//      Base.handle through abstract Mid) — M37.9 BFS contract held intact
//      through the per-occurrence oracle guard.

package probe

import java.io.Serializable

enum Color(val hex: Int) extends Serializable {
  case Red extends Color(0xff0000)
  case Green extends Color(0x00ff00)
}

object TrieMapLike {
  class MangledHashing[K] extends Serializable
}

class User {
  val h = new TrieMapLike.MangledHashing[Int]
}

trait Base {
  def handle(x: Int): Int
}

abstract class Mid extends Base

class Leaf extends Mid {
  def handle(x: Int): Int = x + 1
}
