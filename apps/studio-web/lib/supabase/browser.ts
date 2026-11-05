import { createBrowserClient } from "@supabase/ssr";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;
let openingSession: Promise<void> | null = null;

export function createClient() {
  if (browserClient) return browserClient;
  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  return browserClient;
}

export async function ensureBrowserSession() {
  if (openingSession) return openingSession;
  openingSession = (async () => {
    const supabase = createClient();
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (session) return;
    const { error: anonymousError } = await supabase.auth.signInAnonymously();
    if (anonymousError) throw anonymousError;
  })();
  try { await openingSession; }
  finally { openingSession = null; }
}
