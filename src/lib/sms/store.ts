/**
 * SMS session storage. The handler only depends on this interface, so tests
 * use the in-memory store while production uses Supabase (see
 * supabase-store.ts). Nothing here logs message content or phone numbers.
 */

export interface SmsImage {
  mediaType: string;
  data: string; // base64
}

export interface SmsTurn {
  role: "user" | "assistant";
  text: string;
  images?: SmsImage[];
}

export interface SmsSession {
  phone: string;
  optedIn: boolean;
  advisorId: string | null;
  /** Conversation history per advisor, so switching never mixes contexts. */
  turnsByAdvisor: Record<string, SmsTurn[]>;
}

export interface SmsStore {
  getSession(phone: string): Promise<SmsSession | null>;
  saveSession(session: SmsSession): Promise<void>;
  /**
   * Atomically claim a Twilio MessageSid. Returns false when the Sid was
   * already claimed, which is how duplicate webhook deliveries are dropped
   * without a second reply.
   */
  claimMessageSid(sid: string, phone: string): Promise<boolean>;
}

export function newSmsSession(phone: string): SmsSession {
  return { phone, optedIn: false, advisorId: null, turnsByAdvisor: {} };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Non-persistent store for tests and local development. */
export class MemorySmsStore implements SmsStore {
  private sessions = new Map<string, SmsSession>();
  private sids = new Set<string>();

  async getSession(phone: string): Promise<SmsSession | null> {
    const session = this.sessions.get(phone);
    return session ? clone(session) : null;
  }

  async saveSession(session: SmsSession): Promise<void> {
    this.sessions.set(session.phone, clone(session));
  }

  async claimMessageSid(sid: string): Promise<boolean> {
    if (this.sids.has(sid)) return false;
    this.sids.add(sid);
    return true;
  }
}
