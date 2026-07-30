# UI Design Patterns & Repertoire

A living document of UI patterns, effects, and design decisions for this project.

## Table of Contents
- [Liquid Glass](#liquid-glass)
- [Button States](#button-states)
- [Colors & Opacity](#colors--opacity)
- [Typography](#typography)
- [Animations](#animations)

---

## Liquid Glass

Based on Apple's iOS 26 Liquid Glass (WWDC 2025).

### Principles
- Simple translucent material that lets content peek through
- Adapts to background luminosity (darker on dark, lighter on light)
- Focus on legibility over heavy effects
- Use sparingly - only for navigation/controls floating above content

### CSS Implementation

```css
/* Base Liquid Glass */
.liquid-glass {
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(24px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 22px;
}
```

```tsx
/* Tailwind */
className="bg-white/[0.12] backdrop-blur-2xl backdrop-saturate-150 border border-white/20 rounded-[22px]"
```

### Variants
- **Regular**: Blurs and adjusts luminosity for legibility
- **Clear**: Highly translucent for media backgrounds (add 35% dark dimming layer if background is bright)

### Component Classes (CSS)

| Class | Use Case | Background | Blur | Border |
|-------|----------|------------|------|--------|
| `.glass-card` | Primary containers (cards, panels) | `white/6%` | 20px | `white/10%` |
| `.glass-surface` | Subtle backgrounds (sidebars) | `white/3%` | 12px | `white/6%` |
| `.glass-elevated` | Floating elements (sheets, dropdowns) | `white/10%` | 24px | `white/15%` |
| `.glass-header` | Navigation bars | `white/2%` | 20px | `white/8%` bottom |

### CSS Implementation

```css
/* Glass Card - Primary container */
.glass-card {
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(20px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  /* Top edge specular highlight */
  background-image: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0.08) 0%,
    transparent 1px
  );
}

/* Glass Surface - Subtle backgrounds */
.glass-surface {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

/* Glass Elevated - Floating elements */
.glass-elevated {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

/* Glass Header - Navigation bars */
.glass-header {
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(20px) saturate(150%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
```

### Used In
- `client/src/pages/home.tsx` - MobileFloatingCTA component
- `client/src/pages/dashboard.tsx` - Header, sidebar, workout cards, sheets

### Sources
- [Apple HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Apple HIG: Tab Bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)

---

## Button States

Based on Apple visionOS button states.

### States & Styles

| State | Background | Border | Notes |
|-------|------------|--------|-------|
| Idle | `white/12%` | `white/20%` | Default resting state |
| Hover | `white/18%` | `white/30%` | Subtle brightening |
| Active/Press | `white/18%` + `scale-[0.98]` | - | Slight compression |
| Selected | `white/100%` | - | Inverted (white bg, dark text) |
| Disabled | `white/6%` | `white/10%` | Muted, reduced opacity |

### Tailwind Classes

```tsx
// Standard Liquid Glass Button
className="
  bg-white/[0.12] border border-white/20
  hover:bg-white/[0.18] hover:border-white/30
  active:scale-[0.98] active:bg-white/[0.18]
  transition-all duration-200
"
```

### Top Highlight (Specular Reflection)

```tsx
// Brightens on hover for extra polish
<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent group-hover:via-white/50 transition-all duration-200" />
```

### Used In
- `client/src/pages/home.tsx` - MobileFloatingCTA button

### Sources
- [Apple HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)

---

## Colors & Opacity

### Glass Opacity Scale

| Use Case | Opacity | Example |
|----------|---------|---------|
| Very subtle | 0.06-0.08 | Disabled states |
| Standard glass | 0.10-0.15 | Default Liquid Glass |
| Hover/Active | 0.15-0.20 | Interactive states |
| Emphasized | 0.20-0.30 | Selected/focused |

### Border Opacity Scale

| State | Opacity |
|-------|---------|
| Default | 0.16-0.20 |
| Hover | 0.25-0.30 |
| Focus | 0.30-0.40 |

### Shadow Scale

| State | Shadow |
|-------|--------|
| Default | `0_2px_16px_rgba(0,0,0,0.15)` |
| Hover | `0_4px_20px_rgba(0,0,0,0.2)` |

---

## Typography

*(To be documented as patterns emerge)*

---

## Animations

### Timing
- **Fast interactions**: 150-200ms (hover, press)
- **State changes**: 200-300ms (show/hide, transitions)
- **Emphasis**: 300-500ms (entrance animations)

### Easing
- **Default**: `ease-out` or Tailwind's default
- **Spring-like**: `cubic-bezier(0.34, 1.56, 0.64, 1)` for playful bounce

### Common Patterns

```tsx
// Hover arrow nudge
<ArrowRight className="group-hover:translate-x-0.5 transition-transform duration-200" />

// Press compression
active:scale-[0.98]

// Fade in on scroll (Framer Motion)
initial={{ opacity: 0, y: 20 }}
animate={{ opacity: 1, y: 0 }}
transition={{ duration: 0.6 }}
```

### Used In
- `client/src/pages/home.tsx` - Various scroll-based animations

---

## Adding to This Document

When implementing new UI patterns:
1. Document the visual effect and its purpose
2. Include the CSS/Tailwind implementation
3. Note any Apple HIG or other design system references
4. Add "Used In" section with file paths
5. Add examples of where it's used in the codebase
