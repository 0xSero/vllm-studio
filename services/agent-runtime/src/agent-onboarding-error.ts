export class AgentOnboardingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
