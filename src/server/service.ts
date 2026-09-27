import { randomUUID } from "node:crypto";
import { Agent, type AgentEvent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createModels, type CredentialStore, type Model, type Provider, type ImageContent } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { AppSettings, ChatEvent, ChatImage, ConversationSnapshot, ConversationSummary, CredentialPolicy, CredentialScope, CredentialStatus, CustomEndpointConfig, LoginStatus, ModelInfo, ModelRef, ModelCheckResult, Principal, UserSettings, ConfirmationPresentation, ConfirmationRequest } from "../shared.js";
import type { ChatboxStore, CredentialRef, StoredConversation } from "./storage.js";
import { createCustomProvider, customProviderId, normalizeCustomEndpoint } from "./custom-provider.js";

export interface ConfirmationDefinition<T extends TSchema = TSchema> {
  id: string;
  description: string;
  inputSchema: T;
  presentation: ConfirmationPresentation;
  authorize?: (context: { value: Static<T>; principal: Principal; conversationId: string }) => Promise<boolean> | boolean;
  onConfirm: (context: { value: Static<T>; principal: Principal; conversationId: string; idempotencyKey: string }) => Promise<unknown>;
}

export function defineConfirmation<T extends TSchema>(definition: ConfirmationDefinition<T>): ConfirmationDefinition<T> { return definition; }

export interface ChatboxServiceOptions {
  appId: string;
  providers: readonly (string | Provider)[];
  defaultModel: ModelRef;
  credentialPolicies: Record<string, CredentialPolicy>;
  storage: ChatboxStore;
  confirmations?: readonly ConfirmationDefinition[];
  systemPrompt?: string | ((context: { principal: Principal; conversationId: string }) => string | Promise<string>);
  imageLimits?: { maxCount?: number; maxBytes?: number; mimeTypes?: readonly string[] };
  allowCustomBaseUrl?: boolean;
  allowCustomProviders?: boolean;
  oauthLogin?: Record<string, { preferredMethod?: string }>;
}

type Gate = { resolve: (result: string) => void; definition: ConfirmationDefinition; userId: string; conversationId: string };
type LiveRun = { agent: Agent; userId: string; conversation: StoredConversation };
type LoginFlow = { userId: string; status: LoginStatus; controller: AbortController; pending?: { resolve: (value: string) => void; reject: (error: Error) => void } };
type ResolvedProvider = { provider: Provider; scope?: CredentialScope; config?: CustomEndpointConfig };

export class ChatboxService {
  private readonly providers = new Map<string, Provider>();
  private readonly confirmations = new Map<string, ConfirmationDefinition>();
  private readonly active = new Map<string, LiveRun>();
  private readonly gates = new Map<string, Gate>();
  private readonly deciding = new Set<string>();
  private readonly listeners = new Map<string, Set<(event: ChatEvent) => void>>();
  private readonly logins = new Map<string, LoginFlow>();

  constructor(readonly options: ChatboxServiceOptions) {
    const builtins = new Map(builtinProviders().map((provider) => [provider.id, provider]));
    for (const item of options.providers) {
      const provider = typeof item === "string" ? builtins.get(item) : item;
      if (!provider) throw new Error(`Unknown provider: ${item}`);
      if (provider.id.startsWith("custom-user-") || provider.id.startsWith("custom-app-")) throw new Error("Custom provider IDs are reserved");
      this.providers.set(provider.id, provider);
    }
    for (const definition of options.confirmations ?? []) {
      if (this.confirmations.has(definition.id)) throw new Error(`Duplicate confirmation: ${definition.id}`);
      this.confirmations.set(definition.id, definition);
    }
    if (this.providers.has("openai-codex") && this.policy("openai-codex").mode !== "user-only") throw new Error("openai-codex must use user-only credentials");
    if (!this.providers.has(options.defaultModel.provider) && !options.defaultModel.provider.startsWith("custom-app-")) throw new Error("Default model provider is not enabled");
  }

  private key(userId: string, conversationId: string) { return JSON.stringify([userId, conversationId]); }
  private publish(conversation: StoredConversation, event: ChatEvent) {
    for (const listener of this.listeners.get(this.key(conversation.userId, conversation.id)) ?? []) listener(event);
  }
  private snapshot(conversation: StoredConversation): ConversationSnapshot {
    const { appId: _appId, userId: _userId, history: _history, ...snapshot } = conversation;
    return structuredClone(snapshot);
  }
  private async save(conversation: StoredConversation) {
    conversation.updatedAt = Date.now();
    await this.options.storage.saveConversation(conversation);
  }
  private policy(provider: string): CredentialPolicy { return this.options.credentialPolicies[provider] ?? { mode: "user-only" }; }
  private async allProviders(userId: string): Promise<ResolvedProvider[]> {
    const user = await this.options.storage.getUserSettings(this.options.appId, userId);
    const app = await this.options.storage.getAppSettings(this.options.appId);
    return [
      ...[...this.providers.values()].map((provider) => ({ provider })),
      ...(app.customProviders ?? []).map((config) => ({ provider: createCustomProvider(config, "app"), scope: "app" as const, config })),
      ...(user.customProviders ?? []).map((config) => ({ provider: createCustomProvider(config, "user"), scope: "user" as const, config })),
    ];
  }
  private async resolveProvider(providerId: string, userId: string): Promise<ResolvedProvider | undefined> {
    return (await this.allProviders(userId)).find((item) => item.provider.id === providerId);
  }
  private ref(provider: string, scope: CredentialScope, userId: string): CredentialRef {
    return { appId: this.options.appId, provider, scope, ...(scope === "user" ? { userId } : {}) };
  }
  private async source(provider: string, userId: string): Promise<CredentialScope | undefined> {
    const resolved = await this.resolveProvider(provider, userId);
    if (!resolved) return undefined;
    if (resolved.config && resolved.scope) {
      if (resolved.config.authMode === "none") return resolved.scope;
      return await this.options.storage.readCredential(this.ref(provider, resolved.scope, userId)) ? resolved.scope : undefined;
    }
    const policy = this.policy(provider);
    if (provider === "openai-codex" && policy.mode !== "user-only") throw new Error("openai-codex must use user-only credentials");
    const user = policy.mode !== "app-only" && !!(await this.options.storage.readCredential(this.ref(provider, "user", userId)));
    const app = policy.mode !== "user-only" && !!(await this.options.storage.readCredential(this.ref(provider, "app", userId)));
    if (policy.mode === "user-only") return user ? "user" : undefined;
    if (policy.mode === "app-only") return app ? "app" : undefined;
    const settings = await this.options.storage.getUserSettings(this.options.appId, userId);
    const preferred = settings.preferredSources?.[provider] ?? policy.defaultSource ?? "user";
    return preferred === "user" ? (user ? "user" : app ? "app" : undefined) : (app ? "app" : user ? "user" : undefined);
  }
  private async modelsFor(provider: string, userId: string, scope: CredentialScope) {
    const resolved = await this.resolveProvider(provider, userId);
    if (!resolved) throw new Error("Provider is not enabled");
    const models = createModels({
      credentials: this.credentialStore(this.ref(provider, scope, userId)),
      authContext: { env: async () => undefined, fileExists: async () => false },
    });
    models.setProvider(resolved.provider);
    return models;
  }
  private credentialStore(ref: CredentialRef): CredentialStore {
    const storage = this.options.storage;
    return {
      read: (providerId) => storage.readCredential({ ...ref, provider: providerId }),
      list: () => storage.listCredentials(ref.appId, ref.scope, ref.userId),
      modify: (providerId, fn) => storage.modifyCredential({ ...ref, provider: providerId }, fn),
      delete: (providerId) => storage.deleteCredential({ ...ref, provider: providerId }),
    };
  }
  private async validateModel(ref: ModelRef, userId: string): Promise<Model<any>> {
    const resolved = await this.resolveProvider(ref.provider, userId);
    if (!resolved) throw new Error("Provider is not enabled");
    const app = await this.options.storage.getAppSettings(this.options.appId);
    if (app.allowedModels?.length && !app.allowedModels.some((entry) => entry.provider === ref.provider && entry.modelId === ref.modelId)) throw new Error("Model is not allowed");
    const model = resolved.provider.getModels().find((entry) => entry.id === ref.modelId);
    if (!model) throw new Error("Model is not available");
    return model;
  }
  async listModels(principal: Principal, canManageApp = false): Promise<ModelInfo[]> {
    const app = await this.options.storage.getAppSettings(this.options.appId);
    const result: ModelInfo[] = [];
    for (const { provider } of await this.allProviders(principal.userId)) {
      const configured = !!(await this.source(provider.id, principal.userId));
      for (const model of provider.getModels()) {
        const allowed = !app.allowedModels?.length || app.allowedModels.some((ref) => ref.provider === provider.id && ref.modelId === model.id);
        if (!allowed && !canManageApp) continue;
        result.push({ provider: provider.id, providerName: provider.name, modelId: model.id, name: model.name, inputCapabilities: model.input, reasoning: model.reasoning, configured, allowed });
      }
    }
    return result;
  }
  async getSettings(principal: Principal) {
    return { user: await this.options.storage.getUserSettings(this.options.appId, principal.userId), app: await this.options.storage.getAppSettings(this.options.appId), capabilities: { allowCustomBaseUrl: !!this.options.allowCustomBaseUrl, allowCustomProviders: !!this.options.allowCustomProviders, oauthProviders: [...this.providers.values()].filter((provider) => provider.auth.oauth && this.policy(provider.id).mode !== "app-only").map((provider) => ({ id: provider.id, name: provider.name })) } };
  }
  async upsertCustomProvider(principal: Principal, scope: CredentialScope, input: unknown): Promise<CustomEndpointConfig> {
    if (!this.options.allowCustomProviders) throw new Error("Custom providers are disabled");
    const config = normalizeCustomEndpoint(input);
    const rawKey = (input as { apiKey?: unknown }).apiKey;
    if (rawKey && config.authMode !== "api-key") throw new Error("API key requires API-key authentication");
    const apiKey = typeof rawKey === "string" ? rawKey.trim() : "";
    const providerId = customProviderId(scope, config.id);
    if (scope === "user") {
      const settings = await this.options.storage.getUserSettings(this.options.appId, principal.userId);
      const defaultModel = settings.defaultModel?.provider === providerId && !config.models.some((model) => model.id === settings.defaultModel!.modelId)
        ? { provider: providerId, modelId: config.models[0]!.id } : settings.defaultModel;
      const customProviders = (settings.customProviders ?? []).filter((item) => item.id !== config.id);
      customProviders.push(config);
      await this.options.storage.setUserSettings(this.options.appId, principal.userId, { ...settings, customProviders, defaultModel });
    } else {
      const settings = await this.options.storage.getAppSettings(this.options.appId);
      const effectiveDefault = settings.defaultModel ?? this.options.defaultModel;
      const defaultModel = effectiveDefault.provider === providerId && !config.models.some((model) => model.id === effectiveDefault.modelId)
        ? { provider: providerId, modelId: config.models[0]!.id } : settings.defaultModel;
      const allowedModels = settings.allowedModels?.filter((ref) => ref.provider !== providerId || config.models.some((model) => model.id === ref.modelId));
      const nextDefault = defaultModel ?? effectiveDefault;
      if (settings.allowedModels?.length && !allowedModels?.some((ref) => ref.provider === nextDefault.provider && ref.modelId === nextDefault.modelId)) allowedModels?.push(nextDefault);
      const customProviders = (settings.customProviders ?? []).filter((item) => item.id !== config.id);
      customProviders.push(config);
      await this.options.storage.setAppSettings(this.options.appId, { ...settings, customProviders, defaultModel, allowedModels });
    }
    if (config.authMode === "none") await this.options.storage.deleteCredential(this.ref(providerId, scope, principal.userId));
    else if (apiKey) await this.setApiKey(principal, providerId, scope, apiKey);
    return config;
  }
  async deleteCustomProvider(principal: Principal, scope: CredentialScope, id: string): Promise<void> {
    if (!this.options.allowCustomProviders) throw new Error("Custom providers are disabled");
    const providerId = customProviderId(scope, id);
    if (scope === "user") {
      const settings = await this.options.storage.getUserSettings(this.options.appId, principal.userId);
      if (!settings.customProviders?.some((item) => item.id === id)) throw new Error("Custom provider not found");
      await this.options.storage.setUserSettings(this.options.appId, principal.userId, { ...settings, customProviders: settings.customProviders.filter((item) => item.id !== id), defaultModel: settings.defaultModel?.provider === providerId ? undefined : settings.defaultModel });
    } else {
      const settings = await this.options.storage.getAppSettings(this.options.appId);
      if (!settings.customProviders?.some((item) => item.id === id)) throw new Error("Custom provider not found");
      await this.options.storage.setAppSettings(this.options.appId, { ...settings, customProviders: settings.customProviders.filter((item) => item.id !== id), defaultModel: settings.defaultModel?.provider === providerId ? undefined : settings.defaultModel, allowedModels: settings.allowedModels?.filter((ref) => ref.provider !== providerId) });
    }
    await this.options.storage.deleteCredential(this.ref(providerId, scope, principal.userId));
  }
  private validateBaseUrls(baseUrls: Record<string, string> | undefined) {
    if (!baseUrls) return;
    if (!this.options.allowCustomBaseUrl) throw new Error("Custom base URLs are disabled");
    for (const [provider, value] of Object.entries(baseUrls)) {
      if (!this.providers.has(provider)) throw new Error("Provider is not enabled");
      if (!value) continue;
      let url: URL;
      try { url = new URL(value); } catch { throw new Error("Invalid base URL"); }
      if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password) throw new Error("Invalid base URL");
    }
  }
  async updateSettings(principal: Principal, scope: CredentialScope, patch: UserSettings | AppSettings) {
    if (patch.defaultModel) {
      if (scope === "app" && patch.defaultModel.provider.startsWith("custom-user-")) throw new Error("APP default model cannot use a personal provider");
      await this.validateModel(patch.defaultModel, principal.userId);
    }
    if (scope === "user") {
      const old = await this.options.storage.getUserSettings(this.options.appId, principal.userId);
      const userPatch = patch as UserSettings;
      if (userPatch.preferredSources) for (const [provider, source] of Object.entries(userPatch.preferredSources)) {
        if (!this.providers.has(provider) || this.policy(provider).mode !== "user-or-app" || !["user", "app"].includes(source)) throw new Error("Invalid credential source");
      }
      this.validateBaseUrls(userPatch.baseUrls);
      await this.options.storage.setUserSettings(this.options.appId, principal.userId, {
        ...old,
        ...(userPatch.defaultModel ? { defaultModel: userPatch.defaultModel } : {}),
        ...(userPatch.preferredSources ? { preferredSources: { ...old.preferredSources, ...userPatch.preferredSources } } : {}),
        ...(userPatch.baseUrls ? { baseUrls: { ...old.baseUrls, ...userPatch.baseUrls } } : {}),
      });
    } else {
      const appPatch = patch as AppSettings;
      this.validateBaseUrls(appPatch.baseUrls);
      if (appPatch.allowedModels) for (const ref of appPatch.allowedModels) {
        if (ref.provider.startsWith("custom-user-")) throw new Error("APP model list cannot contain personal providers");
        if (!(await this.resolveProvider(ref.provider, principal.userId))?.provider.getModels().some((model) => model.id === ref.modelId)) throw new Error("Invalid allowed model");
      }
      const old = await this.options.storage.getAppSettings(this.options.appId);
      const allowed = appPatch.allowedModels ?? old.allowedModels;
      const defaultModel = appPatch.defaultModel ?? old.defaultModel ?? this.options.defaultModel;
      if (allowed?.length && !allowed.some((ref) => ref.provider === defaultModel.provider && ref.modelId === defaultModel.modelId)) throw new Error("Default model must be allowed");
      await this.options.storage.setAppSettings(this.options.appId, {
        ...old,
        ...(appPatch.defaultModel ? { defaultModel: appPatch.defaultModel } : {}),
        ...(appPatch.allowedModels ? { allowedModels: appPatch.allowedModels } : {}),
        ...(appPatch.baseUrls ? { baseUrls: { ...old.baseUrls, ...appPatch.baseUrls } } : {}),
      });
    }
  }
  async credentialStatus(principal: Principal, canManageApp = false): Promise<CredentialStatus[]> {
    return Promise.all((await this.allProviders(principal.userId)).map(async ({ provider: resolved, scope, config }) => {
      const provider = resolved.id;
      const policy: CredentialPolicy = scope ? { mode: scope === "user" ? "user-only" : "app-only" } : this.policy(provider);
      const userConfigured = scope === "user" && config?.authMode === "none" || !!(await this.options.storage.readCredential(this.ref(provider, "user", principal.userId)));
      const appConfigured = scope === "app" && config?.authMode === "none" || !!(await this.options.storage.readCredential(this.ref(provider, "app", principal.userId)));
      const settings = await this.options.storage.getUserSettings(this.options.appId, principal.userId);
      return { provider, policy, userConfigured, appConfigured, effectiveSource: await this.source(provider, principal.userId), preferredSource: settings.preferredSources?.[provider], canManageApp };
    }));
  }
  async setApiKey(principal: Principal, provider: string, scope: CredentialScope, apiKey: string) {
    const resolved = await this.resolveProvider(provider, principal.userId);
    if (!resolved || provider === "openai-codex" || resolved.config?.authMode === "none") throw new Error("Provider does not support API key configuration");
    const policy = resolved.scope ? { mode: resolved.scope === "user" ? "user-only" : "app-only" } : this.policy(provider);
    if (scope === "user" && policy.mode === "app-only" || scope === "app" && policy.mode === "user-only") throw new Error("Credential scope is disabled");
    if (!apiKey.trim()) throw new Error("API key is required");
    await this.options.storage.modifyCredential(this.ref(provider, scope, principal.userId), async () => ({ type: "api_key", key: apiKey.trim() }));
  }
  async deleteCredential(principal: Principal, provider: string, scope: CredentialScope) {
    const resolved = await this.resolveProvider(provider, principal.userId);
    if (!resolved) throw new Error("Provider is not enabled");
    if (resolved.scope && resolved.scope !== scope) throw new Error("Credential scope is disabled");
    await this.options.storage.deleteCredential(this.ref(provider, scope, principal.userId));
  }
  async startLogin(principal: Principal, provider = "openai-codex"): Promise<LoginStatus> {
    const selected = this.providers.get(provider);
    if (!selected?.auth.oauth || this.policy(provider).mode === "app-only") throw new Error("OAuth is not enabled for this provider");
    const flowId = randomUUID();
    const controller = new AbortController();
    const status: LoginStatus = { flowId, provider, status: "waiting" };
    const flow: LoginFlow = { userId: principal.userId, status, controller };
    this.logins.set(flowId, flow);
    const models = await this.modelsFor(provider, principal.userId, "user");
    void models.login(provider, "oauth", {
      signal: controller.signal,
      prompt: async (prompt) => {
        if (prompt.type === "select") {
          const preferred = this.options.oauthLogin?.[provider]?.preferredMethod;
          const match = preferred && prompt.options.find((option) => option.id === preferred || option.id.includes(preferred));
          if (match) return match.id;
        }
        status.prompt = { type: prompt.type, message: prompt.message, ...(prompt.type === "select" ? { options: prompt.options.map(({ id, label }) => ({ id, label })) } : { placeholder: prompt.placeholder }) };
        return new Promise<string>((resolve, reject) => {
          const abort = () => { flow.pending = undefined; delete status.prompt; reject(new Error("Login prompt was cancelled")); };
          flow.pending = { resolve: (value) => { prompt.signal?.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", abort); resolve(value); }, reject };
          prompt.signal?.addEventListener("abort", abort, { once: true });
          controller.signal.addEventListener("abort", abort, { once: true });
          if (prompt.signal?.aborted || controller.signal.aborted) abort();
        });
      },
      notify: (event) => {
        if (event.type === "device_code") Object.assign(status, { userCode: event.userCode, verificationUri: event.verificationUri, expiresAt: Date.now() + (event.expiresInSeconds ?? 900) * 1000 });
        if (event.type === "auth_url") status.authUrl = event.url;
        if (event.type === "info" || event.type === "progress") status.message = event.message;
      },
    }).then(() => { status.status = "success"; delete status.prompt; }).catch((error: unknown) => {
      status.status = controller.signal.aborted ? "cancelled" : "error";
      status.error = error instanceof Error ? error.message : String(error);
      delete status.prompt;
    });
    return structuredClone(status);
  }
  answerLoginPrompt(principal: Principal, flowId: string, value: string): LoginStatus {
    const flow = this.logins.get(flowId);
    if (!flow || flow.userId !== principal.userId || !flow.pending || !flow.status.prompt) throw new Error("Login prompt is unavailable");
    if (typeof value !== "string" || !value.trim() || value.length > 8192) throw new Error("Invalid login answer");
    if (flow.status.prompt.type === "select" && !flow.status.prompt.options?.some((option) => option.id === value)) throw new Error("Invalid login option");
    const pending = flow.pending;
    flow.pending = undefined;
    delete flow.status.prompt;
    pending.resolve(value.trim());
    return structuredClone(flow.status);
  }
  getLoginStatus(principal: Principal, flowId: string): LoginStatus {
    const flow = this.logins.get(flowId);
    if (!flow || flow.userId !== principal.userId) throw new Error("Login flow not found");
    if (flow.status.status === "waiting" && flow.status.expiresAt && flow.status.expiresAt < Date.now()) {
      flow.controller.abort(); flow.status.status = "expired";
    }
    return structuredClone(flow.status);
  }
  cancelLogin(principal: Principal, flowId: string) {
    const flow = this.logins.get(flowId);
    if (!flow || flow.userId !== principal.userId) throw new Error("Login flow not found");
    flow.controller.abort(); flow.status.status = "cancelled";
    flow.pending?.reject(new Error("Login cancelled")); flow.pending = undefined;
    delete flow.status.prompt;
    return structuredClone(flow.status);
  }
  async testModel(principal: Principal, ref: ModelRef): Promise<ModelCheckResult> {
    const model = await this.validateModel(ref, principal.userId);
    const source = await this.source(model.provider, principal.userId);
    if (!source) throw new Error(`No credential configured for ${model.provider}`);
    const models = await this.modelsFor(model.provider, principal.userId, source);
    const settings = await this.getSettings(principal);
    const baseUrl = source === "user" ? settings.user.baseUrls?.[model.provider] : settings.app.baseUrls?.[model.provider];
    const effectiveModel = baseUrl && this.options.allowCustomBaseUrl ? { ...model, baseUrl } : model;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const started = Date.now();
    try {
      const result = await models.completeSimple(effectiveModel, { systemPrompt: "Reply briefly to the user.", messages: [{ role: "user", content: "hello", timestamp: Date.now() }], tools: [] }, { signal: controller.signal, maxTokens: Math.min(128, model.maxTokens) });
      if (result.stopReason === "error") throw new Error(result.errorMessage || "Model returned an error");
      const reply = result.content.filter((item) => item.type === "text").map((item) => item.text).join("").trim();
      if (!reply) throw new Error("Model returned no text reply");
      return { model: ref, connected: true, reply: reply.slice(0, 500), latencyMs: Date.now() - started };
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Model check timed out after 20 seconds");
      throw error;
    } finally { clearTimeout(timer); }
  }
  async createConversation(principal: Principal, modelRef?: ModelRef): Promise<ConversationSnapshot> {
    const settings = await this.getSettings(principal);
    const selected = modelRef ?? settings.user.defaultModel ?? settings.app.defaultModel ?? this.options.defaultModel;
    await this.validateModel(selected, principal.userId);
    const now = Date.now();
    const conversation: StoredConversation = { id: randomUUID(), appId: this.options.appId, userId: principal.userId, title: "新对话", model: selected, status: "idle", messages: [], confirmations: [], history: [], createdAt: now, updatedAt: now };
    await this.save(conversation);
    return this.snapshot(conversation);
  }
  async listConversations(principal: Principal): Promise<ConversationSummary[]> {
    return (await this.options.storage.listConversations(this.options.appId, principal.userId)).map(({ id, title, model, status, createdAt, updatedAt }) => ({ id, title, model, status, createdAt, updatedAt }));
  }
  async getConversation(principal: Principal, id: string): Promise<ConversationSnapshot> {
    const conversation = await this.requireConversation(principal, id);
    let changed = false;
    for (const confirmation of conversation.confirmations) if (confirmation.status === "pending" && !this.gates.has(confirmation.requestId)) { confirmation.status = "expired"; changed = true; }
    if (conversation.status === "running" && !this.active.has(this.key(principal.userId, id))) { conversation.status = "error"; conversation.error = "服务端重启，中断了上次回复"; changed = true; }
    if (changed) await this.save(conversation);
    return this.snapshot(conversation);
  }
  private async requireConversation(principal: Principal, id: string): Promise<StoredConversation> {
    const conversation = await this.options.storage.getConversation(this.options.appId, principal.userId, id);
    if (!conversation) throw new Error("Conversation not found");
    return conversation;
  }
  async setModel(principal: Principal, id: string, model: ModelRef) {
    const conversation = await this.requireConversation(principal, id);
    if (this.active.has(this.key(principal.userId, id))) throw new Error("Conversation is running");
    await this.validateModel(model, principal.userId);
    conversation.model = model;
    await this.save(conversation);
    this.publish(conversation, { type: "snapshot", conversation: this.snapshot(conversation) });
    return this.snapshot(conversation);
  }
  private validateImages(images: ChatImage[], model: Model<any>) {
    if (images.length && !model.input.includes("image")) throw new Error("Selected model does not support images");
    const limits = this.options.imageLimits;
    if (images.length > (limits?.maxCount ?? 5)) throw new Error("Too many images");
    for (const image of images) {
      if (!(limits?.mimeTypes ?? ["image/png", "image/jpeg", "image/webp", "image/gif"]).includes(image.mimeType)) throw new Error("Unsupported image MIME type");
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
      if (!match || match[1] !== image.mimeType) throw new Error("Invalid image data");
      if (Buffer.byteLength(match[2]!, "base64") > (limits?.maxBytes ?? 10 * 1024 * 1024)) throw new Error("Image is too large");
    }
  }
  async send(principal: Principal, id: string, input: { text: string; images?: ChatImage[] }): Promise<ConversationSnapshot> {
    const key = this.key(principal.userId, id);
    if (this.active.has(key)) throw new Error("Conversation is running");
    const conversation = await this.requireConversation(principal, id);
    const model = await this.validateModel(conversation.model, principal.userId);
    const images = input.images ?? [];
    this.validateImages(images, model);
    if (!input.text.trim() && !images.length) throw new Error("Message is empty");
    const source = await this.source(model.provider, principal.userId);
    if (!source) throw new Error(`No credential configured for ${model.provider}`);
    const models = await this.modelsFor(model.provider, principal.userId, source);
    const settings = await this.getSettings(principal);
    const baseUrl = source === "user" ? settings.user.baseUrls?.[model.provider] : settings.app.baseUrls?.[model.provider];
    const effectiveModel = baseUrl && this.options.allowCustomBaseUrl ? { ...model, baseUrl } : model;
    const systemPrompt = typeof this.options.systemPrompt === "function" ? await this.options.systemPrompt({ principal, conversationId: id }) : (this.options.systemPrompt ?? "You are a helpful assistant.");
    const userMessage = { id: randomUUID(), role: "user" as const, text: input.text, images, status: "complete" as const, createdAt: Date.now() };
    conversation.messages.push(userMessage);
    if (conversation.messages.length === 1) conversation.title = input.text.trim().slice(0, 48) || "图片对话";
    conversation.status = "running"; delete conversation.error;
    await this.save(conversation);
    this.publish(conversation, { type: "message", message: userMessage });
    this.publish(conversation, { type: "status", status: "running" });
    const tools = [...this.confirmations.values()].map((definition): AgentTool => ({
      name: definition.id, label: definition.presentation.title, description: definition.description, parameters: definition.inputSchema,
      executionMode: "sequential", replay: "never",
      execute: async (toolCallId, params, signal) => {
        if (!Value.Check(definition.inputSchema, params)) throw new Error("Invalid confirmation proposal");
        const request: ConfirmationRequest = { requestId: randomUUID(), actionId: definition.id, conversationId: id, proposedValue: params as Record<string, unknown>, presentation: definition.presentation, status: "pending", createdAt: Date.now() };
        let resolveOutcome!: (value: string) => void;
        const pending = new Promise<string>((resolve) => { resolveOutcome = resolve; });
        this.gates.set(request.requestId, { resolve: resolveOutcome, definition, userId: principal.userId, conversationId: id });
        try {
          conversation.confirmations.push(request);
          await this.save(conversation);
          this.publish(conversation, { type: "confirmation", confirmation: structuredClone(request) });
        } catch (error) { this.gates.delete(request.requestId); throw error; }
        const onAbort = () => { if (request.status === "pending") { request.status = "expired"; void this.save(conversation); this.publish(conversation, { type: "confirmation", confirmation: structuredClone(request) }); } this.gates.delete(request.requestId); resolveOutcome("Cancelled"); };
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
        const outcome = await pending;
        signal?.removeEventListener("abort", onAbort);
        this.gates.delete(request.requestId);
        return { content: [{ type: "text", text: outcome }], details: { requestId: request.requestId, toolCallId } };
      },
    }));
    const agent = new Agent({ initialState: { systemPrompt, model: effectiveModel, tools, messages: conversation.history }, streamFn: models.streamSimple.bind(models), toolExecution: "sequential" });
    this.active.set(key, { agent, userId: principal.userId, conversation });
    let currentAssistantId: string | undefined;
    agent.subscribe(async (event: AgentEvent) => {
      if (!["message_start", "message_update", "message_end"].includes(event.type) || !("message" in event) || event.message.role !== "assistant") return;
      if (event.type === "message_start") currentAssistantId = randomUUID();
      const messageId = currentAssistantId ?? randomUUID();
      currentAssistantId = messageId;
      const text = event.message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
      const previous = conversation.messages.find((message) => message.id === messageId);
      const next = { id: messageId, role: "assistant" as const, text, images: [], status: event.type === "message_end" ? "complete" as const : "streaming" as const, error: event.message.errorMessage, createdAt: previous?.createdAt ?? Date.now() };
      if (previous) Object.assign(previous, next); else conversation.messages.push(next);
      if (event.type === "message_end") { currentAssistantId = undefined; await this.save(conversation); }
      this.publish(conversation, { type: "message", message: next });
    });
    const piImages: ImageContent[] = images.map((image) => ({ type: "image", data: image.dataUrl.split(",", 2)[1]!, mimeType: image.mimeType }));
    void agent.prompt(input.text, piImages).then(async () => {
      conversation.history = agent.state.messages;
      conversation.status = agent.state.errorMessage ? "error" : "idle";
      conversation.error = agent.state.errorMessage;
      await this.save(conversation);
      this.publish(conversation, { type: "status", status: conversation.status, error: conversation.error });
    }).catch(async (error: unknown) => {
      conversation.status = "error"; conversation.error = error instanceof Error ? error.message : String(error);
      await this.save(conversation);
      this.publish(conversation, { type: "status", status: "error", error: conversation.error });
    }).finally(() => { this.active.delete(key); });
    return this.snapshot(conversation);
  }
  async decide(principal: Principal, requestId: string, decision: { type: "confirm"; value: Record<string, unknown> } | { type: "reject" }): Promise<ConfirmationRequest> {
    const gate = this.gates.get(requestId);
    if (!gate || gate.userId !== principal.userId) throw new Error("Confirmation is unavailable");
    const live = this.active.get(this.key(principal.userId, gate.conversationId));
    if (!live) throw new Error("Conversation is not running");
    const request = live.conversation.confirmations.find((entry) => entry.requestId === requestId)!;
    if (request.status !== "pending" || this.deciding.has(requestId)) throw new Error("Confirmation was already handled");
    if (decision.type === "reject") {
      request.status = "rejected";
      await this.save(live.conversation);
      this.publish(live.conversation, { type: "confirmation", confirmation: structuredClone(request) });
      gate.resolve("User rejected the action.");
      return structuredClone(request);
    }
    this.deciding.add(requestId);
    try {
      if (!Value.Check(gate.definition.inputSchema, decision.value)) throw new Error("Edited confirmation value is invalid");
      if (gate.definition.authorize && !(await gate.definition.authorize({ value: decision.value, principal, conversationId: gate.conversationId }))) throw new Error("Action is not authorized");
      request.status = "executing"; request.finalValue = decision.value;
      await this.save(live.conversation);
      this.publish(live.conversation, { type: "confirmation", confirmation: structuredClone(request) });
      let outcome: string;
      try {
        const result = await gate.definition.onConfirm({ value: decision.value, principal, conversationId: gate.conversationId, idempotencyKey: requestId });
        request.status = "success"; request.result = result;
        outcome = `Action completed: ${JSON.stringify(result)}`;
      } catch (error) {
        request.status = "error"; request.error = error instanceof Error ? error.message : String(error);
        outcome = `Action failed: ${request.error}`;
      }
      await this.save(live.conversation);
      this.publish(live.conversation, { type: "confirmation", confirmation: structuredClone(request) });
      gate.resolve(outcome);
      return structuredClone(request);
    } finally { this.deciding.delete(requestId); }
  }
  async cancel(principal: Principal, id: string) {
    await this.requireConversation(principal, id);
    this.active.get(this.key(principal.userId, id))?.agent.abort();
  }
  async retry(principal: Principal, id: string): Promise<ConversationSnapshot> {
    const conversation = await this.requireConversation(principal, id);
    if (conversation.status !== "error" || this.active.has(this.key(principal.userId, id))) throw new Error("No failed turn to retry");
    const lastUserIndex = conversation.messages.findLastIndex((message) => message.role === "user");
    if (lastUserIndex < 0) throw new Error("No failed turn to retry");
    const lastUser = conversation.messages[lastUserIndex]!;
    if (conversation.confirmations.some((confirmation) => confirmation.createdAt >= lastUser.createdAt)) throw new Error("Turns with confirmation actions cannot be retried automatically");
    const lastHistoryUser = conversation.history.findLastIndex((message) => message.role === "user");
    if (lastHistoryUser >= 0) conversation.history = conversation.history.slice(0, lastHistoryUser);
    conversation.messages = conversation.messages.slice(0, lastUserIndex);
    conversation.status = "idle"; delete conversation.error;
    await this.save(conversation);
    this.publish(conversation, { type: "snapshot", conversation: this.snapshot(conversation) });
    return this.send(principal, id, { text: lastUser.text, images: lastUser.images });
  }
  async subscribe(principal: Principal, id: string, listener: (event: ChatEvent) => void): Promise<() => void> {
    const snapshot = await this.getConversation(principal, id);
    const key = this.key(principal.userId, id);
    const set = this.listeners.get(key) ?? new Set<(event: ChatEvent) => void>();
    set.add(listener); this.listeners.set(key, set);
    listener({ type: "snapshot", conversation: snapshot });
    return () => { set.delete(listener); if (!set.size) this.listeners.delete(key); };
  }
}

export function createChatboxService(options: ChatboxServiceOptions): ChatboxService { return new ChatboxService(options); }
