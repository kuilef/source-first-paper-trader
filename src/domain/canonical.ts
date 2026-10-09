import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { EvidenceBundle } from "./types";
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
    )
    .join(",")}}`;
}
export const hashText = (text: string) =>
  bytesToHex(sha256(new TextEncoder().encode(text)));
export const hashValue = (value: unknown) => hashText(canonicalJson(value));
export async function hashBundle(bundle: EvidenceBundle): Promise<string> {
  return hashValue(bundle);
}
