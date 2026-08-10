import { DecisionInput, DecisionOutput, ROLE_LABEL } from "../types.js";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rint(n: number): number {
  return Math.floor(Math.random() * n);
}

const SPEECH_POOL: Record<string, string[]> = {
  werewolf: ["我暂时没什么信息，先听大家发言。", "我觉得 X 号发言有点可疑。", "我是好人，跟着预言家走。", "今天先不急着下结论，再看一轮。"],
  villager: ["我先说说自己的看法，感觉 X 号比较可疑。", "我没什么特别的信息，但觉得 X 号的发言有矛盾。", "听了一圈，我倾向投 X 号。", "我是普通村民，谁发言有逻辑漏洞我就投谁。"],
  seer: ["我这边暂时没有太多可说的，多听几轮。", "我怀疑 X 号，理由稍后给出。", "先不要乱投，等神职给信息。"],
  witch: ["我关注晚上的刀型，白天先观察。", "我暂时没有明确怀疑对象。", "X 号发言有点问题，我记下了。"],
  hunter: ["我是好人，先观望。", "别惹我，我有自己的判断。", "我倾向投 X 号。"],
  idiot: ["哈哈，我今天就想看看谁会来票我。", "我没什么身份，随便聊聊。", "X 号别带节奏，我盯着你呢。"],
};

function replaceX(s: string, aliveIds: number[]): string {
  const x = pick(aliveIds);
  return s.replaceAll("X 号", `${x} 号`);
}

export function localSpeech(input: DecisionInput): DecisionOutput {
  const pool = SPEECH_POOL[input.player.role] ?? SPEECH_POOL.villager;
  const aliveOthers = input.context.alive.filter((p) => p.id !== input.player.id).map((p) => p.id);
  const text = replaceX(pick(pool), aliveOthers.length ? aliveOthers : [input.player.id]);
  return { action: "speak", content: text, reason: "本地规则引擎" };
}

export function localVote(input: DecisionInput): DecisionOutput {
  const others = input.context.alive.filter((p) => p.id !== input.player.id);
  if (!others.length) return { action: "vote", target_id: null, reason: "无人可投" };
  const target = others[rint(others.length)];
  return { action: "vote", target_id: target.id, reason: "本地规则引擎随机怀疑" };
}

export function localNight(input: DecisionInput): DecisionOutput {
  const others = input.context.alive.filter((p) => p.id !== input.player.id).map((p) => p.id);
  const { requiredAction, player } = input;
  if (requiredAction === "night_kill") {
    const target = pick(others);
    return { action: "kill", target_id: target, reason: "本地规则引擎随机刀人" };
  }
  if (requiredAction === "night_check") {
    const target = pick(others);
    return { action: "check", target_id: target, reason: "本地规则引擎随机查验" };
  }
  if (requiredAction === "night_save") {
    // 60% 概率救人，否则空过
    return Math.random() < 0.6
      ? { action: "save", target_id: input.context.privateInfo.length ? input.context.privateInfo[0].startsWith("昨夜") ? others[0] : null : null, reason: "本地规则引擎" }
      : { action: "save", target_id: null, reason: "本地规则引擎选择不救" };
  }
  if (requiredAction === "night_poison") {
    return Math.random() < 0.2 ? { action: "poison", target_id: pick(others), reason: "本地规则引擎" } : { action: "poison", target_id: null, reason: "本地规则引擎选择不毒" };
  }
  if (requiredAction === "hunter_shot") {
    return Math.random() < 0.5 ? { action: "shoot", target_id: pick(others), reason: "本地规则引擎" } : { action: "shoot", target_id: null, reason: "本地规则引擎不开枪" };
  }
  return localSpeech(input);
}

export function decideLocal(input: DecisionInput): DecisionOutput {
  switch (input.requiredAction) {
    case "day_speech":
    case "last_words":
      return localSpeech(input);
    case "day_vote":
      return localVote(input);
    default:
      return localNight(input);
  }
}

export function fallbackSpeech(input: DecisionInput): DecisionOutput {
  return { action: "speak", content: `（${ROLE_LABEL[input.player.role]}·预设话术）我暂时没什么信息，先观望。`, reason: "降级兜底" };
}