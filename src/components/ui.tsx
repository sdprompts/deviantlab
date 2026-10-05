import type { ReactNode } from "react";

export function Mark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 1.7v5.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 1.7 8.7 5M12 1.7 15.3 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3.2" y="9.3" width="17.6" height="12.1" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7.1 18.5 10.5 14.4 12.6 16.5 15.6 12.9 17.5 18.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconStack() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.4 13.2 5 8 7.6 2.8 5 8 2.4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M2.8 8 8 10.6 13.2 8" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M2.8 11 8 13.6 13.2 11" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSliders() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4.5h10M3 8h10M3 11.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="6" cy="4.5" r="1.2" fill="#09090b" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="10" cy="8" r="1.2" fill="#09090b" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="11.5" r="1.2" fill="#09090b" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">
      {children}
    </div>
  );
}
