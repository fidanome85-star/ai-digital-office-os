export class PolicyEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyEngineError";
  }
}
