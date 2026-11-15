use std::io::{Read, Write as W};
use crate::foo::{bar, Baz as B};
use super::util::*;
use std::collections::HashMap;
extern crate serde;
use std::{env, io, path::{Path, PathBuf}};
use {std::sync::Arc, std::time::Duration};
// RUST-D25: an ABSOLUTE path (`use ::libc::c_int;`). The grammar gives a leading-`::`
// scoped_identifier NO `path` field — its only named child is the name itself — so
// the `namedChild(0)` fallback used the name as its own prefix and published
// `libc::libc::c_int`. The leading `::` is part of the path a consumer must
// resolve, so it is kept rather than dropped.
use ::libc::c_int;
use ::a::b::c;
// RUST-D27: a MULTI-LINE top-level group. Every row used to take the range of the
// whole `use` declaration, so all three pointed at the `use {` line — a line that
// bears none of the three paths it names. The range now follows the PATH. Pinned by
// full range value, which is the only way a line assertion can be falsified: the
// html #888 precedent is that an identity comparison makes such a pin unmatchable,
// and an unmatchable pin is a pin that proves nothing.
use {
    aho_corasick::AhoCorasick,
    bstr::{B, ByteSlice},
    regex_automata,
};

// RUST-D29: a COMMENT or a stray separator inside a use tree is not a module path.
// The collector's fallback accepted ANY node and published its raw text, so
// `use {a ,, b}` published module `,` and `use {/* Pre-comment! */ Foo, Bar}`
// published `/* Pre-comment! */` — 14 such rows at full extent, every one in a
// parse-recovery or rustfmt-test file. Narrowing the fallback to path-bearing nodes
// then broke `crate::foo::{…}`, whose path field is a `crate` NODE rather than an
// identifier: the prefix came back empty and the module became `::foo`. Both halves
// are pinned below, and both were found on the SAME run — the narrower rule created
// the second defect, which is why neither is taken on trust.
use {/* leading */ alpha, beta /* trailing */};
use {gamma ,, delta};
use crate::baz::{Qux as Q, Quux};
use super::sibling::Sib;
