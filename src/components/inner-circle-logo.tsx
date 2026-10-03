export function InnerCircleLogo({ size = 120 }: { size?: number }) {
  return (
    <div style={{ textAlign: "center" }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        fill="none"
        style={{ display: "inline-block", marginBottom: "8px" }}
      >
        {/* Charcoal brush circle */}
        <circle
          cx="60"
          cy="60"
          r="50"
          fill="none"
          stroke="currentColor"
          strokeWidth="12"
          opacity="0.8"
          style={{
            filter: "drop-shadow(0 0 0.5px rgba(0,0,0,0.1))",
          }}
        />
        {/* Add slight texture with overlapping strokes */}
        <circle
          cx="60"
          cy="60"
          r="48"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.3"
        />
      </svg>
      <div
        style={{
          fontSize: "14px",
          letterSpacing: "4px",
          fontWeight: "300",
          color: "currentColor",
        }}
      >
        inner circle
      </div>
    </div>
  );
}
