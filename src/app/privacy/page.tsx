import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Cinq",
  description: "Privacy policy for the Cinq SMS/MMS pilot.",
};

export default function Privacy() {
  return (
    <div className="w-screen min-h-screen flex flex-col items-center p-4 sm:p-6" style={{ backgroundColor: "#FAF9F6" }}>
      <div className="w-full max-w-2xl font-serif" style={{ color: "#191816" }}>
        <h1 className="text-4xl font-normal tracking-tight" style={{ marginBottom: "0.5rem" }}>
          Privacy Policy
        </h1>
        <p className="text-sm" style={{ color: "#55514D", marginBottom: "1.5rem" }}>
          Effective date: October 28, 2026
        </p>
        <p className="text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          Cinq (“we,” “us”) is a consumer service with five AI advisors covering travel, style, interiors, drinks, and personal decisions. During the pilot, you can ask questions and send photos to Cinq by text message (SMS/MMS), and our backend generates answers sent back to your phone.
        </p>
        <h2 className="text-xl font-normal" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>What we collect</h2>
        <ul className="list-disc pl-5 text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          <li>Your phone number and messaging metadata (carrier, timestamps, delivery status) when you text us.</li>
          <li>Message content — the texts and photos you send us.</li>
          <li>Support records if you contact us for help.</li>
        </ul>
        <h2 className="text-xl font-normal" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>How we use it</h2>
        <ul className="list-disc pl-5 text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          <li>To deliver answers to your questions via SMS/MMS.</li>
          <li>To provide human support during published hours.</li>
          <li>To operate, troubleshoot, and improve the pilot.</li>
          <li>To comply with legal and carrier requirements.</li>
        </ul>
        <p className="text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          <strong>AI processing:</strong> your messages are processed by our AI backend to generate answers. Human reviewers may see messages for quality and support purposes during the pilot.
        </p>
        <h2 className="text-xl font-normal" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>What we don’t do</h2>
        <ul className="list-disc pl-5 text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          <li>We <strong>do not sell</strong> your personal information.</li>
          <li>We <strong>do not share your opt-in data or consent</strong> with third parties for their marketing purposes.</li>
          <li>Our messaging provider processes messages on our behalf only to deliver the service.</li>
        </ul>
        <h2 className="text-xl font-normal" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>Retention and deletion</h2>
        <p className="text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          We keep messages for the duration of the pilot to operate the service. You can request deletion of your messages and number at any time by emailing amar@cinqcollective.com or texting STOP — we will confirm when complete.
        </p>
        <h2 className="text-xl font-normal" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>Your choices</h2>
        <ul className="list-disc pl-5 text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          <li>Text <strong>STOP</strong>, STOPALL, UNSUBSCRIBE, CANCEL, END, or QUIT to opt out at any time. You will receive one confirmation text and no further texts.</li>
          <li>Text <strong>START</strong> or UNSTOP to opt back in.</li>
          <li>Text <strong>HELP</strong> or INFO for help and our contact information.</li>
        </ul>
        <h2 className="text-xl font-normal" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>Security and children</h2>
        <p className="text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          We use reasonable safeguards, but no messaging channel is completely secure — don’t send highly sensitive information by text. Cinq is for users 18 and older; do not use it if you are under 18.
        </p>
        <h2 className="text-xl font-normal" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>Changes</h2>
        <p className="text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          We may update this policy as the pilot evolves; the current version will always be at this URL.
        </p>
        <p className="text-base leading-relaxed" style={{ marginTop: "1.5rem" }}>
          <strong>Contact:</strong> amar@cinqcollective.com
        </p>
        <p className="text-sm" style={{ color: "#55514D", marginTop: "2rem" }}>
          <Link href="/" className="underline underline-offset-4 hover:underline">Back to Cinq</Link>
        </p>
      </div>
    </div>
  );
}
