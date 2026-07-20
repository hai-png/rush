export type Transition<S extends string> = {
  from: S; to: S; event: string; sideEffects?: string[];
  guard?: (ctx: unknown) => boolean | Promise<boolean>;
};

export class InvalidTransitionError extends Error {
  constructor(from: string, event: string) { super(`No transition from '${from}' on event '${event}'`); }
}

export function defineStateMachine<S extends string>(def: { initial: S; transitions: Transition<S>[] }) {
  return {
    initial: def.initial,
    transitions: def.transitions,

    resolve(current: S, event: string): Transition<S> {
      const t = def.transitions.find(t => t.from === current && t.event === event);
      if (!t) throw new InvalidTransitionError(current, event);
      return t;
    },
    can(current: S, event: string): boolean {
      return def.transitions.some(t => t.from === current && t.event === event);
    },
  };
}
