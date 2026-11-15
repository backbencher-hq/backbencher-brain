import React, { useState } from "react";

interface ButtonProps {
  label: string;
}

export function Button({ label }: ButtonProps) {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{label}: {count}</button>;
}
