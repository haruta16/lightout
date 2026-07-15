import type { JsonValue } from "@lightout/engine";

export function objectParams(value: JsonValue): Record<string, JsonValue> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return value;
}

export function stringParam(
  params: Record<string, JsonValue>,
  key: string,
  fallback: string,
): string {
  const value = params[key];
  return typeof value === "string" ? value : fallback;
}

export function numberParam(
  params: Record<string, JsonValue>,
  key: string,
  fallback: number,
): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function booleanParam(
  params: Record<string, JsonValue>,
  key: string,
  fallback: boolean,
): boolean {
  const value = params[key];
  return typeof value === "boolean" ? value : fallback;
}

export function stringArrayParam(
  params: Record<string, JsonValue>,
  key: string,
  fallback: string[],
): string[] {
  const value = params[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : fallback;
}
