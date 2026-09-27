import { createServer } from "node:http";
import { Readable } from "node:stream";
import { Type } from "typebox";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { ChatboxAgent, createChatboxHttpHandler, createMemoryChatboxStore, defineConfirmation } from "pi-chatbox-kit/server";

const published: Array<{ title: string; body: string; userId: string }> = [];
const demoPort = Number(process.env.CHATBOX_DEMO_PORT ?? 3001);
const demo = fauxProvider({ provider: "demo", models: [{ id: "local-demo", name: "本地体验模型", input: ["text", "image"] }], tokensPerSecond: 45 });
const respond: FauxResponseFactory = (context) => {
  const last = context.messages.at(-1);
  if (last?.role === "toolResult") return { ...fauxAssistantMessage("操作已处理。你可以继续修改内容，再发起新的确认。"), provider: "demo", model: "local-demo" };
  const user = [...context.messages].reverse().find((message) => message.role === "user");
  const text = typeof user?.content === "string" ? user.content : user?.content.filter((block) => block.type === "text").map((block) => block.text).join("") ?? "";
  const hasImage = Array.isArray(user?.content) && user.content.some((block) => block.type === "image");
  if (/发布|publish/i.test(text)) return { ...fauxAssistantMessage(fauxToolCall("publishDraft", { title: "演示文章", body: `根据你的要求写好的草稿：${text}` }), { stopReason: "toolUse" }), provider: "demo", model: "local-demo" };
  return { ...fauxAssistantMessage(hasImage ? "我收到了这张图片。这是本地模拟模型，图片预览和上传流程可在这里体验；真实图片理解请切换到支持图片的模型并配置凭据。" : `我收到了你的消息：“${text}”。这是本地模拟回复。你可以输入“发布一篇短文”来试用可编辑确认卡。`), provider: "demo", model: "local-demo" };
};
demo.setResponses(Array.from({ length: 200 }, () => respond));
const agent = new ChatboxAgent({
  appId: "demo",
  providers: ["openai", demo.provider],
  oauth: [{ provider: "openai-codex" }],
  defaultModel: { provider: "demo", modelId: "local-demo" },
  credentialPolicies: { openai: { mode: "user-or-app", defaultSource: "user" }, "openai-codex": { mode: "user-only" }, demo: { mode: "app-only" } },
  allowCustomProviders: true,
  allowCustomBaseUrl: true,
  storage: createMemoryChatboxStore(),
  systemPrompt: "You help draft short notes. When asked to publish, propose the publishDraft tool and wait for confirmation.",
  confirmations: [defineConfirmation({
    id: "publishDraft", description: "Publish a reviewed draft", inputSchema: Type.Object({ title: Type.String(), body: Type.String() }),
    presentation: { title: "确认发布草稿", fields: [{ path: "title", label: "标题", editable: true }, { path: "body", label: "正文", editable: true, multiline: true }], confirmLabel: "发布" },
    onConfirm: async ({ value, principal }) => { published.push({ ...value, userId: principal.userId }); return { publishedCount: published.length }; },
  })],
});
await agent.ready;
const service = agent.service;
await service.setApiKey({ userId: "demo-user" }, "demo", "app", "local-demo");
const handler = createChatboxHttpHandler({
  service,
  // The demo uses one fixed user. Replace this with your app's authenticated session.
  resolvePrincipal: () => ({ userId: "demo-user" }),
  canManageAppSettings: () => true,
});

createServer(async (incoming, outgoing) => {
  try {
    const url = `http://127.0.0.1:${demoPort}${incoming.url ?? "/"}`;
    const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
    const request = new Request(url, { method: incoming.method, headers: incoming.headers as HeadersInit, ...(hasBody ? { body: Readable.toWeb(incoming) as ReadableStream, duplex: "half" as const } : {}) } as RequestInit);
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body as never).pipe(outgoing);
    else outgoing.end();
    outgoing.on("close", () => { if (!response.bodyUsed) void response.body?.cancel(); });
  } catch (error) {
    outgoing.writeHead(500); outgoing.end(String(error));
  }
}).listen(demoPort, "127.0.0.1", () => console.log(`Demo API: http://127.0.0.1:${demoPort}`));
