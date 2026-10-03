export function InnerCircleLogo({ size = 120 }: { size?: number }) {
  return (
    <div style={{ textAlign: "center" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/inner-circle-logo.png"
        alt="Inner Circle"
        width={size}
        height={size}
        style={{
          display: "inline-block",
          marginBottom: "8px",
          objectFit: "contain",
        }}
      />
    </div>
  );
}
