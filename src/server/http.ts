import type { ChatboxService } from "./service.js";
import type { Principal, CredentialScope, ModelRef, ChatImage, AppSettings, UserSettings, CustomEndpointInput } from "../shared.js";

export interface ChatboxHttpHandlerOptions {
  service: ChatboxService;
  resolvePrincipal: (request: Request) => Promise<Principal> | Principal;
  canManageAppSettings: (principal: Principal, request: Request) => Promise<boolean> | boolean;
}

export function createChatboxHttpHandler(options: ChatboxHttpHandlerOptions): (request: Request) => Promise<Response> {
  const { service } = options;
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
  const body = async <T>(request: Request): Promise<T> => {
    const limit = 75 * 1024 * 1024;
    if (Number(request.headers.get("content-length") ?? 0) > limit) throw new Error("Request is too large");
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Request body is required");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Request is too large"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  };
  return async (request) => {
    try {
      const principal = await options.resolvePrincipal(request);
      if (!principal?.userId) return json({ error: "Unauthorized" }, 401);
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter(Boolean);
      const i = parts.lastIndexOf("chatbox");
      const path = i < 0 ? parts : parts.slice(i + 1);
      const method = request.method;
      const admin = () => options.canManageAppSettings(principal, request);
      const assertAdmin = async () => { if (!(await admin())) throw new Error("Forbidden"); };
      const scope = (value: unknown): CredentialScope => {
        if (value !== "user" && value !== "app") throw new Error("Invalid scope");
        return value;
      };

      if (method === "GET" && path.length === 1 && path[0] === "models") return json(await service.listModels(principal, await admin()));
      if (method === "POST" && path.join("/") === "models/test") {
        const input = await body<{ model: ModelRef }>(request);
        return json(await service.testModel(principal, input.model));
      }
      if (method === "GET" && path.length === 1 && path[0] === "settings") return json(await service.getSettings(principal));
      if (method === "GET" && path.length === 1 && path[0] === "custom-providers") {
        const settings = await service.getSettings(principal);
        return json({ user: settings.user.customProviders ?? [], app: settings.app.customProviders ?? [] });
      }
      if (path[0] === "custom-providers" && path.length === 3 && (method === "PUT" || method === "DELETE")) {
        const target = scope(path[1]);
        if (target === "app") await assertAdmin();
        const id = path[2]!;
        if (method === "DELETE") { await service.deleteCustomProvider(principal, target, id); return json({ ok: true }); }
        const config = await body<CustomEndpointInput>(request);
        if (config.id !== id) throw new Error("Endpoint ID does not match path");
        return json(await service.upsertCustomProvider(principal, target, config));
      }
      if (method === "PATCH" && path.length === 2 && path[0] === "settings") {
        const target = scope(path[1]);
        if (target === "app") await assertAdmin();
        const patch = await body<UserSettings | AppSettings>(request);
        await service.updateSettings(principal, target, patch);
        return json(await service.getSettings(principal));
      }
      if (method === "GET" && path.join("/") === "credentials/status") return json(await service.credentialStatus(principal, await admin()));
      if (path[0] === "credentials" && path.length === 3 && (method === "PUT" || method === "DELETE")) {
        const target = scope(path[1]);
        if (target === "app") await assertAdmin();
        const provider = path[2]!;
        if (method === "PUT") {
          const input = await body<{ apiKey: string }>(request);
          await service.setApiKey(principal, provider, target, input.apiKey);
        } else await service.deleteCredential(principal, provider, target);
        return json({ ok: true });
      }
      if (method === "POST" && path.length === 2 && path[0] === "auth") return json(await service.startLogin(principal, path[1]), 202);
      if (path.length === 3 && path[0] === "auth" && path[1] === "flows") {
        if (method === "GET") return json(service.getLoginStatus(principal, path[2]!));
        if (method === "DELETE") return json(service.cancelLogin(principal, path[2]!));
      }
      if (method === "POST" && path.length === 4 && path[0] === "auth" && path[1] === "flows" && path[3] === "answer") {
        const input = await body<{ value: string }>(request);
        return json(service.answerLoginPrompt(principal, path[2]!, input.value));
      }
      if (method === "GET" && path.join("/") === "conversations") return json(await service.listConversations(principal));
      if (method === "POST" && path.join("/") === "conversations") {
        const input = await body<{ model?: ModelRef }>(request);
        return json(await service.createConversation(principal, input.model), 201);
      }
      if (path[0] === "conversations" && path[1]) {
        const id = path[1];
        if (method === "GET" && path.length === 2) return json(await service.getConversation(principal, id));
        if (method === "PATCH" && path[2] === "model") {
          const input = await body<{ model: ModelRef }>(request);
          return json(await service.setModel(principal, id, input.model));
        }
        if (method === "POST" && path[2] === "messages") {
          const input = await body<{ text: string; images?: ChatImage[] }>(request);
          return json(await service.send(principal, id, input), 202);
        }
        if (method === "POST" && path[2] === "cancel") {
          await service.cancel(principal, id); return json({ ok: true });
        }
        if (method === "POST" && path[2] === "retry") return json(await service.retry(principal, id), 202);
        if (method === "GET" && path[2] === "events") {
          let unsubscribe = () => {};
          let heartbeat: ReturnType<typeof setInterval> | undefined;
          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              const encoder = new TextEncoder();
              const push = (value: string) => { try { controller.enqueue(encoder.encode(value)); } catch { /* disconnected */ } };
              try {
                unsubscribe = await service.subscribe(principal, id, (event) => push(`data: ${JSON.stringify(event)}\n\n`));
                heartbeat = setInterval(() => push(": ping\n\n"), 15000);
                request.signal.addEventListener("abort", () => { unsubscribe(); if (heartbeat) clearInterval(heartbeat); try { controller.close(); } catch { /* already closed */ } }, { once: true });
              } catch (error) { controller.error(error); }
            },
            cancel() { unsubscribe(); if (heartbeat) clearInterval(heartbeat); },
          });
          return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "connection": "keep-alive" } });
        }
      }
      if (method === "POST" && path.length === 2 && path[0] === "confirmations") {
        const input = await body<{ type: "confirm"; value: Record<string, unknown> } | { type: "reject" }>(request);
        return json(await service.decide(principal, path[1]!, input));
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === "Forbidden" ? 403 : message === "Request is too large" ? 413 : message === "Conversation not found" || message === "Confirmation is unavailable" || message === "Login flow not found" ? 404 : 400;
      return json({ error: message }, status);
    }
  };
}
