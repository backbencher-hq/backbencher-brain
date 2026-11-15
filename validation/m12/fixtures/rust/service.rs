// validation/m12/fixtures/rust/service.rs
// M12.18 Rust positive fixture: module, trait with bounds, struct with pub
// and private fields, enum, generics, inherent + trait impls, free functions,
// method calls, field access, struct literals, closures.
mod storage;

pub use storage::MemoryStorage;

pub trait Repository<T> {
    fn add(&mut self, item: T);
    fn find(&self, id: u32) -> Option<&T>;
}

pub struct User {
    pub id: u32,
    pub name: String,
}

impl User {
    pub fn new(id: u32, name: &str) -> User {
        User { id, name: name.to_string() }
    }

    pub fn display_name(&self) -> String {
        format!("{}:{}", self.id, self.name)
    }
}

pub enum Status {
    Active,
    Inactive,
}

pub struct UserService<T: Repository<User>> {
    repository: T,
    counter: u32,
}

impl<T: Repository<User>> UserService<T> {
    pub fn new(repository: T) -> Self {
        UserService { repository, counter: 0 }
    }

    pub fn create(&mut self, name: &str) -> User {
        let user = User::new(self.counter, name);
        self.repository.add(user);
        self.counter += 1;
        self.repository.find(self.counter - 1).cloned().unwrap()
    }

    pub fn find(&self, id: u32) -> Option<&User> {
        self.repository.find(id)
    }
}

pub fn make_default_service() -> UserService<MemoryStorage> {
    let storage = MemoryStorage::new();
    UserService::new(storage)
}

pub fn transform(values: &[i32]) -> Vec<i32> {
    values.iter().map(|v| v * 2).filter(|v| *v > 0).collect()
}
