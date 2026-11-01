import { describe, expect, it } from 'vitest';
import { applyActorPersona } from './identity.js';

describe('demo actor persona identity', () => {
  it('credits and dedupes an allowed actor by persona', () => {
    expect(applyActorPersona('demo_bot', '42', '!line [lofi_lena] my cat stole the controller', ['demo_bot'])).toEqual({
      login: 'lofi_lena', userId: 'persona:lofi_lena', text: '!line my cat stole the controller',
    });
    expect(applyActorPersona('demo_bot', '42', '!2 [chai_coder]', ['demo_bot'])).toEqual({
      login: 'chai_coder', userId: 'persona:chai_coder', text: '!2',
    });
  });

  it('ignores persona tags from non-actors', () => {
    expect(applyActorPersona('regular_viewer', '99', '!line [lofi_lena] my cat stole the controller', ['demo_bot'])).toEqual({
      login: 'regular_viewer', userId: '99', text: '!line [lofi_lena] my cat stole the controller',
    });
  });
});
