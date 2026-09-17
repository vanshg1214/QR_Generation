export default function Logo({ tone = "dark", size = "md" }) {
  const markBg = tone === "light" ? "#ffffff" : "#e7f0ea";
  const markColor = tone === "light" ? "#123c2c" : "#123c2c";
  const wordColor = tone === "light" ? "#ffffff" : "#16211c";
  const accentColor = tone === "light" ? "#bfe6cf" : "#1f7a4d";

  return (
    <span className={`logo logo-${size}`}>
      <span className="logo-mark" style={{ background: markBg, color: markColor }}>
        L2Q
      </span>
      <span className="logo-word" style={{ color: wordColor }}>
        LINK<span style={{ color: accentColor }}>-2-</span>QR
      </span>
    </span>
  );
}
