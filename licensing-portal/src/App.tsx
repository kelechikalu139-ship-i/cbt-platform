import { useEffect, useState } from "react";
import {
  KeyRound,
  LogIn,
  Plus,
  RefreshCw,
  ShieldCheck,
  Ban,
  Copy,
  LogOut,
} from "lucide-react";

const API = (import.meta as any).env.VITE_LICENSING_API_URL || "";
type Licence = {
  id: string;
  institution_id: string;
  institution_name: string;
  contact_email?: string;
  plan: string;
  status: string;
  installation_id?: string;
  max_candidates: number;
  issued_at: string;
  expires_at?: string;
  activated_at?: string;
  features?: string[];
};
const fmt = (v?: string) =>
  v ? new Date(v).toLocaleDateString() : "No expiry";
export default function App() {
  const [token, setToken] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [items, setItems] = useState<Licence[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false),
    [issued, setIssued] = useState<any>(null);
  const [form, setForm] = useState({
    institutionName: "",
    institutionId: "",
    contactEmail: "",
    plan: "PROFESSIONAL",
    maxCandidates: 300,
    expiresAt: "",
    features: [
      "cbt",
      "question-bank",
      "results",
      "excel-export",
      "pdf-export",
      "backup-restore",
    ],
  });
  async function request(path: string, opts: RequestInit = {}) {
    const r = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const d = await r.json().catch(() => ({ message: "Unexpected response" }));
    if (!r.ok) throw new Error(d.message || `Request failed (${r.status})`);
    return d;
  }
  async function load() {
    setBusy(true);
    setError("");
    try {
      const d = await request("/api/admin/licenses");
      setItems(d.data || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (token) void load();
  }, [token]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const d = await request("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(d.token);
      setPassword("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const d = await request("/api/admin/licenses", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          contactEmail: form.contactEmail || undefined,
          expiresAt: form.expiresAt || null,
        }),
      });
      setIssued(d.data);
      setShowForm(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function revoke(id: string) {
    if (
      !confirm(
        "Revoke this licence? Offline installations cannot be revoked until they reconnect.",
      )
    )
      return;
    try {
      await request(`/api/admin/licenses/${id}/revoke`, { method: "POST" });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function offlineIssue(id: string) {
    const installationId = prompt(
      "Enter the Installation ID shown on the school server:",
    );
    if (!installationId) return;
    try {
      const d = await request(`/api/admin/licenses/${id}/offline-issue`, {
        method: "POST",
        body: JSON.stringify({ installationId }),
      });
      const blob = new Blob([JSON.stringify(d.data, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `nurse-cbt-license-${id}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      setError(e.message);
    }
  }
  if (!token)
    return (
      <main className="login">
        <div className="brand">
          <div className="logo">
            <ShieldCheck />
          </div>
          <p className="eyebrow">PRODUCT OWNER CONSOLE</p>
          <h1>
            Nurse CBT
            <br />
            Licence Manager
          </h1>
          <p className="muted">
            Manage customer institutions, activation keys and licence
            entitlements.
          </p>
        </div>
        <form className="panel loginpanel" onSubmit={login}>
          <h2>Administrator sign in</h2>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary">
            <LogIn size={17} /> Sign in securely
          </button>
          <p className="hint">
            Use the administrator credentials configured on the licensing
            service. No default account is provided.
          </p>
        </form>
      </main>
    );
  return (
    <main className="shell">
      <header>
        <div className="brandline">
          <div className="logo small">
            <ShieldCheck />
          </div>
          <div>
            <b>Nurse CBT</b>
            <span>Licence Manager</span>
          </div>
        </div>
        <div className="headeractions">
          <button className="secondary" onClick={() => void load()}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            className="secondary"
            onClick={() => {
              setToken("");
              setItems([]);
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </header>
      <section className="intro">
        <div>
          <p className="eyebrow">CUSTOMER LICENSING</p>
          <h1>Institution licences</h1>
          <p className="muted">
            Create and manage the licences that activate school installations.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setShowForm(!showForm);
            setIssued(null);
          }}
        >
          <Plus size={18} /> Issue licence
        </button>
      </section>
      {error && <div className="alert">{error}</div>}
      {issued && (
        <section className="panel issued">
          <div>
            <KeyRound />
            <div>
              <h2>Activation key — shown once</h2>
              <p className="muted">
                Copy this key and send it to the customer using a secure
                channel. It cannot be retrieved later.
              </p>
            </div>
          </div>
          <code>{issued.activationKey}</code>
          <button
            className="secondary"
            onClick={() => navigator.clipboard.writeText(issued.activationKey)}
          >
            <Copy size={16} /> Copy key
          </button>
          <button className="close" onClick={() => setIssued(null)}>
            Dismiss
          </button>
        </section>
      )}
      {showForm && (
        <form className="panel formpanel" onSubmit={create}>
          <h2>New customer licence</h2>
          <div className="formgrid">
            <label>
              Institution name
              <input
                value={form.institutionName}
                onChange={(e) =>
                  setForm({ ...form, institutionName: e.target.value })
                }
                required
                minLength={2}
              />
            </label>
            <label>
              Institution ID
              <input
                value={form.institutionId}
                onChange={(e) =>
                  setForm({ ...form, institutionId: e.target.value })
                }
                placeholder="AKRAM-SHT"
                pattern="[A-Za-z0-9_-]+"
                required
              />
            </label>
            <label>
              Contact email
              <input
                type="email"
                value={form.contactEmail}
                onChange={(e) =>
                  setForm({ ...form, contactEmail: e.target.value })
                }
              />
            </label>
            <label>
              Plan
              <select
                value={form.plan}
                onChange={(e) => setForm({ ...form, plan: e.target.value })}
              >
                <option>TRIAL</option>
                <option>STANDARD</option>
                <option>PROFESSIONAL</option>
                <option>ENTERPRISE</option>
              </select>
            </label>
            <label>
              Candidate limit
              <input
                type="number"
                min="1"
                max="100000"
                value={form.maxCandidates}
                onChange={(e) =>
                  setForm({ ...form, maxCandidates: Number(e.target.value) })
                }
                required
              />
            </label>
            <label>
              Expiry date
              <input
                type="date"
                value={form.expiresAt}
                onChange={(e) =>
                  setForm({ ...form, expiresAt: e.target.value })
                }
              />
            </label>
          </div>
          <div className="formactions">
            <button
              type="button"
              className="secondary"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
            <button className="primary">
              <KeyRound size={16} /> Generate activation key
            </button>
          </div>
        </form>
      )}
      <section className="stats">
        <div className="panel">
          <span>Total licences</span>
          <b>{items.length}</b>
        </div>
        <div className="panel">
          <span>Active</span>
          <b>{items.filter((x) => x.status === "ACTIVE").length}</b>
        </div>
        <div className="panel">
          <span>Pending activation</span>
          <b>{items.filter((x) => x.status === "PENDING").length}</b>
        </div>
        <div className="panel">
          <span>Revoked</span>
          <b>{items.filter((x) => x.status === "REVOKED").length}</b>
        </div>
      </section>
      <section className="panel tablepanel">
        <div className="tabletitle">
          <div>
            <h2>Customer register</h2>
            <p className="muted">Latest 1,000 licences</p>
          </div>
          {busy && <span className="muted">Loading…</span>}
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Institution</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Capacity</th>
                <th>Expiry</th>
                <th>Installation</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id}>
                  <td>
                    <b>{x.institution_name}</b>
                    <small>
                      {x.institution_id}
                      {x.contact_email ? ` · ${x.contact_email}` : ""}
                    </small>
                  </td>
                  <td>{x.plan}</td>
                  <td>
                    <span className={`pill ${x.status.toLowerCase()}`}>
                      {x.status}
                    </span>
                  </td>
                  <td>{x.max_candidates}</td>
                  <td>{fmt(x.expires_at)}</td>
                  <td>{x.installation_id || "Not activated"}</td>
                  <td>
                    <div className="rowactions">
                      {x.status !== "REVOKED" && (
                        <button
                          className="iconbutton"
                          title="Issue offline licence file"
                          onClick={() => void offlineIssue(x.id)}
                        >
                          <KeyRound size={16} />
                        </button>
                      )}
                      {x.status !== "REVOKED" && (
                        <button
                          className="iconbutton danger"
                          title="Revoke licence"
                          onClick={() => void revoke(x.id)}
                        >
                          <Ban size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && !busy && (
            <div className="empty">
              No licences yet. Issue the first customer licence to get started.
            </div>
          )}
        </div>
      </section>
      <footer>
        Private product-owner portal · Use HTTPS, strong credentials, and
        restricted access in production.
      </footer>
    </main>
  );
}
