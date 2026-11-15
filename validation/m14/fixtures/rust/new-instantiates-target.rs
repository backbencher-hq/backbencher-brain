pub struct Counter;

impl Counter {
    pub fn new() -> Self { Counter }
    pub fn branches(&self, n: i32) -> i32 {
        match n {
            1 => 1,
            _ => { if n > 0 { 2 } else { 3 } }
        }
    }
}

pub fn make() -> Counter {
    Counter::new()
}
