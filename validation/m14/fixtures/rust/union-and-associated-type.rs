// PINS two declaration sites the analyzer previously missed (completeness
// gaps found 2026-08-28): union_item (pub union Pixel { .. }) emitted NO
// symbol because the grammar node is union_item, not struct_item; trait
// associated types (type Item; in a trait body) are associated_type nodes
// and were invisible — only impl-level type_item emitted. Both must now
// produce real symbols with correct ownership.
pub union Pixel {
    value: u32,
    channels: [u8; 4],
}

pub trait Container {
    type Item;
    fn get(&self) -> Option<Self::Item>;
}

pub struct Bag;

impl Container for Bag {
    type Item = u32;
    fn get(&self) -> Option<u32> {
        None
    }
}
