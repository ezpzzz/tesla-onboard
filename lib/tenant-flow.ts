import { CHECKLIST, MODULES, type ChecklistItem, type Module } from "@/lib/content";
import type { FlowOptions, PathMode, Step } from "@/lib/flow";
import type { TenantConfig } from "@/lib/tenant-config";

function replacePoint(module: Module, heading: string, detail: string): Module {
  return {
    ...module,
    points: module.points.map((point) => (point.heading === heading ? { ...point, detail } : point)),
  };
}

export function modulesForTenant(config: TenantConfig): Module[] {
  const { car, rental } = config;
  const returnChargeDetail = `Please bring the car back with ${rental.returnChargeLevel} charge so the next guest is ready to go.${rental.skipChargeOption ? ` ${rental.skipChargeOption}` : ""}`;
  const shortReturnChargeDetail = `Bring it back with ${rental.returnChargeLevel} charge.${rental.skipChargeOption ? ` ${rental.skipChargeOption}` : ""}`;
  const shifterHowTo = car.shifter === "screen"
    ? "This Tesla has no gear stalk — swipe up on the left edge of the screen for Drive, down for Reverse. Press the brake first."
    : car.shifter === "console"
      ? "Use the center-console gear selector for Drive, Reverse, Neutral, and Park. Press the brake before selecting a direction."
      : "Use the right-hand stalk behind the wheel: push down for Drive, up for Reverse, press the end button for Park. Press the brake first.";

  return MODULES.map((source) => {
    let module: Module = {
      ...source,
      points: source.points.map((point) => ({ ...point })),
      video: source.video ? { ...source.video } : undefined,
    };
    switch (module.id) {
      case "phone-key":
        return { ...module, rentalNote: rental.keyAccess };
      case "driving-basics":
        module = replacePoint(module, "Shift into Drive", shifterHowTo);
        return {
          ...module,
          rentalNote: `You're driving a ${car.year} ${car.model} ${car.trim} in ${car.color}. Take the first few minutes gently to get a feel for the regen braking.`,
        };
      case "charging-this-car":
        return {
          ...module,
          points: [
            { heading: "How it's paid", detail: rental.chargeAccess },
            { heading: "Who pays for charging", detail: rental.chargingPolicy },
            {
              heading: "Return charge level",
              detail: returnChargeDetail,
            },
          ],
          rentalNote: rental.chargeAccess,
        };
      case "house-rules":
        return {
          ...module,
          points: config.houseRules.map((rule, index) => ({ heading: `Rule ${index + 1}`, detail: rule })),
        };
      case "return-trip":
        return {
          ...module,
          points: [
            { heading: "Charge", detail: shortReturnChargeDetail },
            ...(rental.parkingNote ? [{ heading: "Park", detail: rental.parkingNote }] : []),
            { heading: "Belongings", detail: "Grab everything — check the frunk, trunk, and door pockets." },
            ...(rental.returnNote ? [{ heading: "Lock up", detail: rental.returnNote }] : []),
          ],
          rentalNote: rental.returnNote || undefined,
        };
      case "help":
        return {
          ...module,
          points: module.points.map((point) => {
            if (point.heading === "Your host") {
              return { ...point, detail: `${config.hostName}: ${config.hostPhone}. Message your host first for anything non-urgent.` };
            }
            if (point.heading === "Roadside assistance") {
              return {
                ...point,
                detail: config.roadsidePhone
                  ? `Roadside assistance is available at **${config.roadsidePhone}** — save it now. They can help with flat tires, lockouts, tows, or if you ever run out of charge.`
                  : "Open your Turo trip details to contact 24/7 roadside assistance for flat tires, lockouts, towing, or an empty battery.",
              };
            }
            return point;
          }),
        };
      default:
        return module;
    }
  });
}

export function checklistForTenant(config: TenantConfig): ChecklistItem[] {
  return CHECKLIST.map((item) =>
    item.id === "house-rules"
      ? { ...item, detail: `Review the rental rules and return with ${config.rental.returnChargeLevel} charge.` }
      : item,
  );
}

export function buildTenantFlow(
  pathMode: PathMode | null,
  config: TenantConfig,
  opts: FlowOptions = {},
): Step[] {
  const head: Step[] = [
    { id: "welcome", kind: "welcome", title: "Welcome" },
    { id: "connect", kind: "connect", title: "Connect" },
  ];
  if (!pathMode) return head;
  const modules = modulesForTenant(config);
  const selected = pathMode === "full" ? modules : modules.filter((module) => !module.core);
  const moduleSteps: Step[] = selected.map((module) => ({
    id: module.id,
    kind: "module",
    title: module.title,
    module,
  }));
  const accountStep: Step[] = opts.newToTesla
    ? [{ id: "tesla-account", kind: "tesla-account", title: "Tesla account" }]
    : [];
  return [
    ...head,
    { id: "plan", kind: "plan", title: "Your plan" },
    ...accountStep,
    ...moduleSteps,
    { id: "checklist", kind: "checklist", title: "Readiness" },
    { id: "done", kind: "done", title: "All set" },
  ];
}
