import { LEVEL_LABEL, ThinkingLevel } from "../types";

export default function LevelTag({ level }: { level: ThinkingLevel }) {
  return <span className={`tag ${level === "extra" || level === "high" ? "accent" : ""}`}>{LEVEL_LABEL[level]}</span>;
}