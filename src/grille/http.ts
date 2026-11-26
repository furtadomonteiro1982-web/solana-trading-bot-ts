export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** GET JSON avec un message clair en cas de panne réseau ou d'erreur HTTP. */
export async function getJson(url: string, fetchFn: FetchLike, source: string): Promise<unknown> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchFn(url);
  } catch (error) {
    const cause = error instanceof Error && error.cause ? ` (${String(error.cause)})` : '';
    throw new Error(`Impossible de joindre ${source} (${url}) : ${String(error)}${cause}.`);
  }
  if (!response.ok) throw new Error(`${source} a répondu ${response.status} pour ${url}.`);
  return response.json();
}

export function defaultFetch(): FetchLike {
  return globalThis.fetch as unknown as FetchLike;
}
