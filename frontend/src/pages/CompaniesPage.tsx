import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { FLOORS } from "../data/floors";

// ── Design tokens ────────────────────────────────────────────────
const C = {
  bg:        "#0b1220",
  panel:     "#0f172a",
  card:      "#1e293b",
  border:    "#334155",
  borderSub: "#1f2a3d",
  text:      "#f1f5f9",
  muted:     "#94a3b8",
  dim:       "#64748b",
  accent:    "#38bdf8",
  ok:        "#4ade80",
  warn:      "#facc15",
  danger:    "#f87171",
};

interface CompanyRow {
  id: number;
  name: string;
  floor_id: number | null;
  office_id: string | null;
  co2_device_id: string | null;
  temp_device_id: string | null;
  created_at: string;
}

interface DeviceInfo {
  device_id: string;
  friendly_name: string | null;
  company_id: number | null;
  metrics: string[];
}

// ── Mini SVG floor picker ─────────────────────────────────────────
const VB_W = 1280;
const VB_H = 600;
const HULL_PATH = `M 70 26 Q 270 14, 800 18 Q 1100 32, 1238 300 Q 1100 568, 800 582 Q 270 586, 70 574 Z`;

function MiniFloorPicker({ floorId, selectedOfficeId, takenOfficeIds, onChange }: {
  floorId: number;
  selectedOfficeId: string | null;
  takenOfficeIds: Set<string>;
  onChange: (officeId: string) => void;
}) {
  const { t } = useTranslation();
  const [hov, setHov] = useState<string | null>(null);
  const floor = FLOORS.find(f => f.id === floorId)!;
  const px = (p: number) => (p / 100) * VB_W;
  const py = (p: number) => (p / 100) * VB_H;

  return (
    <div style={{
      position: "relative", width: "100%",
      aspectRatio: `${VB_W} / ${VB_H}`,
      background: "linear-gradient(180deg, #131c2e 0%, #0e1626 100%)",
      borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden",
    }}>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%", display: "block" }}>
        <defs>
          <pattern id="pg" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke={C.border} strokeWidth="0.3" opacity="0.2"/>
          </pattern>
          <clipPath id="hc"><path d={HULL_PATH}/></clipPath>
        </defs>
        <rect width={VB_W} height={VB_H} fill="url(#pg)"/>
        <path d={HULL_PATH} fill={C.panel} stroke={C.border} strokeWidth="2" strokeLinejoin="round"/>
        {/* Central core minimal */}
        <rect x="480" y="240" width="150" height="135" fill={C.bg} stroke={C.border} strokeWidth="1"/>
        <rect x="880" y="240" width="170" height="135" fill={C.bg} stroke={C.border} strokeWidth="1"/>
        <ellipse cx="755" cy="305" rx="85" ry="58" stroke={C.border} fill="none" strokeDasharray="6 5"/>
        <g clipPath="url(#hc)">
          {floor.offices.map(o => {
            const x = px(o.x), y = py(o.y), w = px(o.w), h = py(o.h);
            const isSelected = selectedOfficeId === o.id;
            const isTaken = takenOfficeIds.has(o.id);
            const isHov = hov === o.id;
            const fill = isSelected ? `${C.accent}33`
              : isTaken ? `${C.warn}15`
              : isHov ? `${C.card}ee`
              : C.card;
            const stroke = isSelected ? C.accent
              : isTaken ? `${C.warn}66`
              : isHov ? C.muted
              : C.border;
            return (
              <g key={o.id}
                style={{ cursor: isTaken && !isSelected ? "not-allowed" : "pointer" }}
                onClick={() => { if (!isTaken || isSelected) onChange(o.id); }}
                onMouseEnter={() => setHov(o.id)}
                onMouseLeave={() => setHov(null)}>
                <rect x={x} y={y} width={w} height={h} rx="5"
                  fill={fill} stroke={stroke} strokeWidth={isSelected ? 2 : 1.2}
                  style={{ transition: "fill 100ms, stroke 100ms" }}/>
                {isSelected && w > 60 && h > 28 && (
                  <text x={x + w/2} y={y + h/2} textAnchor="middle" dominantBaseline="middle"
                    fontSize={Math.min(10, w/9)} fill={C.accent} fontWeight="700"
                    style={{ pointerEvents: "none" }}>✓</text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {/* Hover tooltip */}
      {hov && (
        <div style={{
          position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
          background: "#0b1220", border: `1px solid ${C.border}`,
          borderRadius: 6, padding: "4px 10px", fontSize: 11.5, color: C.text,
          fontWeight: 600, pointerEvents: "none", whiteSpace: "nowrap",
        }}>
          {floor.offices.find(o => o.id === hov)?.name}
          {takenOfficeIds.has(hov) && !selectedOfficeId?.includes(hov) && (
            <span style={{ color: C.warn, marginLeft: 6 }}>· {t("companies.occupied")}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Form state ────────────────────────────────────────────────────
interface FormState {
  name: string;
  floorId: number | null;
  officeId: string | null;
  co2DeviceId: string | null;
  tempDeviceId: string | null;
  pickingOnMap: boolean;
}

const emptyForm = (): FormState => ({ name: "", floorId: 1, officeId: null, co2DeviceId: null, tempDeviceId: null, pickingOnMap: false });

// ── Company modal ─────────────────────────────────────────────────
function CompanyModal({ title, form, setForm, takenOfficeIds, companyDevices, onCancel, onSubmit }: {
  title: string;
  form: FormState;
  setForm: (updater: FormState | ((prev: FormState) => FormState)) => void;
  takenOfficeIds: Set<string>;
  companyDevices: DeviceInfo[];
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  // local floor tab — starts at form.floorId or 1
  const [mapFloor, setMapFloor] = useState<number>(form.floorId ?? 1);

  const selectedOffice = useMemo(() => {
    if (!form.floorId || !form.officeId) return null;
    return FLOORS.find(f => f.id === form.floorId)?.offices.find(o => o.id === form.officeId) ?? null;
  }, [form.floorId, form.officeId]);

  const handleOfficeSelect = (officeId: string) => {
    setForm(f => ({ ...f, floorId: mapFloor, officeId: f.officeId === officeId ? null : officeId }));
  };

  const handleFloorTab = (fid: number) => {
    setMapFloor(fid);
    // clear office if it belongs to a different floor
    setForm(f => ({ ...f, floorId: fid, officeId: f.floorId === fid ? f.officeId : null }));
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(3,8,18,0.85)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      zIndex: 50, padding: "32px 16px", overflowY: "auto",
    }}>
      <div style={{
        background: C.card, borderRadius: 16, padding: 24,
        width: "100%", maxWidth: 820,
        border: `1px solid ${C.border}`, boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
      }}>
        <h2 style={{ margin: "0 0 18px", fontSize: 18, color: C.text }}>{title}</h2>

        {/* Name */}
        <label style={lbl}>
          {t("companies.companyName")}
          <input style={inp} value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            autoFocus />
        </label>

        {/* Map section */}
        <div style={{ marginTop: 18 }}>
          {/* Floor tabs + selection label */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {t("companies.floor")}
            </span>
            <div style={{ display: "flex", gap: 3, padding: 3, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 7 }}>
              {FLOORS.map(f => {
                const active = mapFloor === f.id;
                return (
                  <button key={f.id} type="button" onClick={() => handleFloorTab(f.id)} style={{
                    padding: "5px 12px", fontSize: 12, fontWeight: 600,
                    background: active ? C.accent : "transparent",
                    color: active ? "#06222e" : C.muted,
                    border: "none", borderRadius: 5, cursor: "pointer",
                    fontFamily: "inherit", transition: "all 100ms",
                  }}>F{f.id}</button>
                );
              })}
            </div>

            {/* Selected office badge */}
            {selectedOffice ? (
              <div style={{
                marginLeft: "auto", display: "flex", alignItems: "center", gap: 6,
                padding: "5px 12px", borderRadius: 8,
                background: `${C.accent}18`, border: `1px solid ${C.accent}44`,
                fontSize: 12.5, color: C.accent, fontWeight: 600,
              }}>
                📍 {FLOORS.find(f => f.id === form.floorId)?.label} · {selectedOffice.name}
                <button type="button" onClick={() => setForm(f => ({ ...f, officeId: null }))}
                  style={{ background: "transparent", border: "none", color: C.accent, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 2 }}>×</button>
              </div>
            ) : (
              <span style={{ marginLeft: "auto", fontSize: 12, color: C.dim }}>
                {t("companies.clickToSelect")}
              </span>
            )}
          </div>

          {/* Map */}
          <MiniFloorPicker
            floorId={mapFloor}
            selectedOfficeId={form.floorId === mapFloor ? form.officeId : null}
            takenOfficeIds={takenOfficeIds}
            onChange={handleOfficeSelect}
          />
        </div>

        {/* Device roles — only shown when devices are assigned */}
        {companyDevices.length > 0 && (
          <div style={{ marginTop: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ ...lbl, flex: "1 1 200px" }}>
              🌿 CO₂ устройство
              <select style={{ ...inp, marginTop: 6 }}
                value={form.co2DeviceId ?? ""}
                onChange={e => setForm(f => ({ ...f, co2DeviceId: e.target.value || null }))}>
                <option value="">— авто</option>
                {companyDevices.map(d => (
                  <option key={d.device_id} value={d.device_id}>
                    {d.friendly_name || d.device_id}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ ...lbl, flex: "1 1 200px" }}>
              🌡️ Температура / влажность
              <select style={{ ...inp, marginTop: 6 }}
                value={form.tempDeviceId ?? ""}
                onChange={e => setForm(f => ({ ...f, tempDeviceId: e.target.value || null }))}>
                <option value="">— авто</option>
                {companyDevices.map(d => (
                  <option key={d.device_id} value={d.device_id}>
                    {d.friendly_name || d.device_id}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <button type="button" style={btnGhost} onClick={onCancel}>{t("common.cancel")}</button>
          <button type="button" style={btnPrimary} onClick={onSubmit} disabled={!form.name.trim()}>
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────
export default function CompaniesPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [addForm, setAddForm] = useState<FormState | null>(null);
  const [editForm, setEditForm] = useState<{ id: number; form: FormState } | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Filter
  const [filterFloor, setFilterFloor] = useState<number | "all">("all");

  const refresh = useCallback(async () => {
    const [cr, dr] = await Promise.all([apiFetch("/companies"), apiFetch("/devices")]);
    if (!cr.ok) { setLoadError(t("companies.loadError")); return; }
    setLoadError(null);
    setRows(await cr.json());
    if (dr.ok) setDevices(await dr.json());
  }, [t]);

  useEffect(() => { refresh(); }, [refresh]);

  // Set of office_ids already taken (for the picker)
  const takenOfficeIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.office_id) s.add(r.office_id);
    return s;
  }, [rows]);

  // Taken office ids excluding the one being edited
  const takenExcludingEdit = useMemo(() => {
    const s = new Set(takenOfficeIds);
    if (editForm) {
      const current = rows.find(r => r.id === editForm.id)?.office_id;
      if (current) s.delete(current);
    }
    return s;
  }, [takenOfficeIds, editForm, rows]);

  const submitAdd = async () => {
    if (!addForm) return;
    const res = await apiFetch("/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: addForm.name.trim(), floor_id: addForm.floorId, office_id: addForm.officeId }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { detail?: string };
      alert(typeof d.detail === "string" ? d.detail : t("common.error"));
      return;
    }
    setAddForm(null);
    refresh();
  };

  const submitEdit = async () => {
    if (!editForm) return;
    const res = await apiFetch(`/companies/${editForm.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.form.name.trim(),
        floor_id: editForm.form.floorId,
        office_id: editForm.form.officeId,
        co2_device_id: editForm.form.co2DeviceId,
        temp_device_id: editForm.form.tempDeviceId,
      }),
    });
    if (!res.ok) { alert(t("common.error")); return; }
    setEditForm(null);
    refresh();
  };

  const confirmDelete = async () => {
    if (deleteId === null) return;
    const res = await apiFetch(`/companies/${deleteId}`, { method: "DELETE" });
    if (!res.ok) { alert(t("common.error")); return; }
    setDeleteId(null);
    refresh();
  };

  const floorLabel = (fid: number | null) => {
    if (!fid) return "—";
    const f = FLOORS.find(x => x.id === fid);
    return f ? f.label : String(fid);
  };

  const officeLabel = (oid: string | null, fid: number | null) => {
    if (!oid || !fid) return "—";
    const f = FLOORS.find(x => x.id === fid);
    return f?.offices.find(o => o.id === oid)?.name ?? oid;
  };

  const displayed = filterFloor === "all"
    ? rows
    : rows.filter(r => r.floor_id === filterFloor);

  return (
    <div style={{ padding: "28px 32px 48px", maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text }}>{t("companies.title")}</h1>
          <p style={{ color: C.dim, fontSize: 14, margin: "4px 0 0" }}>
            {t("companies.subtitle")}
          </p>
        </div>
        <button type="button" onClick={() => setAddForm(emptyForm())} style={btnPrimary}>
          + {t("companies.addCompany")}
        </button>
      </div>

      {loadError && <p style={{ color: C.danger }}>{loadError}</p>}

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: C.muted }}>{t("companies.floor")}</span>
        <div style={{ display: "flex", gap: 4, padding: 4, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <TabBtn active={filterFloor === "all"} onClick={() => setFilterFloor("all")}>{t("common.all")}</TabBtn>
          {FLOORS.map(f => (
            <TabBtn key={f.id} active={filterFloor === f.id} onClick={() => setFilterFloor(f.id)}>
              F{f.id}
            </TabBtn>
          ))}
        </div>
        <span style={{ fontSize: 12, color: C.dim }}>
          {displayed.length} {displayed.length === 1 ? t("companies.companies_1", { count: 1 }).split(" ")[1] : t("companies.companies_2", { count: displayed.length }).split(" ").slice(1).join(" ")}
        </span>
      </div>

      {/* Table */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: C.panel }}>
              <th style={th}>{t("companies.companyName")}</th>
              <th style={th}>{t("companies.floor")}</th>
              <th style={th}>{t("companies.office")}</th>
              <th style={th}>{t("common.created")}</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: "32px", textAlign: "center", color: C.dim }}>
                  {t("companies.noCompanies")}
                </td>
              </tr>
            )}
            {displayed.map((c, i) => (
              <tr key={c.id} style={{ borderTop: `1px solid ${C.borderSub}`, background: i % 2 === 0 ? "transparent" : `${C.panel}55` }}>
                <td style={td}>
                  <div style={{ fontWeight: 600, color: C.text }}>{c.name}</div>
                </td>
                <td style={td}>
                  {c.floor_id ? (
                    <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: `${C.accent}18`, color: C.accent }}>
                      {floorLabel(c.floor_id)}
                    </span>
                  ) : <span style={{ color: C.dim }}>—</span>}
                </td>
                <td style={td}>
                  <span style={{ color: c.office_id ? C.text : C.dim, fontSize: 13 }}>
                    {officeLabel(c.office_id, c.floor_id)}
                  </span>
                </td>
                <td style={{ ...td, color: C.dim, fontSize: 12 }}>
                  {new Date(c.created_at).toLocaleDateString()}
                </td>
                <td style={{ ...td, textAlign: "right" }}>
                  <button type="button" style={btnGhost} onClick={() => setEditForm({
                    id: c.id,
                    form: { name: c.name, floorId: c.floor_id, officeId: c.office_id, co2DeviceId: c.co2_device_id, tempDeviceId: c.temp_device_id, pickingOnMap: false },
                  })}>{t("common.edit")}</button>
                  <button type="button" style={{ ...btnGhost, marginLeft: 6, color: C.danger, borderColor: `${C.danger}44` }}
                    onClick={() => setDeleteId(c.id)}>{t("common.delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add modal */}
      {addForm && (
        <CompanyModal
          title={t("companies.addCompany")}
          form={addForm}
          setForm={f => setAddForm(prev => prev === null ? null : typeof f === "function" ? f(prev) : f)}
          takenOfficeIds={takenOfficeIds}
          companyDevices={[]}
          onCancel={() => setAddForm(null)}
          onSubmit={submitAdd}
        />
      )}

      {/* Edit modal */}
      {editForm && (
        <CompanyModal
          title={t("companies.editCompany")}
          form={editForm.form}
          setForm={f => setEditForm(prev => {
            if (!prev) return prev;
            const nextForm = typeof f === "function" ? f(prev.form) : f;
            return { ...prev, form: nextForm };
          })}
          takenOfficeIds={takenExcludingEdit}
          companyDevices={devices.filter(d => d.company_id === editForm.id)}
          onCancel={() => setEditForm(null)}
          onSubmit={submitEdit}
        />
      )}

      {/* Delete confirm */}
      {deleteId !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: C.card, borderRadius: 14, padding: 28, maxWidth: 380, width: "100%", border: `1px solid ${C.border}` }}>
            <h2 style={{ marginTop: 0, color: C.text }}>{t("companies.deleteTitle")}</h2>
            <p style={{ color: C.muted, fontSize: 14 }}>{t("companies.deleteBody")}</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" style={btnGhost} onClick={() => setDeleteId(null)}>{t("common.cancel")}</button>
              <button type="button" style={{ ...btnGhost, background: "#dc2626", border: "none", color: "#fff" }} onClick={confirmDelete}>{t("common.delete")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: "6px 12px", fontSize: 13, fontWeight: 600,
      background: active ? C.accent : "transparent",
      color: active ? "#06222e" : C.muted,
      border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", transition: "all 120ms",
    }}>{children}</button>
  );
}

const th: React.CSSProperties = {
  padding: "12px 14px", fontWeight: 600, fontSize: 12,
  textAlign: "left", color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em",
};
const td: React.CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };
const btnPrimary: React.CSSProperties = {
  padding: "9px 18px", borderRadius: 8, border: "none",
  background: "#3b82f6", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14,
  fontFamily: "inherit",
};
const btnGhost: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.border}`,
  background: "transparent", color: C.muted, cursor: "pointer", fontSize: 13, fontFamily: "inherit",
};
const lbl: React.CSSProperties = { display: "block", fontSize: 13, color: C.muted, fontWeight: 600 };
const inp: React.CSSProperties = {
  display: "block", width: "100%", marginTop: 6, boxSizing: "border-box",
  padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`,
  background: C.panel, color: C.text, fontSize: 14, fontFamily: "inherit",
};
