import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  status?: string;
  stepLabel?: string;
}

export default function PageHeader({
  title,
  subtitle,
  status,
  stepLabel,
}: PageHeaderProps) {
  return (
    <header className="my-6 border-b border-brand-border pb-4">
      {stepLabel && (
        <p className="text-xs font-bold uppercase tracking-widest text-brand-text/60">
          {stepLabel}
        </p>
      )}
      <h1 className="flex flex-wrap items-baseline text-xl font-bold tracking-tight text-brand-text sm:text-2xl">
        <span>{title}</span>
        {status && (
          <span
            aria-hidden="true"
            className="ml-2 font-normal text-brand-text/60"
          >
            · {status}
          </span>
        )}
      </h1>
      {subtitle && (
        <p className="mt-1 text-xs text-brand-text/70 sm:text-sm">{subtitle}</p>
      )}
    </header>
  );
}
