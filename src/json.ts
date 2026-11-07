export type JsonObject = Record<string, unknown>;

export function object(value: unknown, what: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what}: expected a JSON object`);
  }
  return value as JsonObject;
}

export function string(value: JsonObject, key: string, what: string): string {
  const field = value[key];
  if (typeof field !== "string" || field === "") throw new Error(`${what}: missing "${key}"`);
  return field;
}

export function number(value: JsonObject, key: string, what: string): number {
  const field = value[key];
  if (typeof field !== "number") throw new Error(`${what}: missing "${key}"`);
  return field;
}
