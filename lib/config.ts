/**
 * Host configuration — the ONE file a host edits per car / per listing.
 *
 * Everything guest-facing that is specific to *your* rental lives here:
 * the car, where the charge card is, your house rules, how to return it,
 * and how to reach you. The onboarding flow reads from this object, so you
 * never have to touch a component to re-brand the experience for a new car.
 */

export interface HostConfig {
  companyName: string;
  tagline: string;
  hostName: string;
  hostPhone: string;
  supportEmail: string;
  /** Roadside line guests should call. We point guests at Turo's 24/7 roadside assistance. */
  roadsidePhone: string;

  car: {
    model: string; // "Model 3"
    trim: string; // "Performance", "Long Range", "Highland", …
    year: number;
    color: string;
    /** 2024+ "Highland" Model 3 has no gear stalk — you shift on the screen. */
    shifter: "stalk" | "screen";
  };

  rental: {
    /** Where the key card lives and how the guest gets a phone key. */
    keyAccess: string;
    /** Where to find the charge card / how Supercharging is paid. */
    chargeAccess: string;
    /** Who pays for charging. Supercharging is billed to the car, then passed to the guest. */
    chargingPolicy: string;
    /** Charge level you expect on return, e.g. "at least 80%". */
    returnChargeLevel: string;
    /** The optional Turo add-on that lets a guest skip recharging before return. */
    skipChargeOption: string;
    pickupNote: string;
    returnNote: string;
    parkingNote: string;
  };

  houseRules: string[];
}

// Host identity & contact details come from env so personal info (phone numbers,
// email) stays out of the committed source. Set these in `.env.local` for local
// dev and in your deploy provider for production. They must be NEXT_PUBLIC_* and
// referenced statically here — Next.js only inlines static process.env reads into
// the client bundle (these values are guest-facing, so they ship to the browser).
// The fallbacks are placeholders so the app still renders without an env file.
export const hostConfig: HostConfig = {
  companyName: process.env.NEXT_PUBLIC_COMPANY_NAME || "Your Rental Co",
  tagline: process.env.NEXT_PUBLIC_TAGLINE || "Your Tesla, ready to roll.",
  hostName: process.env.NEXT_PUBLIC_HOST_NAME || "Your host",
  hostPhone: process.env.NEXT_PUBLIC_HOST_PHONE || "555-555-0100",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "host@example.com",
  roadsidePhone: process.env.NEXT_PUBLIC_ROADSIDE_PHONE || "555-555-0199",

  car: {
    model: "Model 3",
    trim: "Performance",
    year: 2024,
    color: "Black",
    shifter: "screen",
  },

  rental: {
    keyAccess:
      "Your phone becomes the key — we'll send a Tesla app invite before pickup. A backup key card is clipped inside the center console.",
    chargeAccess:
      "Supercharging just works — plug in and the session bills automatically to this car's Tesla account. There's no card to swipe at the stall.",
    chargingPolicy:
      "Charging isn't included in the rental. Whatever you Supercharge is billed to the car, then passed through to you and settled after your trip ends — at Tesla's published rate, no markup.",
    returnChargeLevel: "at least 80%",
    skipChargeOption:
      "Don't want to charge before returning? Add the $25 return-without-recharging option in the Turo app and we'll top it off for you.",
    pickupNote:
      "Walk around the car with us, check it's unlocked via your phone key, and make sure the Tesla app shows the car before you drive off.",
    returnNote:
      "Park where you picked it up, leave the key card in the console, take all your belongings, and tap 'Lock' in the app or walk away to auto-lock.",
    parkingNote:
      "Return to the same pickup spot unless we've agreed otherwise in your Turo messages.",
  },

  houseRules: [
    "No smoking or vaping — a clean cabin keeps this car a joy for everyone.",
    "Pets are welcome in a carrier or with a seat cover. Please vacuum up fur before return.",
    "Full Self-Driving (Supervised) still needs you — keep your hands ready, eyes on the road, and be ready to take over instantly.",
    "Return with at least 80% charge, or add the $25 return-without-recharging option in the Turo app.",
    "Treat the screen and seats kindly — no shoes on seats, no stickers, no mods.",
  ],
};
