// Minimal TSX fixture for the M12 language-coverage gate.
//
// `tsx` is its own key in SUPPORTED_LANGUAGES with its own grammar, separate from
// `typescript`. validation/m12/fixtures/typescript/ holds only `.ts` files, so
// without this fixture the tsx grammar could be unreachable and nothing in-tree
// would say so. A class component and a function component: both named.

import * as React from "react"

export interface PanelProps {
  title: string
}

export function Panel(props: PanelProps): JSX.Element {
  return (
    <section className="panel">
      <h1>{props.title}</h1>
    </section>
  )
}

export class PanelView extends React.Component<PanelProps> {
  render(): JSX.Element {
    return <Panel title={this.props.title} />
  }
}
