// PINS the relationship kinds and #419-D evidence tiers the other rust
// fixtures don't cover: uses (field access), references (where-clause
// bounds), extends (trait supertrait bounds), exports (pub fn + route
// attribute) — each with its machine evidence class. Completeness section
// B/D depend on these pins.
use std::collections::HashMap;

pub trait Base: Display + Send {}

pub struct Record {
    pub id: u32,
}

pub fn lookup(map: &HashMap<String, i32>, rec: &Record, key: &str) -> Option<i32>
where
    String: PartialEq,
{
    let _ = rec.id;
    map.get(key).copied()
}

#[get("/status")]
pub fn status() -> String {
    "ok".to_string()
}

// Framework-detection markers (family contract: python/cpp populate
// detectedFrameworks from code signals; rust previously caught only actix
// route macros). serde derive and tokio entry-point are name-scoped, so no
// std-only derive (Debug/Clone) can false-positive.
#[derive(Serialize, Deserialize)]
pub struct Config {
    pub host: String,
}

#[tokio::main]
async fn boot() -> u32 {
    let _ = Config {
        host: String::new(),
    };
    1
}

// F6 coverage (2026-09-02): static_item, const_item, macro_definition,
// lifetime, loop_expression, while_expression, for_expression, try_expression,
// unsafe_block — declared handled_verified but not previously exercised.
static CACHE: u32 = 7;
const LIMIT: u32 = 100;

macro_rules! shout {
    ($e:expr) => { $e };
}

pub fn walk<'a>(items: &'a [u32]) -> Result<u32, ()> {
    let mut total = 0;
    for v in items {
        total += v;
    }
    while total < LIMIT {
        total += 1;
    }
    loop {
        total += 1;
        if total > 200 {
            break;
        }
    }
    let parsed: Result<u32, ()> = shout!(Ok(3));
    if let Ok(n) = parsed {
        total += n;
    }
    let scaled = scale(parsed.ok())?; // F6: try_expression (the ? operator)
    let fast = unsafe { total + CACHE };
    Ok(fast)
}
