import { NavLink } from "react-router-dom";
import { useLab } from "../lab";
import { IconSliders, IconStack, Mark } from "./ui";

const items = [
  { to: "/", label: "Uploads", icon: IconStack, end: true },
  { to: "/settings", label: "Settings", icon: IconSliders, end: false },
];

export function Sidebar() {
  const { session, signIn, signOut } = useLab();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-lab-line bg-lab">
      <div className="flex h-14 items-center gap-2.5 border-b border-lab-line px-4">
        <span className="text-da">
          <Mark />
        </span>
        <div className="text-lg font-semibold tracking-tight text-zinc-100">DeviantLab</div>
      </div>

      <nav className="flex flex-col gap-0.5 px-3 py-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium ${
                isActive ? "text-da" : "text-zinc-400 hover:text-zinc-200"
              }`
            }
          >
            <item.icon />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto border-t border-lab-line px-3 py-3">
        {session ? (
          <div className="flex items-center gap-2.5 px-1">
            {session.usericon ? (
              <img src={session.usericon} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <span className="grid h-8 w-8 place-items-center rounded-full bg-zinc-800 text-[11px] text-zinc-300">
                {session.username.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-200">{session.username}</span>
            <button type="button" onClick={signOut} className="shrink-0 text-[11px] text-zinc-500 hover:text-zinc-300">
              Sign out
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={signIn}
            className="flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-left"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full border border-dashed border-zinc-700 text-[11px] text-zinc-500">
              —
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-zinc-200">Sign in</span>
              <span className="block text-[11px] text-zinc-500">DeviantArt</span>
            </span>
          </button>
        )}
      </div>
    </aside>
  );
}
