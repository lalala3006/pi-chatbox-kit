import { Children, isValidElement, memo, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function textContent(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : "";
  }).join("");
}

function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const codeElement = Children.toArray(children).find((child) => isValidElement<{ className?: string }>(child));
  const language = isValidElement<{ className?: string }>(codeElement) ? /(?:^|\s)language-([^\s]+)/.exec(codeElement.props.className ?? "")?.[1] : undefined;
  const code = textContent(children).replace(/\n$/, "");
  useEffect(() => { setCopyStatus("idle"); }, [code]);
  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = setTimeout(() => setCopyStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopyStatus("copied"); }
    catch { setCopyStatus("error"); }
  };
  return <div className="pi-chatbox-code-block">
    <div className="pi-chatbox-code-header"><span>{language ?? "代码"}</span><button type="button" onClick={() => void copy()} aria-label="复制代码"><span aria-live="polite">{copyStatus === "copied" ? "已复制" : copyStatus === "error" ? "复制失败，请手动复制" : "复制代码"}</span></button></div>
    <pre {...props}>{children}</pre>
  </div>;
}

const baseComponents: Components = {
  pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
  table: ({ node: _node, ...props }) => <div className="pi-chatbox-table-scroll" role="region" aria-label="表格" tabIndex={0}><table {...props} /></div>,
  a: ({ node: _node, href, children, ...props }) => href
    ? <a {...props} href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer">{children}</a>
    : <span>{children}</span>,
};

/** Render model output as React elements, with raw HTML disabled and safe URL handling. */
export const MarkdownMessage = memo(function MarkdownMessage({ text, onPreviewImage }: { text: string; onPreviewImage?: (image: { src: string; name: string }) => void }) {
  const components = useMemo<Components>(() => ({
    ...baseComponents,
    img: ({ node: _node, src, alt, ...props }) => {
      if (typeof src !== "string" || !src) return <span>{alt}</span>;
      const image = <img {...props} src={src} alt={alt ?? "回复中的图片"} loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
      return onPreviewImage ? <button type="button" className="pi-chatbox-markdown-image" aria-label={`预览图片 ${alt ?? "回复中的图片"}`} onClick={() => onPreviewImage({ src, name: alt ?? "回复中的图片" })}>{image}</button> : image;
    },
  }), [onPreviewImage]);
  return <div className="pi-chatbox-markdown"><Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>{text}</Markdown></div>;
});
