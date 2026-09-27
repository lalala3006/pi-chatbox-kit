/** Scoped styles ship with the React component; hosts may override the CSS variables. */
export const chatboxStyles = `
.pi-chatbox {
  --pi-bg: #fcfcfa; --pi-surface: #fff; --pi-ink: #242a29; --pi-muted: #8b918d;
  --pi-border: #e5e8e3; --pi-accent: #28634c; --pi-soft: #f0f3ee;
  position: relative; display: flex; flex-direction: column; height: 100%; min-height: 460px;
  color: var(--pi-ink); background: var(--pi-bg); font: 14px/1.6 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  isolation: isolate; text-align: left;
}
.pi-chatbox *, .pi-chatbox-image-dialog * { box-sizing: border-box; }
.pi-chatbox button, .pi-chatbox select, .pi-chatbox textarea, .pi-chatbox input { font: inherit; }
.pi-chatbox button { cursor: pointer; }
.pi-chatbox button:disabled, .pi-chatbox select:disabled { cursor: not-allowed; }
.pi-chatbox button:focus-visible, .pi-chatbox select:focus-visible, .pi-chatbox-image-dialog button:focus-visible { outline: 2px solid var(--pi-accent, #28634c); outline-offset: 4px; }
.pi-chatbox button { -webkit-tap-highlight-color: transparent; }
.pi-chatbox-messages { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #dce1db transparent; }
.pi-chatbox-empty { min-height: 100%; max-width: 800px; margin: auto; padding: 56px 24px 72px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.pi-chatbox-emblem { display: grid; place-items: center; width: 66px; height: 66px; border-radius: 22px; color: var(--pi-accent); background: #eaf0e6; box-shadow: inset 0 0 0 1px #dee6d7; transform: rotate(-6deg); margin-bottom: 30px; }
.pi-chatbox-emblem svg { transform: rotate(6deg); }
.pi-chatbox-eyebrow { color: #90988f; font-size: 11px; letter-spacing: .18em; }
.pi-chatbox-empty h2 { margin: 10px 0 12px; font-size: clamp(26px, 3vw, 36px); line-height: 1.45; font-weight: 600; letter-spacing: -.04em; }
.pi-chatbox-empty p { margin: 0; color: #929890; font-size: 13px; }
.pi-chatbox-suggestions { display: flex; gap: 9px; justify-content: center; flex-wrap: wrap; margin-top: 32px; }
.pi-chatbox-suggestions button { display: flex; align-items: center; gap: 9px; padding: 10px 14px; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); color: #686f67; font-size: 12px; transition: border-color .15s, transform .15s, background .15s; }
.pi-chatbox-suggestions button:hover { border-color: #b8c7b8; background: #f5f8f2; transform: translateY(-2px); }
.pi-chatbox-suggestions button > span { color: #a0a99c; margin-left: 6px; }
.pi-chatbox-transcript { max-width: 816px; margin: 0 auto; padding: 32px 28px 26px; }
.pi-chatbox-message { display: flex; gap: 12px; margin-bottom: 30px; }
.pi-chatbox-message-user { justify-content: flex-end; padding-left: 48px; }
.pi-chatbox-message-body { min-width: 0; max-width: 100%; }
.pi-chatbox-message-user > .pi-chatbox-message-body { background: #edf1e9; border: 1px solid #e4eadf; border-radius: 20px 20px 5px 20px; padding: 12px 18px; max-width: 85%; }
.pi-chatbox-message-text { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.9; font-size: 14px; }
.pi-chatbox-markdown { min-width: 0; max-width: 100%; overflow-wrap: anywhere; font-size: 14px; line-height: 1.85; }
.pi-chatbox-markdown > :first-child { margin-top: 0; }.pi-chatbox-markdown > :last-child { margin-bottom: 0; }
.pi-chatbox-markdown p { margin: 0 0 12px; white-space: pre-line; }
.pi-chatbox-markdown h1, .pi-chatbox-markdown h2, .pi-chatbox-markdown h3, .pi-chatbox-markdown h4, .pi-chatbox-markdown h5, .pi-chatbox-markdown h6 { color: var(--pi-ink); font-weight: 650; line-height: 1.45; margin: 22px 0 10px; letter-spacing: -.02em; }
.pi-chatbox-markdown h1 { font-size: 24px; }.pi-chatbox-markdown h2 { font-size: 20px; }.pi-chatbox-markdown h3 { font-size: 17px; }.pi-chatbox-markdown h4, .pi-chatbox-markdown h5, .pi-chatbox-markdown h6 { font-size: 14px; }
.pi-chatbox-markdown strong { font-weight: 650; }.pi-chatbox-markdown del { color: var(--pi-muted); }
.pi-chatbox-markdown ul, .pi-chatbox-markdown ol { padding-left: 24px; margin: 10px 0 14px; }
.pi-chatbox-markdown li { padding-left: 2px; margin: 4px 0; }.pi-chatbox-markdown li > p { margin: 4px 0; }
.pi-chatbox-markdown li > ul, .pi-chatbox-markdown li > ol { margin: 5px 0; }
.pi-chatbox-markdown li::marker { color: #788970; }
.pi-chatbox-markdown .contains-task-list { list-style: none; padding-left: 4px; }.pi-chatbox-markdown .task-list-item input { accent-color: var(--pi-accent); margin-right: 7px; }
.pi-chatbox-markdown blockquote { margin: 16px 0; border-left: 3px solid #b1c5a6; padding: 8px 15px; background: #f1f5ed; color: #6a7860; border-radius: 0 8px 8px 0; }
.pi-chatbox-markdown blockquote > :last-child { margin-bottom: 0; }
.pi-chatbox-markdown a { color: var(--pi-accent); text-decoration: underline; text-decoration-color: #b5c6ad; text-underline-offset: 3px; }
.pi-chatbox-markdown a:hover { text-decoration-color: currentColor; }
.pi-chatbox-markdown hr { height: 1px; border: 0; background: var(--pi-border); margin: 23px 0; }
.pi-chatbox-markdown code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: .88em; padding: 2px 5px; border-radius: 5px; background: #edf1e8; color: #496b3a; white-space: break-spaces; }
.pi-chatbox-code-block { border: 1px solid #dfe5da; background: #f5f7f1; border-radius: 11px; overflow: hidden; margin: 14px 0; }
.pi-chatbox-code-header { display: flex; align-items: center; justify-content: space-between; padding: 7px 13px; background: #eaf0e4; border-bottom: 1px solid #dfe5da; gap: 12px; font-size: 10px; color: #849279; }
.pi-chatbox-code-header > span { font-family: "SFMono-Regular", Consolas, monospace; overflow-wrap: anywhere; }
.pi-chatbox-code-header button { border: 0; background: transparent; color: #687d59; padding: 2px 5px; font-size: 10px; flex-shrink: 0; border-radius: 4px; }
.pi-chatbox-code-header button:hover { background: #dce6d3; }
.pi-chatbox-code-block pre { margin: 0; padding: 15px; overflow-x: auto; max-width: 100%; line-height: 1.7; tab-size: 2; }
.pi-chatbox-code-block pre > code { display: block; border: 0; border-radius: 0; padding: 0; background: none; color: #48583e; white-space: pre; overflow-wrap: normal; font-size: 12px; }
.pi-chatbox-table-scroll { max-width: 100%; overflow-x: auto; margin: 16px 0; border: 1px solid #e0e7da; border-radius: 10px; scrollbar-width: thin; }
.pi-chatbox-markdown table { width: 100%; border-collapse: collapse; font-size: 12px; }
.pi-chatbox-markdown th, .pi-chatbox-markdown td { text-align: left; padding: 9px 13px; border-right: 1px solid #e5eadf; border-bottom: 1px solid #e5eadf; min-width: 92px; }
.pi-chatbox-markdown th { background: #eef3e8; font-weight: 600; color: #627456; }
.pi-chatbox-markdown tr:nth-child(even) td { background: #f6f8f2; }.pi-chatbox-markdown tr:last-child td { border-bottom: 0; }.pi-chatbox-markdown th:last-child, .pi-chatbox-markdown td:last-child { border-right: 0; }
.pi-chatbox-markdown img { max-width: 100%; max-height: 240px; object-fit: contain; border-radius: 9px; }
.pi-chatbox-markdown-image { display: inline-block; width: 104px; height: 104px; padding: 0; margin: 5px 6px 5px 0; border: 1px solid #dce3d7; border-radius: 11px; background: #f1f3ed; overflow: hidden; cursor: zoom-in !important; vertical-align: middle; }
.pi-chatbox-markdown-image img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 0; }
.pi-chatbox-markdown .footnotes { font-size: 12px; color: var(--pi-muted); border-top: 1px solid var(--pi-border); margin-top: 18px; padding-top: 12px; }
.pi-chatbox-avatar { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex-shrink: 0; background: #eaf0e6; color: var(--pi-accent); border-radius: 10px; margin-top: 2px; }
.pi-chatbox-message-label { font-size: 11px; color: #8b9489; margin: 2px 0 8px; }
.pi-chatbox-message-assistant .pi-chatbox-message-body { flex: 1; }
.pi-chatbox-message-images { display: flex; gap: 8px; flex-wrap: wrap; margin: 2px 0 10px; }
.pi-chatbox-sent-image { padding: 0; border: 1px solid #d8dfd4; border-radius: 12px; width: 104px; height: 104px; overflow: hidden; background: #e5e9e1; cursor: zoom-in !important; }
.pi-chatbox-sent-image img { display: block; width: 100%; height: 100%; object-fit: cover; }
.pi-chatbox-bottom { position: relative; flex-shrink: 0; width: 100%; max-width: 816px; margin: 0 auto; padding: 0 28px 19px; }
.pi-chatbox-composer { background: var(--pi-surface); border: 1px solid #dce2d7; border-radius: 23px; padding: 17px 16px 12px; box-shadow: 0 5px 24px #2e43220a, 0 1px 3px #2e432204; transition: box-shadow .2s, border-color .2s; }
.pi-chatbox-composer:focus-within { border-color: #b5c4ad; box-shadow: 0 0 0 3px #eaf0e780, 0 5px 24px #2e43220a; }
.pi-chatbox-composer > textarea { display: block; width: 100%; min-height: 52px; max-height: 168px; padding: 2px 5px 12px; border: 0; outline: 0; resize: none; background: transparent; color: var(--pi-ink); line-height: 1.7; box-shadow: none; border-radius: 0; }
.pi-chatbox-composer > textarea::placeholder { color: #9ba299; font-size: 13px; }
.pi-chatbox-composer-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.pi-chatbox-composer-tools { display: flex; gap: 7px; align-items: center; min-width: 0; }
.pi-chatbox-icon-button { display: grid; place-items: center; flex-shrink: 0; height: 32px; width: 32px; padding: 0; border: 0; border-radius: 9px; background: transparent; color: #7a8774; }
.pi-chatbox-icon-button:hover:not(:disabled) { background: var(--pi-soft); color: var(--pi-accent); }
.pi-chatbox-icon-button:disabled { opacity: .35; }
.pi-chatbox-model-picker { position: relative; display: flex; align-items: center; gap: 6px; color: #6b7864; background: #f3f5ef; border: 1px solid #e9ede4; border-radius: 8px; padding: 0 8px; height: 30px; min-width: 0; max-width: 310px; }
.pi-chatbox-model-picker > svg { flex-shrink: 0; pointer-events: none; }
.pi-chatbox-model-picker select { appearance: none; -webkit-appearance: none; background: transparent; color: #65735f; padding: 3px 0; border: 0; width: auto; max-width: 245px; min-width: 0; font-size: 11px; line-height: 1.5; cursor: pointer; text-overflow: ellipsis; box-shadow: none; }
.pi-chatbox-model-picker select:disabled { opacity: .65; }
.pi-chatbox-send-area { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.pi-chatbox-send { display: grid; place-items: center; width: 35px; height: 35px; border-radius: 50%; border: 0; padding: 0; background: var(--pi-accent); color: white; transition: background .2s, transform .15s; }
.pi-chatbox-send:hover:not(:disabled) { background: #174d37; transform: translateY(-1px); }
.pi-chatbox-send:disabled { background: #e7ece2; color: #a9b59f; }
.pi-chatbox-generation-label { font-size: 11px; color: #829078; }
.pi-chatbox-footnote { display: flex; justify-content: space-between; padding: 9px 7px 0; font-size: 10px; color: #a2a89d; gap: 12px; }
.pi-chatbox-footnote b { padding: 0 5px; font-weight: 400; }
.pi-chatbox-attachments { display: flex; flex-wrap: wrap; gap: 12px; padding: 2px 5px 14px; }
.pi-chatbox-attachment { position: relative; width: 62px; height: 62px; }
.pi-chatbox-thumbnail { display: block; width: 62px; height: 62px; overflow: hidden; border-radius: 11px; border: 1px solid #dce3d7; background: #f1f3ed; padding: 0; cursor: zoom-in !important; }
.pi-chatbox-thumbnail img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .2s; }
.pi-chatbox-thumbnail:hover img { transform: scale(1.06); }
.pi-chatbox-remove-image { position: absolute; right: -5px; top: -5px; display: grid; place-items: center; width: 19px; height: 19px; border: 2px solid white; border-radius: 50%; background: #414b40; color: white; padding: 0; box-shadow: 0 1px 3px #0002; }
.pi-chatbox-remove-image:hover { background: #ad4740; }
.pi-chatbox-image-warning { font-size: 12px; color: #b26d37; margin: 8px 5px 0; }
.pi-chatbox-error { background: #fff3ef; border: 1px solid #f2ded5; color: #a05c48; padding: 9px 12px; border-radius: 10px; font-size: 12px; overflow-wrap: anywhere; margin: 0 0 10px; display: flex; align-items: start; gap: 8px; }
.pi-chatbox-error > span { flex: 1; min-width: 0; }
.pi-chatbox-error > button { background: none; border: 0; color: inherit; padding: 0; display: flex; flex-shrink: 0; margin-top: 2px; }
.pi-chatbox-model-notice { font-size: 12px; color: #858e7f; margin: 0 5px 10px; }
.pi-text-button { background: none; border: 0; padding: 5px 9px; color: var(--pi-accent); font-size: 12px !important; }
.pi-text-button:hover { background: #eaf0e6; border-radius: 6px; }
.pi-chatbox-retry { margin-bottom: 10px; }
.pi-chatbox-scroll { position: absolute; top: -44px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 5px; background: white; border: 1px solid var(--pi-border); border-radius: 20px; padding: 6px 12px; box-shadow: 0 2px 12px #253e1510; color: #7b8874; font-size: 11px !important; }
.pi-chatbox-working { display: flex; align-items: center; gap: 12px; color: #8d9787; font-size: 12px; padding-left: 42px; }
.pi-chatbox-stopped { margin: 8px 0 0; font-size: 11px; color: #97a08f; }
.pi-chatbox-thinking { display: inline-flex; gap: 4px; padding: 8px 0; }
.pi-chatbox-thinking i { height: 5px; width: 5px; border-radius: 50%; background: #99ad8e; animation: pi-chatbox-pulse 1.4s infinite; }
.pi-chatbox-thinking i:nth-child(2) { animation-delay: .18s; }.pi-chatbox-thinking i:nth-child(3) { animation-delay: .36s; }
.pi-chatbox-spinner { width: 16px; height: 16px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: pi-chatbox-spin .7s linear infinite; }
@keyframes pi-chatbox-pulse { 0%, 75%, 100% { opacity: .35; transform: translateY(0); } 35% { opacity: 1; transform: translateY(-3px); } }
@keyframes pi-chatbox-spin { to { transform: rotate(360deg); } }
.pi-chatbox-confirmation { margin: 18px 0 10px; border: 1px solid #dfe7d7; background: #f7f9f4; border-radius: 14px; padding: 18px; }
.pi-confirmation-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 15px; }
.pi-confirmation-icon { color: var(--pi-accent); background: #e7efdf; border-radius: 9px; padding: 7px; display: flex; }
.pi-confirmation-heading small { color: #95a08c; font-size: 10px; }
.pi-confirmation-heading h3 { font-size: 14px; margin: 0; font-weight: 600; }
.pi-chatbox-confirmation label { display: grid; gap: 6px; margin-top: 12px; font-size: 12px; color: #7d8875; }
.pi-chatbox-confirmation input:not([type=checkbox]), .pi-chatbox-confirmation textarea { border: 1px solid #dde5d5; background: #fff; border-radius: 8px; padding: 9px 11px; width: 100%; color: #414b3d; }
.pi-chatbox-confirmation textarea { min-height: 100px; resize: vertical; }
.pi-confirmation-actions { display: flex; gap: 8px; margin-top: 16px; }
.pi-primary-button { padding: 7px 15px; background: var(--pi-accent); color: white; border: 0; border-radius: 8px; font-size: 12px !important; }
.pi-primary-button:disabled { opacity: .5; }.pi-confirmation-result { font-size: 12px; color: var(--pi-accent); margin: 12px 0 0; }
.pi-chatbox-image-dialog { border: 0; padding: 28px; width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; background: transparent; color: #fff; margin: auto; outline: 0; }
.pi-chatbox-image-dialog[open] { display: flex; align-items: center; justify-content: center; }
.pi-chatbox-image-dialog::backdrop { background: #101911d9; backdrop-filter: blur(8px); }
.pi-image-viewer { max-width: min(1080px, 94vw); display: flex; flex-direction: column; align-items: center; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.pi-image-viewer header { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 32px; padding-bottom: 14px; }
.pi-image-viewer header span { overflow-wrap: anywhere; opacity: .8; }
.pi-image-viewer button { display: grid; place-items: center; padding: 0; width: 34px; height: 34px; border: 1px solid #ffffff30; border-radius: 50%; color: #fff; background: #ffffff15; cursor: pointer; flex-shrink: 0; }
.pi-image-viewer img { max-width: 100%; max-height: 76dvh; object-fit: contain; border-radius: 8px; box-shadow: 0 16px 80px #0006; }
.pi-image-viewer p { color: #ffffff70; font-size: 11px; margin: 16px 0 0; }
@media (max-width: 600px) {
  .pi-chatbox { min-height: 360px; }.pi-chatbox-empty { padding: 40px 20px; }
  .pi-chatbox-empty h2 { font-size: 27px; }.pi-chatbox-empty p { font-size: 12px; }
  .pi-chatbox-suggestions { gap: 8px; margin-top: 26px; }.pi-chatbox-suggestions button { padding: 9px 11px; }
  .pi-chatbox-suggestions button > span { display: none; }.pi-chatbox-transcript { padding: 24px 17px; }
  .pi-chatbox-bottom { padding: 0 14px 12px; }.pi-chatbox-composer { border-radius: 20px; padding: 14px 12px 10px; }
  .pi-chatbox-model-picker { max-width: 210px; gap: 4px; }.pi-chatbox-model-picker select { max-width: 155px; }
  .pi-chatbox-footnote { font-size: 9px; padding-left: 2px; padding-right: 2px; }.pi-chatbox-footnote span:last-child { display: none; }
  .pi-chatbox-message-user { padding-left: 25px; }.pi-chatbox-message-user > .pi-chatbox-message-body { max-width: 95%; }
  .pi-chatbox-generation-label { display: none; }.pi-chatbox-image-dialog { padding: 16px; }
}
@media (prefers-reduced-motion: reduce) { .pi-chatbox *, .pi-chatbox *::before { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
`;
