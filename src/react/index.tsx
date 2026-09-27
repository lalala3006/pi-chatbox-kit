import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ChatboxClient } from "../client/index.js";
import type { CredentialStatus, LoginStatus, ModelInfo, ModelRef } from "../shared.js";
import { CustomApiSettings } from "./custom-api-settings.js";
import { useClient } from "./context.js";
export { ChatboxProvider } from "./context.js";
export { ChatBox, DefaultConfirmationCard } from "./chat-box.js";
export type { ChatBoxProps, ConfirmationRenderer, ConfirmationRendererProps } from "./chat-box.js";
export { CustomApiSettings } from "./custom-api-settings.js";
export type { CustomApiSettingsProps } from "./custom-api-settings.js";
export { ModelAuthSettings } from "./model-auth-settings.js";
export type { ModelAuthSettingsProps } from "./model-auth-settings.js";

export function LLMSettings({ client: override }: { client?: ChatboxClient }) {
  const client = useClient(override);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [statuses, setStatuses] = useState<CredentialStatus[]>([]);
  const [selected, setSelected] = useState("");
  const [scope, setScope] = useState<"user" | "app">("user");
  const [apiKey, setApiKey] = useState("");
  const [flow, setFlow] = useState<LoginStatus>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<Awaited<ReturnType<ChatboxClient["settings"]["get"]>>>();
  const [baseUrl, setBaseUrl] = useState("");
  const [restricted, setRestricted] = useState(false);
  const [allowedIds, setAllowedIds] = useState<string[]>([]);
  const refresh = useCallback(async () => { const [nextModels, nextStatuses, nextSettings] = await Promise.all([client.listModels(), client.credentials.getStatus(), client.settings.get()]); setModels(nextModels); setStatuses(nextStatuses); setSettings(nextSettings); setSelected((old) => old || nextStatuses[0]?.provider || ""); window.dispatchEvent(new Event("pi-chatbox-models-changed")); }, [client]);
  useEffect(() => { void refresh().catch((cause: unknown) => setError(String(cause))); }, [refresh]);
  useEffect(() => { setBaseUrl((scope === "user" ? settings?.user.baseUrls : settings?.app.baseUrls)?.[selected] ?? ""); }, [scope, selected, settings]);
  useEffect(() => {
    const configured = settings?.app.allowedModels;
    setRestricted(!!configured?.length);
    setAllowedIds((configured?.length ? configured : models).map((model) => `${model.provider}:${model.modelId}`));
  }, [settings, models]);
  useEffect(() => {
    if (!flow || flow.status !== "waiting") return;
    const timer = setInterval(() => void client.credentials.getLoginStatus(flow.flowId).then((next) => { setFlow(next); if (next.status === "success") void refresh(); }).catch((cause: unknown) => setError(String(cause))), 2000);
    return () => clearInterval(timer);
  }, [client, flow?.flowId, flow?.status, refresh]);
  const status = statuses.find((item) => item.provider === selected);
  const selectedCustomScope = selected.startsWith("custom-user-") ? "user" : selected.startsWith("custom-app-") ? "app" : undefined;
  const selectedConfig = selectedCustomScope ? settings?.[selectedCustomScope].customProviders?.find((config) => `custom-${selectedCustomScope}-${config.id}` === selected) : undefined;
  const canEditKey = !!status && (scope === "user" ? status.policy.mode !== "app-only" : status.policy.mode !== "user-only") && selectedConfig?.authMode !== "none";
  const currentDefault = scope === "user" ? settings?.user.defaultModel : settings?.app.defaultModel;
  const currentDefaultIndex = models.findIndex((model) => model.provider === currentDefault?.provider && model.modelId === currentDefault?.modelId);
  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
    try { await client.credentials.setApiKey({ provider: selected, scope, apiKey }); setApiKey(""); setNotice("密钥已保存"); setError(""); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const setDefault = async (model: ModelRef) => {
    try { await client.settings.update({ scope, defaultModel: model }); setNotice("默认模型已更新"); setError(""); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <section className="pi-chatbox-settings" style={{ display: "grid", gap: 12, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
    <h2>LLM 设置</h2>
    <label>配置范围 <select value={scope} onChange={(event) => setScope(event.target.value as "user" | "app")}><option value="user">我的配置</option>{statuses.some((item) => item.canManageApp) && <option value="app">APP 配置</option>}</select></label>
    <label>提供方 <select value={selected} onChange={(event) => setSelected(event.target.value)}>{statuses.map((item) => <option key={item.provider} value={item.provider}>{item.provider}</option>)}</select></label>
    {status && <p>当前使用：{status.effectiveSource === "user" ? "我的凭据" : status.effectiveSource === "app" ? "APP 凭据" : "未配置"} · 我的凭据：{status.userConfigured ? "已配置" : "未配置"} · APP 凭据：{status.appConfigured ? "已配置" : "未配置"}</p>}
    {status?.policy.mode === "user-or-app" && scope === "user" && <label>优先使用 <select value={status.preferredSource ?? status.policy.defaultSource ?? "user"} onChange={(event) => void client.credentials.setPreferredSource({ provider: selected, source: event.target.value as "user" | "app" }).then(refresh).catch((cause: unknown) => setError(String(cause)))}><option value="user">我的凭据</option><option value="app">APP 凭据</option></select></label>}
    {selected === "openai-codex" ? <div>
      <button type="button" onClick={() => void client.credentials.startLogin("openai-codex").then(setFlow).catch((cause: unknown) => setError(String(cause)))}>连接 ChatGPT（Codex）</button>
      {status?.userConfigured && <button type="button" onClick={() => void client.credentials.disconnect("openai-codex").then(refresh).catch((cause: unknown) => setError(String(cause)))}>断开</button>}
      {flow && <p>{flow.status} {flow.verificationUri && <a href={flow.verificationUri} target="_blank" rel="noreferrer">打开验证页面</a>} {flow.userCode && <strong>{flow.userCode}</strong>}</p>}
    </div> : canEditKey ? <form onSubmit={(event) => void saveKey(event)}>
      <label>API key <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>
      <button type="submit" disabled={!apiKey.trim()}>保存密钥</button>
      {(scope === "user" ? status?.userConfigured : status?.appConfigured) && <button type="button" onClick={() => void client.credentials.disconnect(selected, scope).then(refresh).catch((cause: unknown) => setError(String(cause)))}>删除密钥</button>}
    </form> : <p>{selectedConfig?.authMode === "none" ? "此接入无需 API key。" : "此提供方的密钥由另一配置范围管理。"}</p>}
    {settings?.capabilities.allowCustomBaseUrl && <form onSubmit={(event) => { event.preventDefault(); void client.settings.update({ scope, baseUrls: { [selected]: baseUrl } }).then(() => { setNotice("接口地址已更新"); return refresh(); }).catch((cause: unknown) => setError(String(cause))); }}>
      <label>兼容接口地址 <input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://..." /></label>
      <button type="submit">保存地址</button>
    </form>}
    <label>默认模型 <select value={currentDefaultIndex < 0 ? "" : currentDefaultIndex} onChange={(event) => { const model = models[Number(event.target.value)]; if (model) void setDefault(model); }}>
      <option value="" disabled>选择模型</option>
      {models.map((model, index) => model.allowed && <option key={`${model.provider}:${model.modelId}`} value={index}>{model.providerName ?? model.provider} · {model.name}{model.inputCapabilities.includes("image") ? " · 图片" : ""}</option>)}
    </select></label>
    {scope === "app" && <details>
      <summary>允许使用的模型</summary>
      <label><input type="checkbox" checked={restricted} onChange={(event) => setRestricted(event.target.checked)} /> 限制模型范围</label>
      {restricted && <div style={{ maxHeight: 220, overflowY: "auto", display: "grid" }}>{models.filter((model) => !model.provider.startsWith("custom-user-")).map((model) => {
        const key = `${model.provider}:${model.modelId}`;
        return <label key={key}><input type="checkbox" checked={allowedIds.includes(key)} onChange={(event) => setAllowedIds((current) => event.target.checked ? [...current, key] : current.filter((id) => id !== key))} /> {model.provider} · {model.name}</label>;
      })}</div>}
      <button type="button" disabled={restricted && !allowedIds.length} onClick={() => void client.settings.update({ scope: "app", allowedModels: restricted ? models.filter((model) => !model.provider.startsWith("custom-user-") && allowedIds.includes(`${model.provider}:${model.modelId}`)).map(({ provider, modelId }) => ({ provider, modelId })) : [] }).then(() => { setNotice("模型范围已更新"); return refresh(); }).catch((cause: unknown) => setError(String(cause)))}>保存模型范围</button>
    </details>}
    {settings?.capabilities.allowCustomProviders && <CustomApiSettings client={client} scope={scope} configs={(scope === "user" ? settings.user : settings.app).customProviders ?? []} onChanged={refresh} />}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
