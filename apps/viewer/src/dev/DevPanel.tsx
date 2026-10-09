// Floating state switcher for the browser design preview. Dev tooling, so labels are not localized.
import { type CSSProperties, useState, useSyncExternalStore } from "react";

import { type ViewerState } from "../ipc";
import { previewStore } from "./mockDesktop";

const GROUPS: Array<{ label: string; states: ViewerState[] }> = [
  { label: "Archive", states: ["idle", "opening", "checking_metadata", "locked"] },
  { label: "Payment", states: ["payment_preparing", "payment_ready", "payment_pending", "awaiting_finality", "activating"] },
  { label: "Unlocked", states: ["unlocked", "refreshing"] },
  {
    label: "Failure",
    states: [
      "backend_unavailable",
      "refresh_required",
      "payment_expired",
      "payment_failed",
      "device_limit_reached",
      "license_revoked",
      "archive_blocked",
      "error",
    ],
  },
];

export function DevPanel() {
  const [open, setOpen] = useState(false);
  const current = useSyncExternalStore(previewStore.subscribe, () => previewStore.state);
  const autoFlow = useSyncExternalStore(previewStore.subscribe, () => previewStore.autoFlow);

  return (
    <div style={panel} data-dev-panel>
      <button type="button" style={toggle} onClick={() => setOpen(!open)}>
        {open ? "Hide preview states" : `Preview: ${current}`}
      </button>
      {open ? (
        <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
          {GROUPS.map((group) => (
            <div key={group.label}>
              <div style={heading}>{group.label}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {group.states.map((state) => (
                  <button
                    key={state}
                    type="button"
                    style={{ ...chip, ...(state === current ? chipActive : null) }}
                    onClick={() => { void previewStore.show(state); }}
                  >
                    {state}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={autoFlow} onChange={(event) => previewStore.setAutoFlow(event.target.checked)} />
            Payment advances on its own
          </label>
        </div>
      ) : null}
    </div>
  );
}

const panel: CSSProperties = {
  position: "fixed",
  left: 12,
  bottom: 44,
  zIndex: 2147483647,
  width: 280,
  padding: 10,
  font: "12px/1.3 ui-monospace, Consolas, monospace",
  color: "#111",
  background: "rgba(255, 255, 255, 0.94)",
  border: "1px dashed #888",
  borderRadius: 6,
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
};
const toggle: CSSProperties = { width: "100%", padding: "3px 6px", font: "inherit", color: "#111", cursor: "pointer", border: "1px solid #bbb", borderRadius: 3, background: "#f4f4f4" };
const heading: CSSProperties = { marginBottom: 4, fontWeight: 700, textTransform: "uppercase", fontSize: 10, color: "#555" };
const chip: CSSProperties = { padding: "2px 6px", font: "inherit", fontSize: 11, cursor: "pointer", border: "1px solid #bbb", borderRadius: 3, background: "#f4f4f4", color: "#111" };
const chipActive: CSSProperties = { background: "#111", color: "#fff", border: "1px solid #111" };
