type Mapped<T> = { [K in keyof T]: T[K] };
type Plain<T> = { value: T };
