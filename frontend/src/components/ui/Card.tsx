interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export default function Card({ children, className = '' }: CardProps) {
  return (
    <article className={`bg-white border border-gray-300 rounded-sm p-3 md:p-5 m-2 md:m-4 shadow-sm ${className}`}>
      {children}
    </article>
  )
}
