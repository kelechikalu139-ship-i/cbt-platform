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
  Download,
  LogOut,
} from "lucide-react";

const configuredApiUrl = import.meta.env.VITE_LICENSING_API_URL?.trim();
const API = configuredApiUrl
  ? configuredApiUrl.replace(/\/+$/, "")
  : import.meta.env.DEV
    ? "http://127.0.0.1:18080"
    : "";
const API_CONFIGURATION_ERROR =
  "The licensing API URL is not configured. Set VITE_LICENSING_API_URL to your licensing-service HTTPS origin in the Render Static Site environment, then redeploy the portal.";
const configuredInstallerUrl = import.meta.env.VITE_CBT_INSTALLER_URL?.trim();
const configuredCaosceInstallerUrl = import.meta.env.VITE_CAOSCE_INSTALLER_URL?.trim();
const FALLBACK_INSTALLER_URL =
  "https://github.com/kelechikalu139-ship-i/cbt-platform/releases/download/v1.0.32/The-Platform-CBT-Setup-1.0.32-unsigned.exe";
const FALLBACK_CAOSCE_INSTALLER_URL =
  "https://github.com/kelechikalu139-ship-i/cbt-platform/releases/download/caosce-v1.0.17/CAOSCE-Platform-Setup-v1.0.17.exe";

function normalizeDownloadUrl(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
function normalizeHttpsDownloadUrl(value: string | undefined): string | null {
  const normalized = normalizeDownloadUrl(value);
  if (!normalized?.startsWith("https://")) return null;
  return /\.(?:exe|msi)$/i.test(new URL(normalized).pathname) ? normalized : null;
}
const FALLBACK_CAOSCE_DOWNLOAD_URL =
  normalizeHttpsDownloadUrl(configuredCaosceInstallerUrl) || FALLBACK_CAOSCE_INSTALLER_URL;
type Licence = {
  id: string;
  product: ProductId;
  institution_id: string;
  institution_name: string;
  contact_email?: string;
  plan: string;
  status: "PENDING" | "ACTIVE" | "EXPIRED" | "SUSPENDED" | "REVOKED";
  installation_id?: string;
  max_candidates: number;
  issued_at: string;
  expires_at?: string;
  activated_at?: string;
  features?: string[];
};
type ProductId = "nurse-cbt" | "caosce-platform";
type IssuedLicence = {
  id: string;
  product: ProductId;
  activationKey: string;
  signedLicense?: { payload: Record<string, unknown>; signature: string; algorithm: string } | null;
};
const PRODUCT_NAMES: Record<ProductId, string> = {
  "nurse-cbt": "CBT Platform",
  "caosce-platform": "CAOSCE Platform",
};
const DEFAULT_FEATURES: Record<ProductId, string[]> = {
  "nurse-cbt": ["cbt", "question-bank", "results", "excel-export", "pdf-export", "backup-restore"],
  "caosce-platform": ["osce", "viva", "results"],
};
type LicenceEvent = {
  id: string;
  license_id: string | null;
  event_type: string;
  actor_email?: string | null;
  installation_id?: string | null;
  metadata?: { product?: ProductId };
  created_at: string;
};
type AdminAccount = { id: string; email: string; role: string; status: string; created_at: string; last_login_at?: string | null };
const AUTH_SESSION_KEY = "cbt-license-auth-session";

function readStoredSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || "null");
    return typeof saved?.token === "string" && saved?.user
      ? { token: saved.token as string, user: saved.user as { id: string; email: string; role: string } }
      : { token: "", user: null as { id: string; email: string; role: string } | null };
  } catch {
    return { token: "", user: null as { id: string; email: string; role: string } | null };
  }
}

function storeSession(token: string, user: { id: string; email: string; role: string } | null) {
  if (token && user) {
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ token, user }));
  } else {
    localStorage.removeItem(AUTH_SESSION_KEY);
  }
}

const fmt = (v?: string) =>
  v ? new Date(v).toLocaleDateString() : "No expiry";
const fmtTimestamp = (v: string) => new Date(v).toLocaleString();
export default function App() {
  const initialSession = readStoredSession();
  const [token, setToken] = useState(initialSession.token),
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
  const [user, setUser] = useState<{ id: string; email: string; role: string } | null>(initialSession.user);
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
    [error, setError] = useState(API ? "" : API_CONFIGURATION_ERROR),
    [busy, setBusy] = useState(false),
    [loginBusy, setLoginBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [productFilter, setProductFilter] = useState<"all" | ProductId>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | Licence["status"]>("all");
  const [searchText, setSearchText] = useState("");
  const [issueBusy, setIssueBusy] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const [installerDownloadUrl, setInstallerDownloadUrl] = useState<string | null>(() =>
    normalizeDownloadUrl(FALLBACK_INSTALLER_URL),
  );
  const [caosceInstallerDownloadUrl, setCaosceInstallerDownloadUrl] = useState<string>(() => FALLBACK_CAOSCE_DOWNLOAD_URL);
  const [inviteLink, setInviteLink] = useState("");
  const [showForm, setShowForm] = useState(false),
    [issued, setIssued] = useState<IssuedLicence | null>(null);
  const [renewing, setRenewing] = useState<Licence | null>(null);
  const [renewForm, setRenewForm] = useState({ plan: "PROFESSIONAL", maxCandidates: 300, expiresAt: "", features: ["cbt", "question-bank", "results"] });
  const [form, setForm] = useState({
    product: "nurse-cbt" as ProductId,
    institutionName: "",
    institutionId: "",
    contactEmail: "",
    plan: "PROFESSIONAL",
    maxCandidates: 300,
    expiresAt: "",
    features: DEFAULT_FEATURES["nurse-cbt"],
  });
  useEffect(() => {
    let cancelled = false;
    void fetch("https://api.github.com/repos/kelechikalu139-ship-i/cbt-platform/releases/latest")
      .then(async (response) => {
        if (!response.ok) return;
        const release = await response.json() as { assets?: Array<{ browser_download_url?: string; name?: string }> };
        const installer = release.assets?.find((asset) =>
          /(?:the-platform-)?cbt.*setup.*\.exe$/i.test(asset.name ?? "") && !/\.sha256$/i.test(asset.name ?? ""),
        ) ?? release.assets?.find((asset) =>
          /\.exe$/i.test(asset.name ?? "") && !/\.sha256$/i.test(asset.name ?? "") && /setup/i.test(asset.name ?? ""),
        );
        const resolved = normalizeDownloadUrl(installer?.browser_download_url);
        if (!cancelled && resolved) setInstallerDownloadUrl(resolved);
      })
      .catch(() => {
        const fallback = normalizeDownloadUrl(configuredInstallerUrl || FALLBACK_INSTALLER_URL)
        if (!cancelled && fallback) setInstallerDownloadUrl(fallback)
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("https://api.github.com/repos/kelechikalu139-ship-i/cbt-platform/releases?per_page=100")
      .then(async response => {
        if (!response.ok) return;
        const releases = await response.json() as Array<{ tag_name?: string; assets?: Array<{ name?: string; browser_download_url?: string }> }>;
        const caosceReleases = releases.flatMap(release => {
          const match = /^caosce-v(\d+)\.(\d+)\.(\d+)$/.exec(release.tag_name || "");
          if (!match) return [];
          const installer = release.assets?.find(asset => asset.name === `CAOSCE-Platform-Setup-v${match[1]}.${match[2]}.${match[3]}.exe`);
          const url = normalizeHttpsDownloadUrl(installer?.browser_download_url);
          return url ? [{ version: match.slice(1).map(Number), url }] : [];
        }).sort((a, b) => {
          for (let i = 0; i < 3; i++) if (a.version[i] !== b.version[i]) return b.version[i] - a.version[i];
          return 0;
        });
        // The configured installer URL (env VITE_CAOSCE_INSTALLER_URL, or the
        // hardcoded fallback below) is authoritative: the product owner chooses
        // which installer build to serve. GitHub auto-detect is only a last
        // resort when no explicit installer URL is configured.
        if (!cancelled && caosceReleases[0] && !FALLBACK_CAOSCE_DOWNLOAD_URL) {
          setCaosceInstallerDownloadUrl(caosceReleases[0].url);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function request(path: string, opts: RequestInit = {}, authToken = token) {
    if (!API) throw new Error(API_CONFIGURATION_ERROR);
    const r = await fetch(new URL(path, `${API}/`), {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    });
    const responseText = await r.text();
    let d: any = null;
    try {
      d = JSON.parse(responseText);
    } catch {
      // Non-JSON responses are reported below with the request route and status.
    }
    if (r.status === 401 && authToken && authToken === token) {
      setToken("");
      setUser(null);
    }
    const route = path.split("?")[0];
    if (!r.ok)
      throw new Error(
        d?.message ||
          `Licensing API request to ${route} failed with HTTP ${r.status}. Check the API URL and service deployment.`,
      );
    if (d === null)
      throw new Error(
        `Licensing API returned a non-JSON response for ${route}. Check that VITE_LICENSING_API_URL points to the licensing service.`,
      );
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
  useEffect(() => {
    storeSession(authMode === "mfa-setup" ? "" : token, authMode === "mfa-setup" ? null : user);
  }, [token, user, authMode]);
  const visibleItems = items.filter((licence) => {
    const matchesProduct = productFilter === "all" || licence.product === productFilter;
    const matchesStatus = statusFilter === "all" || licence.status === statusFilter;
    const query = searchText.trim().toLocaleLowerCase();
    const matchesSearch = !query || [
      licence.institution_name,
      licence.institution_id,
      licence.contact_email || "",
    ].some((value) => value.toLocaleLowerCase().includes(query));
    return matchesProduct && matchesStatus && matchesSearch;
  });
  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (loginBusy) return;
    setLoginBusy(true);
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
    } finally {
      setLoginBusy(false);
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
    setIssueBusy(true);
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
    } finally {
      setIssueBusy(false);
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
  async function offlineIssue(id: string, product: ProductId) {
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
      a.download = `${product}-license-${id}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      setError(e.message);
    }
  }
  function exportLicences() {
    const columns = [
      "Product",
      "Institution ID",
      "Institution",
      "Contact email",
      "Plan",
      "Status",
      "Candidate limit",
      "Issued",
      "Expires",
      "Installation ID",
      "Licence ID",
    ];
    const records = visibleItems.map((licence) => [
      PRODUCT_NAMES[licence.product],
      licence.institution_id,
      licence.institution_name,
      licence.contact_email || "",
      licence.plan,
      licence.status,
      licence.max_candidates,
      licence.issued_at,
      licence.expires_at || "",
      licence.installation_id || "",
      licence.id,
    ]);
    const csvCell = (value: string | number) => {
      const text = String(value);
      const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safeText.replace(/"/g, '""')}"`;
    };
    const csv = [columns, ...records].map((record) => record.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `product-licences-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function copyProductKey() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.activationKey);
      setCopyNotice("Product key copied to clipboard.");
    } catch {
      setError("Clipboard access failed. Select the key and copy it manually.");
    }
  }
  if (authMode === "mfa-login" && !token)
    return (
      <main className="login">
        <div className="brand"><div className="logo"><ShieldCheck /></div><p className="eyebrow">ACCOUNT SECURITY</p><h1>Verify itâ€™s you</h1><p className="muted">Enter a current code from your authenticator app or use one recovery code.</p></div>
        <section className="panel loginpanel"><form className="authfields" onSubmit={login}>
          <h2>Multi-factor verification</h2><p className="muted">Signing in as {email}</p>
          <label>Authenticator or recovery code<input type="text" autoComplete="one-time-code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} autoFocus required /></label>
          {error && <p className="error">{error}</p>}<button className="primary" disabled={loginBusy}><span className="spinner" aria-hidden="true" />{loginBusy ? "Verifyingâ€¦" : <><LogIn size={17} /> Verify and sign in</>}</button>
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
              <label>Setup key<div className="mfa-secret"><code>{mfaSecret || "Generatingâ€¦"}</code><button type="button" className="secondary" onClick={() => void navigator.clipboard.writeText(mfaSecret)}>Copy</button></div></label>
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
            Product
            <br />
            Licensing Portal
          </h1>
          <p className="muted">
            Manage product downloads, activation keys and licence entitlements.
          </p>
        </div>
        <section className="panel loginpanel">
          {authMode === "bootstrap" ? bootstrapStatus === "checking" ? (
            <div className="authfields"><h2>Checking setup link</h2><p className="muted">Verifying this one-time super-admin linkâ€¦</p></div>
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
          <button className="primary" disabled={loginBusy}>
            {loginBusy ? <><span className="spinner" aria-hidden="true" /> Signing inâ€¦</> : <><LogIn size={17} /> Sign in securely</>}
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
            <b>Product Licensing</b>
            <span>Administrator console Â· {user?.email}</span>
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
            Manage CBT and CAOSCE product licences, administrator access, activations and recent activity.
          </p>
        </div>
        <div className="download-actions" aria-label="Product installers">
          {installerDownloadUrl && (
            <button
              className="secondary"
              onClick={() =>
                window.open(installerDownloadUrl, "_blank", "noopener,noreferrer")
              }
            >
              <Download size={16} /> Download CBT installer
            </button>
          )}
          <button
            className="secondary"
            onClick={() => window.open(caosceInstallerDownloadUrl, "_blank", "noopener,noreferrer")}
          >
            <Download size={16} /> Download CAOSCE installer
          </button>
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
              <h2>{PRODUCT_NAMES[issued.product]} product key â€” shown once</h2>
              <p className="muted">
                Copy this key and send it to the customer using a secure
                channel. It cannot be retrieved later.
              </p>
            </div>
          </div>
          <code>{issued.activationKey}</code>
          <button
            className="secondary"
            onClick={() => void copyProductKey()}
          >
            <Copy size={16} /> Copy product key
          </button>
          {copyNotice && <span className="hint" role="status">{copyNotice}</span>}
          {issued.signedLicense && (
            <button
              className="secondary"
              onClick={() => {
                const blob = new Blob([JSON.stringify(issued.signedLicense, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${issued.product}-license-${issued.id}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <KeyRound size={16} /> Download signed licence
            </button>
          )}
          {issued.product === "caosce-platform" && (
            <p className="hint" role="status">
              CAOSCE does not yet validate these keys in the application. Do not rely on this key for access control until app-side activation is integrated.
            </p>
          )}
          {issued.product === "caosce-platform" && (
            <button
              className="secondary"
              onClick={() => window.open(caosceInstallerDownloadUrl, "_blank", "noopener,noreferrer")}
            >
              <Download size={16} /> Download CAOSCE installer
            </button>
          )}
          <button className="close" onClick={() => setIssued(null)}>
            Dismiss
          </button>
        </section>
      )}
      {showForm && (
        <form className="panel formpanel" onSubmit={create}>
          <h2>Issue a product licence</h2>
          <p className="muted">Choose which application this product key will activate. The same institution can hold a separate licence for each product.</p>
          <div className="formgrid">
            <label>
              Product
              <select
                value={form.product}
                onChange={(e) => {
                  const product: ProductId = e.target.value === "caosce-platform"
                    ? "caosce-platform"
                    : "nurse-cbt";
                  setForm({ ...form, product, features: DEFAULT_FEATURES[product] });
                }}
              >
                <option value="nurse-cbt">CBT Platform</option>
                <option value="caosce-platform">CAOSCE Platform</option>
              </select>
              <span className="hint">
                {form.product === "caosce-platform"
                  ? "Installer download is available. CAOSCE app-side key enforcement still needs integration."
                  : `This key is for ${PRODUCT_NAMES[form.product]} only.`}
              </span>
            </label>
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
            <button className="primary" disabled={issueBusy}>
              {issueBusy
                ? <><span className="spinner" aria-hidden="true" /> Generating keyâ€¦</>
                : <><KeyRound size={16} /> Generate product key</>}
            </button>
          </div>
        </form>
      )}
      {renewing && (
        <form className="panel formpanel" onSubmit={renew}>
          <h2>Renew {PRODUCT_NAMES[renewing.product]} licence for {renewing.institution_name}</h2>
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
      <section className="stats" aria-label="Licence summary">
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
        <div className="panel">
          <span>CBT licences</span>
          <b>{items.filter((x) => x.product === "nurse-cbt").length}</b>
        </div>
        <div className="panel">
          <span>CAOSCE licences</span>
          <b>{items.filter((x) => x.product === "caosce-platform").length}</b>
        </div>
      </section>
      <section className="panel tablepanel">
        <div className="tabletitle">
          <div>
            <h2>Customer register</h2>
            <p className="muted">Showing {visibleItems.length} of {items.length} licences</p>
          </div>
          {busy && <span className="muted">Loadingâ€¦</span>}
        </div>
        <div className="tabletools">
          <label className="searchfield">
            <span className="visually-hidden">Search institutions</span>
            <input
              type="search"
              placeholder="Search institution, ID or email"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </label>
          <label className="filterfield">
            <span className="visually-hidden">Filter by product</span>
            <select
              value={productFilter}
              onChange={(e) => {
                const value = e.target.value;
                setProductFilter(
                  value === "all" ? "all" : value === "caosce-platform" ? value : "nurse-cbt",
                );
              }}
            >
              <option value="all">All products</option>
              <option value="nurse-cbt">CBT Platform</option>
              <option value="caosce-platform">CAOSCE Platform</option>
            </select>
          </label>
          <label className="filterfield">
            <span className="visually-hidden">Filter by licence status</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                const value = e.target.value;
                setStatusFilter(
                  value === "all" ? "all" : value === "PENDING" || value === "ACTIVE" ||
                    value === "EXPIRED" || value === "SUSPENDED" || value === "REVOKED"
                    ? value
                    : "all",
                );
              }}
            >
              <option value="all">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="EXPIRED">Expired</option>
              <option value="REVOKED">Revoked</option>
            </select>
          </label>
          <div className="tabletool-actions">
            {(searchText || productFilter !== "all" || statusFilter !== "all") && (
              <button
                className="secondary"
                onClick={() => {
                  setSearchText("");
                  setProductFilter("all");
                  setStatusFilter("all");
                }}
              >
                Clear filters
              </button>
            )}
            <button className="secondary" disabled={!visibleItems.length} onClick={exportLicences}>
              <Download size={16} /> Export CSV
            </button>
          </div>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
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
              {visibleItems.map((x) => (
                <tr key={x.id}>
                  <td><span className={`product-badge ${x.product}`}>{PRODUCT_NAMES[x.product]}</span></td>
                  <td>
                    <b>{x.institution_name}</b>
                    <small>
                      {x.institution_id}
                      {x.contact_email ? ` Â· ${x.contact_email}` : ""}
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
                          aria-label={`Renew ${PRODUCT_NAMES[x.product]} licence for ${x.institution_name}`}
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
                          aria-label={`${x.status === "SUSPENDED" ? "Resume" : "Suspend"} licence for ${x.institution_name}`}
                          title={x.status === "SUSPENDED" ? "Resume licence" : "Suspend licence"}
                          onClick={() => void setSuspended(x)}
                        >
                          {x.status === "SUSPENDED" ? <Play size={16} /> : <Pause size={16} />}
                        </button>
                      )}
                      {!(["REVOKED", "SUSPENDED"].includes(x.status)) && (
                        <button
                          className="iconbutton"
                          aria-label={`Issue offline licence for ${x.institution_name}`}
                          title="Issue offline licence file"
                          onClick={() => void offlineIssue(x.id, x.product)}
                        >
                          <KeyRound size={16} />
                        </button>
                      )}
                      {x.status !== "REVOKED" && (
                        <button
                          className="iconbutton danger"
                          aria-label={`Revoke licence for ${x.institution_name}`}
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
          {items.length > 0 && !visibleItems.length && (
            <div className="empty">No licences match these search and product filters.</div>
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
                <th>Product</th>
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
                  <td>{event.metadata?.product ? PRODUCT_NAMES[event.metadata.product] : "â€”"}</td>
                  <td>{event.event_type.replace(/_/g, " ")}</td>
                  <td>{event.actor_email || "School installation"}</td>
                  <td>{event.installation_id || "â€”"}</td>
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
        Private product-owner portal Â· Use HTTPS, strong credentials, and
        restricted access in production.
      </footer>
    </main>
  );
}
