defmodule SelfStruct do
  defstruct [:name]
  def build, do: %__MODULE__{name: "x"}
end

defmodule Outer do
  defmodule Inner do
    defstruct [:v]
    def make, do: %__MODULE__{v: 1}
  end
end

defmodule SelfTestScope do
  defstruct [:id]
  test "builds" do
    _s = %__MODULE__{id: 1}
    _o = %Other{id: 2}
  end
end
