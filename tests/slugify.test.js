import { describe, it, expect } from 'vitest';
import { slugify, slugifyWithPreview } from '../src/lib/slugify.js';

describe('slugify', () => {
  it('converts to lowercase with hyphens', () => {
    expect(slugify('My Project')).toBe('my-project');
  });

  it('handles Spanish accented characters', () => {
    expect(slugify('Café con Leche')).toBe('cafe-con-leche');
  });

  it('handles special characters in the remove regex', () => {
    expect(slugify('Hello (World)!')).toBe('hello-world');
  });

  it('handles numbers', () => {
    expect(slugify('Project 123')).toBe('project-123');
  });

  it('handles multiple spaces', () => {
    expect(slugify('hello   world')).toBe('hello-world');
  });

  it('handles Spanish n with tilde', () => {
    expect(slugify('España')).toBe('espana');
  });
});

describe('slugifyWithPreview', () => {
  it('returns original, slug and domain', () => {
    const result = slugifyWithPreview('My Project');
    expect(result.original).toBe('My Project');
    expect(result.slug).toBe('my-project');
    expect(result.domain).toBe('my-project.localhost');
  });

  it('domain always ends with .localhost', () => {
    const result = slugifyWithPreview('Test Site');
    expect(result.domain.endsWith('.localhost')).toBe(true);
  });

  it('slug matches domain prefix', () => {
    const result = slugifyWithPreview('Tienda Online');
    expect(result.domain).toBe(`${result.slug}.localhost`);
  });
});
