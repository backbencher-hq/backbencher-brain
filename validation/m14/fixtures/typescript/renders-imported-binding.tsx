// RENDERS × IMPORTED BINDING — the claim channel on the JSX edge kind (TS-twin divergence pin).
//
// Renders rows emitted for a component imported from an EXTERNAL package carry
// `metadata.importedBinding` (the store verifies the claim against the file's own import evidence),
// exactly like the javascript twin's emission-time marker. A component imported from a
// PROJECT-LOCAL relative specifier carries NO claim: this lane's ruling is that binding claims are
// only staked on non-project-local specifiers, because a project-local name can be resolved by the
// name model and a claim would displace a possibly-correct binding. The control pins that
// divergence so it cannot change silently.
import { ElButton } from "element-plus"
import Local from "./local"

export function App() {
  return (
    <section>
      <ElButton />
      <Local />
    </section>
  )
}
