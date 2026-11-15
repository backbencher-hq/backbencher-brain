implementation module ampersand_context

// `&` and `,` are the SAME separator, spelled two ways, and the analyzer read
// only one of them. The proof that they are one construct and not two is the
// child shape, which is identical with the token swapped:
//
//     | == a           -> !| operator_compare type_variable
//     | == a & UList a -> !| operator_compare type_variable !& constructor type_variable
//
// (clean-stdlib/StdOverloadedList.dcl:5,8.) So a context joined by `&`
// published its first conjunct and dropped the rest, which is a MISSING edge
// rather than a missing label.
//
// Measured over the corpus (validation/m14/fixtures/clean/ampersand-context-probe.mts):
// 1,995 class_context nodes at WIDE, 365 containing an `&`. The conjuncts a `,`-only
// reader dropped split 249 that would ADD a row against 264 that name a class already
// published on that same line — `| toReal a & toReal b & toReal c`
// (Clyde/Clyde/timeprofile.icl:337) is that shape. At TRACKED the split is 62 / 47.
//
// The 264 are not a doubling, and the reason is `pushRel`'s key rather than a judgement
// made here: it collapses on `source|type|target|line`, so a repeated conjunct cannot
// publish a second identical edge on one line. Measured as an A/B on TRACKED, reverting
// only the `&` (validation/m14/fixtures/clean/references-duplicate-probe.mts):
//
//              references edges   distinct (source,target,line)   groups with >1
//   `,` only          10,049                    9,570                    387
//   `,` and `&`       10,108                    9,629                    387
//
// The third column is identical per discriminator, so the fix adds 59 edges and 59 new
// groups and changes the duplicate count by zero. Every conjunct that ADDS a row below
// is a genuinely distinct constraint whose edge was absent.
//
// The rows below are the shapes that distinction covers: an operator class after
// `&`, a three-way chain, a `&` inside an instance member and inside a where-local,
// and the two spellings side by side so a regression in either is visible here.

class Eq a where
	eq :: a a -> Bool

class Ord a where
	cmp :: a a -> Bool

class Size a where
	size :: a -> Int

// TWO conjuncts naming DIFFERENT classes. Before the fix this published only `Eq`.
both :: !Int !Int -> Bool | Eq Int & Ord Int
both x y = eq x y

// A THREE-way chain: the middle conjunct is the one a first-conjunct-only reader
// and a last-conjunct-only reader both miss, so it is the discriminating row.
three :: !Int -> Bool | Eq Int & Ord Int & Size Int
three n = size n == n

// The control in the positive direction: the SAME two constraints written with the
// spelling that was always read. If this row disappears the fixture fails, which is
// the point of keeping it beside the `&` rows.
comma :: !Int !Int -> Bool | Eq Int, Ord Int
comma x y = eq x y

// The control with NO separator at all. An `&`-aware reader that reset on every
// unnamed child rather than on the two separators would break here.
single :: !Int -> Bool | Eq Int
single n = n == n

// An OPERATOR class after `&`. `constraintName` reads `operator_compare` leaves, and
// this row is what keeps the operator path alive across a separator.
overloaded :: !Int !Int -> Bool | == Int & Ord Int
overloaded x y = x == y

// A `&` inside a where-LOCAL signature, so the fix is not scoped to module level.
nested :: !Int -> Bool
nested n = local
	where
	local :: !Int -> Bool | Eq Int & Size Int
	local m = size m == m

// A `&` inside an INSTANCE member's own signature. This is the scope pass 4 fixed
// for `,`; the `&` spelling reached the same code by the same route and had to
// survive the same fix.
instance Ord Int | Eq Int & Size Int
	where
	cmp :: !Int !Int -> Bool | Eq Int & Size Int
	cmp x y = x == y

// The REPEATED conjunct — the shape the A/B above turned on, and the one the
// previous round refused to ship over. Three conjuncts name two classes, so this
// must publish exactly TWO edges and not three. `pushRel` collapses on
// `source|type|target|line` (real-clean-analyzer.ts:3279), which is what makes the
// difference between a duplicate and a multiplicity a settled question rather than an
// open one: the edge carries no multiplicity field, so N identical rows on one line
// would carry nothing that one does not.
//
// If a future change pushes one edge per conjunct instead of per class, the
// expectRelationshipCount rows below fail from 1 to 2. That is the row's whole job.
repeated :: !Int !Int -> Bool | Ord Int & Ord Int & Size Int
repeated x y = size x == y