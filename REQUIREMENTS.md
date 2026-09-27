# Pi Chatbox npm 包需求规格（已确认 v1.0）

状态：已确认并进入实现。用户确认 React Web + Node、确认卡执行宿主业务动作、用户和管理员两级配置。管理员只共享 API key／模型配置；ChatGPT（Codex）OAuth 仅限用户个人。混合模式优先使用个人凭据，缺失时使用 APP 凭据；调用失败时不自动切换来源。

## 初始化模型配置补充（2026-09-26）

- 宿主使用 `new ChatboxAgent({ modelConfig, oauth, ... })` 传入提供方键控 JSON；`await agent.ready` 后将 `agent.service` 挂到 HTTP 处理器。JSON 的 `apiKey` 写入凭据存储，读取模型配置不返回明文；Pi SDK 通过运行时 Provider／Models 注册使用该配置。
- API Key 表单包含 Provider ID、Base URL、协议、API Key、提供方级 `compat` 和多个模型；每个模型可独立添加、编辑、删除。保存后模型加入聊天选择器。
- 提供方级 `compat` 默认应用到其所有模型，模型级 `compat` 可覆盖。OAuth 提供方由宿主声明，登录可处理设备码、授权链接、选择项与文本输入；OAuth 凭据保持个人范围。
- `ModelAuthSettings` 作为可单独调用的 React 组件展示 API Key／OAuth 两个页签。每个已保存模型提供联通验证：向模型发送 `hello`，显示回复、耗时或错误，最长等待 20 秒。

## 1. 已确认的产品边界

- 首版运行环境：React Web 前端 + 常驻 Node.js 服务端。
- 确认卡的用途：用户确认或编辑后确认，才调用 APP 注册的业务动作。
- 凭据模式：同时支持每位 APP 用户自行配置，以及 APP 管理员统一配置。
- 目标：后续 APP 通过 npm 包复用 LLM 设置、聊天、图片输入、确认卡；业务动作和自定义 UI 由 APP 提供。
- SDK 与 UI 分离：服务端能力、浏览器客户端和 React 组件使用独立的包导出入口。调用方可以只安装和使用无 UI 的接口。

## 2. 现有项目与复用策略

| 项目 | 复用方式 | 判断 |
| --- | --- | --- |
| [Pi `pi-agent-core` / `pi-ai`](https://github.com/earendil-works/pi) | 直接依赖 | 负责 agent 循环、流式事件、多模型、工具和认证；通用 APP 默认不启用 `pi-coding-agent` 的文件和命令工具。 |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | 评估组件设计，首版不引入运行时依赖 | 现有 Pi 适配器连接 `pi-coding-agent`，与本包的服务端凭据和确认动作接口不匹配。首版提供独立 React 组件，后续可增加适配层。 |
| [assistant-ui 的 Pi 适配器](https://github.com/assistant-ui/assistant-ui/blob/main/packages/react-pi/README.md) | 参考和兼容性评估 | 当前适配器连接 `pi-coding-agent`，不提供凭据／设置接口；不直接把它定为通用服务端基础。 |
| [Pi 旧版 web-ui](https://github.com/earendil-works/pi/blob/v0.75.3/packages/web-ui/README.md) | 参考图片预览与设置交互 | 该版本的 UI 技术栈和浏览器密钥存储方式不作为首版默认架构。 |
| [AI Elements Confirmation](https://elements.ai-sdk.dev/components/confirmation) | 参考确认卡状态与交互 | 组件流程基于 Vercel AI SDK，若复用外观需单独适配 Pi。 |

## 3. 包导出与调用方接口

公开包名暂定 `pi-chatbox-kit`，实际导出入口为 `pi-chatbox-kit/server`、`pi-chatbox-kit/client`、`pi-chatbox-kit/react`。接口以同目录 `src` 和构建生成的声明文件为准。

### 3.1 服务端：`pi-chatbox-kit/server`

```ts
const service = createChatboxService({
  appId: "my-app",
  providers: ["openai", "anthropic", "openai-codex"],
  defaultModel: { provider: "openai", modelId: "..." },
  credentialPolicies: {
    openai: { mode: "user-or-app", defaultSource: "user" },
    anthropic: { mode: "user-or-app", defaultSource: "user" },
    "openai-codex": { mode: "user-only" },
  },
  systemPrompt: ({ principal }) => `你是 ${principal.userId} 的应用助手。`,
  storage: chatboxStore,
  confirmations: [publishDraft],
});

const handler = createChatboxHttpHandler({
  service,
  resolvePrincipal: async (request) => ({ userId: await requireUserId(request) }),
  canManageAppSettings: async (principal) => await isAppAdmin(principal.userId),
});
```

- `appId` 是稳定的应用命名空间，避免多个 APP 的会话与设置混用。
- `resolvePrincipal` 由宿主 APP 提供。服务端按 `appId + userId` 隔离会话、个人凭据与待确认动作；APP 统一凭据只按 `appId` 存储。不信任浏览器传入的 `userId`。
- `credentialPolicies` 按提供方规定 `user-only`、`app-only` 或 `user-or-app`。在混合模式下，用户可以明确选择个人或 APP 凭据；界面始终显示当前来源。个人凭据缺失时可以使用管理员允许的 APP 凭据；个人凭据请求失败时不自动切换来源。
- `canManageAppSettings` 控制 APP 级凭据、模型范围和默认模型的管理权限。服务端对每一次管理请求检查该权限，前端隐藏按钮不构成授权。
- `storage` 是可替换接口。首版拟提供 Node SQLite 适配器；宿主可接自己的数据库。凭据持久化需使用宿主提供的加密密钥或安全存储实现。
- 存储接口覆盖会话、待确认请求、用户设置、凭据和图片附件；SQLite 适配器仅作为单实例 Node 的默认选项，宿主可替换为自己的数据库或对象存储。
- HTTP 适配器返回标准 `Request → Response` 处理函数，方便接入 Next.js、Express、Hono 等 Node Web 框架。流式消息采用 SSE，其他操作采用 JSON API。
- 服务端默认没有文件、命令或其他业务工具；只有宿主显式注册的确认动作会暴露给模型。

### 3.2 浏览器客户端：`pi-chatbox-kit/client`

```ts
const client = createChatboxClient({ baseUrl: "/api/chatbox" });

const conversation = await client.createConversation();
await client.send(conversation.id, { text: "帮我看这张图", images: [file] });
const unsubscribe = client.subscribe(conversation.id, (event) => { /* 更新界面 */ });
await client.cancel(conversation.id);

const models = await client.listModels(); // 含 inputCapabilities，例如 image
await client.setModel(conversation.id, { provider: "openai", modelId: "..." });

await client.credentials.setApiKey({ provider: "openai", scope: "user", apiKey });
await client.credentials.setApiKey({ provider: "openai", scope: "app", apiKey }); // 管理员
await client.credentials.setPreferredSource({ provider: "openai", source: "user" });
const credentialStatus = await client.credentials.getStatus();
// 状态包含可用来源和当前来源，不包含任何明文密钥。
await client.settings.update({ scope: "user", defaultModel: { provider: "openai", modelId: "..." } });
await client.settings.update({ scope: "app", defaultModel: { provider: "openai", modelId: "..." } }); // 管理员
const auth = await client.credentials.startLogin("openai-codex");
// auth 返回设备码、验证地址、有效期和流程 ID；不会返回 OAuth token。
await client.credentials.getLoginStatus(auth.flowId);
await client.credentials.cancelLogin(auth.flowId);
await client.credentials.disconnect("openai-codex");

await client.confirm({ requestId, value: editedValue });
await client.reject({ requestId });
```

客户端公开会话列表／读取、发送、订阅、取消、选择模型、个人或 APP 默认模型、凭据来源、认证状态和确认卡操作。读取接口不返回明文 API key 或 OAuth token。`scope: "app"` 的写操作需服务端管理员授权。

### 3.3 确认动作：服务端注册，React 端注册模版

```ts
// Node：只有用户确认后，才调用 onConfirm。
const publishDraft = defineConfirmation({
  id: "publishDraft",
  description: "发布已经由用户审核的草稿",
  inputSchema: Type.Object({
    title: Type.String(),
    body: Type.String(),
  }),
  presentation: {
    title: "确认发布",
    fields: [
      { path: "title", label: "标题", editable: true },
      { path: "body", label: "正文", editable: true, multiline: true },
    ],
    confirmLabel: "发布",
  },
  onConfirm: async ({ value, principal, conversationId, idempotencyKey }) => {
    return publishToApp(value, principal.userId, idempotencyKey);
  },
});

// React：可用默认模版，也可由 APP 替换整张卡的 UI。
<ChatBox
  client={client}
  confirmationRenderers={{ publishDraft: PublishDraftCard }}
/>;
```

`PublishDraftCard` 接收 `proposedValue`、`status`、`confirm(editedValue)`、`reject()`。服务端再次校验编辑后的值和当前用户权限。确认请求使用服务端生成的 `requestId`；重复点击或重复请求不得重复触发动作。`idempotencyKey` 传给业务回调，便于业务系统处理进程重启等情况下的重复提交。

### 3.4 React UI：`pi-chatbox-kit/react`

```tsx
<ChatboxProvider client={client}>
  <ChatBox confirmationRenderers={{ publishDraft: PublishDraftCard }} />
  <LLMSettings />
</ChatboxProvider>
```

- `ChatBox` 提供默认的消息列表、输入框、模型选择、流式状态和确认卡占位；各部分可通过组件属性／插槽替换。
- `LLMSettings` 提供提供方、API key、模型及兼容接口地址的表单，以及 ChatGPT（Codex）连接／断开入口。
- React 组件不直接 import Pi 的 Node 代码，不直接读取或保存凭据。

## 4. 功能行为与验收标准

### 4.0 自定义 API 接入（补充，2026-09-25）

- 用户或管理员可新增兼容 API 接入，填写 Base URL、协议类型、模型编号和显示名称；模型配置覆盖推理、图片输入、上下文窗口、最大输出、费用、采样参数、思考级别映射、输入限制、缓存和兼容参数。
- 首版 UI 支持 Pi 的 `openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai` 协议。其他协议由宿主通过自定义 Pi `Provider` 接入。
- 个人接入只对该用户可见，APP 接入对所有用户可见但仅管理员可修改；API key 独立于公开的端点和模型元数据存储。可选无密钥模式用于本地服务。
- 新模型保存后出现在模型选择器中，选中后的请求使用填写的协议、Base URL、模型编号及参数；服务端验证输入并拒绝非法协议、URL 和模型配置。

### 4.1 LLM 设置与认证

- 用户可以为 APP 已开放的提供方配置个人 API key、默认模型和允许编辑的兼容接口地址；管理员可以配置 APP 级的对应值。模型列表显示文字／图片等输入能力。连接失败给出可理解的错误，不泄露密钥。
- APP 在服务端定义允许使用的提供方和自定义模型；用户设置 UI 只能修改 APP 开放的字段（例如模型、API key、兼容接口地址），不能通过请求任意新增服务端工具。
- 设置页分别展示“我的配置”和“APP 配置”；普通用户只能查看 APP 凭据是否可用以及管理员开放的模型，管理员可以设置／替换／删除 APP 凭据和默认模型。混合模式显示当前请求会使用哪一方的凭据。
- 模型选择顺序：会话内显式选择、用户默认、APP 默认、服务端初始值。管理员控制允许的模型范围；用户不能通过前端指定未获准的模型或提供方。
- ChatGPT 登录使用 Pi 的 `openai-codex` 提供方，UI 让用户选择浏览器或设备码流程，并显示验证地址、设备码和有效期，以及等待、成功、过期、取消状态；服务端完成登录、令牌刷新和退出。宿主可用 `preferredMethod` 预选一种流程。它与 OpenAI API key 配置是两个独立的提供方路径。[Pi OAuth 说明](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)、[设备码实现](https://github.com/earendil-works/pi/blob/main/packages/ai/src/auth/oauth/openai-codex.ts)
- 凭据只在 Node 端存取；浏览器只接收脱敏状态。公开服务由宿主提供用户认证；只有经宿主授权的管理员能修改 APP 凭据。所有会话仍按用户隔离，即使多个用户选用同一 APP 凭据。[OpenAI Docs 的服务端密钥建议](https://developers.openai.com/api/docs/guides/production-best-practices)

### 4.2 基础聊天

- 支持创建、读取和继续会话，流式显示 AI 文本，取消正在运行的请求，显示错误并重试失败的发送。
- 重试普通对话不得自动重放已经确认的业务动作；业务动作失败时必须展示结果，并由用户重新确认后才能再次执行。
- 页面刷新后可以恢复历史消息；同一用户只能读取自己的会话。
- APP 可为会话提供系统提示词与注册的业务动作；模型不得仅凭文本回复触发业务动作。

### 4.3 图片输入与预览

- 当所选模型声明支持图片时，输入框可粘贴或选择多张图片；发送前展示缩略图、文件名和移除按钮，发送后在用户消息中展示图片。
- 不支持图片的模型禁用图片入口；若用户在已选图后切换模型，保留草稿并提示先移除图片或换回支持图片的模型，禁止静默丢弃。
- 前后端均校验文件 MIME、数量和大小，限制由 APP 配置；默认支持 PNG、JPEG、WebP、GIF，具体提供方兼容性以 Pi 模型能力与请求结果为准。[Pi 图片能力判断](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)

### 4.4 确认卡

- 模型通过注册的结构化工具提出待确认数据；UI 不从普通文本中猜测确认卡。
- 默认模版依据 `presentation` 展示内容及可编辑字段；APP 可传入自定义 React 组件。卡片至少有待确认、提交中、成功、拒绝、失败状态。
- 用户确认前业务回调不得执行。编辑后服务端重新校验 schema 和权限；拒绝后不得执行。执行结果作为工具结果加入会话，供 AI 继续回复。
- 确认请求按会话顺序处理。页面刷新后能恢复仍在运行的服务端进程中的待确认卡；进程重启后无法恢复的请求标记过期，不自动执行业务动作。

## 5. 首版交付范围

- 一个 npm 包，含 `server`、`client`、`react` 独立入口和 TypeScript 类型。
- 最小示例 APP：设置 API key／ChatGPT（Codex）、纯文本对话、图片对话、可编辑的“发布草稿”确认卡。
- README、调用方接口文档、关键行为测试：凭据隔离、图片能力限制、确认前不执行、编辑校验、拒绝与重复确认。

## 6. 已定的技术基线

- 最低 Node.js 22；React 18.2 或 19。
- 包名 `pi-chatbox-kit` 是首版暂定名称，正式发布前可以更换。
- ChatGPT（Codex）登录固定为用户个人设备码登录；管理员共享配置不包含 OAuth 令牌。
