"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/client/api";
import type { Document, Tender } from "@/lib/types";
import Icon from "./ui/Icon";
import { ExportMenu, Pill, statusPill } from "./ui";
import { ToastProvider } from "./ui/Toasts";

type TenderPayload = { tender: Tender; requirementsDoc: Document | null; bids: Document[] };

function NavLink({ href, icon, children, active, count, indent }: { href: string; icon?: string; children: React.ReactNode; active?: boolean; count?: number; indent?: boolean }) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${indent ? "ml-5 py-1.5 text-[12.5px]" : ""} ${
        active ? "bg-brand-primary text-white font-medium shadow-sm" : "text-white/70 hover:text-white hover:bg-white/8"
      }`}
    >
      {icon && <Icon name={icon} className="w-4 h-4 shrink-0" />}
      <span className="flex-1 truncate">{children}</span>
      {count !== undefined && <span className={`text-[11px] px-1.5 rounded-full ${active ? "bg-white/25" : "bg-white/10 text-white/60"}`}>{count}</span>}
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const params = useParams<{ id?: string; docId?: string }>();
  const pathname = usePathname();
  const tenderId = params?.id;
  const { data } = useApi<TenderPayload>(tenderId ? `/api/tenders/${tenderId}` : null);
  const base = tenderId ? `/tenders/${tenderId}` : "";
  const is = (p: string) => pathname === p;
  const starts = (p: string) => pathname.startsWith(p);
  const tender = data?.tender;
  const bids = data?.bids ?? [];

  return (
    <div className="flex flex-col h-full" onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate?.()}>
      <Link href="/" className="flex items-center gap-3 px-5 h-16 shrink-0 border-b border-white/10">
        <Image src="/logo.png" alt="" width={32} height={32} className="rounded-md" />
        <span className="text-white font-semibold tracking-tight">TenderBoard</span>
      </Link>

      <div className="flex-1 overflow-y-auto scroll-thin px-3 py-4 space-y-1">
        <NavLink href="/" icon="folder" active={is("/") || is("/tenders/new")}>All tenders</NavLink>
        <NavLink href="/playbooks" icon="spark" active={starts("/playbooks")}>Playbooks</NavLink>

        {tenderId && tender && (
          <div className="pt-4">
            <div className="px-3 pb-2">
              <div className="text-[10px] uppercase tracking-[0.12em] text-white/40">Current tender</div>
              <div className="text-white font-medium text-sm leading-snug mt-1 line-clamp-2">{tender.title}</div>
              <div className="text-[11px] text-white/45 mt-0.5 truncate">{[tender.client_name, tender.location].filter(Boolean).join(" · ")}</div>
            </div>
            <NavLink href={base} icon="home" active={is(base)}>Overview</NavLink>
            <NavLink href={`${base}/requirements`} icon="list" active={starts(`${base}/requirements`)}>Requirements</NavLink>
            <NavLink href={`${base}/bids`} icon="users" active={is(`${base}/bids`)} count={bids.length}>Bids</NavLink>
            {bids.map((b) => {
              const st = statusPill(b.status);
              return (
                <NavLink key={b.id} href={`${base}/bids/${b.id}`} indent active={params?.docId === b.id}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${st.tone === "ok" ? "bg-emerald-400" : st.tone === "warn" ? "bg-amber-400" : st.tone === "bad" ? "bg-red-400" : "bg-sky-400"}`} />
                    {b.party_name ?? "Unnamed bid"}{b.status === "failed" && <span className="text-[10px] text-red-300">failed</span>}
                    {b.version_no > 1 && <span className="text-[10px] text-white/45">v{b.version_no}</span>}
                  </span>
                </NavLink>
              );
            })}
            <NavLink href={`${base}/compare`} icon="scale" active={starts(`${base}/compare`)}>Comparison</NavLink>
            <NavLink href={`${base}/reports`} icon="chart" active={starts(`${base}/reports`)}>Reports</NavLink>
            <NavLink href={`${base}/ask`} icon="spark" active={starts(`${base}/ask`)}>Ask · Playbooks</NavLink>
            <NavLink href={`${base}/gallery`} icon="image" active={starts(`${base}/gallery`)}>Gallery</NavLink>
            <NavLink href={`${base}/settings`} icon="gear" active={starts(`${base}/settings`)}>Settings</NavLink>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-white/10 space-y-2 shrink-0">
        <Link href="/tenders/new" className="flex items-center justify-center gap-1.5 bg-brand-primary hover:bg-brand-primary-dull text-white text-sm font-medium rounded-lg py-2.5">
          <Icon name="plus" /> New tender
        </Link>
        {tenderId && (
          <div className="[&_summary]:w-full [&_summary]:justify-center [&_summary]:bg-white/8 [&_summary]:border-white/15 [&_summary]:text-white/80">
            <ExportMenu base={`/api/tenders/${tenderId}/export`} label="Export full pack" />
          </div>
        )}
      </div>
    </div>
  );
}

const VAR: Record<string, string> = { auto: "--c-auto", converted: "--c-converted", manual: "--c-manual", ai: "--c-ai", anomaly: "--c-anomaly", low: "--c-low", high: "--c-high" };

/** Per-tender colour choices become CSS variables, so every table picks them up. */
function useThemeVars(): { style: React.CSSProperties; hlOff: boolean } {
  const params = useParams<{ id?: string }>();
  const { data } = useApi<TenderPayload>(params?.id ? `/api/tenders/${params.id}` : null);
  const ui = data?.tender?.ui_settings;
  const style: Record<string, string> = {};
  for (const [k, v] of Object.entries(ui?.colors ?? {})) {
    if (!v || !VAR[k]) continue;
    style[VAR[k]] = v;
    style[`${VAR[k]}-fg`] = `color-mix(in srgb, ${v} 22%, #14213d)`;
  }
  return { style: style as React.CSSProperties, hlOff: ui?.showProvenance === false };
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const theme = useThemeVars();
  useEffect(() => {
    const close = (e: MouseEvent) => document.querySelectorAll("details[open]").forEach((d) => !d.contains(e.target as Node) && d.removeAttribute("open"));
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <ToastProvider>
      <div className="min-h-screen lg:flex">
        <aside className="no-print hidden lg:block w-[264px] shrink-0 bg-brand-dark-dull sticky top-0 h-screen">
          <Sidebar />
        </aside>
        <div className="lg:hidden no-print sticky top-0 z-30 flex items-center gap-3 bg-brand-dark-dull px-4 h-14">
          <button onClick={() => setOpen(true)} className="text-white p-1"><Icon name="menu" className="w-6 h-6" /></button>
          <Image src="/logo.png" alt="" width={26} height={26} className="rounded" />
          <span className="text-white font-semibold">TenderBoard</span>
        </div>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-0 bottom-0 w-72 bg-brand-dark-dull"><Sidebar onNavigate={() => setOpen(false)} /></div>
          </div>
        )}
        <main style={theme.style} className={`flex-1 min-w-0 px-4 sm:px-8 py-6 lg:py-8 max-w-[1500px] ${theme.hlOff ? "hl-off" : ""}`}>{children}</main>
      </div>
    </ToastProvider>
  );
}

export { Pill };
