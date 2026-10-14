import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { launchProblems } from "./src/lib/launch";

const nextConfig: NextConfig = {};

export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) {
    const problems = launchProblems(process.env);
    if (problems.length) throw new Error(`Not ready for production:\n- ${problems.join("\n- ")}`);
  }
  return nextConfig;
}
