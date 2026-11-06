# Inquiry to Blooio before committing (ready to send)

**Subject:** Apple Messages for Business pilot: written confirmation before we commit

Hello Blooio team,

We're preparing a small pilot of Apple Messages for Business for Cinq, a consumer service of five AI advisors: travel, style, home design, drinks (wine, cocktails and spirits), and personal advice on complex decisions. Customers start every conversation. Our own server receives your webhooks and replies through your v4 API, and a person from our team handles the conversation when a customer asks for one.

This is only about **Apple Messages for Business**: your `amb` channel, connected through Apple Business Register as our Messaging Service Provider. We are **not** asking about your iMessage, SMS, RCS or WhatsApp lines. Please quote Apple Messages for Business separately from those products and their pricing.

Before we commit, could you confirm the following in writing?

**1. Apple approval**
- That Blooio is an Apple-approved Messaging Service Provider for Apple Messages for Business today, and appears in the MSP list in Apple Business Register.
- That our connection would be Apple's official Messages for Business service, linked to our Business ID through Apple Business Register, and not a relay through an Apple Account or device.

**2. Eligibility**
- That an AI-first consumer service like ours (five AI advisors with a live-agent path) is eligible, and that you have launched comparable brands.
- Anything in our categories that Apple has questioned in review. One of our advisors gives personal advice on complex decisions; it is not medical or health advice.

**3. Pilot pricing**
- Your Apple Messages for Business price per monthly active user, and any platform fee, setup or managed-launch fee, and minimum commitment or term.
- The number of agent-inbox seats included, and the price of more.
- Whether a test account costs anything before Apple's Experience Review.

**4. Human support**
- How your agent inbox receives a handoff, and whether there is an API to start one (we found the `handoff.*` webhook events, but no endpoint to create a handoff).
- Apple's requirements for live-agent availability, and what published hours you've seen accepted for a small team, including out-of-hours replies.

**5. Retention and deletion**
- How long you keep Apple Messages for Business conversations and attachments: message text, the decrypted files you re-host, and the signed URLs you give us.
- Whether we can shorten that retention or delete a conversation and its attachments on request, and through which API.
- Your backup retention, and how long deleted data can remain in backups.
- Your data processing agreement and sub-processors.

**6. Photos and messages**
- The format customers' iPhone photos arrive in through your webhook: HEIC, or converted to JPEG. Can you deliver a JPEG version?
- The attachment size limit, the lifetime of your signed attachment URLs, and the hostnames they are served from (we only download from listed hosts).
- The maximum length of one text message on Apple Messages for Business.
- Whether URLs in our text are sent as rich links automatically, or whether we should send `rich_link` messages.
- Whether your conversation-state limits (for example `conversation_streak_limit` and `conversation_awaiting_reply`) apply to Apple Messages for Business chats. Our answers can arrive as several messages in a row.

**7. Testing**
- Whether we can get a test account and test Business ID connected before signing, and the steps and timing to Experience Review.

Thank you. We'd like to have these in writing before choosing an MSP.

Best regards,
[Name]
[Role], Cinq
[Email]
