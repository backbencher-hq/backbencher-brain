// renders-component-order.rs — pins the TWO defects the 2026-11-20 master review found in rust's
// `renders` emission, and the rule each one is now held to.
//
// DEFECT 1 — THE BARE-HTML TEST LOWERCASED THE TAG.
//   The guard read `BARE_HTML.has(tag.toLowerCase())`, so any component whose PascalCase name
//   lowercases to an HTML tag was refused as "a bare HTML tag": Button, Form, Label, Header,
//   Main, Section, Nav, Select, Option, Template, Canvas, Table, Path, Input, Footer, Article,
//   Aside. `view! { <Button/> }` published NO renders row at all. The impostor class the guard
//   exists to stop is lowercase in every UI framework (`<div>`, `<span>`); Rust components are
//   PascalCase. The test now reads the WRITTEN SPELLING, so `div` is still refused and `Button`
//   is not.
//
// DEFECT 2 — THE COMPONENT TEST RAN DURING THE WALK.
//   "Does this file declare the tag?" was asked at the render site, so a component declared
//   BELOW its use was not yet in the symbol table and the emission silently depended on
//   declaration order. The test is now deferred until the symbol table is complete, the same
//   shape `pendingInstantiations` uses for constructor targets.
//
// WHAT THIS FILE PINS:
//   · `Button` is declared AFTER `App` uses it — the order that used to emit nothing;
//   · a component named `Form` (a second HTML-colliding PascalCase name) is declared BEFORE
//     its use — the order that already worked, kept so the fix cannot regress one half;
//   · a BARE HTML TAG (`<div/>`) still emits nothing — the impostor stop, must-not #1;
//   · an UNDECLARED tag (`<Other/>`) still emits nothing — the same-file test, must-not #2.

fn App() -> u8 {
    view! { <Button/> <Form/> <div/> <Other/> }
    0
}

struct Button;

struct Form;

fn not_a_render() {
    println!("<Button/>");
}