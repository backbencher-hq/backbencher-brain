// go/receiver-owner-scope — THE ONE THING A PER-FILE ANALYZER CANNOT DECIDE, MADE EXPLICIT.
//
// `func (T) NoName()` and `func (s) Untyped()` produce IDENTICAL trees: the lone
// identifier lands in the receiver's TYPE slot either way. The first is a legal
// method on a declared type; the second names no type and does not compile. Go
// resolves it semantically by knowing which identifiers are types in the PACKAGE,
// and this analyzer is a per-file entry point, so it cannot ask whether a name is
// a type declared in a SIBLING file.
//
// DELETION IS NOT AVAILABLE AS A REMEDY, and the measurement is why. GO44 recorded
// 1,251 `contains` edges that legitimately name an owner declared in a sibling
// file, so a file-local "is it declared here" test would delete every one of them
// to fix rows in files that cannot compile. The rows stay. What they stop being is
// INDISTINGUISHABLE.
//
// Each method `contains` edge now carries `metadata.receiverOwnerScope`:
//
//   same_file_type                the owner IS a type declared in this file — the
//                                 method provably has a type owner, zero ambiguity.
//   type_not_declared_in_this_file the owner is not declared here: the GO44 case (a
//                                 sibling-file type) OR the GO-GAP-3 case (a receiver
//                                 naming no type). The two are indistinguishable
//                                 per-file BY CONSTRUCTION, and the label says
//                                 exactly that instead of pretending to resolve it.
//
// MEASURED on go-tools + terraform (3,422 files): 14,979 method `contains` edges,
// 13,729 `same_file_type` (91.65%), 1,250 `type_not_declared_in_this_file`, 0
// unlabelled. The verified share is what a per-file analyzer can honestly claim.
package receiverownerscope

// Verified: this type is declared HERE, so `Good`'s owner is certain.
type Known struct{}

func (k Known) Good() {}

// The GO44 shape: a LEGAL method whose owner type lives in a sibling file of this
// package. It must keep its `contains` edge and be marked unverifiable, not dropped.
func (Sibling) FromOtherFile() {}
