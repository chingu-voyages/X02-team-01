import type { ReactNode, Ref } from "react";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  status?: string;
  stepLabel?: string;
  action?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}

export default function PageHeader({
  title,
  subtitle,
  status,
  stepLabel,
  action,
  headingRef,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div>
        {stepLabel && (
          <p className="mb-1.5 text-xs font-bold uppercase tracking-widest text-brand-primary">
            {stepLabel}
          </p>
        )}

        <h1
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          className="flex flex-wrap items-baseline text-2xl font-bold tracking-tight text-brand-text outline-none md:text-3xl"
        >
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
          <p className="mt-1.5 text-sm text-brand-text/70">{subtitle}</p>
        )}
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}