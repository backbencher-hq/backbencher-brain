package com.acme.conformance

// 1 · THE CONFORMANCE ROW. `this: Logging =>` says Service can only exist as part of
// something that IS a Logging — a conformance with NO supertype position and NO mixin
// composition. That is the `implements` row, and it is the row the fleet MIXIN RULING
// ruled out for scala without MEASURING the construct that carries it.
trait Service {
  this: Logging =>
  def go(): Unit = ()
}

trait Logging

// 2 · A SELF NAME IS NOT A CONFORMANCE. `self =>` binds a name and requires nothing,
// so it publishes NO `implements` row.
trait Named {
  self =>
  def go(): Unit = ()
}

// 3 · AN X -> X ROW CARRIES NO INFORMATION. `this: Pure =>` inside `trait Pure` names
// ITSELF, so there is no conformance to publish.
trait Pure {
  this: Pure =>
}

// 4 · A SINGLETON TYPE'S TARGET IS THE MODULE'S NAME — `acme.Module.type` is the
// module VALUE, and the type it names is `acme.Module`.
trait NeedsModule {
  this: acme.Module.type =>
}

// 5 · A QUALIFIED TYPE IS NAMED IN FULL, per the cross-language convention.
trait NeedsQualified {
  this: acme.Logging =>
}

// 6 · A TYPE ARGUMENT IS A PARAMETER OF THE REQUIRED TYPE, NOT A SECOND REQUIREMENT.
// `List[Int]` requires a List; `Int` is bound by the List.
trait NeedsGeneric {
  this: List[Int] =>
}

// 7 · A UNION NAMES TWO REQUIREMENTS.
trait NeedsEither {
  this: Logging | acme.Other =>
}
