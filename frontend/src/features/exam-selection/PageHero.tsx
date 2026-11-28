interface PageHeroProps {
  eyebrow?: string;
  title: string;
  description: string;
}

export default function PageHero({
  eyebrow = "Practice exams",
  title,
  description,
}: PageHeroProps) {
  return (
    <header className="relative flex min-w-0 flex-col justify-center gap-3 overflow-hidden rounded-2xl bg-[#171645] px-4 py-6 text-white shadow-sm sm:min-h-53 sm:px-12 sm:py-11">
      {/* Ambient lavender and saffron glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none inset-0 bg-[radial-gradient(circle_at_96%_8%,rgba(249,139,36,0.28),transparent_42%),radial-gradient(circle_at_78%_88%,rgba(108,102,226,0.48),transparent_55%),linear-gradient(115deg,#14133d_0%,#21206b_58%,#2b2980_100%)] absolute"
      />

      <div className="relative z-10 flex min-w-0 flex-col gap-2 sm:gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/70">
          {eyebrow}
        </p>

        <h1 className="wrap-anywhere text-2xl font-bold tracking-tight text-white sm:text-4xl">
          {title}
        </h1>

        <p className="max-w-140 wrap-anywhere text-sm leading-6 text-indigo-100/85 sm:text-base">
          {description}
        </p>
      </div>
    </header>
  );
}
