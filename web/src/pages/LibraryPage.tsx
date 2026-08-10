import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { AiProfilePublic, GameListItem, LEVEL_LABEL, LEVELS, ProviderMeta, Role, ROLES, ROLE_LABEL, STATUS_LABEL, TEAM_LABEL, ThinkingLevel } from "../types";
import Avatar from "../components/Avatar";
import LevelTag from "../components/LevelTag";
import Modal from "../components/Modal";

interface FormState {
  name: string;
  provider: string;
  model: string;
  base_url_override: string;
  api_key: string;
  thinking_level: ThinkingLevel;
  role_preference: Role[];
  language_style: string;
  avatar_style: string;
  description: string;
}

const AVATAR_STYLES = ["ink", "rust", "olive", "slate", "clay", "pine", "sand", "plum"];

const EMPTY: FormState = {
  name: "",
  provider: "openai",
  model: "",
  base_url_override: "",
  api_key: "",
  thinking_level: "medium",
  role_preference: [],
  language_style: "自然",
  avatar_style: "ink",
  description: "",
};

export default function LibraryPage({ go }: { go: (hash: string) => void }) {
  const [profiles, setProfiles] = useState<AiProfilePublic[]>([]);
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [search, setSearch] = useState("");
  const [filterProvider, setFilterProvider] = useState("");
  const [filterLevel, setFilterLevel] = useState("");
  const [editing, setEditing] = useState<AiProfilePublic | null>(null);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<AiProfilePublic | null>(null);
  const [detailGames, setDetailGames] = useState<GameListItem[]>([]);
  const [testing, setTesting] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<Record<number, { ok: boolean; msg: string }>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setProfiles(await api.listProfiles());
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    api.providers().then(setProviders).catch(() => {});
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((p) => {
      if (filterProvider && p.provider !== filterProvider) return false;
      if (filterLevel && p.thinking_level !== filterLevel) return false;
      if (q && !`${p.name} ${p.model} ${p.provider}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [profiles, search, filterProvider, filterLevel]);

  async function onDelete(p: AiProfilePublic) {
    if (!window.confirm(`确定删除 AI「${p.name}」？此操作不可恢复。`)) return;
    try {
      await api.deleteProfile(p.id);
      setTestResult((r) => ({ ...r, [p.id]: { ok: false, msg: "" } }));
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function onCopy(p: AiProfilePublic) {
    try {
      await api.createProfile({
        name: `${p.name}（副本）`,
        provider: p.provider,
        model: p.model,
        base_url_override: p.base_url_override,
        thinking_level: p.thinking_level,
        role_preference: p.role_preference,
        language_style: p.language_style,
        avatar_style: p.avatar_style,
        description: p.description,
      });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function onTest(p: AiProfilePublic) {
    setTesting(p.id);
    setTestResult((r) => ({ ...r, [p.id]: { ok: false, msg: "测试中…" } }));
    try {
      const res = await api.testProfile(p.id);
      setTestResult((r) => ({
        ...r,
        [p.id]: { ok: res.ok, msg: res.ok ? `连通正常 · ${res.latencyMs}ms` : res.error ?? "失败" },
      }));
    } catch (e: any) {
      setTestResult((r) => ({ ...r, [p.id]: { ok: false, msg: e.message } }));
    } finally {
      setTesting(null);
    }
  }

  function onImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = String(reader.result ?? "");
        const profiles: Record<string, unknown>[] = [];
        if (file.name.toLowerCase().endsWith(".json")) {
          const arr = JSON.parse(text);
          if (!Array.isArray(arr)) throw new Error("JSON 需为数组");
          profiles.push(...arr);
        } else {
          const lines = text.split(/\r?\n/).filter((l) => l.trim());
          const header = lines[0].split(",").map((s) => s.trim());
          for (const line of lines.slice(1)) {
            const cells = line.split(",").map((s) => s.trim());
            const obj: Record<string, string> = {};
            header.forEach((h, i) => (obj[h] = cells[i] ?? ""));
            profiles.push({
              name: obj.name,
              provider: obj.provider || "openai",
              model: obj.model || "",
              api_key: obj.api_key || undefined,
              thinking_level: (obj.thinking_level as ThinkingLevel) || "medium",
              role_preference: obj.role_preference ? obj.role_preference.split("|") : [],
              description: obj.description ?? "",
            });
          }
        }
        if (!profiles.length) throw new Error("没有可导入的档案");
        const res = await api.importProfiles(profiles);
        setError("");
        load();
        window.alert(`成功导入 ${res.created.length} 个 AI 档案`);
      } catch (e: any) {
        setError(`导入失败：${e.message}`);
      }
    };
    reader.readAsText(file);
  }

  function openDetail(p: AiProfilePublic) {
    setDetail(p);
    setDetailGames([]);
    api.listGamesByProfile(p.id).then(setDetailGames).catch(() => {});
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: "application/json" });
    downloadBlob(blob, "ai-profiles.json");
  }

  function exportCsv() {
    const header = "name,provider,model,thinking_level,role_preference,description,api_key_masked";
    const rows = profiles.map((p) =>
      [p.name, p.provider, p.model, p.thinking_level, p.role_preference.join("|"), p.description, p.has_key ? "***" : ""]
        .map((s) => `"${String(s).replaceAll('"', '""')}"`)
        .join(",")
    );
    const blob = new Blob(["\ufeff" + [header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, "ai-profiles.csv");
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>AI 库</h1>
          <div className="sub">共 {profiles.length} 个 AI 档案 · 上限 50</div>
        </div>
        <div className="toolbar">
          <input type="search" placeholder="搜索名称 / 模型 / 厂商" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={filterProvider} onChange={(e) => setFilterProvider(e.target.value)}>
            <option value="">全部厂商</option>
            {providers.filter((p) => p.id !== "local").map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}>
            <option value="">全部强度</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{LEVEL_LABEL[l]}</option>
            ))}
          </select>
          <button onClick={exportJson}>导出 JSON</button>
          <button onClick={exportCsv}>导出 CSV</button>
          <button onClick={() => fileRef.current?.click()}>导入</button>
          <button className="primary" onClick={() => setCreating(true)}>新建 AI</button>
          <input
            ref={fileRef} type="file" accept=".json,.csv" style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      {error && <div className="err" style={{ marginBottom: 14 }}>{error}</div>}

      {filtered.length === 0 ? (
        <div className="empty">还没有 AI 档案。点击「新建 AI」或「导入」开始添加。</div>
      ) : (
        <div className="profile-grid">
          {filtered.map((p) => {
            const tr = testResult[p.id];
            return (
              <div className="card profile-card" key={p.id}>
                <div className="row1">
                  <Avatar name={p.name} style={p.avatar_style} />
                  <div style={{ minWidth: 0 }}>
                    <div className="name" style={{ cursor: "pointer" }} onClick={() => openDetail(p)} title="查看详情">{p.name}</div>
                    <div className="provider">{providerLabel(providers, p.provider)} · {p.model}</div>
                  </div>
                </div>
                <div className="meta">
                  <LevelTag level={p.thinking_level} />
                  <span>胜率 {p.stats_win_rate}%</span>
                  <span>{p.stats_play_count} 局</span>
                  <span>{p.stats_mvp_count} MVP</span>
                </div>
                <div className="desc">{p.description || <span className="faint">暂无描述</span>}</div>
                <div className="meta">
                  <span className={p.has_key ? "ok" : "err"}>{p.has_key ? "已配置密钥" : "无密钥（本地兜底）"}</span>
                  {p.provider === "local" && <span className="tag">规则引擎</span>}
                </div>
                {tr && (
                  <div className={tr.ok ? "ok small" : "err small"} style={{ marginTop: 6 }}>
                    {testing === p.id ? <span className="spin" style={{ marginRight: 6 }} /> : null}
                    {tr.msg}
                  </div>
                )}
                <div className="ops">
                  <button onClick={() => openDetail(p)}>详情</button>
                  <button onClick={() => setEditing(p)}>编辑</button>
                  <button onClick={() => onCopy(p)}>复制</button>
                  <button onClick={() => onTest(p)} disabled={testing === p.id}>测连</button>
                  <button className="danger" onClick={() => onDelete(p)}>删除</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detail && (
        <DetailModal
          profile={detail}
          games={detailGames}
          providerLabel={providerLabel}
          onClose={() => setDetail(null)}
          go={go}
        />
      )}

      {(creating || editing) && (
        <ProfileFormModal
          providers={providers}
          profile={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            load();
          }}
          onError={setError}
          busy={busy}
          setBusy={setBusy}
        />
      )}
    </div>
  );
}

function providerLabel(providers: ProviderMeta[], id: string): string {
  return providers.find((p) => p.id === id)?.label ?? id;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function ProfileFormModal({
  providers,
  profile,
  onClose,
  onSaved,
  onError,
  busy,
  setBusy,
}: {
  providers: ProviderMeta[];
  profile: AiProfilePublic | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const isEdit = !!profile;
  const [form, setForm] = useState<FormState>(() =>
    profile
      ? {
          name: profile.name,
          provider: profile.provider,
          model: profile.model,
          base_url_override: profile.base_url_override ?? "",
          api_key: "",
          thinking_level: profile.thinking_level,
          role_preference: profile.role_preference,
          language_style: profile.language_style,
          avatar_style: profile.avatar_style,
          description: profile.description,
        }
      : { ...EMPTY, provider: providers[0]?.id ?? "openai" }
  );

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  function onProviderChange(id: string) {
    const p = providers.find((x) => x.id === id);
    const isDefaultModel = !!p && p.defaultModels.includes(form.model);
    set({
      provider: id,
      model: isDefaultModel || !form.model ? (p?.defaultModels[0] ?? "") : form.model,
    });
  }

  async function save() {
    if (!form.name.trim()) return onError("请填写名称");
    if (!form.model.trim()) return onError("请填写模型");
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        provider: form.provider,
        model: form.model.trim(),
        base_url_override: form.base_url_override.trim() || undefined,
        thinking_level: form.thinking_level,
        role_preference: form.role_preference,
        language_style: form.language_style.trim() || "自然",
        avatar_style: form.avatar_style,
        description: form.description.trim(),
      };
      if (form.api_key.trim()) body.api_key = form.api_key.trim();
      if (isEdit) await api.updateProfile(profile.id, body);
      else await api.createProfile(body);
      onError("");
      onSaved();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const provider = providers.find((p) => p.id === form.provider);

  return (
    <Modal title={isEdit ? "编辑 AI" : "新建 AI"} onClose={onClose} wide>
      <div className="form-grid">
        <label className="field">
          <span>名称 *</span>
          <input type="text" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="如：小灰、阿狸" />
        </label>
        <label className="field">
          <span>思考强度</span>
          <select value={form.thinking_level} onChange={(e) => set({ thinking_level: e.target.value as ThinkingLevel })}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{LEVEL_LABEL[l]}（{l === "paper" ? "极简" : l === "medium" ? "均衡" : l === "high" ? "深入" : "深度推演"}）</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>厂商 *</span>
          <select value={form.provider} onChange={(e) => onProviderChange(e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}{p.kind === "local" ? "（无需密钥）" : ""}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>模型 *</span>
          <input type="text" list="model-list" value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder="模型 ID" />
          <datalist id="model-list">
            {(provider?.defaultModels ?? []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>API 密钥 {isEdit && <span className="faint">（已保存，留空则不变）</span>}</span>
          <input
            type="password" value={form.api_key}
            onChange={(e) => set({ api_key: e.target.value })}
            placeholder={provider?.kind === "local" ? "本地引擎无需密钥" : "sk-..."}
            autoComplete="new-password"
          />
        </label>
        <label className="field">
          <span>自定义 API 地址（可选）</span>
          <input type="text" value={form.base_url_override} onChange={(e) => set({ base_url_override: e.target.value })} placeholder="默认使用厂商官方地址" />
        </label>
        <label className="field">
          <span>语言风格</span>
          <input type="text" value={form.language_style} onChange={(e) => set({ language_style: e.target.value })} placeholder="如：自然、犀利、温和" />
        </label>
        <label className="field">
          <span>头像色调</span>
          <select value={form.avatar_style} onChange={(e) => set({ avatar_style: e.target.value })}>
            {AVATAR_STYLES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <div className="field full">
          <span style={{ display: "block", fontSize: 12, color: "var(--ink-soft)", marginBottom: 6 }}>角色偏好（优先分配，可多选）</span>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {ROLES.map((r) => (
              <label className="check" key={r}>
                <input
                  type="checkbox"
                  checked={form.role_preference.includes(r)}
                  onChange={(e) =>
                    set({
                      role_preference: e.target.checked ? [...form.role_preference, r] : form.role_preference.filter((x) => x !== r),
                    })
                  }
                />
                {ROLE_LABEL[r]}
              </label>
            ))}
          </div>
        </div>
        <label className="field full">
          <span>描述</span>
          <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="这个人格的特点、说话风格等" />
        </label>
      </div>
      {provider?.note && <div className="small muted" style={{ marginTop: 4 }}>提示：{provider.note}</div>}
      <div className="actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={save} disabled={busy}>{busy ? "保存中…" : "保存"}</button>
      </div>
    </Modal>
  );
}
function DetailModal({
  profile,
  games,
  providerLabel,
  onClose,
  go,
}: {
  profile: AiProfilePublic;
  games: GameListItem[];
  providerLabel: (providers: ProviderMeta[], id: string) => string;
  onClose: () => void;
  go: (hash: string) => void;
}) {
  return (
    <Modal title="AI 详情" onClose={onClose} wide>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14 }}>
        <Avatar name={profile.name} style={profile.avatar_style} size={48} />
        <div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 18 }}>{profile.name}</div>
          <div className="muted">{providerLabel([], profile.provider)} · {profile.model}</div>
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <span style={{ display: "block", fontSize: 12, color: "var(--ink-soft)", marginBottom: 4 }}>思考强度</span>
          <LevelTag level={profile.thinking_level} />
        </div>
        <div className="field">
          <span style={{ display: "block", fontSize: 12, color: "var(--ink-soft)", marginBottom: 4 }}>密钥</span>
          <span className={profile.has_key ? "ok" : "err"}>{profile.has_key ? "已配置" : "未配置"}</span>
        </div>
        <div className="field full">
          <span style={{ display: "block", fontSize: 12, color: "var(--ink-soft)", marginBottom: 4 }}>角色偏好</span>
          <span>{profile.role_preference.length ? profile.role_preference.map((r) => ROLE_LABEL[r]).join("、") : "无"}</span>
        </div>
        <div className="field full">
          <span style={{ display: "block", fontSize: 12, color: "var(--ink-soft)", marginBottom: 4 }}>描述</span>
          <span>{profile.description || "—"}</span>
        </div>
        <div className="field full">
          <span style={{ display: "block", fontSize: 12, color: "var(--ink-soft)", marginBottom: 4 }}>统计</span>
          <span>胜率 {profile.stats_win_rate}% · {profile.stats_play_count} 局 · {profile.stats_mvp_count} MVP · 累计 token {profile.total_tokens_used}</span>
        </div>
      </div>
      <div className="section-title" style={{ marginTop: 12 }}>近期对局</div>
      {games.length === 0 ? (
        <div className="small muted">暂无对局记录</div>
      ) : (
        <table className="history-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>状态</th>
              <th>结果</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {games.slice(0, 8).map((g) => (
              <tr key={g.id} style={{ cursor: "pointer" }} onClick={() => { onClose(); go(`#/games/${g.id}`); }}>
                <td className="mono">#{g.id}</td>
                <td>{STATUS_LABEL[g.status]}</td>
                <td>{g.winner ? TEAM_LABEL[g.winner] : "—"}</td>
                <td><button className="ghost">查看</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="actions">
        <button onClick={onClose}>关闭</button>
      </div>
    </Modal>
  );
}