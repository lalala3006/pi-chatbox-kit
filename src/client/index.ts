import type { AppSettings, ChatEvent, ChatImage, ConfirmationRequest, ConversationSnapshot, ConversationSummary, CredentialScope, CredentialStatus, CustomEndpointConfig, CustomEndpointInput, LoginStatus, ModelCheckResult, ModelInfo, ModelRef, UserSettings } from "../shared.js";
export * from "../shared.js";

export interface ChatboxClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  eventSource?: typeof EventSource;
}

export class ChatboxClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly eventSource: typeof EventSource | undefined;

  constructor(options: ChatboxClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.eventSource = options.eventSource ?? (typeof EventSource === "undefined" ? undefined : EventSource);
  }
  private async request<T>(path: string, method = "GET", value?: unknown): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, { method, credentials: "same-origin", headers: value === undefined ? undefined : { "content-type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    return result;
  }
  listModels = () => this.request<ModelInfo[]>("/models");
  testModel = (model: ModelRef) => this.request<ModelCheckResult>("/models/test", "POST", { model });
  listConversations = () => this.request<ConversationSummary[]>("/conversations");
  createConversation = (model?: ModelRef) => this.request<ConversationSnapshot>("/conversations", "POST", { model });
  getConversation = (id: string) => this.request<ConversationSnapshot>(`/conversations/${encodeURIComponent(id)}`);
  setModel = (id: string, model: ModelRef) => this.request<ConversationSnapshot>(`/conversations/${encodeURIComponent(id)}/model`, "PATCH", { model });
  cancel = (id: string) => this.request<{ ok: true }>(`/conversations/${encodeURIComponent(id)}/cancel`, "POST");
  retry = (id: string) => this.request<ConversationSnapshot>(`/conversations/${encodeURIComponent(id)}/retry`, "POST");
  confirm = (input: { requestId: string; value: Record<string, unknown> }) => this.request<ConfirmationRequest>(`/confirmations/${encodeURIComponent(input.requestId)}`, "POST", { type: "confirm", value: input.value });
  reject = (input: { requestId: string }) => this.request<ConfirmationRequest>(`/confirmations/${encodeURIComponent(input.requestId)}`, "POST", { type: "reject" });
  send = async (id: string, input: { text: string; images?: (File | ChatImage)[] }) => {
    const images = await Promise.all((input.images ?? []).map(async (image): Promise<ChatImage> => {
      if (typeof File === "undefined") {
        if ("dataUrl" in image) return image;
        throw new Error("File input requires a browser File implementation");
      }
      if (!(image instanceof File)) return image;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(image);
      });
      return { dataUrl, mimeType: image.type, fileName: image.name };
    }));
    return this.request<ConversationSnapshot>(`/conversations/${encodeURIComponent(id)}/messages`, "POST", { text: input.text, images });
  };
  subscribe(id: string, listener: (event: ChatEvent) => void, onError?: (error: Event) => void): () => void {
    if (!this.eventSource) throw new Error("EventSource is unavailable");
    const source = new this.eventSource(`${this.baseUrl}/conversations/${encodeURIComponent(id)}/events`, { withCredentials: true });
    source.onmessage = (event) => listener(JSON.parse(event.data) as ChatEvent);
    if (onError) source.onerror = onError;
    return () => source.close();
  }
  credentials = {
    getStatus: () => this.request<CredentialStatus[]>("/credentials/status"),
    setApiKey: (input: { provider: string; scope: CredentialScope; apiKey: string }) => this.request<{ ok: true }>(`/credentials/${input.scope}/${encodeURIComponent(input.provider)}`, "PUT", { apiKey: input.apiKey }),
    disconnect: (provider: string, scope: CredentialScope = "user") => this.request<{ ok: true }>(`/credentials/${scope}/${encodeURIComponent(provider)}`, "DELETE"),
    setPreferredSource: async (input: { provider: string; source: CredentialScope }) => this.settings.update({ scope: "user", preferredSources: { [input.provider]: input.source } }),
    startLogin: (provider: string) => this.request<LoginStatus>(`/auth/${encodeURIComponent(provider)}`, "POST"),
    getLoginStatus: (flowId: string) => this.request<LoginStatus>(`/auth/flows/${encodeURIComponent(flowId)}`),
    answerLoginPrompt: (flowId: string, value: string) => this.request<LoginStatus>(`/auth/flows/${encodeURIComponent(flowId)}/answer`, "POST", { value }),
    cancelLogin: (flowId: string) => this.request<LoginStatus>(`/auth/flows/${encodeURIComponent(flowId)}`, "DELETE"),
  };
  customProviders = {
    list: () => this.request<{ user: CustomEndpointConfig[]; app: CustomEndpointConfig[] }>("/custom-providers"),
    save: (scope: CredentialScope, config: CustomEndpointInput) => this.request<CustomEndpointConfig>(`/custom-providers/${scope}/${encodeURIComponent(config.id)}`, "PUT", config),
    delete: (scope: CredentialScope, id: string) => this.request<{ ok: true }>(`/custom-providers/${scope}/${encodeURIComponent(id)}`, "DELETE"),
  };
  settings = {
    get: () => this.request<{ user: UserSettings; app: AppSettings; capabilities: { allowCustomBaseUrl: boolean; allowCustomProviders: boolean; oauthProviders: Array<{ id: string; name: string }> } }>("/settings"),
    update: (input: { scope: "user" } & Partial<UserSettings> | { scope: "app" } & Partial<AppSettings>) => {
      const { scope, ...patch } = input;
      return this.request<{ user: UserSettings; app: AppSettings; capabilities: { allowCustomBaseUrl: boolean; allowCustomProviders: boolean; oauthProviders: Array<{ id: string; name: string }> } }>(`/settings/${scope}`, "PATCH", patch);
    },
  };
}

export function createChatboxClient(options: ChatboxClientOptions): ChatboxClient { return new ChatboxClient(options); }
