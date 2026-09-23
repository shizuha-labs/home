"""Progress's real HTTP/Redis refresh, ownership and authorization boundaries."""
import asyncio
import datetime
import json
import socket
import subprocess
import time
import uuid

import httpx
import jwt
import pytest
import pytest_asyncio
import redis
import redis.asyncio as aioredis
from cryptography.hazmat.primitives.asymmetric import rsa

from app import auth, main
from app.cache import WidgetCache, widget_cache
from app.config import settings
from app.schema import Widget


@pytest.fixture(scope='module')
def redis_url(tmp_path_factory):
    # Test-owned loopback Redis; never uses HOME_REDIS_URL or a shared service.
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    proc = subprocess.Popen(['redis-server', '--bind', '127.0.0.1', '--port', str(port),
                             '--save', '', '--appendonly', 'no', '--dir',
                             str(tmp_path_factory.mktemp('progress-redis'))],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f'redis://127.0.0.1:{port}/0'
    client = redis.Redis.from_url(url)
    try:
        for _ in range(100):
            try:
                if client.ping():
                    break
            except redis.ConnectionError:
                time.sleep(.01)
        else:
            raise AssertionError('test-owned Redis did not start')
        yield url
    finally:
        client.close()
        proc.terminate()
        proc.wait(timeout=5)


@pytest_asyncio.fixture
async def rr(redis_url, monkeypatch):
    client = aioredis.Redis.from_url(redis_url, decode_responses=True)
    await client.flushdb()  # only the disposable server created above
    async def get():
        return client
    monkeypatch.setattr('app.redis_client.get_redis', get)
    widget_cache.clear()
    yield client
    tasks = list(widget_cache._refresh_tasks.values())
    widget_cache.clear()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    await client.aclose()


async def finish(cache):
    await asyncio.gather(*list(cache._refresh_tasks.values()))


async def age(rr, cache, *, stale=False):
    for entry in cache._snapshots.values():
        entry['checked_at'] -= settings.CACHE_TTL_SECONDS + 1
        if stale:
            entry['observed_at'] -= settings.STALE_TTL_SECONDS + 1
    for key in await rr.keys('home:widgets:v1:*'):
        if key.endswith(':lock'):
            continue
        entry = json.loads(await rr.get(key))
        entry['checked_at'] -= settings.CACHE_TTL_SECONDS + 1
        if stale:
            entry['observed_at'] -= settings.STALE_TTL_SECONDS + 1
        await rr.set(key, json.dumps(entry), ex=300)


@pytest.mark.asyncio
async def test_cold_refresh_is_singleflight_and_shared_between_replicas(rr):
    first, second = WidgetCache(), WidgetCache()
    release = asyncio.Event()
    calls = []
    started = asyncio.Event()
    async def fetch():
        calls.append(1)
        started.set()
        await release.wait()
        return Widget.ok_({'open': 7})
    for cache in [first, second, first, second]:
        widget, pending = await cache.get_or_refresh('caller-1', fetch)
        assert widget.status == 'loading' and pending
    await asyncio.wait_for(started.wait(), 1)
    await finish(second)
    assert len(calls) == 1
    release.set()
    await finish(first)
    await second.get_or_refresh('caller-1', fetch)
    await finish(second)
    widget, pending = await second.get_or_refresh('caller-1', fetch)
    assert widget.status == 'ok' and widget.data == {'open': 7} and widget.as_of
    assert not pending and len(calls) == 1


@pytest.mark.asyncio
async def test_stale_refresh_failure_preserves_as_of_then_rearms(rr):
    cache = WidgetCache()
    async def good():
        return Widget.ok_({'open': 9}, as_of='2026-09-23T00:00:00Z')
    await cache.get_or_refresh('caller', good)
    await finish(cache)
    await age(rr, cache)
    release = asyncio.Event()
    async def failure():
        await release.wait()
        return Widget.degraded_()
    widget, pending = await cache.get_or_refresh('caller', failure)
    assert widget.status == 'stale' and pending and widget.data == {'open': 9}
    assert widget.as_of == '2026-09-23T00:00:00Z'
    release.set()
    await finish(cache)
    widget, pending = await cache.get_or_refresh('caller', failure)
    assert widget.status == 'stale' and not pending
    await age(rr, cache)
    async def next_good():
        return Widget.ok_({'open': 10})
    await cache.get_or_refresh('caller', next_good)
    await finish(cache)
    widget, pending = await cache.get_or_refresh('caller', next_good)
    assert widget.status == 'ok' and widget.data == {'open': 10} and not pending


@pytest.mark.asyncio
async def test_denial_replaces_good_data_in_shared_cache(rr):
    cache = WidgetCache()
    async def good():
        return Widget.ok_({'private': 'value'})
    await cache.get_or_refresh('caller', good)
    await finish(cache)
    await age(rr, cache)
    async def denied():
        return Widget.unauthorized_()
    await cache.get_or_refresh('caller', denied)
    await finish(cache)
    other = WidgetCache()
    await other.get_or_refresh('caller', good)
    await finish(other)
    widget, pending = await other.get_or_refresh('caller', good)
    assert widget.status == 'unauthorized' and widget.data is None and not pending


@pytest.mark.asyncio
async def test_expired_owner_cannot_publish_or_unlock_successor(rr):
    old, new = WidgetCache(), WidgetCache()
    old_release, new_release = asyncio.Event(), asyncio.Event()
    old_started, new_started = asyncio.Event(), asyncio.Event()
    async def old_fetch():
        old_started.set()
        await old_release.wait()
        return Widget.ok_({'revision': 'old'})
    async def new_fetch():
        new_started.set()
        await new_release.wait()
        return Widget.ok_({'revision': 'new'})
    await old.get_or_refresh('same', old_fetch)
    await asyncio.wait_for(old_started.wait(), 1)
    lock = (await rr.keys('*:lock'))[0]
    await rr.delete(lock)  # model lease expiry while the former worker is stalled
    await new.get_or_refresh('same', new_fetch)
    await asyncio.wait_for(new_started.wait(), 1)
    successor_token = await rr.get(lock)
    old_release.set()
    await finish(old)
    assert await rr.get(lock) == successor_token
    assert not await rr.get(lock.removesuffix(':lock'))
    new_release.set()
    await finish(new)
    await old.get_or_refresh('same', old_fetch)
    await finish(old)
    widget, pending = await old.get_or_refresh('same', old_fetch)
    assert widget.data == {'revision': 'new'} and not pending


@pytest.mark.asyncio
async def test_cache_outage_uses_local_singleflight_and_preserves_success(monkeypatch):
    async def unavailable():
        raise ConnectionError('test cache unavailable')
    monkeypatch.setattr('app.redis_client.get_redis', unavailable)
    cache = WidgetCache()
    release = asyncio.Event()
    async def fetch():
        await release.wait()
        return Widget.ok_({'count': 4})
    await cache.get_or_refresh('caller', fetch)
    await cache.get_or_refresh('caller', fetch)
    assert len(cache._refresh_tasks) == 1
    release.set()
    await finish(cache)
    widget, pending = await cache.get_or_refresh('caller', fetch)
    assert widget.data == {'count': 4} and not pending


@pytest.mark.asyncio
async def test_expired_data_and_failed_cold_fetch_are_not_fabricated_zero(rr):
    cache = WidgetCache()
    async def good():
        return Widget.ok_({'count': 4})
    await cache.get_or_refresh('caller', good)
    await finish(cache)
    await age(rr, cache, stale=True)
    async def failure():
        return Widget.degraded_()
    widget, _ = await cache.get_or_refresh('caller', failure)
    assert widget.data is None
    await finish(cache)
    widget, pending = await cache.get_or_refresh('caller', failure)
    assert widget.status == 'degraded' and widget.data is None and not pending


@pytest.mark.asyncio
async def test_real_route_auth_scope_pending_followup_and_client_lifetime(rr, monkeypatch):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(auth, '_jwks_fetch_keys', lambda **_: {'progress': private.public_key()})
    def token(user=1, org='1', expired=False):
        return jwt.encode({'user_id': user, 'email': 'test@example.invalid',
                           'organization_memberships': {org: 'admin'},
                           'exp': int(time.time()) + (-1 if expired else 3600),
                           'jti': str(uuid.uuid4())}, private, algorithm='RS256',
                          headers={'kid': 'progress'})
    release = asyncio.Event()
    clients = []
    started = asyncio.Event()
    async def fetch(client, bearer, **kwargs):
        clients.append(client)
        started.set()
        assert not client.is_closed
        await release.wait()
        assert not client.is_closed
        return Widget.ok_({'by_status': {'open': 3}})
    monkeypatch.setattr(main, 'fetch_org_progress', fetch)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://testserver') as client:
        headers = {'Authorization': 'Bearer ' + token()}
        response = await client.get('/api/home/progress?org_id=1', headers=headers)
        assert response.status_code == 200
        assert response.json()['widget']['status'] == 'loading'
        assert response.json()['refreshing'] and response.json()['retry_after_seconds'] == 1
        await asyncio.wait_for(started.wait(), 1)
        keys_before = await rr.keys('*')
        assert (await client.get('/api/home/progress?org_id=2', headers=headers)).status_code == 403
        assert (await client.get('/api/home/progress?org_id=1', headers={'Authorization': 'Bearer ' + token(expired=True)})).status_code == 401
        assert await rr.keys('*') == keys_before
        release.set()
        await finish(widget_cache)
        assert clients[0].is_closed
        response = await client.get('/api/home/progress?org_id=1', headers=headers)
        assert response.json()['widget']['status'] == 'ok'
        assert not response.json()['refreshing']
        assert response.json()['widget']['as_of']
        # Different windows and a fresh token cannot reuse the previous snapshot.
        assert (await client.get('/api/home/progress?org_id=1&hours=72', headers=headers)).json()['widget']['status'] == 'loading'
        await finish(widget_cache)
        assert (await client.get('/api/home/progress?org_id=1', headers={'Authorization': 'Bearer ' + token()})).json()['widget']['status'] == 'loading'
        await finish(widget_cache)


@pytest.mark.asyncio
async def test_stalled_cache_never_blocks_get_or_warm_snapshot(monkeypatch):
    stalled = asyncio.Event()
    entered = asyncio.Event()
    async def cache_unavailable():
        entered.set()
        await stalled.wait()
        raise ConnectionError('test cache unavailable')
    monkeypatch.setattr('app.redis_client.get_redis', cache_unavailable)
    cache = WidgetCache()
    async def fetch():
        return Widget.ok_({'count': 3})
    widget, pending = await asyncio.wait_for(cache.get_or_refresh('caller', fetch), .1)
    assert widget.status == 'loading' and pending
    await asyncio.wait_for(entered.wait(), 1)
    widget, pending = await asyncio.wait_for(cache.get_or_refresh('caller', fetch), .1)
    assert widget.status == 'loading' and pending
    stalled.set()
    await finish(cache)
    entered.clear()
    widget, pending = await asyncio.wait_for(cache.get_or_refresh('caller', fetch), .1)
    assert widget.data == {'count': 3} and not pending
    assert not entered.is_set()
