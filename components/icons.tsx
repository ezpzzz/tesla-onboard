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
