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
      <div className="mx-4 pb-4 border-b border-gray-300">
        {stepLabel && (
          <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
            {stepLabel}
          </p>
        )}
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-gray-900 flex items-baseline">
          <span>{title}</span>
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
