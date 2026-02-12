const { parseAllowedOrigins, createCorsOriginChecker, validateCorsConfiguration } = require('../../src/config/cors');

describe('CORS configuration hardening', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('rejects empty origin config in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;
    delete process.env.FRONTEND_URL;

    const result = validateCorsConfiguration();
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/CORS_ORIGINS/i);
  });

  test('uses explicit allowlist in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://app.example.com, https://admin.example.com';
    delete process.env.FRONTEND_URL;

    expect(parseAllowedOrigins()).toEqual([
      'https://app.example.com',
      'https://admin.example.com'
    ]);

    const result = validateCorsConfiguration();
    expect(result.valid).toBe(true);
  });

  test('allows FRONTEND_URL fallback only outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CORS_ORIGINS;
    process.env.FRONTEND_URL = 'http://localhost:5173';

    expect(parseAllowedOrigins()).toEqual(['http://localhost:5173']);
    expect(validateCorsConfiguration().valid).toBe(true);
  });

  test('origin checker allows known origin and blocks unknown origin', (done) => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://app.example.com';

    const checker = createCorsOriginChecker();

    checker('https://app.example.com', (allowErr, allowed) => {
      expect(allowErr).toBeNull();
      expect(allowed).toBe(true);

      checker('https://evil.example.com', (denyErr) => {
        expect(denyErr).toBeInstanceOf(Error);
        expect(denyErr.message).toMatch(/not allowed/i);
        done();
      });
    });
  });
});
