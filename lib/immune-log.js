// LoopMune — the Immune Log store.
//
// Append-only JSONL: every state change in an immune cycle appends one
// snapshot line for that incident ({ type: 'snapshot', incident }). Readers
// fold the file, keeping the latest snapshot per incident id. The file is
// the durable record judges can replay — it is served verbatim by the
// dashboard and needs no live Kane or LLM call to be meaningful.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_LOG_FILE = join(
  fileURLToPath(new URL('..', import.meta.url)), 'data', 'immune-log.jsonl');

export function createImmuneLog(file = DEFAULT_LOG_FILE) {
  return {
    file,

    append(incident) {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, JSON.stringify({ type: 'snapshot', incident }) + '\n');
      return incident;
    },

    readAll() {
      if (!existsSync(file)) return [];
      const byId = new Map();
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const rec = JSON.parse(trimmed);
          if (rec && rec.type === 'snapshot' && rec.incident && rec.incident.id) {
            byId.set(rec.incident.id, rec.incident);
          }
        } catch { /* skip a torn final line */ }
      }
      return [...byId.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    },
  };
}

export function newIncidentId(attackId) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `inc-${stamp}-${attackId}`;
}
