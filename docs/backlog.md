# Backlog

- **Multi-source map: separate records as regions in one map (reuses the sealed viewer region).**
  Any separate source (a sealed payload opened in a viewer, or a separate document record)
  is drawn as a cloud region (`getRegions` / `regionSvg`, kind `record`) around its root
  and subtree in one shared Map, each with its own load / edit / save. Open questions:
  region layout packing, cross-region links and drag between regions (must go through
  each source's own save), per-region dirty state.
- **Key rotation (explicit action).** Re-seal a branch under a different kid. Never part
  of the viewer, whose kid / alg / params are fixed to the opened branch.
