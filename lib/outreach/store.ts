import "server-only";

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecRole, OutreachResult } from "@/types/outreach";

/**
 * Storage for generated outreach, video views and opt-outs.
 *
 * Default implementation: in-memory, mirrored to a JSON file in the OS temp
 * directory (outside the repo) so results survive dev-server reloads. On a
 * serverless deploy the file is not shared between instances — the leader can
 * swap in a KV-backed implementation of `OutreachStore` (see
 * docs/OUTREACH_INTEGRATION.md).
 */

export interface TokenRecord {
  domain: string;
  role: ExecRole;
  email: string | null;
}

export interface OutreachStore {
  saveResult: (result: OutreachResult) => void;
  getResult: (domain: string) => OutreachResult | null;
  resolveToken: (token: string) => TokenRecord | null;
  recordView: (token: string) => void;
  getViews: (domain: string) => Record<ExecRole, number>;
  addDoNotContact: (email: string) => void;
  isDoNotContact: (email: string) => boolean;
}

interface StoreData {
  results: Record<string, OutreachResult>;
  tokens: Record<string, TokenRecord>;
  views: Record<string, number>;
  doNotContact: string[];
}

const FILE_DIR = join(tmpdir(), "velho-outreach");
const FILE_PATH = join(FILE_DIR, "store.json");
const MAX_RESULTS = 200;

const emptyData = (): StoreData => ({ results: {}, tokens: {}, views: {}, doNotContact: [] });

const load = (): StoreData => {
  try {
    const parsed = JSON.parse(readFileSync(FILE_PATH, "utf8")) as Partial<StoreData>;
    return { ...emptyData(), ...parsed };
  } catch {
    return emptyData();
  }
};

const persist = (data: StoreData): void => {
  try {
    mkdirSync(FILE_DIR, { recursive: true });
    const tmp = `${FILE_PATH}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, FILE_PATH);
  } catch {
    // Read-only filesystems (serverless) keep working from memory.
  }
};

const createFileStore = (): OutreachStore => {
  const data = load();

  return {
    saveResult: (result) => {
      data.results[result.domain] = result;
      for (const email of result.emails) {
        if (email.token) {
          data.tokens[email.token] = {
            domain: result.domain,
            role: email.role,
            email: email.recipient.email,
          };
        }
      }
      const domains = Object.keys(data.results);
      if (domains.length > MAX_RESULTS) {
        const oldest = domains
          .sort((a, b) =>
            (data.results[a]?.createdAt ?? "").localeCompare(data.results[b]?.createdAt ?? ""),
          )
          .slice(0, domains.length - MAX_RESULTS);
        for (const domain of oldest) delete data.results[domain];
      }
      persist(data);
    },
    getResult: (domain) => data.results[domain] ?? null,
    resolveToken: (token) => data.tokens[token] ?? null,
    recordView: (token) => {
      if (!data.tokens[token]) return;
      data.views[token] = (data.views[token] ?? 0) + 1;
      persist(data);
    },
    getViews: (domain) => {
      const counts: Record<ExecRole, number> = { CEO: 0, COO: 0, CFO: 0 };
      for (const [token, record] of Object.entries(data.tokens)) {
        if (record.domain === domain) counts[record.role] += data.views[token] ?? 0;
      }
      return counts;
    },
    addDoNotContact: (email) => {
      const normalized = email.trim().toLowerCase();
      if (normalized && !data.doNotContact.includes(normalized)) {
        data.doNotContact.push(normalized);
        persist(data);
      }
    },
    isDoNotContact: (email) => data.doNotContact.includes(email.trim().toLowerCase()),
  };
};

const globalStore = globalThis as typeof globalThis & { __velhoOutreachStore?: OutreachStore };

/** Process-wide singleton (survives Next.js hot reloads in dev). */
export const getOutreachStore = (): OutreachStore => {
  globalStore.__velhoOutreachStore ??= createFileStore();
  return globalStore.__velhoOutreachStore;
};
