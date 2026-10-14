import type { SVGProps } from "react";

const PATHS = {
  refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m18 15-6-6-6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  external: <><path d="M14 3h7v7" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></>,
  check: <path d="m5 12 5 5L20 7" strokeWidth={2.5} />,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 5-5" /></>,
  play: <path d="M7 5v14l11-7z" fill="currentColor" stroke="none" />,
  terminal: <><path d="m4 17 6-5-6-5" /><path d="M12 19h8" /></>,
  branch: <><circle cx="6" cy="5" r="2.25" /><circle cx="6" cy="19" r="2.25" /><circle cx="18" cy="8" r="2.25" /><path d="M6 7.25v9.5" /><path d="M18 10.25c0 3-3 4-6 4.5-2.4.4-4 1.2-4 2" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4.5" /><path d="M12 16h.01" /></>,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  arrowLeft: <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>,
  arrowRight: <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z" /></>,
  repo: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
  cpu: <><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M19 9h3M19 15h3M2 9h3M2 15h3" /></>,
  gauge: <><path d="m12 14 3.5-3.5" /><path d="M20.5 16a9 9 0 1 0-17 0" /></>,
  star: <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></>,
  github: (
    <path
      fill="currentColor"
      stroke="none"
      d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.8c.85 0 1.7.11 2.5.34 1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"
    />
  ),
  pullRequest: <><circle cx="6" cy="5" r="2.25" /><circle cx="6" cy="19" r="2.25" /><circle cx="18" cy="19" r="2.25" /><path d="M6 7.25v9.5" /><path d="M18 16.75V9a3 3 0 0 0-3-3h-4" /><path d="m13 3.5-2.5 2.5L13 8.5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" /></>,
  compare: <><path d="M4 7h14" /><path d="m15 4 3 3-3 3" /><path d="M20 17H6" /><path d="m9 14-3 3 3 3" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  mark: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /><path d="m8.5 11 1.8 1.8L13.5 9.5" /></>,
};

export type IconName = keyof typeof PATHS;

export default function Icon({ name, className, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? "size-4 shrink-0"}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
