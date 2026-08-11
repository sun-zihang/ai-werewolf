import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { isOffline, useOffline } from "../offline";
import OfflineCard from "../components/OfflineCard";
import { AiProfilePublic, CreateGameResult, GameMode, LEVEL_LABEL, Preset, RoleAssignment } from "../types";
import Avatar from "../components/Avatar";
import LevelTag from "../components/LevelTag";

const MODE_OPTIONS: { id: "auto" | GameMode; label: string; hint: string; range: [number, number] | null }[] = [
  { id: "auto", label: "自动匹配", hint: "2-4 简易 / 5-8 标准 / 9-12 复杂", range: null },
  { id: "simple", label: "简易局", hint: "适合 3-4 人", range: [3, 4] },
  { id: "standard", label: "标准局", hint: "适合 5-8 人", range: [5, 8] },
  { id: "complex", label: "复杂局", hint: "适合 9-12 人", range: [9, 12] },
];

const ASSIGN_OPTIONS: { id: RoleAssignment; label: string; hint: string }[] = [
  { id: "random", label: "随机分配", hint: "角色完全随机" },
  { id: "strength", label: "强度匹配", hint: "强 AI 拿预言家/狼人，低级拿村民" },
  { id: "preference", label: "按偏好分配", hint: "优先满足每个 AI 的角色偏好" },
];

const PACE_OPTIONS: { id: "slow" | "normal" | "fast"; label: string; hint: string }[] = [
  { id: "slow", label: "真人节奏", hint: "贴近真人玩狼人杀，发言/投票从容，最适合观战" },
  { id: "normal", label: "适中", hint: "节奏均衡，整局约几分钟" },
  { id: "fast", label: "快进", hint: "快速推进，适合快速看结果" },
];

export default function NewGamePage({ go }: { go: (hash: string) => void }) {
  const [profiles, setProfiles] = useState<AiProfilePublic[]>([]);
  const offline = useOffline();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<"auto" | GameMode>("auto");
  const [assignment, setAssignment] = useState<RoleAssignment>("random");
  const [pace, setPace] = useState<"slow" | "normal" | "fast">("slow");
  const [override, setOverride] = useState<string>("");
  const [presetName, setPresetName] = useState("");
  const [humanCount, setHumanCount] = useState(0);
  const [created, setCreated] = useState<CreateGameResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listProfiles().then(setProfiles).catch((e) => { if (!isOffline()) setError(e.message); });
    api.listPresets().then(setPresets).catch(() => {});
  }, []);

  const n = selected.size;
  const total = n + humanCount;
  const modeOpt = MODE_OPTIONS.find((m) => m.id === mode)!;
  const modeError = modeOpt.range && (total < modeOpt.range[0] || total > modeOpt.range[1]);

  const sorted = useMemo(() => [...profiles].sort((a, b) => b.id - a.id), [profiles]);

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function overrides() {
    if (!override) return undefined;
    return Object.fromEntries([...selected].map((id) => [String(id), override]));
  }

  async function start() {
    if (total < 2) return setError("请至少选择 2 名玩家（AI + 真人）");
    if (modeError) return setError(`该模式需要 ${modeOpt.range![0]}-${modeOpt.range![1]} 人，当前 ${total} 人`);
    setBusy(true);
    setError("");
    try {
      const res = await api.createGame({
        ai_ids: [...selected],
        human_count: humanCount,
        mode,
        assignment,
        overrides: overrides(),
      });
      if (humanCount > 0) {
        // 含真人：先发邀请链接，等真人加入后再开始
        setCreated(res);
        setBusy(false);
      } else {
        await api.startGame(res.id, pace);
        go(`#/games/${res.id}`);
      }
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function beginGame() {
    if (!created) return;
    setBusy(true);
    try {
      await api.startGame(created.id, pace);
      go(`#/games/${created.id}`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function savePreset() {
    if (!presetName.trim()) return setError("请填写阵容名称");
    if (n < 2) return setError("请先选择 AI");
    try {
      await api.savePreset({ name: presetName.trim(), ai_ids: [...selected], config: { mode, assignment, override } });
      setPresetName("");
      setError("");
      api.listPresets().then(setPresets).catch(() => {});
    } catch (e: any) {
      setError(e.message);
    }
  }

  function usePreset(p: Preset) {
    setSelected(new Set(p.ai_ids));
    const cfg = p.config as { mode?: string; assignment?: string; override?: string };
    if (cfg.mode) setMode(cfg.mode as "auto" | GameMode);
    if (cfg.assignment) setAssignment(cfg.assignment as RoleAssignment);
    if (cfg.override) setOverride(cfg.override);
  }

  if (created) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1>等待真人加入</h1>
            <div className="sub">对局 #{created.id} 已创建 · 把链接发给真人玩家，多设备打开即可上桌</div>
          </div>
        </div>
        <div className="card room-card">
          <div className="section-title">真人加入链接</div>
          <div className="invite-list">
            {created.humanInvites?.map((inv) => {
              const link = `${location.origin}/#/play/${created.id}/${inv.token}`;
              return (
                <div className="invite-row" key={inv.seat}>
                  <span className="invite-seat">座位 {inv.seat}</span>
                  <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                  <button className="ghost" onClick={() => navigator.clipboard?.writeText(link)}>复制</button>
                </div>
              );
            })}
          </div>
          <div className="small muted" style={{ margin: "8px 0" }}>
            真人在各自设备打开链接、输入昵称占座；座位占满后即可开始。开局后真人角色随机，上桌才知道自己是狼还是好人。
          </div>
          {error && <div className="err small">{error}</div>}
          <div className="actions" style={{ marginTop: 8 }}>
            <button className="primary" onClick={beginGame} disabled={busy}>开始对局</button>
            <button className="ghost" onClick={() => setCreated(null)} disabled={busy}>返回修改</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>新建对局</h1>
          <div className="sub">选择参与对局的 AI，配置模式与角色分配方式{/* 也可加入真人玩家 */}</div>
        </div>
      </div>

      <div className="game-layout">
        <div>
          <div className="section-title">选择 AI（已选 {n}）</div>
          {sorted.length === 0 ? (
            offline ? <OfflineCard /> : <div className="empty">AI 库为空，请先到「AI 库」创建或导入 AI 档案。</div>
          ) : (
            <div className="game-list">
              {sorted.map((p) => (
                <div
                  key={p.id}
                  className={`game-item ${selected.has(p.id) ? "selected" : ""}`}
                  onClick={() => toggle(p.id)}
                >
                  <input type="checkbox" readOnly checked={selected.has(p.id)} style={{ pointerEvents: "none" }} />
                  <Avatar name={p.name} style={p.avatar_style} size={32} />
                  <div className="grow">
                    <div className="nm">{p.name}</div>
                    <div className="pr">{p.model}</div>
                  </div>
                  <LevelTag level={p.thinking_level} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="side-panel">
          <div className="card">
            <div className="section-title">对局配置</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {MODE_OPTIONS.map((m) => (
                <label className="check" key={m.id}>
                  <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} />
                  <span>{m.label} <span className="faint small">（{m.hint}）</span></span>
                </label>
              ))}
            </div>
            <label className="field">
              <span>角色分配</span>
              <select value={assignment} onChange={(e) => setAssignment(e.target.value as RoleAssignment)}>
                {ASSIGN_OPTIONS.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}（{a.hint}）</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>对局节奏</span>
              <select value={pace} onChange={(e) => setPace(e.target.value as "slow" | "normal" | "fast")}>
                {PACE_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}（{p.hint}）</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>真人玩家数量（0-4）</span>
              <select value={humanCount} onChange={(e) => setHumanCount(Number(e.target.value))}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <option key={i} value={i}>{i} 人{i === 0 ? "（纯 AI 对局）" : ""}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>对局内思考强度覆盖（可选）</span>
              <select value={override} onChange={(e) => setOverride(e.target.value)}>
                <option value="">不覆盖（用各 AI 自身设置）</option>
                {(["paper", "medium", "high", "extra"] as const).map((l) => (
                  <option key={l} value={l}>统一为「{LEVEL_LABEL[l]}」</option>
                ))}
              </select>
            </label>
            {modeError && <div className="err small">该模式需要 {modeOpt.range![0]}-{modeOpt.range![1]} 人，当前 {n} 人</div>}
            {error && <div className="err small">{error}</div>}
            <div className="actions" style={{ marginTop: 8 }}>
              <button className="primary" onClick={start} disabled={busy || n < 2 || !!modeError}>
                {busy ? "创建中…" : "开始对局"}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="section-title">预设阵容</div>
            {presets.length === 0 && <div className="small muted" style={{ marginBottom: 10 }}>还没有预设阵容</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {presets.map((p) => (
                <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="ghost" style={{ flex: 1, textAlign: "left" }} onClick={() => usePreset(p)}>
                    {p.name} <span className="faint small">（{p.ai_ids.length} 人）</span>
                  </button>
                  <button className="ghost danger" onClick={() => api.deletePreset(p.id).then(() => api.listPresets().then(setPresets))}>删</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" placeholder="阵容名称" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
              <button onClick={savePreset}>保存当前</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}