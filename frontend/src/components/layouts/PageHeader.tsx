interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
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
    <div>
      <div className="mb-4 sm:mb-6">
        {stepLabel && (
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
            {stepLabel}
          </p>
        )}
        <h1 className="text-lg sm:text-2xl">
          {title}
          {status && (
            <span aria-hidden="true" className="font-normal text-gray-500 ml-2">
              · {status}
            </span>
          )}
        </h1>
        {subtitle && (
          <p className="text-xs sm:text-sm text-gray-500 mt-1">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
