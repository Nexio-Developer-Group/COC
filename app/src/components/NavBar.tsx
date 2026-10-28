import Image from "next/image";
import Link from "next/link";

export default function NavBar() {
  return (
    <header className="bg-brand-dark border-b border-black/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/logo.png" alt="Logo" width={36} height={36} className="rounded" />
          <span className="text-brand-light-dull font-semibold text-lg tracking-tight">
            TenderBoard
          </span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/" className="text-brand-light-dull/80 hover:text-brand-primary transition-colors">
            Tenders
          </Link>
          <Link
            href="/tenders/new"
            className="bg-brand-primary hover:bg-brand-primary-dull text-white font-medium px-4 py-2 rounded-md transition-colors"
          >
            + New Tender
          </Link>
        </nav>
      </div>
    </header>
  );
}
