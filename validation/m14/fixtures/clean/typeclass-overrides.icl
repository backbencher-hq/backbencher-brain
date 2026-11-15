// Clean fixture: TYPECLASS OVERRIDES.
//
// Clean has no `override` keyword. It has typeclasses: `class Show a where show ::`
// declares `show` ABSTRACT, and `instance Show Thing where show t = ...` supplies it.
// At type `Thing` the compiler selects the instance's `show` in place of the class's,
// which is the relation every other lane publishes as `overrides` — the F# lane reads
// the keyword (`Dog.Speak -> Animal.Speak`, real-fsharp-analyzer.ts:656-669) and the
// Haskell lane's doc records the same construct as `overrides T.m -> C.m`
// (real-haskell-analyzer.md:57). Clean has no keyword to probe, so the pairing is read
// off two `name` fields: an `instance_member` whose name is in its class's member set.
//
// Four facts this fixture pins, and each one is a place the rule can be wrong:
//
//   1 BOTH sides are QUALIFIED and the direction is instance-member -> class-member.
//     `Thing.show` is the implementation; `Show.show` is what it implements. An
//     unqualified edge would collide with the module-level `show` in every consumer.
//
//   2 The guard is IN-FILE. `Eq`, `Ord` and `Show` are imported from StdEnv in almost
//     every real Clean file, so a corpus-wide reading emits mostly unbindable edges.
//     `Forbidden == <anything>` below is the negative half: an instance for an
//     IMPORTED class emits NO overrides edge, which is the rule stated above.
//
//   3 The site line is the member's OWN name line, per M59.O2 and the rule every other
//     clean edge follows. Two instances of the same class here put the two `show`
//     definitions on different lines and both edges must survive.
//
//   4 An `instance_member` whose name is NOT in the class's member set emits nothing.
//     `size` below is a `Thing` RECORD FIELD, and the two `instance StdEnv`-shaped
//     instances at the bottom carry members no local class declares.
definition module TypeclassOverrides

import StdEnv

class Show a where
	show :: !a -> String

class Sized a where
	size :: !a -> Int

:: Thing = { label :: !String, size :: !Int }

instance Show Thing where
	show t = t.label

instance Show Int where
	show i = toString i

thing :: !Thing -> String
thing t = show t

instance Show Bool where
	size b = toString b

// A POLYMORPHIC instance of a locally-declared class. `instance Sized a` puts no
// symbol of its own (its target is the type VARIABLE `a`, and a symbol named `a`
// would be a lie), so its members are attributed to the CLASS — which makes
// `instanceType === className` and the composed endpoints identical. The edge there
// would read `Sized.size -> Sized.size`, i.e. a declaration overriding itself.
// Measured on the corpus before the guard: 60 such self-edges in 42 files'
// worth of `instance List [] a where _cons …`.
instance Sized a where
	size _ = 0