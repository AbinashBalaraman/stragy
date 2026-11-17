import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { parseConfig } from '../../server/config';
import { ResearchRepository } from '../../server/storage/repository';
import { parseMarketSnapshotResult } from '../../shared/contracts/scanner-results';

const repositories: ResearchRepository[] = [];

async function setup() {
  const config = parseConfig({ NODE_ENV: 'test', DATA_MODE: 'real', MARKET_PROVIDER: 'none', AI_PROVIDER: 'none', STORAGE_MODE: 'ephemeral' });
  const repository = await ResearchRepository.open({ maxRuns: 2 });
  repositories.push(repository);
  return createApp({ config, repository, enableVite: false });
}

beforeEach(() => { /* each test gets a fresh app instance */ });
afterEach(async () => { await Promise.all(repositories.splice(0).map(repository => repository.close())); });

describe('market scanner universe routes', () => {
  it('advertises every selectable universe with its published evaluation cap', async () => {
    const app = await setup();
    const response = await request(app).get('/api/market/universes');
    expect(response.status).toBe(200);
    const universes = response.body.universes as { id: string; evaluatedCap?: number; membershipBasis?: string }[];
    expect(universes.map(universe => universe.id)).toEqual(expect.arrayContaining(['NSE', 'BSE', 'BANK_NIFTY', 'NIFTY_IT', 'BSE_SENSEX', 'POPULAR_INDICES']));
    expect(universes.find(universe => universe.id === 'NSE')?.evaluatedCap).toBe(200);
    expect(universes.find(universe => universe.id === 'BANK_NIFTY')?.evaluatedCap).toBe(50);
    expect(universes.find(universe => universe.id === 'NIFTY_50')?.membershipBasis).toBe('official-feed');
  });

  it('serves a typed bundled-catalog snapshot for a sector universe instead of MEMBERSHIP_UNAVAILABLE', async () => {
    const app = await setup();
    const response = await request(app).get('/api/market/trends?universe=BANK_NIFTY');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.error).toBeUndefined();
    expect(response.body.membership).toMatchObject({ basis: 'bundled-catalog', verified: false, selected: 50 });
    expect(response.body.coverage).toMatchObject({ requested: 50, succeeded: 0, unavailable: 50 });
    expect(response.body.status).toBe('unavailable');
    expect(response.body.statusReason).toMatch(/No usable observations/);
    expect(response.body.recommendations.length).toBeGreaterThan(0);
    expect(response.body.retryable).toBe(true);
    expect(parseMarketSnapshotResult(response.body).membership?.verified).toBe(false);
  });

  it('caps broad NSE at 200 symbols rather than rejecting the request', async () => {
    const app = await setup();
    const response = await request(app).get('/api/market/trends?universe=NSE');
    expect(response.status).toBe(200);
    expect(response.body.membership).toMatchObject({ basis: 'bundled-catalog', selected: 200, cap: 200, truncated: true });
    expect(response.body.coverage.requested).toBe(200);
    expect(response.body.warnings.join(' ')).toMatch(/first 200 of/);
    expect(parseMarketSnapshotResult(response.body).status).toBe('unavailable');
  });

  it('keeps the honest unavailable status for an unknown universe', async () => {
    const app = await setup();
    const response = await request(app).get('/api/market/trends?universe=NO_SUCH_UNIVERSE');
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('UNKNOWN_UNIVERSE');
  });
});
