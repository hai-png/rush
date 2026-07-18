import { describe, it, expect } from 'vitest';
import { defineStateMachine, InvalidTransitionError } from './state-machine';

const sm = defineStateMachine<'a' | 'b' | 'c'>({
  initial: 'a',
  transitions: [{ from: 'a', to: 'b', event: 'go' }, { from: 'b', to: 'c', event: 'finish' }],
});

describe('state machine', () => {
  it('resolves valid transitions', () => {
    expect(sm.resolve('a', 'go').to).toBe('b');
  });
  it('throws InvalidTransitionError on illegal transition', () => {
    expect(() => sm.resolve('a', 'finish')).toThrow(InvalidTransitionError);
  });
  it('can() reports transition legality without throwing', () => {
    expect(sm.can('a', 'go')).toBe(true);
    expect(sm.can('c', 'go')).toBe(false);
  });
});
