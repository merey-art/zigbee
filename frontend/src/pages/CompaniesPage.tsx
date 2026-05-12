import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";

interface CompanyRow {
  id: number;
  name: string;
  created_at: string;
}

export default function CompaniesPage() {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const res = await apiFetch("/companies");
    if (!res.ok) {
      setLoadError("Could not load companies");
      return;
    }
    setLoadError(null);
    setRows(await res.json());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submitAdd = async () => {
    const res = await apiFetch("/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { detail?: string };
      alert(typeof d.detail === "string" ? d.detail : "Create failed");
      return;
    }
    setAddOpen(false);
    setNewName("");
    refresh();
  };

  const submitEdit = async () => {
    if (editId === null) return;
    const res = await apiFetch(`/companies/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName }),
    });
    if (!res.ok) {
      alert("Update failed");
      return;
    }
    setEditId(null);
    setEditName("");
    refresh();
  };

  const confirmDelete = async () => {
    if (deleteId === null) return;
    const res = await apiFetch(`/companies/${deleteId}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Delete failed");
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
    <div style={{ padding: "24px 28px 48px", maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Companies</h1>
        <button type="button" onClick={() => setAddOpen(true)} style={btnPrimary}>
          Add company
        </button>
      </div>
      <p style={{ color: "#64748b", fontSize: 14 }}>
        Group sensors by tenant when several companies share one building.
      </p>

      {loadError && <p style={{ color: "#f87171" }}>{loadError}</p>}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginTop: 16 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#94a3b8" }}>
            <th style={th}>Name</th>
            <th style={th}>Created</th>
            <th style={th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} style={{ borderTop: "1px solid #334155" }}>
              <td style={td}>{c.name}</td>
              <td style={td}>{new Date(c.created_at).toLocaleString()}</td>
              <td style={td}>
                <button
                  type="button"
                  style={btnGhost}
                  onClick={() => {
                    setEditId(c.id);
                    setEditName(c.name);
                  }}
                >
                  Rename
                </button>
                <button type="button" style={btnGhost} onClick={() => setDeleteId(c.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {addOpen && (
        <div style={modalBackdrop}>
          <div style={modalBox}>
            <h2 style={{ marginTop: 0 }}>New company</h2>
            <label style={lbl}>
              Name
              <input style={inp} value={newName} onChange={(e) => setNewName(e.target.value)} />
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

      {editId !== null && (
        <div style={modalBackdrop}>
          <div style={modalBox}>
            <h2 style={{ marginTop: 0 }}>Rename company</h2>
            <label style={lbl}>
              Name
              <input style={inp} value={editName} onChange={(e) => setEditName(e.target.value)} />
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" style={btnGhost} onClick={() => setEditId(null)}>
                Cancel
              </button>
              <button type="button" style={btnPrimary} onClick={submitEdit}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div style={modalBackdrop}>
          <div style={modalBox}>
            <h2 style={{ marginTop: 0 }}>Delete company?</h2>
            <p style={{ color: "#94a3b8" }}>Device assignments for this company will be removed.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" style={btnGhost} onClick={() => setDeleteId(null)}>
                Cancel
              </button>
              <button
                type="button"
                style={{ ...btnGhost, background: "#dc2626", border: "none" }}
                onClick={confirmDelete}
              >
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
