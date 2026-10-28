const P: Record<string, string> = {
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
  file: "M7 3h7l5 5v13H7V3zM14 3v5h5",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  scale: "M12 3v18M5 7h14M5 7l-3 7a3 3 0 006 0L5 7zm14 0l-3 7a3 3 0 006 0l-3-7z",
  users: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0",
  chart: "M4 20V10m6 10V4m6 16v-7m6 7H2",
  spark: "M12 3l2.2 6.3L21 12l-6.8 2.7L12 21l-2.2-6.3L3 12l6.8-2.7L12 3z",
  image: "M4 5h16v14H4V5zm0 11l5-5 4 4 3-3 4 4M9 9.5h.01",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14 3h-4l-.6 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2 1.2L10 21h4l.6-2.6c.7-.3 1.4-.7 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z",
  plus: "M12 5v14M5 12h14",
  upload: "M12 16V4m0 0l-4 4m4-4l4 4M4 20h16",
  download: "M12 4v12m0 0l-4-4m4 4l4-4M4 20h16",
  check: "M5 12l5 5L20 7",
  x: "M6 6l12 12M18 6L6 18",
  warn: "M12 4l9 16H3L12 4zm0 6v4m0 3h.01",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18zm0-10v5m0-8h.01",
  history: "M3 12a9 9 0 109-9 9 9 0 00-7 3.4M3 4v5h5M12 8v5l3 2",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4",
  trash: "M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  chevron: "M9 6l6 6-6 6",
  chevdown: "M6 9l6 6 6-6",
  menu: "M4 6h16M4 12h16M4 18h16",
  fx: "M5 20c3 0 3-16 6-16M3 12h8m3-2l6 8m0-8l-6 8",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z",
  archive: "M4 7h16v4H4V7zm1 4v9h14v-9M10 15h4",
  copy: "M8 8h12v12H8V8zM4 4h12v2M4 4v12h2",
  play: "M7 4l13 8-13 8V4z",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z",
  pdf: "M7 3h7l5 5v13H7V3zM14 3v5h5M9 16h6M9 13h6",
  sheet: "M4 4h16v16H4V4zm0 5h16M4 14h16M10 4v16",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
};
export default function Icon({ name, className = "", stroke = 1.8 }: { name: keyof typeof P | string; className?: string; stroke?: number }) {
  if (!/(^|\s)(w|size)-/.test(className)) className = `w-4 h-4 ${className}`;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={P[name] ?? P.info} />
    </svg>
  );
}
