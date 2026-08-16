# EVhost Design System

## Direction

EVhost is **precision hospitality**: calm enough for a guest handoff, exact enough for fleet operations. Interfaces should answer what needs attention, what changed, and what the user can safely do next without decorative noise.

## Foundations

- Typography: Manrope, self-hosted by `next/font`, weights 400, 500, 600, and 700. Use sentence case. Page titles use tight tracking; operational body copy remains at least 16px when it must be read or edited.
- Color roles: `ink` and `ink-soft` for content, `muted` for secondary metadata, `line` for hairline structure, `surface` and white for hierarchy, `brand` for navigation and affirmative action, and `good|warn|danger` only for status meaning.
- Spacing: use a 4px base with an 8px content rhythm. Prefer 12, 16, 24, and 32px gaps; do not fill empty space with decoration.
- Geometry: controls use 6px radii, cards use 8px radii, and borders stay one pixel. Shadows are reserved for true overlays such as menus and dialogs.
- Layout: owner pages use the existing shell and page widths. Mobile is a deliberate one-handed layout, not a scaled desktop canvas.

## Hierarchy and Components

- `PageHeader` establishes page location and one primary action.
- `StatePanel` owns loading, empty, degraded, and blocking errors.
- `Button` hierarchy is primary, secondary, then ghost. A destructive action names its consequence.
- `Card` is used only when the card is a discrete object or interaction. Avoid decorative card grids, icon circles, gradients, colored side borders, and ornamental imagery.
- `Badge` is supplemental. Meaning must also be present in text and shape.
- Form controls keep visible labels, errors beside the affected field, and a minimum 44px target.
- Empty states state what is true, whether data changed, and the next useful action. Never invent sample customers, trips, or vehicles.

## Inbox and Integration Patterns

- `IntegrationSetupChecklist` shows one expanded step, preserves completed checks, and reopens the failed step with one recovery action.
- `InboxCandidateCard` is a compact event and decision record. Its collapsed order is status/source, consequence-led title, current-versus-proposed facts, age, then actions. At most one desktop card expands at once.
- `UrgentActionPanel` always states whether effective trip or access state has changed. A destructive countdown starts only after the owner alert is accepted.
- Mobile candidate detail uses native `<dialog>` as a near-full-height bottom sheet with a visible Close button, scrollable body, safe-area padding, and sticky actions.

## Responsive Behavior

- Desktop: left navigation, calm single-column Inbox timeline, inline detail expansion.
- Tablet: retain the single-column timeline and wrap filters/actions without changing order.
- Mobile: the five-tab owner bar remains visible; Inbox replaces Insights in the fifth slot. Candidate detail opens in a modal bottom sheet. Never require hover or swipe-only discovery.

## Accessibility and Motion

- Body contrast is at least 4.5:1; control boundaries and state indicators are at least 3:1.
- Keyboard order matches visual order. Dialogs trap and restore focus. Dynamic status uses live regions without announcing every countdown tick.
- Touch targets are at least 44px. Form text is at least 16px to avoid iOS zoom.
- Respect `prefers-reduced-motion`. Animation may clarify entry or hierarchy but cannot carry meaning.
- Use real headings, links, buttons, lists, and tables. Never make a whole card a button containing nested controls.

## Content Voice

Use direct utility language: current state, consequence, and next action. Prefer “No access changed” over “Action pending.” Avoid celebratory copy for operational work and avoid technical provider terms unless they help recovery.

## Prohibited Patterns

- Purple/blue decorative gradients, floating shapes, icon-in-circle feature grids, centered-everything layouts, uniform oversized radii, and generic dashboard mosaics.
- Placeholder-only labels, low-contrast metadata, inaccessible color-only statuses, disappearing success messages, and destructive actions without explicit consequences.
- Global visual rewrites in feature branches. Extend this document when a new reusable pattern is intentionally added.
