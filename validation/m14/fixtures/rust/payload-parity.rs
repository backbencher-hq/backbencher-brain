pub fn other(x: i32) -> i32 { x }

pub fn documented(a: i32, b: i32) -> bool {
    let s = other(a);
    s > 0 && b > 0
}
