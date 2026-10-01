import { readStdin } from './stdin.js';
import { readState, createEmptySessionState, refreshGitStatus } from './state.js';
import { formatStatusline, getTerminalWidth, getContentWidth } from './format.js';
import { isUserPrompt, readLatestUserPrompt, userPromptPreview } from './prompt-text.js';
import { readConfig } from './config.js';
import { resolveRateLimits } from './rate-limits-cache.js';
import { resolveContextWindow } from './context-window-cache.js';
import { normalizeNonNegativeNumber, normalizePercentage } from './metrics.js';
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function stringAt(record, key) {
    return typeof record[key] === 'string' ? record[key] : undefined;
}
function recordAt(record, key) {
    const value = record[key];
    return isRecord(value) ? value : undefined;
}
function stringFields(value, keys) {
    if (!value)
        return undefined;
    const out = {};
    for (const key of keys) {
        const field = stringAt(value, key);
        if (field !== undefined)
            out[key] = field;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}
function normalizeRateLimits(value) {
    if (!value)
        return undefined;
    const normalizeWindow = (key) => {
        const raw = recordAt(value, key);
        if (!raw)
            return undefined;
        const usedPercentage = (key === 'spend_limit' ? normalizeNonNegativeNumber : normalizePercentage)(raw['used_percentage']);
        const resetsAt = normalizeNonNegativeNumber(raw['resets_at']);
        if (usedPercentage === undefined)
            return undefined;
        return resetsAt === undefined
            ? { used_percentage: usedPercentage }
            : { used_percentage: usedPercentage, resets_at: resetsAt };
    };
    const fiveHour = normalizeWindow('five_hour');
    const sevenDay = normalizeWindow('seven_day');
    const spendLimit = normalizeWindow('spend_limit');
    return fiveHour || sevenDay || spendLimit
        ? { five_hour: fiveHour, seven_day: sevenDay, spend_limit: spendLimit }
        : undefined;
}
function normalizeInput(value) {
    if (!isRecord(value))
        return null;
    const sessionId = stringAt(value, 'session_id');
    if (!sessionId)
        return null;
    const modelRaw = recordAt(value, 'model');
    const costRaw = recordAt(value, 'cost');
    const contextRaw = recordAt(value, 'context_window');
    const effortRaw = recordAt(value, 'effort');
    const thinkingRaw = recordAt(value, 'thinking');
    const prRaw = recordAt(value, 'pr');
    const cacheRaw = recordAt(value, 'prompt_cache');
    const hitRatio = normalizeNonNegativeNumber(cacheRaw?.['hit_ratio']);
    const costUsd = normalizeNonNegativeNumber(costRaw?.['total_cost_usd']);
    const durationMs = normalizeNonNegativeNumber(costRaw?.['total_duration_ms']);
    const contextPct = normalizePercentage(contextRaw?.['used_percentage']);
    const prNumber = normalizeNonNegativeNumber(prRaw?.['number']);
    return {
        session_id: sessionId,
        transcript_path: stringAt(value, 'transcript_path'),
        cwd: stringAt(value, 'cwd'),
        model: stringFields(modelRaw, ['display_name', 'id']),
        cost: costUsd !== undefined || durationMs !== undefined
            ? { total_cost_usd: costUsd, total_duration_ms: durationMs }
            : undefined,
        context_window: contextPct === undefined ? undefined : { used_percentage: contextPct },
        workspace: stringFields(recordAt(value, 'workspace'), ['git_worktree', 'current_dir', 'project_dir']),
        worktree: stringFields(recordAt(value, 'worktree'), ['name', 'path', 'branch', 'original_cwd', 'original_branch']),
        effort: typeof effortRaw?.['level'] === 'string' ? { level: effortRaw['level'] } : undefined,
        thinking: typeof thinkingRaw?.['enabled'] === 'boolean' ? { enabled: thinkingRaw['enabled'] } : undefined,
        session_name: stringAt(value, 'session_name'),
        agent: stringFields(recordAt(value, 'agent'), ['name']),
        pr: prNumber !== undefined || typeof prRaw?.['title'] === 'string' || typeof prRaw?.['url'] === 'string'
            ? {
                number: prNumber === undefined ? undefined : Math.trunc(prNumber),
                title: typeof prRaw?.['title'] === 'string' ? prRaw['title'] : undefined,
                url: typeof prRaw?.['url'] === 'string' ? prRaw['url'] : undefined,
                kind: stringAt(prRaw ?? {}, 'kind'),
                review_state: stringAt(prRaw ?? {}, 'review_state'),
            }
            : undefined,
        fast_mode: typeof value['fast_mode'] === 'boolean' ? value['fast_mode'] : undefined,
        prompt_cache: cacheRaw ? {
            warm: typeof cacheRaw['warm'] === 'boolean' ? cacheRaw['warm'] : undefined,
            hit_ratio: hitRatio === undefined ? undefined : Math.min(1, hitRatio),
        } : undefined,
        rate_limits: normalizeRateLimits(recordAt(value, 'rate_limits')),
    };
}
async function main() {
    const raw = await readStdin();
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        process.exit(0);
    }
    const input = normalizeInput(parsed);
    if (!input?.session_id)
        process.exit(0);
    // SessionStart hook may not have flushed state yet on first statusline render.
    const cwd = input.cwd ?? input.workspace?.current_dir ?? input.workspace?.project_dir ?? '';
    const state = readState(input.session_id) ?? createEmptySessionState(input.session_id, cwd);
    if (state.lastUserPrompt && !isUserPrompt(state.lastUserPrompt)) {
        state.lastUserPrompt = await readLatestUserPrompt(input.transcript_path);
    }
    state.lastUserPrompt = userPromptPreview(state.lastUserPrompt);
    const cwdChanged = Boolean(cwd && state.cwd && state.cwd !== cwd);
    if (cwd)
        state.cwd = cwd;
    // Render-time refresh: hooks can't see mid-turn checkouts and the first
    // render beats SessionStart's state flush. Mutation is scratch-only — not persisted.
    if (cwd)
        await refreshGitStatus(state, cwd, { useFallback: !cwdChanged });
    const [contextWindow, rateLimits] = await Promise.all([
        resolveContextWindow(input.session_id, input.context_window),
        resolveRateLimits(input.session_id, input.rate_limits),
    ]);
    const builtin = {
        model: input.model,
        cost: input.cost,
        context_window: contextWindow,
        workspace: input.workspace,
        worktree: input.worktree,
        effort: input.effort,
        thinking: input.thinking,
        session_name: input.session_name,
        agent: input.agent,
        pr: input.pr,
        fast_mode: input.fast_mode,
        prompt_cache: input.prompt_cache,
        rate_limits: rateLimits,
    };
    const config = readConfig();
    const output = formatStatusline(state, getContentWidth(getTerminalWidth(), config.widthReserve), builtin, config);
    process.stdout.write(output + '\n');
}
main().catch(() => process.exit(0));
