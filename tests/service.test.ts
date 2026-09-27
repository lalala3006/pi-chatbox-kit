import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Type } from "typebox";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { ChatboxAgent, createChatboxService, createChatboxHttpHandler, createMemoryChatboxStore, createSqliteChatboxStore, defineConfirmation } from "../src/server/index.js";
import { createCustomProvider } from "../src/server/custom-provider.js";

async function until<T>(get: () => Promise<T | undefined>, timeout = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await get();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out");
}

function fixture(input: ("text" | "image")[] = ["text"]) {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "test", input }] });
  const store = createMemoryChatboxStore();
  const calls: unknown[] = [];
  const action = defineConfirmation({
    id: "publishDraft", description: "Publish a reviewed draft", inputSchema: Type.Object({ title: Type.String() }),
    presentation: { title: "确认发布", fields: [{ path: "title", label: "标题", editable: true }] },
    onConfirm: async (context) => { calls.push(context); return { published: true }; },
  });
  const service = createChatboxService({
    appId: "test-app", providers: [faux.provider], defaultModel: { provider: "faux", modelId: "test" },
    credentialPolicies: { faux: { mode: "user-or-app", defaultSource: "user" } }, storage: store, confirmations: [action],
  });
  return { faux, service, calls, store };
}

describe("ChatboxService", () => {
  it("isolates conversations and credentials by user", async () => {
    const { service } = fixture();
    const a = { userId: "a" }, b = { userId: "b" };
    const conversation = await service.createConversation(a);
    await expect(service.getConversation(b, conversation.id)).rejects.toThrow("not found");
    await service.setApiKey(a, "faux", "user", "secret-a");
    const bStatus = await service.credentialStatus(b);
    expect(bStatus[0]?.userConfigured).toBe(false);
    await service.setApiKey(a, "faux", "app", "shared");
    expect((await service.credentialStatus(b))[0]?.effectiveSource).toBe("app");
    expect((await service.credentialStatus(a))[0]?.effectiveSource).toBe("user");
  });

  it("rejects images for text-only models", async () => {
    const { service } = fixture();
    const user = { userId: "a" };
    await service.setApiKey(user, "faux", "user", "secret");
    const conversation = await service.createConversation(user);
    await expect(service.send(user, conversation.id, { text: "look", images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,aGVsbG8=" }] })).rejects.toThrow("does not support images");
  });

  it("runs only after a valid edited confirmation, once", async () => {
    const { service, faux, calls } = fixture();
    const user = { userId: "a" };
    await service.setApiKey(user, "faux", "user", "secret");
    faux.setResponses([fauxAssistantMessage(fauxToolCall("publishDraft", { title: "draft" }), { stopReason: "toolUse" }), fauxAssistantMessage("Published")]);
    const conversation = await service.createConversation(user);
    await service.send(user, conversation.id, { text: "publish" });
    const request = await until(async () => (await service.getConversation(user, conversation.id)).confirmations[0]);
    expect(calls).toHaveLength(0);
    await expect(service.decide(user, request.requestId, { type: "confirm", value: { title: 1 } })).rejects.toThrow("invalid");
    expect(calls).toHaveLength(0);
    await service.decide(user, request.requestId, { type: "confirm", value: { title: "edited" } });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { value: { title: string } }).value.title).toBe("edited");
    await expect(service.decide(user, request.requestId, { type: "confirm", value: { title: "again" } })).rejects.toThrow();
    expect(calls).toHaveLength(1);
    await until(async () => (await service.getConversation(user, conversation.id)).status === "idle" ? true : undefined);
  });

  it("rejects without running the action", async () => {
    const { service, faux, calls } = fixture();
    const user = { userId: "a" };
    await service.setApiKey(user, "faux", "user", "secret");
    faux.setResponses([fauxAssistantMessage(fauxToolCall("publishDraft", { title: "draft" }), { stopReason: "toolUse" }), fauxAssistantMessage("Cancelled")]);
    const conversation = await service.createConversation(user);
    await service.send(user, conversation.id, { text: "publish" });
    const request = await until(async () => (await service.getConversation(user, conversation.id)).confirmations[0]);
    await service.decide(user, request.requestId, { type: "reject" });
    expect(calls).toHaveLength(0);
  });

  it("enforces app administration on HTTP credential writes and never returns keys", async () => {
    const { service } = fixture();
    const handler = createChatboxHttpHandler({ service, resolvePrincipal: () => ({ userId: "ordinary" }), canManageAppSettings: () => false });
    const make = (scope: string) => new Request(`http://localhost/api/chatbox/credentials/${scope}/faux`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: "top-secret" }) });
    expect((await handler(make("app"))).status).toBe(403);
    expect((await handler(make("user"))).status).toBe(200);
    const status = await handler(new Request("http://localhost/api/chatbox/credentials/status"));
    expect(status.status).toBe(200);
    expect(await status.text()).not.toContain("top-secret");
  });

  it("returns 404 before opening an event stream for a missing or inaccessible conversation", async () => {
    const { service } = fixture();
    const conversation = await service.createConversation({ userId: "owner" });
    const handler = createChatboxHttpHandler({ service, resolvePrincipal: () => ({ userId: "other" }) });
    for (const id of ["missing-conversation", conversation.id]) {
      const response = await handler(new Request(`http://localhost/api/chatbox/conversations/${id}/events`));
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({ error: "Conversation not found" });
    }
  });

  it("retries a failed turn without keeping a duplicate user message", async () => {
    const { service, faux } = fixture();
    const user = { userId: "a" };
    await service.setApiKey(user, "faux", "user", "secret");
    faux.setResponses([fauxAssistantMessage("failed", { stopReason: "error", errorMessage: "temporary" }), fauxAssistantMessage("recovered")]);
    const conversation = await service.createConversation(user);
    await service.send(user, conversation.id, { text: "hello" });
    await until(async () => (await service.getConversation(user, conversation.id)).status === "error" ? true : undefined);
    await service.retry(user, conversation.id);
    await until(async () => (await service.getConversation(user, conversation.id)).status === "idle" ? true : undefined);
    const result = await service.getConversation(user, conversation.id);
    expect(result.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(result.messages.some((message) => message.text === "recovered")).toBe(true);
  });

  it("encrypts persisted credentials in SQLite", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-chatbox-test-"));
    const path = join(directory, "chatbox.db");
    const key = Buffer.alloc(32, 7);
    try {
      const store = createSqliteChatboxStore({ path, encryptionKey: key });
      await store.modifyCredential({ appId: "test", provider: "faux", scope: "user", userId: "a" }, async () => ({ type: "api_key", key: "secret-value-for-test" }));
      store.close();
      expect(readFileSync(path).toString("utf8")).not.toContain("secret-value-for-test");
      const reopened = createSqliteChatboxStore({ path, encryptionKey: key });
      expect((await reopened.readCredential({ appId: "test", provider: "faux", scope: "user", userId: "a" }))?.type).toBe("api_key");
      reopened.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("keeps personal custom endpoints private and exposes app endpoints to all users", async () => {
    const { faux, store } = fixture();
    const service = createChatboxService({ appId: "custom-app", providers: [faux.provider], defaultModel: { provider: "faux", modelId: "test" }, credentialPolicies: { faux: { mode: "user-only" } }, storage: store, allowCustomProviders: true });
    const alice = { userId: "alice" }, bob = { userId: "bob" };
    const endpoint = { id: "proxy", name: "", baseUrl: "http://127.0.0.1:10000/v1", api: "openai-completions" as const, authMode: "api-key" as const, models: [{ id: "custom-model", name: "", input: ["text", "image"] as Array<"text" | "image">, contextWindow: 32000, maxTokens: 4096 }] };
    await service.upsertCustomProvider(alice, "user", endpoint);
    expect((await service.getSettings(alice)).user.customProviders?.[0]?.name).toBe("proxy");
    expect((await service.getSettings(alice)).user.customProviders?.[0]?.models[0]?.name).toBe("custom-model");
    const aliceHandler = createChatboxHttpHandler({ service, resolvePrincipal: () => alice, canManageAppSettings: () => false });
    const keyResponse = await aliceHandler(new Request("http://localhost/api/chatbox/custom-providers/user/proxy", { method: "PUT", body: JSON.stringify({ ...endpoint, apiKey: "write-only-key" }) }));
    expect(keyResponse.status).toBe(200);
    expect(await keyResponse.text()).not.toContain("write-only-key");
    expect((await store.readCredential({ appId: "custom-app", provider: "custom-user-proxy", scope: "user", userId: "alice" }))?.type).toBe("api_key");
    expect((await service.listModels(alice)).some((model) => model.provider === "custom-user-proxy" && model.inputCapabilities.includes("image"))).toBe(true);
    expect((await service.listModels(bob)).some((model) => model.provider === "custom-user-proxy")).toBe(false);
    await service.upsertCustomProvider(alice, "app", endpoint);
    await service.setApiKey(alice, "custom-app-proxy", "app", "shared-key");
    expect((await service.listModels(bob)).find((model) => model.provider === "custom-app-proxy")?.configured).toBe(true);
    await expect(service.setApiKey(bob, "custom-app-proxy", "user", "wrong-scope")).rejects.toThrow("scope");
    const handler = createChatboxHttpHandler({ service, resolvePrincipal: () => bob, canManageAppSettings: () => false });
    const response = await handler(new Request("http://localhost/api/chatbox/custom-providers/app/proxy", { method: "DELETE" }));
    expect(response.status).toBe(403);
  });

  it("keeps a custom provider usable when its default model is removed", async () => {
    const { faux, store } = fixture();
    const service = createChatboxService({ appId: "model-edit", providers: [faux.provider], defaultModel: { provider: "faux", modelId: "test" }, credentialPolicies: { faux: { mode: "user-only" } }, storage: store, allowCustomProviders: true });
    const user = { userId: "alice" };
    const endpoint = { id: "custom", baseUrl: "https://example.test/v1", api: "openai-completions" as const, authMode: "api-key" as const, models: [
      { id: "old", contextWindow: 32000, maxTokens: 4096 },
      { id: "remaining", contextWindow: 32000, maxTokens: 4096 },
    ] };
    await service.upsertCustomProvider(user, "user", endpoint);
    await service.setApiKey(user, "custom-user-custom", "user", "saved-key");
    await service.updateSettings(user, "user", { defaultModel: { provider: "custom-user-custom", modelId: "old" } });
    await service.upsertCustomProvider(user, "user", { ...endpoint, models: [endpoint.models[1]] });
    expect((await service.getSettings(user)).user.defaultModel).toEqual({ provider: "custom-user-custom", modelId: "remaining" });
    expect((await service.createConversation(user)).model.modelId).toBe("remaining");
    expect((await store.readCredential({ appId: "model-edit", provider: "custom-user-custom", scope: "user", userId: user.userId }))?.type).toBe("api_key");

    await service.upsertCustomProvider(user, "app", endpoint);
    await service.updateSettings(user, "app", { defaultModel: { provider: "custom-app-custom", modelId: "old" }, allowedModels: [{ provider: "custom-app-custom", modelId: "old" }] });
    await service.upsertCustomProvider(user, "app", { ...endpoint, models: [endpoint.models[1]] });
    const app = (await service.getSettings(user)).app;
    expect(app.defaultModel).toEqual({ provider: "custom-app-custom", modelId: "remaining" });
    expect(app.allowedModels).toEqual([{ provider: "custom-app-custom", modelId: "remaining" }]);
    expect((await service.listModels(user)).find((model) => model.provider === "custom-app-custom")?.allowed).toBe(true);
  });

  it("sends configured model ID and key to a compatible endpoint", async () => {
    const seen: Array<{ path: string; auth: string | undefined; body: string }> = [];
    const mock = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      seen.push({ path: request.url ?? "", auth: request.headers.authorization, body });
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('data: {"id":"chatcmpl-demo","object":"chat.completion.chunk","created":1,"model":"wire-model","choices":[{"index":0,"delta":{"role":"assistant","content":"Connected"},"finish_reason":null}]}\n\n');
      response.write('data: {"id":"chatcmpl-demo","object":"chat.completion.chunk","created":1,"model":"wire-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
      response.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
    try {
      const { faux, store } = fixture();
      const service = createChatboxService({ appId: "wire-app", providers: [faux.provider], defaultModel: { provider: "faux", modelId: "test" }, credentialPolicies: { faux: { mode: "user-only" } }, storage: store, allowCustomProviders: true });
      const user = { userId: "alice" };
      const port = (mock.address() as AddressInfo).port;
      await service.upsertCustomProvider(user, "user", { id: "wire", baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", authMode: "api-key", models: [{ id: "wire-model", name: "Wire Model", contextWindow: 32000, maxTokens: 2048, reasoning: false, input: ["text"] }] });
      await service.setApiKey(user, "custom-user-wire", "user", "wire-secret");
      const handler = createChatboxHttpHandler({ service, resolvePrincipal: () => user, canManageAppSettings: () => false });
      const checkResponse = await handler(new Request("http://localhost/api/chatbox/models/test", { method: "POST", body: JSON.stringify({ model: { provider: "custom-user-wire", modelId: "wire-model" } }) }));
      expect(checkResponse.status).toBe(200);
      expect((await checkResponse.json()).connected).toBe(true);
      const check = await service.testModel(user, { provider: "custom-user-wire", modelId: "wire-model" });
      expect(check.connected).toBe(true);
      expect(check.reply).toContain("Connected");
      expect(JSON.parse(seen[0]!.body).messages.at(-1).content).toBe("hello");
      const conversation = await service.createConversation(user, { provider: "custom-user-wire", modelId: "wire-model" });
      await service.send(user, conversation.id, { text: "Hello" });
      const done = await until(async () => { const value = await service.getConversation(user, conversation.id); return value.status !== "running" ? value : undefined; }, 6000);
      expect(done.status).toBe("idle");
      expect(done.messages.some((message) => message.text.includes("Connected"))).toBe(true);
      expect(seen[0]?.path).toBe("/v1/chat/completions");
      expect(seen[0]?.auth).toBe("Bearer wire-secret");
      expect(JSON.parse(seen[0]!.body).model).toBe("wire-model");
      await service.upsertCustomProvider(user, "user", { id: "local", baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", authMode: "none", models: [{ id: "local-model", contextWindow: 32000, maxTokens: 2048 }] });
      expect((await service.testModel(user, { provider: "custom-user-local", modelId: "local-model" })).connected).toBe(true);
      expect(seen.at(-1)?.auth).toBe("Bearer no-key");
    } finally { await new Promise<void>((resolve, reject) => mock.close((error) => error ? reject(error) : resolve())); }
  });

  it("bootstraps provider-keyed JSON through new ChatboxAgent without exposing the key", async () => {
    const store = createMemoryChatboxStore();
    const agent = new ChatboxAgent({
      appId: "bootstrap", storage: store, providers: [], credentialPolicies: {},
      defaultModel: { provider: "custom-app-siliconflow", modelId: "Qwen/Qwen3.5-397B-A17B" },
      modelConfig: { siliconflow: { baseUrl: "https://api.siliconflow.cn/v1", api: "openai-completions", apiKey: "private-bootstrap-key", compat: { supportsDeveloperRole: false, supportsReasoningEffort: false }, models: [{ id: "Qwen/Qwen3.5-397B-A17B", name: "Qwen3.5", input: ["text", "image"], contextWindow: 32000, maxTokens: 4096 }] } },
    });
    await agent.ready;
    const settings = await agent.service.getSettings({ userId: "alice" });
    expect(JSON.stringify(settings)).not.toContain("private-bootstrap-key");
    expect(settings.app.customProviders?.[0]?.compat).toEqual({ supportsDeveloperRole: false, supportsReasoningEffort: false });
    expect((await agent.service.listModels({ userId: "alice" })).find((model) => model.modelId === "Qwen/Qwen3.5-397B-A17B")?.configured).toBe(true);
    expect((await store.readCredential({ appId: "bootstrap", provider: "custom-app-siliconflow", scope: "app" }))?.type).toBe("api_key");
    const piProvider = createCustomProvider(settings.app.customProviders![0]!, "app");
    expect(piProvider.getModels()[0]?.compat).toMatchObject({ supportsDeveloperRole: false, supportsReasoningEffort: false });
    expect((await agent.service.createConversation({ userId: "alice" })).model.provider).toBe("custom-app-siliconflow");
  });

  it("accepts provider OAuth prompts through the generic login flow", async () => {
    const { faux, store } = fixture();
    const provider = {
      ...faux.provider,
      id: "oauth-demo", name: "OAuth Demo",
      getModels: () => faux.provider.getModels().map((model) => ({ ...model, provider: "oauth-demo" })),
      auth: { oauth: {
        name: "Demo OAuth",
        login: async (interaction: { notify: (event: { type: "auth_url"; url: string }) => void; prompt: (value: { type: "text"; message: string }) => Promise<string> }) => {
          interaction.notify({ type: "auth_url", url: "https://example.test/login" });
          const access = await interaction.prompt({ type: "text", message: "Enter code" });
          return { type: "oauth" as const, access, refresh: "refresh", expires: Date.now() + 3600000 };
        },
        refresh: async (credential: { type: "oauth"; access: string; refresh: string; expires: number }) => credential,
        toAuth: async (credential: { access: string }) => ({ apiKey: credential.access }),
      } },
    };
    const service = createChatboxService({ appId: "oauth-app", providers: [provider], defaultModel: { provider: "oauth-demo", modelId: "test" }, credentialPolicies: { "oauth-demo": { mode: "user-only" } }, storage: store });
    const user = { userId: "alice" };
    const started = await service.startLogin(user, "oauth-demo");
    const waiting = await until(async () => { const status = service.getLoginStatus(user, started.flowId); return status.prompt ? status : undefined; });
    expect(waiting.authUrl).toBe("https://example.test/login");
    expect(waiting.prompt?.message).toBe("Enter code");
    service.answerLoginPrompt(user, started.flowId, "auth-code");
    const success = await until(async () => { const status = service.getLoginStatus(user, started.flowId); return status.status === "success" ? status : undefined; });
    expect(success.status).toBe("success");
    expect((await store.readCredential({ appId: "oauth-app", provider: "oauth-demo", scope: "user", userId: "alice" }))?.type).toBe("oauth");
  });

  it("lets a web client choose the OpenAI Codex OAuth method", async () => {
    const { faux, store } = fixture();
    const provider = {
      ...faux.provider,
      id: "openai-codex", name: "OpenAI Codex",
      getModels: () => faux.provider.getModels().map((model) => ({ ...model, provider: "openai-codex" })),
      auth: { oauth: {
        name: "Test OAuth",
        login: async (interaction: { notify: (event: { type: "auth_url"; url: string }) => void; prompt: (value: { type: "select" | "manual_code"; message: string; options?: Array<{ id: string; label: string }> }) => Promise<string> }) => {
          const method = await interaction.prompt({ type: "select", message: "Choose login method", options: [{ id: "browser", label: "Browser" }, { id: "device_code", label: "Device code" }] });
          if (method !== "browser") throw new Error("Expected browser login");
          interaction.notify({ type: "auth_url", url: "https://example.test/authorize" });
          const access = await interaction.prompt({ type: "manual_code", message: "Paste code" });
          return { type: "oauth" as const, access, refresh: "refresh", expires: Date.now() + 3600000 };
        },
        refresh: async (credential: { type: "oauth"; access: string; refresh: string; expires: number }) => credential,
        toAuth: async (credential: { access: string }) => ({ apiKey: credential.access }),
      } },
    };
    const service = createChatboxService({ appId: "codex-oauth", providers: [provider], defaultModel: { provider: "openai-codex", modelId: "test" }, credentialPolicies: { "openai-codex": { mode: "user-only" } }, storage: store });
    const user = { userId: "alice" };
    const started = await service.startLogin(user, "openai-codex");
    const select = await until(async () => { const status = service.getLoginStatus(user, started.flowId); return status.prompt?.type === "select" ? status : undefined; });
    expect(select.prompt?.options?.map((option) => option.id)).toEqual(["browser", "device_code"]);
    service.answerLoginPrompt(user, started.flowId, "browser");
    const browser = await until(async () => { const status = service.getLoginStatus(user, started.flowId); return status.prompt?.type === "manual_code" ? status : undefined; });
    expect(browser.authUrl).toBe("https://example.test/authorize");
    service.answerLoginPrompt(user, started.flowId, "test-code");
    const success = await until(async () => { const status = service.getLoginStatus(user, started.flowId); return status.status === "success" ? status : undefined; });
    expect(success.status).toBe("success");
    expect((await store.readCredential({ appId: "codex-oauth", provider: "openai-codex", scope: "user", userId: "alice" }))?.type).toBe("oauth");
  });
});
