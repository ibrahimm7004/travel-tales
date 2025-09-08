from fastapi.testclient import TestClient
from backend.main import app


client = TestClient(app)


def test_upload_requires_files():
    r = client.post("/photos/upload")
    assert r.status_code in (400, 422)

# TODO: add authenticated upload test with a small sample image
