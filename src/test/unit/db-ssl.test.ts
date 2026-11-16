import { describe, expect, it, vi } from 'vitest';
import { connectionOptions, getPool, resetDbForTests } from '../../server/db/pool';

describe('database TLS options', () => {
  it('removes the deprecated sslmode parameter and verifies certificates explicitly', () => {
    const options = connectionOptions('postgresql://user:pass@db.example.com:5432/app?sslmode=require&connect_timeout=5');
    expect(options.connectionString).not.toContain('sslmode');
    expect(options.connectionString).toContain('connect_timeout=5');
    expect(options.ssl).toEqual({ rejectUnauthorized: true, minVersion: 'TLSv1.2' });
  });

  it('honours explicit disable and no-verify modes without pg deprecation aliases', () => {
    expect(connectionOptions('postgresql://db.example.com/app?sslmode=disable')).toEqual({
      connectionString: 'postgresql://db.example.com/app', ssl: false,
    });
    expect(connectionOptions('postgresql://db.example.com/app?sslmode=no-verify')).toEqual({
      connectionString: 'postgresql://db.example.com/app', ssl: { rejectUnauthorized: false },
    });
  });

  it('leaves URLs without sslmode unchanged', () => {
    expect(connectionOptions('postgresql://db.example.com/app')).toEqual({ connectionString: 'postgresql://db.example.com/app' });
  });

  it('handles idle client errors instead of crashing the process', async () => {
    resetDbForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = getPool({ DATABASE_URL: 'postgresql://user:pass@127.0.0.1:1/app?sslmode=require' });
    expect(pool).not.toBeNull();
    expect(() => pool!.emit('error', new Error('idle client lost connection'))).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db_idle_client_error'));
    await pool!.end();
    resetDbForTests();
    warn.mockRestore();
  });
});
