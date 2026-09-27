import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import type { ChatboxClient } from "../client/index.js";
import type { ChatEvent, ConfirmationRequest, ConversationSnapshot, ModelInfo } from "../shared.js";
import { useClient } from "./context.js";
import { Icon } from "./icons.js";
import { chatboxStyles } from "./chatbox-styles.js";
import { MarkdownMessage } from "./markdown-message.js";

export interface ConfirmationRendererProps {
  request: ConfirmationRequest;
  confirm: (value: Record<string, unknown>) => Promise<void>;
  reject: () => Promise<void>;
}
export type ConfirmationRenderer = (props: ConfirmationRendererProps) => ReactNode;

function readPath(value: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => current && typeof current === "object" ? (current as Record<string, unknown>)[segment] : undefined, value);
}
function writePath(value: Record<string, unknown>, path: string, next: unknown): Record<string, unknown> {
  const result = structuredClone(value);
  const segments = path.split(".");
  let target = result;
  for (const segment of segments.slice(0, -1)) {
    if (!target[segment] || typeof target[segment] !== "object") target[segment] = {};
    target = target[segment] as Record<string, unknown>;
  }
  target[segments.at(-1)!] = next;
  return result;
}

export function DefaultConfirmationCard({ request, confirm, reject }: ConfirmationRendererProps) {
  const [value, setValue] = useState<Record<string, unknown>>(request.finalValue ?? request.proposedValue);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const busy = request.status !== "pending" || submitting;
  const act = async (confirmed: boolean) => {
    setSubmitting(true); setError("");
    try { if (confirmed) await confirm(value); else await reject(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSubmitting(false); }
  };
  return <section className="pi-chatbox-confirmation">
    <div className="pi-confirmation-heading"><span className="pi-confirmation-icon"><Icon name="check" size={18} /></span><div><small>需要你的确认</small><h3>{request.presentation.title}</h3></div></div>
    {request.presentation.description && <p>{request.presentation.description}</p>}
    {request.presentation.fields.map((field) => <label key={field.path}>
      <span>{field.label}</span>
      {field.editable ? typeof readPath(request.proposedValue, field.path) === "boolean"
        ? <input type="checkbox" disabled={busy} checked={Boolean(readPath(value, field.path))} onChange={(event) => setValue(writePath(value, field.path, event.target.checked))} />
        : field.multiline
          ? <textarea disabled={busy} value={String(readPath(value, field.path) ?? "")} onChange={(event) => setValue(writePath(value, field.path, event.target.value))} />
          : <input type={typeof readPath(request.proposedValue, field.path) === "number" ? "number" : "text"} disabled={busy} value={String(readPath(value, field.path) ?? "")} onChange={(event) => setValue(writePath(value, field.path, typeof readPath(request.proposedValue, field.path) === "number" ? Number(event.target.value) : event.target.value))} />
        : <span>{String(readPath(value, field.path) ?? "")}</span>}
    </label>)}
    {request.status === "pending" ? <div className="pi-confirmation-actions">
      <button type="button" className="pi-primary-button" disabled={busy} onClick={() => void act(true)}>{submitting ? "正在提交…" : request.presentation.confirmLabel ?? "确认执行"}</button>
      <button type="button" className="pi-text-button" disabled={busy} onClick={() => void act(false)}>{request.presentation.rejectLabel ?? "取消"}</button>
    </div> : <p className="pi-confirmation-result">{({ executing: "正在执行…", success: "已完成", rejected: "已取消", error: "执行失败", expired: "已过期" } as Record<string, string>)[request.status]}</p>}
    {(error || request.error) && <p className="pi-chatbox-error" role="alert">{error || request.error}</p>}
  </section>;
}

type Preview = { src: string; name: string };
function ImagePreview({ image, onClose }: { image: Preview; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={dialogRef} className="pi-chatbox-image-dialog" aria-label="图片预览" onClose={(event) => { if (!event.currentTarget.open) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="pi-image-viewer">
      <header><span>{image.name}</span><button type="button" autoFocus aria-label="关闭图片预览" onClick={onClose}><Icon name="close" /></button></header>
      <img src={image.src} alt={image.name} />
      <p>按 Esc 关闭</p>
    </div>
  </dialog>;
}

export interface ChatBoxProps {
  client?: ChatboxClient;
  conversationId?: string;
  confirmationRenderers?: Record<string, ConfirmationRenderer>;
  onConversationChange?: (id: string) => void;
  /** Opens the host application's model settings from the composer. */
  onOpenSettings?: () => void;
  className?: string;
  style?: CSSProperties;
  emptyTitle?: string;
}

const modelKey = (model: { provider: string; modelId: string }) => JSON.stringify([model.provider, model.modelId]);
const wasAborted = (message?: string) => message === "Request was aborted";
const suggestions = [
  { icon: "spark" as const, title: "一起理清思路", text: "我有一个新想法，帮我梳理一下思路。" },
  { icon: "edit" as const, title: "写点新东西", text: "帮我发布一篇介绍新想法的短文。" },
  { icon: "image" as const, title: "聊聊这张图片", text: "我想和你聊聊一张图片。" },
];

export function ChatBox({ client: override, conversationId, confirmationRenderers = {}, onConversationChange, onOpenSettings, className = "", style, emptyTitle = "今天，想聊点什么？" }: ChatBoxProps) {
  const client = useClient(override);
  const [id, setId] = useState(conversationId);
  const [conversation, setConversation] = useState<ConversationSnapshot>();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const creating = useRef<Promise<ConversationSnapshot> | null>(null);
  const pinned = useRef(true);
  const onChangeRef = useRef(onConversationChange);
  onChangeRef.current = onConversationChange;
  useEffect(() => {
    const next = images.map((image) => URL.createObjectURL(image));
    setUrls(next);
    return () => next.forEach(URL.revokeObjectURL);
  }, [images]);
  useEffect(() => { if (conversationId) { setId(conversationId); setConversation(undefined); pinned.current = true; } }, [conversationId]);
  useEffect(() => {
    let active = true;
    const refreshModels = () => void client.listModels().then((next) => {
      if (active) { setModels(next.filter((entry) => entry.allowed && entry.configured)); setModelsLoaded(true); }
    }).catch((cause: unknown) => { if (active) setError(String(cause)); });
    refreshModels();
    window.addEventListener("pi-chatbox-models-changed", refreshModels);
    window.addEventListener("focus", refreshModels);
    return () => { active = false; window.removeEventListener("pi-chatbox-models-changed", refreshModels); window.removeEventListener("focus", refreshModels); };
  }, [client]);
  useEffect(() => {
    let active = true;
    if (!id) {
      creating.current ??= client.createConversation();
      void creating.current.then((created) => {
        if (active) { setId(created.id); setConversation(created); onChangeRef.current?.(created.id); }
      }).catch((cause: unknown) => { creating.current = null; if (active) setError(String(cause)); });
      return () => { active = false; };
    }
    void client.getConversation(id).then((next) => { if (active) setConversation(next); }).catch((cause: unknown) => { if (active) setError(String(cause)); });
    const stop = client.subscribe(id, (event: ChatEvent) => {
      if (!active) return;
      setConversation((old) => {
        if (event.type === "snapshot") return event.conversation;
        if (!old) return old;
        if (event.type === "status") return { ...old, status: event.status, error: event.error };
        if (event.type === "message") return { ...old, messages: old.messages.some((message) => message.id === event.message.id) ? old.messages.map((message) => message.id === event.message.id ? event.message : message) : [...old.messages, event.message] };
        return { ...old, confirmations: old.confirmations.some((item) => item.requestId === event.confirmation.requestId) ? old.confirmations.map((item) => item.requestId === event.confirmation.requestId ? event.confirmation : item) : [...old.confirmations, event.confirmation] };
      });
    }, () => { if (active) setError("连接暂时中断，正在重新连接…"); });
    return () => { active = false; stop(); };
  }, [client, id]);
  useLayoutEffect(() => {
    if (textRef.current) { textRef.current.style.height = "auto"; textRef.current.style.height = `${Math.min(textRef.current.scrollHeight, 168)}px`; }
  }, [draft]);
  useLayoutEffect(() => {
    if (pinned.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [conversation]);
  const model = models.find((entry) => entry.provider === conversation?.model.provider && entry.modelId === conversation?.model.modelId);
  const imageEnabled = model?.inputCapabilities.includes("image") ?? false;
  const running = conversation?.status === "running";
  const canSend = !!conversation && !!model && !running && !submitting && !switching && !!(draft.trim() || images.length) && (!images.length || imageEnabled);
  const addFiles = (files: FileList | File[]) => {
    if (!imageEnabled) { setError("当前模型不支持图片，请切换到支持图片的模型。"); return; }
    const selected = Array.from(files).filter((file) => ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type));
    if (!selected.length) { setError("请选择 PNG、JPEG、WebP 或 GIF 图片。"); return; }
    setError(""); setImages((current) => [...current, ...selected]);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!id || !canSend) return;
    setSubmitting(true); setError(""); pinned.current = true; setShowScrollButton(false);
    try { await client.send(id, { text: draft, images }); setDraft(""); setImages([]); setPreview(undefined); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSubmitting(false); textRef.current?.focus(); }
  };
  const changeModel = async (key: string) => {
    if (!id) return;
    const next = models.find((entry) => modelKey(entry) === key); if (!next) return;
    setSwitching(true);
    try { setConversation(await client.setModel(id, { provider: next.provider, modelId: next.modelId })); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSwitching(false); }
  };
  const cancel = async () => {
    if (!id) return;
    setCancelling(true);
    try { await client.cancel(id); setConversation(await client.getConversation(id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setCancelling(false); }
  };
  const decide = useCallback(async (request: ConfirmationRequest, value?: Record<string, unknown>) => {
    if (value) await client.confirm({ requestId: request.requestId, value });
    else await client.reject({ requestId: request.requestId });
  }, [client]);
  const isEmpty = !conversation?.messages.length;
  return <section className={`pi-chatbox ${className}`} style={style} aria-label="AI 对话">
    <style>{chatboxStyles}</style>
    <div className="pi-chatbox-messages" ref={scrollRef} role="log" aria-label="对话记录" aria-live="polite" onScroll={(event) => {
      const el = event.currentTarget;
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      setShowScrollButton(!pinned.current);
    }}>
      {isEmpty ? <div className="pi-chatbox-empty">
        <div className="pi-chatbox-emblem"><Icon name="spark" size={34} /></div>
        <span className="pi-chatbox-eyebrow">让想法，从这里开始</span>
        <h2>{emptyTitle}</h2><p>一个问题、一张图片，或一个还没成形的想法。</p>
        <div className="pi-chatbox-suggestions">{suggestions.filter((item) => item.icon !== "image" || imageEnabled).map((item) => <button type="button" key={item.title} onClick={() => { setDraft(item.text); textRef.current?.focus(); }}><Icon name={item.icon} size={17} />{item.title}<span>↗</span></button>)}</div>
      </div> : <div className="pi-chatbox-transcript">
        {conversation?.messages.map((message) => <article key={message.id} className={`pi-chatbox-message pi-chatbox-message-${message.role}`} aria-label={message.role === "user" ? "你的消息" : "AI 的回复"}>
          {message.role === "assistant" && <div className="pi-chatbox-avatar"><Icon name="spark" size={19} /></div>}
          <div className="pi-chatbox-message-body">
            {message.role === "assistant" && <div className="pi-chatbox-message-label">助手</div>}
            {!!message.images.length && <div className="pi-chatbox-message-images">{message.images.map((image, index) => <button type="button" key={index} className="pi-chatbox-sent-image" aria-label={`预览图片 ${image.fileName ?? index + 1}`} onClick={() => setPreview({ src: image.dataUrl, name: image.fileName ?? "上传图片" })}><img src={image.dataUrl} alt={image.fileName ?? "上传图片"} /></button>)}</div>}
            {message.text && (message.role === "assistant" ? <MarkdownMessage text={message.text} onPreviewImage={setPreview} /> : <div className="pi-chatbox-message-text">{message.text}</div>)}
            {!message.text && message.status === "streaming" && <span className="pi-chatbox-thinking" aria-label="正在思考"><i /><i /><i /></span>}
            {message.error && (wasAborted(message.error) ? <p className="pi-chatbox-stopped">已停止生成</p> : <p className="pi-chatbox-error">{message.error}</p>)}
            {conversation.confirmations.filter((request) => request.messageId === message.id).map((request) => {
              const Renderer = confirmationRenderers[request.actionId] ?? DefaultConfirmationCard;
              return <Renderer key={request.requestId} request={request} confirm={(value) => decide(request, value)} reject={() => decide(request)} />;
            })}
          </div>
        </article>)}
        {conversation?.confirmations.filter((request) => !request.messageId || !conversation.messages.some((message) => message.id === request.messageId)).map((request) => {
          const Renderer = confirmationRenderers[request.actionId] ?? DefaultConfirmationCard;
          return <Renderer key={request.requestId} request={request} confirm={(value) => decide(request, value)} reject={() => decide(request)} />;
        })}
        {(running || submitting) && !conversation?.messages.some((message) => message.status === "streaming") && <div className="pi-chatbox-working"><span className="pi-chatbox-thinking"><i /><i /><i /></span><span>{conversation?.confirmations.some((request) => request.status === "pending") ? "等待你确认后继续" : "正在思考…"}</span></div>}
      </div>}
    </div>
    <div className="pi-chatbox-bottom">
      {showScrollButton && <button className="pi-chatbox-scroll" type="button" aria-label="跳到最新消息" onClick={() => { pinned.current = true; setShowScrollButton(false); scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }}><Icon name="arrow" size={16} style={{ transform: "rotate(180deg)" }} />最新消息</button>}
      {(error || conversation?.error) && !wasAborted(error || conversation?.error) && <div className="pi-chatbox-error" role="alert"><span>{error || conversation?.error}</span><button type="button" aria-label="关闭错误提示" onClick={() => { setError(""); setConversation((old) => old && { ...old, error: undefined }); }}><Icon name="close" size={16} /></button></div>}
      {conversation?.status === "error" && !wasAborted(conversation.error) && id && <button type="button" className="pi-text-button pi-chatbox-retry" onClick={() => void client.retry(id).then(setConversation).catch((cause: unknown) => setError(String(cause)))}>重新生成回复</button>}
      {modelsLoaded && !model && <p className="pi-chatbox-model-notice">{models.length ? "当前模型已不可用，请在下方选择已配置的模型。" : "还没有可用模型，请先配置 API Key 或连接订阅账户。"}{onOpenSettings && <button type="button" className="pi-text-button" onClick={onOpenSettings}>配置模型 ↗</button>}</p>}
      <form ref={formRef} className={`pi-chatbox-composer${images.length ? " pi-chatbox-composer-with-images" : ""}`} onSubmit={(event) => void submit(event)} onPaste={(event) => {
        const pasted = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
        if (pasted.length) { event.preventDefault(); if (!submitting) addFiles(pasted); }
      }}>
        {images.length > 0 && <div className="pi-chatbox-attachments" aria-label="待发送图片">{images.map((file, index) => <div key={`${file.name}:${index}`} className="pi-chatbox-attachment">
          <button type="button" className="pi-chatbox-thumbnail" aria-label={`预览图片 ${file.name}`} title={file.name} onClick={() => setPreview({ src: urls[index]!, name: file.name })}><img src={urls[index]} alt={file.name} /></button>
          <button type="button" className="pi-chatbox-remove-image" aria-label={`移除图片 ${file.name}`} title="移除图片" disabled={submitting} onClick={() => setImages((current) => current.filter((_, item) => item !== index))}><Icon name="close" size={12} /></button>
        </div>)}</div>}
        <textarea ref={textRef} aria-label="消息" rows={1} placeholder="发送消息，聊聊你的想法…" value={draft} disabled={submitting} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); if (canSend) formRef.current?.requestSubmit(); }
        }} />
        <div className="pi-chatbox-composer-toolbar">
          <div className="pi-chatbox-composer-tools">
            <input ref={inputRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
            <button type="button" className="pi-chatbox-icon-button" aria-label="添加图片" title={imageEnabled ? "添加图片，也可直接粘贴" : "当前模型不支持图片"} disabled={!imageEnabled || submitting || switching} onClick={() => inputRef.current?.click()}><Icon name="plus" size={21} /></button>
            <div className="pi-chatbox-model-picker">
              <Icon name="spark" size={15} />
              <select aria-label="选择模型" value={model ? modelKey(model) : ""} onChange={(event) => void changeModel(event.target.value)} disabled={!conversation || running || submitting || switching || !models.length}>
                {!model && <option value="" disabled>{modelsLoaded ? models.length ? "选择模型" : "请先配置模型" : "加载模型…"}</option>}
                {models.map((entry) => <option key={modelKey(entry)} value={modelKey(entry)}>{entry.name} · {entry.providerName ?? entry.provider}</option>)}
              </select><Icon name="chevron" size={16} />
            </div>
          </div>
          <div className="pi-chatbox-send-area">{running ? <><span className="pi-chatbox-generation-label">{cancelling ? "正在停止" : "正在生成"}</span><button type="button" className="pi-chatbox-send" aria-label="中断回复" title="中断回复" disabled={cancelling} onClick={() => void cancel()}><Icon name="stop" size={20} /></button></> : <button type="submit" className="pi-chatbox-send" aria-label="发送消息" title="发送消息" disabled={!canSend}>{submitting ? <span className="pi-chatbox-spinner" /> : <Icon name="arrow" size={21} />}</button>}</div>
        </div>
        {images.length > 0 && !imageEnabled && <p className="pi-chatbox-image-warning" role="alert">这个模型不支持图片，请移除图片或切换模型。</p>}
      </form>
      <div className="pi-chatbox-footnote"><span>{imageEnabled ? "支持图片 · 可直接粘贴" : "文字对话"}</span><span>Enter 发送 <b>·</b> Shift + Enter 换行</span></div>
    </div>
    {preview && <ImagePreview image={preview} onClose={() => setPreview(undefined)} />}
  </section>;
}
