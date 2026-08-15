/** Tiny inline icon set — no dependency, inherits currentColor. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

export const IconArrowRight = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
    <path d="m13 5 7 7-7 7" />
  </svg>
);

export const IconApple = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M17.05 12.54c-.03-3.02 2.47-4.49 2.58-4.56a5.54 5.54 0 0 0-4.36-2.36c-1.83-.19-3.6 1.1-4.53 1.1-.95 0-2.39-1.08-3.94-1.05A5.79 5.79 0 0 0 1.94 8.6c-2.1 3.63-.54 8.97 1.48 11.91 1.01 1.44 2.18 3.05 3.73 2.99 1.52-.06 2.09-.96 3.93-.96 1.82 0 2.36.96 3.94.92 1.63-.03 2.66-1.44 3.63-2.9a11.9 11.9 0 0 0 1.66-3.38 5.24 5.24 0 0 1-3.26-4.64ZM14.07 3.68A5.31 5.31 0 0 0 15.29 0a5.4 5.4 0 0 0-3.5 1.75 5.05 5.05 0 0 0-1.25 3.53 4.46 4.46 0 0 0 3.53-1.6Z" />
  </svg>
);

export const IconGoogle = (p: P) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.35Z" />
    <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.42l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.59A10 10 0 0 0 12 22Z" />
    <path fill="#FBBC05" d="M6.39 13.9A6 6 0 0 1 6.08 12c0-.66.11-1.3.31-1.9V7.51H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.49l3.35-2.59Z" />
    <path fill="#EA4335" d="M12 5.97c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.35 2.59C7.18 7.73 9.39 5.97 12 5.97Z" />
  </svg>
);

export const IconArrowLeft = (p: P) => (
  <svg {...base(p)}>
    <path d="M19 12H5" />
    <path d="m11 19-7-7 7-7" />
  </svg>
);

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

export const IconPlay = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M8 5v14l11-7z" />
  </svg>
);

export const IconBolt = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" />
  </svg>
);

export const IconShield = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
  </svg>
);

export const IconSparkle = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M12 2c.5 4.5 3.5 7.5 8 8-4.5.5-7.5 3.5-8 8-.5-4.5-3.5-7.5-8-8 4.5-.5 7.5-3.5 8-8Z" />
  </svg>
);

export const IconExternal = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);

export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);

export const IconAlert = (p: P) => (
  <svg {...base(p)}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconUser = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 21a8 8 0 0 0-16 0" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 21v-7" />
    <path d="M4 10V3" />
    <path d="M12 21v-9" />
    <path d="M12 8V3" />
    <path d="M20 21v-5" />
    <path d="M20 12V3" />
    <path d="M1 14h6" />
    <path d="M9 8h6" />
    <path d="M17 16h6" />
  </svg>
);

export const IconCar = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 17h14" />
    <path d="M5 17a2 2 0 0 1-2-2v-2.5a2 2 0 0 1 .32-1.09L5.5 8.4A3 3 0 0 1 8 7h8a3 3 0 0 1 2.5 1.4l2.18 3.01A2 2 0 0 1 21 12.5V15a2 2 0 0 1-2 2" />
    <circle cx="7.5" cy="17" r="2" />
    <circle cx="16.5" cy="17" r="2" />
  </svg>
);

export const IconBattery = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="7" width="17" height="10" rx="2" />
    <path d="M22 10.5v3" />
    <rect x="5" y="10" width="4" height="4" fill="currentColor" stroke="none" />
  </svg>
);

/** Owner navigation icons share one restrained 1.8px outline language. */
const navBase = (props: P) => ({ ...base(props), strokeWidth: 1.8 });

export const IconOverview = (p: P) => (
  <svg {...navBase(p)}>
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="3" width="7" height="7" rx="2" />
    <rect x="3" y="14" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
  </svg>
);

export const IconDrivers = (p: P) => (
  <svg {...navBase(p)}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 20v-1.5A5.5 5.5 0 0 1 9 13h.5a5.5 5.5 0 0 1 5.5 5.5V20" />
    <path d="M15.5 5.3a3 3 0 0 1 0 5.4" />
    <path d="M17 13.3a5.5 5.5 0 0 1 3.5 5.2V20" />
  </svg>
);

export const IconTrips = (p: P) => (
  <svg {...navBase(p)}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M8.5 6h2.25a3.25 3.25 0 0 1 0 6.5H9.5a3.25 3.25 0 0 0 0 6.5h6" />
  </svg>
);

export const IconVehicle = (p: P) => (
  <svg {...navBase(p)}>
    <path d="M3 14.5V13a2 2 0 0 1 1.4-1.9l2.1-.7 2-3A3 3 0 0 1 11 6h3.8a3 3 0 0 1 2.4 1.2l2.1 2.8 1.1.4A2.4 2.4 0 0 1 22 12.7v1.8a1.5 1.5 0 0 1-1.5 1.5h-16A1.5 1.5 0 0 1 3 14.5Z" />
    <path d="M7 10.3h11.9" />
    <circle cx="7" cy="16" r="2" fill="currentColor" stroke="none" />
    <circle cx="18" cy="16" r="2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconClock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const IconChevronRight = (p: P) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const IconHome = (p: P) => (
  <svg {...navBase(p)}>
    <path d="m3 11 9-8 9 8" />
    <path d="M5 10v10h14V10" />
    <path d="M9 20v-6h6v6" />
  </svg>
);

export const IconInsights = (p: P) => (
  <svg {...navBase(p)}>
    <path d="M4 20V10" />
    <path d="M10 20V4" />
    <path d="M16 20v-7" />
    <path d="M22 20V7" />
    <path d="M2 20h22" />
  </svg>
);

export const IconPlug = (p: P) => (
  <svg {...navBase(p)}>
    <path d="M8 3v5" />
    <path d="M16 3v5" />
    <path d="M6 8h12v2a6 6 0 0 1-6 6v5" />
  </svg>
);

export const IconHelp = (p: P) => (
  <svg {...navBase(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.8 9a2.4 2.4 0 1 1 3.6 2.08c-.9.52-1.4 1-1.4 2.42" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconLock = (p: P) => (
  <svg {...navBase(p)}>
    <rect x="5" y="10" width="14" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

export const IconGuide = (p: P) => (
  <svg {...navBase(p)}>
    <path d="M5 4h13a1 1 0 0 1 1 1v15H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1Z" />
    <path d="M8 8h7M8 12h7M8 16h4" />
  </svg>
);

export const IconCalendar = (p: P) => (
  <svg {...navBase(p)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18" />
    <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
  </svg>
);

export const IconMapPin = (p: P) => (
  <svg {...navBase(p)}>
    <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

export const IconPhone = (p: P) => (
  <svg {...navBase(p)}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92Z" />
  </svg>
);

export const IconMail = (p: P) => (
  <svg {...navBase(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

export const IconKey = (p: P) => (
  <svg {...navBase(p)}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8-8M16 7l3 3M13 10l3 3" />
  </svg>
);
