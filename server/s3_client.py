import os
from typing import Optional

import boto3
from botocore.client import Config
from dotenv import load_dotenv


# Ensure env is loaded when this module is imported directly
load_dotenv()


def get_bucket() -> Optional[str]:
    return os.getenv("AWS_S3_BUCKET")


def is_mock_mode() -> bool:
    # Explicit mock flag wins
    if os.getenv("MOCK_S3", "0") == "1":
        return True
    # Missing any of the required credentials means mock
    required = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_S3_BUCKET"]
    for name in required:
        if not os.getenv(name):
            return True
    return False


def get_s3():
    """Create and return a configured boto3 S3 client.

    Note: Callers should consult is_mock_mode() before using the client.
    """
    region = os.getenv("AWS_DEFAULT_REGION",
                       os.getenv("AWS_REGION", "us-east-1"))
    endpoint = os.getenv("AWS_S3_ENDPOINT")  # optional (LocalStack/MinIO)

    session = boto3.session.Session(
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        region_name=region,
    )
    s3 = session.client(
        "s3",
        endpoint_url=endpoint if endpoint else None,
        config=Config(s3={"addressing_style": "virtual"}),
    )
    return s3



