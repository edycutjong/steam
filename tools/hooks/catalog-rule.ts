// The sentence both catalog gates (catalog-gate on write tools, shell-gate on the shell) put in front of the agent.
// Light on purpose: no schema, no zod, so that a hook started with `node` loads it in a few milliseconds.

export const catalogUse = (rel: string): string =>
  `Use \`npm run catalog\`: it verifies every recipe first and is the only writer of ${rel}. Rule: .kiro/steering/product.md, "Note crops and the gate": a recipe reaches Cook Mode only when P1-P6 pass in its gate.json.`
