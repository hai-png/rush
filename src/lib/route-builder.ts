import type { ApiOptions } from '@/lib/api';

export type Handler = (...args: any[]) => Promise<any> | any;

export type RouteEntry = {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  options: ApiOptions;
  handler: Handler;
  raw?: boolean;
};

export function r(method: string, path: string, options: ApiOptions, handler: Handler, raw = false): RouteEntry {
  const paramNames: string[] = [];
  const patternStr = path.replace(/:([a-zA-Z_]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  return { method, pattern: new RegExp(`^${patternStr}$`), paramNames, options, handler, raw };
}

