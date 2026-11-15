defmodule Otp.Messaging do
  @moduledoc """
  Message passing and process spawning. `send/2` and `spawn/1` are Kernel
  auto-imports, so the EX-D2 noise contract keeps them out of the call graph
  (the FP-family builtin rule); what survives is the file-level idiom signal and
  the marker on the QUALIFIED spawn forms, which are ordinary module calls.
  """

  def notify(pid) do
    send(pid, {:ping, System.monotonic_time(:millisecond)})
    :ok
  end

  def in_parallel(list) do
    Task.async(fn -> Enum.count(list) end)
  end

  def supervised do
    Agent.start_link(fn -> %{count: 0} end)
  end

  def spawned do
    spawn_link(fn -> :ok end)
  end
end
