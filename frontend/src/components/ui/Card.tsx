interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export default function Card({ children, className = '' }: CardProps) {
  return (
    <article className={`bg-gray-100 border border-gray-300 rounded-sm mx-2 md:mx-4 shadow-lg ${className}`}>
      {children}
    </article>
  )
}
