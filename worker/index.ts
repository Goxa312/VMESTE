import { routeRelay } from "./room-relay";
export { RoomRelay } from "./room-relay";
import { db } from "../lib/server";
import { cleanExpiredMedia } from "../lib/uploads";
import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  async scheduled() {
    const now = Date.now();
    await Promise.all([cleanExpiredMedia(), db().batch([
      db().prepare("DELETE FROM account_sessions WHERE expires_at<=?").bind(now),
      db().prepare("DELETE FROM account_limits WHERE expires_at<=?").bind(now),
    ])]);
  },
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const relay = /^\/api\/rooms\/([a-f0-9]{12})\/relay\/([a-f0-9]{32})$/.exec(new URL(request.url).pathname);
    if (relay) return routeRelay(request, env, relay[1], relay[2]);
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};

export default worker;
