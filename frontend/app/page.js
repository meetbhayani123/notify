"use client";

import { useState, useEffect, useMemo, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

// ── API helpers ─────────────────────────────────────────
async function fetchSeries() {
  const res = await fetch(`${API_BASE}/api/series`);
  if (!res.ok) throw new Error(`Failed to fetch series: ${res.statusText}`);
  const data = await res.json();
  return data.data || [];
}

async function toggleMute(fKey, mute) {
  const endpoint = mute ? "mute" : "unmute";
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["X-API-Key"] = API_KEY;
  const res = await fetch(`${API_BASE}/api/series/${encodeURIComponent(fKey)}/${endpoint}`, {
    method: "PATCH", headers,
  });
  if (!res.ok) throw new Error(`Failed to ${endpoint} series: ${res.statusText}`);
  return res.json();
}

async function bulkMuteSeries(fKeys, muted) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["X-API-Key"] = API_KEY;
  const res = await fetch(`${API_BASE}/api/series/bulk-mute`, {
    method: "PATCH", headers, body: JSON.stringify({ fKeys, muted }),
  });
  if (!res.ok) throw new Error(`Bulk operation failed: ${res.statusText}`);
  return res.json();
}

// ── Toggle Switch ───────────────────────────────────────
function ToggleSwitch({ enabled, onToggle, loading, id }) {
  return (
    <button
      id={id}
      onClick={onToggle}
      disabled={loading}
      aria-label={enabled ? "Notifications enabled — click to mute" : "Notifications muted — click to enable"}
      className="touch-active"
      style={{
        width: 50, height: 28, borderRadius: 14, border: "none",
        cursor: loading ? "wait" : "pointer", position: "relative",
        transition: "background 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s",
        background: enabled
          ? "linear-gradient(135deg, #34d399, #10b981)"
          : "linear-gradient(135deg, #374151, #1f2937)",
        opacity: loading ? 0.5 : 1, flexShrink: 0,
        boxShadow: enabled ? "0 0 12px rgba(52,211,153,0.2)" : "none",
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: enabled ? 24 : 3,
        width: 22, height: 22, borderRadius: 11, background: "#fff",
        transition: "left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
      }} />
    </button>
  );
}

// ── Series Card ─────────────────────────────────────────
function SeriesCard({ series, onToggle, loadingKey }) {
  const isActive = !series.muted;
  const isLoading = loadingKey === series.f_key;

  return (
    <div
      className="animate-fade-in touch-active transition-smooth"
      style={{
        background: isActive
          ? "linear-gradient(135deg, rgba(52,211,153,0.05), rgba(16,185,129,0.02))"
          : "var(--bg-glass)",
        border: `1px solid ${isActive ? "rgba(52,211,153,0.12)" : "var(--border-glass)"}`,
        borderRadius: "var(--radius-md)", padding: "16px 16px",
        display: "flex", alignItems: "center", gap: 14,
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Icon */}
      <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>
        {isActive ? "🏏" : "🔇"}
      </span>

      {/* Text — takes remaining space, wraps naturally */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{
          fontSize: 14, fontWeight: 600, lineHeight: 1.4, margin: 0,
          color: isActive ? "var(--text-primary)" : "var(--text-muted)",
          transition: "color 0.3s ease",
          wordBreak: "break-word",
        }}>
          {series.name || series.f_key}
        </h3>
        {series.shortName && series.shortName !== series.name && (
          <p style={{
            fontSize: 11, color: "var(--text-dim)", margin: "2px 0 0",
            lineHeight: 1.3,
          }}>
            {series.shortName}
          </p>
        )}
      </div>

      {/* Status + Toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <span style={{
          fontSize: 10, fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.06em", lineHeight: 1,
          color: isActive ? "var(--accent-emerald)" : "var(--text-dim)",
          transition: "color 0.3s",
        }}>
          {isActive ? "Active" : "Muted"}
        </span>
        <ToggleSwitch
          id={`toggle-${series.f_key}`}
          enabled={isActive}
          onToggle={() => onToggle(series.f_key, isActive)}
          loading={isLoading}
        />
      </div>
    </div>
  );
}

// ── Stats Bar ───────────────────────────────────────────
function StatsBar({ total, active, muted }) {
  const items = [
    { label: "Total", value: total, color: "var(--accent-indigo)", bg: "var(--glow-indigo)" },
    { label: "Active", value: active, color: "var(--accent-emerald)", bg: "var(--glow-emerald)" },
    { label: "Muted", value: muted, color: "var(--accent-rose)", bg: "var(--glow-rose)" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
      {items.map((s) => (
        <div key={s.label} className="animate-fade-in-scale" style={{
          background: s.bg, border: `1px solid ${s.color}18`,
          borderRadius: "var(--radius-md)", padding: "14px 8px",
          textAlign: "center", backdropFilter: "blur(6px)",
        }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1 }}>
            {s.value}
          </div>
          <div style={{
            fontSize: 10, color: "var(--text-dim)", marginTop: 5,
            textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600,
          }}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Filter Pill ─────────────────────────────────────────
function FilterPill({ active, label, count, onClick, id }) {
  return (
    <button id={id} onClick={onClick} className="touch-active" style={{
      padding: "7px 14px", borderRadius: 20, border: "1px solid",
      borderColor: active ? "var(--accent-indigo)" : "var(--border-glass)",
      background: active ? "rgba(99,102,241,0.12)" : "transparent",
      color: active ? "var(--accent-indigo)" : "var(--text-muted)",
      fontSize: 12, fontWeight: 600, cursor: "pointer",
      transition: "all 0.2s ease", display: "flex", alignItems: "center", gap: 5,
      whiteSpace: "nowrap",
    }}>
      {label}
      {count !== undefined && (
        <span style={{
          background: active ? "rgba(99,102,241,0.2)" : "var(--bg-glass-strong)",
          padding: "1px 6px", borderRadius: 10, fontSize: 10, fontWeight: 700,
          minWidth: 20, textAlign: "center",
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── Main Page ───────────────────────────────────────────
export default function HomePage() {
  const [seriesList, setSeriesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loadingKey, setLoadingKey] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [toast, setToast] = useState(null);
  const [toastExiting, setToastExiting] = useState(false);

  useEffect(() => { loadSeries(); }, []);

  // Toast auto-dismiss with exit animation
  useEffect(() => {
    if (toast && !toastExiting) {
      const timer = setTimeout(() => {
        setToastExiting(true);
        setTimeout(() => { setToast(null); setToastExiting(false); }, 300);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [toast, toastExiting]);

  async function loadSeries() {
    setLoading(true); setError(null);
    try {
      const data = await fetchSeries();
      setSeriesList(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  function showToast(type, message) {
    setToastExiting(false);
    setToast({ type, message });
  }

  const handleToggle = useCallback(async (fKey, currentlyActive) => {
    setLoadingKey(fKey);
    try {
      await toggleMute(fKey, currentlyActive);
      setSeriesList((prev) => prev.map((s) => (s.f_key === fKey ? { ...s, muted: currentlyActive } : s)));
      const name = seriesList.find((s) => s.f_key === fKey)?.name || fKey;
      showToast(currentlyActive ? "muted" : "active",
        currentlyActive ? `🔇 ${name} muted` : `🏏 ${name} activated`);
    } catch (err) { showToast("error", `Failed: ${err.message}`); }
    finally { setLoadingKey(null); }
  }, [seriesList]);

  const handleBulk = useCallback(async (mute) => {
    const keys = filteredSeries.filter((s) => mute ? !s.muted : s.muted).map((s) => s.f_key);
    if (keys.length === 0) return;
    setLoadingKey("__bulk__");
    try {
      await bulkMuteSeries(keys, mute);
      setSeriesList((prev) => prev.map((s) => (keys.includes(s.f_key) ? { ...s, muted: mute } : s)));
      showToast(mute ? "muted" : "active",
        mute ? `🔇 Muted ${keys.length} series` : `🏏 Activated ${keys.length} series`);
    } catch (err) { showToast("error", `Failed: ${err.message}`); }
    finally { setLoadingKey(null); }
  }, [seriesList, searchQuery, filterMode]);

  const filteredSeries = useMemo(() => {
    let result = seriesList;
    if (filterMode === "active") result = result.filter((s) => !s.muted);
    else if (filterMode === "muted") result = result.filter((s) => s.muted);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((s) =>
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.shortName && s.shortName.toLowerCase().includes(q)) ||
        s.f_key.toLowerCase().includes(q)
      );
    }
    return result;
  }, [seriesList, filterMode, searchQuery]);

  const stats = useMemo(() => {
    const total = seriesList.length;
    const muted = seriesList.filter((s) => s.muted).length;
    return { total, active: total - muted, muted };
  }, [seriesList]);

  const toastColors = {
    error: { bg: "rgba(244,63,94,0.12)", border: "rgba(251,113,133,0.25)" },
    muted: { bg: "rgba(245,158,11,0.12)", border: "rgba(251,191,36,0.25)" },
    active: { bg: "rgba(16,185,129,0.12)", border: "rgba(52,211,153,0.25)" },
  };

  return (
    <main style={{
      minHeight: "100vh", minHeight: "100dvh",
      background: "linear-gradient(180deg, #06080f 0%, #0c1220 40%, #0a0f1c 100%)",
      position: "relative", overflowX: "clip",
    }}>
      {/* Ambient glow */}
      <div style={{
        position: "fixed", top: -300, right: -200, width: 600, height: 600,
        background: "radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)",
        pointerEvents: "none", zIndex: 0,
      }} />
      <div style={{
        position: "fixed", bottom: -300, left: -200, width: 600, height: 600,
        background: "radial-gradient(circle, rgba(52,211,153,0.04) 0%, transparent 70%)",
        pointerEvents: "none", zIndex: 0,
      }} />

      {/* Toast */}
      {toast && (
        <div
          className={toastExiting ? "animate-toast-out" : "animate-toast-in"}
          style={{
            position: "fixed", top: 16, left: "50%", zIndex: 1000,
            padding: "10px 20px", borderRadius: 12, maxWidth: "calc(100vw - 32px)",
            background: toastColors[toast.type]?.bg || toastColors.active.bg,
            border: `1px solid ${toastColors[toast.type]?.border || toastColors.active.border}`,
            backdropFilter: "blur(20px)", color: "var(--text-primary)",
            fontSize: 13, fontWeight: 500,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03)",
            textAlign: "center",
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Content container */}
      <div style={{
        maxWidth: 680, margin: "0 auto", padding: "0 16px",
        paddingTop: "max(24px, env(safe-area-inset-top, 24px))",
        paddingBottom: "max(32px, env(safe-area-inset-bottom, 32px))",
        position: "relative", zIndex: 1,
      }}>

        {/* Header — compact on mobile */}
        <header className="animate-slide-down" style={{
          marginBottom: 24, textAlign: "center",
          paddingTop: 8,
        }}>
          <div style={{
            fontSize: 40, marginBottom: 8, lineHeight: 1,
            filter: "drop-shadow(0 2px 8px rgba(99,102,241,0.2))",
          }}>🏏</div>
          <h1 style={{
            fontSize: "clamp(22px, 5vw, 28px)", fontWeight: 900, lineHeight: 1.2,
            background: "linear-gradient(135deg, #a5b4fc, #818cf8, #34d399)",
            backgroundSize: "200% 200%",
            animation: "gradient-shift 6s ease infinite",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            backgroundClip: "text", marginBottom: 6,
            width: "fit-content", marginLeft: "auto", marginRight: "auto",
            textAlign: "center",
          }}>
            Cricket Alert Manager
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "clamp(12px, 3vw, 14px)" }}>
            Control which tournaments send notifications
          </p>
        </header>

        {/* Stats */}
        {!loading && !error && (
          <div style={{ marginBottom: 20 }}>
            <StatsBar total={stats.total} active={stats.active} muted={stats.muted} />
          </div>
        )}

        {/* Controls */}
        {!loading && !error && seriesList.length > 0 && (
          <div className="animate-fade-in" style={{ marginBottom: 16 }}>
            {/* Search */}
            <div style={{ position: "relative", marginBottom: 12 }}>
              <span style={{
                position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                fontSize: 15, color: "var(--text-dim)", pointerEvents: "none",
              }}>🔍</span>
              <input
                id="search-series" type="text" placeholder="Search tournaments..."
                value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%", padding: "12px 14px 12px 40px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-glass)", background: "var(--bg-glass)",
                  color: "var(--text-primary)", fontSize: 14, outline: "none",
                  backdropFilter: "blur(8px)", transition: "border-color 0.25s, box-shadow 0.25s",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "rgba(99,102,241,0.35)";
                  e.target.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.08)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "var(--border-glass)";
                  e.target.style.boxShadow = "none";
                }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} style={{
                  position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                  background: "var(--bg-glass-strong)", border: "none", borderRadius: 10,
                  width: 20, height: 20, cursor: "pointer", color: "var(--text-muted)",
                  fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center",
                  lineHeight: 1,
                }}>✕</button>
              )}
            </div>

            {/* Filter pills — scrollable row on mobile */}
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              overflowX: "auto", WebkitOverflowScrolling: "touch",
              scrollbarWidth: "none", msOverflowStyle: "none",
              paddingBottom: 2,
            }}>
              <FilterPill active={filterMode === "all"} label="All" count={stats.total}
                onClick={() => setFilterMode("all")} id="filter-all" />
              <FilterPill active={filterMode === "active"} label="Active" count={stats.active}
                onClick={() => setFilterMode("active")} id="filter-active" />
              <FilterPill active={filterMode === "muted"} label="Muted" count={stats.muted}
                onClick={() => setFilterMode("muted")} id="filter-muted" />

              <div style={{ flex: 1, minWidth: 8 }} />

              <button id="mute-all-btn" onClick={() => handleBulk(true)}
                disabled={loadingKey === "__bulk__"} className="touch-active"
                style={{
                  padding: "7px 12px", borderRadius: 20, whiteSpace: "nowrap",
                  border: "1px solid rgba(251,113,133,0.15)",
                  background: "rgba(251,113,133,0.06)", color: "var(--accent-rose)",
                  fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
                }}>🔇 Mute</button>
              <button id="unmute-all-btn" onClick={() => handleBulk(false)}
                disabled={loadingKey === "__bulk__"} className="touch-active"
                style={{
                  padding: "7px 12px", borderRadius: 20, whiteSpace: "nowrap",
                  border: "1px solid rgba(52,211,153,0.15)",
                  background: "rgba(52,211,153,0.06)", color: "var(--accent-emerald)",
                  fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
                }}>🏏 Activate</button>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 16 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{
                  width: 10, height: 10, borderRadius: 5,
                  background: "var(--accent-indigo)",
                  animation: `pulse-dot 1.2s ease-in-out ${i * 0.15}s infinite`,
                }} />
              ))}
            </div>
            <p style={{ color: "var(--text-dim)", fontSize: 13 }}>Loading tournaments...</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="animate-fade-in-scale" style={{
            textAlign: "center", padding: "48px 24px",
            background: "var(--glow-rose)", borderRadius: "var(--radius-lg)",
            border: "1px solid rgba(251,113,133,0.12)",
          }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>⚠️</div>
            <p style={{ color: "var(--accent-rose)", fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
              Connection Error
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 20, maxWidth: 280, margin: "0 auto 20px" }}>
              {error}
            </p>
            <button id="retry-btn" onClick={loadSeries} className="touch-active" style={{
              padding: "10px 28px", borderRadius: "var(--radius-sm)",
              border: "1px solid rgba(99,102,241,0.25)",
              background: "rgba(99,102,241,0.1)", color: "var(--accent-indigo)",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>Retry</button>
          </div>
        )}

        {/* Series list */}
        {!loading && !error && (
          <div className="stagger-children" style={{
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            {filteredSeries.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 20px" }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>
                  {searchQuery ? "🔍" : "📭"}
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  {searchQuery ? `No results for "${searchQuery}"` :
                    filterMode === "muted" ? "No muted series" :
                    filterMode === "active" ? "No active series" : "No series found"}
                </p>
              </div>
            ) : (
              filteredSeries.map((s) => (
                <SeriesCard key={s.f_key} series={s} onToggle={handleToggle} loadingKey={loadingKey} />
              ))
            )}
          </div>
        )}

        {/* Footer */}
        <footer style={{
          marginTop: 40, textAlign: "center", color: "var(--text-dim)", fontSize: 11,
          paddingBottom: 8,
        }}>
          <p style={{ marginBottom: 3 }}>Cricket Alert Manager • Powered by CREX Data</p>
          <p style={{ opacity: 0.5 }}>Muted series will not trigger any notifications</p>
        </footer>
      </div>
    </main>
  );
}
