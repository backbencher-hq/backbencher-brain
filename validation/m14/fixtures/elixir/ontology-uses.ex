# EX-EX3 — `uses`: a member READ that names a declared struct field. The
# grammar shapes `user.id` and `user.sign_up()` identically (a `call` whose
# target is a `dot`), and `opts.domain` — a map key — parses the same way again.
# The edge is published only when the leaf is a field some struct in this file
# declares, so a published target is always a real Property symbol.
defmodule OntoUser do
  defstruct [:id, :name]
end

defmodule OntoUses do
  def show(u), do: u.name
  def ident(u), do: u.id
  def chained(u), do: u.profile.name
  def map_read(m), do: m.domain
  # EX-EX12: the receiver is bound to a MAP, so `m.id` is a MAP KEY read even
  # though `id` IS a declared struct field in this file. The declared-field gate
  # alone published it; the corpus case is `datetime.ex:2063`
  # (`defp from_map(%{} = datetime_map)` reading `datetime_map.day`).
  def map_bound_read(%{} = m), do: m.id
  def struct_bound_read(%OntoUser{} = u), do: u.id
  def method_call(u), do: u.hello()
  def module_read, do: OntoUses.name
  def literal_read, do: %OntoUser{}.name
  def tuple_read, do: elem({1}, 0)
end
