import type { CellProperties } from "./experiment";

export const CELL_ROLES = ["standard", "switch", "lamp"] as const;
export type CellRole = (typeof CELL_ROLES)[number];

export function cellRoleFor(
  properties: Pick<CellProperties, "hasPower" | "activatable">,
): CellRole {
  if (properties.hasPower && properties.activatable) return "standard";
  if (!properties.hasPower && properties.activatable) return "switch";
  if (properties.hasPower) return "lamp";
  throw new Error("A cell must have power or activation capability");
}

export function propertiesForRole(
  role: CellRole,
): Pick<CellProperties, "hasPower" | "activatable"> {
  return {
    hasPower: role === "standard" || role === "lamp",
    activatable: role === "standard" || role === "switch",
  };
}
