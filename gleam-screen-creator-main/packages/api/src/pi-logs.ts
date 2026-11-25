export interface PiLogFile {
  name?: unknown;
  path?: unknown;
}

export type PiSensorLogKind = "temperature" | "humidity" | "combined";

const LOG_NAME = /^(?:temperature|humidity|ammonia|behavior|sensors|kinect-weights|kinect-birds)-\d{4}-\d{2}-\d{2}\.csv$/;
const FOLDER_NAMES = new Set(["temperature", "humidity", "ammonia", "behavior"]);

export function safePiLogPath(file: PiLogFile): string | null {
  const value = typeof file.path === "string" ? file.path : file.name;
  if (typeof value !== "string") return null;
  const parts = value.split("/");
  if (parts.length === 1 && LOG_NAME.test(parts[0]!)) return value;
  if (
    parts.length === 2 &&
    FOLDER_NAMES.has(parts[0]!) &&
    LOG_NAME.test(parts[1]!) &&
    parts[1]!.startsWith(`${parts[0]}-`)
  ) {
    return value;
  }
  return null;
}

export function piLogDate(path: string): string | null {
  const name = path.split("/").at(-1);
  const match = name?.match(/-(\d{4}-\d{2}-\d{2})\.csv$/);
  return match?.[1] ?? null;
}

export function piLogSensorKind(path: string): PiSensorLogKind | null {
  const parts = path.split("/");
  if (parts.length === 2 && (parts[0] === "temperature" || parts[0] === "humidity")) {
    return parts[0];
  }
  return parts.length === 1 && parts[0]!.startsWith("sensors-") ? "combined" : null;
}

export function encodePiLogPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
