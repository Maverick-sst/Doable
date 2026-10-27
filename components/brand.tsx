export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={`grid size-7 shrink-0 place-items-center rounded-[9px] bg-accent text-accent-foreground shadow-sm${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 20 20" className="size-4" fill="none">
        <path
          d="M6 5.25h3.75a4.75 4.75 0 0 1 0 9.5H6z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M6 10h3.4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
