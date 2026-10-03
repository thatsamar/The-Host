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
        {/* Charcoal brush circle with organic, irregular edges */}
        <defs>
          <filter id="brushTexture">
            <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="4" result="noise" seed="42" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>

        {/* Primary brush stroke circle with irregular edges */}
        <circle
          cx="60"
          cy="60"
          r="50"
          fill="none"
          stroke="currentColor"
          strokeWidth="12"
          opacity="0.85"
          filter="url(#brushTexture)"
          style={{
            filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.08))",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }}
        />

        {/* Secondary texture layer for depth */}
        <circle
          cx="60"
          cy="60"
          r="48"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.25"
        />

        {/* Subtle pigment variation */}
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.5"
          opacity="0.15"
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
