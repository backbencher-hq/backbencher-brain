// INCOMING_RUST — `overrides`: the trait implementation as the override.
//
// Rust has no `override` keyword. `impl Trait for Type { fn m() }` REPLACES the
// trait's `m` for that type, and the author's writing of both is the assertion.
// Written before the analyzer change was run, from the grammar.
//
// Four shapes, and the fourth is the one that decides whether the label means
// anything: `only_in_impl` is a method the trait does NOT declare, so the impl
// ADDS one. Publishing `overrides` for it would put a label on an edge that is
// not an override, and `overrides` is the edge that makes a hierarchy
// navigable — a row that lies there is worse than a row that is missing.

use std::fmt;

/// A trait declared IN THIS FILE. Both ends of the override edge below are
/// facts read out of this file, so the edge is 1.0.
pub trait Local {
    fn handle(&self) -> u32;
    fn with_default(&self) -> u32 {
        0
    }
}

/// A trait this file DOES declare: both ends of its override edge are facts
/// read out of this file, so the edge is 1.0 exactly like `Local`'s. The two
/// are separated so a rule that only handled the first trait in the file, or
/// only handled std traits, would show up here rather than pass.
pub trait Foreign {
    fn drive(&self) -> u32;
}

pub struct Widget {
    pub size: u32,
}

impl Local for Widget {
    fn handle(&self) -> u32 {
        self.size
    }

    fn with_default(&self) -> u32 {
        1
    }

    /// NOT declared by `Local`. An addition, not an override.
    fn only_in_impl(&self) -> u32 {
        2
    }
}

impl Foreign for Widget {
    fn drive(&self) -> u32 {
        3
    }
}

impl Widget {
    /// An INHERENT method. Rust has no trait here, so there is nothing to
    /// displace and nothing to publish.
    pub fn inherent(&self) -> u32 {
        4
    }
}

// `Read` is NOT declared in this file. The edge is still what the source says —
// the author wrote `impl Read for Socket` and `fn read` — but the target joins
// only once the whole project is indexed, so the edge is 0.85 and below the
// patterns.ts default threshold: a thresholded consumer must not treat it as
// ground truth.
pub struct Socket;

impl std::io::Read for Socket {
    fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
        Ok(0)
    }
}

impl Drop for Widget {
    fn drop(&mut self) {}
}

impl std::fmt::Display for Widget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "widget")
    }
}
