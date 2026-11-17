# CSS module map

Glitch's original stylesheet is preserved as an ordered sequence of cascade shards.

- `public/css/styles.css` is the first shard and remains the stable stylesheet entry point.
- `public/css/modules/cascade-02.css` through `cascade-20.css` are loaded immediately after it by `public/index.html`.
- Shards contain contiguous, complete top-level CSS rules from the original file. Their source order is intentional and must not be alphabetized or rearranged.
- Concatenating the shard contents in numeric order reconstructs the original stylesheet byte-for-byte.
- Keep the existing selectors, declarations, and cascade order unchanged when editing this layer.

This is a mechanical extraction layer. Future refactoring can replace sequential shards with genuinely feature-named stylesheets after selector ownership and dependencies have been mapped and regression-tested.
