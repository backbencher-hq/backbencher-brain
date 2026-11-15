// The SECOND declaration of `Twice`, in another file of the same project. The once-question must
// answer 2 here, and the analyzer must then REFUSE to re-spell the consumer's import to a bare
// `Twice` — a re-spelling would pick one of the two, i.e. a stranger, with full confidence.
export interface Twice {
  b: number;
}
