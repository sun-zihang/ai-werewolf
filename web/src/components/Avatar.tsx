const PALETTE: Record<string, string> = {
  ink: "#4a443c",
  rust: "#b3402a",
  olive: "#6b7a3f",
  slate: "#5a6b78",
  clay: "#a06a3f",
  pine: "#2f6b4f",
  sand: "#9a8a5f",
  plum: "#7d5a78",
};

function hashName(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarColor(style: string, name: string): string {
  if (PALETTE[style]) return PALETTE[style];
  const keys = Object.keys(PALETTE);
  return PALETTE[keys[hashName(name) % keys.length]];
}

export default function Avatar({ name, style, size = 40 }: { name: string; style?: string; size?: number }) {
  const bg = avatarColor(style ?? "", name);
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.45, background: bg }}>
      {name.slice(0, 1)}
    </div>
  );
}