defmodule MacroHead do
  defmacro defstruct(fields) do
    quote bind_quoted: [fields: fields] do
      fields
    end
  end
end

defmodule RealStruct do
  defstruct [:title]
end
