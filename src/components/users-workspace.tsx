"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, Link2, Search, Shield, UserCog, Users } from "lucide-react";
import { deactivateUserAction, saveUserMappingAction } from "@/app/actions";
import { initials } from "@/lib/format";
import type { DashboardData, RepPerformance, UserRole } from "@/lib/types";

export function UsersWorkspace({ data }: { data: DashboardData }) {
  const [selectedId, setSelectedId] = useState(data.reps[0]?.id || "");
  const [query, setQuery] = useState("");
  const [mappingFilter, setMappingFilter] = useState<"all" | "needs_close" | "mapped">("all");
  const filteredReps = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.reps.filter((rep, index) => {
      const state = index % 3 === 0 ? "needs_close" : "mapped";
      const matchesQuery = !normalized || rep.name.toLowerCase().includes(normalized) || rep.email.toLowerCase().includes(normalized);
      const matchesState = mappingFilter === "all" || mappingFilter === state;
      return matchesQuery && matchesState;
    });
  }, [data.reps, mappingFilter, query]);
  const selected = useMemo(() => data.reps.find((rep) => rep.id === selectedId) || filteredReps[0] || data.reps[0], [data.reps, filteredReps, selectedId]);

  return (
    <section className="users-workspace">
      <div className="card access-hero accent-admin">
        <div>
          <div className="eyebrow">Access control</div>
          <h2>Map identity, Close ownership, and manager visibility</h2>
          <p className="muted">
            Neon Auth proves who logged in. These mappings decide what role they have, which Close user they represent, and
            who can review their coaching.
          </p>
        </div>
        <div className="access-stats">
          <span className="status-pill">
            <Users size={15} />
            {data.reps.length} reps
          </span>
          <span className="status-pill">
            <Shield size={15} />
            DB roles
          </span>
        </div>
      </div>

      <div className="users-grid">
        <div className="card panel accent-admin">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Users</div>
              <h2>Rep mapping queue</h2>
            </div>
            <span className="badge amber">Needs Close IDs</span>
          </div>
          <div className="call-toolbar inline-toolbar">
            <label className="search-field">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users" aria-label="Search users" />
            </label>
            <select className="input" value={mappingFilter} onChange={(event) => setMappingFilter(event.target.value as "all" | "needs_close" | "mapped")} aria-label="Filter users by mapping state">
              <option value="all">All mapping states</option>
              <option value="needs_close">Needs Close ID</option>
              <option value="mapped">Mapped</option>
            </select>
          </div>
          <div className="user-row-list">
            {filteredReps.map((rep, index) => {
              const state = index % 3 === 0 ? "Needs Close ID" : "Mapped";
              return (
              <button key={rep.id} className={`user-map-row ${selected?.id === rep.id ? "selected" : ""}`} type="button" onClick={() => setSelectedId(rep.id)}>
                <span className="avatar">{initials(rep.name)}</span>
                <span>
                  <strong>{rep.name}</strong>
                  <small>{rep.email}</small>
                </span>
                <span className="badge admin">rep</span>
                <span className={state === "Mapped" ? "badge good" : "badge amber"}>{state}</span>
                <span className="muted">{rep.calls} calls</span>
              </button>
            );})}
            {!filteredReps.length ? (
              <div className="action-item state-risk">
                <strong>No users match these filters</strong>
                <p className="muted" style={{ marginTop: 6 }}>Clear search or mapping state filters to restore the queue.</p>
              </div>
            ) : null}
          </div>
        </div>

        {selected ? <UserDetail rep={selected} currentUserId={data.currentUser.id} /> : null}
      </div>
    </section>
  );
}

function UserDetail({ rep, currentUserId }: { rep: RepPerformance; currentUserId: string }) {
  const [isPending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("No unsaved changes");
  const [role, setRole] = useState<UserRole>("rep");
  const [closeUserId, setCloseUserId] = useState(rep.closeUserId || "");
  const [managerUserId, setManagerUserId] = useState(currentUserId);

  function saveMapping() {
    startTransition(async () => {
      const result = await saveUserMappingAction({
        userId: rep.id,
        role,
        closeUserId,
        managerUserId: role === "rep" ? managerUserId : null
      });
      setMessage(result.message);
      if (result.ok) setDirty(false);
    });
  }

  function deactivate() {
    startTransition(async () => {
      const result = await deactivateUserAction(rep.id);
      setMessage(result.message);
      if (result.ok) setDirty(false);
    });
  }

  return (
    <div className="card panel accent-admin">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Selected user</div>
          <h2>{rep.name}</h2>
          <p className="muted" style={{ marginTop: 6 }}>{dirty ? "Unsaved role or manager changes" : "Mapped to OAuth identity and manager visibility"}</p>
        </div>
        <span className="avatar">{initials(rep.name)}</span>
      </div>

      <div className="settings-form-grid">
        <label>
          <span className="metric-label">Email</span>
          <input className="input" value={rep.email} readOnly />
        </label>
        <label>
          <span className="metric-label">Role</span>
          <select
            className="input"
            value={role}
            aria-label="Role"
            onChange={(event) => {
              setRole(event.target.value as UserRole);
              setDirty(true);
              setMessage("Role change pending.");
            }}
          >
            <option value="rep">rep</option>
            <option value="manager">manager</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label>
          <span className="metric-label">Close user ID</span>
          <input
            className="input"
            value={closeUserId}
            placeholder="user_xxx from Close"
            onChange={(event) => {
              setCloseUserId(event.target.value);
              setDirty(true);
              setMessage("Close ID change pending.");
            }}
          />
        </label>
        <label>
          <span className="metric-label">Assigned manager</span>
          <select
            className="input"
            value={managerUserId}
            aria-label="Assigned manager"
            onChange={(event) => {
              setManagerUserId(event.target.value);
              setDirty(true);
              setMessage("Manager assignment pending.");
            }}
          >
            <option value={currentUserId}>Current manager/admin</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
      </div>

      <div className="mapping-checklist">
        <span className={dirty ? "check-item warn" : "check-item"}>
          <Shield size={14} />
          {dirty ? "Unsaved changes pending" : message}
        </span>
        <span className="check-item">
          <CheckCircle2 size={14} />
          OAuth user row exists
        </span>
        <span className="check-item warn">
          <Link2 size={14} />
          {closeUserId ? "Close user mapped" : "Close user mapping pending"}
        </span>
        <span className="check-item">
          <UserCog size={14} />
          Manager visibility assigned
        </span>
      </div>

      <div className="detail-actions">
        <button className="button" type="button" disabled={isPending || !dirty} onClick={saveMapping}>
          {isPending ? "Saving..." : dirty ? "Save mapping" : "Mapping saved"}
        </button>
        <button className="button secondary" type="button" disabled={isPending} onClick={deactivate}>
          Deactivate
        </button>
      </div>
      <p className="status-note" role="status">{message}</p>
    </div>
  );
}
