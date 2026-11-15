package collisionfixture

// GO ONTOLOGY (relationship-type workstream) — the qualified-embed guard on the
// `overrides` pass.
//
// This file is a corpus shape, not a thought experiment.
// `src/archive/zip/writer.go` declares, in one file:
//
//	type Writer struct{ … }            // the LOCAL type, with its own Close
//	type nopCloser struct{ io.Writer }  // embeds the IMPORTED io.Writer
//	func (nopCloser) Close() error
//
// The `mixes_in` embedding edge publishes its target as the LEAF (`Writer`, per the lane's
// R10 dotted-name convention), so a leaf-keyed promotion walk reads the stdlib
// embed as the local type and publishes `overrides nopCloser.Close ->
// Writer.Close` — a fact about `zip.Writer` that is not true of `nopCloser`,
// whose promoted method set comes from `io.Writer`, an interface with no `Close`
// method at all. That edge shipped in the first version of this pass and this
// file is what caught it.
//
// The positive half matters as much as the forbid: `LocalEmbed` below embeds a
// type declared in THIS file and does shadow it, so the fixture cannot pass by a
// pass that simply stopped walking.

import "io"

// The local type whose leaf collides with the imported `io.Writer`.
type Writer struct{ n int }

func (w *Writer) Close() error { return nil }

func (w *Writer) Flush() error { return nil }

// Embeds the IMPORTED io.Writer. `Close` here shadows nothing: io.Writer's
// method set is {Write}, and this analyzer cannot see another package.
type nopCloser struct{ io.Writer }

func (nopCloser) Close() error { return nil }

// Embeds the LOCAL Writer and genuinely shadows both of its methods.
type LocalEmbed struct {
	Writer
}

func (l *LocalEmbed) Close() error { return nil }

// Embeds an imported interface and declares nothing: the empty-closure control
// on the qualified side.
type OnlyEmbeds struct {
	io.Reader
}
