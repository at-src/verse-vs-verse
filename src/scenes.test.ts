import { describe, expect, it } from 'vitest';
import { fallbackScene, sanitizeProps, sanitizeSvg, validateScene } from './scenes.js';

describe('clay scene validation', () => {
  const base = { keyword: 'dandelions', mood: 'day', ground: true, mascot: { pose: 'sit', x: 370, y: 352, scale: 1, facing: 'right' }, props: [{ id: 'flowers', svg: '<g fill="#5ea85a"><path d="M100 300 L100 220" stroke="#4f9a62" stroke-width="5"/></g>', enter: 'grow' }] };
  it('sanitizes safe props and strips malicious SVG', () => {
    expect(sanitizeProps(base.props)[0]?.svg).toContain('<path');
    expect(sanitizeProps([{ id: 'bad', enter: 'pop', svg: '<g><script>alert(1)</script></g>' }])).toEqual([]);
    expect(sanitizeProps([{ id: 'bad', enter: 'pop', svg: '<g><rect onload="alert(1)"/></g>' }])[0]?.svg).not.toContain('onload');
  });
  it('repairs bad pose and mood', () => {
    expect(validateScene({ ...base, mascot: { ...base.mascot, pose: 'dance' } }, 'in a field of dandelions').mascot.pose).toBe('stand');
    expect(validateScene({ ...base, mood: 'cyber' }, 'in a field of dandelions', 'dream').mood).toBe('dream');
  });
  it('uses the simple fallback scene for unusable model output', () => {
    expect(fallbackScene('my cat stole the controller', 'day')).toMatchObject({ keyword: 'cat', mood: 'day', props: [] });
  });
  it('snaps colors and drops harmless disallowed attributes/elements while blocking active SVG',()=>{
    const repaired=sanitizeSvg('<g><path fill="#e9d1bf" d="M5 5L10 10" onclick="x"/><text>bad</text><circle cx="20" cy="20" r="3" fill="#ffd23f"/></g>');
    expect(repaired).toContain('fill="#d9cfc0"');expect(repaired).not.toContain('onclick');expect(repaired).not.toContain('<text');
    expect(sanitizeSvg('<g><circle fill="red" cx="1" cy="1" r="1"/></g>')).toContain('fill="#c96f4a"');
    const unsafe=sanitizeSvg('<g><script>x</script><foreignObject>bad</foreignObject><image href="https://evil"/><path href="x" fill="url(https://evil)" onload="x" d="M0 0"/></g>');
    expect(unsafe).not.toMatch(/script|foreignObject|image|href|url\(|onload/i);
  });
});
