import assert from 'node:assert/strict';
import test from 'node:test';
import { Encoder, Profile } from '@garmin/fitsdk';
import {
  computeNormalizedPower,
  detectPowerIntervals,
  resampleTelemetrySamples,
  summarizeTelemetrySamples,
} from '../src/lib/telemetryCore';
import type { TelemetrySample } from '../src/lib/activityExport';
import worker from '../worker/index';
import type { Env } from '../worker/index';

class MockKVNamespace {
  readonly store = new Map<string, { value: string; expirationTtl?: number }>();

  async get(key: string, _type?: 'text'): Promise<string | null> {
    return this.store.get(key)?.value ?? null;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    this.store.set(key, { value, expirationTtl: options?.expirationTtl });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function createEnv(kv?: MockKVNamespace): Env {
  return {
    ASSETS: {
      fetch: async () => new Response('<html>SPA</html>', { status: 200 }),
    } as unknown as Fetcher,
    MCP_TOKENS: kv as unknown as KVNamespace | undefined,
    MCP_TOKEN_PEPPER: 'unit-test-pepper',
  };
}

function makeFakeJwt(payloadObj: Record<string, unknown>): string {
  const b64 = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payloadObj)}.testsig`;
}

function buildSampleFitBuffer(durationSec = 120): ArrayBuffer {
  const encoder = new Encoder();
  const baseMs = Date.UTC(2026, 10, 1, 12, 0, 0);

  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    manufacturer: 'development',
    product: 1,
    timeCreated: new Date(baseMs),
    type: 'activity',
  });

  for (let sec = 0; sec < durationSec; sec++) {
    const isHard = (sec >= 20 && sec < 55) || (sec >= 75 && sec < 110);
    const power = isHard ? 320 : 170;
    encoder.onMesg(Profile.MesgNum.RECORD, {
      timestamp: new Date(baseMs + sec * 1000),
      power,
      heartRate: isHard ? 168 : 132,
      cadence: isHard ? 96 : 84,
      enhancedSpeed: isHard ? 11.2 : 8.5,
      distance: sec * 9.5,
      enhancedAltitude: 100 + sec * 0.1,
    });
  }

  encoder.onMesg(Profile.MesgNum.LAP, {
    startTime: new Date(baseMs),
    timestamp: new Date(baseMs + 59 * 1000),
    totalElapsedTime: 60,
    totalTimerTime: 60,
    totalDistance: 570,
    avgPower: 255,
    maxPower: 320,
    avgHeartRate: 150,
    maxHeartRate: 168,
    avgCadence: 90,
  });

  encoder.onMesg(Profile.MesgNum.LAP, {
    startTime: new Date(baseMs + 60 * 1000),
    timestamp: new Date(baseMs + (durationSec - 1) * 1000),
    totalElapsedTime: 60,
    totalTimerTime: 60,
    totalDistance: 570,
    avgPower: 260,
    maxPower: 320,
    avgHeartRate: 155,
    maxHeartRate: 168,
    avgCadence: 92,
  });

  const u8 = encoder.close();
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function buildZrHtml(loaderPayload: Record<string, unknown>): string {
  const payload = JSON.stringify({ matches: [{ l: loaderPayload }] });
  return `<!doctype html><html><script>window.$_TSR={};$_TSR.router=($R=>${payload})($R["tsr"]);</script></html>`;
}

interface MockFetchState {
  currentAccessToken: string;
  currentRefreshToken: string;
  fitS3Status: number;
  refreshCalls: number;
  fitBytes: ArrayBuffer;
}

function installMockFetch(state: MockFetchState): () => void {
  const originalFetch = globalThis.fetch;
  const rider1001Token = state.currentAccessToken;
  const rider2002Token = makeFakeJwt({
    sub: 'rider-2002',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'https://secure.zwift.com/auth/realms/zwift',
  });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(urlStr);
    const headers = new Headers(init?.headers);
    const auth = headers.get('Authorization') ?? '';

    if (urlStr.startsWith('https://secure.zwift.com/')) {
      state.refreshCalls++;
      const nextAccess = makeFakeJwt({
        sub: 'rider-1001',
        refreshed: state.refreshCalls,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'https://secure.zwift.com/auth/realms/zwift',
      });
      state.currentAccessToken = nextAccess;
      state.currentRefreshToken = `zwift-refresh-v${state.refreshCalls + 1}`;
      return new Response(
        JSON.stringify({
          access_token: nextAccess,
          refresh_token: state.currentRefreshToken,
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.hostname === 'us-or-rly101.zwift.com') {
      const token = auth.replace(/^Bearer\s+/, '');
      const isRider2002 = token === rider2002Token;
      const isRider1001 = token === state.currentAccessToken || token === rider1001Token;
      if (!isRider1001 && !isRider2002) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      }

      if (url.pathname === '/api/profiles/me') {
        return Response.json(
          isRider2002
            ? { id: 2002, firstName: 'Rival', lastName: 'Two', weight: 75000, ftp: 300 }
            : { id: 1001, firstName: 'Jane', lastName: 'Racer', weight: 65000, ftp: 260 },
        );
      }

      if (url.pathname === '/api/profiles/1001') {
        return Response.json({
          id: 1001,
          firstName: 'Jane',
          lastName: 'Racer',
          weight: 65000,
          ftp: 260,
          competitionMetrics: { racingScore: 410, category: 'B' },
        });
      }

      if (url.pathname === '/api/profiles/2002') {
        return Response.json({
          id: 2002,
          firstName: 'Rival',
          lastName: 'Two',
          weight: 75000,
          ftp: 300,
          competitionMetrics: { racingScore: 520, category: 'A' },
        });
      }

      if (url.pathname === '/api/profiles/1001/activities') {
        return Response.json([
          {
            id: 5550001,
            id_str: '5550001',
            profileId: 1001,
            worldId: 1,
            name: 'ZRL Tuesday Crit',
            sport: 'CYCLING',
            startDate: '2026-11-20T18:00:00.000Z',
            endDate: '2026-11-20T18:30:00.000Z',
            movingTimeInMs: 1800_000,
            distanceInMeters: 21500,
            totalElevation: 210,
            avgWatts: 255,
            maxWatts: 680,
            avgHeartRate: 162,
            maxHeartRate: 181,
            eventSubgroupId: 8801,
            fitFileBucket: 'zwift-prod-fit',
            fitFileKey: 'activities/5550001.fit',
          },
          {
            id: 5550002,
            id_str: '5550002',
            profileId: 1001,
            worldId: 9,
            name: 'Watopia Easy Spin',
            sport: 'CYCLING',
            startDate: '2026-11-18T15:00:00.000Z',
            endDate: '2026-11-18T15:45:00.000Z',
            movingTimeInMs: 2700_000,
            distanceInMeters: 26000,
            totalElevation: 140,
            avgWatts: 175,
          },
        ]);
      }

      if (url.pathname === '/api/activities/5550001') {
        return Response.json({
          id: 5550001,
          id_str: '5550001',
          profileId: 1001,
          worldId: 1,
          name: 'ZRL Tuesday Crit',
          sport: 'CYCLING',
          startDate: '2026-11-20T18:00:00.000Z',
          endDate: '2026-11-20T18:30:00.000Z',
          movingTimeInMs: 1800_000,
          distanceInMeters: 21500,
          totalElevation: 210,
          avgWatts: 255,
          normalizedPower: 268,
          maxWatts: 680,
          avgHeartRate: 162,
          maxHeartRate: 181,
          avgCadenceInRotationsPerMinute: 91,
          maxCadenceInRotationsPerMinute: 112,
          avgSpeedInMetersPerSecond: 11.94,
          profileFtp: 260,
          profile: { id: 1001, weight: 65000 },
          fitFileBucket: 'zwift-prod-fit',
          fitFileKey: 'activities/5550001.fit',
          fitnessData: {
            fullDataUrl: 'https://cdn.zwift.com/fitness/5550001.json',
          },
          eventInfo: {
            id: 9001,
            eventSubGroupId: 8801,
            name: 'ZRL Tuesday Crit',
            subgroupTotalEntrantCount: 24,
          },
        });
      }

      if (url.pathname === '/api/activities/9990002') {
        return Response.json({
          id: 9990002,
          id_str: '9990002',
          profileId: 2002,
          name: 'Rival Secret Race',
          profile: { id: 2002, weight: 75000 },
          fitFileBucket: 'zwift-prod-fit',
          fitFileKey: 'activities/9990002.fit',
        });
      }

      if (url.pathname === '/api/profiles/1001/activities/9990002') {
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      }

      if (url.pathname === '/api/power-curve/power-profile') {
        return Response.json({
          zftp: 264,
          zmap: 330,
          vo2max: 58.4,
          cpBestEfforts: {
            pointsWatts: { '5': 720, '60': 410, '300': 320, '1200': 275 },
          },
          relevantCpEfforts: {
            pointsWatts: { '5': 700, '60': 400, '300': 312, '1200': 268 },
          },
        });
      }

      if (url.pathname === '/api/public/events/9001') {
        return Response.json({
          id: 9001,
          name: 'ZRL Tuesday Crit',
          worldId: 1,
          distanceInMeters: 21500,
          categoryEnforcement: true,
          eventSubgroups: [
            { id: 8800, subgroupLabel: 'A', label: 1, distanceInMeters: 21500 },
            { id: 8801, subgroupLabel: 'B', label: 2, distanceInMeters: 21500 },
          ],
        });
      }

      if (url.pathname === '/api/race-results/entries') {
        return Response.json([
          {
            profileId: 1001,
            rank: 3,
            profileData: { firstName: 'Jane', lastName: 'Racer', weightInGrams: 65000 },
            activityData: { durationInMilliseconds: 1800_000, segmentDistanceInCentimeters: 2150000 },
            sensorData: { avgWatts: 255, heartRateData: { avgHeartRate: 162, maxHeartRate: 181 } },
          },
          {
            profileId: 3003,
            rank: 1,
            profileData: { firstName: 'Fast', lastName: 'Leader', weightInGrams: 70000 },
            activityData: { durationInMilliseconds: 1785_000, segmentDistanceInCentimeters: 2150000 },
            sensorData: { avgWatts: 290, heartRateData: { avgHeartRate: 170, maxHeartRate: 189 } },
          },
        ]);
      }
    }

    if (url.hostname === 'zwift-prod-fit.s3.amazonaws.com') {
      if (state.fitS3Status !== 200) {
        return new Response('Forbidden', { status: state.fitS3Status });
      }
      return new Response(state.fitBytes, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    }

    if (urlStr === 'https://cdn.zwift.com/fitness/5550001.json') {
      return Response.json({
        timeInSec: Array.from({ length: 40 }, (_, i) => i),
        watts: Array.from({ length: 40 }, (_, i) => (i >= 10 && i < 30 ? 310 : 180)),
        heartRate: Array.from({ length: 40 }, () => 155),
        cadence: Array.from({ length: 40 }, () => 90),
        speedInCmPerSec: Array.from({ length: 40 }, () => 1000),
        distanceInCm: Array.from({ length: 40 }, (_, i) => i * 1000),
        altitudeInCm: Array.from({ length: 40 }, (_, i) => 10000 + i * 10),
      });
    }

    if (url.hostname === 'zwiftpower.com') {
      if (url.pathname.includes('ucp.php')) {
        return new Response('', {
          status: 302,
          headers: { 'Set-Cookie': 'zp_session=mockcookie; Path=/' },
        });
      }
      if (url.pathname === '/cache3/profile/1001_all.json') {
        return Response.json({
          data: [
            {
              zid: '9001',
              event_title: 'ZRL Tuesday Crit',
              event_date: Math.floor(Date.parse('2026-11-20T18:00:00.000Z') / 1000),
              f_t: 'TYPE_RACE',
              distance: 21.5,
              position_in_cat: 2,
              category: 'B',
              time: [1800, 0],
              avg_power: [255, 0],
              np: [268, 0],
              avg_wkg: ['3.92', 0],
              avg_hr: [162, 0],
              max_hr: [181, 0],
              w5: ['710', 0],
              w15: ['600', 0],
              w30: ['500', 0],
              w60: ['395', 0],
              w120: ['345', 0],
              w300: ['310', 0],
              w1200: ['270', 0],
            },
          ],
        });
      }
      if (url.pathname === '/cache3/results/9001_view.json') {
        return Response.json({
          data: [
            {
              zwid: 3003,
              name: 'Fast Leader',
              category: 'B',
              uid: '8801_3003',
              position_in_cat: 1,
              pos: 1,
              time: [1785, 0],
              avg_power: [290, 0],
              avg_wkg: ['4.14', 0],
              div: 20,
              w5: ['820', 0],
              wkg5: ['11.7', 0],
            },
            {
              zwid: 1001,
              name: 'Jane Racer',
              category: 'B',
              uid: '8801_1001',
              position_in_cat: 2,
              pos: 2,
              time: [1800, 0],
              avg_power: [255, 0],
              avg_wkg: ['3.92', 0],
              div: 20,
              w5: ['710', 0],
              wkg5: ['10.9', 0],
            },
          ],
        });
      }
      if (url.pathname === '/cache3/results/9001_zwift.json') {
        return Response.json({ data: [] });
      }
    }

    if (url.hostname === 'zwiftracing.app') {
      if (url.pathname === '/riders/1001') {
        return new Response(
          buildZrHtml({
            riderId: 1001,
            velo: { race: 615.4 },
            phenotype: { label: 'puncheur', confidence: 0.88 },
            history: [
              {
                event: {
                  eventId: '9001',
                  time: Math.floor(Date.parse('2026-11-20T18:00:00.000Z') / 1000),
                  title: 'ZRL Tuesday Crit',
                  type: 'Race',
                  subType: 'Points',
                  subgroupId: 'B',
                  distance: 21.5,
                  elevation: 210,
                  routeName: 'Neokyo Crit Course',
                },
                place: { positionInCategory: 3, penTotal: 24 },
                race: { time: 1800, gap: 15, wkgAvg: 3.92 },
                velo: {
                  intensity: 0.94,
                  elo: { before: 602.1, after: 615.4, adjustedChange: 13.3, eventRating: 595 },
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        );
      }
      if (url.pathname === '/events/9001') {
        return new Response(
          buildZrHtml({
            eventId: '9001',
            title: 'ZRL Tuesday Crit',
            distance: 21.5,
            elevation: 210,
            route: { name: 'Neokyo Crit Course', world: 'Makuri Islands' },
            pens: [
              { id: '8800', name: 'A', rangeLabel: '520-690', riders: [] },
              {
                id: '8801',
                name: 'B',
                rangeLabel: '380-520',
                points: { sof: 595 },
                riders: [
                  { riderId: 3003, name: 'Fast Leader', position: 1, time: 1785, rating: 640 },
                  {
                    riderId: 1001,
                    name: 'Jane Racer',
                    position: 3,
                    time: 1800,
                    expectedPosition: 4,
                    phenotype: { label: 'puncheur' },
                    velo: { elo: { before: 602.1, after: 615.4, adjustedChange: 13.3 } },
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        );
      }
    }

    return new Response(`Unhandled mock URL: ${urlStr}`, { status: 404 });
  }) as typeof globalThis.fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function callMcp(
  env: Env,
  body: unknown,
  token?: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return worker.fetch(
    new Request('https://zwift-victims.example/mcp', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  );
}

test('telemetryCore computes NP, resampling, summaries, and power intervals accurately', () => {
  const samples: TelemetrySample[] = [];
  for (let sec = 0; sec < 120; sec++) {
    const powerW = sec >= 30 && sec < 70 ? 340 : 160;
    samples.push({
      elapsedSec: sec,
      powerW,
      wkg: Number((powerW / 65).toFixed(2)),
      heartRateBpm: sec >= 30 && sec < 70 ? 170 : 130,
      cadenceRpm: 90,
      speedKmh: 36,
      distanceM: sec * 10,
      altitudeM: 100 + sec * 0.2,
    });
  }

  const np = computeNormalizedPower(samples);
  assert.ok(np !== undefined && np > 220 && np < 340, `Expected NP in range, got ${np}`);

  const resampled5 = resampleTelemetrySamples(samples, 5);
  assert.equal(resampled5.length, 24);
  assert.equal(resampled5[0].elapsedSec, 0);
  assert.equal(resampled5[1].elapsedSec, 5);

  const summary = summarizeTelemetrySamples(samples, 65);
  assert.equal(summary.sampleCount, 120);
  assert.equal(summary.maxPowerW, 340);
  assert.equal(summary.normalizedPowerW, np);

  const intervals = detectPowerIntervals(samples, { thresholdW: 250, weightKg: 65, minEffortSec: 30 });
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].avgPowerW, 340);
  assert.ok(intervals[0].durationSec >= 35);
});

test('Worker MCP handles unconfigured KV gracefully and enforces origin & Streamable HTTP rules', async () => {
  const accessToken = makeFakeJwt({
    sub: 'rider-1001',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'https://secure.zwift.com/auth/realms/zwift',
  });
  const restoreFetch = installMockFetch({
    currentAccessToken: accessToken,
    currentRefreshToken: 'zwift-refresh-1',
    fitS3Status: 200,
    refreshCalls: 0,
    fitBytes: buildSampleFitBuffer(60),
  });

  try {
    const noKvEnv = createEnv(undefined);

    const listNoKv = await worker.fetch(
      new Request('https://zwift-victims.example/api/mcp/tokens', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      noKvEnv,
    );
    assert.equal(listNoKv.status, 200);
    const listBody = (await listNoKv.json()) as { configured: boolean; tokens: unknown[] };
    assert.equal(listBody.configured, false);
    assert.deepEqual(listBody.tokens, []);

    const mintNoKv = await worker.fetch(
      new Request('https://zwift-victims.example/api/mcp/tokens', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label: 'Test' }),
      }),
      noKvEnv,
    );
    assert.equal(mintNoKv.status, 503);

    const mcpNoKv = await callMcp(noKvEnv, { jsonrpc: '2.0', id: 1, method: 'ping' }, 'zv_mcp_abc.def');
    assert.equal(mcpNoKv.status, 503);

    const kv = new MockKVNamespace();
    const env = createEnv(kv);

    const crossOrigin = await worker.fetch(
      new Request('https://zwift-victims.example/api/mcp/tokens', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Origin: 'https://evil.example',
        },
      }),
      env,
    );
    assert.equal(crossOrigin.status, 403);

    const optRes = await worker.fetch(
      new Request('https://zwift-victims.example/mcp', { method: 'OPTIONS' }),
      env,
    );
    assert.equal(optRes.status, 204);
    assert.equal(optRes.headers.get('Access-Control-Allow-Origin'), '*');

    const getRes = await worker.fetch(
      new Request('https://zwift-victims.example/mcp', { method: 'GET' }),
      env,
    );
    assert.equal(getRes.status, 405);

    const delRes = await worker.fetch(
      new Request('https://zwift-victims.example/mcp', { method: 'DELETE' }),
      env,
    );
    assert.equal(delRes.status, 204);

    const unauthRes = await callMcp(env, { jsonrpc: '2.0', id: 1, method: 'ping' });
    assert.equal(unauthRes.status, 401);
    assert.ok(unauthRes.headers.get('WWW-Authenticate')?.includes('Bearer'));
  } finally {
    restoreFetch();
  }
});

test('Token minting encrypts Zwift secrets at rest, refreshes expired access tokens, and enforces revocation', async () => {
  const initialAccessToken = makeFakeJwt({
    sub: 'rider-1001',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'https://secure.zwift.com/auth/realms/zwift',
  });
  const rivalAccessToken = makeFakeJwt({
    sub: 'rider-2002',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'https://secure.zwift.com/auth/realms/zwift',
  });
  const state: MockFetchState = {
    currentAccessToken: initialAccessToken,
    currentRefreshToken: 'zwift-refresh-initial',
    fitS3Status: 200,
    refreshCalls: 0,
    fitBytes: buildSampleFitBuffer(60),
  };
  const restoreFetch = installMockFetch(state);

  try {
    const kv = new MockKVNamespace();
    const env = createEnv(kv);

    // Mint token with near-expiry Zwift access token (30s left) so MCP triggers refresh automatically.
    const mintRes = await worker.fetch(
      new Request('https://zwift-victims.example/api/mcp/tokens', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${initialAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refreshToken: state.currentRefreshToken,
          expiresAt: Date.now() + 30_000,
          label: 'Laptop Gemini CLI',
          ttlDays: 30,
        }),
      }),
      env,
    );
    assert.equal(mintRes.status, 201);
    const minted = (await mintRes.json()) as {
      token: string;
      metadata: { tokenId: string; label: string };
    };
    assert.ok(minted.token.startsWith('zv_mcp_'));
    const secretPart = minted.token.split('.')[1];

    // Confirm zero plaintext Zwift secrets or MCP token secret appear in raw KV values.
    const rawKvEntry = kv.store.get(`mcp:tok:${minted.metadata.tokenId}`)?.value ?? '';
    assert.ok(rawKvEntry.length > 0);
    assert.ok(!rawKvEntry.includes(initialAccessToken));
    assert.ok(!rawKvEntry.includes(state.currentRefreshToken));
    assert.ok(!rawKvEntry.includes(secretPart));

    // Confirm another user cannot see or revoke this token.
    const rivalRevoke = await worker.fetch(
      new Request(`https://zwift-victims.example/api/mcp/tokens/${minted.metadata.tokenId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${rivalAccessToken}` },
      }),
      env,
    );
    assert.equal(rivalRevoke.status, 404);

    // Trigger tool call -> proactively refreshes Zwift token and updates ciphertext & IV in KV.
    const curveRes = await callMcp(
      env,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_power_curve', arguments: { range: '90d' } },
      },
      minted.token,
    );
    assert.equal(curveRes.status, 200);
    assert.equal(state.refreshCalls, 1);
    const updatedKvEntry = kv.store.get(`mcp:tok:${minted.metadata.tokenId}`)?.value ?? '';
    assert.notEqual(updatedKvEntry, rawKvEntry);
    assert.ok(!updatedKvEntry.includes(state.currentAccessToken));

    // Owner revokes token -> immediate 401 on /mcp.
    const revokeRes = await worker.fetch(
      new Request(`https://zwift-victims.example/api/mcp/tokens/${minted.metadata.tokenId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${initialAccessToken}` },
      }),
      env,
    );
    assert.equal(revokeRes.status, 200);

    const afterRevoke = await callMcp(env, { jsonrpc: '2.0', id: 2, method: 'ping' }, minted.token);
    assert.equal(afterRevoke.status, 401);

    // Mint two more tokens and test revoke-all.
    for (const label of ['Client A', 'Client B']) {
      const r = await worker.fetch(
        new Request('https://zwift-victims.example/api/mcp/tokens', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${initialAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ refreshToken: 'r', expiresAt: Date.now() + 3600_000, label }),
        }),
        env,
      );
      assert.equal(r.status, 201);
    }
    const revokeAllRes = await worker.fetch(
      new Request('https://zwift-victims.example/api/mcp/tokens', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${initialAccessToken}` },
      }),
      env,
    );
    assert.equal(revokeAllRes.status, 200);
    const revokeAllBody = (await revokeAllRes.json()) as { revokedCount: number };
    assert.equal(revokeAllBody.revokedCount, 2);
  } finally {
    restoreFetch();
  }
});

test('All 6 MCP tools work end-to-end with Streamable HTTP, FIT decoding, fitnessData fallback, and ownership isolation', async () => {
  const accessToken = makeFakeJwt({
    sub: 'rider-1001',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'https://secure.zwift.com/auth/realms/zwift',
  });
  const state: MockFetchState = {
    currentAccessToken: accessToken,
    currentRefreshToken: 'zwift-refresh-1',
    fitS3Status: 200,
    refreshCalls: 0,
    fitBytes: buildSampleFitBuffer(120),
  };
  const restoreFetch = installMockFetch(state);

  try {
    const kv = new MockKVNamespace();
    const env = createEnv(kv);

    const mintRes = await worker.fetch(
      new Request('https://zwift-victims.example/api/mcp/tokens', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refreshToken: state.currentRefreshToken,
          expiresAt: Date.now() + 3600_000,
          label: 'Integration Test',
        }),
      }),
      env,
    );
    const { token } = (await mintRes.json()) as { token: string };

    // 1. Initialize & notifications/initialized & tools/list
    const initRes = await callMcp(
      env,
      {
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {} },
      },
      token,
      { 'MCP-Protocol-Version': '2025-06-18' },
    );
    assert.equal(initRes.status, 200);
    assert.equal(initRes.headers.get('MCP-Protocol-Version'), '2025-06-18');
    const initJson = (await initRes.json()) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    assert.equal(initJson.result.protocolVersion, '2025-06-18');
    assert.equal(initJson.result.serverInfo.name, 'zwift-victims');

    const notifRes = await callMcp(
      env,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      token,
    );
    assert.equal(notifRes.status, 202);

    const listRes = await callMcp(env, { jsonrpc: '2.0', id: 'list-1', method: 'tools/list' }, token);
    const listJson = (await listRes.json()) as {
      result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> };
    };
    assert.equal(listJson.result.tools.length, 6);
    for (const tool of listJson.result.tools) {
      assert.equal(tool.annotations.readOnlyHint, true);
    }

    // 2. get_activities filtered to races
    const actsRes = await callMcp(
      env,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'get_activities',
          arguments: { type: 'race', fromDate: '2026-11-19', toDate: '2026-11-21' },
        },
      },
      token,
    );
    const actsPayload = JSON.parse(
      ((await actsRes.json()) as { result: { content: Array<{ text: string }> } }).result.content[0]
        .text,
    ) as { totalMatched: number; activities: Array<{ activityId: string; eventId: string }> };
    assert.equal(actsPayload.totalMatched, 1);
    assert.equal(actsPayload.activities[0].activityId, '5550001');
    assert.equal(actsPayload.activities[0].eventId, '9001');

    // 3. get_activity_detail (own vs rival forbidden)
    const detailRes = await callMcp(
      env,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_activity_detail', arguments: { activityId: '5550001' } },
      },
      token,
    );
    const detailPayload = JSON.parse(
      ((await detailRes.json()) as { result: { content: Array<{ text: string }> } }).result
        .content[0].text,
    ) as { effort: { normalizedPowerW: number }; race: { placing: number } };
    assert.equal(detailPayload.effort.normalizedPowerW, 268);
    assert.equal(detailPayload.race.placing, 3);

    const rivalDetailRes = await callMcp(
      env,
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'get_activity_detail', arguments: { activityId: '9990002' } },
      },
      token,
    );
    const rivalDetailJson = (await rivalDetailRes.json()) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    assert.equal(rivalDetailJson.result.isError, true);
    assert.match(rivalDetailJson.result.content[0].text, /another rider|access denied/i);

    // 4. get_activity_stream (FIT binary decode + resampling + maxRows cap + CSV & JSON)
    const streamRes = await callMcp(
      env,
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'get_activity_stream',
          arguments: {
            activityId: '5550001',
            resample: 5,
            maxRows: 5,
            fields: ['elapsed_sec', 'power_w', 'heart_rate_bpm'],
            format: 'csv',
          },
        },
      },
      token,
    );
    const streamPayload = JSON.parse(
      ((await streamRes.json()) as { result: { content: Array<{ text: string }> } }).result
        .content[0].text,
    ) as {
      source: string;
      returnedRows: number;
      truncated: boolean;
      nextStartSec: number;
      csv: string;
    };
    assert.equal(streamPayload.source, 'fit');
    assert.equal(streamPayload.returnedRows, 5);
    assert.equal(streamPayload.truncated, true);
    assert.equal(streamPayload.nextStartSec, 25);
    assert.ok(streamPayload.csv.startsWith('elapsed_sec,power_w,heart_rate_bpm\n'));

    // Cross-rider stream request blocked
    const rivalStreamRes = await callMcp(
      env,
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'get_activity_stream', arguments: { activityId: '9990002' } },
      },
      token,
    );
    assert.equal(
      ((await rivalStreamRes.json()) as { result: { isError: boolean } }).result.isError,
      true,
    );

    // Fallback to fitnessData JSON when S3 returns 404
    state.fitS3Status = 404;
    const fallbackStreamRes = await callMcp(
      env,
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'get_activity_stream',
          arguments: { activityId: '5550001', resample: 10, format: 'json' },
        },
      },
      token,
    );
    const fallbackPayload = JSON.parse(
      ((await fallbackStreamRes.json()) as { result: { content: Array<{ text: string }> } }).result
        .content[0].text,
    ) as { source: string; returnedRows: number; rows: unknown[][] };
    assert.equal(fallbackPayload.source, 'fitness_data');
    assert.equal(fallbackPayload.returnedRows, 4);
    assert.equal(fallbackPayload.rows.length, 4);
    state.fitS3Status = 200;

    // 5. get_race_results
    const raceRes = await callMcp(
      env,
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'get_race_results', arguments: { eventId: '9001' } },
      },
      token,
    );
    const racePayload = JSON.parse(
      ((await raceRes.json()) as { result: { content: Array<{ text: string }> } }).result.content[0]
        .text,
    ) as {
      selectedPen: { category: string };
      sof: number;
      myResult: { riderId: number; rank: number };
      standings: unknown[];
    };
    assert.equal(racePayload.selectedPen.category, 'B');
    assert.equal(racePayload.sof, 595);
    assert.equal(racePayload.myResult.riderId, 1001);
    assert.equal(racePayload.myResult.rank, 3);
    assert.equal(racePayload.standings.length, 2);

    // 6. get_intervals (FIT laps + detected power efforts)
    const lapsRes = await callMcp(
      env,
      {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'get_intervals',
          arguments: { activityId: '5550001', mode: 'laps' },
        },
      },
      token,
    );
    const lapsPayload = JSON.parse(
      ((await lapsRes.json()) as { result: { content: Array<{ text: string }> } }).result.content[0]
        .text,
    ) as { laps: Array<{ lapNumber: number }> };
    assert.equal(lapsPayload.laps.length, 2);

    const effortsRes = await callMcp(
      env,
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'get_intervals',
          arguments: { activityId: '5550001', mode: 'efforts', minEffortSec: 25 },
        },
      },
      token,
    );
    const effortsPayload = JSON.parse(
      ((await effortsRes.json()) as { result: { content: Array<{ text: string }> } }).result
        .content[0].text,
    ) as { detectedEfforts: Array<{ avgPowerW: number }> };
    assert.equal(effortsPayload.detectedEfforts.length, 2);
    assert.equal(effortsPayload.detectedEfforts[0].avgPowerW, 320);

    // 7. get_power_curve
    const powerRes = await callMcp(
      env,
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'get_power_curve', arguments: { range: 'all' } },
      },
      token,
    );
    const powerPayload = JSON.parse(
      ((await powerRes.json()) as { result: { content: Array<{ text: string }> } }).result
        .content[0].text,
    ) as { thresholds: { zftpW: number; zrVelo: number; zrPhenotype: string } };
    assert.equal(powerPayload.thresholds.zftpW, 264);
    assert.equal(powerPayload.thresholds.zrVelo, 615.4);
    assert.equal(powerPayload.thresholds.zrPhenotype, 'Puncheur');
  } finally {
    restoreFetch();
  }
});
