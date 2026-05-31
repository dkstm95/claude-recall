export const REFINING_ENV_VAR = 'CLAUDE_RECALL_REFINING';
export const REFINING_ENV_VALUE = '1';

export function isRefiningSubprocess(): boolean {
  return process.env[REFINING_ENV_VAR] === REFINING_ENV_VALUE;
}
