import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownMessage } from "../src/react/markdown-message.js";

const render = (text: string) => renderToStaticMarkup(createElement(MarkdownMessage, { text }));

describe("Markdown replies", () => {
  it("renders common formatting and GFM tables, tasks, and code blocks", () => {
    const html = render([
      "# 项目计划", "", "**重点**、*说明*和~~旧方案~~，使用 `hello()`。", "",
      "- 第一步", "  - 子步骤", "", "1. 创建", "2. 验证", "",
      "> 一段引用", "", "- [x] 已完成", "- [ ] 待处理", "",
      "| 模型 | 状态 |", "| --- | --- |", "| 本地模型 | 可用 |", "",
      "```typescript", "const greeting = 'hello';", "  console.log(greeting);", "```", "",
      "[参考文档](https://example.com/docs)",
    ].join("\n"));
    expect(html).toContain("<h1>项目计划</h1>");
    expect(html).toContain("<strong>重点</strong>");
    expect(html).toContain("<em>说明</em>");
    expect(html).toContain("<del>旧方案</del>");
    expect(html).toContain("<code>hello()</code>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<table>");
    expect(html).toContain("<th>模型</th>");
    expect(html).toContain('class="language-typescript"');
    expect(html).toContain("  console.log(greeting);");
    expect(html).toContain('aria-label="复制代码"');
    expect(html).toContain('href="https://example.com/docs" target="_blank" rel="noopener noreferrer"');
  });

  it("renders every partial streamed prefix, including an unfinished fence", () => {
    const reply = "## 标题\n\n**加粗文本**\n\n```js\nconst text = '<hello>';\nconsole.log(text);\n```";
    for (let i = 1; i <= reply.length; i++) expect(() => render(reply.slice(0, i))).not.toThrow();
    expect(render("```js\nconst result = 42;")).toContain("const result = 42;");
  });

  it("disables model-supplied HTML and unsafe URLs while preserving literal code", () => {
    const html = render("<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[危险链接](javascript:alert%281%29)\n\n```html\n<script>alert(2)</script>\n```");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });
});
