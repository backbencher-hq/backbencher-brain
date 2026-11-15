// renders-component-tag.rs — pins rust's `renders` R3 emission, CORPUS-UNEXERCISED class (2026-10-23).
//
// THE SHAPE SURVIVES THE GRAMMAR AS REAL NODES (probe-measured, hasError:false): the UI
// framework macros (leptos view!, yew html!, dioxus rsx!…) parse to a macro_invocation whose
// token_tree carries the TAG IDENTIFIERS — the component names — as structural children. The
// corpus measured 0 of 2,532 files exercising it (0 render macros, 0 UI-framework manifests),
// so this is csharp's class: IMPLEMENTED AND CORPUS-UNEXERCISED, counted once inside
// implemented — never an exclusion.
//
// THE MUST-NOTS, each pinned by an equals: 0:
//   · the macro must be in the DECLARED render list — a plain println! with a `<` in a string
//     is not a render host (the dart impostor lesson);
//   · a BARE HTML TAG (`<div/>`) renders a value, not a component, and emits nothing;
//   · a tag with NO SAME-FILE SYMBOL behind it (Other, undeclared here) is refused and
//     counted — clojure's impostor-stopping test.

struct MyButton {
    label: String,
}

fn App() -> u8 {
    view! { <MyButton label="hi"/> <div/> <Other/> }
    0
}

fn not_a_render() {
    println!("<not-a-tag>");
}
