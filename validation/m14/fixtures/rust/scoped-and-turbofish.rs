// PINS the four fixed defect classes from the ripgrep differential residuals:
//  1. Scoped enum-variant struct literal -> instantiates the VARIANT LEAF
//     (MatchStrategy::Suffix { .. } -> instantiates Suffix, not the enum).
//  2. Bare tuple-struct ctor (Hasher(...)) -> instantiates Hasher (in-file).
//  3. ::new receiver -> instantiates the receiver TYPE (Foo::new() -> Foo).
//  4. Turbofish calls -> calls the LEAF (cap.parse::<u32>() -> parse,
//     crossbeam_channel::bounded::<T>() -> bounded); no garbage chain target.
pub enum MatchStrategy {
    Literal { value: String },
    Suffix { suffix: String, component: bool },
}

pub struct Hasher(u64);

impl Hasher {
    pub fn new() -> Hasher {
        Hasher(0)
    }
}

pub struct GlobBuilder;

impl GlobBuilder {
    pub fn build(&self) -> GlobBuilder {
        GlobBuilder
    }
}

pub fn tokenize(s: &str) -> MatchStrategy {
    if s.is_empty() {
        MatchStrategy::Suffix { suffix: String::new(), component: false }
    } else {
        MatchStrategy::Literal { value: s.to_string() }
    }
}

pub fn build(glob: &str) -> Hasher {
    let _b = GlobBuilder;
    let _ = cap_parse(glob);
    let h = Hasher::new();
    h
}

fn cap_parse(x: &str) -> u32 {
    x.parse::<u32>().unwrap_or(0)
}

pub struct Sink(Box<dyn Fn(u32)>);

impl Sink {
    pub fn run(&self, n: u32) {
        (self.0)(n);
    }
}
