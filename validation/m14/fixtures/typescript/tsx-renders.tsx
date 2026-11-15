// tsx-renders — a rendered component is `renders`, not `uses`.
//
// The construct: a JSX element APPLIES a component. `uses` said a name is mentioned in the body,
// which is the wrong claim for `<Widget />`; the owner admitted `renders` (src/ast/types.ts) and
// the relabel is 1:1 — same enclosing-symbol source, same component target, same line.
//
// What is pinned, each with a forbid beside it:
//   1. one row PER ELEMENT (the paired `<Panel>…</Panel>` must produce ONE row, not one per
//      opening tag), inside an enclosing function named `App`;
//   2. a self-closing element produces exactly one row;
//   3. a dashed/qualified component (`Ns.Chart`) keeps its written name (`nested_identifier`);
//   4. lowercase intrinsic tags (`div`, `section`) and fragments produce NO row;
//   5. `React.createElement(Widget, …)` stays a CALL of `createElement` — it is not JSX.
import React from "react"

function Widget(): JSX.Element {
  return <div />
}

function Panel(props: { children?: React.ReactNode }): JSX.Element {
  return <section>{props.children}</section>
}

export function App(): JSX.Element {
  return (
    <Panel>
      <Widget />
      <Ns.Chart />
      <div>text</div>
      <>
        <Widget />
      </>
    </Panel>
  )
}

export const created = React.createElement(Widget, null)
