# pi-chatbox-kit

可复用的 Pi Agent 聊天包，面向 React Web + Node.js。提供独立的服务端、浏览器客户端和 React 入口。需要 Node.js 22+，React 18.2+。

## 能力

- 多提供方模型设置；个人和 APP 两级 API key；ChatGPT（Codex）个人浏览器或设备码登录。
- 在 UI 中新增兼容 API 接入：Base URL、协议类型、提供方级 compat、多个模型及联通验证。
- `new ChatboxAgent({ modelConfig, oauth })` 初始化接口；可复用的 API Key／OAuth 双页签组件。
- 文本与图片聊天，SSE 流式回复，会话持久化和失败重试。
- 模型声明支持图片时可选择或粘贴图片，并在发送前预览。
- 结构化确认卡；用户确认后才调用宿主 APP 的业务回调。

设计和公开接口见 [REQUIREMENTS.md](./REQUIREMENTS.md)。Pi Agent SDK 是服务端依赖；浏览器包不加载 Pi 或密钥。

## 安装

```sh
npm install pi-chatbox-kit
```

React APP 同时需要安装 React 18.2 或 19。三个独立入口分别为 `pi-chatbox-kit/server`、`pi-chatbox-kit/client`、`pi-chatbox-kit/react`。

## 运行示例

```sh
git clone https://github.com/lalala3006/pi-chatbox-kit.git
cd pi-chatbox-kit
npm ci
npm run example:server
```

另开一个终端：

```sh
npm run example:web
```

访问 `http://localhost:3000`。默认的本地体验模型不需要 API key，可试用流式回复、图片入口和“发布草稿”确认卡；也可以输入自己的 OpenAI API key 或连接 ChatGPT（Codex）测试真实模型。示例使用单个固定用户和内存存储，重启后数据会清空；接入正式 APP 时需替换用户认证和存储。

## 宿主接入

```ts
import { Type } from "typebox";
import {
  createChatboxService,
  createChatboxHttpHandler,
  createSqliteChatboxStore,
  defineConfirmation,
} from "pi-chatbox-kit/server";

const store = createSqliteChatboxStore({
  path: "./data/chatbox.db",
  encryptionKey: Buffer.from(process.env.CHATBOX_ENCRYPTION_KEY!, "base64"), // 32 bytes
});

const publishDraft = defineConfirmation({
  id: "publishDraft",
  description: "Publish a draft after user review",
  inputSchema: Type.Object({ title: Type.String(), body: Type.String() }),
  presentation: {
    title: "确认发布",
    fields: [
      { path: "title", label: "标题", editable: true },
      { path: "body", label: "正文", editable: true, multiline: true },
    ],
  },
  authorize: async ({ principal }) => canPublish(principal.userId),
  onConfirm: async ({ value, principal, idempotencyKey }) =>
    publishToApp(value, principal.userId, idempotencyKey),
});

const service = createChatboxService({
  appId: "my-app",
  providers: ["openai", "openai-codex"],
  defaultModel: { provider: "openai", modelId: "gpt-4.1" },
  credentialPolicies: {
    openai: { mode: "user-or-app", defaultSource: "user" },
    "openai-codex": { mode: "user-only" },
  },
  storage: store,
  allowCustomProviders: true, // 开放用户／管理员从 UI 配置兼容 API 接入
  confirmations: [publishDraft],
  systemPrompt: ({ principal }) => `You assist user ${principal.userId}.`,
});

const handler = createChatboxHttpHandler({
  service,
  resolvePrincipal: async (request) => ({ userId: await requireAppUserId(request) }),
  canManageAppSettings: async (principal) => isAppAdmin(principal.userId),
});

// 将 handler(request) 挂载到 /api/chatbox/*。使用 Web Request/Response 的
// 框架可直接转发；Node http 转换示例见 examples/react-node/server.ts。
```

React 前端：

```tsx
import { createChatboxClient } from "pi-chatbox-kit/client";
import { ChatboxProvider, ChatBox, ModelAuthSettings } from "pi-chatbox-kit/react";

const client = createChatboxClient({ baseUrl: "/api/chatbox" });

export function App() {
  return <ChatboxProvider client={client}>
    <ModelAuthSettings client={client} />
    <ChatBox />
  </ChatboxProvider>;
}
```

宿主可传入 `confirmationRenderers={{ publishDraft: MyCard }}` 替换默认确认卡。自定义卡收到 `request`、`confirm(editedValue)` 和 `reject()`。无 UI 接入可只使用 `client` 入口。

`ChatBox` 自带独立作用域样式，包含消息区和底部输入框，无需额外导入 CSS。输入框内可选择模型、添加／粘贴图片、发送和中断回复；Enter 发送，Shift+Enter 换行，输入法组词时不会误发送。模型下拉只显示 `allowed && configured` 的项：已有有效凭据来源的模型或已保存的免密接入，不包含未登录的 OAuth 模型。配置被删除后，旧会话会提示重新选择模型。

图片使用小缩略图，右上角图标移除；待发送及已发送图片均支持点击弹窗预览，可按 Esc、点击遮罩或关闭按钮退出。默认自动跟随新消息，向上阅读历史时暂停跟随。

AI 回复使用 `react-markdown` 和 `remark-gfm` 渲染 Markdown，支持标题、粗体／斜体、列表、任务列表、引用、链接、表格、行内代码及代码块。代码块展示语言标签并支持复制，长代码和宽表格可横向滚动，流式生成时也会持续渲染。用户输入保持原文显示。模型输出中的原始 HTML 不执行，链接保留默认安全协议过滤。

可用 `onOpenSettings={() => openSettings()}` 接入宿主设置弹窗；用 `className`、`style` 或 `--pi-bg`、`--pi-surface`、`--pi-ink`、`--pi-accent` 等 CSS 变量调整主题。`emptyTitle` 可修改空对话标题。Demo 将 `ModelAuthSettings` 放在顶部「模型设置」弹窗中。

## 自定义 API 与模型

启用 `allowCustomProviders` 后，`ModelAuthSettings` 的 API Key 页可填写 Base URL、协议、API Key、提供方级 `compat`，并逐项新增、编辑和删除模型。模型支持编号、名称、文字／图片输入、上下文窗口、最大输出，以及高级 JSON 字段 `cost`、`samplingParams`、`thinkingLevelMap`、`inputLimits`、`promptCache`、模型级 `compat`。提供方级 `compat` 会作为每个模型的默认值，模型级字段可覆盖它。支持 `openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai` 四种协议；需要其他协议或特殊认证时，由宿主注册 Pi `Provider`。保存后模型即进入聊天下拉框；每个已保存的模型都可点击“发送 hello 验证”，验证状态互不影响。删除当前默认模型时，默认值会切换到此接入中保留的模型，APP 模型允许列表也会同步更新。使用已删除模型的旧会话会提示重新选择模型。

宿主可以在初始化时直接传入提供方键控的 JSON，并用同一接口声明 OAuth 提供方：

```ts
import { ChatboxAgent, createChatboxHttpHandler, createSqliteChatboxStore } from "pi-chatbox-kit/server";

const agent = new ChatboxAgent({
  appId: "my-app",
  storage: createSqliteChatboxStore({ path: "./data/chatbox.db", encryptionKey }),
  providers: [],
  defaultModel: { provider: "custom-app-siliconflow", modelId: "Qwen/Qwen3.5-4B" },
  credentialPolicies: {},
  modelConfig: {
    siliconflow: {
      baseUrl: "https://api.siliconflow.cn/v1",
      api: "openai-completions",
      apiKey: process.env.SILICONFLOW_API_KEY!,
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
      models: [{ id: "Qwen/Qwen3.5-4B", name: "Qwen3.5-4B", input: ["text"], contextWindow: 32000, maxTokens: 4096 }],
    },
  },
  oauth: [{ provider: "openai-codex" }],
});
await agent.ready;
const handler = createChatboxHttpHandler({ service: agent.service, resolvePrincipal, canManageAppSettings });
```

`modelConfig` 首次写入 APP 模型配置和凭据存储，后续重启保留管理员在 UI 中的改动。`ChatboxAgent` 将 JSON 转为 Pi `Provider`／`Models` 注册，聊天请求由内部的 `new Agent()` 执行；Pi SDK 本身不会直接读取这段 JSON 或自动修改 Pi CLI 的 `models.json` 文件。OAuth 由 Pi 内置提供方执行；默认让用户选择浏览器或设备码方式，宿主也可用 `preferredMethod` 指定一种方式。组件会显示授权链接、设备码或必要的输入提示。浏览器方式使用 Pi SDK 在 Node 主机的 `localhost:1455` 回调；远程用户可在登录后把授权码或最终跳转 URL 粘贴回组件。令牌仅在用户范围内保存。OpenAI 返回 `unsupported_country_region_territory` 时，必须遵守其支持地区限制；更换模型或 API Key 不能解除该限制。

无 UI 接入时可使用浏览器客户端：

```ts
await client.customProviders.save("user", {
  id: "my-proxy",
  name: "我的代理",
  baseUrl: "https://proxy.example.com/v1",
  api: "openai-completions",
  authMode: "api-key",
  apiKey, // 只用于写入；读取时不会返回
  compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  models: [{
    id: "my-model",
    name: "My Model",
    input: ["text", "image"],
    reasoning: false,
    contextWindow: 128000,
    maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }],
});
await client.setModel(conversationId, { provider: "custom-user-my-proxy", modelId: "my-model" });
await client.testModel({ provider: "custom-user-my-proxy", modelId: "my-model" });
```

APP 管理员可使用 `scope: "app"`，模型提供方 ID 为 `custom-app-<接入 ID>`，普通用户可使用管理员共享的模型与密钥。`authMode: "none"` 适用于本地兼容服务；Pi 的兼容协议适配器仍会发送占位密钥 `no-key`。API key 与接入配置分别保存；读取配置接口不会返回密钥。[Pi 的兼容端点说明](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)、[Pi 模型配置字段](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/model-config.ts)。

## 凭据和存储

- `resolvePrincipal` 和 `canManageAppSettings` 每次请求都由宿主实现。浏览器请求体中的用户身份不用于授权。
- 混合凭据模式下默认优先个人密钥，缺失时使用 APP 密钥。个人密钥调用失败后不会自动切换。`openai-codex` 强制个人 OAuth。
- SQLite 适配器用 AES-256-GCM 加密凭据字段；会话和图片历史没有加密。生产环境应保护数据库文件并妥善保存 32 字节加密密钥。多实例部署建议实现 `ChatboxStore`，并在存储层处理跨进程凭据更新同步。
- 自定义确认动作应使用 `idempotencyKey` 在业务系统去重，以覆盖进程崩溃后结果不确定的情况。进程重启会将等待中的确认卡标记为过期，不会自动执行业务动作。
- 浏览器通过 Cookie 认证连接 SSE。若 APP 使用跨站部署，需要自行配置 Cookie 与跨域策略。

## API 路由

| 方法 | 路由 | 用途 |
| --- | --- | --- |
| GET | `/models` | 模型与输入能力 |
| POST | `/models/test` | 向指定模型发送 `hello` 并返回回复与耗时 |
| GET/PATCH | `/settings`, `/settings/:scope` | 用户／APP 设置 |
| GET/PUT/DELETE | `/custom-providers`, `/custom-providers/:scope/:id` | 兼容 API 接入配置 |
| GET/PUT/DELETE | `/credentials/status`, `/credentials/:scope/:provider` | 凭据脱敏状态与管理 |
| POST/GET/DELETE | `/auth/:provider`, `/auth/flows/:id` | Pi OAuth 登录、状态与取消 |
| POST | `/auth/flows/:id/answer` | 提交 OAuth 流程中的选择或验证码 |
| GET/POST | `/conversations` | 会话列表／创建 |
| GET | `/conversations/:id` | 会话快照 |
| PATCH | `/conversations/:id/model` | 切换模型 |
| POST | `/conversations/:id/messages` | 发送文本和图片 |
| GET | `/conversations/:id/events` | SSE 事件 |
| POST | `/conversations/:id/cancel`, `/conversations/:id/retry` | 停止／重试 |
| POST | `/confirmations/:requestId` | 确认或拒绝 |

完整 TypeScript API 可在构建后查看 `dist/*/*.d.ts`。

## 验证

```sh
npm run check
npm test
npm run build
npm pack --dry-run
```
