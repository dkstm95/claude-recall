import type { SessionState } from './state.js';
import type { StatuslineConfig, ThemeColors } from './config.js';
import type { Joiner } from './statusline-layout.js';
import type { BuiltinData } from './statusline-types.js';

export interface RenderContext {
  state: SessionState;
  termWidth: number;
  builtin: BuiltinData | undefined;
  cfg: StatuslineConfig;
  tc: ThemeColors;
  joiner: Joiner;
  gridOn: boolean;
  prefix: string;
  prefixWidth: number;
  elapsed: string;
}
