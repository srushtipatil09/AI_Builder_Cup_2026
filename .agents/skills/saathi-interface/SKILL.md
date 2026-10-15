---
name: saathi-interface
description: Sets the visual and interaction bar for Saathi screens. Use when building, restyling, reviewing, or fixing any web UI in this repo, including the landing page, companion chat, care desk, forms, empty states, motion, typography, or layout.
---

# Saathi interface

Saathi is a voice-first Hindi companion for an older adult, plus a care desk for the child who lives away. The interface is finished only when it is calm enough for that parent, specific enough that it could not be another product, and strict enough to pass an accessibility review.

Read `docs/SPEC.md` before changing a screen. These skills are already installed. Read the ones that match the task, in this order, and let this file win when they disagree.

| When | Read |
| --- | --- |
| Choosing type, color, layout, or a new screen | `ui-ux-pro-max`, then `frontend-design` |
| Building or reshaping the look | `impeccable` (craft floor and the surface mode below) |
| Writing React | `vercel-react-best-practices`, and `vercel-composition-patterns` if a component is growing boolean props |
| Before finishing any UI change | `accessibility` and `web-design-guidelines` |

## Product surfaces

| Surface | Mode | Job |
| --- | --- | --- |
| Landing | Desktop. Persuade quietly. Header and footer. | Name, one sentence, three short lines, Kamla Sharma demo. No account form. |
| Log in / Create account | Operate. | Separate pages. A phone or installed app opens Log in when there is no session, and the chat when there is. |
| Companion chat | Phone default. Operate. | Talk, Stop, Pause, Contact family. The parent should not hunt. |
| Care desk | 1024px and wider. Operate. | Scan what changed. Same sections stack on a phone behind **Care desk**. |

The current CSS is a warm paper page with a serif title. That combination is a common generated default. Keep the reading comfort, and make the screen specific to a household companion: spoken first, large controls, a desk that reports change. Do not restyle it into brutalism, acid accents, a marketing hero with a giant statistic, or a component-library demo.

## Quality floor

- Companion body text is at least 18px. Line length stays under about 80 characters. Touch targets are at least 44px, with space between them.
- Text contrast meets WCAG 2.2 AA. Primary companion text aims at AAA. Meaning never depends on color alone.
- Every control has a visible name, a visible focus state, and a keyboard path. Honor `prefers-reduced-motion`.
- Motion answers an action. One orchestrated moment is enough. No scattered fade-ups.
- Forms use visible labels. Errors sit on the field.
- The care desk has no health score and never says the parent is safe.
- Caregiver-facing copy does not diagnose, advise a dose, or order counselling.
- Stack is React 19, Vite, and the CSS in `web/src/styles.css`. Do not add Tailwind, shadcn, or an animation library unless the user asks.
- When `ui-ux-pro-max` needs a stack, use `react`. Run its search from the repo root: `py -3 .agents/skills/ui-ux-pro-max/scripts/search.py`. Do not `--persist` a design-system file unless the user asks.

## How to work

1. Name the surface and its mode before editing.
2. Search `ui-ux-pro-max` for this audience: older adult, voice companion, family care desk, low motion, high readability.
3. Implement in the existing CSS and components. Preserve behavior in `docs/SPEC.md`.
4. Check the result against `accessibility` and `web-design-guidelines`.
5. Verify in the browser on a phone-width companion and a desk at 1024px or wider. Exercise the control, do not only look at it.

`impeccable` may ask to launch a downloaded binary and to replace the visual world. Skip the binary. Do not replace the visual world unless the user asked for a redesign. Use its craft floor, critique, and the surface mode above.
