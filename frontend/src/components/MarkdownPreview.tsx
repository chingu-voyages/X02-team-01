"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownPreviewProps = {
  content: string;
  className?: string;
};

// JHEP-121 AC3: render permitted Markdown safely. react-markdown escapes
// raw HTML by default — no <script>, event handlers or unsafe markup can
// reach the DOM, so no separate sanitizer pass is required.
export default function MarkdownPreview({
  content,
  className,
}: MarkdownPreviewProps) {
  return (
    <div
      className={
        className ??
        "space-y-2 rounded-md border border-brand-border bg-brand-surface/50 p-4 text-sm leading-6 text-brand-text [&_a]:underline [&_code]:rounded [&_code]:bg-brand-secondary/40 [&_code]:px-1 [&_li]:ml-4 [&_ol]:list-decimal [&_strong]:font-semibold [&_ul]:list-disc"
      }
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
