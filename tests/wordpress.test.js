import { describe, it, expect } from 'vitest';
import { getLocalSiteUrl } from '../src/lib/wordpress.js';

describe('getLocalSiteUrl', () => {
  it('returns plain http url for linux + docker (uses Traefik)', () => {
    const url = getLocalSiteUrl({ domain: 'mysite.localhost', engine: 'docker', platform: 'linux' });
    expect(url).toBe('http://mysite.localhost');
  });

  it('returns http url with port for Windows', () => {
    const url = getLocalSiteUrl({
      domain: 'mysite.localhost',
      engine: 'docker',
      platform: 'win32',
      localApachePort: 8080
    });
    expect(url).toBe('http://mysite.localhost:8080');
  });

  it('returns http url with port for Podman on Linux', () => {
    const url = getLocalSiteUrl({
      domain: 'mysite.localhost',
      engine: 'podman',
      platform: 'linux',
      localApachePort: 8080
    });
    expect(url).toBe('http://mysite.localhost:8080');
  });

  it('returns https url with port when localHttps is enabled on Windows', () => {
    const url = getLocalSiteUrl({
      domain: 'mysite.localhost',
      engine: 'docker',
      platform: 'win32',
      localHttps: true,
      localHttpsPort: 8443
    });
    expect(url).toBe('https://mysite.localhost:8443');
  });

  it('returns https url with port when localHttps is enabled on Podman', () => {
    const url = getLocalSiteUrl({
      domain: 'mysite.localhost',
      engine: 'podman',
      platform: 'linux',
      localHttps: true,
      localHttpsPort: 9443
    });
    expect(url).toBe('https://mysite.localhost:9443');
  });

  it('falls back to localhost when domain is empty on Windows', () => {
    const url = getLocalSiteUrl({
      domain: '',
      engine: 'docker',
      platform: 'win32',
      localApachePort: 8080
    });
    expect(url).toBe('http://localhost:8080');
  });

  it('uses custom apache port', () => {
    const url = getLocalSiteUrl({
      domain: 'mysite.localhost',
      engine: 'podman',
      platform: 'linux',
      localApachePort: 9090
    });
    expect(url).toBe('http://mysite.localhost:9090');
  });
});
