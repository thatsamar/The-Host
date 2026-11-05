import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
import Link from "next/link";

export const metadata: Metadata = {
  alternates: { canonical: `${SITE_URL}/privacy` },
  title: "Privacy Policy — Cinq",
  description: "How Cinq handles your information on cinqcollective.com and in the Cinq by text pilot.",
};

export default function Privacy() {
  return (
    <div className="w-screen min-h-screen flex flex-col items-center p-4 sm:p-6" style={{ backgroundColor: "#FAF9F6" }}>
      <div className="w-full max-w-2xl font-serif" style={{ color: "#191816" }}>
        <h1 className="text-4xl font-normal tracking-tight" style={{ marginBottom: "0.5rem" }}>
          Privacy Policy
        </h1>
        <p className="text-sm" style={{ color: "#55514D", marginBottom: "1.5rem" }}>
          Effective date: November 5, 2026
        </p>
        <p className="text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          Cinq (“we,” “us”) is a consumer service with five AI advisors covering travel, style, design, wine, cocktails &amp; spirits, and sounding-board conversations. Cinq is operated by Amar Lalvani, a sole proprietor based in Austin, Texas. You can ask the advisors questions and share photos on our website, cinqcollective.com, and, during the pilot, by text message (SMS/MMS) to +1 (855) 360-4983.
        </p>
        <h2 className="text-xl font-normal" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>On the website</h2>
        <p className="text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          The website needs no account. Your questions and photos are sent to our AI provider to write the answer and are not saved as a conversation history. While an answer is being written, the answer text alone is held for 15 minutes after its last update, so it can reach you if your connection drops. Our server logs record timings, counts and error codes, not what you asked.
        </p>
        <h2 className="text-xl font-normal" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>By text message</h2>
        <h2 className="text-xl font-normal" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>What we collect</h2>
        <ul className="list-disc pl-5 text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          <li>Your phone number and messaging metadata (carrier, timestamps, delivery status) when you text us.</li>
          <li>Message content — the texts and photos you send us.</li>
          <li>Support records if you contact us for help.</li>
        </ul>
        <h2 className="text-xl font-normal" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>How we use it</h2>
        <ul className="list-disc pl-5 text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          <li>To deliver answers to your questions via SMS/MMS.</li>
          <li>To reply when you contact us for help.</li>
          <li>To operate, troubleshoot, and improve the pilot.</li>
          <li>To comply with legal and carrier requirements.</li>
        </ul>
        <p className="text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          <strong>AI processing:</strong> your questions and photos are processed by our AI model provider, Anthropic, to generate answers. During the pilot, Cinq’s operator may review text conversations for quality and support.
        </p>
        <h2 className="text-xl font-normal" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>What we don’t do</h2>
        <ul className="list-disc pl-5 text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          <li>We <strong>do not sell</strong> your personal information.</li>
          <li>We <strong>do not share your SMS opt-in data or consent</strong> with third parties.</li>
          <li>No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. Text messaging originator opt-in data and consent will not be shared with any third parties.</li>
        </ul>
        <h2 className="text-xl font-normal" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>Service providers</h2>
        <p className="text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          These companies process information on our behalf, only to run Cinq: Twilio (sending and receiving text messages), Anthropic (generating answers), Supabase (storing text conversations and opt-in status) and Vercel (hosting the website and service).
        </p>
        <h2 className="text-xl font-normal" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>Retention and deletion</h2>
        <p className="text-base leading-relaxed" style={{ marginBottom: "1rem" }}>
          We keep text conversations for the duration of the pilot so advisors can follow up in the same thread. To request deletion of your messages and number, email amar@cinqcollective.com — we will confirm when complete. Texting STOP opts you out of further texts; it does not delete your history.
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
          <strong>Contact:</strong> Cinq, operated by Amar Lalvani, sole proprietor, Austin, Texas · <a href="mailto:amar@cinqcollective.com" className="underline underline-offset-4">amar@cinqcollective.com</a>
        </p>
        <p className="text-sm" style={{ color: "#55514D", marginTop: "2rem" }}>
          <Link href="/" className="underline underline-offset-4 hover:underline">Back to Cinq</Link>
        </p>
      </div>
    </div>
  );
}
