from uuid import uuid4
from fastapi.testclient import TestClient
from backend.main import app


client = TestClient(app)


def test_register_login_me_happy_path():
    email = f"user_{uuid4().hex[:8]}@example.com"

    r = client.post("/auth/register",
                    json={"email": email, "password": "secret123"})
    assert r.status_code == 200
    user = r.json()
    assert user["email"] == email

    r = client.post(
        "/auth/login", json={"email": email, "password": "secret123"})
    assert r.status_code == 200
    token = r.json()["access_token"]

    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    me = r.json()
    assert me["email"] == email
