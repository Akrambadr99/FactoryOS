# FactoryOS premium UI/UX audit and redesign

## Audit findings

The prior interface had capable domain workflows but used the same visual CSS as the other nine products. Navigation was a single dense strip, hierarchy competed with repeated bordered cards, progressive disclosure was inconsistent, and domain identity depended mostly on words.

## Design direction

- Identity: disciplined production; accent #8a5a08, calm canvas #f6f5f1, compact information density, and 5px base geometry.
- Shell: branded product header, concise operational context, scrollable secondary navigation, skip link, stable main landmark, and responsive collapse.
- Typography: system-native stack, 48px responsive title ceiling, restrained weights, tabular operational numerals, and lower-emphasis metadata.
- Surfaces: separators and grouped metrics replace excessive independent cards; shadows are reserved for floating or hover elevation.
- Progressive disclosure: audit/history and advanced evidence are collapsed behind semantic details/summary controls.
- Interaction: 42px targets, primary/quiet/danger hierarchy, pressed/focus/busy states, non-color status cues, recoverable feedback, and reduced-motion behavior.
- Data: sticky table headers, stable row treatment, compact status badges, calm hover/selection, and narrow-screen horizontal regions rather than crushed columns.
- Major domain screens: Production recovery and lot genealogy.

## Reusable primitives

ProductButton, Field, StatusBadge, FeedbackState, and Disclosure are generic; domain rules remain within each product feature.

## Responsive and accessibility verification

Desktop, tablet, and mobile CSS breakpoints preserve navigation and workflow comprehension. Semantic labels, main landmark, skip navigation, visible focus, screen-reader status/alert roles, non-color state text, keyboard disclosure, and reduced-motion support are covered.

## Visual summary

FactoryOS uses a disciplined production composition: compact rhythm, restrained #8a5a08 emphasis, 5px geometry, quiet white operational surfaces, and domain-specific screen hierarchy. It shares interaction quality with the portfolio without sharing an identical skin.
