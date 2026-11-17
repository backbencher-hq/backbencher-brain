// go/explanation-complete — EVERY EDGE NAMES ITS CONSTRUCT.
//
// The lane states two explanation contracts and enforces both at 100%:
//
//   confidence < 1.0  =>  metadata.reasonCode   (why the edge is below 1.0)
//   target is a reference (not `contains`/`renders`)
//                     =>  metadata.bindReason   (why the target did not bind)
//
// A THIRD dimension was silently incomplete: `metadata.relationshipType`, the
// construct that produced the edge. Ten of the twelve firing types carried it;
// `imports` and `contains` published no label at all — `contains` shipped a BARE
// `metadata: {}`. Measured on go-tools + terraform (3,422 files, 363,830 edges):
// 55,012 edges (15.1%) named no construct, and the sub-1.0 reason table was
// reaching `imports` only through its `imports|*` WILDCARD — doing the right thing
// by fallback rather than by name.
//
// This fixture is the control that all three now hold together. Every row below is
// read back from live emission, never predicted.
package explanationcomplete

import "sync"

// A struct field, a method on a receiver, and an interface method: three
// DISTINCT ownership relations that `contains` used to flatten into one unlabelled
// shape. Each must now name its own construct.
type Holder struct {
	Field int
}

func (h Holder) Method() {}

type Iface interface {
	Do()
}

var mu sync.Mutex
