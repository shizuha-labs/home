"""Home hydration must not wait for another widget or reuse financial grants."""
import asyncio

import httpx
import pytest

from app import main
from app.cache import widget_cache
from app.schema import OrgRef, Widget
from tests.test_progress_cache import rr, redis_url, finish  # noqa: F401
from tests.test_summary import _auth, _token, _stub_jwks, _stub_widgets  # noqa: F401


@pytest.mark.asyncio
async def test_summary_hydrates_independently_while_task_source_stalls(rr, monkeypatch):
    release = asyncio.Event()
    calls = []

    async def slow_tasks(*args, **kwargs):
        calls.append('tasks')
        await release.wait()
        return Widget.ok_({'open': 153})

    async def names(*args, **kwargs):
        return [OrgRef(id=1, role='admin', name='Example organization')]

    async def finance(*args, **kwargs):
        raise AssertionError('summary must not start a financial read')

    monkeypatch.setattr(main, 'fetch_tasks_by_status', slow_tasks)
    monkeypatch.setattr(main, 'fetch_org_refs', names)
    monkeypatch.setattr(main, 'fetch_financial_snapshot', finance)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                 base_url='http://test') as client:
        headers = _auth(_token())
        first = await asyncio.wait_for(client.get('/api/home/summary?background=1', headers=headers), 1)
        body = first.json()
        assert first.status_code == 200 and body['refreshing']
        assert body['retry_after_seconds'] == 1
        assert body['orgs'][0]['id'] == 1
        assert body['widgets']['tasks_by_status']['status'] == 'loading'
        assert body['widgets']['financial_snapshot']['data'] is None
        await asyncio.gather(*(task for key, task in list(widget_cache._refresh_tasks.items())
                               if not key.startswith('tasks_by_status:')))
        partial = (await client.get('/api/home/summary?background=1', headers=headers)).json()
        assert partial['orgs'][0]['name'] == 'Example organization'
        assert partial['widgets']['agent_activity']['data'] == {'active': 2, 'error': 1}
        assert partial['widgets']['tasks_by_status']['status'] == 'loading'
        assert len(calls) == 1
        release.set()
        await finish(widget_cache)
        ready = (await client.get('/api/home/summary?background=1', headers=headers)).json()
        assert ready['widgets']['tasks_by_status']['data']['open'] == 153
        assert ready['widgets']['tasks_by_status']['as_of']
        assert not ready['refreshing']


@pytest.mark.asyncio
async def test_background_summary_respects_auth_and_changed_memberships(rr, monkeypatch):
    async def names(_client, _bearer, _uid, _email, memberships):
        return [OrgRef(id=oid, role=role, name=f'Org {oid}') for oid, role in memberships.items()]
    monkeypatch.setattr(main, 'fetch_org_refs', names)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                 base_url='http://test') as client:
        assert (await client.get('/api/home/summary?background=1')).status_code == 401
        first = _auth(_token(memberships={'1': 'admin'}))
        assert (await client.get('/api/home/summary?background=1&org_id=9', headers=first)).status_code == 403
        await client.get('/api/home/summary?background=1', headers=first)
        await finish(widget_cache)
        second = _auth(_token(memberships={'9': 'member'}))
        narrowed = (await client.get('/api/home/summary?background=1', headers=second)).json()
        assert [org['id'] for org in narrowed['orgs']] == [9]
        assert narrowed['widgets']['tasks_by_status']['data'] is None


@pytest.mark.asyncio
async def test_financial_reads_recheck_books_permission_with_unchanged_token(rr, monkeypatch):
    values = [Widget.ok_({'cash': 1200}), Widget.unauthorized_(), Widget.degraded_()]
    scopes = []
    async def fetch(_client, _bearer, org):
        scopes.append(org)
        return values.pop(0)
    monkeypatch.setattr(main, 'fetch_financial_snapshot', fetch)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                 base_url='http://test') as client:
        headers = _auth(_token(memberships={'7': 'member', '1': 'admin'}))
        for status in ('ok', 'unauthorized', 'degraded'):
            response = await client.get('/api/home/financial', headers=headers)
            body = response.json()
            assert response.status_code == 200 and body['org_id'] == 1
            assert body['widget']['status'] == status
            if status == 'ok':
                assert body['widget']['data'] == {'cash': 1200, 'org_id': 1}
                assert body['widget']['as_of']
            else:
                assert body['widget']['data'] is None
        assert scopes == [1, 1, 1]
        assert (await client.get('/api/home/financial?org_id=99', headers=headers)).status_code == 403
        assert (await client.get('/api/home/financial')).status_code == 401
        assert len(scopes) == 3


@pytest.mark.asyncio
async def test_financial_explicit_scope_and_source_deadline(rr, monkeypatch):
    entered = asyncio.Event()
    async def slow(_client, _bearer, org):
        assert org == 7
        entered.set()
        await asyncio.Event().wait()
    monkeypatch.setattr(main, 'fetch_financial_snapshot', slow)
    monkeypatch.setattr(main.settings, 'SOURCE_TIMEOUT_SECONDS', .02)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                 base_url='http://test') as client:
        response = await asyncio.wait_for(client.get('/api/home/financial?org_id=7',
            headers=_auth(_token(memberships={'7': 'member'}))), 1)
        assert entered.is_set()
        assert response.json()['widget'] == {'status': 'degraded', 'as_of': None, 'data': None}
