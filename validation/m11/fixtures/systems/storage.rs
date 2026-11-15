// validation/m11/fixtures/systems/storage.rs
// M11.10 Rust fixture: submodule with cross-file types used by lib.rs.

use super::User;

pub struct MemoryStorage {
    items: Vec<User>,
}

impl MemoryStorage {
    pub fn new() -> MemoryStorage {
        MemoryStorage { items: Vec::new() }
    }
}

impl super::Repository<User> for MemoryStorage {
    fn add(&mut self, item: User) {
        self.items.push(item);
    }

    fn find(&self, id: u32) -> Option<&User> {
        self.items.iter().find(|u| u.id == id)
    }
}
