/** Extract the service name from any form a command argument can take:
 *  - plain string (from item.command.arguments)
 *  - tree Node { kind: 'service', svc: ServiceSnapshot } (from context menu)
 *  - legacy { svc: string } or { name: string } shapes */
export function extractSvcName(arg: string | Record<string, unknown> | undefined): string | null {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object') {
    if (arg['kind'] === 'service' && arg['svc'] && typeof (arg['svc'] as Record<string, unknown>)['name'] === 'string') {
      return (arg['svc'] as Record<string, unknown>)['name'] as string;
    }
    if (typeof arg['svc'] === 'string') return arg['svc'];
    if (typeof arg['name'] === 'string') return arg['name'];
  }
  return null;
}
