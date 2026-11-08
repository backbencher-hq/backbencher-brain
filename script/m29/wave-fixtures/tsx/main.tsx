// Wave fixture pack — tsx lane (M29 wave 3). Parsed by the indexer, never built or run.
import { useState } from "react"

export interface GreetingProps {
  name: string
  count: number
}

export function Greeting(props: GreetingProps): JSX.Element {
  return (
    <p className="greeting">
      Hello {props.name}, visitor {props.count}
    </p>
  )
}

export function App(): JSX.Element {
  const [count] = useState(1)
  return (
    <main>
      <Greeting name="wave" count={count} />
    </main>
  )
}
