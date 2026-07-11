// Slack tests cover home plugin behavior.
import type { HomeView } from "@slack/types";
import type { ChannelRuntimeSurface } from "openclaw/plugin-sdk/channel-contract";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let buildSlackHomeView: typeof import("./home.js").buildSlackHomeView;
let registerSlackHomeEvents: typeof import("./home.js").registerSlackHomeEvents;
let createSlackSystemEventTestHarness: typeof import("./system-event-test-harness.js").createSlackSystemEventTestHarness;

type HomeHandler = (args: { event: Record<string, unknown>; body: unknown }) => Promise<void>;

type HomeRenderer = {
  render: (input: {
    accountId: string;
    userId: string;
    tab?: string;
  }) => Promise<HomeView | null> | HomeView | null;
  onPublished?: (result: {
    accountId: string;
    userId: string;
    tab?: string;
    viewId: string;
    privateMetadata?: string;
  }) => Promise<void> | void;
};

function createChannelRuntime(renderer: HomeRenderer): ChannelRuntimeSurface {
  return {
    runtimeContexts: {
      register: () => ({ dispose: () => {} }),
      get: <T>() => renderer as unknown as T,
      watch: () => () => {},
    },
  };
}

function createHomeContext(params?: {
  trackEvent?: () => void;
  shouldDropMismatchedSlackEvent?: (body: unknown) => boolean;
  channelRuntime?: ChannelRuntimeSurface;
}) {
  const harness = createSlackSystemEventTestHarness();
  harness.ctx.accountId = "default";
  const publish = vi.fn().mockResolvedValue({ ok: true });
  const runtimeError = vi.fn();
  if (params?.shouldDropMismatchedSlackEvent) {
    harness.ctx.shouldDropMismatchedSlackEvent = params.shouldDropMismatchedSlackEvent;
  }
  harness.ctx.botToken = "xoxb-test";
  (harness.ctx.app as unknown as { client: { views: { publish: typeof publish } } }).client = {
    views: { publish },
  };
  harness.ctx.runtime.error = runtimeError;
  harness.ctx.channelRuntime = params?.channelRuntime;
  registerSlackHomeEvents({ ctx: harness.ctx, trackEvent: params?.trackEvent });
  return {
    publish,
    runtimeError,
    getHomeHandler: () => harness.getHandler("app_home_opened") as HomeHandler | null,
  };
}

describe("registerSlackHomeEvents", () => {
  beforeAll(async () => {
    ({ buildSlackHomeView, registerSlackHomeEvents } = await import("./home.js"));
    ({ createSlackSystemEventTestHarness } = await import("./system-event-test-harness.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes the default Home tab view for app_home_opened", async () => {
    const trackEvent = vi.fn();
    const { publish, getHomeHandler } = createHomeContext({ trackEvent });
    const handler = getHomeHandler();
    if (!handler) {
      throw new Error("expected Slack Home handler");
    }

    await handler({
      event: {
        type: "app_home_opened",
        user: "U123",
        channel: "D123",
        tab: "home",
        event_ts: "123.456",
      },
      body: { api_app_id: "A1" },
    });

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      token: "xoxb-test",
      user_id: "U123",
      view: buildSlackHomeView(),
    });
  });

  it("delegates Home rendering and reports the published view id", async () => {
    const customView: HomeView = { type: "home", blocks: [] };
    const onPublished = vi.fn();
    const renderer = { render: vi.fn(() => customView), onPublished };
    const { publish, getHomeHandler } = createHomeContext({
      channelRuntime: createChannelRuntime(renderer),
    });
    publish.mockResolvedValueOnce({ ok: true, view: { id: "V123" } });

    await getHomeHandler()!({
      event: { type: "app_home_opened", user: "U123", tab: "home" },
      body: {},
    });

    expect(renderer.render).toHaveBeenCalledWith({
      accountId: "default",
      userId: "U123",
      tab: "home",
    });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ view: customView }));
    expect(onPublished).toHaveBeenCalledWith({
      accountId: "default",
      userId: "U123",
      tab: "home",
      viewId: "V123",
    });
  });

  it("logs a throwing renderer and publishes the default Home view once", async () => {
    const renderer = {
      render: vi.fn(() => {
        throw new Error("render failed");
      }),
    };
    const { publish, runtimeError, getHomeHandler } = createHomeContext({
      channelRuntime: createChannelRuntime(renderer),
    });

    await getHomeHandler()!({
      event: { type: "app_home_opened", user: "U123", tab: "home" },
      body: {},
    });

    expect(runtimeError).toHaveBeenCalledWith(
      expect.stringContaining("slack app home renderer failed: render failed"),
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      token: "xoxb-test",
      user_id: "U123",
      view: buildSlackHomeView(),
    });
  });

  it("logs and isolates a throwing publication callback after one custom view publication", async () => {
    const customView: HomeView = { type: "home", blocks: [] };
    const onPublished = vi.fn(() => {
      throw new Error("callback failed");
    });
    const renderer = { render: vi.fn(() => customView), onPublished };
    const { publish, runtimeError, getHomeHandler } = createHomeContext({
      channelRuntime: createChannelRuntime(renderer),
    });
    publish.mockResolvedValueOnce({ ok: true, view: { id: "V123" } });

    await getHomeHandler()!({
      event: { type: "app_home_opened", user: "U123", tab: "home" },
      body: {},
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ view: customView }));
    expect(onPublished).toHaveBeenCalledTimes(1);
    expect(runtimeError).toHaveBeenCalledWith(
      expect.stringContaining("slack app home publication callback failed: callback failed"),
    );
  });

  it("does not publish when Slack reports the Messages tab", async () => {
    const trackEvent = vi.fn();
    const { publish, getHomeHandler } = createHomeContext({ trackEvent });

    await getHomeHandler()!({
      event: {
        type: "app_home_opened",
        user: "U123",
        channel: "D123",
        tab: "messages",
      },
      body: {},
    });

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not track or publish mismatched events", async () => {
    const trackEvent = vi.fn();
    const { publish, getHomeHandler } = createHomeContext({
      trackEvent,
      shouldDropMismatchedSlackEvent: () => true,
    });

    await getHomeHandler()!({
      event: {
        type: "app_home_opened",
        user: "U123",
        tab: "home",
      },
      body: { api_app_id: "A_OTHER" },
    });

    expect(trackEvent).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
