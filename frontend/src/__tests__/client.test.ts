import { ApiError, requestJson, tokenStore } from "@/api/client";
import { json, mockFetch } from "@/test/utils";

describe("api client", () => {
  beforeEach(() => tokenStore.set(null));

  it("sends the bearer token and parses JSON", async () => {
    tokenStore.set("token-1");
    const { calls } = mockFetch({ "GET /api/auth/me": () => json({ ok: true }) });
    await expect(requestJson("/api/auth/me")).resolves.toEqual({ ok: true });
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    tokenStore.set("expired");
    let attempts = 0;
    const { calls } = mockFetch({
      "GET /api/analyses": (init) => {
        attempts += 1;
        const auth = (init?.headers as Record<string, string>).Authorization;
        return auth === "Bearer fresh"
          ? json({ items: [] })
          : json({ error: { code: "token_expired", message: "x" } }, 401);
      },
      "POST /api/auth/refresh": () =>
        json({ access_token: "fresh", token_type: "bearer", expires_in: 900, user: {} }),
    });
    await expect(requestJson("/api/analyses")).resolves.toEqual({ items: [] });
    expect(attempts).toBe(2);
    expect(calls.filter((c) => c.url.pathname === "/api/auth/refresh")).toHaveLength(1);
    expect(tokenStore.get()).toBe("fresh");
  });

  it("maps the error envelope to ApiError", async () => {
    mockFetch({
      "POST /api/analyses": () =>
        json(
          { error: { code: "unsupported_format", message: "Unsupported file type.", request_id: "rid-1" } },
          415,
        ),
    });
    const error = await requestJson("/api/analyses", { method: "POST" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 415, code: "unsupported_format", requestId: "rid-1" });
  });

  it("reports network failures clearly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const error = await requestJson("/api/health").catch((e) => e);
    expect(error).toMatchObject({ status: 0, code: "network_error" });
  });

  it("builds query strings without empty values", async () => {
    const { calls } = mockFetch({ "GET /api/analyses": () => json({}) });
    await requestJson("/api/analyses", { query: { q: "", page: 2, uncertain: false, x: undefined } });
    expect(calls[0]!.url.search).toBe("?page=2&uncertain=false");
  });
});
