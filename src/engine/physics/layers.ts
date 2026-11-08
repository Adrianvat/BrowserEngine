/**
 * What happens when colliders on two layers meet: pushed apart and reported (solid),
 * only reported (touch; a trigger or pick-up), or nothing at all.
 */
export type Interaction = "solid" | "touch" | "none";

/** The layers one layer is solid against and the ones it only touches. */
export interface LayerRules {
  solid?: readonly string[];
  touch?: readonly string[];
}

/** The layer a Collider is on until told otherwise: solid against everything, unless the rules say so. */
export const DEFAULT_LAYER = "default";

/**
 * Which collider layers interact, and how. A global resource read by the physics system.
 * Rules go both ways: listing "rect" under "player" is the same as "player" under "rect".
 * Every layer named anywhere in the rules exists, and so does "default", which is solid
 * against every layer the rules leave it unpaired with; other pairs not listed do not
 * interact. Without rules, every layer is solid against every other.
 */
export class CollisionLayers {
  private readonly table: Map<string, Map<string, Interaction>> | null;

  constructor(rules?: Readonly<Record<string, LayerRules>>) {
    if (!rules) {
      this.table = null;
      return;
    }
    this.table = new Map();
    const row = (layer: string) => {
      let found = this.table!.get(layer);
      if (!found) {
        found = new Map();
        this.table!.set(layer, found);
      }
      return found;
    };
    row(DEFAULT_LAYER);
    for (const [layer, { solid = [], touch = [] }] of Object.entries(rules)) {
      row(layer);
      for (const [interaction, others] of [
        ["solid", solid],
        ["touch", touch],
      ] as const) {
        for (const other of others) {
          const before = row(layer).get(other) ?? row(other).get(layer);
          if (before && before !== interaction) {
            throw new Error(
              `Collision layers "${layer}" and "${other}" are listed as both ${before} and ${interaction}`,
            );
          }
          row(layer).set(other, interaction);
          row(other).set(layer, interaction);
        }
      }
    }
    // A Collider fresh from the editor is on "default"; it should simply be solid.
    for (const layer of this.table.keys()) {
      if (!row(DEFAULT_LAYER).has(layer)) {
        row(DEFAULT_LAYER).set(layer, "solid");
        row(layer).set(DEFAULT_LAYER, "solid");
      }
    }
  }

  /** Whether any rules were given (otherwise everything is solid). */
  get configured(): boolean {
    return this.table !== null;
  }

  /** The names of every layer: "default" first, then in the order mentioned. Empty without rules. */
  get names(): string[] {
    return this.table ? [...this.table.keys()] : [];
  }

  /** How colliders on these two layers interact. Throws for a layer the rules never name. */
  interaction(a: string, b: string): Interaction {
    if (!this.table) return "solid";
    const row = this.table.get(a);
    if (!row) throw new Error(`Unknown collision layer "${a}"`);
    if (!this.table.has(b)) throw new Error(`Unknown collision layer "${b}"`);
    return row.get(b) ?? "none";
  }
}
