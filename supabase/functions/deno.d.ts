/**
 * Ambient TypeScript declarations for Supabase Edge Functions (Deno runtime)
 * so IDE and `tsc` resolve `Deno.*` globals without needing a separate Deno LSP install.
 */
declare namespace Deno {
  export const env: {
    get(key: string): string | undefined
    toObject(): Record<string, string>
  }

  export interface Conn {
    read(p: Uint8Array): Promise<number | null>
    write(p: Uint8Array): Promise<number>
    close(): void
  }

  export function connect(options: { hostname: string; port: number }): Promise<Conn>
  export function connectTls(options: { hostname: string; port: number }): Promise<Conn>
  export function startTls(conn: Conn, options: { hostname: string }): Promise<Conn>

  export function serve(handler: (req: Request) => Response | Promise<Response>): void
}
