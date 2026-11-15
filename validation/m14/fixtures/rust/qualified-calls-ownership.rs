// RSD1/RSD3/RSD4 regression pins:
//   - Alpha.run and Beta.run share the bare name `run` but live on different
//     types — each method's qualified_calls must contain ONLY its own body's
//     calls (per-owner payload, RSD1).
//   - `struct Alpha` plus TWO `impl Alpha` blocks are three distinct
//     declarations — their symbol ids must all be unique (RSD3).
//   - Alpha.second calls the format! macro — macro invocations are real call
//     sites and must appear in the payload as `macro:format` (RSD4).
pub struct Alpha {
    pub name: String,
    pub count: u32,
}

pub struct Beta {
    pub count: u32,
}

impl Alpha {
    pub fn run(&self) -> u32 {
        self.alpha_one() + self.alpha_two()
    }

    fn alpha_one(&self) -> u32 {
        1
    }

    fn alpha_two(&self) -> u32 {
        2
    }
}

impl Beta {
    pub fn run(&self) -> u32 {
        self.beta_only()
    }

    fn beta_only(&self) -> u32 {
        3
    }
}

// A second impl block for Alpha (multi-impl types are idiomatic Rust) — must
// be its own symbol, distinct from both the struct and the first impl.
impl Alpha {
    pub fn second(&self) -> String {
        format!("{}", self.name)
    }
}

// RSD5 field-access contract: WRITES (assignment / compound-assignment LHS)
// must NOT emit `uses`; only READS do.
impl Alpha {
    pub fn set_name(&mut self, v: String) {
        self.name = v; // pure write -> NO uses edge
    }

    pub fn bump_count(&mut self, delta: u32) {
        self.count += delta; // compound-assign write -> NO uses edge
    }

    pub fn first_char(&self) -> char {
        let s: &str = &self.name; // pure read of the field -> uses edge
        s.chars().next().unwrap_or('_')
    }
}
