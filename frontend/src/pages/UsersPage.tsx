import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";

interface UserRow {
  id: number;
  email: string;
  created_at: string;
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [pwdUserId, setPwdUserId] = useState<number | null>(null);
  const [pwdValue, setPwdValue] = useState("");

  const [deleteId, setDeleteId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const res = await apiFetch("/users");
    if (!res.ok) {
      setLoadError("Could not load users");
      return;
    }
    setLoadError(null);
    setRows(await res.json());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submitAdd = async () => {
    const res = await apiFetch("/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail, password: newPassword }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { detail?: string };
      alert(typeof d.detail === "string" ? d.detail : "Create failed");
      return;
    }
    setAddOpen(false);
    setNewEmail("");
    setNewPassword("");
    refresh();
  };

  const submitPwd = async () => {
    if (pwdUserId === null) return;
    const res = await apiFetch(`/users/${pwdUserId}/password`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: pwdValue }),
    });
    if (!res.ok) {
      alert("Could not update password");
      return;
    }
    setPwdUserId(null);
    setPwdValue("");
  };

  const confirmDelete = async () => {
    if (deleteId === null) return;
    const res = await apiFetch(`/users/${deleteId}`, { method: "DELETE" });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { detail?: string };
      alert(typeof d.detail === "string" ? d.detail : "Delete failed");
      return;
    }
    setDeleteId(null);
    refresh();
  };

  const modalBackdrop: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
    padding: 16,
  };

  const modalBox: React.CSSProperties = {
    background: "#1e293b",
    borderRadius: 14,
    padding: 24,
    maxWidth: 400,
    width: "100%",
    border: "1px solid #334155",
  };

  return (
    <div style={{ padding: "24px 28px 48px", maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Users</h1>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          style={btnPrimary}
        >
          Add user
        </button>
      </div>
      <p style={{ color: "#64748b", fontSize: 14 }}>Manage dashboard accounts.</p>

      {loadError && <p style={{ color: "#f87171" }}>{loadError}</p>}

      <div style={{ overflowX: "auto", marginTop: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#94a3b8" }}>
              <th style={th}>Email</th>
              <th style={th}>Created</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} style={{ borderTop: "1px solid #334155" }}>
                <td style={td}>{u.email}</td>
                <td style={td}>{new Date(u.created_at).toLocaleString()}</td>
                <td style={td}>
                  <button type="button" style={btnGhost} onClick={() => setPwdUserId(u.id)}>
                    Change password
                  </button>
                  <button
                    type="button"
                    style={{
                      ...btnGhost,
                      opacity: u.id === currentUser?.id ? 0.35 : 1,
                      cursor: u.id === currentUser?.id ? "not-allowed" : "pointer",
                    }}
                    disabled={u.id === currentUser?.id}
                    onClick={() => setDeleteId(u.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {addOpen && (
        <div style={modalBackdrop}>
          <div style={modalBox}>
            <h2 style={{ marginTop: 0 }}>Add user</h2>
            <label style={lbl}>
              Email
              <input
                style={inp}
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </label>
            <label style={lbl}>
              Password
              <input
                style={inp}
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" style={btnGhost} onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button type="button" style={btnPrimary} onClick={submitAdd}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {pwdUserId !== null && (
        <div style={modalBackdrop}>
          <div style={modalBox}>
            <h2 style={{ marginTop: 0 }}>New password</h2>
            <label style={lbl}>
              Password
              <input
                style={inp}
                type="password"
                value={pwdValue}
                onChange={(e) => setPwdValue(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" style={btnGhost} onClick={() => setPwdUserId(null)}>
                Cancel
              </button>
              <button type="button" style={btnPrimary} onClick={submitPwd}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div style={modalBackdrop}>
          <div style={modalBox}>
            <h2 style={{ marginTop: 0 }}>Delete user?</h2>
            <p style={{ color: "#94a3b8" }}>This cannot be undone.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" style={btnGhost} onClick={() => setDeleteId(null)}>
                Cancel
              </button>
              <button type="button" style={{ ...btnPrimary, background: "#dc2626" }} onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "12px 8px", verticalAlign: "middle" };
const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: "#3b82f6",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "6px 10px",
  marginRight: 8,
  borderRadius: 8,
  border: "1px solid #475569",
  background: "transparent",
  color: "#e2e8f0",
  cursor: "pointer",
};
const lbl: React.CSSProperties = { display: "block", marginBottom: 12, fontSize: 13, color: "#94a3b8" };
const inp: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 6,
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #475569",
  background: "#0f172a",
  color: "#f1f5f9",
};
