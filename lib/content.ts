/**
 * Tutorial content + readiness checklist.
 *
 * Modules are split into two kinds:
 *   - core  (foundational "how a Tesla works") — shown on the FULL walkthrough.
 *   - !core (this rental's specifics)          — always shown, even to owners.
 *
 * An experienced guest defaults to the rental-only "essentials" route but can
 * always opt into the full tour on the plan step.
 *
 * Each module has an optional official-Tesla video. Drop a YouTube video id into
 * `youtubeId` to embed it inline; otherwise the card links to Tesla's official
 * support videos so guests always reach first-party material.
 */

import { hostConfig } from "./config";

export interface ModulePoint {
  heading: string;
  detail: string;
}

export interface ModuleVideo {
  title: string;
  /**
   * Official Tesla YouTube video id — VERIFIED OFFICIAL ONLY.
   * Every id here was checked via YouTube oEmbed to confirm the uploader is an
   * official Tesla channel: author_url is youtube.com/@tesla OR
   * youtube.com/@tesla_tutorials (Tesla's dedicated tutorial channel, the source
   * Tesla embeds on its own support pages). No other third-party / aggregator videos.
   */
  youtubeId: string;
}

export interface Module {
  id: string;
  title: string;
  tagline: string;
  emoji: string;
  minutes: number;
  /** core = foundational driving knowledge (full tour only). */
  core: boolean;
  intro: string;
  points: ModulePoint[];
  /** Highlighted callout specific to this rental. */
  rentalNote?: string;
  video?: ModuleVideo;
}

const { car, rental } = hostConfig;

const shifterHowTo =
  car.shifter === "screen"
    ? "This is a newer Model 3, so there's no gear stalk — swipe up on the left edge of the screen for Drive, down for Reverse. Press the brake first."
    : "Use the right-hand stalk behind the wheel: push down for Drive, up for Reverse, press the end button for Park. Press the brake first.";

export const MODULES: Module[] = [
  {
    id: "phone-key",
    title: "Getting in",
    tagline: "Your phone is the key",
    emoji: "🔑",
    minutes: 2,
    core: false,
    intro:
      "There's no traditional key. Your phone unlocks and starts the car over Bluetooth, with a backup card for when your battery dies.",
    points: [
      {
        heading: "Phone key",
        detail:
          "Once your Tesla app invite is accepted, the car unlocks as you approach and locks as you walk away. Keep Bluetooth on.",
      },
      {
        heading: "Key card backup",
        detail:
          "Tap the card on the door pillar (just behind the driver's door handle) to unlock. To drive, tap it on the center console between the seats.",
      },
      {
        heading: "Door handles",
        detail:
          "From outside, press the wide part of the handle and the door pops open. From inside, use the button at the top of the armrest — pull the manual latch only in an emergency.",
      },
    ],
    rentalNote: rental.keyAccess,
    video: { title: "Model 3 Essentials: Access", youtubeId: "ya5iYfWqMN0" },
  },
  {
    id: "driving-basics",
    title: "Start & drive",
    tagline: "One pedal does almost everything",
    emoji: "🚗",
    minutes: 4,
    core: true,
    intro:
      "A Tesla is ready the moment you sit down — there's no start button. The biggest adjustment is one-pedal driving.",
    points: [
      {
        heading: "It's already on",
        detail:
          "Sit down with the phone key or card recognized and the car powers up. No ignition, no start button.",
      },
      { heading: "Shift into Drive", detail: shifterHowTo },
      {
        heading: "One-pedal driving",
        detail:
          "Lift off the accelerator and the car slows itself firmly while recharging the battery (regenerative braking). Ease off gently for a smooth stop — you'll rarely touch the brake.",
      },
      {
        heading: "It holds for you",
        detail:
          "Come to a full stop and the car holds the brake automatically. Press the accelerator to go again.",
      },
    ],
    rentalNote: `You're driving a ${car.year} ${car.model} ${car.trim} in ${car.color}. Take the first few minutes gently to get a feel for the regen braking.`,
    video: { title: "Your Tesla Can Shift Directions for You", youtubeId: "3mvOB88iYkE" },
  },
  {
    id: "the-screen",
    title: "The touchscreen",
    tagline: "Your dashboard, controls, and map",
    emoji: "📱",
    minutes: 3,
    core: true,
    intro:
      "Almost everything lives on the center screen. Speed and driving info sit in the top-left so your eyes stay near the road.",
    points: [
      {
        heading: "Climate",
        detail:
          "Tap the temperature at the bottom to adjust heat, A/C, and the heated seats. Tap the fan for airflow.",
      },
      {
        heading: "Wipers & lights are automatic",
        detail:
          "Both default to auto. For a single wipe, use the button on the left stalk (or the wiper icon on screen on stalk-less cars).",
      },
      {
        heading: "Navigation",
        detail:
          "Tap the map and search a destination. It routes you through chargers automatically on longer trips and preconditions the battery.",
      },
      {
        heading: "Voice commands",
        detail:
          'Press the right scroll button on the wheel and just say it: "Set temperature to 70", "Navigate home", "Take me to a Supercharger".',
      },
    ],
    video: { title: "Model 3 Essentials: Driver Controls", youtubeId: "HfeXzeA0s3Q" },
  },
  {
    id: "autopilot",
    title: "Full Self-Driving",
    tagline: "A supervised co-pilot — you stay in charge",
    emoji: "🛟",
    minutes: 3,
    core: true,
    intro:
      "This car has Full Self-Driving (Supervised). It can steer, keep pace with traffic, change lanes, and handle turns and stops — but it's an assist, not a robot driver. You stay fully responsible and ready to take over at any moment.",
    points: [
      {
        heading: "What it does",
        detail:
          "With a destination set, it can steer, manage speed and following distance, change lanes, and work through intersections and traffic lights — all under your supervision.",
      },
      {
        heading: "Hands ready, eyes up",
        detail:
          "Keep light pressure on the wheel and watch the road. The car will alert you and hand back control if it thinks you're not paying attention.",
      },
      {
        heading: "Taking over",
        detail:
          "Tap the brake or turn the wheel and Full Self-Driving instantly gives control back to you. When in doubt, just drive it yourself.",
      },
      {
        heading: "When to be extra careful",
        detail:
          "Stay especially alert in bad weather, heavy city traffic, construction, and anywhere lane lines are unclear. It's capable, but it can and does make mistakes.",
      },
    ],
    rentalNote:
      "Full Self-Driving is enabled on this car as a convenience — but supervising it is a house rule and a safety must. Stay hands-ready and attentive the entire time it's engaged.",
    video: { title: "Full Self-Driving (Supervised)", youtubeId: "TUDiG7PcLBs" },
  },
  {
    id: "charging-basics",
    title: "How charging works",
    tagline: "Plug in, don't fill up",
    emoji: "⚡",
    minutes: 4,
    core: true,
    intro:
      "You'll charge instead of refuel. Superchargers are fast and everywhere; you'll plan around them the way you'd plan a coffee stop.",
    points: [
      {
        heading: "The charge port",
        detail:
          "It's on the driver's side, in the rear tail light. Open it by tapping the bolt icon on the screen, or press the button on the Supercharger handle.",
      },
      {
        heading: "Supercharging is effortless",
        detail:
          "Pull in, plug in — that's it. The car and stall talk to each other and billing is automatic to the account on file. 15–30 minutes covers most stops.",
      },
      {
        heading: "Find chargers on the map",
        detail:
          "Tap the lightning bolt on the map to see nearby Superchargers with live stall availability. Navigate to one and the battery preheats for the fastest charge.",
      },
      {
        heading: "The 20–80% rule",
        detail:
          "For day-to-day driving, keeping the battery roughly between 20% and 80% is healthiest and fastest. No need to charge to 100% unless you're heading on a long trip.",
      },
    ],
    video: { title: "Supercharging Your Tesla", youtubeId: "WL6UWX26NaE" },
  },
  {
    id: "charging-this-car",
    title: "Charging this rental",
    tagline: "Who pays, and how it's billed",
    emoji: "🔌",
    minutes: 2,
    core: false,
    intro:
      "Charging this specific car is set up to be painless. Here's exactly how it works — and what it costs — for your trip.",
    points: [
      { heading: "How it's paid", detail: rental.chargeAccess },
      { heading: "Who pays for charging", detail: rental.chargingPolicy },
      {
        heading: "Return charge level",
        detail: `Please bring the car back with ${rental.returnChargeLevel} charge so the next guest is ready to go. ${rental.skipChargeOption}`,
      },
    ],
    rentalNote: rental.chargeAccess,
    video: { title: "Supercharging Your Tesla", youtubeId: "WL6UWX26NaE" },
  },
  {
    id: "house-rules",
    title: "House rules",
    tagline: "A few things that keep this car great",
    emoji: "📋",
    minutes: 2,
    core: false,
    intro:
      "Short and reasonable. Following these keeps your deposit safe and the car a pleasure for everyone after you.",
    points: hostConfig.houseRules.map((rule, i) => ({
      heading: `Rule ${i + 1}`,
      detail: rule,
    })),
  },
  {
    id: "return-trip",
    title: "Ending your trip",
    tagline: "Return it like a pro",
    emoji: "🏁",
    minutes: 2,
    core: false,
    intro: "Wrapping up takes a minute. Here's the checklist for a smooth return.",
    points: [
      {
        heading: "Charge",
        detail: `Bring it back with ${rental.returnChargeLevel} charge. ${rental.skipChargeOption}`,
      },
      { heading: "Park", detail: rental.parkingNote },
      { heading: "Belongings", detail: "Grab everything — check the frunk, trunk, and door pockets." },
      { heading: "Lock up", detail: rental.returnNote },
    ],
    rentalNote: rental.returnNote,
  },
  {
    id: "help",
    title: "Help & emergencies",
    tagline: "We've got your back, 24/7",
    emoji: "🆘",
    minutes: 1,
    core: false,
    intro: "Save these now so they're one tap away if you ever need them.",
    points: [
      {
        heading: "Your host",
        detail: `${hostConfig.hostName}: ${hostConfig.hostPhone}. Message me on Turo first for anything non-urgent.`,
      },
      {
        heading: "Roadside assistance",
        detail: `Turo's roadside assistance is available 24/7 at **${hostConfig.roadsidePhone}** — save it now. They'll help with flat tires, lockouts, tows, or if you ever run out of charge.`,
      },
      {
        heading: "In an accident",
        detail:
          "Make sure everyone's safe, call emergency services if needed, then contact me. Photos help with the Turo claim.",
      },
      {
        heading: "The manual is built in",
        detail:
          `Tap the question-mark or open "Manual" from the car's app launcher for anything we didn't cover.`,
      },
    ],
  },
];

export function moduleById(id: string): Module | undefined {
  return MODULES.find((m) => m.id === id);
}

/* ── Readiness checklist (the "permissions / everything-you-need" sync) ───── */

export interface ChecklistItem {
  id: string;
  label: string;
  detail: string;
  required: boolean;
  link?: { label: string; href: string };
}

export const CHECKLIST: ChecklistItem[] = [
  {
    id: "tesla-app",
    label: "Tesla app installed & signed in",
    detail: "You'll use it for your phone key, charging, and locating the car.",
    required: true,
    link: { label: "Get the Tesla app", href: "https://www.tesla.com/app" },
  },
  {
    id: "phone-key",
    label: "Phone key working (or key card located)",
    detail: "Confirm the car unlocks from your phone, or you know where the card is.",
    required: true,
  },
  {
    id: "charging",
    label: "I know how to charge & who pays",
    detail: "Charge port location, plug-in, and this rental's charging policy.",
    required: true,
  },
  {
    id: "house-rules",
    label: "I've read the house rules",
    detail: "No smoking, return at 80%, and supervise Full Self-Driving.",
    required: true,
  },
  {
    id: "contacts",
    label: "Host & roadside numbers saved",
    detail: "One tap away if anything comes up on your trip.",
    required: true,
  },
  {
    id: "one-pedal",
    label: "I'm comfortable with one-pedal driving",
    detail: "Optional, but it makes the first few miles feel natural.",
    required: false,
  },
];
