// Clock — injectable time source so order timestamps are deterministic in
// tests and reproducible in demos.

export interface Clock {
  now(): Date
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }
}
