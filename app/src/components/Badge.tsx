const TONE_CLASSES: Record<string, string> = {
  ok: "bg-green-100 text-green-800",
  warn: "bg-amber-100 text-amber-800",
  bad: "bg-red-100 text-red-800",
  info: "bg-blue-100 text-blue-800",
  neutral: "bg-brand-light text-brand-dark",
};

export default function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONE_CLASSES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

export function statusTone(status: string): keyof typeof TONE_CLASSES {
  if (status === "ready") return "ok";
  if (status === "needs_review") return "warn";
  if (status === "failed") return "bad";
  if (status === "processing") return "info";
  return "neutral";
}
