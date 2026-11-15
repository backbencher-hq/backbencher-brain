import { createService } from "./service"

export function UserView(): JSX.Element {
  const service = createService()
  return <section data-name={service.format("Ada")}>User</section>
}
