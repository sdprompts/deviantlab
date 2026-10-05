import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function Shell() {
  return (
    <div className="flex h-screen overflow-hidden bg-lab text-zinc-100">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
        <footer className="flex shrink-0 justify-end border-t border-lab-line px-4 py-2">
          <a
            href="https://ko-fi.com/H2H514IXI3"
            target="_blank"
            rel="noreferrer"
            title="Support me on ko-fi.com"
            className="inline-flex h-9 items-center gap-1.5 rounded-[7px] bg-da px-3 text-[14px] font-bold text-black shadow-[1px_1px_0_rgba(0,0,0,0.2)]"
          >
            <img src="https://storage.ko-fi.com/cdn/cup-border.png" alt="" className="h-[15px] w-[22px]" />
            Support me on Ko-fi
          </a>
        </footer>
      </main>
    </div>
  );
}
