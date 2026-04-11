# Design System Document: The Sentinel Ethos

## 1. Overview & Creative North Star: "The Guided Vanguard"
This design system moves away from the cluttered, "utility-first" look of traditional GPS apps and toward a high-end, editorial experience. We are building **The Guided Vanguard**: a system that feels like a premium Swiss watch—precise, authoritative, and unapologetically legible.

To move beyond the "standard app" feel, we employ **Kinetic Asymmetry**. By utilizing generous whitespace and off-center focal points, we guide the rider's eye through complex data without visual fatigue. The layout isn't just a grid; it's a series of intentional, stacked surfaces that prioritize safety through extreme typographic clarity and tonal depth.

---

## 2. Colors: Tonal Precision
The palette is rooted in a "Technical Greyscale" foundation, punctuated by high-visibility safety accents.

### The "No-Line" Rule
**Borders are a design failure.** To section off content, you are strictly prohibited from using 1px solid lines. Instead, boundaries must be defined by shifts in the `surface-container` tiers. A card (Surface Container Lowest) sits on a background (Surface) to create a "ghost" edge that feels organic and modern.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of semi-translucent materials:
- **Base Layer:** `surface` (#f8f9fa) for the main application background.
- **Sectioning:** Use `surface-container-low` (#f3f4f5) for large grouping areas.
- **Interactive Elements:** Use `surface-container-lowest` (#ffffff) for cards and inputs to provide a "lifted" feel.
- **Nesting:** When placing a list inside a card, the list item should use `surface-container-high` (#e7e8e9) on hover/active states to create depth without adding weight.

### Color Tokens

```
primary:                  #506600
primary-container:        #d1ff41
primary-fixed:            #c3f400
primary-fixed-dim:        #abd600
on-primary:               #ffffff
on-primary-fixed:         #161e00
on-primary-fixed-variant: #3c4d00
on-primary-container:     #5c7400
inverse-primary:          #abd600

secondary:                #5d5e61
secondary-container:      #e2e2e5
on-secondary:             #ffffff
on-secondary-container:   #636467

tertiary:                 #7e5700
tertiary-container:       #ffebd1
tertiary-fixed:           #ffdeac
tertiary-fixed-dim:       #ffba38
on-tertiary:              #ffffff
on-tertiary-container:    #8f6300

error:                    #ba1a1a
error-container:          #ffdad6
on-error:                 #ffffff
on-error-container:       #93000a

surface:                  #f8f9fa
surface-bright:           #f8f9fa
surface-dim:              #d9dadb
surface-variant:          #e1e3e4
surface-container-lowest: #ffffff
surface-container-low:    #f3f4f5
surface-container:        #edeeef
surface-container-high:   #e7e8e9
surface-container-highest:#e1e3e4
on-surface:               #191c1d
on-surface-variant:       #444932
background:               #f8f9fa
on-background:            #191c1d
outline:                  #757a60
outline-variant:          #c5c9ac
inverse-surface:          #2e3132
inverse-on-surface:       #f0f1f2

caution:                  #92570a
caution-container:        #ffe0b8
caution-fixed:            #ffb74d
caution-surface:          #fff8f0
on-caution:               #ffffff
on-caution-container:     #6b3d00
```

### The "Glass & Gradient" Rule
Floating navigation modules (like speedometers or turn-by-turn prompts) should use **Glassmorphism**. Apply `surface_variant` at 80% opacity with a `24px` backdrop blur. This allows the map's colors to bleed through, ensuring the UI feels integrated into the environment, not "pasted" over it.

### Signature Textures
Main Action Buttons (CTAs) should utilize a subtle linear gradient from `primary` (#506600) to `primary_container` (#d1ff41). This "high-vis" glow mimics professional cycling apparel and provides a tactile, "lit-from-within" quality.

---

## 3. Typography: The Editorial Engine
Legibility at 25mph is non-negotiable. We use a tri-font system to create a sophisticated, high-contrast hierarchy.

- **Display & Headlines (Space Grotesk):** A technical, wide-set sans-serif. Used for "hero" stats like Speed or Distance. Its geometric nature feels engineered and modern.
- **Titles & Body (Inter):** The workhorse. Inter provides maximum readability for navigation instructions and road names.
- **Labels (Lexend):** Used for micro-copy and data points. Its hyper-legible, open apertures ensure that even at `label-sm` (11px), safety alerts remain crystal clear.

**The Hierarchy Goal:** Use `display-lg` for primary metrics. By scaling from `display-lg` (3.5rem) directly down to `body-md` (0.875rem), we create a "High-Contrast Gap" that feels like a premium editorial magazine rather than a generic dashboard.

---

## 4. Elevation & Depth: Tonal Layering
We do not use shadows to simulate height; we use light.

- **The Layering Principle:** Depth is achieved by stacking. A `surface-container-lowest` card placed on a `surface-dim` background creates a natural elevation.
- **Ambient Shadows:** For floating action buttons (FABs), use a shadow color of `on-surface` at 6% opacity with a `32px` blur and `12px` Y-offset. It should feel like a soft glow of light, not a "drop shadow."
- **The Ghost Border Fallback:** If a container requires more definition (e.g., in high-glare sunlight conditions), use the `outline-variant` (#c5c9ac) at **15% opacity**. Never use 100% opacity for borders.
- **Glassmorphism & Depth:** Navigation overlays must use a `20px` blur. This creates a "frosted glass" effect that softens the map beneath, ensuring the text on the `on-surface` layer remains the primary focus.

---

## 5. Components: Refined Utility

### Buttons
- **Primary:** Gradient fill (`primary` → `primary_container`). `xl` roundedness (0.75rem). No border.
- **Secondary:** `surface-container-high` background with `on-secondary-container` text.
- **Tertiary:** Transparent background, `primary` text, no border. Used for low-priority actions like "View More."

### Navigation Cards
**No dividers.** Use `1.5rem` (24px) of vertical whitespace to separate turns. Each turn instruction should be housed in a `surface-container-lowest` card with a `0.75rem` (xl) corner radius.

### Safety Chips
- **High Alert:** Use `error` (#ba1a1a) background with `on_error` text.
- **Safe Route:** Use `primary_fixed` (#c3f400) with `on_primary_fixed` text.
- Shape: Use `full` (9999px) roundedness for chips to contrast against the `xl` roundedness of cards.

### Input Fields
Soft, `surface-container-low` fills. On focus, the background transitions to `surface-container-lowest` with a `2px` "Ghost Border" of `primary` at 40% opacity.

### The "Route-Pulse" Component (Custom)
For active navigation, the route line on the map should not be a flat color. It should be a `primary` stroke with a soft `primary_fixed_dim` outer glow to simulate a "path of safety" through the environment.

---

## 6. Do's and Don'ts

### Do:
- **Embrace Whitespace:** If a screen feels crowded, increase the padding. Safety requires a calm mind; a calm mind requires breathing room.
- **Use Tonal Shifts:** Define sections by changing the background color from `surface` to `surface-container-low`.
- **Prioritize Type:** Let `Space Grotesk` do the heavy lifting for brand personality.

### Don't:
- **Don't use Dividers:** Never use a line to separate content. Use space or background shifts.
- **Don't use Pure Black:** Use `on_background` (#191c1d) for text. Pure black (#000000) creates "ink bleed" visual vibration on high-brightness mobile screens.
- **Don't use Standard Shadows:** Avoid small, dark, high-opacity shadows. They make the UI look dated and "heavy."
