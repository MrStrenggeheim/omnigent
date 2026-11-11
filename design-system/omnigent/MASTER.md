# Omnigent workspace design system

A compact developer workspace built from Omnigent's existing components.
The approved workspace specification governs behavior; later owner corrections govern appearance.

## Basis

- Audited upstream `v0.20.0`: semantic theme tokens, Radix controls, compact navigation, shared tooltips and typography.
- Approved specification: docked views, explicit ownership, violet defaults, 48px headers, density and mobile accessibility.
- UI/UX Pro Max: semantic surfaces, state clarity, stable geometry, restrained feedback, shared icons and visible keyboard focus.
- Generated landing-page patterns, replacement fonts and suggested palettes do not fit this application and are excluded.

## Tokens and components

| Role                     | Canonical implementation                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| View headers and content | `--workspace-content`; white in light mode, neutral `#18181b` in dark mode                  |
| Sidebar and tab bars     | `--workspace-chrome`; pale selected-accent wash                                             |
| Application bar          | `--workspace-appbar`; same medium-light fill as the focused tab                             |
| Overlay                  | Existing popover/dialog tokens; opaque readable foreground                                  |
| Normal text              | Existing system/Geist typography and `--foreground`                                         |
| Secondary text           | `--muted-foreground`; never use disabled opacity for ordinary text                          |
| Selected tab             | Unfocused selection uses the content surface; focused selection uses `--workspace-selected` |
| Pane focus               | Focused-tab fill only; no perimeter or top accent line                                      |
| Keyboard focus           | Existing `--ring` treatment; preserve visible focus                                         |
| Header geometry          | 36px per workspace header row; 32px in Compact appearance                                                                |
| Header action            | `HeaderActionButton`, 24px glyph surface; header target is row height minus 4px                                |
| Sidebar toggle           | `SidebarToggle` with `SidebarPanelIcon`, filled segment when open                           |
| Search modes             | Existing `SegmentedControl`, consistent scope/category sizing                               |
| Switches                 | Shared `Switch`; off, on and disabled must remain distinguishable                           |
| Tooltip                  | Canonical centered tooltip; no conversation metadata hover cards                            |
| Density                  | Existing shared list tokens; vertically centered disclosure and label                       |
| Motion                   | Immediate tab and disclosure state changes; no hover animation                              |
| Scrolling                | Existing slim scrollbar treatment; fixed headers never scroll vertically                    |

## Approved theme and interactive states

The owner approved these surface and control roles on 2026-11-11.
All chrome mixes use the existing selected accent, including saved preset and custom preferences.
The default violet primary is deep purple `#68518b` with white text in both modes.
Other selected palettes retain their primary and readable foreground preferences.

| State or role                   | Shared treatment                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Chrome at rest                  | `--workspace-chrome`: 10% accent mixed into content                                 |
| Focused tab and application bar | `--workspace-selected` / `--workspace-appbar`: 28% accent mixed into content        |
| Hover on content                | `--workspace-hover-on-content`: 8% accent mixed into content                        |
| Hover on chrome                 | `--workspace-hover-on-chrome`: 6% foreground mixed into chrome                      |
| Focused tab hover               | Retain selected fill; close control may show its own hover surface                  |
| Primary action, including Send  | Shared primary fill and foreground; hover adds 5% black, press adds 10% black       |
| Secondary action                | White with dark text and a neutral border; neutral dark counterpart with light text |
| Secondary hover / press / open  | Add 6% / 10% / 10% foreground to the secondary surface                              |
| Keyboard focus                  | Keep the shared visible focus ring independently of hover or selection              |
| Disabled action                 | Shared disabled treatment; Send uses muted fill/text, with no pointer interaction   |
| Busy Send and interrupt         | Preserve busy/disabled semantics and the destructive interrupt variant              |

Primary hover and press keep text opaque rather than fading the entire control.
Use the matching surface-hover token for icon actions and rows.
Keep focused selection visible while hovering a tab; apply state feedback without tab or disclosure animation.

`index.css` publishes the workspace tokens independently of the workbench styles.
Import `workbenchSurfaces.css` after the existing shell and dock CSS to give docked roots, headers and content opaque shared surfaces.
Docked content is excluded from the global dark-card glass decoration; code, diff, selection and overlay surfaces retain their specialized roles.

## Composition

Each tab contains its label and its own close control.
Desktop tab/container headers and view headers remain separate rows, including single-tab panes.
Mobile reuses horizontally scrolling tabs, including views from other panes; only the selected view is shown.
Narrow composer workspace controls collapse to an icon and chevron while retaining their accessible full location.
The shell owns the device bottom safe area once; the mobile composer adds only an 8px content gutter.
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

Appearance density controls header height and sidebar entry padding through the shared density tokens.
