import type { Issue } from "@/lib/types";

const SEVERITY_CLASSES: Record<string, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-800",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  error: "border-red-200 bg-red-50 text-red-800",
};

export default function IssuesList({ issues }: { issues: Issue[] }) {
  if (!issues || issues.length === 0) return null;
  return (
    <div className="space-y-2 mb-4">
      {issues.map((issue, i) => (
        <div key={i} className={`border rounded-md px-3 py-2 text-sm ${SEVERITY_CLASSES[issue.severity] ?? SEVERITY_CLASSES.info}`}>
          {issue.message}
        </div>
      ))}
    </div>
  );
}
