import { describeFailure } from "./instrumentation";

// Log a stray rejection instead of letting it take down every answer on this instance.
process.on("unhandledRejection", (reason) => console.error("Unhandled rejection", describeFailure(reason)));
