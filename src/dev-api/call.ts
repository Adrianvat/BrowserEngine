function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a client needs to reach one of the dev server's APIs: its mount point, and fetch. */
export interface ApiOptions {
  base: string;
  fetchFn?: typeof fetch;
}

/**
 * A call to one of the dev server's file APIs (tools/game-files-plugin.ts): a JSON body in,
 * the JSON answer out. An error answer becomes a thrown error with the server's message;
 * an answer that is not JSON at all means there is no dev server (a production build).
 */
export async function callApi(
  { base, fetchFn = (...args) => fetch(...args) }: ApiOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(base + path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`The dev server can't be reached: ${messageOf(error)}`);
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    // Without the dev server (a production build, say) the request gets a page or a 404.
    throw new Error(`${base} is not there; is this the dev server (npm run dev)?`);
  }
  const value = (await response.json()) as { error?: unknown };
  if (!response.ok) {
    const reason = typeof value.error === "string" ? value.error : `HTTP ${response.status}`;
    throw new Error(reason);
  }
  return value;
}
