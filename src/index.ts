import type {
  MetadataDetails,
  MetadataProvider,
  MetadataSearchResult,
  PluginContext,
  ServerPlugin,
} from "@droposs/plugin-sdk";

export type HttpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const API_BASE = "https://www.steamgriddb.com/api/v2";
const API_KEY_ENV = "STEAMGRIDDB_API_KEY";
const CONFIG_KEY = "config";

export interface SteamGridDBConfig {
  apiKey?: string;
}

interface SgdbEnvelope<T> {
  success?: boolean;
  data?: T;
  errors?: string[];
}

export interface SgdbGame {
  id?: string | number;
  name?: string;
  release_date?: number;
  types?: string[];
  verified?: boolean;
}

export interface SgdbImage {
  id?: number;
  url?: string;
  thumb?: string;
  style?: string[];
  dimensions?: string;
  mime?: string;
}

function extractData<T>(payload: unknown): T | undefined {
  const envelope = payload as SgdbEnvelope<T> | undefined;
  return envelope && typeof envelope === "object" ? envelope.data : undefined;
}

function yearFromUnix(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value * 1000);
  const year = date.getUTCFullYear();
  return Number.isFinite(year) ? year : undefined;
}

export function mapSearchResults(payload: unknown): MetadataSearchResult[] {
  const data = extractData<SgdbGame[]>(payload);
  if (!Array.isArray(data)) return [];
  return data
    .filter((game): game is SgdbGame => Boolean(game?.id !== undefined && game?.name))
    .map((game) => ({
      id: String(game.id),
      title: String(game.name),
      releaseYear: yearFromUnix(game.release_date),
      provider: "steamgriddb",
    }));
}

function imageUrls(payload: unknown): string[] {
  const images = extractData<SgdbImage[]>(payload);
  if (!Array.isArray(images)) return [];
  return images
    .map((image) => image?.url)
    .filter((url): url is string => typeof url === "string" && url.length > 0);
}

export function mapGameDetails(
  gamePayload: unknown,
  gridsPayload: unknown,
  heroesPayload: unknown,
  logosPayload: unknown,
): MetadataDetails | null {
  const game = extractData<SgdbGame>(gamePayload);
  if (!game?.id || !game.name) return null;

  const grids = imageUrls(gridsPayload);
  const heroes = imageUrls(heroesPayload);
  const logos = imageUrls(logosPayload);

  return {
    id: String(game.id),
    title: game.name,
    releaseYear: yearFromUnix(game.release_date),
    coverUrl: grids[0],
    bannerUrl: heroes[0],
    iconUrl: logos[0],
    screenshots: grids,
    provider: "steamgriddb",
    metadata: {
      types: game.types ?? [],
      verified: Boolean(game.verified),
    },
  };
}

export function resolveApiKey(
  config: SteamGridDBConfig | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const stored = config?.apiKey?.trim();
  if (stored) return stored;
  const fromEnv = env[API_KEY_ENV]?.trim();
  return fromEnv || undefined;
}

export class SteamGridDBProvider implements MetadataProvider {
  id = "steamgriddb";
  name = "SteamGridDB";

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchFn: HttpFetch,
  ) {}

  async search(query: string): Promise<MetadataSearchResult[]> {
    const url = new URL(`${API_BASE}/search/autocomplete/${encodeURIComponent(query)}`);
    const payload = await this.request(url);
    return mapSearchResults(payload);
  }

  async getDetails(id: string): Promise<MetadataDetails | null> {
    const gameId = encodeURIComponent(id);
    const [game, grids, heroes, logos] = await Promise.all([
      this.request(new URL(`${API_BASE}/games/id/${gameId}`)),
      this.request(new URL(`${API_BASE}/grids/game/${gameId}`)),
      this.request(new URL(`${API_BASE}/heroes/game/${gameId}`)),
      this.request(new URL(`${API_BASE}/logos/game/${gameId}`)),
    ]);
    return mapGameDetails(game, grids, heroes, logos);
  }

  private async request(url: URL): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const response = await this.fetchFn(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(`SteamGridDB request failed with status ${response.status}`);
    }
    const payload = (await response.json()) as SgdbEnvelope<unknown> | undefined;
    if (payload?.success === false) {
      throw new Error("SteamGridDB request was rejected");
    }
    return payload;
  }
}

export default class SteamGridDBPlugin implements ServerPlugin {
  metadata = {
    id: "drop-metadata-steamgriddb",
    name: "SteamGridDB",
    version: "0.1.0",
    apiVersion: 2,
    capabilities: ["metadata:provider" as const, "storage" as const, "network" as const],
  };

  async init(ctx: PluginContext): Promise<void> {
    const config = await ctx.storage.get<SteamGridDBConfig>(CONFIG_KEY);
    const apiKey = resolveApiKey(config);
    ctx.registerMetadataProvider(new SteamGridDBProvider(apiKey, ctx.fetch.bind(ctx)));
    ctx.logger.info(
      `SteamGridDB metadata provider registered (API key ${apiKey ? "configured" : "not configured"})`,
    );
  }
}
