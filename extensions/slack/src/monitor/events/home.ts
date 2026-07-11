// Slack plugin module implements home behavior.
import type { SlackEventMiddlewareArgs } from "@slack/bolt";
import type { HomeView } from "@slack/types";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { danger } from "openclaw/plugin-sdk/runtime-env";
import type { SlackMonitorContext } from "../context.js";
import type { SlackAppHomeOpenedEvent } from "../types.js";

type SlackAppHomeRendererContext = {
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

export function buildSlackHomeView(): HomeView {
  return {
    type: "home",
    callback_id: "openclaw:home",
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "OpenClaw",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Send a DM, mention OpenClaw in a channel, or use `/openclaw` to start a session.",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "This Home tab is safe to show to any workspace member who opens the app.",
          },
        ],
      },
    ],
  };
}

export function registerSlackHomeEvents(params: {
  ctx: SlackMonitorContext;
  trackEvent?: () => void;
}) {
  const { ctx, trackEvent } = params;

  ctx.app.event(
    "app_home_opened",
    async ({ event, body }: SlackEventMiddlewareArgs<"app_home_opened">) => {
      try {
        if (ctx.shouldDropMismatchedSlackEvent(body)) {
          return;
        }
        trackEvent?.();

        const payload = event as SlackAppHomeOpenedEvent;
        if (!payload.user || payload.tab === "messages") {
          return;
        }

        const renderer = ctx.channelRuntime?.runtimeContexts.get<SlackAppHomeRendererContext>({
          channelId: "slack",
          accountId: ctx.accountId,
          capability: "app-home-renderer",
        });
        let view: HomeView = buildSlackHomeView();
        let rendererOwnedView = false;
        if (renderer) {
          try {
            const rendered = await renderer.render({
              accountId: ctx.accountId,
              userId: payload.user,
              tab: payload.tab,
            });
            if (
              rendered &&
              typeof rendered === "object" &&
              (rendered as { type?: unknown }).type === "home" &&
              Array.isArray((rendered as { blocks?: unknown }).blocks)
            ) {
              view = rendered as HomeView;
              rendererOwnedView = true;
            }
          } catch (err) {
            ctx.runtime.error?.(
              danger(`slack app home renderer failed: ${formatErrorMessage(err)}`),
            );
          }
        }

        const published = await ctx.app.client.views.publish({
          token: ctx.botToken,
          user_id: payload.user,
          view,
        });
        const viewId = typeof published.view?.id === "string" ? published.view.id : undefined;
        if (rendererOwnedView && renderer?.onPublished && viewId) {
          try {
            await renderer.onPublished({
              accountId: ctx.accountId,
              userId: payload.user,
              tab: payload.tab,
              viewId,
              ...(typeof published.view?.private_metadata === "string"
                ? { privateMetadata: published.view.private_metadata }
                : typeof view.private_metadata === "string"
                  ? { privateMetadata: view.private_metadata }
                  : {}),
            });
          } catch (err) {
            ctx.runtime.error?.(
              danger(`slack app home publication callback failed: ${formatErrorMessage(err)}`),
            );
          }
        }
      } catch (err) {
        ctx.runtime.error?.(danger(`slack app home handler failed: ${formatErrorMessage(err)}`));
      }
    },
  );
}
