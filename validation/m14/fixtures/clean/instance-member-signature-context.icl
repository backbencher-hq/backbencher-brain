implementation module instance_member_signature_context

// An INSTANCE member's own signature carries a dictionary requirement, and that
// requirement is a dependency the module has: it says which class the member
// needs in order to exist. `instance Cmp [!a] | Ord a` says it on the instance;
// `cmp :: ![!a] ![!a] -> Bool | Ord a` says it again, on the member, and the
// second statement is the one that travels with the member's type.
//
// Measured unread at PROD (312 files) before this fixture existed: 20
// class_context nodes under a type_signature published no edge at all — 13
// under an `instance_member`, 6 under a `where`-block `local_binding`, 1 under
// an `ERROR` — against 473 class_context nodes in the same population, and the
// census recorded 436 `references` carrying the `class_context` discriminator.
// The fix took references 9,551 -> 9,751 and the class_context share 436 -> 441.
//
// The defect was a KEY, not a missing branch. The declaration pass reads a
// signature into `ctx.signatures` under `declarationKey(frame, owner, name)`,
// and for an instance member it does not know the instance's target, so it
// stored `|::cmp`. The emitting pass asks under the instance owner, `|[!a]::cmp`,
// because that is the scope the walk is actually in. The lookup missed,
// `applySignature` never ran, and the signature's types and its class context
// were read and then discarded. Both passes now index by the node's own id
// (`signaturesByNode`), an identity they cannot disagree about.

class Cmp a where
	cmp :: a a -> Bool

class Size a where
	size :: a -> Int

// The instance member's OWN context. This edge is what the fixture exists for.
instance Cmp [!a] | Ord a
	where
	cmp :: ![!a] ![!a] -> Bool | Ord a
	cmp [] [] = True
	cmp _ _ = False

// Two instances of ONE class, so the second member of the same name reads its
// signature under a DIFFERENT owner. A per-(owner,name) dedupe would keep the
// first and lose this one; the per-node index keeps both.
instance Cmp [!a!] | Eq a
	where
	cmp :: ![!a!] ![!a!] -> Bool | Eq a
	cmp x y = x == y

// A member whose context names a class this file does NOT declare. The edge is
// still correct — it is a real dependency on an imported class — and it is still
// `references`, because the target is not resolvable here. What it must not
// become is an `overrides` naming a class member the analyzer never read, and it
// must not be dropped either: dropping it is the defect this fixture pins.
instance Cmp Bool | Ord Bool
	where
	cmp :: !Bool !Bool -> Bool | Ord Bool
	cmp True True = True
	cmp _ _ = False

// The control in the negative direction: a member with NO context. The absence
// must stay an absence — no edge may be invented for a signature that constrains
// nothing — while its sibling at L42 does carry one.
instance Size Int | Ord Int
	where
	size :: !Int -> Int
	size i = i
	where
		// A where-LOCAL signature inside an instance member's body. Same handler,
		// one more scope, and it was one of the 6 unread sites.
		inner :: !Int -> Bool | Eq Int
		inner n = n == 0

// A module-level signature, the form that has always read. If the per-node index
// ever stopped serving the module case this row disappears and the fixture fails,
// which is the point of keeping it.
moduleLevel :: !Int !Int -> Bool | Ord Int
moduleLevel x y = x < y