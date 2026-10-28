"use client";
import { createContext, useCallback, useContext, useState } from "react";

type Toast = { id: number; text: string; tone: "ok" | "warn" | "bad" | "info"; action?: { label: string; run: () => void } };
const Ctx = createContext<{ push: (t: Omit<Toast, "id">) => void }>({ push: () => {} });
export const useToast = () => useContext(Ctx);

const TONE: Record<Toast["tone"], string> = {
  ok: "bg-emerald-700", warn: "bg-amber-700", bad: "bg-red-700", info: "bg-brand-dark",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { ...t, id }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), t.action ? 9000 : 4200);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 max-w-sm">
        {items.map((t) => (
          <div key={t.id} className={`${TONE[t.tone]} text-white text-sm rounded-lg shadow-lg px-4 py-3 flex items-start gap-3`}>
            <span className="flex-1 leading-snug">{t.text}</span>
            {t.action && (
              <button onClick={() => { t.action!.run(); setItems((s) => s.filter((x) => x.id !== t.id)); }} className="font-semibold underline underline-offset-2 whitespace-nowrap">
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
