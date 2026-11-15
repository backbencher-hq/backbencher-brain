const LIMIT: u32 = 100;
static GLOBAL: u32 = 1;

struct Point {
    x: i32,
}

enum Color {
    Red,
    Green,
}

mod inner {
    pub const C: u8 = 7;
    pub fn get_c() -> u8 {
        C
    }
}

fn takes_cb(cb: fn(u32) -> u32) -> u32 {
    cb(LIMIT)
}

fn identity(v: u32) -> u32 {
    v
}

fn shadowed(GLOBAL: u32) -> u32 {
    GLOBAL
}

fn reader() -> u32 {
    let local = GLOBAL + LIMIT;
    let p = Point { x: local };
    takes_cb(identity) + p.x
}

fn matcher(o: Color) -> u32 {
    match o {
        Color::Red => LIMIT,
        _ => GLOBAL,
    }
}

fn generic<T>(x: T) -> T
where
    T: Clone,
{
    x
}

// R9 (extreme review): a bare arm pattern BINDS (`v => v` reads nothing)
// while an uppercase resolvable arm pattern is a constant-pattern READ
// (`VAL => VAL` reads the file const twice — same pair).
const VAL: u32 = 9;

fn arm_binds(x: u32) -> u32 {
    match x {
        VAL => VAL,
        v => v,
        _ => 0,
    }
}

// R10 (extreme review): closure parameters bind (`|VAL|` shadows the file
// const for the closure body — and only there).
fn closure_binds() -> u32 {
    let _ = |VAL| VAL + 1;
    LIMIT
}

// R11 (extreme review): a scoped single-leaf `use` binds its leaf, so
// value-position reads of plain-path imports resolve.
use std::u32::MAX;

fn capped(x: u32) -> u32 {
    if x > MAX {
        MAX
    } else {
        x
    }
}

// R12 (extreme review): the blank identifier declares nothing.
const _ : u32 = 0;
