import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

export function toSnakeCase(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(toSnakeCase);
  }
  if (data !== null && typeof data === "object" && !(data instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      result[camelToSnake(k)] = toSnakeCase(v);
    }
    return result;
  }
  return data;
}
