"use client";

import { isValidElement, memo, useRef, type ReactNode } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { parseMarkerHref } from "@/lib/citations";
import { CitationChip } from "./sources";
import { CopyButton } from "./ui";

const remarkPlugins: Options["remarkPlugins"] = [remarkGfm, remarkMath];
const rehypePlugins: Options["rehypePlugins"] = [rehypeKatex, rehypeHighlight];

/**
 * Normalizes math for remark-math, outside code: \[ \] and a line that is only
 * $$...$$ become display blocks, and \( \) becomes inline $...$.
 */
function normalizeMath(source: string) {
  const display = (math: string) => `\n$$\n${math.trim()}\n$$\n`;
  return source
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, math: string) => display(math))
            .replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_, math: string) => display(math))
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, math: string) => `$${math.trim()}$`),
    )
    .join("");
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const className = isValidElement<{ className?: string }>(children) ? children.props.className : "";
  const language = /language-([\w+#.-]+)/.exec(className ?? "")?.[1];

  return (
    <div className="code-block">
      <div className="flex h-9 items-center justify-between border-b border-line pe-1 ps-3.5 text-xs text-subtle">
        <span className="font-mono">{language ?? "code"}</span>
        <CopyButton label="Copy code" className="size-7" getText={() => preRef.current?.innerText ?? ""} />
      </div>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}

const components: Components = {
  pre(props) {
    return <CodeBlock>{props.children}</CodeBlock>;
  },
  a({ href, children }) {
    // Citation markers arrive as links to #src-… (see citations.ts).
    if (parseMarkerHref(href)) return <CitationChip href={href as string} />;
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
  table(props) {
    return (
      <div className="table-wrap">
        <table>{props.children}</table>
      </div>
    );
  },
};

/** Citation chips read their reply's sources from ReplySourcesContext (see sources.tsx). */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  );
});
