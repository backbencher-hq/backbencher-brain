// R13 (rust extreme review): the declared-type reference graph — the only
// family-standard surface rust lacked (only where-bounds emitted
// references). Every named type mentioned in a parameter type, return
// type, struct/union field type, enum variant field type, const/static
// type or alias right-hand side is a `references` edge. Authored from the
// contract BEFORE the analyzer run.
struct Point {
    x: u32,
    y: u32,
}

struct Holder {
    p: Point,
    cache: Vec<Point>,
}

enum Shape {
    Dot(Point),
    Rect { w: u32, h: Point },
    Empty,
}

type Alias = Option<Point>;

const ORIGIN: Point = Point { x: 0, y: 0 };

fn make(p: Point, extra: Vec<Point>) -> Point {
    p
}

fn plain(x: u32) -> u32 {
    x
}

impl Point {
    fn dup(&self) -> Self {
        Point { x: self.x, y: self.y }
    }
}
