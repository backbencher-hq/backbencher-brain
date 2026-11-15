defmodule TaskError do
  defexception [:task, :message, mix: true]
end

defmodule MessageError do
  defexception message: "oops"
end
