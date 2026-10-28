"use client";
import { useEffect } from "react";
import Icon from "./Icon";

export function Button({ children, variant = "secondary", size = "md", icon, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "dark"; size?: "sm" | "md"; icon?: string }) {
  const base = "inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
  const sizes = { sm: "text-xs px-2.5 py-1.5", md: "text-sm px-3.5 py-2" };
  const variants = {
    primary: "bg-brand-primary hover:bg-brand-primary-dull text-white shadow-sm",
    secondary: "bg-white border border-line hover:border-brand-primary/60 hover:text-brand-primary text-brand-dark",
    ghost: "text-brand-dark/70 hover:bg-black/5",
    danger: "bg-red-600 hover:bg-red-700 text-white",
    dark: "bg-brand-dark hover:bg-brand-dark-dull text-white",
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {icon && <Icon name={icon} className="w-4 h-4" />}
      {children}
    </button>
  );
}

export function Card({ children, className = "", ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(30,20,10,0.04)] ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight text-brand-dark truncate">{title}</h1>
        {subtitle && <div className="text-sm text-brand-dark/55 mt-1">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return <span className={`inline-block ${className} border-2 border-current border-t-transparent rounded-full animate-spin`} />;
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 overflow-y-auto" role="dialog" aria-modal>
      <div className="fixed inset-0 bg-black/45 backdrop-blur-[1px]" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-3xl" : "max-w-lg"} mt-8`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="font-semibold text-brand-dark">{title}</h2>
          <button onClick={onClose} className="text-brand-dark/50 hover:text-brand-dark p-1"><Icon name="x" /></button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line bg-brand-light-dull/70 rounded-b-2xl flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = "w-[460px]" }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={`absolute right-0 top-0 bottom-0 ${width} max-w-full bg-white shadow-2xl flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="font-semibold text-brand-dark">{title}</h2>
          <button onClick={onClose} className="text-brand-dark/50 hover:text-brand-dark p-1"><Icon name="x" /></button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon = "folder", title, text, action }: { icon?: string; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <Card className="p-10 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-brand-light flex items-center justify-center text-brand-accent mb-3"><Icon name={icon} className="w-6 h-6" /></div>
      <div className="font-semibold text-brand-dark">{title}</div>
      {text && <p className="text-sm text-brand-dark/55 mt-1 max-w-md mx-auto">{text}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Card>
  );
}

export function Pill({ tone = "neutral", children, title }: { tone?: "ok" | "warn" | "bad" | "info" | "neutral" | "accent"; children: React.ReactNode; title?: string }) {
  const t = {
    ok: "bg-emerald-50 text-emerald-800 border-emerald-200",
    warn: "bg-amber-50 text-amber-800 border-amber-200",
    bad: "bg-red-50 text-red-800 border-red-200",
    info: "bg-blue-50 text-blue-800 border-blue-200",
    neutral: "bg-brand-light/70 text-brand-dark/70 border-line",
    accent: "bg-brand-accent/10 text-brand-accent border-brand-accent/20",
  }[tone];
  return <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${t}`}>{children}</span>;
}

export const statusPill = (status: string): { tone: "ok" | "warn" | "bad" | "info" | "neutral"; label: string } =>
  status === "ready" ? { tone: "ok", label: "Ready" }
  : status === "needs_review" ? { tone: "warn", label: "Needs review" }
  : status === "failed" ? { tone: "bad", label: "Failed" }
  : status === "processing" || status === "uploaded" ? { tone: "info", label: "Reading…" }
  : { tone: "neutral", label: status };

export function Menu({ items, label }: { items: { label: string; icon?: string; onClick?: () => void; href?: string; danger?: boolean; divider?: boolean }[]; label?: React.ReactNode }) {
  return (
    <details className="relative group">
      <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-white border border-line hover:border-brand-primary/60 select-none [&::-webkit-details-marker]:hidden">
        {label ?? <Icon name="dots" />}
      </summary>
      <div className="absolute right-0 mt-1.5 w-56 bg-white border border-line rounded-xl shadow-xl z-30 py-1.5 text-sm">
        {items.map((it, i) =>
          it.divider ? <div key={i} className="my-1 border-t border-line" /> : it.href ? (
            <a key={i} href={it.href} className={`flex items-center gap-2 px-3.5 py-2 hover:bg-brand-light-dull ${it.danger ? "text-red-600" : ""}`}>{it.icon && <Icon name={it.icon} />}{it.label}</a>
          ) : (
            <button key={i} onClick={(e) => { it.onClick?.(); (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open"); }} className={`w-full text-left flex items-center gap-2 px-3.5 py-2 hover:bg-brand-light-dull ${it.danger ? "text-red-600" : ""}`}>{it.icon && <Icon name={it.icon} />}{it.label}</button>
          )
        )}
      </div>
    </details>
  );
}

export const ExportMenu = ({ base, label = "Export", extras }: { base: string; label?: string; extras?: { label: string; href: string; icon?: string }[] }) => (
  <Menu
    label={<><Icon name="download" />{label}<Icon name="chevdown" className="w-3.5 h-3.5" /></>}
    items={[
      { label: "Excel (.xlsx)", icon: "sheet", href: `${base}${base.includes("?") ? "&" : "?"}format=xlsx` },
      { label: "PDF", icon: "pdf", href: `${base}${base.includes("?") ? "&" : "?"}format=pdf` },
      { label: "CSV", icon: "file", href: `${base}${base.includes("?") ? "&" : "?"}format=csv` },
      ...(extras ? [{ label: "", divider: true }, ...extras] : []),
    ]}
  />
);
