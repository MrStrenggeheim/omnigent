# Omnigent workspace design system

A compact developer workspace built from Omnigent's existing components.
The approved workspace specification governs behavior; later owner corrections govern appearance.

## Basis

- Audited upstream `v0.20.0`: semantic theme tokens, Radix controls, compact navigation, shared tooltips and typography.
- Approved specification: docked views, explicit ownership, violet defaults, 48px headers, density and mobile accessibility.
- UI/UX Pro Max: semantic surfaces, state clarity, stable geometry, restrained feedback, shared icons and visible keyboard focus.
- Generated landing-page patterns, replacement fonts and suggested palettes do not fit this application and are excluded.

## Tokens and components

| Role | Canonical implementation |
| --- | --- |
| View surface | `--background`; same value across docked content |
| Navigation surface | `--sidebar`; intentional hierarchy from content |
| Overlay | Existing popover/dialog tokens; opaque readable foreground |
| Normal text | Existing system/Geist typography and `--foreground` |
| Secondary text | `--muted-foreground`; never use disabled opacity for ordinary text |
| Selected tab | Shared muted surface; focused tab gets restrained accent wash |
| Pane focus | Focused-tab fill only; no perimeter or top accent line |
| Keyboard focus | Existing `--ring` treatment; preserve visible focus |
| Header geometry | Existing 48px per header row |
| Header action | `HeaderActionButton`, 24px glyph surface, 44px mobile target |
| Sidebar toggle | `SidebarToggle` with `SidebarPanelIcon`, filled segment when open |
| Search modes | Existing `SegmentedControl`, consistent scope/category sizing |
| Switches | Shared `Switch`; off, on and disabled must remain distinguishable |
| Tooltip | Canonical centered tooltip; no conversation metadata hover cards |
| Density | Existing shared list tokens; vertically centered disclosure and label |
| Motion | 150ms color feedback for tabs; no size/position animation; reduced-motion aware |
| Scrolling | Existing slim scrollbar treatment; fixed headers never scroll vertically |

## Composition

Each tab contains its label and its own close control.
Keep tab/container headers and view headers as separate rows for every pane, including single-tab panes.
Do not merge or split their overflow controls; the owner explicitly deferred that redesign.
Keep conversation breadcrumbs in the view header.
Center empty guidance within the entire available content area.

Navigation keeps rows, expansion, selection and scroll during background refresh.
Load authorized hierarchy metadata ahead of expansion; leaves have neither chevrons nor empty-child rows.
Actions appear on row hover, keyboard focus or an open action menu, with a reachable touch alternative.
A working conversation keeps its existing spinner independently of hover controls.

The composer activity dock is disabled until the owner requests another design.
Activity data and the dedicated Activity view remain available.

## Reuse rule

Reuse a complete existing component and interaction before assembling primitives.
Extend the owning shared component when a missing state is broadly useful.
Do not add runtime dependencies, replacement icon sets, fonts or page-specific palettes.
