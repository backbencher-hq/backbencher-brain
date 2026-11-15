pub trait Repository {
    fn get(&self, id: u32) -> Option<String>;
}

pub struct PgRepository;

impl Repository for PgRepository {
    fn get(&self, id: u32) -> Option<String> { None }
}

fn internal_helper(x: i32) -> i32 {
    if x > 0 { x } else { -x }
}
