type Event = { type: string; message?: unknown; error?: unknown };

class AssistantMessageEventStream implements AsyncIterable<Event> {
  readonly #queue: Event[] = [];
  readonly #waiting: ((result: IteratorResult<Event>) => void)[] = [];
  #done = false;
  readonly #result: Promise<unknown>;
  #resolveResult: (value: unknown) => void = () => undefined;

  public constructor() {
    this.#result = new Promise((resolve) => {
      this.#resolveResult = resolve;
    });
  }

  public push(event: Event): void {
    if (this.#done) return;
    if (event.type === "done" || event.type === "error") {
      this.#done = true;
      this.#resolveResult(event.type === "done" ? event.message : event.error);
    }
    const waiting = this.#waiting.shift();
    if (waiting) waiting({ value: event, done: false });
    else this.#queue.push(event);
  }

  public end(result?: unknown): void {
    this.#done = true;
    if (result !== undefined) this.#resolveResult(result);
    for (const waiting of this.#waiting.splice(0)) waiting({ value: undefined, done: true });
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<Event> {
    while (true) {
      const queued = this.#queue.shift();
      if (queued) yield queued;
      else if (this.#done) return;
      else {
        const result = await new Promise<IteratorResult<Event>>((resolve) =>
          this.#waiting.push(resolve),
        );
        if (result.done) return;
        yield result.value;
      }
    }
  }

  public result(): Promise<unknown> {
    return this.#result;
  }
}

export const createAssistantMessageEventStream = (): AssistantMessageEventStream =>
  new AssistantMessageEventStream();
