"""HIVE-375 BFF auth: verify the caller's id JWT and derive tenant scope.

The BFF's tenant-isolation guarantee rests entirely here + on forwarding the
caller's own Bearer downstream (never a privileged aggregator token):
  - the caller is exactly who the *verified* JWT says (no trust in any request
    field for identity/scope — auth-scope-provenance discipline);
  - the org a request targets MUST be one the caller is a member of, else 403;
  - `organization_memberships` comes from the signed token claim, so the BFF
    can never widen scope or leak another org's data.
"""
from dataclasses import dataclass
from typing import Optional

import jwt
from fastapi import Header, HTTPException, status

from .config import settings


@dataclass(frozen=True)
class Caller:
    user_id: int
    email: Optional[str]
    # {org_id(int): role(str)} — the signed membership claim.
    memberships: dict
    # The raw Bearer token, forwarded verbatim to every downstream so each
    # service applies ITS OWN authz. Never logged.
    bearer: str

    @property
    def org_ids(self) -> list:
        return list(self.memberships.keys())


def _normalize_memberships(raw) -> dict:
    """JWT JSON forces string keys; coerce to int so downstream org-id compares
    are integer-clean (mirrors FederatedUser._normalize_memberships)."""
    out = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            try:
                out[int(k)] = str(v)
            except (TypeError, ValueError):
                continue
    return out


def verify_caller(authorization: Optional[str] = Header(default=None)) -> Caller:
    """FastAPI dependency: 401 unless a valid Bearer id-JWT is present."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    token = authorization[len("Bearer "):].strip()
    if not settings.JWT_SECRET_KEY:
        # Fail closed: without the shared key we cannot verify anyone.
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "BFF misconfigured: no JWT key")
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    uid = payload.get("user_id") or payload.get("sub") or payload.get("id")
    try:
        uid = int(uid)
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token missing user id")
    return Caller(
        user_id=uid,
        email=payload.get("email"),
        memberships=_normalize_memberships(payload.get("organization_memberships")),
        bearer=token,
    )


def resolve_scope_org(caller: Caller, org_id: Optional[int]) -> Optional[int]:
    """Validate an explicitly requested org.

    - org_id given → the caller MUST be a member, else 403 (never leak another
      org's summary even if the caller knows/guesses the id).
    - org_id omitted → None (aggregate across the caller's own memberships).
    """
    if org_id is None:
        return None
    if org_id not in caller.memberships:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Not a member of organization {org_id}",
        )
    return org_id
