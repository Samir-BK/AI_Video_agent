import "server-only";

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecRole, OutreachResult, RoleEmail, RoleEmailStatus } from "@/types/outreach";

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
  /** Every stored run, newest first (read-only; used by history search). */
  listResults: () => OutreachResult[];
  resolveToken: (token: string) => TokenRecord | null;
  /** The stored email (and its result) behind a token. */
  getEmailByToken: (token: string) => { result: OutreachResult; email: RoleEmail } | null;
  setEmailStatus: (token: string, status: RoleEmailStatus) => void;
  recordView: (token: string) => void;
  getViews: (domain: string) => Record<ExecRole, number>;
  /** Opt out by address, or by token when the address is unknown. */
  addDoNotContact: (key: string) => void;
  isDoNotContact: (key: string) => boolean;
  /** Emails sent today (UTC) from the configured inbox. */
  sentToday: () => number;
  recordSend: () => void;
}

interface StoreData {
  results: Record<string, OutreachResult>;
  tokens: Record<string, TokenRecord>;
  views: Record<string, number>;
  doNotContact: string[];
  sends: Record<string, number>;
}

const FILE_DIR = join(tmpdir(), "velho-outreach");
const FILE_PATH = join(FILE_DIR, "store.json");
const MAX_RESULTS = 200;

const emptyData = (): StoreData => ({
  results: {},
  tokens: {},
  views: {},
  doNotContact: [],
  sends: {},
});

const todayKey = (): string => new Date().toISOString().slice(0, 10);

/** Token keys are stored with a prefix so they never collide with addresses. */
export const tokenKey = (token: string): string => `token:${token}`;

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
    listResults: () =>
      Object.values(data.results).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    resolveToken: (token) => data.tokens[token] ?? null,
    getEmailByToken: (token) => {
      const record = data.tokens[token];
      const result = record ? data.results[record.domain] : undefined;
      const email = result?.emails.find((e) => e.token === token);
      return result && email ? { result, email } : null;
    },
    setEmailStatus: (token, status) => {
      const record = data.tokens[token];
      const email = record
        ? data.results[record.domain]?.emails.find((e) => e.token === token)
        : undefined;
      if (email) {
        email.status = status;
        persist(data);
      }
    },
    sentToday: () => data.sends[todayKey()] ?? 0,
    recordSend: () => {
      const key = todayKey();
      data.sends[key] = (data.sends[key] ?? 0) + 1;
      persist(data);
    },
    recordView: (token) => {
      if (!data.tokens[token]) return;
      data.views[token] = (data.views[token] ?? 0) + 1;
      persist(data);
    },
    getViews: (domain) => {
      // Only the current generation's links count (older runs are history).
      const counts: Record<ExecRole, number> = { CEO: 0, COO: 0, CFO: 0 };
      for (const email of data.results[domain]?.emails ?? []) {
        counts[email.role] += data.views[email.token] ?? 0;
      }
      return counts;
    },
    addDoNotContact: (key) => {
      const normalized = key.trim().toLowerCase();
      if (normalized && !data.doNotContact.includes(normalized)) {
        data.doNotContact.push(normalized);
        persist(data);
      }
    },
    isDoNotContact: (key) => data.doNotContact.includes(key.trim().toLowerCase()),
  };
};

const globalStore = globalThis as typeof globalThis & { __velhoOutreachStore?: OutreachStore };

/** Process-wide singleton (survives Next.js hot reloads in dev). */
export const getOutreachStore = (): OutreachStore => {
  globalStore.__velhoOutreachStore ??= createFileStore();
  return globalStore.__velhoOutreachStore;
};
