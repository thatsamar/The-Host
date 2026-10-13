import type { Instrumentation } from "next";
import { errorClass } from "@/lib/diagnostics";

// Server failures that would otherwise show only as a bare 500. The log gets
// the route's pattern (never the actual path, which can hold an answer id) and
// the error's class (never its message). Next.js itself already logs stray
// promise rejections without stopping the server.
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  console.error(
    "Request failed",
    JSON.stringify({
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
      error: errorClass(err),
    }),
  );
};
