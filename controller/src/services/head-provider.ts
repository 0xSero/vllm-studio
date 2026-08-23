import type {
  ProviderAuthType,
  ProviderLoginJobView,
  ProviderView,
} from "@local-studio/contracts/provider-auth";

export type HeadProviderModel = {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  vision: boolean;
};

export type HeadProviderCompletion = {
  response: Record<string, unknown>;
  status: number;
};

export type HeadProviderResponse = {
  response: Response;
  completion: Promise<HeadProviderCompletion | null>;
};

export type HeadProviderCatalog = {
  providerId: string;
  models: HeadProviderModel[];
};

export interface HeadProviderAdapter {
  readonly id: string;
  view(): Promise<ProviderView>;
  models(): Promise<HeadProviderModel[]>;
  startLogin(authType: ProviderAuthType): string;
  loginJob(jobId: string, after?: number): ProviderLoginJobView | null;
  respond(jobId: string, promptId: number, value: string): boolean;
  cancel(jobId: string): boolean;
  logout(): Promise<void>;
  responses(
    modelId: string,
    request: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<HeadProviderResponse>;
  shutdown(): void;
}

export class HeadProviderService {
  readonly #providers: ReadonlyMap<string, HeadProviderAdapter>;

  public constructor(providers: readonly HeadProviderAdapter[]) {
    this.#providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  #provider(providerId: string): HeadProviderAdapter {
    const provider = this.#providers.get(providerId);
    if (!provider) throw new Error(`Unknown Head model provider '${providerId}'`);
    return provider;
  }

  public list(): Promise<ProviderView[]> {
    return Promise.all(
      [...this.#providers.values()].map((provider) => provider.view().catch(() => null)),
    ).then((views) => views.filter((view): view is ProviderView => view !== null));
  }

  public models(providerId: string): Promise<HeadProviderModel[]> {
    return this.#provider(providerId).models();
  }

  public catalogs(): Promise<HeadProviderCatalog[]> {
    return Promise.all(
      [...this.#providers.values()].map((provider) =>
        provider
          .models()
          .then((models) => ({ providerId: provider.id, models }))
          .catch(() => ({ providerId: provider.id, models: [] })),
      ),
    );
  }

  public startLogin(providerId: string, authType: ProviderAuthType): string {
    return this.#provider(providerId).startLogin(authType);
  }

  public loginJob(providerId: string, jobId: string, after = 0): ProviderLoginJobView | null {
    return this.#provider(providerId).loginJob(jobId, after);
  }

  public respond(providerId: string, jobId: string, promptId: number, value: string): boolean {
    return this.#provider(providerId).respond(jobId, promptId, value);
  }

  public cancel(providerId: string, jobId: string): boolean {
    return this.#provider(providerId).cancel(jobId);
  }

  public logout(providerId: string): Promise<void> {
    return this.#provider(providerId).logout();
  }

  public responses(
    providerId: string,
    modelId: string,
    request: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<HeadProviderResponse> {
    return this.#provider(providerId).responses(modelId, request, signal);
  }

  public has(providerId: string): boolean {
    return this.#providers.has(providerId);
  }

  public shutdown(): void {
    for (const provider of this.#providers.values()) provider.shutdown();
  }
}
