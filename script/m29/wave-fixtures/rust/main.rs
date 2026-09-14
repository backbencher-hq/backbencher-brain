fn main() {
    let mut greeter = Greeter::new(String::from("hello"));
    greeter.prefix = String::from("hello");
    println!("{}", greeter.greet("world"));
}

struct Greeter {
    prefix: String,
}

impl Greeter {
    fn new(prefix: String) -> Greeter {
        Greeter { prefix }
    }

    fn greet(&self, name: &str) -> String {
        format!("{}, {}!", self.prefix, name)
    }
}
