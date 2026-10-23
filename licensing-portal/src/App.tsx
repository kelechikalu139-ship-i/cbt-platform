import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  KeyRound,
  LogIn,
  Plus,
  RefreshCw,
  Pause,
  Play,
  ShieldCheck,
  Ban,
  Copy,
  LogOut,
} from "lucide-react";

const API = (import.meta as any).env.VITE_LICENSING_API_URL || ((import.meta as any).env.DEV ? "http://127.0.0.1:18080" : "");
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
type LicenceEvent = {
  id: string;
  license_id: string | null;
  event_type: string;
  actor_email?: string | null;
  installation_id?: string | null;
  created_at: string;
};
type AdminAccount = { id: string; email: string; role: string; status: string; created_at: string; last_login_at?: string | null };
const fmt = (v?: string) =>
  v ? new Date(v).toLocaleDateString() : "No expiry";
const fmtTimestamp = (v: string) => new Date(v).toLocaleString();
export default function App() {
  const [token, setToken] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaSetupCode, setMfaSetupCode] = useState("");
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[]>([]);
  const [mfaSessionToken, setMfaSessionToken] = useState("");
  const [mfaChallengeToken, setMfaChallengeToken] = useState("");
  const [mfaSetupUrl, setMfaSetupUrl] = useState("");
  const [mfaQrDataUrl, setMfaQrDataUrl] = useState("");
  const [user, setUser] = useState<{ id: string; email: string; role: string } | null>(null);
  const [invitationToken, setInvitationToken] = useState(() => new URLSearchParams(window.location.search).get("invite") || "");
  const [bootstrapToken, setBootstrapToken] = useState(() => new URLSearchParams(window.location.search).get("setup") || "");
  const [authMode, setAuthMode] = useState<"login" | "mfa-login" | "invite" | "bootstrap" | "mfa-setup">(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has("setup") ? "bootstrap" : params.has("invite") ? "invite" : "login";
  });
  const [bootstrapStatus, setBootstrapStatus] = useState<"checking" | "available" | "closed">("checking");
  const [registrationEmail, setRegistrationEmail] = useState(() => new URLSearchParams(window.location.search).get("email") || "");
  const [registrationPassword, setRegistrationPassword] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [items, setItems] = useState<Licence[]>([]),
    [events, setEvents] = useState<LicenceEvent[]>([]),
    [admins, setAdmins] = useState<AdminAccount[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [showForm, setShowForm] = useState(false),
    [issued, setIssued] = useState<any>(null);
  const [renewing, setRenewing] = useState<Licence | null>(null);
  const [renewForm, setRenewForm] = useState({ plan: "PROFESSIONAL", maxCandidates: 300, expiresAt: "", features: ["cbt", "question-bank", "results"] });
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
  async function request(path: string, opts: RequestInit = {}, authToken = token) {
    const r = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    });
    const d = await r.json().catch(() => ({ message: "Unexpected response" }));
    if (r.status === 401 && authToken && authToken === token) {
      setToken("");
      setUser(null);
    }
    if (!r.ok) throw new Error(d.message || `Request failed (${r.status})`);
    return d;
  }
  useEffect(() => {
    if (!bootstrapToken) return;
    let current = true;
    setBootstrapStatus("checking");
    request(`/api/public/bootstrap-status?token=${encodeURIComponent(bootstrapToken)}`)
      .then((d) => {
        if (!current) return;
        setBootstrapStatus(d.available ? "available" : "closed");
        if (d.available) setRegistrationEmail(d.email);
      })
      .catch(() => {
        if (current) setBootstrapStatus("closed");
      });
    return () => { current = false; };
  }, [bootstrapToken]);
  useEffect(() => {
    let current = true;
    if (!mfaSetupUrl) { setMfaQrDataUrl(""); return; }
    QRCode.toDataURL(mfaSetupUrl, { errorCorrectionLevel: "M", margin: 2, width: 220 })
      .then((url) => { if (current) setMfaQrDataUrl(url); })
      .catch(() => { if (current) setMfaQrDataUrl(""); });
    return () => { current = false; };
  }, [mfaSetupUrl]);
  async function load() {
    setBusy(true);
    setError("");
    try {
      const [licences, activity] = await Promise.all([
        request("/api/admin/licenses"),
        request("/api/admin/audit?limit=100"),
      ]);
      setItems(licences.data || []);
      setEvents(activity.data || []);
      if (user?.role === "SUPER_ADMIN") {
        const accountList = await request("/api/admin/admins");
        setAdmins(accountList.data || []);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (token && authMode !== "mfa-setup") void load();
  }, [token, authMode]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const mfaStep = authMode === "mfa-login";
      const d = await request("/api/admin/login", {
        method: "POST",
        body: JSON.stringify(mfaStep
          ? { email, mfaCode, mfaChallengeToken }
          : { email, password }),
      });
      if (d.mfaRequired) {
        setMfaChallengeToken(d.mfaChallengeToken);
        setPassword("");
        setMfaCode("");
        setAuthMode("mfa-login");
        return;
      }
      if (d.mfaSetupRequired) {
        setToken(d.setupToken);
        setUser(d.user);
        setAuthMode("mfa-setup");
        const setup = await request("/api/admin/mfa/setup", { method: "POST" }, d.setupToken);
        setMfaSecret(setup.secret);
        setMfaSetupUrl(setup.otpauthUrl);
        setPassword("");
        setMfaCode("");
        return;
      }
      setToken(d.token);
      setUser(d.user);
      setPassword("");
      setMfaCode("");
      setMfaChallengeToken("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function verifyMfaSetup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const d = await request("/api/admin/mfa/verify-setup", {
        method: "POST",
        body: JSON.stringify({ code: mfaSetupCode }),
      }, token);
      setMfaRecoveryCodes(d.recoveryCodes || []);
      setMfaSessionToken(d.token);
      setUser(d.user);
      setMfaSetupCode("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function register(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (authMode === "bootstrap") {
        await request("/api/public/bootstrap", {
          method: "POST",
          body: JSON.stringify({ bootstrapToken, password: registrationPassword }),
        });
      } else {
        await request("/api/admin/register", {
          method: "POST",
          body: JSON.stringify({ email: registrationEmail, password: registrationPassword, invitationToken }),
        });
      }
      setInvitationToken("");
      setBootstrapToken("");
      setRegistrationPassword("");
      setAuthNotice("Your administrator account is ready. Sign in with your new password.");
      setAuthMode("login");
      window.history.replaceState({}, "", window.location.pathname);
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function createInvitation(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const d = await request("/api/admin/invitations", { method: "POST", body: JSON.stringify({ email: inviteEmail }) });
      const link = new URL(window.location.href);
      link.search = new URLSearchParams({ invite: d.data.token, email: d.data.email }).toString();
      setInviteLink(link.toString());
      setInviteEmail("");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function disableAdmin(account: AdminAccount) {
    if (!confirm(`Disable access for ${account.email}? Their current sessions will stop working immediately.`)) return;
    try {
      await request(`/api/admin/admins/${account.id}/disable`, { method: "POST" });
      await load();
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
  async function setSuspended(licence: Licence) {
    const suspend = licence.status !== "SUSPENDED";
    if (suspend && !confirm("Suspend this licence? Online activation will be blocked. Offline installations are affected when they next check in.")) return;
    try {
      await request(`/api/admin/licenses/${licence.id}/${suspend ? "suspend" : "resume"}`, { method: "POST" });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function renew(e: React.FormEvent) {
    e.preventDefault();
    if (!renewing) return;
    setError("");
    try {
      const d = await request(`/api/admin/licenses/${renewing.id}/renew`, {
        method: "POST",
        body: JSON.stringify({ ...renewForm, expiresAt: renewForm.expiresAt || null }),
      });
      setIssued(d.data);
      setRenewing(null);
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
  if (authMode === "mfa-login" && !token)
    return (
      <main className="login">
        <div className="brand"><div className="logo"><ShieldCheck /></div><p className="eyebrow">ACCOUNT SECURITY</p><h1>Verify it’s you</h1><p className="muted">Enter a current code from your authenticator app or use one recovery code.</p></div>
        <section className="panel loginpanel"><form className="authfields" onSubmit={login}>
          <h2>Multi-factor verification</h2><p className="muted">Signing in as {email}</p>
          <label>Authenticator or recovery code<input type="text" autoComplete="one-time-code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} autoFocus required /></label>
          {error && <p className="error">{error}</p>}<button className="primary"><LogIn size={17} /> Verify and sign in</button>
          <button type="button" className="secondary" onClick={() => { setAuthMode("login"); setMfaCode(""); setMfaChallengeToken(""); setError(""); }}>Back to email and password</button>
        </form></section>
      </main>
    );
  if (authMode === "mfa-setup" && token)
    return (
      <main className="login">
        <div className="brand"><div className="logo"><ShieldCheck /></div><p className="eyebrow">ACCOUNT SECURITY</p><h1>Set up authenticator</h1><p className="muted">Multi-factor authentication is required for every licensing administrator.</p></div>
        <section className="panel loginpanel">
          {mfaRecoveryCodes.length ? (
            <div className="authfields"><h2>Save your recovery codes</h2><p className="muted">Store these codes somewhere private. Each code can be used once if you lose access to your authenticator. They will not be shown again.</p><div className="recovery-codes">{mfaRecoveryCodes.map((code) => <code key={code}>{code}</code>)}</div><button className="primary" onClick={() => { setToken(mfaSessionToken); setMfaSessionToken(""); setMfaRecoveryCodes([]); setMfaSecret(""); setAuthMode("login"); }}>I saved these codes</button></div>
          ) : (
            <form className="authfields" onSubmit={verifyMfaSetup}>
              <h2>Connect an authenticator app</h2><p className="muted">Scan this QR code in Google Authenticator, Microsoft Authenticator, or another TOTP app. You can also enter the setup key manually.</p>
              {mfaQrDataUrl && <img className="mfa-qr" src={mfaQrDataUrl} alt="Authenticator setup QR code" />}
              <label>Setup key<div className="mfa-secret"><code>{mfaSecret || "Generating…"}</code><button type="button" className="secondary" onClick={() => void navigator.clipboard.writeText(mfaSecret)}>Copy</button></div></label>
              <p className="hint">Then enter the current six-digit code from the app to confirm setup.</p>
              <label>Authenticator code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={mfaSetupCode} onChange={(e) => setMfaSetupCode(e.target.value.replace(/\D/g, ""))} required /></label>
              {error && <p className="error">{error}</p>}<button className="primary" disabled={!mfaSecret}>Enable MFA</button>
            </form>
          )}
        </section>
      </main>
    );
  if (!token)
    return (
      <main className="login">
        <div className="brand">
          <div className="logo">
            <ShieldCheck />
          </div>
          <p className="eyebrow">PRODUCT OWNER CONSOLE</p>
          <h1>
            The Platform CBT
            <br />
            Licence Manager
          </h1>
          <p className="muted">
            Manage customer institutions, activation keys and licence
            entitlements.
          </p>
        </div>
        <section className="panel loginpanel">
          {authMode === "bootstrap" ? bootstrapStatus === "checking" ? (
            <div className="authfields"><h2>Checking setup link</h2><p className="muted">Verifying this one-time super-admin link…</p></div>
          ) : bootstrapStatus === "closed" ? (
            <div className="authfields"><h2>Super-admin setup unavailable</h2><p className="muted">This setup link has expired or has already been used.</p><button className="secondary" onClick={() => { setAuthMode("login"); setBootstrapToken(""); window.history.replaceState({}, "", window.location.pathname); }}>Back to sign in</button></div>
          ) : (
          <form className="authfields" onSubmit={register}>
            <h2>One-time super-admin registration</h2>
            <p className="muted">Create the first and only super-admin account. This setup link can be used once.</p>
            <label>Email<input type="email" value={registrationEmail} readOnly /></label>
            <label>Password<input type="password" autoComplete="new-password" minLength={12} value={registrationPassword} onChange={(e) => setRegistrationPassword(e.target.value)} required /></label>
            {error && <p className="error">{error}</p>}
            <button className="primary">Create super-admin account</button>
          </form>
          ) : authMode === "invite" ? (
          <form className="authfields" onSubmit={register}>
            <h2>Register administrator account</h2>
            <p className="muted">This invitation is for {registrationEmail} and expires after 48 hours.</p>
            <label>Email<input type="email" autoComplete="username" value={registrationEmail} onChange={(e) => setRegistrationEmail(e.target.value)} required /></label>
            <label>Password<input type="password" autoComplete="new-password" minLength={12} value={registrationPassword} onChange={(e) => setRegistrationPassword(e.target.value)} required /></label>
            {error && <p className="error">{error}</p>}
            <button className="primary">Create administrator account</button>
            <p className="hint">Choose a unique password with at least 12 characters.</p>
            <button type="button" className="secondary" onClick={() => { setAuthMode("login"); setInvitationToken(""); window.history.replaceState({}, "", window.location.pathname); }}>Back to sign in</button>
          </form>
        ) : (
        <form className="authfields" onSubmit={login}>
          <h2>Administrator sign in</h2>
          {authNotice && <p className="hint">{authNotice}</p>}
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
          <label>Authenticator or recovery code<input type="text" autoComplete="one-time-code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="6-digit code or recovery code" /></label>
          {error && <p className="error">{error}</p>}
          <button className="primary">
            <LogIn size={17} /> Sign in securely
          </button>
          <p className="hint">
            Administrator accounts are created by the super-admin. Contact your product owner if you need access.
          </p>
        </form>
        )}
        </section>
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
            <b>CBT Platform</b>
            <span>Licence Manager · {user?.email}</span>
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
              setUser(null);
              setItems([]);
              setEvents([]);
              setAdmins([]);
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </header>
      <section className="intro">
        <div>
          <p className="eyebrow">CUSTOMER LICENSING</p>
          <h1>Licensing dashboard</h1>
          <p className="muted">
            Manage institution licences, administrator access, activations and recent activity.
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
          {issued.signedLicense && (
            <button
              className="secondary"
              onClick={() => {
                const blob = new Blob([JSON.stringify(issued.signedLicense, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `nurse-cbt-license-${issued.id}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <KeyRound size={16} /> Download signed licence
            </button>
          )}
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
      {renewing && (
        <form className="panel formpanel" onSubmit={renew}>
          <h2>Renew {renewing.institution_name}</h2>
          <p className="muted">Renewal replaces the current activation key. The new key is shown once.</p>
          <div className="formgrid">
            <label>Plan<select value={renewForm.plan} onChange={(e) => setRenewForm({ ...renewForm, plan: e.target.value })}><option>TRIAL</option><option>STANDARD</option><option>PROFESSIONAL</option><option>ENTERPRISE</option></select></label>
            <label>Candidate limit<input type="number" min="1" max="100000" value={renewForm.maxCandidates} onChange={(e) => setRenewForm({ ...renewForm, maxCandidates: Number(e.target.value) })} required /></label>
            <label>Expiry date<input type="date" value={renewForm.expiresAt} onChange={(e) => setRenewForm({ ...renewForm, expiresAt: e.target.value })} /></label>
          </div>
          <div className="formactions">
            <button type="button" className="secondary" onClick={() => setRenewing(null)}>Cancel</button>
            <button className="primary"><RefreshCw size={16} /> Renew licence</button>
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
                      {!(["REVOKED", "SUSPENDED"].includes(x.status)) && (
                        <button
                          className="iconbutton"
                          title="Renew licence and replace activation key"
                          onClick={() => {
                            setRenewForm({ plan: x.plan, maxCandidates: x.max_candidates, expiresAt: x.expires_at ? new Date(x.expires_at).toISOString().slice(0, 10) : "", features: x.features || [] });
                            setRenewing(x);
                            setShowForm(false);
                            setIssued(null);
                          }}
                        >
                          <RefreshCw size={16} />
                        </button>
                      )}
                      {(["PENDING", "ACTIVE", "SUSPENDED"].includes(x.status)) && (
                        <button
                          className={`iconbutton${x.status === "SUSPENDED" ? "" : " danger"}`}
                          title={x.status === "SUSPENDED" ? "Resume licence" : "Suspend licence"}
                          onClick={() => void setSuspended(x)}
                        >
                          {x.status === "SUSPENDED" ? <Play size={16} /> : <Pause size={16} />}
                        </button>
                      )}
                      {!(["REVOKED", "SUSPENDED"].includes(x.status)) && (
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
      <section className="panel tablepanel activitypanel">
        <div className="tabletitle">
          <div>
            <h2>Recent licensing activity</h2>
            <p className="muted">Latest 100 recorded events</p>
          </div>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Administrator</th>
                <th>Installation</th>
                <th>Licence ID</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{fmtTimestamp(event.created_at)}</td>
                  <td>{event.event_type.replace(/_/g, " ")}</td>
                  <td>{event.actor_email || "School installation"}</td>
                  <td>{event.installation_id || "—"}</td>
                  <td>{event.license_id || "Deleted licence"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!events.length && <div className="empty">No licensing activity recorded yet.</div>}
        </div>
      </section>
      {user?.role === "SUPER_ADMIN" && (
        <section className="panel tablepanel activitypanel">
          <div className="tabletitle"><div><h2>Administrator access</h2><p className="muted">Invite staff and manage active portal accounts.</p></div></div>
          <form className="formactions" onSubmit={createInvitation} style={{ justifyContent: "flex-start", marginTop: 16 }}>
            <input className="adminemail" type="email" aria-label="Administrator email" placeholder="name@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
            <button className="primary">Create 48-hour invitation</button>
          </form>
          {inviteLink && <div className="issued"><p className="muted">One-time registration link. Share it securely; it will not be shown again.</p><code>{inviteLink}</code><button className="secondary" onClick={() => navigator.clipboard.writeText(inviteLink)}><Copy size={16} /> Copy invitation link</button><button className="close" onClick={() => setInviteLink("")}>Dismiss</button></div>}
          <div className="tablewrap"><table><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Last sign in</th><th>Action</th></tr></thead><tbody>{admins.map((account) => <tr key={account.id}><td>{account.email}</td><td>{account.role.replace("_", " ")}</td><td>{account.status}</td><td>{account.last_login_at ? fmtTimestamp(account.last_login_at) : "Never"}</td><td>{account.status === "ACTIVE" && account.id !== user.id && <button className="iconbutton danger" title={`Disable ${account.email}`} onClick={() => void disableAdmin(account)}><Ban size={16} /></button>}</td></tr>)}</tbody></table></div>
        </section>
      )}
      <footer>
        Private product-owner portal · Use HTTPS, strong credentials, and
        restricted access in production.
      </footer>
    </main>
  );
}
