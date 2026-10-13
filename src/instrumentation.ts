import type { Instrumentation } from "next";

// Server failures that would otherwise show only as a bare 500: the error's
// name and message go to the log, never the request's body or headers.
export const describeFailure = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : String(err).slice(0, 200));

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}

export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  console.error(
    "Request failed",
    JSON.stringify({
      method: request.method,
      path: request.path.split("?")[0],
      routeType: context.routeType,
      routePath: context.routePath,
      error: describeFailure(err),
    }),
  );
};
