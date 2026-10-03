export function InnerCircleLogo({ size }: { size?: number }) {
  const displaySize = size !== undefined ? size : "1em";

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
          width: displaySize,
          height: displaySize,
          objectFit: "contain",
        }}
      />
    </div>
  );
}
