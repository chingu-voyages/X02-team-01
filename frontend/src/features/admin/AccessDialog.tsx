"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export const accessPrimary = "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-accent-tint focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";
export const accessSecondary = "inline-flex min-h-11 w-full items-center justify-center rounded-md border border-brand-border bg-white px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-surface focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";
export const accessActions = "flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end";

const focusable = "a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), textarea:not(:disabled), select:not(:disabled), [tabindex='0']";

export default function AccessDialog({ title, busy, onCancel, children }: {
  title: string;
  busy: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const node = panel.current;
    (node?.querySelector<HTMLElement>("[data-dialog-cancel]:not(:disabled)") ?? node)?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    if (busy) panel.current?.focus();
  }, [busy]);

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>(focusable) ?? []);
    const index = elements.findIndex((element) => element === document.activeElement);
    if (!elements.length) { event.preventDefault(); return; }
    if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === elements.length - 1)) {
      event.preventDefault();
      (event.shiftKey ? elements.at(-1) : elements[0])?.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4">
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1} onKeyDown={keyboard}
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg min-w-0 space-y-4 overflow-y-auto overscroll-contain rounded-lg border border-brand-border bg-white p-4 text-brand-text shadow-xl outline-none sm:max-h-[calc(100dvh-2rem)] sm:p-6 [overflow-wrap:anywhere]">
        <h2 id={titleId} className="text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function AccessError({ message }: { message: string }) {
  return <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 [overflow-wrap:anywhere]">{message}</p>;
}
