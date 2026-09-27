import type { Provider } from "@earendil-works/pi-ai";
import type { CustomEndpointInput } from "../shared.js";
import { ChatboxService, type ChatboxServiceOptions } from "./service.js";

export type InitialModelConfig = Record<string, Omit<CustomEndpointInput, "id" | "authMode"> & { authMode?: CustomEndpointInput["authMode"] }>;
export interface OAuthAgentConfig { provider: string; preferredMethod?: string }

export interface ChatboxAgentOptions extends Omit<ChatboxServiceOptions, "providers" | "oauthLogin"> {
  /** Additional built-in or host-defined providers. */
  providers?: readonly (string | Provider)[];
  /** Provider-keyed JSON. Initial entries are installed as APP models on first start. */
  modelConfig?: InitialModelConfig;
  /** Built-in Pi OAuth providers and optional preferred login method. */
  oauth?: readonly OAuthAgentConfig[];
}

/** Host entry point: initialize Pi providers, then pass `service` to the HTTP handler. */
export class ChatboxAgent {
  readonly service: ChatboxService;
  readonly ready: Promise<void>;

  constructor(options: ChatboxAgentOptions) {
    const { modelConfig, oauth = [], providers = [], ...serviceOptions } = options;
    const selected = new Map<string, string | Provider>();
    for (const provider of [...providers, ...oauth.map((entry) => entry.provider)]) selected.set(typeof provider === "string" ? provider : provider.id, provider);
    this.service = new ChatboxService({
      ...serviceOptions,
      providers: [...selected.values()],
      allowCustomProviders: true,
      oauthLogin: Object.fromEntries(oauth.map(({ provider, preferredMethod }) => [provider, { preferredMethod }])),
    });
    this.ready = this.installInitialModels(modelConfig ?? {});
  }

  private async installInitialModels(config: InitialModelConfig): Promise<void> {
    const bootstrap = { userId: "__chatbox_bootstrap__" };
    for (const [id, entry] of Object.entries(config)) {
      const existing = await this.service.getSettings(bootstrap);
      if (existing.app.customProviders?.some((provider) => provider.id === id)) continue;
      await this.service.upsertCustomProvider(bootstrap, "app", {
        ...entry,
        id,
        authMode: entry.authMode ?? "api-key",
      });
    }
  }
}
