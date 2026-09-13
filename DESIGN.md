---
name: Nano Studio
description: A calibrated optical workbench for personal image generation.
colors:
  ink: "#f3f0e8"
  muted: "#a6a39b"
  quiet: "#8a8d87"
  ground: "#0d0e0f"
  panel: "#151719"
  panel-raised: "#1d2022"
  rule: "#303336"
  rule-strong: "#484b4e"
  signal: "#ff6b3d"
  signal-hover: "#ff7d55"
  danger: "#ff705f"
  success: "#74c991"
typography:
  display:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  label:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "11px"
    fontWeight: 690
  control:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "14px"
    fontWeight: 720
rounded:
  control: "12px"
  surface: "16px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "#140b08"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.signal-hover}"
    textColor: "#140b08"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "40px"
  field:
    backgroundColor: "#101214"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "40px"
  field-focus:
    backgroundColor: "#121416"
    textColor: "{colors.ink}"
  history-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "7px"
  history-item-active:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px"
  image-bay:
    backgroundColor: "#090a0b"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
---

# Design System: Nano Studio

## Overview

**Creative North Star: "The Optical Workbench"**

Nano Studio treats a generated image like a print under inspection on a calibrated light table. Near-black working surfaces, warm-white content, graphite control planes, fine rules, and compact labels create the restraint and exactness of a camera back without drifting into a sterile API console.

The system operates rather than performs: the prompt and image stay central, configuration remains dense but legible, and one warm signal color makes action and live state immediately visible. Optical calibration marks, contact-sheet history, and exposure language give the product its own world while the interface remains quiet around the work.

**Key Characteristics:**

- Near-black, tonally layered working surfaces
- One warm orange signal reserved for action, focus, and live exposure
- Compact Manrope controls with tabular measurements
- Fine one-pixel rules and calibrated optical details
- Responsive three-zone workspace that collapses without losing the generation path

## Colors

The palette is a warm-leaning darkroom: graphite neutrals carry almost the entire interface, while signal orange and operational state colors appear only when they communicate something.

### Primary

- **Exposure Signal** (`signal`): The generate action, focus outline, live status dot, caret, scan line, and active calibration marks.
- **Exposure Signal Hover** (`signal-hover`): The deliberate hover lift for primary actions.

### Secondary

- **Connected Green** (`success`): Confirmed API access and completed exposure state.
- **Fault Coral** (`danger`): Destructive affordances and generation errors.

### Neutral

- **Warm Inspection White** (`ink`): Primary copy and high-emphasis control content.
- **Instrument Gray** (`muted`): Secondary copy and resting controls.
- **Quiet Readout** (`quiet`): Tertiary metadata, placeholders, and dormant status.
- **Darkroom Ground** (`ground`): The application canvas.
- **Graphite Panel** (`panel`): Persistent control and history surfaces.
- **Raised Graphite** (`panel-raised`): Hovered, active, or selected control surfaces.
- **Calibration Rule** (`rule`): Structural one-pixel divisions.
- **Strong Calibration Rule** (`rule-strong`): Hovered borders, active selections, and optical marks.

### Named Rules

**The One Signal Rule.** Warm orange marks primary action, active generation, and visible focus; it never becomes a decorative wash.

## Typography

**Display Font:** Manrope Variable (with sans-serif fallback)  
**Body Font:** Manrope Variable (with sans-serif fallback)  
**Label Font:** Manrope Variable (with sans-serif fallback)

**Character:** A single variable grotesk keeps the workbench compact and technically calm. Hierarchy comes from optical size, weight, tracking, case, and spacing rather than a decorative font pairing.

### Hierarchy

- **Display** (700, 28px, 1.1): Empty-stage guidance, with tight tracking to keep the phrase visually concentrated.
- **Headline** (700, 18px): Control-panel section headings.
- **Body** (400, 14px): Default interface copy; supporting paragraphs open to a 1.55–1.6 line height.
- **Label** (690, 11px): Form labels and compact operational language.
- **Control** (720, 14px): Buttons and decisive actions.
- **Metadata** (9–10px, uppercase where structural): Version labels, stage readouts, prices, balances, dates, and counters.

### Named Rules

**The Stable Measure Rule.** Values and counters use tabular figures so measurements do not jump.

## Layout

The desktop workspace is a fixed-height instrument panel beneath a 64px top bar. It uses a 218px history rail, a flexible result stage with a 360px minimum, and a 340–410px control column. The image bay owns the largest area and remains the center of visual gravity.

At 1120px and below, history moves into a 94px horizontal filmstrip beneath the stage while the 370px controls stay at right. At 760px and below, the top bar becomes a 58px sticky strip and the flow stacks as controls, result, then history; the result keeps a 540px minimum height and advanced controls begin collapsed. Mobile side padding tightens to 14–16px without compressing control targets.

The working rhythm is compact and regular: 7–12px within controls, 14–22px between control groups, and 18px around the image bay. One-pixel boundaries align the three zones.

## Elevation & Depth

The system is flat by default. Depth comes from near-black tonal layers and one-pixel structural rules; shadows appear only when an element floats above the workbench or when a live state needs a restrained glow. The API-key drawer uses a broad low shadow, download actions use a compact lift, and active exposure marks use warm signal glows.

### Shadow Vocabulary

- **Drawer Float** (`0 18px 36px rgba(0,0,0,.28)`): Separates the temporary API-key drawer from the workspace.
- **Download Lift** (`0 5px 16px rgba(0,0,0,.32)`): Keeps a download action legible over generated imagery.
- **Live Signal** (`0 3px 12px rgba(255,107,61,.45)`): Marks the active exposure state.
- **Scan Glow** (`0 4px 18px rgba(255,107,61,.35)`): Softens the moving scan line without turning it into spectacle.

### Named Rules

**The Flat-by-Default Rule.** Depth comes from tonal separation and calibrated rules; shadows are reserved for floating or live-state feedback.

## Shapes

Controls use gently curved 12px corners and the image bay uses a broader 16px surface radius. Icon buttons and image actions tighten to 10px, history thumbnails use 8px, and circular geometry is reserved for status dots, the lens guide, slider thumbs, and other optical indicators. Full pills belong only to compact status controls such as API-key connection state.

Fine borders stay at one pixel. Calibration corners remain square line work inside the softened image bay, preserving the tension between optical precision and approachable controls.

### Named Rules

**The Controlled Radius Rule.** Use gently curved geometry to soften the tool without turning every element into a pill.

## Components

Components feel tactile and exact: compact at rest, visibly responsive on hover and focus, and restrained in motion.

### Buttons

- **Shape:** Gently curved control corners (`control` radius) with a 40px minimum height; the main generate action rises to 46px and fills its column.
- **Primary:** Exposure Signal with dark warm text, 15px horizontal padding, 720 weight, and an icon where the action benefits from recognition.
- **Hover / Focus:** Hover shifts to Exposure Signal Hover; active presses translate down by 1px; keyboard focus receives a 2px signal outline with 3px offset.
- **Quiet:** Instrument Gray text on a transparent surface, becoming Warm Inspection White over Raised Graphite on hover.

### Chips

- **Style:** The API-key status chip is a 38px outlined pill with a 12px label and compact icon.
- **State:** Resting state uses Instrument Gray and a Calibration Rule; connected state turns green and mixes that state color into the border.

### Cards / Containers

- **Corner Style:** The image bay uses the 16px surface radius; history items use the 12px control radius.
- **Background:** Graphite Panel supports controls and history, while the image bay deepens to an almost-black inspection field.
- **Shadow Strategy:** Persistent containers stay flat; see Elevation & Depth for temporary overlays and over-image actions.
- **Border:** One-pixel Calibration Rules divide zones; active history items use the stronger rule.
- **Internal Padding:** History items use 7px; control panels use 22px desktop and 16–18px mobile.

### Inputs / Fields

- **Style:** Near-black fill, one-pixel Calibration Rule, Warm Inspection White content, and 12px corners. Text inputs and selects are 40px high; the main prompt begins at 128px.
- **Focus:** The border turns to Exposure Signal and the field background lifts slightly; the caret uses the same signal color.
- **Error / Disabled:** Disabled controls reduce opacity to .45 and use a not-allowed cursor. Error messaging uses a coral-tinted border, surface, icon, and text.

### Navigation

The 64px top bar is a one-line instrument header: aperture mark, product name, compact uppercase version, a quiet new-exposure action, and the API-key status chip. On mobile it becomes sticky at 58px; secondary version and new-exposure labels disappear before core access state does.

### Exposure Stage

The signature image bay frames generated work with four 20px calibration corners. Empty state uses a concentric lens guide; active generation brightens the calibration marks and moves a one-pixel signal scan line from 8% to 92% over 2.2 seconds. Reduced-motion mode fixes the line at center and suppresses animation.

### History Strip

History entries pair a 48px square thumbnail with a truncated 11px prompt and 10px date. Desktop stacks them in the left rail; tablet and mobile turn them into 180px horizontal contact-sheet cards without changing their active treatment.

## Do's and Don'ts

### Do:

- **Do** keep the image bay visually dominant and the prompt-to-generate path continuously legible.
- **Do** use Exposure Signal only for primary action, keyboard focus, and active exposure feedback.
- **Do** preserve tabular figures for counts, cost, balance, seed, guidance, and inference readouts.
- **Do** pair responsive reflow with preserved target sizes and a clear mobile order: controls, result, history.
- **Do** stop the moving scan treatment under reduced-motion preferences and retain a static live-state cue.

### Don't:

- **Don't** introduce purple AI gradients, decorative glows, or broad accent-colored surfaces.
- **Don't** turn ordinary containers into floating cards; rely on tonal planes and one-pixel rules.
- **Don't** use pills as a default shape; reserve them for compact status or segmented state.
- **Don't** replace compact operational labels with monospace styling or ornamental typography.
- **Don't** let history, advanced controls, or metadata compete with the current image.
