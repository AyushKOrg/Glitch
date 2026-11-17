# CSS source modules

The original Glitch stylesheet is preserved as an ordered sequence of complete top-level CSS blocks under `src/styles/cascade/`.

- Numbered modules preserve the exact original cascade order.
- Each module contains complete top-level CSS rules or at-rules; no module cuts through a rule.
- Concatenating modules in numeric order reconstructs the original stylesheet byte-for-byte.
- `scripts/build-css.js` bundles the modules into `public/css/styles.css` during the Vercel build.
- The browser still downloads one stylesheet; the source split does not add hundreds of runtime requests.
- Do not alphabetize or reorder these files. Their order is part of the CSS cascade.

This is a source organization change only. Selectors, declarations, specificity, visual design, and cascade order are preserved.
