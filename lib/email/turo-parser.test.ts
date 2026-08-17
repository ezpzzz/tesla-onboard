import { describe, expect, it } from "vitest";
import type { NormalizedEmailManifest } from "@evhost/email-ingest-contract";
import { parseTuroEmail, resolveLocalInstant } from "./turo-parser";

// Every HTML/text fragment below is entirely synthetic (fake names, fake reservation
// ids, fake CDN tokens) but mirrors the *real* DOM shapes confirmed by direct
// inspection of unmodified Turo .eml captures in .turo-email-examples/ (read-only,
// never committed — see docs/specs/2026-08-16-executor-build-spec.md's "Verified
// extraction facts" section). Nothing here can approve a template fingerprint: the
// allowlist passed to parseTuroEmail is always empty.

function manifest(overrides: Partial<NormalizedEmailManifest>): NormalizedEmailManifest {
  return {
    version: 1,
    from: "Turo <noreply@mail.turo.com>",
    to: "proxy@mail.evhost.app",
    subject: "Riley's trip with your Tesla Model 3 is booked!",
    messageId: "<synthetic-1@example>",
    date: "2026-08-15T12:00:00Z",
    text: "",
    html: null,
    receiverAuth: { dkim: "pass", dmarc: "pass", spf: "pass", arc: "unknown" },
    ...overrides,
  };
}

/**
 * Builds a synthetic trip-detail partial mirroring the real shared block Turo embeds
 * across booking/change/cancellation/guest-message templates: an "About the guest"
 * avatar+name(+phone) block, a "Trip start"/"Trip end" structured date/time block, a
 * "Location" address block backed by a Google Static Maps `content: url(...)` CSS
 * rule, and (only for guest_message) a `td.message_box_blurple` guest message.
 */
function tripDetailHtml(opts: {
  guestName: string;
  avatarToken: string;
  driverId: string;
  phone?: string;
  vehicleName?: string;
  vehicleYear?: string;
  tripStartDate?: string;
  tripStartTime?: string;
  tripEndDate?: string;
  tripEndTime?: string;
  lat?: string;
  lng?: string;
  addressLines?: string[];
  messageText?: string;
  extraMessageBoxes?: boolean;
}): string {
  const vehicleBlock = opts.vehicleName
    ? `<table class="trip-details-wrapper"><tr><td>
         <a href="https://turo.com/us/en/car-rental/united-states/phoenix-az/tesla/model-3/9990001" style="font-weight:900">
           ${opts.vehicleName}
           <span>${opts.vehicleYear}</span>
         </a>
       </td></tr></table>`
    : "";

  const tripBlock = opts.tripStartDate
    ? `<table class="trip-details-wrapper">
         <tr><td><div style="text-transform:uppercase">Trip start</div></td></tr>
         <tr><td><strong>${opts.tripStartDate}</strong></td></tr>
         <tr><td style="color:#898989">${opts.tripStartTime}</td></tr>
       </table>
       <table class="trip-details-wrapper">
         <tr><td><div style="text-transform:uppercase">Trip end</div></td></tr>
         <tr><td><strong>${opts.tripEndDate}</strong></td></tr>
         <tr><td style="color:#898989">${opts.tripEndTime}</td></tr>
       </table>`
    : "";

  const locationBlock = opts.lat
    ? `<div style="text-transform:uppercase">Location</div>
       <a href="http://maps.google.com/maps?f=q&geocode=&q=${opts.lat},${opts.lng}">
         <table><tr><td align="center">${(opts.addressLines ?? []).join("<br>")}</td></tr></table>
       </a>
       <p><a class="map-image-link" href="http://maps.google.com/maps?q=${opts.lat}%2C${opts.lng}&key=demo">
         <img src="http://maps.googleapis.com/maps/api/staticmap?center=${opts.lat}%2C${opts.lng}&zoom=16&key=demo" border="0">
       </a></p>
       <style type="text/css">
         @media only screen and (min-resolution: 2dppx) {
           .map-image-link img {
             content: url('http://maps.googleapis.com/maps/api/staticmap?center=${opts.lat}%2C${opts.lng}&maptype=roadmap&zoom=16&size=360x186&scale=2&key=demo');
           }
         }
       </style>`
    : "";

  const messageBlock = opts.messageText
    ? `${opts.extraMessageBoxes ? `<td class="message_box_green" width="100%">unrelated shared CSS variant text</td>
         <td class="message_box_purple" width="100%">also unrelated</td>` : ""}
       <tr><td class="message_box_blurple" width="100%" align="center">
         ${opts.messageText}
       </td></tr>`
    : "";

  const avatarBlock = `<div style="text-transform:uppercase">About the guest</div>
    <span>
      <a href="https://turo.com/us/en/drivers/${opts.driverId}">
        <img width="70" height="70" src="https://images.turo.com/media/driver/${opts.avatarToken}.300x300.jpg"
             style="border-radius:35px" alt="${opts.guestName}" title="${opts.guestName}"/>
      </a>
    </span>
    <a href="https://turo.com/us/en/drivers/${opts.driverId}">${opts.guestName}</a>
    ${opts.phone ? `<a href="tel:${opts.phone}">(formatted display, not the extraction source)</a>` : ""}`;

  return `<html><body>${vehicleBlock}${tripBlock}${locationBlock}${messageBlock}${avatarBlock}</body></html>`;
}

const PHOENIX_ADDRESS = ["100 North 3rd Street", "Phoenix, AZ"];

describe("parseTuroEmail — booking (ReservationBookedOwner)", () => {
  const html = tripDetailHtml({
    guestName: "Riley",
    avatarToken: "avatar-tok-riley",
    driverId: "40010001",
    phone: "+15125550101",
    vehicleName: "Tesla Model 3",
    vehicleYear: "2024",
    tripStartDate: "9/15/26",
    tripStartTime: "6:00 pm",
    tripEndDate: "9/21/26",
    tripEndTime: "6:00 pm",
    lat: "33.5000000",
    lng: "-112.0000000",
    addressLines: PHOENIX_ADDRESS,
  });
  const email = manifest({
    subject: "Riley's trip with your Tesla Model 3 is booked!",
    text: "Great news! Riley's trip with your Tesla Model 3 is booked. Reservation ID #71234567. You'll earn $419.90.",
    html,
  });

  it("extracts avatar, phone, vehicle, GPS, address, and driver id from the shared trip-detail partial", () => {
    const parsed = parseTuroEmail(email);
    expect(parsed.eventType).toBe("booking");
    expect(parsed.reservationId).toBe("71234567");
    expect(parsed.proposedState.guestAvatarUrl).toBe("https://images.turo.com/media/driver/avatar-tok-riley.300x300.jpg");
    expect(parsed.proposedState.guestFirstName).toBe("Riley");
    expect(parsed.proposedState.guestPhoneE164).toBe("+15125550101");
  });

  it("does not confuse a vehicle photo path with the guest avatar path", () => {
    const withVehiclePhoto = manifest({
      subject: email.subject,
      text: email.text,
      html: html.replace(
        "<body>",
        `<body><img src="https://images.turo.com/media/vehicle/images/unrelated-token.620x372.heic" alt="Tesla Model 3">`,
      ),
    });
    const parsed = parseTuroEmail(withVehiclePhoto);
    expect(parsed.proposedState.guestAvatarUrl).toBe("https://images.turo.com/media/driver/avatar-tok-riley.300x300.jpg");
  });

  it("extracts vehicle name/year and GPS/address from the map partial", () => {
    const parsed = parseTuroEmail(email);
    expect(parsed.proposedState.vehicleName).toBe("Tesla Model 3");
    expect(parsed.proposedState.vehicleYear).toBe("2024");
    expect(parsed.proposedState.pickupLat).toBe("33.5000000");
    expect(parsed.proposedState.pickupLng).toBe("-112.0000000");
    expect(parsed.proposedState.pickupStaticMapUrl).toContain("maps.googleapis.com/maps/api/staticmap");
    expect(parsed.proposedState.pickupAddress).toBe("100 North 3rd Street, Phoenix, AZ");
  });

  it("extracts the guest's body-derived driver id, never the untrusted Driver-ID header value", () => {
    const parsed = parseTuroEmail(email);
    // The extraction source is the /drivers/<id> body link, not any header — this
    // module never even sees custom headers (NormalizedEmailManifest carries none).
    expect(parsed.proposedState.guestDriverId).toBe("40010001");
  });

  it("extracts the projected earnings amount from the booking sentence", () => {
    const parsed = parseTuroEmail(email);
    expect(parsed.proposedState.earningsTotal).toBe("419.90");
  });

  it("carries no guest message text for a booking template", () => {
    const parsed = parseTuroEmail(email);
    expect(parsed.proposedState.guestMessageText).toBeUndefined();
  });
});

describe("parseTuroEmail — guest_message (MessageOwner)", () => {
  const html = tripDetailHtml({
    guestName: "Jordan",
    avatarToken: "avatar-tok-jordan",
    driverId: "40010002",
    phone: "+14805550142",
    vehicleName: "Tesla Model 3",
    vehicleYear: "2024",
    tripStartDate: "8/9/26",
    tripStartTime: "8:00 AM",
    tripEndDate: "8/10/26",
    tripEndTime: "10:00 PM",
    lat: "33.50000",
    lng: "-112.00000",
    addressLines: PHOENIX_ADDRESS,
    messageText: "Hi! What time works best for an early pickup tomorrow?",
    extraMessageBoxes: true,
  });
  const email = manifest({
    subject: "Jordan has sent you a message about your Tesla Model 3",
    text: "You have a new message from your guest. Reservation #71298351.",
    html,
  });

  it("extracts only the blurple message box, never the green/purple shared-CSS variants", () => {
    const parsed = parseTuroEmail(email);
    expect(parsed.eventType).toBe("guest_message");
    expect(parsed.proposedState.guestMessageText).toBe("Hi! What time works best for an early pickup tomorrow?");
    expect(parsed.proposedState.guestMessageText).not.toContain("unrelated shared CSS");
    expect(parsed.proposedState.guestMessageText).not.toContain("also unrelated");
  });

  it("still extracts avatar/phone/vehicle/trip-window facts for a message email", () => {
    const parsed = parseTuroEmail(email);
    expect(parsed.proposedState.guestFirstName).toBe("Jordan");
    expect(parsed.proposedState.guestPhoneE164).toBe("+14805550142");
    expect(parsed.proposedState.tripStartLocalText).toBe("8/9/26 8:00 AM");
    expect(parsed.proposedState.tripEndLocalText).toBe("8/10/26 10:00 PM");
  });
});

describe("parseTuroEmail — cancellation (CancelledReservationOwner)", () => {
  // Registers the newly-arrived real cancellation template shape: real subject is
  // "<Name> has cancelled their trip with your Tesla Model 3" (Notification-Name
  // CancelledReservationOwner), which the existing cancelled|canceled classifier
  // regex already handles correctly — this was a fixture-registry gap, not a
  // classifier bug (see docs/spikes/2026-08-16-turo-email-evidence.md).
  const html = tripDetailHtml({
    guestName: "Taylor",
    avatarToken: "avatar-tok-taylor",
    driverId: "40010003",
    // Real cancellation captures carry no tel: link — contact info is withheld once
    // the trip is cancelled. Deliberately no `phone` here.
    vehicleName: "Tesla Model 3",
    vehicleYear: "2024",
    tripStartDate: "9/24/26",
    tripStartTime: "8:30 PM",
    tripEndDate: "9/28/26",
    tripEndTime: "9:30 PM",
    lat: "33.50000",
    lng: "-112.00000",
    addressLines: PHOENIX_ADDRESS,
  });
  const email = manifest({
    subject: "Taylor has cancelled their trip with your Tesla Model 3",
    text: "Taylor has cancelled this trip with your Tesla Model 3. Reservation ID #71234582.",
    html,
  });

  it("classifies the real cancellation subject shape as 'cancellation' and extracts its reservation id", () => {
    const parsed = parseTuroEmail(email);
    expect(parsed.eventType).toBe("cancellation");
    expect(parsed.reservationId).toBe("71234582");
  });

  it("extracts avatar/vehicle/trip-window/location but never fabricates a phone number", () => {
    const parsed = parseTuroEmail(email);
    expect(parsed.proposedState.guestAvatarUrl).toContain("avatar-tok-taylor");
    expect(parsed.proposedState.vehicleName).toBe("Tesla Model 3");
    expect(parsed.proposedState.pickupAddress).toBe("100 North 3rd Street, Phoenix, AZ");
    expect(parsed.proposedState.guestPhoneE164).toBeUndefined();
  });
});

describe("parseTuroEmail — pickup_location_unresolved blocker", () => {
  it("blocks when html is null for a location-bearing event type", () => {
    const parsed = parseTuroEmail(manifest({
      subject: "Riley's trip with your Tesla Model 3 is booked!",
      text: "Reservation ID #71234567.",
      html: null,
    }));
    expect(parsed.blockerCodes).toContain("pickup_location_unresolved");
  });

  it("never blocks a noise or unknown template on html-null, since none carry pickup location", () => {
    const noise = parseTuroEmail(manifest({
      subject: "Your earnings are on the way!",
      text: "We've sent your earnings payment of $99.88.",
      html: null,
    }));
    expect(noise.eventType).toBe("noise");
    expect(noise.blockerCodes).not.toContain("pickup_location_unresolved");

    const unknown = parseTuroEmail(manifest({ subject: "A completely different Turo subject line", text: "", html: null }));
    expect(unknown.eventType).toBe("unknown");
    expect(unknown.blockerCodes).not.toContain("pickup_location_unresolved");
  });

  it("does not block when html is present, even if the location partial happens to be absent from it", () => {
    const parsed = parseTuroEmail(manifest({
      subject: "Riley's trip with your Tesla Model 3 is booked!",
      text: "Reservation ID #71234567.",
      html: "<html><body>No location partial here.</body></html>",
    }));
    expect(parsed.blockerCodes).not.toContain("pickup_location_unresolved");
  });
});

describe("parseTuroEmail — messageText (subject+body fallback for every candidate)", () => {
  it("carries subject+body for an unknown-template candidate, which gets no other extraction at all", () => {
    const parsed = parseTuroEmail(manifest({
      subject: "Please verify your email address",
      text: "Synthetic body: click https://turo.example/verify?token=abc123 to verify your email.",
      html: null,
    }));
    expect(parsed.eventType).toBe("unknown");
    expect(parsed.proposedState.messageText).toBe(
      "Subject: Please verify your email address\n\nSynthetic body: click https://turo.example/verify?token=abc123 to verify your email.",
    );
  });

  it("falls back to a stripped, line-broken version of html when there's no text part", () => {
    const parsed = parseTuroEmail(manifest({
      subject: "Please verify your email address",
      text: "",
      html: "<html><body><p>Line one.</p><p>Line two with a <a href=\"https://turo.example/verify?token=abc123\">verify link</a>.</p></body></html>",
    }));
    expect(parsed.proposedState.messageText).toBe(
      "Subject: Please verify your email address\n\nLine one.\nLine two with a verify link.",
    );
  });

  it("is also present on a known event type (additive to its structured extraction, not a replacement)", () => {
    const parsed = parseTuroEmail(manifest({
      subject: "Riley's trip with your Tesla Model 3 is booked!",
      text: "Reservation ID #71234567. Riley's trip with your Tesla Model 3 is booked!",
      html: null,
    }));
    expect(parsed.eventType).toBe("booking");
    expect(parsed.proposedState.messageText).toContain("Reservation ID #71234567");
  });

  it("truncates to the documented bound instead of writing an unbounded jsonb value", () => {
    const parsed = parseTuroEmail(manifest({
      subject: "Please verify your email address",
      text: "x".repeat(25_000),
      html: null,
    }));
    expect(parsed.proposedState.messageText!.length).toBeLessThanOrEqual(20_000 + 1);
    expect(parsed.proposedState.messageText!.endsWith("…")).toBe(true);
  });

  it("omits messageText entirely (rather than an empty string) when there's nothing readable", () => {
    const parsed = parseTuroEmail(manifest({ subject: "", text: "", html: null }));
    expect(parsed.proposedState.messageText).toBeUndefined();
  });
});

describe("parseTuroEmail — earnings total", () => {
  it("extracts PaymentSentOwner's actual payment amount and keeps it unlinkable to a reservation", () => {
    const parsed = parseTuroEmail(manifest({
      subject: "Your earnings are on the way!",
      text: "Cha-ching! We've sent your earnings payment of $99.88. Note: we deposit earnings weekly.",
      html: null,
    }));
    expect(parsed.eventType).toBe("noise");
    expect(parsed.reservationId).toBeNull();
    expect(parsed.proposedState.earningsTotal).toBe("99.88");
    // Noise stays exempt from the reservation-id-missing blocker by design.
    expect(parsed.blockerCodes).not.toContain("reservation_id_missing");
  });

  it("never infers a reservationId for the unlinkable earnings template even if a stray number looks like one", () => {
    const parsed = parseTuroEmail(manifest({
      subject: "Your earnings are on the way!",
      text: "Cha-ching! We've sent your earnings payment of $99.88. Invoice 12345678.",
      html: null,
    }));
    expect(parsed.reservationId).toBeNull();
  });
});

describe("parseTuroEmail — vehicle-location-derived timezone strategy", () => {
  const bookingWithTrip = (vehicleTimeZone?: string | null) => parseTuroEmail(
    manifest({
      subject: "Riley's trip with your Tesla Model 3 is booked!",
      text: "Reservation ID #71234567.",
      html: tripDetailHtml({
        guestName: "Riley",
        avatarToken: "avatar-tok-riley",
        driverId: "40010001",
        tripStartDate: "7/4/26",
        tripStartTime: "2:00 pm",
        tripEndDate: "7/6/26",
        tripEndTime: "10:00 am",
      }),
    }),
    new Set(),
    { vehicleTimeZone },
  );

  it("golden case: vehicle-with-no-location produces trip_timezone_unresolved, never a UTC/server-local guess", () => {
    const parsed = bookingWithTrip(undefined);
    expect(parsed.blockerCodes).toContain("trip_timezone_unresolved");
    expect(parsed.proposedState.tripStartLocalText).toBe("7/4/26 2:00 pm");
    expect(parsed.proposedState.tripStartAt).toBeUndefined();
    expect(parsed.proposedState.tripEndAt).toBeUndefined();
    expect(parsed.proposedState.tripTimeZone).toBeUndefined();
  });

  it("golden case: a null vehicleTimeZone (explicitly unresolved) behaves the same as omitting it", () => {
    const parsed = bookingWithTrip(null);
    expect(parsed.blockerCodes).toContain("trip_timezone_unresolved");
    expect(parsed.proposedState.tripStartAt).toBeUndefined();
  });

  it("golden case: zone with DST in effect at the reservation date resolves to the correct UTC instant", () => {
    // America/Chicago, 2026-07-04 — CDT (UTC-5) is in effect.
    const parsed = bookingWithTrip("America/Chicago");
    expect(parsed.blockerCodes).not.toContain("trip_timezone_unresolved");
    expect(parsed.blockerCodes).not.toContain("trip_timezone_ambiguous_dst");
    expect(parsed.proposedState.tripStartAt).toBe("2026-07-04T19:00:00.000Z");
    expect(parsed.proposedState.tripEndAt).toBe("2026-07-06T15:00:00.000Z");
    expect(parsed.proposedState.tripTimeZone).toBe("America/Chicago");
  });

  it("golden case: zone without DST in effect at the reservation date (Arizona never observes DST) resolves correctly", () => {
    const parsed = parseTuroEmail(
      manifest({
        subject: "Riley's trip with your Tesla Model 3 is booked!",
        text: "Reservation ID #71234567.",
        html: tripDetailHtml({
          guestName: "Riley", avatarToken: "avatar-tok-riley", driverId: "40010001",
          tripStartDate: "1/15/26", tripStartTime: "2:00 pm",
          tripEndDate: "1/17/26", tripEndTime: "10:00 am",
        }),
      }),
      new Set(),
      { vehicleTimeZone: "America/Phoenix" },
    );
    expect(parsed.blockerCodes).not.toContain("trip_timezone_unresolved");
    expect(parsed.blockerCodes).not.toContain("trip_timezone_ambiguous_dst");
    // Phoenix is fixed at UTC-7 year-round.
    expect(parsed.proposedState.tripStartAt).toBe("2026-01-15T21:00:00.000Z");
    expect(parsed.proposedState.tripTimeZone).toBe("America/Phoenix");
  });

  it("golden case: a spring-forward DST gap is treated as a blocker, never a guessed side", () => {
    // America/Chicago, 2026-03-08 02:30 local never occurred: clocks jumped 2:00->3:00.
    const parsed = parseTuroEmail(
      manifest({
        subject: "Riley's trip with your Tesla Model 3 is booked!",
        text: "Reservation ID #71234567.",
        html: tripDetailHtml({
          guestName: "Riley", avatarToken: "avatar-tok-riley", driverId: "40010001",
          tripStartDate: "3/8/26", tripStartTime: "2:30 am",
          tripEndDate: "3/9/26", tripEndTime: "10:00 am",
        }),
      }),
      new Set(),
      { vehicleTimeZone: "America/Chicago" },
    );
    expect(parsed.blockerCodes).toContain("trip_timezone_ambiguous_dst");
    expect(parsed.blockerCodes).not.toContain("trip_timezone_unresolved");
    expect(parsed.proposedState.tripStartAt).toBeUndefined();
    expect(parsed.proposedState.tripEndAt).toBeUndefined();
  });

  it("golden case: a fall-back DST fold is treated as a blocker, never a guessed side", () => {
    // America/Chicago, 2026-11-01 01:30 local occurred twice as clocks fell back.
    const parsed = parseTuroEmail(
      manifest({
        subject: "Riley's trip with your Tesla Model 3 is booked!",
        text: "Reservation ID #71234567.",
        html: tripDetailHtml({
          guestName: "Riley", avatarToken: "avatar-tok-riley", driverId: "40010001",
          tripStartDate: "11/1/26", tripStartTime: "1:30 am",
          tripEndDate: "11/3/26", tripEndTime: "10:00 am",
        }),
      }),
      new Set(),
      { vehicleTimeZone: "America/Chicago" },
    );
    expect(parsed.blockerCodes).toContain("trip_timezone_ambiguous_dst");
    expect(parsed.proposedState.tripStartAt).toBeUndefined();
  });

  it("never adds a timezone blocker for templates that carry no trip window at all", () => {
    const parsed = parseTuroEmail(manifest({
      subject: "Your earnings are on the way!",
      text: "We've sent your earnings payment of $99.88.",
      html: null,
    }));
    expect(parsed.blockerCodes).not.toContain("trip_timezone_unresolved");
    expect(parsed.blockerCodes).not.toContain("trip_timezone_ambiguous_dst");
  });
});

describe("parseTuroEmail — sender_auth_unverified: DMARC-aligned From-domain binding", () => {
  it("blocks a DMARC-pass message whose visible From domain is not turo.com (domain binding works)", () => {
    const parsed = parseTuroEmail(manifest({
      from: "Turo <noreply@mail.turo-support.example>",
      receiverAuth: { dkim: "pass", dmarc: "pass", spf: "pass", arc: "unknown" },
    }));
    expect(parsed.blockerCodes).toContain("sender_auth_unverified");
  });

  it("blocks a lookalike domain that merely contains turo.com as a substring, not a real subdomain", () => {
    const parsed = parseTuroEmail(manifest({
      from: "notturo.com.evil.example <noreply@notturo.com.evil.example>",
      receiverAuth: { dkim: "pass", dmarc: "pass", spf: "pass", arc: "unknown" },
    }));
    expect(parsed.blockerCodes).toContain("sender_auth_unverified");
  });

  it("blocks a turo.com From address when DMARC did not pass, even if DKIM alone passed", () => {
    const dmarcUnknown = parseTuroEmail(manifest({
      from: "Turo <noreply@mail.turo.com>",
      receiverAuth: { dkim: "pass", dmarc: "unknown", spf: "pass", arc: "unknown" },
    }));
    expect(dmarcUnknown.blockerCodes).toContain("sender_auth_unverified");

    const dmarcFail = parseTuroEmail(manifest({
      from: "Turo <noreply@mail.turo.com>",
      receiverAuth: { dkim: "pass", dmarc: "fail", spf: "pass", arc: "unknown" },
    }));
    expect(dmarcFail.blockerCodes).toContain("sender_auth_unverified");
  });

  it("clears the blocker for a bare (non display-name) turo.com address with DMARC pass", () => {
    const parsed = parseTuroEmail(manifest({
      from: "noreply@mail.turo.com",
      receiverAuth: { dkim: "pass", dmarc: "pass", spf: "pass", arc: "unknown" },
    }));
    expect(parsed.blockerCodes).not.toContain("sender_auth_unverified");
  });

  it("clears the blocker case-insensitively for a turo.com subdomain", () => {
    const parsed = parseTuroEmail(manifest({
      from: "Turo <NoReply@Notify.TURO.COM>",
      receiverAuth: { dkim: "pass", dmarc: "pass", spf: "pass", arc: "unknown" },
    }));
    expect(parsed.blockerCodes).not.toContain("sender_auth_unverified");
  });

  // Regression: every legitimate Turo template shape (From noreply@mail.turo.com,
  // DMARC pass, the `manifest()` helper's default receiverAuth) must never trip
  // the blocker, across all 6 event types the classifier produces.
  const legitimateSubjectsByType: Array<[string, string]> = [
    ["booking", "Riley's trip with your Tesla Model 3 is booked!"],
    ["change", "You've confirmed Riley's change request with your Tesla Model 3"],
    ["cancellation", "Taylor has cancelled their trip with your Tesla Model 3"],
    ["guest_message", "Jordan has sent you a message about your Tesla Model 3"],
    ["noise", "Your earnings are on the way!"],
    ["unknown", "A completely different Turo subject line"],
  ];

  it.each(legitimateSubjectsByType)("clears the blocker for a legitimate %s template", (expectedType, subject) => {
    const parsed = parseTuroEmail(manifest({ subject, text: subject.includes("earnings") ? "We've sent your earnings payment of $99.88." : "Reservation ID #71234567." }));
    expect(parsed.eventType).toBe(expectedType);
    expect(parsed.blockerCodes).not.toContain("sender_auth_unverified");
  });
});

describe("resolveLocalInstant (direct unit coverage of the DST algorithm)", () => {
  it("resolves an unambiguous instant", () => {
    const result = resolveLocalInstant({ year: 2026, month: 7, day: 4, hour: 14, minute: 0 }, "America/Chicago");
    expect(result).toEqual({ kind: "resolved", utcMs: Date.parse("2026-07-04T19:00:00.000Z") });
  });

  it("reports a gap for a spring-forward local time that never existed", () => {
    expect(resolveLocalInstant({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/Chicago")).toEqual({ kind: "gap" });
  });

  it("reports a fold for a fall-back local time that occurred twice", () => {
    expect(resolveLocalInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/Chicago")).toEqual({ kind: "fold" });
  });

  it("is stable for a zone with no DST transitions at all", () => {
    const result = resolveLocalInstant({ year: 2026, month: 7, day: 4, hour: 14, minute: 0 }, "America/Phoenix");
    expect(result).toEqual({ kind: "resolved", utcMs: Date.parse("2026-07-04T21:00:00.000Z") });
  });
});
