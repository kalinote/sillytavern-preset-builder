import { createHash } from "node:crypto";
import type { JsonObject, JsonValue } from "./types.js";

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function cloneJson<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

export function stableSha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stringifyJson(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function semanticEqual(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => semanticEqual(item, right[index] as JsonValue));
  }

  if (typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) => Object.hasOwn(right, key) && semanticEqual(left[key] as JsonValue, right[key] as JsonValue),
  );
}

export function firstSemanticDifference(left: JsonValue, right: JsonValue, path = "$"): string | undefined {
  if (Object.is(left, right)) return undefined;
  if (typeof left !== typeof right) return `${path} (type)`;
  if (left === null || right === null) return path;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return `${path} (array)`;
    if (left.length !== right.length) return `${path}.length`;
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstSemanticDifference(left[index] as JsonValue, right[index] as JsonValue, `${path}[${index}]`);
      if (difference) return difference;
    }
    return undefined;
  }
  if (typeof left !== "object" || typeof right !== "object") return path;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return `${path} (keys)`;
  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key)) return `${path}.${key} (missing)`;
    const difference = firstSemanticDifference(left[key] as JsonValue, right[key] as JsonValue, `${path}.${key}`);
    if (difference) return difference;
  }
  return undefined;
}

export function getAtPath(root: JsonValue, path: readonly (string | number)[]): JsonValue | undefined {
  let cursor: JsonValue | undefined = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[segment];
    } else {
      if (!isJsonObject(cursor)) return undefined;
      cursor = cursor[segment];
    }
  }
  return cursor;
}

export function setAtPath(root: JsonObject, path: readonly string[], value: JsonValue): void {
  let cursor = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index] as string;
    const current = cursor[segment];
    if (!isJsonObject(current)) cursor[segment] = {};
    cursor = cursor[segment] as JsonObject;
  }
  cursor[path[path.length - 1] as string] = value;
}

export function deleteAtPath(root: JsonObject, path: readonly string[]): void {
  let cursor: JsonObject = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const current = cursor[path[index] as string];
    if (!isJsonObject(current)) return;
    cursor = current;
  }
  delete cursor[path[path.length - 1] as string];
}
