import test from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@droposs/plugin-sdk";
import Plugin, {
  mapGameDetails,
  mapSearchResults,
  resolveApiKey,
  type SteamGridDBConfig,
} from "../src/index.js";

const API_KEY_ENV = "STEAMGRIDDB_API_KEY";

const SEARCH_FIXTURE = {
  success: true,
  data: [
    {
      id: 23985,
      name: "Hollow Knight",
      release_date: 1488326400,
      types: ["game"],
      verified: true,
    },
  ],
};

const GAME_FIXTURE = {
  success: true,
  data: {
    id: 23985,
    name: "Hollow Knight",
    release_date: 1488326400,
    types: ["game"],
    verified: true,
  },
};

const GRIDS_FIXTURE = {
  success: true,
  data: [
    { id: 1, url: "https://cdn2.steamgriddb.com/grid/first.png", dimensions: "600x900" },
    { id: 2, url: "https://cdn2.steamgriddb.com/grid/second.png", dimensions: "600x900" },
  ],
};

const HEROES_FIXTURE = {
  success: true,
  data: [{ id: 3, url: "https://cdn2.steamgriddb.com/hero/first.png" }],
};

const LOGOS_FIXTURE = {
  success: true,
  data: [{ id: 4, url: "https://cdn2.steamgriddb.com/logo/first.png" }],
};

interface FetchCall {
  url: string;
  headers: Record<string, string>;
}

function createFetchStub(fixtures: Array<{ match: string; body: unknown; status?: number }>): {
  calls: FetchCall[];
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
} {
  const calls: FetchCall[] = [];
  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers as Record<string, string>) ?? {} });
    const fixture = fixtures.find((entry) => url.includes(entry.match));
    if (!fixture) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify(fixture.body), {
      status: fixture.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetch };
}

async function createProviderContext(
  fixtures: Array<{ match: string; body: unknown; status?: number }>,
  config?: SteamGridDBConfig,
): Promise<{ ctx: MockPluginContext; calls: FetchCall[]; messages: string[] }> {
  const ctx = new MockPluginContext("drop-metadata-steamgriddb", ["metadata:provider", "storage", "network"]);
  const messages: string[] = [];
  ctx.logger = {
    info: (message: string) => messages.push(message),
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  const stub = createFetchStub(fixtures);
  (ctx as { fetch: typeof stub.fetch }).fetch = stub.fetch;
  if (config) {
    await ctx.storage.set("config", config);
  }
  await new Plugin().init(ctx);
  return { ctx, calls: stub.calls, messages };
}

test("drop-metadata-steamgriddb registers a metadata provider", async () => {
  const { ctx } = await createProviderContext([]);
  assert.equal(ctx.metadataProviders.size, 1);
  assert.equal(ctx.metadataProviders.get("steamgriddb")?.name, "SteamGridDB");
});

test("drop-metadata-steamgriddb resolves the API key from storage before env", () => {
  const env = { [API_KEY_ENV]: "env-key" } as NodeJS.ProcessEnv;
  assert.equal(resolveApiKey({ apiKey: "stored-key" }, env), "stored-key");
  assert.equal(resolveApiKey({}, env), "env-key");
  assert.equal(resolveApiKey(null, {} as NodeJS.ProcessEnv), undefined);
});

test("drop-metadata-steamgriddb maps an autocomplete payload", () => {
  const results = mapSearchResults(SEARCH_FIXTURE);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "23985");
  assert.equal(results[0].title, "Hollow Knight");
  assert.equal(results[0].releaseYear, 2017);
  assert.equal(results[0].provider, "steamgriddb");
});

test("drop-metadata-steamgriddb searches the autocomplete endpoint with the stored key", async () => {
  const { ctx, calls } = await createProviderContext(
    [{ match: "/search/autocomplete/hollow%20knight", body: SEARCH_FIXTURE }],
    { apiKey: "stored-key" },
  );
  const provider = ctx.metadataProviders.get("steamgriddb");
  assert.ok(provider);
  const results = await provider.search("hollow knight");
  assert.equal(results.length, 1);
  const searchCall = calls.find((call) => call.url.includes("/search/autocomplete/"));
  assert.ok(searchCall);
  assert.equal(searchCall.url, "https://www.steamgriddb.com/api/v2/search/autocomplete/hollow%20knight");
  assert.equal(searchCall.headers.Authorization, "Bearer stored-key");
});

test("drop-metadata-steamgriddb maps game details from grids, heroes, and logos", async () => {
  const { ctx } = await createProviderContext([
    { match: "/games/id/23985", body: GAME_FIXTURE },
    { match: "/grids/game/23985", body: GRIDS_FIXTURE },
    { match: "/heroes/game/23985", body: HEROES_FIXTURE },
    { match: "/logos/game/23985", body: LOGOS_FIXTURE },
  ]);
  const details = await ctx.metadataProviders.get("steamgriddb")?.getDetails("23985");
  assert.ok(details);
  assert.equal(details.title, "Hollow Knight");
  assert.equal(details.releaseYear, 2017);
  assert.equal(details.coverUrl, "https://cdn2.steamgriddb.com/grid/first.png");
  assert.equal(details.bannerUrl, "https://cdn2.steamgriddb.com/hero/first.png");
  assert.equal(details.iconUrl, "https://cdn2.steamgriddb.com/logo/first.png");
  assert.deepEqual(details.screenshots, [
    "https://cdn2.steamgriddb.com/grid/first.png",
    "https://cdn2.steamgriddb.com/grid/second.png",
  ]);
});

test("drop-metadata-steamgriddb detail mapper returns null for empty payloads", () => {
  assert.equal(mapGameDetails({ success: true, data: null }, null, null, null), null);
});

test("drop-metadata-steamgriddb throws on failed requests", async () => {
  const { ctx } = await createProviderContext([
    { match: "/search/autocomplete/", body: {}, status: 401 },
  ]);
  await assert.rejects(
    () => ctx.metadataProviders.get("steamgriddb")?.search("hollow") ?? Promise.resolve([]),
    /SteamGridDB request failed with status 401/,
  );
});

test("drop-metadata-steamgriddb never logs the API key", async () => {
  const { messages } = await createProviderContext([], { apiKey: "super-secret-key" });
  assert.deepEqual(messages, ["SteamGridDB metadata provider registered (API key configured)"]);
  assert.ok(messages.every((message) => !message.includes("super-secret-key")));
});
