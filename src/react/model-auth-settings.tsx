import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ChatboxClient } from "../client/index.js";
import type { CredentialStatus, LoginStatus, ModelCheckResult, ModelInfo } from "../shared.js";
import { CustomApiSettings } from "./custom-api-settings.js";

const isUnsupportedRegion = (message: string) => message.includes("unsupported_country_region_territory");
const loginErrorMessage = (message: string) => isUnsupportedRegion(message)
  ? "OpenAI 返回 403：当前服务端网络出口所在地区不受支持。登录请求尚未进入授权步骤；更换模型或 API Key 无法解决。"
  : message;
const loginOptionLabel = (id: string, label: string) => id === "browser" ? "浏览器登录" : id === "device_code" ? "设备码登录" : label;

export interface ModelAuthSettingsProps {
  client: ChatboxClient;
  title?: string;
}

/** Embeddable API Key / OAuth setup panel. All credentials remain on the server. */
export function ModelAuthSettings({ client, title = "AI 登录" }: ModelAuthSettingsProps) {
  const [tab, setTab] = useState<"oauth" | "api-key">("api-key");
  const [scope, setScope] = useState<"user" | "app">("user");
  const [settings, setSettings] = useState<Awaited<ReturnType<ChatboxClient["settings"]["get"]>>>();
  const [statuses, setStatuses] = useState<CredentialStatus[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [oauthProvider, setOauthProvider] = useState("");
  const [oauthModel, setOauthModel] = useState("");
  const [flow, setFlow] = useState<LoginStatus>();
  const [answer, setAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<ModelCheckResult>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const [nextSettings, nextStatuses, nextModels] = await Promise.all([client.settings.get(), client.credentials.getStatus(), client.listModels()]);
    setSettings(nextSettings); setStatuses(nextStatuses); setModels(nextModels);
    setOauthProvider((current) => current || nextSettings.capabilities.oauthProviders[0]?.id || "");
    window.dispatchEvent(new Event("pi-chatbox-models-changed"));
  }, [client]);
  useEffect(() => { void refresh().catch((cause: unknown) => setError(String(cause))); }, [refresh]);
  useEffect(() => {
    if (!flow || flow.status !== "waiting") return;
    const timer = setInterval(() => void client.credentials.getLoginStatus(flow.flowId).then((next) => {
      setFlow(next);
      if (next.status === "success") { setNotice("订阅账户已连接"); void refresh(); }
    }).catch((cause: unknown) => setError(String(cause))), 1000);
    return () => clearInterval(timer);
  }, [client, flow?.flowId, flow?.status, refresh]);
  useEffect(() => { const first = models.find((model) => model.provider === oauthProvider && model.allowed); setOauthModel((current) => models.some((model) => model.provider === oauthProvider && model.modelId === current) ? current : first?.modelId ?? ""); setCheck(undefined); }, [models, oauthProvider]);

  const providerStatus = statuses.find((item) => item.provider === oauthProvider);
  const available = models.filter((model) => model.provider === oauthProvider && model.allowed);
  const configured = providerStatus?.userConfigured ?? false;
  const connect = async () => { setError(""); setNotice(""); setFlow(undefined); setAnswer(""); try { setFlow(await client.credentials.startLogin(oauthProvider)); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const submitAnswer = async (event: FormEvent) => { event.preventDefault(); if (!flow) return; try { setFlow(await client.credentials.answerLoginPrompt(flow.flowId, answer)); setAnswer(""); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  const verify = async () => {
    setChecking(true); setError(""); setCheck(undefined);
    try { setCheck(await client.testModel({ provider: oauthProvider, modelId: oauthModel })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setChecking(false); }
  };
  const setDefault = async () => {
    try { await client.settings.update({ scope: "user", defaultModel: { provider: oauthProvider, modelId: oauthModel } }); await refresh(); setNotice("已设为默认模型"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return <section className="pi-chatbox-model-auth" style={{ display: "grid", gap: 20, padding: 24, border: "1px solid #e0e2dc", borderRadius: 18, background: "#fbfaf6", color: "#24332c", maxWidth: 760 }}>
    <header style={{ borderBottom: "1px solid #e0e2dc", paddingBottom: 18 }}><small style={{ color: "#9b633f", letterSpacing: ".12em", fontWeight: 700 }}>模型与凭证</small><h2 style={{ fontSize: 30, margin: "8px 0" }}>{title}</h2><p style={{ color: "#738078", margin: 0 }}>订阅账户和 API Key 可分别保存；凭据仅在服务端使用。</p></header>
    <div role="tablist" aria-label="登录方式" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, background: "#eeeee9", padding: 5, borderRadius: 12 }}>
      <button type="button" role="tab" aria-selected={tab === "oauth"} onClick={() => setTab("oauth")} style={{ border: 0, borderRadius: 9, padding: 11, background: tab === "oauth" ? "white" : "transparent", fontWeight: tab === "oauth" ? 700 : 400 }}>订阅账户 OAuth</button>
      <button type="button" role="tab" aria-selected={tab === "api-key"} onClick={() => setTab("api-key")} style={{ border: 0, borderRadius: 9, padding: 11, background: tab === "api-key" ? "white" : "transparent", fontWeight: tab === "api-key" ? 700 : 400 }}>API Key</button>
    </div>
    {tab === "api-key" ? <div role="tabpanel" style={{ display: "grid", gap: 14 }}>
      {statuses.some((status) => status.canManageApp) && <label>配置范围 <select value={scope} onChange={(event) => setScope(event.target.value as "user" | "app")}><option value="user">我的配置</option><option value="app">APP 管理员配置</option></select></label>}
      {settings?.capabilities.allowCustomProviders ? <CustomApiSettings client={client} scope={scope} configs={(scope === "user" ? settings.user : settings.app).customProviders ?? []} onChanged={refresh} /> : <p>宿主尚未启用自定义 API 接入。</p>}
    </div> : <div role="tabpanel" style={{ display: "grid", gap: 16 }}>
      <label>供应商 <select value={oauthProvider} onChange={(event) => { setOauthProvider(event.target.value); setFlow(undefined); setError(""); }} style={{ width: "100%" }}>{settings?.capabilities.oauthProviders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {!settings?.capabilities.oauthProviders.length && <p>宿主尚未启用 Pi OAuth 提供方。</p>}
      {oauthProvider && <div style={{ padding: 16, border: "1px solid #d9e1da", borderRadius: 12, background: "#f7f9f6", display: "grid", gap: 10 }}><strong>{oauthProvider} {configured ? "· 已连接" : "· 未连接"}</strong><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button type="button" disabled={flow?.status === "waiting"} onClick={() => void connect()}>{flow?.status === "waiting" ? "登录进行中…" : configured ? "刷新凭证／重新登录" : "连接订阅账户"}</button>{configured && <button type="button" onClick={() => void client.credentials.disconnect(oauthProvider).then(refresh).then(() => setNotice("已断开连接")).catch((cause: unknown) => setError(String(cause)))}>删除凭证</button>}</div></div>}
      {flow && <div role="status" style={{ padding: 14, borderRadius: 12, background: "#eef3ef", display: "grid", gap: 8 }}><strong>登录状态：{flow.status}</strong>{flow.message && <span>{flow.message}</span>}{flow.authUrl && <a href={flow.authUrl} target="_blank" rel="noreferrer">打开授权页面</a>}{flow.verificationUri && <a href={flow.verificationUri} target="_blank" rel="noreferrer">打开设备码验证页面</a>}{flow.userCode && <strong>设备码：{flow.userCode}</strong>}{flow.prompt && <form onSubmit={(event) => void submitAnswer(event)} style={{ display: "grid", gap: 8 }}><label>{flow.prompt.type === "select" ? "选择登录方式" : flow.prompt.type === "manual_code" ? "浏览器登录完成后，如未自动返回，请粘贴授权码或最终跳转 URL" : flow.prompt.message}{flow.prompt.type === "select" ? <select value={answer} onChange={(event) => setAnswer(event.target.value)}><option value="">请选择</option>{flow.prompt.options?.map((option) => <option key={option.id} value={option.id}>{loginOptionLabel(option.id, option.label)}</option>)}</select> : <input type={flow.prompt.type === "secret" ? "password" : "text"} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={flow.prompt.placeholder} />}</label><button type="submit" disabled={!answer.trim()}>继续登录</button></form>}{flow.error && <span role="alert">{loginErrorMessage(flow.error)}{isUnsupportedRegion(flow.error) && <> <a href="https://developers.openai.com/api/docs/supported-countries" target="_blank" rel="noreferrer">查看 OpenAI 支持地区</a></>}</span>}{flow.status === "waiting" && <button type="button" onClick={() => void client.credentials.cancelLogin(flow.flowId).then(setFlow).catch((cause: unknown) => setError(String(cause)))}>取消登录</button>}</div>}
      {available.length > 0 && <><label>模型 <select value={oauthModel} onChange={(event) => setOauthModel(event.target.value)} style={{ width: "100%" }}>{available.map((model) => <option key={model.modelId} value={model.modelId}>{model.name}</option>)}</select></label><div style={{ display: "flex", gap: 8 }}><button type="button" disabled={!oauthModel} onClick={() => void setDefault()}>设为默认模型</button><button type="button" disabled={!oauthModel || checking} onClick={() => void verify()}>{checking ? "验证中…" : "发送 hello 验证"}</button></div>{check && <p role="status">已连接 · {check.latencyMs}ms · {check.reply}</p>}</>}
    </div>}
    {notice && <p role="status" style={{ color: "#2c7044" }}>{notice}</p>}{error && <p role="alert" style={{ color: "#a33" }}>{error}</p>}
  </section>;
}
