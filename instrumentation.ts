import type { Instrumentation } from "next";
import { errorFields, operationalLog } from "@/lib/observability/server-logger";

export function register() {
  operationalLog("info", {
    event: "runtime.started",
    module: "system",
    meta: { runtime: process.env.NEXT_RUNTIME ?? "unknown" }
  });
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  operationalLog("error", {
    event: "request.unhandled_error",
    route: context.routePath || request.path,
    method: request.method,
    module: context.routeType,
    ...errorFields(error),
    meta: {
      routerKind: context.routerKind,
      routeType: context.routeType,
      renderSource: context.renderSource ?? null,
      revalidateReason: context.revalidateReason ?? null
    }
  });
};
