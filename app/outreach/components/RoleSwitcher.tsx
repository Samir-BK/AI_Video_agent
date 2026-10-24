"use client";

import { useState } from "react";

import EmailCard from "@/app/outreach/components/EmailCard";
import type { ExecRole, LeaderProfile, RoleEmail, RoleEmailStatus } from "@/types/outreach";
import { CORE_ROLES, EXEC_ROLES, ROLE_LABELS } from "@/types/outreach";

interface RoleSwitcherProps {
  emails: RoleEmail[];
  leaders: LeaderProfile[];
  views: Record<ExecRole, number>;
  statuses: Record<string, RoleEmailStatus>;
  adminSecret: string;
  onStatus: (token: string, status: RoleEmailStatus) => void;
}

/**
 * One tab per role: CEO / COO / CFO always, CTO / Sales / HR / Service only
 * when a person was found or an email was written for them. Roles without an email explain why: either the
 * leader was not found (and the angle is folded into the CEO email) or there
 * was not enough verified information to write at all.
 */
export default function RoleSwitcher({
  emails,
  leaders,
  views,
  statuses,
  adminSecret,
  onStatus,
}: RoleSwitcherProps) {
  const [active, setActive] = useState<ExecRole>(emails[0]?.role ?? "CEO");
  const current = emails.find((email) => email.role === active);
  const foldedInto = emails.find((email) => email.mergedRoles.includes(active));
  const leader = leaders.find((l) => l.role === active);
  const roles = EXEC_ROLES.filter(
    (role) =>
      CORE_ROLES.includes(role) ||
      emails.some((email) => email.role === role) ||
      leaders.some((l) => l.role === role && l.name),
  );
  const label = ROLE_LABELS[active];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="tablist">
        {roles.map((role) => {
          const has = emails.some((email) => email.role === role);
          return (
            <button
              key={role}
              type="button"
              role="tab"
              aria-selected={active === role}
              onClick={() => setActive(role)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                active === role
                  ? "bg-sky-500 text-white"
                  : has
                    ? "border border-velho-line text-zinc-200 hover:bg-velho-ink"
                    : "border border-dashed border-velho-line text-velho-muted hover:bg-velho-ink"
              }`}
            >
              {ROLE_LABELS[role]}
            </button>
          );
        })}
      </div>

      {current ? (
        <EmailCard
          email={current}
          status={statuses[current.token] ?? current.status}
          views={views[current.role] ?? 0}
          adminSecret={adminSecret}
          onStatus={onStatus}
        />
      ) : (
        <p className="rounded-2xl border border-velho-line bg-velho-panel p-5 text-sm text-zinc-300">
          {foldedInto
            ? leader?.name
              ? `${leader.name} (${leader.title}) was found, but the evidence is limited, so the ${label} angle is folded into the ${ROLE_LABELS[foldedInto.role]} email.`
              : `No ${label} found on public sources — this angle is folded into the ${ROLE_LABELS[foldedInto.role]} email.`
            : leader?.name
              ? `${leader.name} (${leader.title}) was found, but there was not enough verified information to write a separate ${label} email.`
              : `No ${label} email: not enough verified information about this role.`}
        </p>
      )}
    </div>
  );
}
