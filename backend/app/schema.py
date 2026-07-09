"""HIVE-375 versioned home-summary contract (HomeSummaryV1) + HIVE-603
activity stream contract (HomeActivityEventV1).

Every widget carries its own `status` so the SPA renders shell+skeletons
instantly and hydrates each independently; the envelope is ALWAYS returned
200 (partial) — a slow/down source degrades ONE widget, never the page.
"""
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field

SUMMARY_VERSION = 1
ACTIVITY_VERSION = 1


class WidgetStatus(str, Enum):
    ok = "ok"
    degraded = "degraded"      # partial data (some sub-source failed)
    stale = "stale"            # served from cache after a source timeout/failure
    unauthorized = "unauthorized"  # caller not authorized for this widget's data
    empty = "empty"            # authorized, nothing to show


class Widget(BaseModel):
    status: WidgetStatus
    as_of: Optional[str] = None
    data: Any = None

    @classmethod
    def ok_(cls, data, as_of=None):
        return cls(status=WidgetStatus.ok, data=data, as_of=as_of)

    @classmethod
    def degraded_(cls, data=None, as_of=None):
        return cls(status=WidgetStatus.degraded, data=data, as_of=as_of)

    @classmethod
    def stale_(cls, data=None, as_of=None):
        return cls(status=WidgetStatus.stale, data=data, as_of=as_of)

    @classmethod
    def unauthorized_(cls):
        return cls(status=WidgetStatus.unauthorized, data=None)

    @classmethod
    def empty_(cls, as_of=None):
        return cls(status=WidgetStatus.empty, data=None, as_of=as_of)


class OrgRef(BaseModel):
    id: int
    role: str
    name: Optional[str] = None
    slug: Optional[str] = None


class HomeSummaryV1(BaseModel):
    version: int = Field(default=SUMMARY_VERSION)
    generated_at: str
    org_id: Optional[int] = None
    orgs: list[OrgRef] = Field(default_factory=list)
    widgets: dict[str, Widget] = Field(default_factory=dict)


class HomeActivityV1(BaseModel):
    """HIVE-602 live-theater payload: the org's autonomous work, happening.

    widgets.feed   — merged newest-first events (Pulse activity + comments)
    widgets.agents — the fleet as live entities (who, role, model, state)
    """
    version: int = 1
    generated_at: str
    org_id: Optional[int] = None
    widgets: dict[str, Widget] = Field(default_factory=dict)


# ---- HIVE-603 activity stream contract ---------------------------------------

class ActivityActor(BaseModel):
    kind: str = "system"  # agent|user|system
    username: Optional[str] = None
    display_name: Optional[str] = None
    role: Optional[str] = None


class ActivityTarget(BaseModel):
    kind: str = "task"  # task|agent|conversation|project
    key: Optional[str] = None
    title: Optional[str] = None
    href: Optional[str] = None


class HomeActivityEventV1(BaseModel):
    """Single activity event, matching the HLD contract §4."""
    version: int = Field(default=ACTIVITY_VERSION)
    id: str  # Redis Stream id
    source: str  # pulse|hive|connect
    type: str  # task.comment|task.transition|task.assignment|task.pr_link|agent.status|agent.task_focus|agent.message_summary
    occurred_at: str
    org_id: int
    project_key: Optional[str] = None
    actor: ActivityActor = Field(default_factory=ActivityActor)
    target: ActivityTarget = Field(default_factory=ActivityTarget)
    summary: str = ""
    redaction: str = "none"  # none|metadata_only|suppressed
    priority: str = "normal"  # normal|high|urgent
    metadata: dict[str, Any] = Field(default_factory=dict)


class ActivityRecentResponse(BaseModel):
    events: list[HomeActivityEventV1] = Field(default_factory=list)
    cursor_by_org: dict[str, str] = Field(default_factory=dict)
    degraded_sources: list[str] = Field(default_factory=list)
