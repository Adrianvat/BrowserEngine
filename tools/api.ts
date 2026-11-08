/**
 * What the dev server's file APIs (scripts, scenes, images) share: the little of a file
 * system they need, and the shape of a request and a response. Pure, so the APIs are
 * unit-tested over an in-memory file system; the Node side is game-files-plugin.ts.
 */

/** The little of a file system the file APIs need; Node's fs or an in-memory stand-in. */
export interface FileSystem {
  /** The names of the entries in a folder; none when it does not exist. */
  list(folder: string): Promise<string[]>;
  /** A text file's contents, or null when it does not exist. */
  read(path: string): Promise<string | null>;
  /** Writes a text file, creating its folders. */
  write(path: string, text: string): Promise<void>;
  /** A file's bytes, or null when it does not exist. */
  readBytes(path: string): Promise<Uint8Array | null>;
  /** Writes a file's bytes, creating its folders. */
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  /** Deletes a file; nothing happens when it does not exist. */
  remove(path: string): Promise<void>;
  /** Deletes a folder and everything in it; nothing happens when it does not exist. */
  removeFolder(path: string): Promise<void>;
}

export function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

/** An HTTP request to one of the APIs, with the path after its mount point. */
export interface ApiRequest {
  method: string;
  /** E.g. "", "/order", "/systems/kick". */
  path: string;
  body: string;
}

/** A JSON response, or a file's bytes with their content type. */
export interface ApiResponse {
  status: number;
  body?: unknown;
  file?: { bytes: Uint8Array; type: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function parseBody(body: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(body === "" ? "{}" : body);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "The request body must be a JSON object");
  }
}

/** Runs a route handler, turning what it throws into an error response. */
export async function respond(handler: () => Promise<ApiResponse>): Promise<ApiResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, body: { error: error.message } };
    const message = error instanceof Error ? error.message : String(error);
    return { status: 500, body: { error: message } };
  }
}

/** Bytes as base64 text, for carrying a file in JSON. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // In chunks: one String.fromCharCode call per byte is slow, one per file overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The bytes of base64 text; throws for text that is not base64. */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
