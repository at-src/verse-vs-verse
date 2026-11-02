import { describe, expect, it } from 'vitest';
import { fallbackScene, sanitizeProps, validateScene } from './scenes.js';

describe('clay scene validation', () => {
  const base = { keyword: 'dandelions', mood: 'day', ground: true, mascot: { pose: 'sit', x: 370, y: 352, scale: 1, facing: 'right' }, props: [{ id: 'flowers', svg: '<g fill="#5ea85a"><path d="M100 300 L100 220" stroke="#4f9a62" stroke-width="5"/></g>', enter: 'grow' }] };
  it('sanitizes safe props and strips malicious SVG', () => {
    expect(sanitizeProps(base.props)[0]?.svg).toContain('<path');
    expect(() => sanitizeProps([{ id: 'bad', enter: 'pop', svg: '<g><script>alert(1)</script></g>' }])).toThrow();
    expect(() => sanitizeProps([{ id: 'bad', enter: 'pop', svg: '<g><rect onload="alert(1)"/></g>' }])).toThrow();
  });
  it('rejects bad pose and mood', () => {
    expect(() => validateScene({ ...base, mascot: { ...base.mascot, pose: 'dance' } }, 'in a field of dandelions')).toThrow('pose');
    expect(() => validateScene({ ...base, mood: 'cyber' }, 'in a field of dandelions')).toThrow('mood');
  });
  it('uses the simple fallback scene for unusable model output', () => {
    expect(fallbackScene('my cat stole the controller', 'day')).toMatchObject({ keyword: 'my', mood: 'day', props: [] });
  });
});
