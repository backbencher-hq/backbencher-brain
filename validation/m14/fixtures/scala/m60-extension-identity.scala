// M60/SDJ-9 — extension method IDENTITY.
//
// A Scala 3 extension method is in scope ONLY for its receiver type, so
// (receiver, name) is its identity and the receiver is semantic, not a detail.
// The analyzer used to publish the bare name, so every extension method in a
// file collapsed onto `Owner.name` regardless of receiver.
//
// Measured over scala3 (script/m14/tmp/scala-extension-identity.ts): 3,203
// extension methods across 1,399 blocks in 660 files, and 177 names are declared
// in 2+ blocks. The fix decorates a colliding name as `name@ReceiverLeaf` — and
// ONLY a colliding one, which is what these three groups pin.

package com.acme.core

class AbstractFile
class JFile
class SourceFile

object FileUtils {
  // (1) THE DEFECT. Two blocks, same method name, DIFFERENT receivers. Before the
  // fix both published as `FileUtils.isPackage` — byte-identical symbols apart
  // from range, with the receiver recorded nowhere on either.
  extension (file: AbstractFile) {
    def isPackage: Boolean = true
  }

  extension (file: JFile) {
    def isPackage: Boolean = false
  }

  // (2) CONTROL — an OVERLOAD inside ONE block. The two `substring`s share a
  // receiver, so the receiver cannot tell them apart and the signature must.
  // They must stay BARE. A method-COUNT criterion decorates them and publishes
  // both as `substring@SourceFile` — colliding them exactly as hard while
  // claiming a distinction that is not there. That defect was real here: the
  // oracle counts DISTINCT RECEIVERS, so a count-based analyzer published
  // `substring@SourceFile` where the oracle published `substring`, a false
  // MISSING per overload (found on PPrint.scala via scala-ext-agree.ts).
  extension (source: SourceFile) {
    def substring(from: Int): Int = from
    def substring(from: Int, to: Int): Int = to
  }

  // (3) CONTROL — collides with nothing, so it keeps its plain name. Pinning
  // this is what stops the fix from being "decorate every extension method",
  // which would rename all 3,203 and stop the ~3,026 unambiguous ones resolving
  // (a call's target is the callee as written).
  def uniqueHelper: Int = 1
}
