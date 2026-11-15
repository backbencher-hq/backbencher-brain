// RUST-D24: a route attribute is an `exports` relationship — the callee is a URL,
// not a symbol. The framework GUARD knew six actix verbs (get, post, put, delete,
// head, patch) while the path EXTRACTOR knew four (get, post, put, delete), so
// `#[head(…)]` and `#[patch(…)]` were recognised as actix and then produced no
// route at all. `options`, `trace` and actix's older `#[route("/p", method="GET")]`
// were missing from both. Four of the five routes below were silently dropped.
//
// Both sides now read ONE list, and the match requires `(` or whitespace after the
// verb — so the negative controls at the bottom must NOT produce a route.

#[get("/users")]
async fn list_users() -> String {
    String::new()
}

#[post("/users")]
async fn create_user() -> String {
    String::new()
}

#[patch("/users/{id}")]
async fn update_user() -> String {
    String::new()
}

#[delete("/users/{id}")]
async fn delete_user() -> String {
    String::new()
}

#[head("/ping")]
async fn ping() -> String {
    String::new()
}

#[options("/cors")]
async fn cors() -> String {
    String::new()
}

// the generic spelling: the route is the FIRST string literal, the method is the second
#[route("/legacy", method = "GET")]
async fn legacy() -> String {
    String::new()
}

// NEGATIVE CONTROLS — none of these may yield a route.
// `#[getter]` starts with `#[get` as a bare prefix, which is exactly how a
// startsWith-based guard used to claim actix and a prefix-matching extractor used
// to read a path out of an attribute that declares none.
#[getter]
fn not_a_route() -> String {
    String::new()
}

#[cfg(feature = "x")]
fn also_not_a_route() -> String {
    String::new()
}

pub struct Service;