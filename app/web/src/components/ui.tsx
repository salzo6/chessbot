import { motion } from "framer-motion";

export function PageHeader({
  eyebrow,
  title,
  desc,
  right,
}: {
  eyebrow: string;
  title: string;
  desc?: string;
  right?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-end justify-between gap-6 mb-8"
    >
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-brass mb-3">
          {eyebrow}
        </div>
        <h1 className="text-[40px] leading-[1.02] text-ivory">{title}</h1>
        {desc && <p className="text-mist text-[14.5px] mt-3 max-w-[560px] leading-relaxed">{desc}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </motion.div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "brass" | "sage" | "ember" | "azure";
}) {
  const map: Record<string, string> = {
    neutral: "text-mist border-line-2",
    brass: "text-brass border-brass-deep/60",
    sage: "text-sage border-sage/40",
    ember: "text-ember border-ember/40",
    azure: "text-azure border-azure/40",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] px-2 py-1 rounded-md border ${map[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  size = "md",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "outline";
  disabled?: boolean;
  size?: "sm" | "md";
  type?: "button" | "submit";
}) {
  const base =
    "focusable inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed select-none";
  const sizes = { sm: "text-[12.5px] px-3 py-1.5", md: "text-[13.5px] px-4 py-2.5" };
  const variants: Record<string, string> = {
    primary:
      "text-[#1a1407] hover:brightness-110 active:scale-[0.98] shadow-[0_8px_24px_-10px_rgba(200,163,91,0.7)]",
    outline: "text-ivory border border-line-2 hover:border-brass/60 hover:bg-white/[0.02] active:scale-[0.98]",
    ghost: "text-mist hover:text-ivory hover:bg-white/[0.03]",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]}`}
      style={
        variant === "primary"
          ? { background: "linear-gradient(180deg,var(--color-brass-bright),var(--color-brass))" }
          : undefined
      }
    >
      {children}
    </button>
  );
}

export function Sparkline({ data, w = 96, h = 26 }: { data: number[]; w?: number; h?: number }) {
  if (!data || data.length < 2) return <div style={{ width: w, height: h }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = data[data.length - 1] >= data[0];
  const stroke = up ? "var(--color-sage)" : "var(--color-ember)";
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle
        cx={(w).toString()}
        cy={(h - ((data[data.length - 1] - min) / span) * (h - 4) - 2).toString()}
        r={2}
        fill={stroke}
      />
    </svg>
  );
}

export function botInitials(name: string) {
  const parts = (name || "").replace(/[^a-zA-Z0-9 ]/g, "").split(" ").filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, accent, size = 38 }: { name: string; accent: string; size?: number }) {
  return (
    <div
      className="grid place-items-center rounded-[10px] shrink-0 font-mono font-medium"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.32,
        color: accent,
        background: `linear-gradient(155deg, ${accent}22, ${accent}08)`,
        border: `1px solid ${accent}33`,
      }}
    >
      {botInitials(name)}
    </div>
  );
}
