// validation/m12/fixtures/rust/storage.rs
// M12.18 Rust positive fixture: submodule with cross-file types used by
// service.rs, trait impl with qualified path.
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
