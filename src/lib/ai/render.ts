import type { ContextBlock } from "./types";

/**
 * Renders a context block with an explicit open/close label so the model can
 * tell each part of its context apart:
 *
 *   <app_capabilities>
 *   APP CAPABILITIES
 *   ...
 *   </app_capabilities>
 */
export function renderContextBlock(block: ContextBlock): string {
  return `<${block.label}>\n${block.title}\n\n${block.body.trim()}\n</${block.label}>`;
}
