import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createChatboxClient } from "pi-chatbox-kit/client";
import { ChatboxProvider, ChatBox, ModelAuthSettings } from "pi-chatbox-kit/react";
import "./demo.css";

const client = createChatboxClient({ baseUrl: "/api/chatbox" });
function App() {
  const settingsRef = useRef<HTMLDialogElement>(null);
  const [chatKey, setChatKey] = useState(0);
  const [conversationId, setConversationId] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const closeSettings = () => { settingsRef.current?.close(); window.dispatchEvent(new Event("pi-chatbox-models-changed")); };
  const newConversation = async () => {
    setStarting(true); setError("");
    try {
      if (conversationId && (await client.getConversation(conversationId)).status === "running") await client.cancel(conversationId);
      setChatKey((key) => key + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setStarting(false); }
  };
  useEffect(() => { document.title = "Chatbox · 对话工作台"; }, []);
  return <ChatboxProvider client={client}>
    <main className="demo-app">
      <header className="demo-header">
        <div className="demo-brand"><span className="demo-brand-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /></svg></span><strong>Chatbox</strong><span className="demo-brand-separator" /><span className="demo-brand-caption">对话工作台</span></div>
        <div className="demo-header-actions">
          <button type="button" className="demo-new" disabled={starting} onClick={() => void newConversation()}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg><span>新对话</span></button>
          <button type="button" className="demo-settings-button" onClick={() => settingsRef.current?.showModal()}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none" /><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none" /></svg><span>模型设置</span></button>
        </div>
      </header>
      <div className="demo-workspace">
        <div className="demo-workspace-bar"><span><span className="demo-status-dot" />你的思考空间</span><span className="demo-workspace-caption">对话 · 图片 · 确认卡</span></div>
        {error && <p role="alert" className="demo-error">{error}</p>}
        <div className="demo-chat"><ChatBox key={chatKey} onConversationChange={setConversationId} onOpenSettings={() => settingsRef.current?.showModal()} /></div>
      </div>
      <footer className="demo-footer"><span>CHATBOX <span className="demo-footer-dot">/</span> PLAYGROUND</span><span>给每一个想法，留一点空间。</span></footer>
    </main>
    <dialog ref={settingsRef} className="demo-settings-dialog" aria-label="模型设置" onClick={(event) => { if (event.target === event.currentTarget) closeSettings(); }} onClose={() => window.dispatchEvent(new Event("pi-chatbox-models-changed"))}>
      <div className="demo-settings-shell"><button type="button" className="demo-close-settings" aria-label="关闭模型设置" onClick={closeSettings}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg></button><ModelAuthSettings client={client} title="模型与账户" /><p className="demo-settings-note">配置完成后，即可在输入框中选择模型。此 Demo 使用内存保存数据，重启服务会清空。</p></div>
    </dialog>
  </ChatboxProvider>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
