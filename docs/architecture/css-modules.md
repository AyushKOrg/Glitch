# CSS source modules

The original Glitch stylesheet is preserved as 261 ordered source fragments distributed evenly across 31 named folders.

- The first 13 folders contain 9 fragments each; the remaining 18 contain 8 each.
- Every fragment contains complete top-level CSS blocks; fragments are not cut through selectors or at-rules.
- The numeric `part-NNN.css` prefix is the authoritative cascade order across all folders.
- `scripts/build-css.js` recursively discovers the fragments, sorts them by their numeric sequence, and bundles them into `public/css/styles.css`.
- The browser still downloads one stylesheet; the source organization does not add runtime stylesheet requests.
- Folder names describe broad organization areas, but the original cascade sequence is deliberately preserved rather than reordered by category.

This is a source-layout change only. Selectors, declarations, specificity, visual design, and cascade order are unchanged.
