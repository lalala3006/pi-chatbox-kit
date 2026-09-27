import { useEffect, useState, type FormEvent } from "react";
import type { ChatboxClient } from "../client/index.js";
import type { CredentialScope, CustomApiProtocol, CustomEndpointConfig, CustomModelConfig, ModelCheckResult } from "../shared.js";

const protocols: Array<{ id: CustomApiProtocol; label: string }> = [
  { id: "openai-completions", label: "OpenAI Chat Completions" },
  { id: "openai-responses", label: "OpenAI Responses" },
  { id: "anthropic-messages", label: "Anthropic Messages" },
  { id: "google-generative-ai", label: "Google Generative AI" },
];
const emptyModel = (): CustomModelConfig => ({ id: "", name: "", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 8192 });
const emptyEndpoint = (): CustomEndpointConfig => ({ id: "", name: "", baseUrl: "", api: "openai-completions", authMode: "api-key", models: [emptyModel()] });
const advancedFor = (model: CustomModelConfig) => JSON.stringify(Object.fromEntries(
  (["cost", "samplingParams", "thinkingLevelMap", "inputLimits", "promptCache", "compat"] as const)
    .filter((key) => model[key] !== undefined).map((key) => [key, model[key]])), null, 2);
const parseObject = (text: string, label: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(text || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}必须是 JSON 对象`);
  return value as Record<string, unknown>;
};

export interface CustomApiSettingsProps {
  client: ChatboxClient;
  scope: CredentialScope;
  configs: CustomEndpointConfig[];
  onChanged: () => Promise<void>;
}

export function CustomApiSettings({ client, scope, configs, onChanged }: CustomApiSettingsProps) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [form, setForm] = useState<CustomEndpointConfig>(emptyEndpoint);
  const [advanced, setAdvanced] = useState<string[]>(["{}"]);
  const [compatText, setCompatText] = useState("{}");
  const [editingModel, setEditingModel] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<Set<string>>(() => new Set());
  const [checks, setChecks] = useState<Record<string, ModelCheckResult | string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { setOpen(false); setEditingId(undefined); setForm(emptyEndpoint()); setAdvanced(["{}"]); setCompatText("{}"); setEditingModel(0); setApiKey(""); setChecks({}); setChecking(new Set()); setError(""); }, [scope]);

  const begin = (config?: CustomEndpointConfig) => {
    setForm(config ? structuredClone(config) : emptyEndpoint());
    setAdvanced(config ? config.models.map(advancedFor) : ["{}"]);
    setCompatText(JSON.stringify(config?.compat ?? {}, null, 2));
    setEditingModel(0); setEditingId(config?.id);
    setApiKey(""); setError(""); setNotice(""); setOpen(true);
  };
  const updateModel = (index: number, patch: Partial<CustomModelConfig>) => setForm((current) => ({ ...current, models: current.models.map((model, i) => i === index ? { ...model, ...patch } : model) }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const compat = parseObject(compatText, "兼容配置");
      const models = form.models.map((model, index) => {
        const extra = parseObject(advanced[index] || "{}", `模型 ${index + 1} 的高级配置`);
        const allowed = ["cost", "samplingParams", "thinkingLevelMap", "inputLimits", "promptCache", "compat"];
        if (Object.keys(extra).some((key) => !allowed.includes(key))) throw new Error(`模型 ${index + 1} 的高级配置包含不支持的字段`);
        return { ...model, ...extra } as CustomModelConfig;
      });
      const next = { ...form, compat, models, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) };
      const previous = configs.find((config) => config.id === form.id);
      let replacementName = "";
      try {
        await client.customProviders.save(scope, next);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (!previous || !["Default model must remain configured", "Remove excluded models from the allowed list first"].includes(message)) throw cause;
        // Older demo servers reject the edit. Move their default and allow-list first;
        // current servers perform this reconciliation atomically in upsertCustomProvider.
        const settings = await client.settings.get();
        const provider = `custom-${scope}-${form.id}`;
        const currentDefault = settings[scope].defaultModel;
        const removedDefault = currentDefault?.provider === provider && !models.some((model) => model.id === currentDefault.modelId);
        let allowed = scope === "app" ? settings.app.allowedModels : undefined;
        if (removedDefault) {
          const replacement = models.find((model) => previous.models.some((old) => old.id === model.id)) ?? models[0]!;
          const replacementRef = { provider, modelId: replacement.id };
          if (!previous.models.some((model) => model.id === replacement.id)) {
            await client.customProviders.save(scope, { ...next, models: [...previous.models, replacement] });
          }
          if (scope === "app" && allowed?.length && !allowed.some((ref) => ref.provider === provider && ref.modelId === replacement.id)) {
            allowed = [...allowed, replacementRef];
            await client.settings.update({ scope: "app", allowedModels: allowed });
          }
          await client.settings.update({ scope, defaultModel: replacementRef });
          replacementName = replacement.name || replacement.id;
        }
        if (scope === "app" && allowed?.some((ref) => ref.provider === provider && !models.some((model) => model.id === ref.modelId))) {
          await client.settings.update({ scope: "app", allowedModels: allowed.filter((ref) => ref.provider !== provider || models.some((model) => model.id === ref.modelId)) });
        }
        await client.customProviders.save(scope, next);
      }
      await onChanged();
      setChecks({});
      setNotice(replacementName ? `API 接入已保存；默认模型已切换为 ${replacementName}。` : "API 接入已保存。可在聊天框的模型选择器中使用。");
      setOpen(false); setApiKey("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const remove = async (config: CustomEndpointConfig) => {
    if (!window.confirm(`删除 ${config.name || config.id}？使用它的旧会话将无法继续发送。`)) return;
    setBusy(true); setError("");
    try { await client.customProviders.delete(scope, config.id); await onChanged(); setChecks({}); setNotice("API 接入已删除"); if (editingId === config.id) setOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const check = async (config: CustomEndpointConfig, model: CustomModelConfig) => {
    const key = JSON.stringify([scope, config.id, model.id]);
    setChecking((current) => new Set(current).add(key));
    setChecks((current) => { const next = { ...current }; delete next[key]; return next; });
    try { const result = await client.testModel({ provider: `custom-${scope}-${config.id}`, modelId: model.id }); setChecks((current) => ({ ...current, [key]: result })); }
    catch (cause) { setChecks((current) => ({ ...current, [key]: cause instanceof Error ? cause.message : String(cause) })); }
    finally { setChecking((current) => { const next = new Set(current); next.delete(key); return next; }); }
  };
  const flag = (name: string) => {
    try { const value = parseObject(compatText, "兼容配置")[name]; return typeof value === "boolean" ? String(value) : "default"; }
    catch { return "default"; }
  };
  const setFlag = (name: string, value: string) => {
    try { const next = parseObject(compatText, "兼容配置"); if (value === "default") delete next[name]; else next[name] = value === "true"; setCompatText(JSON.stringify(next, null, 2)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const preview = { [form.id || "provider-id"]: { baseUrl: form.baseUrl, api: form.api, apiKey: form.authMode === "none" ? undefined : apiKey ? "••••（提交时使用输入的密钥）" : "（已保存或稍后配置）", compat: (() => { try { return parseObject(compatText, "兼容配置"); } catch { return "JSON 尚未完成"; } })(), models: form.models.map((model, index) => { try { return { ...model, ...parseObject(advanced[index] ?? "{}", "模型高级配置") }; } catch { return { ...model, advanced: "JSON 尚未完成" }; } }) } };

  return <section className="pi-chatbox-custom-api" style={{ borderTop: "1px solid #e3e8ef", paddingTop: 12, display: "grid", gap: 10 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><strong>{scope === "user" ? "我的 API Key 接入" : "APP API Key 接入"}</strong><button type="button" onClick={() => open ? setOpen(false) : begin()}>{open ? "收起表单" : "新增接入"}</button></div>
    {configs.length > 0 && <div style={{ display: "grid", gap: 6 }}>{configs.map((config) => <div key={config.id} style={{ padding: 9, borderRadius: 8, background: "#f4f6fb", display: "grid", gap: 4 }}>
      <strong>{config.name || config.id}</strong><small>{config.api} · {config.models.length} 个模型</small><small style={{ overflowWrap: "anywhere" }}>{config.baseUrl}</small>
      {config.models.map((model) => { const key = JSON.stringify([scope, config.id, model.id]); const result = checks[key]; const isChecking = checking.has(key); return <div key={model.id} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}><span>{model.name || model.id}</span><button type="button" disabled={isChecking} onClick={() => void check(config, model)}>{isChecking ? "验证中…" : "发送 hello 验证"}</button>{result && <small role={typeof result === "string" ? "alert" : "status"}>{typeof result === "string" ? result : `已连接 · ${result.latencyMs}ms · ${result.reply}`}</small>}</div>; })}
      <div style={{ display: "flex", gap: 6 }}><button type="button" onClick={() => begin(config)}>编辑</button><button type="button" disabled={busy} onClick={() => void remove(config)}>删除</button></div>
    </div>)}</div>}
    {open && <form onSubmit={(event) => void save(event)} style={{ display: "grid", gap: 10 }}>
      <label>Provider ID <input required disabled={!!editingId} value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })} placeholder="siliconflow" style={{ width: "100%" }} /></label>
      <label>显示名称（可选） <input value={form.name ?? ""} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="SiliconFlow" style={{ width: "100%" }} /></label>
      <label>Base URL <input required type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://example.com/v1" style={{ width: "100%" }} /></label>
      <label>协议类型 <select value={form.api} onChange={(event) => setForm({ ...form, api: event.target.value as CustomApiProtocol })} style={{ width: "100%" }}>{protocols.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.label}</option>)}</select></label>
      <label>认证方式 <select value={form.authMode} onChange={(event) => { setForm({ ...form, authMode: event.target.value as CustomEndpointConfig["authMode"] }); setApiKey(""); }} style={{ width: "100%" }}><option value="api-key">API key</option><option value="none">无需密钥（本地服务）</option></select></label>
      {form.authMode === "api-key" && <label>API Key <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={editingId ? "留空沿用已保存的密钥" : "sk-...；可稍后配置"} style={{ width: "100%" }} /></label>}
      <small>API Key 单独交给服务端凭据存储，读取配置时不会返回明文。</small>
      <strong>提供方 compat</strong>
      {([['supportsDeveloperRole', '支持 developer role'], ['supportsReasoningEffort', '支持 reasoning_effort']] as const).map(([key, label]) => <label key={key}>{label} <select value={flag(key)} onChange={(event) => setFlag(key, event.target.value)}><option value="default">自动判断</option><option value="true">是</option><option value="false">否</option></select></label>)}
      <label>完整 compat JSON <textarea value={compatText} onChange={(event) => setCompatText(event.target.value)} spellCheck={false} style={{ width: "100%", minHeight: 72, fontFamily: "monospace" }} /></label>
      <strong>模型配置</strong>
      {form.models.map((model, index) => <div key={index} style={{ display: "flex", alignItems: "center", gap: 6, padding: 8, borderRadius: 8, background: editingModel === index ? "#eef3ef" : "#f6f7f5" }}><span style={{ flex: 1 }}>{model.name || model.id || `新模型 ${index + 1}`}</span><button type="button" onClick={() => setEditingModel(index)}>{editingModel === index ? "编辑中" : "编辑"}</button><button type="button" onClick={() => { setForm((current) => ({ ...current, models: current.models.filter((_, i) => i !== index) })); setAdvanced((current) => current.filter((_, i) => i !== index)); setEditingModel((current) => Math.min(current, Math.max(0, form.models.length - 2))); }}>删除</button></div>)}
      {form.models.map((model, index) => editingModel === index && <fieldset key={index} style={{ border: "1px solid #dce3ed", borderRadius: 9, padding: 10, display: "grid", gap: 7 }}>
        <legend>模型 {index + 1}</legend>
        <label>模型编号 <input required value={model.id} onChange={(event) => updateModel(index, { id: event.target.value })} placeholder="model-id" style={{ width: "100%" }} /></label>
        <label>显示名称 <input value={model.name ?? ""} onChange={(event) => updateModel(index, { name: event.target.value })} placeholder="可与模型编号相同" style={{ width: "100%" }} /></label>
        <label>上下文窗口 <input required type="number" min="1" value={model.contextWindow ?? 128000} onChange={(event) => updateModel(index, { contextWindow: Number(event.target.value) })} style={{ width: "100%" }} /></label>
        <label>最大输出 Token <input required type="number" min="1" value={model.maxTokens ?? 8192} onChange={(event) => updateModel(index, { maxTokens: Number(event.target.value) })} style={{ width: "100%" }} /></label>
        <label><input type="checkbox" checked={model.reasoning ?? false} onChange={(event) => updateModel(index, { reasoning: event.target.checked })} /> 支持推理</label>
        <label><input type="checkbox" checked={model.input?.includes("image") ?? false} onChange={(event) => updateModel(index, { input: event.target.checked ? ["text", "image"] : ["text"] })} /> 支持图片输入</label>
        <label>高级配置 JSON（cost、samplingParams、compat 等）<textarea value={advanced[index] ?? "{}"} onChange={(event) => setAdvanced((current) => current.map((item, i) => i === index ? event.target.value : item))} spellCheck={false} style={{ width: "100%", minHeight: 95, fontFamily: "monospace", fontSize: 12 }} /></label>
      </fieldset>)}
      <button type="button" onClick={() => { setForm((current) => ({ ...current, models: [...current.models, emptyModel()] })); setAdvanced((current) => [...current, "{}"]); setEditingModel(form.models.length); }}>添加模型</button>
      <details><summary>预览生成的配置 JSON（密钥已隐藏）</summary><pre style={{ overflowX: "auto", whiteSpace: "pre-wrap", fontSize: 11 }}>{JSON.stringify(preview, null, 2)}</pre></details>
      <button type="submit" disabled={busy || form.models.length === 0}>{busy ? "保存中…" : "保存 API 接入"}</button>
    </form>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
