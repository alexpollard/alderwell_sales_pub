declare module 'npm:@supabase/supabase-js@2' {
  export function createClient(url: string, key: string, options?: unknown): any;
}

declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined;
  }

  function serve(
    handler: (req: Request) => Response | Promise<Response>,
  ): void;
}
