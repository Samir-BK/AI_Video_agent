"use client";

import { useState } from "react";

import EmailCard from "@/app/outreach/components/EmailCard";
import type { ExecRole, LeaderProfile, RoleEmail } from "@/types/outreach";

interface RoleSwitcherProps {
  emails: RoleEmail[];
  leaders: LeaderProfile[];
}

const ROLES: ExecRole[] = ["CEO", "COO", "CFO"];

/**
 * CEO / COO / CFO tabs. Roles without an email explain why: either the
 * leader was not found (and the angle is folded into the CEO email) or there
 * was not enough verified information to write at all.
 */
export default function RoleSwitcher({ emails, leaders }: RoleSwitcherProps) {
  const [active, setActive] = useState<ExecRole>(emails[0]?.role ?? "CEO");
  const current = emails.find((email) => email.role === active);
  const foldedInto = emails.find((email) => email.mergedRoles.includes(active));
  const leader = leaders.find((l) => l.role === active);

  return (
    <div className="space-y-3">
      <div className="flex gap-2" role="tablist">
        {ROLES.map((role) => {
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
              {role}
            </button>
          );
        })}
      </div>

      {current ? (
        <EmailCard email={current} />
      ) : (
        <p className="rounded-2xl border border-velho-line bg-velho-panel p-5 text-sm text-zinc-300">
          {foldedInto
            ? leader?.name
              ? `${leader.name} (${leader.title}) was found, but the evidence is limited, so the ${active} angle is folded into the ${foldedInto.role} email.`
              : `No ${active} found on public sources — this angle is folded into the ${foldedInto.role} email.`
            : leader?.name
              ? `${leader.name} (${leader.title}) was found, but there was not enough verified information to write a separate ${active} email.`
              : `No ${active} email: not enough verified information about this role.`}
        </p>
      )}
    </div>
  );
}
