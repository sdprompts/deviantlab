import type { ReactNode } from "react";
import { Kicker } from "./ui";

export function PageHeader({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-lab-line px-4 py-3">
      <div className="min-w-0">
        <Kicker>{kicker}</Kicker>
        <h1 className="truncate text-[15px] font-semibold tracking-tight text-zinc-100">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </header>
  );
}
